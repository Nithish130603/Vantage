"""
Vantage precompute — gold standards + locality/state + suburb_scores.

Reads vantage.duckdb (produced by pipeline.py + embed.py), then:
  1. Enriches suburb_cells with locality + state columns
  2. Computes gold standard vectors per category (survivor analysis)
  3. Scores all suburbs × categories with all 5 signals + tier/status/risk
  4. Writes gold_standards + suburb_scores tables back to vantage.duckdb

Usage:
    python data/precompute.py
    python data/precompute.py --categories "Café" "Gym" "Pharmacy" "Restaurant" "Retail"
    python data/precompute.py --db backend/vantage.duckdb
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import duckdb
import joblib
import numpy as np
from sklearn.preprocessing import normalize as l2_normalise

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from scoring.fingerprint_match import fingerprint_match
from scoring.market_trajectory import market_trajectory_bulk
from scoring.competitive_pressure import competitive_pressure_bulk
from scoring.ecosystem_diversity import ecosystem_diversity_bulk
from scoring.risk_signals import risk_signals_bulk

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("precompute")

DECISIONS_PATH = ROOT / "data" / "eda_decisions.json"
DEFAULT_DB     = ROOT / "backend" / "vantage.duckdb"
TFIDF_PKL      = ROOT / "backend" / "tfidf.pkl"

DEFAULT_CATEGORIES = ["Café", "Gym & Fitness", "Pharmacy", "Restaurant", "Retail"]

# Signal weights from spec — must sum to 1.0
WEIGHTS = {
    "fingerprint":  0.30,
    "trajectory":   0.25,
    "diversity":    0.20,
    "risk":         0.15,
    "competition":  0.10,
}

# Category → keyword mapping for Foursquare category_label matching
CATEGORY_KEYWORDS = {
    "Café":          "café",
    "Gym":           "gym",
    "Gym & Fitness": "gym",
    "Pharmacy":      "pharmacy",
    "Restaurant":    "restaurant",
    "Retail":        "retail",
}


def load_decisions() -> dict:
    with open(DECISIONS_PATH) as f:
        return json.load(f)


# ── Step 1: Enrich suburb_cells with locality + state ─────────────────────────

def enrich_suburb_cells(con: duckdb.DuckDBPyConnection) -> None:
    """Add locality and state columns to suburb_cells from the venues table."""
    t0 = time.perf_counter()
    log.info("── Enriching suburb_cells with locality + state ──────────────")

    # Check current schema
    cols = [r[0] for r in con.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'suburb_cells'"
    ).fetchall()]

    if "locality" in cols and "state" in cols:
        # Check if they have data
        n_null = con.execute(
            "SELECT count(*) FROM suburb_cells WHERE locality IS NULL"
        ).fetchone()[0]
        if n_null == 0:
            log.info("  suburb_cells already has locality/state data — skipping")
            return

    # Compute most common locality and region per h3_r7 from venues
    enrichment = con.execute("""
        SELECT h3_r7,
               mode(locality) AS top_locality,
               mode(region)   AS top_region
        FROM venues
        WHERE locality IS NOT NULL
        GROUP BY h3_r7
    """).fetchall()

    enrichment_map = {r[0]: (r[1], r[2]) for r in enrichment}

    # Add columns if missing
    if "locality" not in cols:
        con.execute("ALTER TABLE suburb_cells ADD COLUMN locality VARCHAR")
    if "state" not in cols:
        con.execute("ALTER TABLE suburb_cells ADD COLUMN state VARCHAR")

    # Map region strings to state abbreviations
    state_map = {
        "new south wales": "NSW", "nsw": "NSW",
        "victoria": "VIC", "vic": "VIC",
        "queensland": "QLD", "qld": "QLD",
        "western australia": "WA", "wa": "WA",
        "south australia": "SA", "sa": "SA",
        "tasmania": "TAS", "tas": "TAS",
        "australian capital territory": "ACT", "act": "ACT",
        "northern territory": "NT", "nt": "NT",
    }

    cells = con.execute("SELECT h3_r7 FROM suburb_cells").fetchall()
    updates = []
    for (h3_id,) in cells:
        locality, region = enrichment_map.get(h3_id, (None, None))
        state_abbr = None
        if region:
            state_abbr = state_map.get(region.lower().strip(), region[:3].upper())
        updates.append((locality, state_abbr, h3_id))

    con.executemany(
        "UPDATE suburb_cells SET locality = ?, state = ? WHERE h3_r7 = ?",
        updates,
    )
    n_updated = con.execute(
        "SELECT count(*) FROM suburb_cells WHERE locality IS NOT NULL"
    ).fetchone()[0]
    log.info("  Updated %d suburb_cells with locality/state  (%.1f s)",
             n_updated, time.perf_counter() - t0)


# ── Step 2: Compute gold standard vectors ─────────────────────────────────────

def compute_gold_standards(
    con: duckdb.DuckDBPyConnection,
    categories: list[str],
    vectorizer,
    cell_ids: list[str],
    suburb_matrix: np.ndarray,
) -> dict[str, np.ndarray]:
    """
    Mine the dataset's own survivors to build the ideal fingerprint per category.
    Gold standard = average TF-IDF vector of suburbs containing long-term survivors
    of that category.
    """
    t0 = time.perf_counter()
    log.info("── Computing gold standard vectors ──────────────────────────")

    cell_id_to_idx = {cid: i for i, cid in enumerate(cell_ids)}

    # Create gold_standards table
    con.execute("""
        CREATE TABLE IF NOT EXISTS gold_standards (
            category VARCHAR PRIMARY KEY,
            vector_json VARCHAR,
            sample_size INTEGER,
            top_surrounding_categories VARCHAR
        )
    """)
    # Clear existing rows
    con.execute("DELETE FROM gold_standards")

    feature_names = vectorizer.get_feature_names_out()
    gold_vectors = {}

    for category in categories:
        keyword = CATEGORY_KEYWORDS.get(category, category.lower())

        # Find H3 cells that contain long-lived survivors of this category
        # "Survivor" = venue that was created 3+ years ago, still active (not closed),
        # and recently refreshed
        survivor_cells = con.execute("""
            SELECT h3_r7
            FROM venues
            WHERE LOWER(category_label) LIKE ?
              AND is_closed = false
              AND is_stale = false
              AND TRY_CAST(date_created AS DATE) <= CURRENT_DATE - INTERVAL 3 YEAR
            GROUP BY h3_r7
            ORDER BY count(*) DESC
            LIMIT 400
        """, [f"%{keyword}%"]).fetchall()

        survivor_h3s = [r[0] for r in survivor_cells]
        gold_indices = [cell_id_to_idx[h3] for h3 in survivor_h3s if h3 in cell_id_to_idx]

        if len(gold_indices) < 5:
            # Fallback: use all suburbs that have this category at all
            log.info("  %s: only %d survivors, falling back to all cells with category",
                     category, len(gold_indices))
            cat_cells = con.execute("""
                SELECT DISTINCT h3_r7
                FROM venues
                WHERE LOWER(category_label) LIKE ?
                  AND is_closed = false
            """, [f"%{keyword}%"]).fetchall()
            cat_h3s = [r[0] for r in cat_cells]
            gold_indices = [cell_id_to_idx[h3] for h3 in cat_h3s if h3 in cell_id_to_idx]

        if len(gold_indices) < 3:
            # Ultimate fallback: use global mean
            log.info("  %s: very few matches, using global mean", category)
            gold_vec = suburb_matrix.mean(axis=0)
        else:
            gold_vec = suburb_matrix[gold_indices].mean(axis=0)

        # L2 normalise
        norm = np.linalg.norm(gold_vec)
        if norm > 0:
            gold_vec = gold_vec / norm
        gold_vec = gold_vec.astype(np.float32)

        # Top surrounding categories
        top_idx = np.argsort(gold_vec)[::-1][:5]
        top_cats = [feature_names[i] for i in top_idx if gold_vec[i] > 0]

        # Store
        vector_json = json.dumps([round(float(v), 6) for v in gold_vec])
        con.execute(
            "INSERT INTO gold_standards VALUES (?, ?, ?, ?)",
            [category, vector_json, len(gold_indices), ", ".join(top_cats)],
        )

        gold_vectors[category] = gold_vec
        log.info("  %s: %d survivor cells → gold vector computed (top: %s)",
                 category, len(gold_indices), ", ".join(top_cats[:3]))

    log.info("  Gold standards computed for %d categories  (%.1f s)",
             len(categories), time.perf_counter() - t0)
    return gold_vectors


# ── Step 3: Score all suburbs ─────────────────────────────────────────────────

def tier_from_score(score: float) -> str:
    if score >= 0.85:
        return "BETTER_THAN_BEST"
    if score >= 0.70:
        return "PRIME"
    if score >= 0.55:
        return "STRONG"
    if score >= 0.40:
        return "WATCH"
    return "AVOID"


def trajectory_status(score: float) -> str:
    if score >= 0.65:
        return "GROWING"
    if score >= 0.40:
        return "STABLE"
    return "NARROWING"


def risk_level(score: float) -> str:
    if score >= 0.65:
        return "LOW"
    if score >= 0.40:
        return "MODERATE"
    return "HIGH"


def score_all_suburbs(
    con: duckdb.DuckDBPyConnection,
    categories: list[str],
    gold_vectors: dict[str, np.ndarray],
    vectorizer,
    cell_ids: list[str],
    suburb_matrix: np.ndarray,
    decisions: dict,
) -> None:
    """Score all qualifying suburbs for each category."""
    t0_global = time.perf_counter()
    log.info("── Scoring all suburbs × categories ──────────────────────────")

    # Create suburb_scores table with full schema
    con.execute("""
        CREATE OR REPLACE TABLE suburb_scores (
            h3_r7              VARCHAR,
            category           VARCHAR,
            score              DOUBLE,
            score_fingerprint  DOUBLE,
            score_trajectory   DOUBLE,
            score_competition  DOUBLE,
            score_diversity    DOUBLE,
            score_risk         DOUBLE,
            tier               VARCHAR,
            trajectory_status  VARCHAR,
            risk_level         VARCHAR,
            gold_std_similarity DOUBLE,
            PRIMARY KEY (h3_r7, category)
        )
    """)

    # Pre-fetch data for signals 4-5 (category-independent)
    log.info("  Fetching venue data for bulk scoring...")

    entropy_floor = decisions.get("entropy_floor", 0.0)
    rows_div = con.execute(
        "SELECT h3_r7, category_label FROM venues WHERE is_closed = false"
    ).fetchall()
    div_map = ecosystem_diversity_bulk(rows_div, entropy_floor=entropy_floor)
    log.info("  Diversity scores: %d cells", len(div_map))

    rows_risk = con.execute(
        "SELECT h3_r7, is_closed, date_created FROM venues"
    ).fetchall()
    venue_counts = dict(
        con.execute("SELECT h3_r7, count(*) FROM venues GROUP BY h3_r7").fetchall()
    )
    risk_map = risk_signals_bulk(rows_risk, venue_counts)
    log.info("  Risk scores: %d cells", len(risk_map))

    total_records = 0
    for category in categories:
        t_cat = time.perf_counter()
        gold_vec = gold_vectors.get(category)
        if gold_vec is None:
            gold_vec = suburb_matrix.mean(axis=0).astype(np.float32)
            n = np.linalg.norm(gold_vec)
            if n > 0:
                gold_vec = gold_vec / n

        # Signal 1: Fingerprint match (cosine similarity to gold standard)
        fp_scores = fingerprint_match(gold_vec, suburb_matrix)

        # Signal 2: Market trajectory (category-specific)
        keyword = CATEGORY_KEYWORDS.get(category, category.lower())
        rows_traj = con.execute(
            "SELECT h3_r7, date_created FROM venues WHERE is_closed = false AND LOWER(category_label) LIKE ?",
            [f"%{keyword}%"]
        ).fetchall()
        traj_map = market_trajectory_bulk(rows_traj)

        # Signal 3: Competitive pressure (category-specific)
        rows_comp = con.execute(
            "SELECT h3_r7, latitude, longitude, category_label FROM venues WHERE is_closed = false"
        ).fetchall()
        comp_map = competitive_pressure_bulk(rows_comp, target_category=category)

        records = []
        for i, cell in enumerate(cell_ids):
            s1 = float(fp_scores[i])
            s2 = traj_map.get(cell, 0.5)
            s3 = comp_map.get(cell, 1.0)
            s4 = div_map.get(cell, 0.0)
            s5 = risk_map.get(cell, 0.5)

            composite = (
                WEIGHTS["fingerprint"] * s1
                + WEIGHTS["trajectory"] * s2
                + WEIGHTS["competition"] * s3
                + WEIGHTS["diversity"] * s4
                + WEIGHTS["risk"] * s5
            )
            composite = float(np.clip(composite, 0, 1))

            tier = tier_from_score(composite)
            traj = trajectory_status(s2)
            risk = risk_level(s5)

            records.append((
                cell, category,
                round(composite, 6),
                round(s1, 6),
                round(s2, 6),
                round(s3, 6),
                round(s4, 6),
                round(s5, 6),
                tier, traj, risk,
                round(s1, 6),  # gold_std_similarity = fingerprint match to gold
            ))

        con.executemany(
            "INSERT OR REPLACE INTO suburb_scores VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            records,
        )
        total_records += len(records)
        log.info("  ✓  %s — %d suburbs scored  (%.1f s)",
                 category, len(records), time.perf_counter() - t_cat)

    log.info("  Total: %d score records  (%.1f s)",
             total_records, time.perf_counter() - t0_global)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Vantage precompute pipeline")
    parser.add_argument(
        "--categories", nargs="+", default=DEFAULT_CATEGORIES,
        help="Categories to compute gold standards + scores for",
    )
    parser.add_argument("--db", default=str(DEFAULT_DB), help="DuckDB path")
    args = parser.parse_args()

    log.info("═" * 65)
    log.info("  Vantage Precompute Pipeline")
    log.info("  Categories: %s", args.categories)
    log.info("═" * 65)

    decisions = load_decisions()
    con = duckdb.connect(args.db)

    # Load TF-IDF vectorizer
    vectorizer = joblib.load(TFIDF_PKL)
    log.info("Loaded TF-IDF vectorizer (%d features)", len(vectorizer.vocabulary_))

    # Build suburb TF-IDF matrix
    suburb_docs = con.execute("""
        SELECT h3_r7, string_agg(category_label, ' ') AS doc
        FROM venues
        WHERE category_label IS NOT NULL AND is_closed = false
        GROUP BY h3_r7
        HAVING count(*) >= 5
        ORDER BY h3_r7
    """).fetchall()

    cell_ids = [r[0] for r in suburb_docs]
    corpus = [r[1] for r in suburb_docs]
    log.info("Suburbs to process: %d", len(cell_ids))

    X = vectorizer.transform(corpus)
    suburb_matrix = X.toarray() if hasattr(X, "toarray") else np.array(X)
    # L2 normalise rows
    norms = np.linalg.norm(suburb_matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1
    suburb_matrix = (suburb_matrix / norms).astype(np.float32)
    log.info("Suburb matrix: %s × %s", *suburb_matrix.shape)

    # Step 1: Enrich suburb_cells
    enrich_suburb_cells(con)

    # Step 2: Compute gold standards
    gold_vectors = compute_gold_standards(
        con, args.categories, vectorizer, cell_ids, suburb_matrix,
    )

    # Step 3: Score all suburbs
    score_all_suburbs(
        con, args.categories, gold_vectors, vectorizer,
        cell_ids, suburb_matrix, decisions,
    )

    con.close()

    log.info("")
    log.info("═" * 65)
    log.info("  PRECOMPUTE COMPLETE")
    log.info("  Gold standards + suburb_scores written to %s", args.db)
    log.info("═" * 65)


if __name__ == "__main__":
    main()
