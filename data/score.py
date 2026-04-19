"""
Vantage scoring pipeline — compute suburb_scores for target categories.

Reads vantage.duckdb (venues + suburb_cells), runs all 5 signals,
writes suburb_scores table back to vantage.duckdb.

Usage:
    python data/score.py
    python data/score.py --categories "Café" "Gym" "Pharmacy"
    python data/score.py --db backend/vantage.duckdb
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import joblib

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
log = logging.getLogger("score")

DECISIONS_PATH = ROOT / "data" / "eda_decisions.json"
DEFAULT_DB     = ROOT / "backend" / "vantage.duckdb"
TFIDF_PKL      = ROOT / "backend" / "tfidf.pkl"

DEFAULT_CATEGORIES = ["Café", "Gym", "Pharmacy"]

# Signal weights (must sum to 1.0)
WEIGHTS = {
    "fingerprint":  0.35,
    "trajectory":   0.20,
    "competition":  0.20,
    "diversity":    0.15,
    "risk":         0.10,
}


def load_decisions() -> dict:
    with open(DECISIONS_PATH) as f:
        return json.load(f)


def score_category(
    con: duckdb.DuckDBPyConnection,
    category: str,
    vectorizer,
    cell_ids: list[str],
    suburb_matrix: np.ndarray,
    decisions: dict,
) -> list[tuple]:
    """Score all qualifying suburbs for a single category."""

    log.info("  Scoring category: %s", category)

    # ── Signal 1: Fingerprint match ──────────────────────────────────────────
    # Build a DNA vector from the category name itself (used for seed scoring;
    # real fingerprint is built from uploaded locations at request time).
    from sklearn.feature_extraction.text import TfidfVectorizer
    dna_doc = category.replace(" ", "_").lower()
    dna_vec = vectorizer.transform([dna_doc])
    if hasattr(dna_vec, "toarray"):
        dna_vec = dna_vec.toarray()
    norm = np.linalg.norm(dna_vec)
    if norm > 0:
        dna_vec = dna_vec / norm
    fp_scores = fingerprint_match(dna_vec, suburb_matrix)

    # ── Signal 2: Market trajectory ──────────────────────────────────────────
    rows_traj = con.execute(
        "SELECT h3_r7, date_created FROM venues WHERE is_closed = false"
    ).fetchall()
    traj_map = market_trajectory_bulk(rows_traj)

    # ── Signal 3: Competitive pressure ───────────────────────────────────────
    rows_comp = con.execute(
        "SELECT h3_r7, latitude, longitude, category_label FROM venues WHERE is_closed = false"
    ).fetchall()
    comp_map = competitive_pressure_bulk(rows_comp, target_category=category)

    # ── Signal 4: Ecosystem diversity ────────────────────────────────────────
    entropy_floor = decisions.get("entropy_floor", 0.0)
    rows_div = con.execute(
        "SELECT h3_r7, category_label FROM venues WHERE is_closed = false"
    ).fetchall()
    div_map = ecosystem_diversity_bulk(rows_div, entropy_floor=entropy_floor)

    # ── Signal 5: Risk signals ────────────────────────────────────────────────
    rows_risk = con.execute(
        "SELECT h3_r7, is_closed, date_created FROM venues"
    ).fetchall()
    venue_counts = dict(
        con.execute("SELECT h3_r7, count(*) FROM venues GROUP BY h3_r7").fetchall()
    )
    risk_map = risk_signals_bulk(rows_risk, venue_counts)

    # ── Weighted composite ────────────────────────────────────────────────────
    records = []
    for i, cell in enumerate(cell_ids):
        s1 = float(fp_scores[i])
        s2 = traj_map.get(cell, 0.5)
        s3 = comp_map.get(cell, 1.0)
        s4 = div_map.get(cell, 0.0)
        s5 = risk_map.get(cell, 0.5)

        composite = (
            WEIGHTS["fingerprint"] * s1
            + WEIGHTS["trajectory"]  * s2
            + WEIGHTS["competition"] * s3
            + WEIGHTS["diversity"]   * s4
            + WEIGHTS["risk"]        * s5
        )

        records.append((
            cell,
            category,
            round(composite, 4),
            round(s1, 4),
            round(s2, 4),
            round(s3, 4),
            round(s4, 4),
            round(s5, 4),
        ))

    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Vantage scoring pipeline")
    parser.add_argument(
        "--categories", nargs="+", default=DEFAULT_CATEGORIES,
        help="Category labels to score"
    )
    parser.add_argument("--db", default=str(DEFAULT_DB), help="DuckDB path")
    args = parser.parse_args()

    log.info("═" * 60)
    log.info("  Vantage Scoring Pipeline")
    log.info("  Categories: %s", args.categories)
    log.info("═" * 60)

    decisions = load_decisions()
    con = duckdb.connect(args.db)

    # load TF-IDF vectorizer
    vectorizer = joblib.load(TFIDF_PKL)
    log.info("Loaded TF-IDF vectorizer (%d features)", len(vectorizer.vocabulary_))

    # build suburb TF-IDF matrix from venues
    t0 = time.perf_counter()
    suburb_docs = con.execute("""
        SELECT h3_r7, string_agg(category_label, ' ') AS doc
        FROM venues
        WHERE category_label IS NOT NULL AND is_closed = false
        GROUP BY h3_r7
        HAVING count(*) >= 5
        ORDER BY h3_r7
    """).fetchall()

    cell_ids = [r[0] for r in suburb_docs]
    corpus   = [r[1] for r in suburb_docs]
    log.info("Suburbs to score: %d", len(cell_ids))

    X = vectorizer.transform(corpus)
    suburb_matrix = X.toarray() if hasattr(X, "toarray") else np.array(X)
    log.info("Suburb matrix: %s × %s  (%.1f s)", *suburb_matrix.shape, time.perf_counter() - t0)

    # create / replace suburb_scores table
    con.execute("""
        CREATE OR REPLACE TABLE suburb_scores (
            h3_r7           VARCHAR,
            category        VARCHAR,
            score           DOUBLE,
            score_fingerprint DOUBLE,
            score_trajectory  DOUBLE,
            score_competition DOUBLE,
            score_diversity   DOUBLE,
            score_risk        DOUBLE,
            PRIMARY KEY (h3_r7, category)
        )
    """)

    total_records = 0
    for category in args.categories:
        t_cat = time.perf_counter()
        records = score_category(
            con, category, vectorizer, cell_ids, suburb_matrix, decisions
        )
        con.executemany(
            "INSERT OR REPLACE INTO suburb_scores VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            records,
        )
        log.info("  ✓  %s  —  %d suburbs scored  (%.1f s)",
                 category, len(records), time.perf_counter() - t_cat)
        total_records += len(records)

    con.close()

    log.info("")
    log.info("═" * 60)
    log.info("  SCORING COMPLETE — %d total records written", total_records)
    log.info("═" * 60)


if __name__ == "__main__":
    main()
