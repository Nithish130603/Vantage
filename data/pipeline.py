"""
Vantage data pipeline — ingest → clean → H3 → TF-IDF → UMAP → DuckDB

Produces:
    backend/vantage.duckdb
    backend/tfidf.pkl
    backend/reducer.pkl        (absent when --skip-umap)
    data/pipeline_run.json     (audit log)

Usage:
    python data/pipeline.py --sample --skip-umap    # fast dev loop (~30 s)
    python data/pipeline.py --sample --metro        # Sydney only (~3 min with UMAP)
    python data/pipeline.py \\
        --places  data/fsq-raw/release/dt=2026-02-12/places/parquet \\
        --categories data/fsq-raw/release/dt=2026-02-12/categories/parquet
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import h3
import joblib
import numpy as np
from scipy.sparse import issparse
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from tqdm import tqdm
from umap import UMAP


# ── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pipeline")

# ── paths ─────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"
BACKEND_DIR = ROOT / "backend"
DECISIONS_PATH = DATA_DIR / "eda_decisions.json"

BACKEND_DIR.mkdir(parents=True, exist_ok=True)

AUDIT: dict = {}


# ── helpers ───────────────────────────────────────────────────────────────────

def tick(label: str) -> float:
    t = time.perf_counter()
    AUDIT.setdefault("timings", {})[label] = {"start": time.time()}
    return t


def tock(label: str, t0: float) -> float:
    elapsed = time.perf_counter() - t0
    AUDIT["timings"][label]["elapsed_s"] = round(elapsed, 2)
    log.info("  ✓  %s  (%.1f s)", label, elapsed)
    return elapsed


def load_decisions() -> dict:
    if not DECISIONS_PATH.exists():
        raise FileNotFoundError(
            f"eda_decisions.json not found at {DECISIONS_PATH}. "
            "Run: python data/eda.py --sample"
        )
    with open(DECISIONS_PATH) as f:
        d = json.load(f)
    log.info("Loaded %d decisions from %s", len(d), DECISIONS_PATH)
    return d


# ── non-commercial category prefixes to exclude ───────────────────────────────
NON_COMMERCIAL_PREFIXES = (
    "Community and Government",
    "Landmarks and Outdoors",
    "Event",
    "No Category",
)

# unresolved flag values that mean the venue is invalid/deleted
INVALID_FLAGS = {"deleted", "private", "privatevenue", "doesnt_exist", "duplicate"}

# Sydney metro bounding box for --metro fast mode
SYDNEY_BBOX = {"lat_min": -34.2, "lat_max": -33.4, "lon_min": 150.5, "lon_max": 151.4}


# ── step 1: load ──────────────────────────────────────────────────────────────

def step_load(
    con: duckdb.DuckDBPyConnection,
    places_dir: str | None,
    categories_dir: str | None,
    sample: bool,
    sample_n: int,
) -> int:
    t0 = tick("load")
    log.info("── Step 1 / 9  Load ──────────────────────────────────────────")

    if sample:
        log.info("Generating %s synthetic rows …", f"{sample_n:,}")
        _build_synthetic(con, sample_n)
    else:
        # Load directly with AU filter + array normalisation in one pass.
        # Avoids materialising 106M global rows before filtering.
        log.info("Loading places parquet (AU only, arrays → scalars) from %s", places_dir)
        con.execute(f"""
            CREATE OR REPLACE TABLE raw_places AS
            SELECT
                fsq_place_id, name, latitude, longitude,
                address, locality, region, postcode, country,
                date_created, date_refreshed, date_closed,
                fsq_category_labels[1]  AS fsq_category_labels,
                fsq_category_ids[1]     AS fsq_category_ids,
                unresolved_flags[1]     AS unresolved_flags
            FROM read_parquet('{places_dir}/*.parquet', hive_partitioning=false)
            WHERE country = 'AU'
        """)
        log.info("Loading categories parquet from %s", categories_dir)
        con.execute(f"""
            CREATE OR REPLACE TABLE raw_categories AS
            SELECT * FROM read_parquet('{categories_dir}/*.parquet', hive_partitioning=false)
        """)

    n = con.execute("SELECT count(*) FROM raw_places").fetchone()[0]
    log.info("Loaded %s rows", f"{n:,}")
    AUDIT["raw_row_count"] = n
    tock("load", t0)
    return n


def _build_synthetic(con: duckdb.DuckDBPyConnection, n: int) -> None:
    # Coordinates clustered ±0.3° around each city centre so H3-7 cells
    # (~5 km²) receive enough venues to pass min_venues_per_cell.
    con.execute("""
        CREATE OR REPLACE TABLE raw_places AS
        WITH ids AS (SELECT (row_number() OVER ()) AS rn FROM range(?))
        SELECT
            printf('fsq_%08d', rn)                                   AS fsq_place_id,
            'Place ' || rn                                           AS name,
            -- city-clustered coordinates (±0.3° spread ≈ ±33 km)
            CASE (rn % 10)
                WHEN 0 THEN -33.87 + (random()-0.5)*0.6   -- Sydney
                WHEN 1 THEN -37.81 + (random()-0.5)*0.6   -- Melbourne
                WHEN 2 THEN -27.47 + (random()-0.5)*0.6   -- Brisbane
                WHEN 3 THEN -31.95 + (random()-0.5)*0.6   -- Perth
                WHEN 4 THEN -34.93 + (random()-0.5)*0.6   -- Adelaide
                WHEN 5 THEN -35.28 + (random()-0.5)*0.4   -- Canberra
                WHEN 6 THEN -42.88 + (random()-0.5)*0.3   -- Hobart
                WHEN 7 THEN -12.46 + (random()-0.5)*0.3   -- Darwin
                WHEN 8 THEN -28.02 + (random()-0.5)*0.4   -- Gold Coast
                ELSE       -32.93 + (random()-0.5)*0.4    -- Newcastle
            END                                                      AS latitude,
            CASE (rn % 10)
                WHEN 0 THEN 151.21 + (random()-0.5)*0.6   -- Sydney
                WHEN 1 THEN 144.96 + (random()-0.5)*0.6   -- Melbourne
                WHEN 2 THEN 153.02 + (random()-0.5)*0.5   -- Brisbane
                WHEN 3 THEN 115.86 + (random()-0.5)*0.5   -- Perth
                WHEN 4 THEN 138.60 + (random()-0.5)*0.5   -- Adelaide
                WHEN 5 THEN 149.13 + (random()-0.5)*0.3   -- Canberra
                WHEN 6 THEN 147.33 + (random()-0.5)*0.2   -- Hobart
                WHEN 7 THEN 130.84 + (random()-0.5)*0.2   -- Darwin
                WHEN 8 THEN 153.40 + (random()-0.5)*0.3   -- Gold Coast
                ELSE       151.78 + (random()-0.5)*0.3    -- Newcastle
            END                                                      AS longitude,
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
            (DATE '2015-01-01' + (random() * 3650)::INT)::VARCHAR    AS date_created,
            CASE WHEN random() < 0.7
                THEN (DATE '2024-01-01' + (random() * 730)::INT)::VARCHAR
                ELSE (DATE '2019-01-01' + (random() * 1825)::INT)::VARCHAR
            END                                                      AS date_refreshed,
            CASE WHEN random() < 0.06
                THEN (DATE '2020-01-01' + (random() * 1825)::INT)::VARCHAR
                ELSE NULL
            END                                                      AS date_closed,
            ['Dining and Drinking > Café',
             'Dining and Drinking > Restaurant',
             'Dining and Drinking > Bar',
             'Health and Medicine > Pharmacy',
             'Health and Medicine > Medical Center',
             'Sports and Recreation > Gym',
             'Retail > Supermarket',
             'Retail > Clothing Store',
             'Business and Professional Services > Office',
             'Travel and Transportation > Hotel',
             'Dining and Drinking > Fast Food Restaurant',
             'Sports and Recreation > Yoga Studio',
             'Retail > Electronics Store',
             'Dining and Drinking > Pizza Place',
             'Health and Medicine > Dentist'][(rn % 15) + 1]        AS fsq_category_labels,
            ['cat_000','cat_001','cat_002','cat_003','cat_004',
             'cat_005','cat_006','cat_007','cat_008','cat_009',
             'cat_010','cat_011','cat_012','cat_013','cat_014'][(rn % 15) + 1]
                                                                     AS fsq_category_ids,
            CASE WHEN random() < 0.06
                THEN ['deleted','private','move','closed'][(rn % 4) + 1]
                ELSE NULL
            END                                                      AS unresolved_flags
        FROM ids
    """, [n])


# ── step 2: filter to Australia ───────────────────────────────────────────────

def step_filter_au(
    con: duckdb.DuckDBPyConnection,
    bbox: dict,
    metro: bool,
    region: str | None = None,
) -> int:
    t0 = tick("filter_au")
    log.info("── Step 2 / 9  Filter to Australia ──────────────────────────")

    active_bbox = SYDNEY_BBOX if metro else bbox
    if metro:
        log.info("Metro mode: Sydney bbox %s", active_bbox)

    region_clause = ""
    if region:
        # Foursquare data has inconsistent region strings ('NSW', 'New South Wales',
        # 'NSW, Australia', 'nsw', etc.) — normalise with UPPER+TRIM and match
        # on primary abbreviation and full name.
        abbr = region.upper()
        state_names = {
            "NSW": ("NSW", "NEW SOUTH WALES"),
            "VIC": ("VIC", "VICTORIA"),
            "QLD": ("QLD", "QUEENSLAND"),
            "WA":  ("WA",  "WESTERN AUSTRALIA"),
            "SA":  ("SA",  "SOUTH AUSTRALIA"),
            "TAS": ("TAS", "TASMANIA"),
            "ACT": ("ACT", "AUSTRALIAN CAPITAL TERRITORY"),
            "NT":  ("NT",  "NORTHERN TERRITORY"),
        }
        variants = state_names.get(abbr, (abbr,))
        conditions = " OR ".join(
            f"UPPER(TRIM(region)) LIKE '{v}%'" for v in variants
        )
        region_clause = f"AND ({conditions})"
        log.info("Region filter: %s  (variants: %s)", region, variants)

    con.execute(f"""
        CREATE OR REPLACE TABLE au_places AS
        SELECT * FROM raw_places
        WHERE country = 'AU'
          AND latitude  BETWEEN ? AND ?
          AND longitude BETWEEN ? AND ?
          {region_clause}
    """, [
        active_bbox["lat_min"], active_bbox["lat_max"],
        active_bbox["lon_min"], active_bbox["lon_max"],
    ])

    n = con.execute("SELECT count(*) FROM au_places").fetchone()[0]
    log.info("AU rows after filter: %s", f"{n:,}")
    AUDIT["au_row_count"] = n
    tock("filter_au", t0)
    return n


# ── step 3: clean ─────────────────────────────────────────────────────────────

def step_clean(con: duckdb.DuckDBPyConnection) -> int:
    t0 = tick("clean")
    log.info("── Step 3 / 9  Clean ─────────────────────────────────────────")

    before = con.execute("SELECT count(*) FROM au_places").fetchone()[0]

    # drop nulls on critical columns
    con.execute("""
        CREATE OR REPLACE TABLE clean_places AS
        SELECT * FROM au_places
        WHERE latitude          IS NOT NULL
          AND longitude         IS NOT NULL
          AND fsq_category_labels IS NOT NULL
          AND date_created      IS NOT NULL
    """)
    after_nulls = con.execute("SELECT count(*) FROM clean_places").fetchone()[0]
    log.info("After null drop: %s  (-%s)", f"{after_nulls:,}", f"{before - after_nulls:,}")

    # exclude invalid flag types
    invalid_flag_list = ", ".join(f"'{f}'" for f in sorted(INVALID_FLAGS))
    con.execute(f"""
        CREATE OR REPLACE TABLE clean_places AS
        SELECT * FROM clean_places
        WHERE unresolved_flags IS NULL
           OR lower(unresolved_flags) NOT IN ({invalid_flag_list})
    """)
    after_flags = con.execute("SELECT count(*) FROM clean_places").fetchone()[0]
    log.info("After flag exclusion: %s  (-%s)", f"{after_flags:,}", f"{after_nulls - after_flags:,}")

    # exclude non-commercial categories
    prefix_conditions = " OR ".join(
        f"fsq_category_labels LIKE '{p}%'"
        for p in NON_COMMERCIAL_PREFIXES
    )
    con.execute(f"""
        CREATE OR REPLACE TABLE clean_places AS
        SELECT * FROM clean_places
        WHERE NOT ({prefix_conditions})
    """)
    after_cats = con.execute("SELECT count(*) FROM clean_places").fetchone()[0]
    log.info("After non-commercial exclusion: %s  (-%s)", f"{after_cats:,}", f"{after_flags - after_cats:,}")

    # deduplicate on fsq_place_id keeping most-recently refreshed
    con.execute("""
        CREATE OR REPLACE TABLE clean_places AS
        SELECT * FROM (
            SELECT *,
                   row_number() OVER (
                       PARTITION BY fsq_place_id
                       ORDER BY TRY_CAST(date_refreshed AS DATE) DESC NULLS LAST
                   ) AS rn
            FROM clean_places
        ) WHERE rn = 1
    """)
    after_dedup = con.execute("SELECT count(*) FROM clean_places").fetchone()[0]
    log.info("After dedup: %s  (-%s)", f"{after_dedup:,}", f"{after_cats - after_dedup:,}")

    # mark is_closed and is_stale
    con.execute("""
        CREATE OR REPLACE TABLE clean_places AS
        SELECT *,
               (date_closed IS NOT NULL)                                       AS is_closed,
               (unresolved_flags IS NOT NULL
                OR TRY_CAST(date_refreshed AS DATE)
                       < CURRENT_DATE - INTERVAL 2 YEAR)                      AS is_stale,
               -- label for scoring pipeline (strip hierarchy, keep leaf)
               regexp_replace(fsq_category_labels, '^.* > ', '')              AS category_label
        FROM clean_places
    """)

    n = con.execute("SELECT count(*) FROM clean_places").fetchone()[0]
    AUDIT["clean_row_count"] = n
    log.info("Clean venues total: %s", f"{n:,}")
    tock("clean", t0)
    return n


# ── step 4: H3 indexes ────────────────────────────────────────────────────────

def step_h3(
    con: duckdb.DuckDBPyConnection,
    res7: int,
    res8: int,
) -> None:
    t0 = tick("h3")
    log.info("── Step 4 / 9  H3 Indexes (res-%d / res-%d) ─────────────────", res7, res8)

    rows = con.execute(
        "SELECT fsq_place_id, latitude, longitude FROM clean_places"
    ).fetchall()

    log.info("Computing H3 indexes for %s venues …", f"{len(rows):,}")
    h3_data = []
    for fsq_place_id, lat, lon in tqdm(rows, desc="H3 index", unit="venue", ncols=80):
        try:
            cell7 = h3.latlng_to_cell(lat, lon, res7)
            cell8 = h3.latlng_to_cell(lat, lon, res8)
        except Exception:
            cell7 = cell8 = None
        h3_data.append((fsq_place_id, cell7, cell8))

    con.execute("CREATE OR REPLACE TABLE h3_index (fsq_place_id VARCHAR, h3_r7 VARCHAR, h3_r8 VARCHAR)")
    con.executemany("INSERT INTO h3_index VALUES (?, ?, ?)", h3_data)

    con.execute("""
        CREATE OR REPLACE TABLE venues AS
        SELECT p.*, i.h3_r7, i.h3_r8
        FROM clean_places p
        JOIN h3_index i USING (fsq_place_id)
        WHERE i.h3_r7 IS NOT NULL
    """)

    n = con.execute("SELECT count(*) FROM venues").fetchone()[0]
    n_cells = con.execute("SELECT count(DISTINCT h3_r7) FROM venues").fetchone()[0]
    log.info("Venues with H3 index: %s  |  distinct res-7 cells: %s", f"{n:,}", f"{n_cells:,}")
    AUDIT["venue_count"] = n
    AUDIT["h3_cell_count"] = n_cells
    tock("h3", t0)


# ── step 5: TF-IDF suburb vectors ─────────────────────────────────────────────

def step_tfidf(
    con: duckdb.DuckDBPyConnection,
    max_features: int,
    min_venues: int,
) -> tuple[TfidfVectorizer, np.ndarray, list[str]]:
    t0 = tick("tfidf")
    log.info("── Step 5 / 9  TF-IDF Suburb Vectors (max_features=%d) ──────", max_features)

    # build one "document" per suburb = space-separated category_label tokens
    # mode locality/region per cell for display in the UI
    suburb_docs = con.execute("""
        WITH docs AS (
            SELECT h3_r7,
                   string_agg(category_label, ' ') AS doc,
                   count(*)                         AS venue_count
            FROM venues
            WHERE category_label IS NOT NULL
              AND is_closed = false
            GROUP BY h3_r7
            HAVING count(*) >= ?
        ),
        labels AS (
            SELECT h3_r7,
                   mode(locality) AS locality,
                   mode(region)   AS state
            FROM venues
            GROUP BY h3_r7
        )
        SELECT d.h3_r7, d.doc, d.venue_count, l.locality, l.state
        FROM docs d
        LEFT JOIN labels l USING (h3_r7)
        ORDER BY d.h3_r7
    """, [min_venues]).fetchall()

    _STATE_ABBR = {
        "new south wales": "NSW", "nsw": "NSW",
        "victoria": "VIC", "vic": "VIC",
        "queensland": "QLD", "qld": "QLD",
        "western australia": "WA", "wa": "WA",
        "south australia": "SA", "sa": "SA",
        "tasmania": "TAS", "tas": "TAS",
        "australian capital territory": "ACT", "act": "ACT",
        "northern territory": "NT", "nt": "NT",
    }

    def _abbr(raw: str | None) -> str | None:
        if not raw:
            return None
        return _STATE_ABBR.get(raw.lower().strip(), raw[:3].upper() if raw else None)

    cell_ids   = [r[0] for r in suburb_docs]
    corpus     = [r[1] for r in suburb_docs]
    venue_cnts = [r[2] for r in suburb_docs]
    localities = [r[3] for r in suburb_docs]
    states     = [_abbr(r[4]) for r in suburb_docs]

    log.info("Suburbs qualifying (>= %d venues, open): %s", min_venues, f"{len(cell_ids):,}")

    effective_max = min(max_features, 500)
    vectorizer = TfidfVectorizer(
        analyzer="word",
        token_pattern=r"[A-Za-z][A-Za-z ]+",  # keep multi-word categories
        ngram_range=(1, 2),
        max_features=effective_max,
        sublinear_tf=True,
    )
    X = vectorizer.fit_transform(corpus)
    log.info("TF-IDF matrix: %s suburbs × %s features", f"{X.shape[0]:,}", f"{X.shape[1]:,}")

    # store suburb_cells in duckdb
    centroids = []
    for cid in tqdm(cell_ids, desc="Cell centroids", unit="cell", ncols=80):
        lat, lon = h3.cell_to_latlng(cid)
        centroids.append((lat, lon))

    con.execute("""
        CREATE OR REPLACE TABLE suburb_cells (
            h3_r7        VARCHAR PRIMARY KEY,
            venue_count  INTEGER,
            center_lat   DOUBLE,
            center_lon   DOUBLE,
            locality     VARCHAR,
            state        VARCHAR
        )
    """)
    con.executemany(
        "INSERT INTO suburb_cells VALUES (?, ?, ?, ?, ?, ?)",
        [
            (cell_ids[i], venue_cnts[i], centroids[i][0], centroids[i][1],
             localities[i], states[i])
            for i in range(len(cell_ids))
        ],
    )

    AUDIT["tfidf_suburbs"] = len(cell_ids)
    AUDIT["tfidf_features"] = X.shape[1]
    tock("tfidf", t0)
    return vectorizer, X, cell_ids


# ── step 6: UMAP ─────────────────────────────────────────────────────────────

def step_umap(
    X: np.ndarray,
    skip: bool,
) -> np.ndarray | None:
    t0 = tick("umap")
    log.info("── Step 6 / 9  UMAP 2D Embedding ────────────────────────────")

    if skip:
        log.info("--skip-umap set: skipping UMAP fit")
        AUDIT["umap_skipped"] = True
        tock("umap", t0)
        return None

    n_samples, n_dims = X.shape if not issparse(X) else X.shape
    log.info("Input matrix: %s × %s", f"{n_samples:,}", f"{n_dims:,}")

    # PCA pre-reduction if dims > 100 to speed UMAP
    X_dense: np.ndarray
    if n_dims > 100:
        log.info("Dims > 100 — running TruncatedSVD to 100 before UMAP …")
        svd = TruncatedSVD(n_components=100, random_state=42)
        X_dense = svd.fit_transform(X)
        log.info("SVD variance explained: %.1f%%", svd.explained_variance_ratio_.sum() * 100)
    else:
        X_dense = X.toarray() if issparse(X) else X

    n_neighbors = min(15, n_samples - 1)
    # SVD output is already L2-normalised — euclidean is identical to cosine
    # but ~10× faster for UMAP on large matrices
    umap_metric = "euclidean" if n_dims > 100 else "cosine"
    reducer = UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=0.1,
        metric=umap_metric,
        random_state=42,
        low_memory=True,
        verbose=False,
    )
    log.info("Fitting UMAP (n_neighbors=%d, metric=%s) …", n_neighbors, umap_metric)
    coords = reducer.fit_transform(X_dense)
    log.info("UMAP complete — output shape: %s", coords.shape)

    AUDIT["umap_skipped"] = False
    AUDIT["umap_n_neighbors"] = n_neighbors
    tock("umap", t0)
    return coords, reducer  # type: ignore[return-value]


# ── step 7: store umap_coords ────────────────────────────────────────────────

def step_store_umap(
    con: duckdb.DuckDBPyConnection,
    cell_ids: list[str],
    result,  # None | (coords_array, reducer)
) -> None:
    t0 = tick("store_umap")
    log.info("── Step 7 / 9  Store UMAP Coords ─────────────────────────────")

    con.execute("""
        CREATE OR REPLACE TABLE umap_coords (
            h3_r7  VARCHAR PRIMARY KEY,
            umap_x DOUBLE,
            umap_y DOUBLE
        )
    """)

    if result is None:
        log.info("UMAP skipped — umap_coords table will be empty")
        AUDIT["umap_coord_count"] = 0
        tock("store_umap", t0)
        return

    coords, _ = result
    rows = [(cell_ids[i], float(coords[i, 0]), float(coords[i, 1])) for i in range(len(cell_ids))]
    con.executemany("INSERT INTO umap_coords VALUES (?, ?, ?)", rows)
    log.info("Stored %s UMAP coordinate rows", f"{len(rows):,}")
    AUDIT["umap_coord_count"] = len(rows)
    tock("store_umap", t0)


# ── step 8: save pkl artifacts ────────────────────────────────────────────────

def step_save_pkl(
    vectorizer: TfidfVectorizer,
    umap_result,
    skip_umap: bool,
) -> None:
    t0 = tick("save_pkl")
    log.info("── Step 8 / 9  Save PKL Artifacts ────────────────────────────")

    tfidf_path = BACKEND_DIR / "tfidf.pkl"
    joblib.dump(vectorizer, tfidf_path)
    log.info("Saved %s  (%.1f KB)", tfidf_path, tfidf_path.stat().st_size / 1024)

    if not skip_umap and umap_result is not None:
        _, reducer = umap_result
        reducer_path = BACKEND_DIR / "reducer.pkl"
        joblib.dump(reducer, reducer_path)
        log.info("Saved %s  (%.1f KB)", reducer_path, reducer_path.stat().st_size / 1024)
    else:
        log.info("reducer.pkl not saved (UMAP skipped)")

    tock("save_pkl", t0)


# ── step 9: export duckdb ─────────────────────────────────────────────────────

def step_export_db(
    con: duckdb.DuckDBPyConnection,
    out_path: Path,
) -> None:
    t0 = tick("export_db")
    log.info("── Step 9 / 9  Export DuckDB → %s ───────────────────────────", out_path)

    # write the final db; copy table-by-table into a persistent file
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()

    tables = ["venues", "suburb_cells", "umap_coords"]
    try:
        # ATTACH the newly created db and copy tables over efficiently
        con.execute(f"ATTACH '{out_path}' AS dest")
        for tbl in tables:
            con.execute(f"CREATE TABLE dest.{tbl} AS SELECT * FROM {tbl}")
            n = con.execute(f"SELECT count(*) FROM dest.{tbl}").fetchone()[0]
            log.info("  %-20s  %s rows", tbl, f"{n:,}")
            AUDIT.setdefault("exported_tables", {})[tbl] = n
        con.execute("DETACH dest")
    except Exception as e:
        log.warning("  Could not export database: %s", e)


    if out_path.exists():
        size_mb = out_path.stat().st_size / 1_048_576
        log.info("Database written: %s  (%.1f MB)", out_path, size_mb)
        AUDIT["db_size_mb"] = round(size_mb, 2)
    tock("export_db", t0)


# ── audit log ─────────────────────────────────────────────────────────────────

def write_audit(decisions: dict) -> None:
    AUDIT["run_at"] = datetime.now(timezone.utc).isoformat()
    AUDIT["decisions_used"] = decisions
    audit_path = DATA_DIR / "pipeline_run.json"
    with open(audit_path, "w") as f:
        json.dump(AUDIT, f, indent=2, default=str)
    log.info("Audit log → %s", audit_path)


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Vantage data pipeline")
    parser.add_argument("--places",     default=None, help="Places parquet directory")
    parser.add_argument("--categories", default=None, help="Categories parquet directory")
    parser.add_argument("--sample",     action="store_true", help="Use 200K synthetic rows")
    parser.add_argument("--sample-n",   type=int, default=200_000)
    parser.add_argument("--metro",      action="store_true", help="Sydney metro bbox only")
    parser.add_argument("--skip-umap",  action="store_true", help="Skip UMAP (fast dev)")
    parser.add_argument("--region",     default=None, help="Filter to AU state abbreviation, e.g. NSW")
    parser.add_argument(
        "--out",
        default=str(BACKEND_DIR / "vantage.duckdb"),
        help="Output DuckDB path",
    )
    args = parser.parse_args()

    if not args.sample and (args.places is None or args.categories is None):
        parser.error("Provide --places and --categories, or use --sample")

    log.info("═" * 72)
    log.info("  Vantage Pipeline  —  %s", datetime.now().strftime("%Y-%m-%d %H:%M"))
    log.info("═" * 72)

    decisions = load_decisions()
    bbox       = decisions["coordinate_filter"]
    res7       = decisions["h3_resolution"]
    res8       = res7 + 1
    max_feat   = decisions["tfidf_max_features"]
    min_venues = decisions["min_venues_per_cell"]

    con = duckdb.connect()

    # Step 1 — load
    step_load(con, args.places, args.categories, args.sample, args.sample_n)

    # Step 2 — filter to AU
    step_filter_au(con, bbox, metro=args.metro, region=args.region)

    # Step 3 — clean
    step_clean(con)

    # Step 4 — H3 indexes
    step_h3(con, res7=res7, res8=res8)

    # Step 5 — TF-IDF
    vectorizer, X, cell_ids = step_tfidf(con, max_features=max_feat, min_venues=min_venues)

    # Step 6 — UMAP
    umap_result = step_umap(X, skip=args.skip_umap)

    # Step 7 — store coords
    step_store_umap(con, cell_ids, umap_result)

    # Step 8 — save pkl
    step_save_pkl(vectorizer, umap_result, skip_umap=args.skip_umap)

    # Step 9 — export db
    step_export_db(con, Path(args.out))

    write_audit(decisions)

    # ── summary ───────────────────────────────────────────────────────────────
    log.info("")
    log.info("═" * 72)
    log.info("  PIPELINE COMPLETE")
    log.info("  Raw → AU → Clean → H3 → TF-IDF → UMAP → DuckDB")
    log.info("  %s raw  →  %s AU  →  %s clean  →  %s suburbs",
        f"{AUDIT.get('raw_row_count', 0):,}",
        f"{AUDIT.get('au_row_count', 0):,}",
        f"{AUDIT.get('clean_row_count', 0):,}",
        f"{AUDIT.get('tfidf_suburbs', 0):,}",
    )
    total_s = sum(
        v.get("elapsed_s", 0) for v in AUDIT.get("timings", {}).values()
    )
    log.info("  Total wall time: %.1f s", total_s)
    log.info("  Output: %s", args.out)
    log.info("═" * 72)


if __name__ == "__main__":
    main()
