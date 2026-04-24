"""
validate_osm.py
---------------
Validates the Vantage scoring model against real-world franchise locations
fetched from the OpenStreetMap Overpass API.

For each franchise brand we know the "right" category in our model,
so we can check what % of actual locations score STRONG or BETTER_THAN_BEST.

Usage:
    python validate_osm.py            # runs all brands, prints summary
    python validate_osm.py --json     # also writes validation_results.json
"""

import sys
import time
import json
import math
import argparse
import urllib.request
import urllib.parse
from pathlib import Path

import h3
import duckdb

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DB_PATH = Path(__file__).parent.parent / "backend" / "vantage.duckdb"
H3_RES = 7

# Franchise → Vantage category mapping
# Each entry: (brand_name, osm_key, osm_value, vantage_category)
FRANCHISES = [
    # ── Gym & Fitness ──────────────────────────────────────────────────────
    ("Anytime Fitness",    "brand",  "Anytime Fitness",    "Gym & Fitness"),
    ("F45 Training",       "brand",  "F45 Training",       "Gym & Fitness"),
    ("Snap Fitness",       "brand",  "Snap Fitness",       "Gym & Fitness"),
    # ── Café ───────────────────────────────────────────────────────────────
    ("The Coffee Club",    "brand",  "The Coffee Club",    "Café"),
    ("Gloria Jean's",      "brand",  "Gloria Jean's Coffees", "Café"),
    ("Boost Juice",        "brand",  "Boost Juice",        "Café"),
    # ── Pharmacy ───────────────────────────────────────────────────────────
    ("Chemist Warehouse",  "brand",  "Chemist Warehouse",  "Pharmacy"),
    ("Priceline Pharmacy", "brand",  "Priceline Pharmacy", "Pharmacy"),
    ("Terry White",        "brand",  "Terry White Chemmart", "Pharmacy"),
]


def overpass_query(brand_key: str, brand_value: str) -> list[tuple[float, float]]:
    """Return (lat, lon) for every OSM node/way/relation matching the brand in AU."""
    # Bounding box: Australia
    bbox = "-44,113,-10,154"
    ql = f"""
[out:json][timeout:60];
(
  node["{brand_key}"="{brand_value}"]({bbox});
  way["{brand_key}"="{brand_value}"]({bbox});
  relation["{brand_key}"="{brand_value}"]({bbox});
);
out center;
"""
    data = urllib.parse.urlencode({"data": ql}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data)
    with urllib.request.urlopen(req, timeout=90) as resp:
        result = json.loads(resp.read())

    coords = []
    for el in result.get("elements", []):
        if el["type"] == "node":
            coords.append((el["lat"], el["lon"]))
        elif "center" in el:
            coords.append((el["center"]["lat"], el["center"]["lon"]))
    return coords


def score_locations(
    coords: list[tuple[float, float]],
    category: str,
    con: duckdb.DuckDBPyConnection,
) -> dict:
    """H3-index coords, look up scores, return breakdown."""
    if not coords:
        return {"total": 0}

    cells = {h3.latlng_to_cell(lat, lon, H3_RES) for lat, lon in coords}
    placeholders = ", ".join(f"'{c}'" for c in cells)

    rows = con.execute(
        f"""
        SELECT cell_id, composite_score, tier
        FROM suburb_scores
        WHERE category = ? AND cell_id IN ({placeholders})
        """,
        [category],
    ).fetchall()

    if not rows:
        return {
            "total": len(coords),
            "distinct_cells": len(cells),
            "matched_cells": 0,
            "pct_matched": 0.0,
            "tiers": {},
            "hit_rate": 0.0,
        }

    tiers: dict[str, int] = {}
    for _, _, tier in rows:
        tiers[tier] = tiers.get(tier, 0) + 1

    matched = len(rows)
    strong_plus = tiers.get("BETTER_THAN_BEST", 0) + tiers.get("STRONG", 0)

    return {
        "total": len(coords),
        "distinct_cells": len(cells),
        "matched_cells": matched,
        "pct_matched": round(matched / len(cells) * 100, 1),
        "tiers": tiers,
        "hit_rate": round(strong_plus / matched * 100, 1) if matched else 0.0,
    }


def star(rate: float) -> str:
    if rate >= 75:
        return "★★★"
    if rate >= 55:
        return "★★☆"
    return "★☆☆"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Write JSON output")
    args = parser.parse_args()

    if not DB_PATH.exists():
        sys.exit(f"Database not found: {DB_PATH}")

    con = duckdb.connect(str(DB_PATH), read_only=True)

    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Vantage Model Validation — OSM Franchise Benchmark")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    results = []
    category_buckets: dict[str, list[float]] = {}

    for brand, key, value, category in FRANCHISES:
        print(f"  Fetching {brand} …", end=" ", flush=True)
        try:
            coords = overpass_query(key, value)
        except Exception as exc:
            print(f"FAILED ({exc})")
            results.append({"brand": brand, "category": category, "error": str(exc)})
            time.sleep(2)
            continue

        stats = score_locations(coords, category, con)
        stats["brand"] = brand
        stats["category"] = category
        results.append(stats)

        hit = stats.get("hit_rate", 0.0)
        matched = stats.get("matched_cells", 0)
        total_cells = stats.get("distinct_cells", 0)
        print(
            f"found {stats['total']} locations → {total_cells} cells "
            f"({matched} in DB) → {hit}% STRONG+ {star(hit)}"
        )

        if matched > 0:
            category_buckets.setdefault(category, []).append(hit)

        time.sleep(1.5)  # be polite to Overpass

    # ── Category rollup ───────────────────────────────────────────────────
    print("\n  ── Category summary ──")
    category_scores = {}
    for cat, hits in category_buckets.items():
        avg = round(sum(hits) / len(hits), 1)
        category_scores[cat] = avg
        print(f"  {cat:20s}  avg hit-rate {avg}%  {star(avg)}")

    overall_vals = [v for v in category_scores.values()]
    if overall_vals:
        overall = round(sum(overall_vals) / len(overall_vals), 1)
        print(f"\n  Overall model accuracy:  {overall}% of real franchise")
        print(f"  locations scored STRONG or BETTER_THAN_BEST\n")

    if args.json:
        out = {
            "results": results,
            "category_summary": category_scores,
            "overall_hit_rate": overall if overall_vals else None,
        }
        out_path = Path(__file__).parent / "validation_results.json"
        out_path.write_text(json.dumps(out, indent=2))
        print(f"  Results written to {out_path}\n")

    con.close()


if __name__ == "__main__":
    main()
