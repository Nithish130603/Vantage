#!/usr/bin/env python3
"""
Generate realistic synthetic vantage.duckdb for demo.
Writes all output to backend/ directory.
"""

from __future__ import annotations

import json
import math
import os
import pickle
import random
import uuid
from datetime import date, timedelta
from pathlib import Path

import duckdb
import h3
import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize
from umap import UMAP

BACKEND_DIR = Path(__file__).parent.parent / "backend"
BACKEND_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = BACKEND_DIR / "vantage.duckdb"
TFIDF_PATH = BACKEND_DIR / "tfidf.pkl"
REDUCER_PATH = BACKEND_DIR / "reducer.pkl"

random.seed(42)
np.random.seed(42)

# ── Suburb catalog ────────────────────────────────────────────────────────────
SUBURBS = [
    # NSW — Gold (guaranteed BETTER_THAN_BEST for Gym & Fitness)
    ("Gosford CBD",    -33.4257, 151.3424, "NSW", "gym_gold"),
    ("Penrith",        -33.7509, 150.6942, "NSW", "gym_gold"),
    ("Wollongong",     -34.4278, 150.8930, "NSW", "gym_gold"),
    # Sydney Inner
    ("Surry Hills",    -33.8862, 151.2094, "NSW", "commercial"),
    ("Newtown",        -33.8977, 151.1794, "NSW", "mixed"),
    ("Paddington",     -33.8845, 151.2302, "NSW", "commercial"),
    ("Bondi Beach",    -33.8914, 151.2767, "NSW", "suburban"),
    ("Balmain",        -33.8590, 151.1798, "NSW", "mixed"),
    ("Marrickville",   -33.9077, 151.1559, "NSW", "suburban"),
    # Sydney North
    ("Chatswood",      -33.7969, 151.1830, "NSW", "commercial"),
    ("North Sydney",   -33.8398, 151.2072, "NSW", "commercial"),
    ("Crows Nest",     -33.8277, 151.2077, "NSW", "mixed"),
    ("Hornsby",        -33.7033, 151.0990, "NSW", "suburban"),
    ("Manly",          -33.7969, 151.2849, "NSW", "suburban"),
    ("Castle Hill",    -33.7304, 151.0065, "NSW", "suburban"),
    # Sydney West
    ("Parramatta",     -33.8148, 151.0022, "NSW", "commercial"),
    ("Westmead",       -33.8064, 151.0032, "NSW", "mixed"),
    ("Blacktown",      -33.7685, 150.9066, "NSW", "suburban"),
    ("Liverpool",      -33.9208, 150.9235, "NSW", "suburban"),
    ("Bankstown",      -33.9173, 151.0342, "NSW", "suburban"),
    # Sydney South/East
    ("Randwick",       -33.9143, 151.2408, "NSW", "mixed"),
    ("Kogarah",        -33.9636, 151.1338, "NSW", "suburban"),
    ("Hurstville",     -33.9674, 151.1009, "NSW", "suburban"),
    ("Cronulla",       -34.0565, 151.1553, "NSW", "suburban"),
    ("Epping",         -33.7729, 151.0825, "NSW", "suburban"),
    ("Ryde",           -33.8130, 151.1021, "NSW", "mixed"),
    ("Strathfield",    -33.8728, 151.0825, "NSW", "suburban"),
    ("Burwood",        -33.8776, 151.0981, "NSW", "mixed"),
    # Melbourne
    ("Melbourne CBD",  -37.8136, 144.9631, "VIC", "commercial"),
    ("Fitzroy",        -37.7995, 144.9773, "VIC", "mixed"),
    ("Richmond",       -37.8199, 144.9981, "VIC", "commercial"),
    ("South Yarra",    -37.8394, 144.9916, "VIC", "commercial"),
    ("Prahran",        -37.8491, 144.9884, "VIC", "mixed"),
    ("St Kilda",       -37.8678, 144.9812, "VIC", "suburban"),
    ("Hawthorn",       -37.8224, 145.0347, "VIC", "mixed"),
    ("Camberwell",     -37.8246, 145.0588, "VIC", "suburban"),
    ("Box Hill",       -37.8183, 145.1233, "VIC", "commercial"),
    ("Dandenong",      -37.9878, 145.2154, "VIC", "suburban"),
    ("Footscray",      -37.7997, 144.8992, "VIC", "suburban"),
    ("Ringwood",       -37.8160, 145.2290, "VIC", "suburban"),
    ("Frankston",      -38.1434, 145.1291, "VIC", "suburban"),
    ("Essendon",       -37.7481, 144.9200, "VIC", "suburban"),
    ("Geelong CBD",    -38.1499, 144.3617, "VIC", "commercial"),
    ("Glen Waverley",  -37.8784, 145.1629, "VIC", "suburban"),
    ("Moorabbin",      -37.9319, 145.0652, "VIC", "suburban"),
    # Brisbane
    ("Brisbane CBD",   -27.4705, 153.0260, "QLD", "commercial"),
    ("Fortitude Valley",-27.4576, 153.0352, "QLD", "commercial"),
    ("South Brisbane", -27.4818, 153.0231, "QLD", "mixed"),
    ("West End",       -27.4817, 153.0097, "QLD", "mixed"),
    ("New Farm",       -27.4647, 153.0479, "QLD", "mixed"),
    ("Chermside",      -27.3932, 153.0317, "QLD", "suburban"),
    ("Indooroopilly",  -27.4984, 152.9770, "QLD", "suburban"),
    ("Sunnybank",      -27.5780, 153.0599, "QLD", "suburban"),
    ("Toowong",        -27.4845, 152.9847, "QLD", "mixed"),
    # Perth
    ("Perth CBD",      -31.9505, 115.8605, "WA", "commercial"),
    ("Fremantle",      -32.0569, 115.7439, "WA", "mixed"),
    ("Northbridge",    -31.9462, 115.8566, "WA", "commercial"),
    ("Subiaco",        -31.9487, 115.8266, "WA", "mixed"),
    ("Mount Lawley",   -31.9275, 115.8639, "WA", "mixed"),
    ("Joondalup",      -31.7461, 115.7681, "WA", "suburban"),
    ("Midland",        -31.8921, 116.0091, "WA", "suburban"),
    ("Rockingham",     -32.2779, 115.7342, "WA", "suburban"),
]

