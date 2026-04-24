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

# Category → keyword mapping for Foursquare category_label matching.
# Any category not in this dict falls back to category.lower() which
# works for most Foursquare labels ("Bakery" → LIKE '%bakery%').
CATEGORY_KEYWORDS = {
    "Café":              "café",
    "Gym":               "gym",
    "Gym & Fitness":     "gym",
    "Pharmacy":          "pharmacy",
    "Restaurant":        "restaurant",
    "Retail":            "retail",
    "Fast Food":         "fast food",
    "Bar":               "bar",
    "Bakery":            "bakery",
    "Salon & Barbershop": "salon",
    "Dentist":           "dentist",
    "Medical":           "medical",
    "Pet":               "pet",
    "Supermarket":       "supermarket",
    "Automotive":        "automotive",
}


def keyword_for_category(category: str) -> str:
    """Return the SQL LIKE keyword for a category, with dynamic fallback."""
    return CATEGORY_KEYWORDS.get(category, category.lower())


# ── Step 0: Discover categories from the data ─────────────────────────────────

def discover_categories(
    con: duckdb.DuckDBPyConnection,
    min_venues: int = 50,
    max_categories: int = 20,
) -> list[dict]:
    """
    Auto-discover the most common venue categories from the data.

    Returns a list of dicts: [{"name": "Café", "keyword": "café", "venue_count": 1234}, ...]
    Categories must have at least `min_venues` active (non-closed) venues to be included.
    """
    t0 = time.perf_counter()
    log.info("── Discovering categories from venue data ──────────────────")

    # Get the most common category_labels
    rows = con.execute("""
        SELECT category_label, count(*) AS cnt
        FROM venues
        WHERE is_closed = false
          AND category_label IS NOT NULL
          AND length(category_label) >= 3
        GROUP BY category_label
        HAVING count(*) >= ?
        ORDER BY cnt DESC
        LIMIT ?
    """, [min_venues, max_categories * 3]).fetchall()  # fetch extra, we'll deduplicate

    # Deduplicate by keyword (e.g. "Gym" and "Gym & Fitness" both map to "gym")
    seen_keywords: set[str] = set()
    categories: list[dict] = []

    for label, count in rows:
        kw = keyword_for_category(label)
        if kw in seen_keywords:
            continue
        seen_keywords.add(kw)
        categories.append({
            "name": label,
            "keyword": kw,
            "venue_count": count,
        })
        if len(categories) >= max_categories:
            break

    log.info("  Found %d scorable categories (min %d venues each)",
             len(categories), min_venues)
    for c in categories:
        log.info("    %-25s  %5d venues  (keyword: %s)", c["name"], c["venue_count"], c["keyword"])
    log.info("  Discovery took %.1f s", time.perf_counter() - t0)
    return categories


def write_categories_table(
    con: duckdb.DuckDBPyConnection,
    categories: list[dict],
) -> None:
    """Write a categories metadata table for the /categories API endpoint."""
    con.execute("""
        CREATE OR REPLACE TABLE categories (
            name         VARCHAR PRIMARY KEY,
            keyword      VARCHAR,
            venue_count  INTEGER,
            display_order INTEGER
        )
    """)
    for i, c in enumerate(categories):
        con.execute(
            "INSERT INTO categories VALUES (?, ?, ?, ?)",
            [c["name"], c["keyword"], c["venue_count"], i],
        )
    log.info("  Wrote %d categories to categories table", len(categories))


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
        keyword = keyword_for_category(category)

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
    """Assign tier from composite score.

    Note: BETTER_THAN_BEST is never assigned at precompute time because it
    requires client DNA context (benchmark comparison or discovery pathway).
    The runtime /scan endpoint handles BTB assignment.
    """
    if score >= 0.60:
        return "STRONG"
    if score >= 0.40:
        return "WATCH"
    return "AVOID"


def trajectory_status_from_score(score: float, n_buckets: int) -> str:
    if n_buckets < 4:
        return "INSUFFICIENT_DATA"
    if score >= 0.55:
        return "OPEN"
    if score <= 0.45:
        return "CLOSING"
    return "INSUFFICIENT_DATA"


def risk_level_from_score(score: float) -> str:
    if score >= 0.65:
        return "LOW"
    if score >= 0.40:
        return "MEDIUM"
    return "HIGH"


