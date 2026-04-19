"""
Vantage FastAPI application.

Startup loads tfidf.pkl + reducer.pkl + vantage.duckdb into module-level
singletons so every request is served from memory.

On first start, if tfidf.pkl was fitted on raw bracket-delimited category
strings (dirty), it is automatically rebuilt with clean leaf category names.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

warnings.filterwarnings("ignore", category=UserWarning)

import duckdb
import joblib
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sklearn.feature_extraction.text import TfidfVectorizer

from state import state
from routers import fingerprint, scan, location, embedding, report, places

BASE_DIR = Path(__file__).parent
log = logging.getLogger("vantage")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


# ── Category label cleaning ───────────────────────────────────────────────────

def extract_leaf(raw: str) -> str:
    """
    "[Dining and Drinking > Cafe, Coffee, and Tea House > Café]" → "Café"
    "[Sports and Recreation > Gym and Studio]"                  → "Gym and Studio"
    "[Retail > Pharmacy]"                                       → "Pharmacy"
    """
    s = raw.strip().strip("[]").strip()
    parts = s.split(">")
    return parts[-1].strip() if parts else s


def _doc_to_leaves(raw_doc: str) -> str:
    """
    Convert a space-joined string of raw category_labels into a leaf-only document.

    string_agg produces: "[Dining > Café] [Sports > Gym and Studio] [Retail > Pharmacy]"
    Returns:            "Café Gym_and_Studio Pharmacy"
    """
    segments = re.findall(r"\[([^\]]+)\]", raw_doc)
    if not segments:
        leaf = extract_leaf(raw_doc)
        return leaf.replace(" ", "_") if leaf else ""
    return " ".join(
        extract_leaf(seg).replace(" ", "_")
        for seg in segments
        if extract_leaf(seg)
    )


def _is_dirty_tfidf(vectorizer) -> bool:
    """True if tfidf was fitted on raw bracket-delimited category strings."""
    dirty_markers = {"drinking", "dining", "freight", "sporting", "recreation", "and"}
    names = set(vectorizer.get_feature_names_out()[:200])
    return len(dirty_markers & names) >= 3


def _rebuild_tfidf(con, tfidf_path: Path) -> TfidfVectorizer:
    """Refit TF-IDF on clean leaf categories, save, and return the new vectorizer."""
    log.info("Rebuilding tfidf.pkl with clean leaf categories …")
    rows = con.execute("""
        SELECT h3_r7, string_agg(category_label, ' ') AS doc
        FROM venues
        WHERE category_label IS NOT NULL AND is_closed = false
        GROUP BY h3_r7
        HAVING count(*) >= 5
        ORDER BY h3_r7
    """).fetchall()

    docs = [_doc_to_leaves(r[1]) for r in rows]

    # token_pattern matches any non-whitespace run, so "Gym_and_Studio" is one token
    vec = TfidfVectorizer(
        max_features=500,
        sublinear_tf=True,
        lowercase=False,
        token_pattern=r"[^\s]+",
    )
    vec.fit(docs)
    joblib.dump(vec, tfidf_path)
    names = vec.get_feature_names_out()
    log.info(f"tfidf.pkl rebuilt: {len(names)} features. Sample: {list(names[:10])}")
    return vec


# ── Application lifespan ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    db_path      = BASE_DIR / "vantage.duckdb"
    tfidf_path   = BASE_DIR / "tfidf.pkl"
    reducer_path = BASE_DIR / "reducer.pkl"

    # Keep one connection for startup queries only; request handlers use
    # thread-local connections so concurrent requests never share a handle.
    _startup_con = duckdb.connect(str(db_path), read_only=True)
    state["con"] = _startup_con      # used only during startup below
    state["db_path"] = str(db_path)

    _tl = threading.local()

    def get_con() -> duckdb.DuckDBPyConnection:
        """Return a per-thread read-only DuckDB connection."""
        if not hasattr(_tl, "con") or _tl.con is None:
            _tl.con = duckdb.connect(state["db_path"], read_only=True)
        return _tl.con

    state["get_con"] = get_con

    # Load (and possibly rebuild) TF-IDF vectorizer
    state["vectorizer"] = joblib.load(tfidf_path)
    if _is_dirty_tfidf(state["vectorizer"]):
        log.warning("Dirty TF-IDF detected — rebuilding from clean leaf categories")
        state["vectorizer"] = _rebuild_tfidf(state["con"], tfidf_path)
    else:
        log.info("TF-IDF is clean — skipping rebuild")

    # Load UMAP reducer (may fail due to numba version mismatch)
    try:
        state["reducer"] = joblib.load(reducer_path) if reducer_path.exists() else None
    except Exception as exc:
        log.warning(f"Could not load reducer.pkl ({exc}) — UMAP projection disabled")
        state["reducer"] = None

    # Pre-build suburb TF-IDF matrix using clean leaf categories
    suburb_docs = state["con"].execute("""
        SELECT h3_r7, string_agg(category_label, ' ') AS doc
        FROM venues
        WHERE category_label IS NOT NULL AND is_closed = false
        GROUP BY h3_r7
        HAVING count(*) >= 5
        ORDER BY h3_r7
    """).fetchall()

    state["cell_ids"] = [r[0] for r in suburb_docs]
    clean_docs = [_doc_to_leaves(r[1]) for r in suburb_docs]
    X   = state["vectorizer"].transform(clean_docs)
    arr = X.toarray() if hasattr(X, "toarray") else np.array(X)
    raw = arr.astype(np.float32)

    # Normalise rows so dot-product == cosine similarity
    norms = np.linalg.norm(raw, axis=1, keepdims=True)
    norms[norms == 0] = 1
    state["suburb_matrix"] = raw / norms

    # O(1) lookup by cell id
    state["cell_id_to_idx"] = {cid: i for i, cid in enumerate(state["cell_ids"])}

    # Disable reducer if feature dimensions don't match (e.g. after tfidf rebuild)
    if state["reducer"] is not None:
        expected = getattr(state["reducer"], "n_features_in_", None)
        actual   = state["suburb_matrix"].shape[1]
        if expected is not None and expected != actual:
            log.warning(
                f"UMAP reducer expects {expected} features but tfidf has {actual} — "
                "disabling UMAP projection"
            )
            state["reducer"] = None

    log.info(
        f"Startup complete: {len(state['cell_ids'])} suburbs, "
        f"{state['suburb_matrix'].shape[1]} features, "
        f"UMAP={'enabled' if state['reducer'] else 'disabled'}"
    )

    # Load gold standard vectors from DB
    try:
        gold_rows = state["con"].execute(
            "SELECT category, vector_json FROM gold_standards"
        ).fetchall()
        state["gold_vectors"] = {
            row[0]: np.array(json.loads(row[1]), dtype=np.float32) for row in gold_rows
        }
    except Exception:
        state["gold_vectors"] = {}

    yield

    state["con"].close()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Vantage API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(fingerprint.router)
app.include_router(scan.router)
app.include_router(location.router)
app.include_router(embedding.router)
app.include_router(report.router)
app.include_router(places.router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "suburbs":  len(state.get("cell_ids", [])),
        "features": state["suburb_matrix"].shape[1] if "suburb_matrix" in state else 0,
        "umap":     state.get("reducer") is not None,
    }