CATEGORIES = [
    "Gym & Fitness", "Café", "Pharmacy", "Restaurant", "Office",
    "Retail", "Allied Health", "Coworking", "Bar", "Supermarket"
]

PROFILES = {
    "gym_gold":   [0.06, 0.22, 0.07, 0.10, 0.14, 0.10, 0.15, 0.09, 0.04, 0.03],
    "commercial": [0.07, 0.18, 0.06, 0.14, 0.18, 0.12, 0.08, 0.07, 0.06, 0.04],
    "mixed":      [0.08, 0.15, 0.07, 0.18, 0.10, 0.14, 0.07, 0.05, 0.08, 0.08],
    "suburban":   [0.09, 0.12, 0.10, 0.20, 0.06, 0.18, 0.05, 0.03, 0.07, 0.10],
}

# ── Date helpers ──────────────────────────────────────────────────────────────
DATE_START = date(2018, 1, 1)
DATE_END = date(2025, 12, 31)
DATE_RANGE_DAYS = (DATE_END - DATE_START).days


def random_date(after: date | None = None) -> date:
    if after is None:
        return DATE_START + timedelta(days=random.randint(0, DATE_RANGE_DAYS))
    days_left = (DATE_END - after).days
    if days_left <= 0:
        return after
    return after + timedelta(days=random.randint(1, max(1, days_left)))


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


def trajectory_status(score_traj: float) -> str:
    if score_traj >= 0.65:
        return "GROWING"
    if score_traj >= 0.40:
        return "STABLE"
    return "NARROWING"


