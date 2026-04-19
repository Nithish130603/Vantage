"""
Foursquare OS Places — Comprehensive EDA
Usage:
    python data/eda.py --places <dir> --categories <dir>
    python data/eda.py --sample          # 50K synthetic rows, no real data needed
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("eda")

DIVIDER = "─" * 72
DECISIONS: dict = {}


# ── helpers ──────────────────────────────────────────────────────────────────

def section(title: str) -> None:
    log.info("")
    log.info(DIVIDER)
    log.info("  %s", title)
    log.info(DIVIDER)


def decision(key: str, value, rationale: str) -> None:
    DECISIONS[key] = value
    log.info("")
    log.info("  PIPELINE DECISION  ▶  %s = %s", key, value)
    log.info("  Rationale: %s", rationale)


def pct(n: int, total: int) -> str:
    return f"{n:,}  ({n / total * 100:.1f}%)" if total else "N/A"


# ── synthetic sample ──────────────────────────────────────────────────────────

SYNTHETIC_CATEGORIES = [
    "Dining and Drinking > Café",
    "Dining and Drinking > Restaurant",
    "Health and Medicine > Pharmacy",
    "Sports and Recreation > Gym",
    "Retail > Supermarket",
    "Dining and Drinking > Bar",
    "Health and Medicine > Hospital",
    "Community and Government > School",
    "Business and Professional Services > Office",
    "Travel and Transportation > Hotel",
]

SYNTHETIC_CATEGORY_IDS = [f"cat_{i:03d}" for i in range(len(SYNTHETIC_CATEGORIES))]


def build_synthetic(con: duckdb.DuckDBPyConnection, n: int = 50_000) -> None:
    log.info("Generating %s synthetic rows …", f"{n:,}")
    con.execute("""
        CREATE OR REPLACE TABLE places AS
        WITH ids AS (
            SELECT (row_number() OVER ()) AS rn
            FROM range(?)
        )
        SELECT
            printf('fsq_%08d', rn)                                   AS fsq_place_id,
            'Place ' || rn                                           AS name,
            -43.0 + random() * 16.0                                  AS latitude,
            113.0 + random() * 41.0                                  AS longitude,
            'Street ' || rn                                          AS address,
            CASE (rn % 10)
                WHEN 0 THEN 'Sydney'    WHEN 1 THEN 'Melbourne'
                WHEN 2 THEN 'Brisbane'  WHEN 3 THEN 'Perth'
                WHEN 4 THEN 'Adelaide'  WHEN 5 THEN 'Canberra'
                WHEN 6 THEN 'Hobart'    WHEN 7 THEN 'Darwin'
                WHEN 8 THEN 'Gold Coast'
                ELSE 'Newcastle'
            END                                                      AS locality,
            CASE (rn % 8)
                WHEN 0 THEN 'New South Wales'
                WHEN 1 THEN 'Victoria'
                WHEN 2 THEN 'Queensland'
                WHEN 3 THEN 'Western Australia'
                WHEN 4 THEN 'South Australia'
                WHEN 5 THEN 'Australian Capital Territory'
                WHEN 6 THEN 'Tasmania'
                ELSE 'Northern Territory'
            END                                                      AS region,
            printf('%04d', (rn % 9000) + 1000)                      AS postcode,
            'AU'                                                     AS country,
            -- date_created spans 2015–2025
            (DATE '2015-01-01' + (random() * 3650)::INT)::VARCHAR    AS date_created,
            -- date_refreshed: 70% within last 2 years, 30% older
            CASE WHEN random() < 0.7
                THEN (DATE '2024-01-01' + (random() * 730)::INT)::VARCHAR
                ELSE (DATE '2019-01-01' + (random() * 1825)::INT)::VARCHAR
            END                                                      AS date_refreshed,
            -- date_closed: only 6% of rows
            CASE WHEN random() < 0.06
                THEN (DATE '2020-01-01' + (random() * 1825)::INT)::VARCHAR
                ELSE NULL
            END                                                      AS date_closed,
            -- category label from synthetic list
            ['Dining and Drinking > Café',
             'Dining and Drinking > Restaurant',
             'Health and Medicine > Pharmacy',
             'Sports and Recreation > Gym',
             'Retail > Supermarket',
             'Dining and Drinking > Bar',
             'Health and Medicine > Hospital',
             'Community and Government > School',
             'Business and Professional Services > Office',
             'Travel and Transportation > Hotel'][(rn % 10) + 1]    AS fsq_category_labels,
            ['cat_000','cat_001','cat_002','cat_003','cat_004',
             'cat_005','cat_006','cat_007','cat_008','cat_009'][(rn % 10) + 1]
                                                                     AS fsq_category_ids,
            -- unresolved_flags: 8% have a flag
            CASE WHEN random() < 0.08
                THEN ['closed','move','duplicate','private'][(rn % 4) + 1]
                ELSE NULL
            END                                                      AS unresolved_flags
        FROM ids
    """, [n])

    con.execute("""
        CREATE OR REPLACE TABLE categories AS
        SELECT
            unnest(['cat_000','cat_001','cat_002','cat_003','cat_004',
                    'cat_005','cat_006','cat_007','cat_008','cat_009']) AS category_id,
            unnest(['Dining and Drinking > Café',
                    'Dining and Drinking > Restaurant',
                    'Health and Medicine > Pharmacy',
                    'Sports and Recreation > Gym',
                    'Retail > Supermarket',
                    'Dining and Drinking > Bar',
                    'Health and Medicine > Hospital',
                    'Community and Government > School',
                    'Business and Professional Services > Office',
                    'Travel and Transportation > Hotel'])              AS category_label,
            unnest([2,2,3,3,2,2,2,2,3,2])                            AS category_level
    """)

    total = con.execute("SELECT count(*) FROM places").fetchone()[0]
    log.info("Synthetic data ready: %s rows", f"{total:,}")


def load_real(
    con: duckdb.DuckDBPyConnection,
    places_dir: str,
    categories_dir: str,
) -> None:
    log.info("Loading places from  %s", places_dir)
    con.execute(f"""
        CREATE OR REPLACE TABLE places AS
        SELECT * FROM read_parquet('{places_dir}/*.parquet', hive_partitioning=false)
    """)
    log.info("Loading categories from %s", categories_dir)
    con.execute(f"""
        CREATE OR REPLACE TABLE categories AS
        SELECT * FROM read_parquet('{categories_dir}/*.parquet', hive_partitioning=false)
    """)
    total = con.execute("SELECT count(*) FROM places").fetchone()[0]
    log.info("Loaded %s place rows", f"{total:,}")


# ── analysis sections ─────────────────────────────────────────────────────────

def s1_shape(con: duckdb.DuckDBPyConnection) -> None:
    section("1 / 11  Shape and Country Coverage")
    total = con.execute("SELECT count(*) FROM places").fetchone()[0]
    log.info("Total rows: %s", f"{total:,}")

    countries = con.execute("""
        SELECT country, count(*) AS n
        FROM places
        GROUP BY country
        ORDER BY n DESC
        LIMIT 15
    """).fetchall()

    log.info("Top countries:")
    for c, n in countries:
        log.info("  %-30s  %s", c or "(null)", pct(n, total))

    au_rows = con.execute(
        "SELECT count(*) FROM places WHERE country = 'AU'"
    ).fetchone()[0]

    decision(
        "au_row_count",
        au_rows,
        f"AU venues = {au_rows:,}  ({au_rows / total * 100:.1f}% of dataset). "
        "All scoring and embeddings are AU-only.",
    )


def s2_schema(con: duckdb.DuckDBPyConnection) -> None:
    section("2 / 11  Schema Validation")
    expected = [
        "fsq_place_id", "name", "latitude", "longitude",
        "address", "locality", "region", "postcode", "country",
        "date_created", "date_refreshed", "date_closed",
        "fsq_category_ids", "fsq_category_labels", "unresolved_flags",
    ]
    actual_cols = {r[0] for r in con.execute("DESCRIBE places").fetchall()}
    missing = [c for c in expected if c not in actual_cols]
    extra = sorted(actual_cols - set(expected))

    if missing:
        log.warning("MISSING columns: %s", missing)
    else:
        log.info("All %d expected columns present.", len(expected))
    if extra:
        log.info("Additional columns (not required): %s", extra)

    decision(
        "schema_ok",
        len(missing) == 0,
        "Pipeline can proceed when schema_ok=True. "
        f"Missing={missing}, Extra columns available={extra[:5]}",
    )


def s3_nulls(con: duckdb.DuckDBPyConnection) -> None:
    section("3 / 11  Null Map on Critical Columns")
    total = con.execute("SELECT count(*) FROM places").fetchone()[0]
    critical = ["latitude", "longitude", "fsq_category_labels", "date_created"]
    log.info("%-30s  %10s  %s", "column", "null_count", "pct")
    null_pcts = {}
    for col in critical:
        n = con.execute(
            f"SELECT count(*) FROM places WHERE {col} IS NULL"
        ).fetchone()[0]
        null_pcts[col] = round(n / total * 100, 2) if total else 0
        log.info("  %-28s  %10s  %.2f%%", col, f"{n:,}", null_pcts[col])

    worst = max(null_pcts, key=null_pcts.get)
    decision(
        "max_null_pct_critical",
        null_pcts[worst],
        f"Highest null rate on critical column is '{worst}' at {null_pcts[worst]:.2f}%. "
        "Rows where lat/lon/category are null will be dropped in the ETL.",
    )


def s4_dates(con: duckdb.DuckDBPyConnection) -> None:
    section("4 / 11  Date Field Analysis")
    total = con.execute("SELECT count(*) FROM places").fetchone()[0]

    date_range = con.execute("""
        SELECT
            min(date_created)        AS created_min,
            max(date_created)        AS created_max,
            count(date_closed)       AS has_closed,
            count(date_refreshed)    AS has_refreshed
        FROM places
    """).fetchone()
    created_min, created_max, has_closed, has_refreshed = date_range

    log.info("date_created range:  %s  →  %s", created_min, created_max)
    log.info("date_closed coverage: %s", pct(has_closed, total))
    log.info("date_refreshed coverage: %s", pct(has_refreshed, total))

    today = datetime.now(timezone.utc).date()
    stale_2yr = con.execute(f"""
        SELECT count(*) FROM places
        WHERE date_refreshed IS NOT NULL
          AND TRY_CAST(date_refreshed AS DATE) < DATE '{today}' - INTERVAL 2 YEAR
    """).fetchone()[0]
    log.info("Stale (refreshed >2yr ago): %s", pct(stale_2yr, total))

    closed_pct = round(has_closed / total * 100, 2) if total else 0
    decision(
        "closure_label_coverage_pct",
        closed_pct,
        f"Only {closed_pct:.2f}% of venues have date_closed. "
        "Too sparse for a supervised classifier — use unsupervised risk signals instead.",
    )

    stale_threshold = "2 years"
    decision(
        "staleness_threshold",
        stale_threshold,
        f"{stale_2yr:,} venues ({stale_2yr/total*100:.1f}%) last refreshed >2yr ago. "
        "Mark these is_stale=True in ETL; downweight in risk signal.",
    )


def s5_categories(con: duckdb.DuckDBPyConnection) -> None:
    section("5 / 11  Category Distribution (Top 30)")
    total = con.execute("SELECT count(*) FROM places").fetchone()[0]

    top30 = con.execute("""
        SELECT fsq_category_labels AS cat, count(*) AS n
        FROM places
        WHERE fsq_category_labels IS NOT NULL
        GROUP BY cat
        ORDER BY n DESC
        LIMIT 30
    """).fetchall()

    log.info("%-50s  %10s  %s", "category", "count", "pct")
    for cat, n in top30:
        short = (cat or "")[:48]
        log.info("  %-48s  %10s  %.2f%%", short, f"{n:,}", n / total * 100)

    # Check key franchise categories
    for keyword in ("Gym", "Café", "Cafe", "Pharmacy"):
        n = con.execute(
            "SELECT count(*) FROM places WHERE fsq_category_labels ILIKE ?",
            [f"%{keyword}%"],
        ).fetchone()[0]
        log.info("  Keyword '%s' match: %s", keyword, pct(n, total))

    n_cats = con.execute(
        "SELECT count(DISTINCT fsq_category_labels) FROM places"
    ).fetchone()[0]
    decision(
        "distinct_category_labels",
        n_cats,
        f"Dataset has {n_cats} distinct category_label strings. "
        "TF-IDF vocabulary size will be bounded by this; "
        "expect ~100–400 meaningful tokens after stopword removal.",
    )


def s6_survival(con: duckdb.DuckDBPyConnection) -> None:
    section("6 / 11  Survival Data Quality (Closure Signal per Category)")
    top_cats = con.execute("""
        SELECT fsq_category_labels AS cat, count(*) AS total,
               count(date_closed)  AS closed
        FROM places
        WHERE fsq_category_labels IS NOT NULL
        GROUP BY cat
        ORDER BY total DESC
        LIMIT 15
    """).fetchall()

    log.info("%-48s  %8s  %8s  %6s", "category", "total", "closed", "pct")
    min_coverage = 100.0
    for cat, total, closed in top_cats:
        pct_closed = closed / total * 100 if total else 0
        min_coverage = min(min_coverage, pct_closed)
        short = (cat or "")[:46]
        log.info("  %-46s  %8s  %8s  %5.1f%%", short, f"{total:,}", f"{closed:,}", pct_closed)

    decision(
        "use_closure_classifier",
        False,
        "Closure label coverage is too low (<10% across all top categories) "
        "to train a reliable supervised classifier. "
        "Risk signals will use closure_rate = closed/total as a statistical proxy.",
    )


def s7_flags(con: duckdb.DuckDBPyConnection) -> None:
    section("7 / 11  Unresolved Flags Analysis")
    total = con.execute("SELECT count(*) FROM places").fetchone()[0]

    flag_counts = con.execute("""
        SELECT unresolved_flags, count(*) AS n
        FROM places
        WHERE unresolved_flags IS NOT NULL
        GROUP BY unresolved_flags
        ORDER BY n DESC
        LIMIT 20
    """).fetchall()

    flagged = con.execute(
        "SELECT count(*) FROM places WHERE unresolved_flags IS NOT NULL"
    ).fetchone()[0]
    log.info("Total flagged rows: %s", pct(flagged, total))
    log.info("%-30s  %10s", "flag_value", "count")
    for flag, n in flag_counts:
        log.info("  %-28s  %10s", str(flag)[:28], f"{n:,}")

    decision(
        "filter_unresolved_flags",
        True,
        f"{flagged:,} rows ({flagged/total*100:.1f}%) have unresolved_flags. "
        "ETL will set is_stale=True for these; they are excluded from scoring "
        "but retained in the database for completeness.",
    )


def s8_geo(con: duckdb.DuckDBPyConnection) -> None:
    section("8 / 11  Geographic Density")
    total_au = con.execute(
        "SELECT count(*) FROM places WHERE country = 'AU'"
    ).fetchone()[0]

    bounds = con.execute("""
        SELECT min(latitude), max(latitude), min(longitude), max(longitude)
        FROM places WHERE country = 'AU'
          AND latitude BETWEEN -44 AND -10
          AND longitude BETWEEN 113 AND 154
    """).fetchone()
    log.info("AU coordinate bounds: lat [%.2f, %.2f]  lon [%.2f, %.2f]", *bounds)

    out_of_bounds = con.execute("""
        SELECT count(*) FROM places
        WHERE country = 'AU'
          AND (latitude NOT BETWEEN -44 AND -10
            OR longitude NOT BETWEEN 113 AND 154)
    """).fetchone()[0]
    log.info("AU rows with suspect coordinates: %s", pct(out_of_bounds, total_au))

    top_localities = con.execute("""
        SELECT locality, count(*) AS n
        FROM places WHERE country = 'AU' AND locality IS NOT NULL
        GROUP BY locality
        ORDER BY n DESC
        LIMIT 10
    """).fetchall()
    log.info("Top AU localities:")
    for loc, n in top_localities:
        log.info("  %-30s  %s", loc, pct(n, total_au))

    decision(
        "coordinate_filter",
        {"lat_min": -44, "lat_max": -10, "lon_min": 113, "lon_max": 154},
        f"{out_of_bounds:,} AU rows fall outside the mainland+Tasmania bounding box "
        "and will be dropped in the ETL geospatial filter.",
    )


def s9_duplicates(con: duckdb.DuckDBPyConnection) -> None:
    section("9 / 11  Duplicate Check")
    total = con.execute("SELECT count(*) FROM places").fetchone()[0]

    id_dups = con.execute("""
        SELECT count(*) FROM (
            SELECT fsq_place_id FROM places
            GROUP BY fsq_place_id HAVING count(*) > 1
        )
    """).fetchone()[0]
    log.info("fsq_place_id duplicates (groups): %s", f"{id_dups:,}")

    coord_dups = con.execute("""
        SELECT count(*) FROM (
            SELECT latitude, longitude FROM places
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            GROUP BY latitude, longitude HAVING count(*) > 1
        )
    """).fetchone()[0]
    log.info("Coordinate-pair duplicates (groups): %s", f"{coord_dups:,}")

    decision(
        "dedup_strategy",
        "keep_latest_refreshed",
        f"{id_dups:,} fsq_place_id duplicate groups detected. "
        "ETL will keep the row with the latest date_refreshed per fsq_place_id. "
        f"Coordinate duplicates ({coord_dups:,} groups) are expected "
        "(co-located venues) and are not deduplicated.",
    )


def s10_umap(con: duckdb.DuckDBPyConnection) -> None:
    section("10 / 11  UMAP Feasibility")

    # Estimate H3-7 cell count: ~5 km² cells across AU
    # Use distinct (lat_bucket, lon_bucket) at ~0.05° resolution as proxy
    approx_h3_cells = con.execute("""
        SELECT count(DISTINCT (
            (latitude * 20)::INT,
            (longitude * 20)::INT
        )) AS approx_cells
        FROM places
        WHERE country = 'AU'
          AND latitude IS NOT NULL AND longitude IS NOT NULL
    """).fetchone()[0]
    log.info("Approx distinct H3-7 cells (proxy): %s", f"{approx_h3_cells:,}")

    n_cats = con.execute(
        "SELECT count(DISTINCT fsq_category_labels) FROM places WHERE country='AU'"
    ).fetchone()[0]
    log.info("Category label dimensions (TF-IDF width): ~%s", n_cats)

    mem_mb = approx_h3_cells * n_cats * 4 / 1e6  # float32
    log.info("Dense TF-IDF matrix estimate: %.0f MB  (%s cells × %s dims)", mem_mb, approx_h3_cells, n_cats)

    feasible = approx_h3_cells < 100_000
    decision(
        "umap_feasible",
        feasible,
        f"~{approx_h3_cells:,} suburb cells × ~{n_cats} TF-IDF dims. "
        "Sparse TF-IDF + UMAP(n_components=2, n_neighbors=15) fits in RAM. "
        f"Dense matrix ~{mem_mb:.0f} MB — use scipy sparse to avoid materialising it.",
    )

    decision(
        "tfidf_max_features",
        min(n_cats, 500),
        "Cap TF-IDF vocabulary at min(distinct_categories, 500) to keep "
        "UMAP training fast while retaining all meaningful category signal.",
    )


def s11_h3_resolution(con: duckdb.DuckDBPyConnection) -> None:
    section("11 / 11  H3 Resolution Decision")

    # Count venues in AU to guide resolution choice
    au_count = con.execute(
        "SELECT count(*) FROM places WHERE country='AU'"
    ).fetchone()[0]

    log.info("AU venue count: %s", f"{au_count:,}")
    log.info("")
    log.info("  H3 Resolution Comparison:")
    log.info("  %-8s  %-12s  %-14s  %-40s", "res", "cell_area", "~AU_cells", "notes")

    resolutions = [
        (6,  "~36 km²",  "~3 000",    "Too coarse — large cities merge into 1 cell"),
        (7,  "~5 km²",   "~20 000",   "✓ Suburb-level granularity; UMAP tractable"),
        (8,  "~0.7 km²", "~140 000",  "Fine-grained; thin coverage in rural AU"),
        (9,  "~0.1 km²", "~1 000 000","Too sparse; most cells have 0 venues"),
    ]
    for res, area, cells, notes in resolutions:
        log.info("  %-8s  %-12s  %-14s  %-40s", res, area, cells, notes)

    log.info("")
    log.info("  Venue density at res-7: ~%.1f venues/cell (AU)", au_count / 20_000)
    log.info("  Venue density at res-8: ~%.1f venues/cell (AU)", au_count / 140_000)

    decision(
        "h3_resolution",
        7,
        "Resolution 7 (~5 km²) gives suburb-level granularity with ~20K AU cells, "
        f"averaging ~{au_count//20000} venues/cell. "
        "Res-8 is too sparse for reliable TF-IDF and UMAP in rural areas. "
        "Res-6 loses intra-city differentiation needed for franchise site selection.",
    )

    decision(
        "min_venues_per_cell",
        5,
        "Cells with fewer than 5 venues produce unreliable TF-IDF vectors. "
        "These are excluded from UMAP fitting and scoring but shown on the map "
        "with a 'sparse data' indicator.",
    )


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Foursquare EDA")
    parser.add_argument("--places",     default=None, help="Path to places parquet directory")
    parser.add_argument("--categories", default=None, help="Path to categories parquet directory")
    parser.add_argument("--sample",     action="store_true", help="Use 50K synthetic rows")
    parser.add_argument("--sample-n",   type=int, default=50_000)
    parser.add_argument(
        "--output",
        default=str(Path(__file__).parent / "eda_decisions.json"),
        help="Path to write decisions JSON",
    )
    args = parser.parse_args()

    if not args.sample and (args.places is None or args.categories is None):
        parser.error("Provide --places and --categories, or use --sample")

    con = duckdb.connect()

    if args.sample:
        build_synthetic(con, n=args.sample_n)
    else:
        places_glob = str(Path(args.places) / "*.parquet")
        cats_glob   = str(Path(args.categories) / "*.parquet")
        load_real(con, str(Path(args.places)), str(Path(args.categories)))

    s1_shape(con)
    s2_schema(con)
    s3_nulls(con)
    s4_dates(con)
    s5_categories(con)
    s6_survival(con)
    s7_flags(con)
    s8_geo(con)
    s9_duplicates(con)
    s10_umap(con)
    s11_h3_resolution(con)

    # ── write decisions ───────────────────────────────────────────────────────
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(DECISIONS, f, indent=2, default=str)
    log.info("")
    log.info(DIVIDER)
    log.info("  DECISIONS WRITTEN → %s", output_path)
    log.info(DIVIDER)

    # ── final summary ─────────────────────────────────────────────────────────
    log.info("")
    log.info("  FINAL DECISION SUMMARY")
    log.info(DIVIDER)
    for k, v in DECISIONS.items():
        log.info("  %-35s  %s", k, v)
    log.info(DIVIDER)
    log.info("")
    log.info("EDA complete. Next step: python data/pipeline.py")


if __name__ == "__main__":
    main()