def _recommendation(tier: str, risk_level: str, traj_status: str) -> str:
    if tier == "BETTER_THAN_BEST" and risk_level == "LOW":
        return "Highly recommended — strong DNA match, low risk, open market."
    if tier == "BETTER_THAN_BEST":
        return "Strong opportunity — excellent DNA match. Review risk factors before proceeding."
    if tier == "STRONG" and risk_level == "LOW":
        return "Good opportunity — solid fundamentals and manageable risk."
    if tier == "STRONG":
        return "Proceed with caution — good score but elevated risk."
    if tier == "WATCH":
        return "Monitor closely — marginal scores. Seek lower-risk alternatives first."
    if traj_status == "CLOSING":
        return "Avoid — declining market trajectory compounds structural weaknesses."
    return "Not recommended — poor DNA match or high risk for this category."


def _data_confidence(venue_count: int) -> str:
    if venue_count >= 30:
        return "HIGH"
    if venue_count >= 10:
        return "MEDIUM"
    return "LOW"


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
    from collections import defaultdict

    t0_global = time.perf_counter()
    log.info("── Scoring all suburbs × categories ──────────────────────────")

    # Create suburb_scores table — column order matches live DB schema exactly
    # IF NOT EXISTS preserves data from previous runs; INSERT OR REPLACE below handles upserts
    con.execute("""
        CREATE TABLE IF NOT EXISTS suburb_scores (
            cell_id             VARCHAR,
            category            VARCHAR,
            composite_score     INTEGER,
            tier                VARCHAR,
            fingerprint_score   INTEGER,
            trajectory_score    INTEGER,
            trajectory_status   VARCHAR,
            competition_score   INTEGER,
            competitor_count    INTEGER,
            competitor_pressure DOUBLE,
            n_clusters          INTEGER,
            cluster_gap_description VARCHAR,
            diversity_score     INTEGER,
            risk_score          INTEGER,
            risk_level          VARCHAR,
            top_risk_factors    VARCHAR,
            gold_std_similarity DOUBLE,
            is_better_than_best BOOLEAN,
            data_confidence     VARCHAR,
            venue_count         INTEGER,
            locality            VARCHAR,
            state               VARCHAR,
            lat                 DOUBLE,
            lon                 DOUBLE,
            monthly_series      VARCHAR,
            recommendation      VARCHAR,
            PRIMARY KEY (cell_id, category)
        )
    """)

    # Pre-fetch locality/state/coords/venue_count from suburb_cells
    cell_meta: dict[str, tuple] = {}
    for row in con.execute(
        "SELECT h3_r7, locality, state, venue_count FROM suburb_cells"
    ).fetchall():
        cell_meta[row[0]] = (row[1], row[2], row[3])

    # Pre-fetch avg lat/lon per cell from venues
    cell_coords: dict[str, tuple] = {}
    for row in con.execute(
        "SELECT h3_r7, avg(latitude), avg(longitude) FROM venues "
        "WHERE latitude IS NOT NULL GROUP BY h3_r7"
    ).fetchall():
        cell_coords[row[0]] = (row[1], row[2])

    # Pre-fetch category-independent signals
    log.info("  Fetching venue data for bulk scoring...")
    entropy_floor = decisions.get("entropy_floor", 0.0)
    rows_div = con.execute(
        "SELECT h3_r7, category_label FROM venues WHERE is_closed = false"
    ).fetchall()
    div_map = ecosystem_diversity_bulk(rows_div, entropy_floor=entropy_floor)
    log.info("  Diversity scores: %d cells", len(div_map))

    # Immaturity component of risk (market-level, category-agnostic)
    rows_all_dates = con.execute(
        "SELECT h3_r7, date_created FROM venues WHERE date_created IS NOT NULL"
    ).fetchall()
    all_dates_by_cell: dict[str, list[str]] = defaultdict(list)
    for h3, dt in rows_all_dates:
        all_dates_by_cell[h3].append(dt)

    total_records = 0
    for category in categories:
        t_cat = time.perf_counter()
        gold_vec = gold_vectors.get(category)
        if gold_vec is None:
            gold_vec = suburb_matrix.mean(axis=0).astype(np.float32)
            norm = np.linalg.norm(gold_vec)
            if norm > 0:
                gold_vec = gold_vec / norm

        # Signal 1: Fingerprint match (cosine sim to gold standard)
        fp_scores = fingerprint_match(gold_vec, suburb_matrix)

        # Signal 2: Market trajectory (category-specific)
        keyword = keyword_for_category(category)
        rows_traj = con.execute(
            "SELECT h3_r7, date_created FROM venues "
            "WHERE is_closed = false AND LOWER(category_label) LIKE ?",
            [f"%{keyword}%"]
        ).fetchall()
        traj_map = market_trajectory_bulk(rows_traj)

        # Signal 3: Competitive pressure (category-specific)
        rows_comp = con.execute(
            "SELECT h3_r7, latitude, longitude, category_label FROM venues WHERE is_closed = false"
        ).fetchall()
        comp_map = competitive_pressure_bulk(rows_comp, target_category=category)

        # Signal 5: Risk — category-specific closure + saturation, market-level immaturity
        rows_cat_risk = con.execute(
            "SELECT h3_r7, is_closed, date_created FROM venues "
            "WHERE LOWER(category_label) LIKE ?",
            [f"%{keyword}%"]
        ).fetchall()
        cat_venue_counts = dict(
            con.execute(
                "SELECT h3_r7, count(*) FROM venues "
                "WHERE LOWER(category_label) LIKE ? GROUP BY h3_r7",
                [f"%{keyword}%"]
            ).fetchall()
        )
        # Blend: category closure/saturation + market immaturity
        risk_cat_map = risk_signals_bulk(rows_cat_risk, cat_venue_counts)
        # Immaturity from all venues (market stability signal)
        all_venue_counts = dict(
            con.execute("SELECT h3_r7, count(*) FROM venues GROUP BY h3_r7").fetchall()
        )
        risk_all_map = risk_signals_bulk(
            [(h, False, d) for h, dates in all_dates_by_cell.items() for d in dates],
            all_venue_counts,
        )
        # Competitor count per cell for this category
        competitor_counts: dict[str, int] = dict(
            con.execute(
                "SELECT h3_r7, count(*) FROM venues "
                "WHERE is_closed = false AND LOWER(category_label) LIKE ? GROUP BY h3_r7",
                [f"%{keyword}%"]
            ).fetchall()
        )

        # Monthly creation series for chart data (category-specific)
        monthly_rows = con.execute(
            "SELECT h3_r7, strftime('%Y-%m', date_created::DATE) AS ym, count(*) AS cnt "
            "FROM venues "
            "WHERE is_closed = false AND LOWER(category_label) LIKE ? "
            "  AND date_created IS NOT NULL "
            "GROUP BY h3_r7, ym ORDER BY h3_r7, ym",
            [f"%{keyword}%"]
        ).fetchall()
        monthly_by_cell: dict[str, list[dict]] = defaultdict(list)
        for h3, ym, cnt in monthly_rows:
            monthly_by_cell[h3].append({"month": ym, "count": cnt})

        records = []
        for i, cell in enumerate(cell_ids):
            s1 = float(fp_scores[i])
            s2 = traj_map.get(cell, 0.5)
            s3 = comp_map.get(cell, 1.0)
            s4 = div_map.get(cell, 0.0)
            # Blend category-specific risk (2/3) with market-level immaturity (1/3)
            s5_cat = risk_cat_map.get(cell, 0.5)
            s5_all = risk_all_map.get(cell, 0.5)
            s5 = float(np.clip(0.67 * s5_cat + 0.33 * s5_all, 0.0, 1.0))

            composite = float(np.clip(
                WEIGHTS["fingerprint"] * s1
                + WEIGHTS["trajectory"] * s2
                + WEIGHTS["competition"] * s3
                + WEIGHTS["diversity"] * s4
                + WEIGHTS["risk"] * s5,
                0.0, 1.0,
            ))

            tier = tier_from_score(composite)
            traj_status = (
                "INSUFFICIENT_DATA" if cell not in traj_map
                else trajectory_status_from_score(s2, n_buckets=99)
            )
            rlevel = risk_level_from_score(s5)
            rec = _recommendation(tier, rlevel, traj_status)
            confidence = _data_confidence(cell_meta.get(cell, (None, None, 0))[2] or 0)

            locality, state, vc = cell_meta.get(cell, (None, None, 0))
            lat, lon = cell_coords.get(cell, (None, None))
            comp_count = competitor_counts.get(cell, 0)
            gap_desc = (
                "First-mover opportunity — very few competitors" if comp_count < 3
                else "Moderate competition" if comp_count < 10
                else "High competition density"
            )

            # Risk factors summary
            risk_factors = []
            if s5_cat < 0.5:
                risk_factors.append("High category closure rate")
            if s5_all < 0.5:
                risk_factors.append("Market immaturity")
            if comp_count >= 10:
                risk_factors.append("Dense competition")
            top_risk_json = json.dumps(risk_factors) if risk_factors else None

            # Monthly series as JSON for /location chart
            ms_json = json.dumps(monthly_by_cell.get(cell, [])) if cell in monthly_by_cell else None

            # Scores as integers 0-100. Column order matches CREATE TABLE above.
            # is_better_than_best is always False at precompute time —
            # runtime /scan assigns BTB using the client's DNA context.
            records.append((
                cell, category,
                round(composite * 100),         # composite_score
                tier,                           # tier
                round(s1 * 100),                # fingerprint_score
                round(s2 * 100),                # trajectory_score
                traj_status,                    # trajectory_status
                round(s3 * 100),                # competition_score
                comp_count,                     # competitor_count
                round(s3, 4),                   # competitor_pressure (raw 0-1)
                0,                              # n_clusters (not tracked in bulk)
                gap_desc,                       # cluster_gap_description
                round(s4 * 100),                # diversity_score
                round(s5 * 100),                # risk_score
                rlevel,                         # risk_level
                top_risk_json,                  # top_risk_factors
                round(s1, 4),                   # gold_std_similarity (= fp match to gold)
                False,                          # is_better_than_best
                confidence,                     # data_confidence
                vc or 0,                        # venue_count
                locality, state,                # locality, state
                round(lat, 5) if lat else None, # lat
                round(lon, 5) if lon else None, # lon
                ms_json,                        # monthly_series
                rec,                            # recommendation
            ))

        con.executemany(
            "INSERT OR REPLACE INTO suburb_scores VALUES "
            "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
        "--categories", nargs="+", default=None,
        help="Categories to compute (default: auto-discover from data)",
    )
    parser.add_argument("--db", default=str(DEFAULT_DB), help="DuckDB path")
    parser.add_argument(
        "--min-venues", type=int, default=50,
        help="Minimum venue count for auto-discovered categories",
    )
    parser.add_argument(
        "--max-categories", type=int, default=20,
        help="Maximum number of categories to score",
    )
    args = parser.parse_args()

    decisions = load_decisions()
    con = duckdb.connect(args.db)

    # Load TF-IDF vectorizer
    vectorizer = joblib.load(TFIDF_PKL)
    log.info("Loaded TF-IDF vectorizer (%d features)", len(vectorizer.vocabulary_))

    # Determine categories to score
    if args.categories:
        categories = args.categories
        log.info("Using manually specified categories: %s", categories)
    else:
        discovered = discover_categories(
            con, min_venues=args.min_venues, max_categories=args.max_categories,
        )
        # Merge: ensure DEFAULT_CATEGORIES are always included if they exist in data
        discovered_names = {c["name"] for c in discovered}
        for default_cat in DEFAULT_CATEGORIES:
            if default_cat not in discovered_names:
                kw = keyword_for_category(default_cat)
                count = con.execute(
                    "SELECT count(*) FROM venues WHERE is_closed = false "
                    "AND LOWER(category_label) LIKE ?",
                    [f"%{kw}%"]
                ).fetchone()[0]
                if count >= 10:  # lower threshold for defaults
                    discovered.append({
                        "name": default_cat,
                        "keyword": kw,
                        "venue_count": count,
                    })
        categories = [c["name"] for c in discovered]
        # Write categories table for the API
        write_categories_table(con, discovered)

    log.info("═" * 65)
    log.info("  Vantage Precompute Pipeline")
    log.info("  Categories (%d): %s", len(categories), categories)
    log.info("═" * 65)

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
        con, categories, vectorizer, cell_ids, suburb_matrix,
    )

    # Step 3: Score all suburbs
    score_all_suburbs(
        con, categories, gold_vectors, vectorizer,
        cell_ids, suburb_matrix, decisions,
    )

    con.close()

    log.info("")
    log.info("═" * 65)
    log.info("  PRECOMPUTE COMPLETE")
    log.info("  %d categories × suburbs scored → %s", len(categories), args.db)
    log.info("═" * 65)


if __name__ == "__main__":
    main()