def risk_level(score_risk: float) -> str:
    if score_risk >= 0.65:
        return "LOW"
    if score_risk >= 0.40:
        return "MODERATE"
    return "HIGH"


def shannon_entropy(counts: dict) -> float:
    total = sum(counts.values())
    if total == 0:
        return 0.0
    probs = [c / total for c in counts.values() if c > 0]
    return -sum(p * math.log2(p) for p in probs)


# ── Generate venues ───────────────────────────────────────────────────────────
print("✅ Generating venues...")

n_suburbs = len(SUBURBS)
venues_per_suburb = min(500, 50_000 // n_suburbs)

all_venues = []

for suburb_name, center_lat, center_lon, state_code, profile_key in SUBURBS:
    profile = PROFILES[profile_key]
    n_venues = venues_per_suburb + random.randint(-50, 50)

    for _ in range(n_venues):
        cat = random.choices(CATEGORIES, weights=profile, k=1)[0]
        lat = center_lat + random.gauss(0, 0.015)
        lon = center_lon + random.gauss(0, 0.015)

        h3_r7 = h3.latlng_to_cell(lat, lon, 7)
        h3_r8 = h3.latlng_to_cell(lat, lon, 8)

        vid = str(uuid.uuid4())
        name = f"Venue {vid[:6]}"

        d_created = random_date()
        d_closed = None
        is_closed = False
        if random.random() < 0.06:
            d_closed = random_date(after=d_created)
            is_closed = True

        is_stale = random.random() < 0.08

        all_venues.append({
            "fsq_place_id": vid,
            "name": name,
            "latitude": lat,
            "longitude": lon,
            "h3_r7": h3_r7,
            "h3_r8": h3_r8,
            "category_label": cat,
            "date_created": d_created.isoformat(),
            "date_closed": d_closed.isoformat() if d_closed else None,
            "is_closed": is_closed,
            "is_stale": is_stale,
            "suburb_name": suburb_name,
            "state_code": state_code,
            "profile_key": profile_key,
        })

print(f"✅ Generated {len(all_venues):,} venues across {n_suburbs} suburbs")

# ── Build suburb_cells ────────────────────────────────────────────────────────
print("✅ Building suburb_cells...")

# Determine dominant h3_r7 per suburb using the center coordinate
suburb_center_h3 = {}
suburb_info = {}
for suburb_name, center_lat, center_lon, state_code, profile_key in SUBURBS:
    h3_id = h3.latlng_to_cell(center_lat, center_lon, 7)
    suburb_center_h3[suburb_name] = h3_id
    suburb_info[suburb_name] = (h3_id, center_lat, center_lon, state_code, profile_key)

# Count venues per suburb
suburb_venue_counts: dict[str, int] = {}
for v in all_venues:
    suburb_venue_counts[v["suburb_name"]] = suburb_venue_counts.get(v["suburb_name"], 0) + 1

suburb_cells_rows = []
seen_h3 = {}
for suburb_name, (h3_id, center_lat, center_lon, state_code, profile_key) in suburb_info.items():
    venue_count = suburb_venue_counts.get(suburb_name, 0)
    # If two suburbs share an h3_r7, keep the first one but still track
    if h3_id not in seen_h3:
        seen_h3[h3_id] = suburb_name
        suburb_cells_rows.append((h3_id, center_lat, center_lon, venue_count, suburb_name, state_code))

print(f"✅ Built {len(suburb_cells_rows)} suburb cells")

# ── Build TF-IDF ──────────────────────────────────────────────────────────────
print("✅ Building TF-IDF vectorizer...")

# Map suburb_name -> h3_r7 (use center h3)
suburb_h3_map = {name: info[0] for name, info in suburb_info.items()}

# Build documents per h3_r7
h3_docs: dict[str, list[str]] = {}
for v in all_venues:
    if not v["is_closed"] and v["category_label"]:
        h3_id = suburb_h3_map.get(v["suburb_name"])
        if h3_id:
            h3_docs.setdefault(h3_id, []).append(v["category_label"])

cell_ids = list(h3_docs.keys())
documents = [" ".join(h3_docs[cid]) for cid in cell_ids]

vectorizer = TfidfVectorizer(max_features=200)
X = vectorizer.fit_transform(documents)

with open(TFIDF_PATH, "wb") as f:
    pickle.dump(vectorizer, f)
print(f"✅ TF-IDF fitted ({X.shape[1]} features), saved to {TFIDF_PATH}")

# ── Normalize suburb matrix ───────────────────────────────────────────────────
X_arr = X.toarray().astype(np.float32)
norms = np.linalg.norm(X_arr, axis=1, keepdims=True)
norms[norms == 0] = 1
X_norm = X_arr / norms

# ── Build UMAP ────────────────────────────────────────────────────────────────
print("✅ Building UMAP reducer...")

n_components_svd = min(40, len(cell_ids) - 1, X_norm.shape[1] - 1)
svd = TruncatedSVD(n_components=n_components_svd, random_state=42)
X_svd = svd.fit_transform(X_norm)

reducer = UMAP(
    n_components=2,
    n_neighbors=8,
    min_dist=0.1,
    metric="euclidean",
    random_state=42,
    n_epochs=200,
)
umap_coords_arr = reducer.fit_transform(X_svd)

with open(REDUCER_PATH, "wb") as f:
    pickle.dump(reducer, f)
print(f"✅ UMAP fitted, saved to {REDUCER_PATH}")

# ── Compute gold standard vectors ─────────────────────────────────────────────
print("✅ Computing gold standard vectors...")

# Map h3_id -> profile_key
h3_profile: dict[str, str] = {}
for suburb_name, (h3_id, _, _, _, profile_key) in suburb_info.items():
    h3_profile[h3_id] = profile_key

# category -> profile_key mapping for gold
CATEGORY_GOLD_PROFILE = {
    "Gym & Fitness": "gym_gold",
}

gold_vectors: dict[str, np.ndarray] = {}
gold_sample_sizes: dict[str, int] = {}

cell_id_to_idx = {cid: i for i, cid in enumerate(cell_ids)}

for cat in CATEGORIES:
    gold_profile = CATEGORY_GOLD_PROFILE.get(cat)
    if gold_profile:
        gold_indices = [
            cell_id_to_idx[cid]
            for cid in cell_ids
            if h3_profile.get(cid) == gold_profile
        ]
    else:
        # Use commercial profile as gold for other categories
        gold_indices = [
            cell_id_to_idx[cid]
            for cid in cell_ids
            if h3_profile.get(cid) == "commercial"
        ]

    if gold_indices:
        gold_vec = X_norm[gold_indices].mean(axis=0)
        norm = np.linalg.norm(gold_vec)
        if norm > 0:
            gold_vec = gold_vec / norm
        gold_vectors[cat] = gold_vec.astype(np.float32)
        gold_sample_sizes[cat] = len(gold_indices)
    else:
        gold_vectors[cat] = X_norm.mean(axis=0).astype(np.float32)
        gold_sample_sizes[cat] = len(cell_ids)

# ── Compute suburb scores ─────────────────────────────────────────────────────
print("✅ Computing suburb scores...")

# Precompute category counts per h3_r7
h3_cat_counts: dict[str, dict[str, int]] = {}
h3_total: dict[str, int] = {}
h3_closed: dict[str, int] = {}

for v in all_venues:
    h3_id = suburb_h3_map.get(v["suburb_name"])
    if not h3_id:
        continue
    h3_cat_counts.setdefault(h3_id, {})
    h3_cat_counts[h3_id][v["category_label"]] = h3_cat_counts[h3_id].get(v["category_label"], 0) + 1
    h3_total[h3_id] = h3_total.get(h3_id, 0) + 1
    if v["is_closed"]:
        h3_closed[h3_id] = h3_closed.get(h3_id, 0) + 1

# Average category count across all suburbs (for competition score)
cat_avg_counts: dict[str, float] = {}
for cat in CATEGORIES:
    counts = [h3_cat_counts.get(cid, {}).get(cat, 0) for cid in cell_ids]
    cat_avg_counts[cat] = float(np.mean(counts)) if counts else 1.0

# Max entropy for normalization
max_entropy = math.log2(len(CATEGORIES)) if len(CATEGORIES) > 1 else 1.0

suburb_scores_rows = []

for cid in cell_ids:
    idx = cell_id_to_idx[cid]
    profile_key = h3_profile.get(cid, "suburban")
    suburb_vec = X_norm[idx]

    total = h3_total.get(cid, 1)
    closed = h3_closed.get(cid, 0)
    cat_counts = h3_cat_counts.get(cid, {})

    # score_diversity: normalized Shannon entropy
    entropy = shannon_entropy(cat_counts)
    score_diversity = float(np.clip(entropy / max_entropy, 0, 1))

    # score_risk base
    base_risk = 1.0 - (closed / max(1, total))

    for cat in CATEGORIES:
        gold_vec = gold_vectors[cat]

        # score_fingerprint: cosine similarity (vectors already normalized)
        score_fingerprint = float(np.dot(suburb_vec, gold_vec))
        score_fingerprint = float(np.clip(score_fingerprint, 0, 1))

        # score_trajectory: profile-based random
        traj_params = {
            "gym_gold":   (0.80, 0.05),
            "commercial": (0.68, 0.08),
            "mixed":      (0.58, 0.10),
            "suburban":   (0.50, 0.12),
        }
        mu, sigma = traj_params.get(profile_key, (0.55, 0.10))
        score_trajectory = float(np.clip(np.random.normal(mu, sigma), 0.1, 0.95))

        # score_competition: lower is better (fewer competitors = higher score)
        target_count = cat_counts.get(cat, 0)
        avg_count = cat_avg_counts.get(cat, 1.0)
        score_competition = float(np.clip(1.0 - min(1.0, target_count / max(1.0, avg_count * 1.5)), 0, 1))

        # score_risk: boost for gym_gold
        score_risk = float(np.clip(base_risk, 0, 1))
        if profile_key == "gym_gold" and cat == "Gym & Fitness":
            score_risk = float(np.clip(score_risk + 0.15, 0.85, 1.0))

        # composite
        composite = (
            0.30 * score_fingerprint
            + 0.25 * score_trajectory
            + 0.20 * score_diversity
            + 0.15 * score_risk
            + 0.10 * score_competition
        )

        # Boost gym_gold for Gym & Fitness to ensure >= 0.85
        if profile_key == "gym_gold" and cat == "Gym & Fitness":
            composite = float(min(1.0, composite + 0.20))

        composite = float(np.clip(composite, 0, 1))

        tier = tier_from_score(composite)
        traj_status = trajectory_status(score_trajectory)
        r_level = risk_level(score_risk)
        gold_std_similarity = score_fingerprint

        suburb_scores_rows.append((
            cid, cat,
            round(composite, 6),
            round(score_fingerprint, 6),
            round(score_trajectory, 6),
            round(score_competition, 6),
            round(score_diversity, 6),
            round(score_risk, 6),
            tier, traj_status, r_level,
            round(gold_std_similarity, 6),
        ))

print(f"✅ Computed {len(suburb_scores_rows):,} (suburb, category) score pairs")

# ── Build gold_standards table rows ──────────────────────────────────────────
print("✅ Building gold standards...")

gold_standards_rows = []
for cat in CATEGORIES:
    gvec = gold_vectors[cat]
    vector_json = json.dumps([round(float(v), 6) for v in gvec])
    sample_size = gold_sample_sizes[cat]

    # Top surrounding categories from gold profile
    gold_profile_key = CATEGORY_GOLD_PROFILE.get(cat, "commercial")
    profile_weights = PROFILES.get(gold_profile_key, PROFILES["commercial"])
    sorted_cats = sorted(zip(CATEGORIES, profile_weights), key=lambda x: -x[1])
    top_surrounding = ", ".join(c for c, _ in sorted_cats[:5] if c != cat)

    gold_standards_rows.append((cat, vector_json, sample_size, top_surrounding))

# ── Write to DuckDB ───────────────────────────────────────────────────────────
print(f"✅ Writing to {DB_PATH}...")

if DB_PATH.exists():
    DB_PATH.unlink()

con = duckdb.connect(str(DB_PATH))

# venues
con.execute("""
    CREATE TABLE venues (
        fsq_place_id VARCHAR,
        name VARCHAR,
        latitude DOUBLE,
        longitude DOUBLE,
        h3_r7 VARCHAR,
        h3_r8 VARCHAR,
        category_label VARCHAR,
        date_created VARCHAR,
        date_closed VARCHAR,
        is_closed BOOLEAN,
        is_stale BOOLEAN
    )
""")

venue_tuples = [
    (
        v["fsq_place_id"], v["name"], v["latitude"], v["longitude"],
        suburb_h3_map.get(v["suburb_name"], v["h3_r7"]),
        v["h3_r8"],
        v["category_label"], v["date_created"], v["date_closed"],
        v["is_closed"], v["is_stale"],
    )
    for v in all_venues
]

con.executemany(
    "INSERT INTO venues VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    venue_tuples,
)
print(f"✅ Inserted {len(venue_tuples):,} venues")

# suburb_cells
con.execute("""
    CREATE TABLE suburb_cells (
        h3_r7 VARCHAR PRIMARY KEY,
        center_lat DOUBLE,
        center_lon DOUBLE,
        venue_count INTEGER,
        locality VARCHAR,
        state VARCHAR
    )
""")
con.executemany(
    "INSERT INTO suburb_cells VALUES (?,?,?,?,?,?)",
    suburb_cells_rows,
)
print(f"✅ Inserted {len(suburb_cells_rows)} suburb_cells")

# umap_coords
con.execute("""
    CREATE TABLE umap_coords (
        h3_r7 VARCHAR PRIMARY KEY,
        umap_x DOUBLE,
        umap_y DOUBLE
    )
""")
umap_rows = [
    (cell_ids[i], float(umap_coords_arr[i, 0]), float(umap_coords_arr[i, 1]))
    for i in range(len(cell_ids))
    if cell_ids[i] in {r[0] for r in suburb_cells_rows}
]
con.executemany("INSERT INTO umap_coords VALUES (?,?,?)", umap_rows)
print(f"✅ Inserted {len(umap_rows)} umap_coords")

# suburb_scores
con.execute("""
    CREATE TABLE suburb_scores (
        h3_r7 VARCHAR,
        category VARCHAR,
        score DOUBLE,
        score_fingerprint DOUBLE,
        score_trajectory DOUBLE,
        score_competition DOUBLE,
        score_diversity DOUBLE,
        score_risk DOUBLE,
        tier VARCHAR,
        trajectory_status VARCHAR,
        risk_level VARCHAR,
        gold_std_similarity DOUBLE,
        PRIMARY KEY (h3_r7, category)
    )
""")
con.executemany(
    "INSERT INTO suburb_scores VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    suburb_scores_rows,
)
print(f"✅ Inserted {len(suburb_scores_rows):,} suburb_scores")

# gold_standards
con.execute("""
    CREATE TABLE gold_standards (
        category VARCHAR PRIMARY KEY,
        vector_json VARCHAR,
        sample_size INTEGER,
        top_surrounding_categories VARCHAR
    )
""")
con.executemany(
    "INSERT INTO gold_standards VALUES (?,?,?,?)",
    gold_standards_rows,
)
print(f"✅ Inserted {len(gold_standards_rows)} gold_standards")

con.close()
print(f"\n✅ Done! vantage.duckdb written to {DB_PATH}")
print(f"   Venues:        {len(venue_tuples):,}")
print(f"   Suburb cells:  {len(suburb_cells_rows)}")
print(f"   Score pairs:   {len(suburb_scores_rows):,}")
