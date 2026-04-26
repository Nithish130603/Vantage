"""
POST /fingerprint

3-path franchise DNA builder:
  - existing: use uploaded best/worst location names
  - fresh:    use industry gold standard (no client locations)
  - overseas: translate overseas DNA to Australian equivalents (fallback to gold)

Returns blended DNA vector, top categories, matching suburb H3s, UMAP projection
of client locations, and improvement hints vs gold standard.
"""

from __future__ import annotations

import logging
from difflib import get_close_matches
from typing import Optional

import numpy as np
import requests

from narrative import generate_dna_narrative
from fastapi import APIRouter, Query
from pydantic import BaseModel
from sklearn.metrics.pairwise import cosine_similarity

from state import state

log = logging.getLogger("vantage")

# Lazy-loaded once per process; suburb_cells.locality doesn't change at runtime
_locality_cache: list[str] | None = None
_locality_lower: list[str] | None = None


def _ensure_locality_cache() -> None:
    global _locality_cache, _locality_lower
    if _locality_cache is None:
        rows = state["get_con"]().execute(
            "SELECT DISTINCT locality FROM suburb_cells WHERE locality IS NOT NULL"
        ).fetchall()
        _locality_cache = [r[0] for r in rows]
        _locality_lower = [l.lower() for l in _locality_cache]

router = APIRouter()


# ── Autocomplete suggest ──────────────────────────────────────────────────────

class SuburbSuggestion(BaseModel):
    locality: str
    state: str
    h3_r7: str


@router.get("/suggest", response_model=list[SuburbSuggestion])
def suggest_suburbs(
    q: str = Query(..., min_length=2),
    limit: int = Query(8, ge=1, le=20),
):
    """
    Prefix + word-boundary autocomplete against suburb_cells.locality.
    Returns up to `limit` results, prefix matches ranked first.
    """
    con = state["get_con"]()
    clean = q.strip()
    rows = con.execute(
        """
        SELECT DISTINCT
            locality,
            COALESCE(state, 'AU') AS state,
            h3_r7
        FROM suburb_cells
        WHERE locality IS NOT NULL
          AND (
              LOWER(locality) LIKE LOWER(?) || '%'
              OR LOWER(locality) LIKE '% ' || LOWER(?) || '%'
          )
        ORDER BY
            CASE WHEN LOWER(locality) LIKE LOWER(?) || '%' THEN 0 ELSE 1 END,
            locality
        LIMIT ?
        """,
        [clean, clean, clean, limit],
    ).fetchall()
    return [SuburbSuggestion(locality=r[0], state=r[1], h3_r7=r[2]) for r in rows]


class FingerprintRequest(BaseModel):
    category: str
    mode: str = "existing"          # "existing" | "fresh" | "overseas"
    best_locations: list[str] = []  # suburb names
    worst_locations: list[str] = [] # optional
    region: str = "All Australia"


class FingerprintResponse(BaseModel):
    top_categories: list[dict]
    dna_summary: str
    top_suburb_h3s: list[str]           # best-matching suburb H3s (for gold stars on scatter)
    n_locations: int
    mode: str
    success_vector: list[float]
    failure_vector: Optional[list[float]]
    failure_summary: Optional[str]
    failure_h3s: list[str]              # H3 cells for worst locations (for failure penalty)
    gold_standard_match: float
    gold_standard_match_pct: int
    improvement_hint: str
    client_weight: float
    data_confidence: str                # HIGH | MEDIUM | LOW
    client_umap_points: list[dict]      # [{umap_x, umap_y}] for client locations
    unrecognised_suburbs: list[str]
    resolved_suburbs: dict[str, str]    # input → "Locality, STATE" for recognised inputs
    client_mean_gold_similarity: float  # alias of gold_standard_match; used by /scan for BTB
    # AI-generated card explainers
    explainer_dna: str = ""
    explainer_opportunities: str = ""
    explainer_comparison: str = ""
    explainer_locations: str = ""
    explainer_risk: str = ""


def _geocode_suburb(name: str) -> tuple[str, float, float, str] | None:
    """Return (h3_r7, center_lat, center_lon, resolved_name) or None.

    Tier 1: fuzzy match against suburb_cells.locality via difflib.
    Tier 2: Nominatim geocoding → nearest H3-7 cell by lat/lon distance.
    """
    _ensure_locality_cache()
    con = state["get_con"]()
    clean = name.strip().lower()

    # ── Tier 1: fuzzy match against our own locality list ────────────────────
    matches = get_close_matches(clean, _locality_lower, n=1, cutoff=0.6)
    if matches:
        row = con.execute(
            "SELECT h3_r7, center_lat, center_lon, locality, state "
            "FROM suburb_cells WHERE LOWER(locality) = ? LIMIT 1",
            [matches[0]],
        ).fetchone()
        if row:
            resolved = f"{row[3]}, {row[4]}" if row[4] else row[3]
            return (row[0], row[1], row[2], resolved)

    # ── Tier 2: Nominatim → nearest cell ─────────────────────────────────────
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": f"{name.strip()}, Australia",
                "format": "json",
                "limit": 1,
                "countrycodes": "au",
            },
            headers={"User-Agent": "Vantage/1.0"},
            timeout=5,
        )
        results = resp.json()
        if results:
            lat = float(results[0]["lat"])
            lon = float(results[0]["lon"])
            row = con.execute(
                "SELECT h3_r7, center_lat, center_lon, locality, state "
                "FROM suburb_cells "
                "ORDER BY (center_lat - ?) * (center_lat - ?) + (center_lon - ?) * (center_lon - ?) "
                "LIMIT 1",
                [lat, lat, lon, lon],
            ).fetchone()
            if row:
                resolved = f"{row[3]}, {row[4]}" if row[4] else results[0].get("display_name", name.strip()).split(",")[0]
                return (row[0], row[1], row[2], resolved)
    except Exception:
        pass

    return None


def _vec_for_h3(h3_r7: str) -> np.ndarray | None:
    """Return normalised TF-IDF vector for an h3_r7 cell, or None."""
    idx = state["cell_id_to_idx"].get(h3_r7)
    if idx is not None:
        return state["suburb_matrix"][idx]
    return None


@router.post("/fingerprint", response_model=FingerprintResponse)
def build_fingerprint(body: FingerprintRequest):
    cell_ids      = state["cell_ids"]
    suburb_matrix = state["suburb_matrix"]
    # ── Gold standard vector ──────────────────────────────────────────────────
    gold_vec = state.get("gold_vectors", {}).get(body.category)
    if gold_vec is None:
        gold_vec = np.mean(suburb_matrix, axis=0)
    gold_vec = gold_vec.astype(np.float32)
    gn = np.linalg.norm(gold_vec)
    gold_vec = gold_vec / (gn + 1e-9)

    # ── Geocode best locations ────────────────────────────────────────────────
    best_h3s: list[str] = []
    location_vecs: list[np.ndarray] = []
    unrecognised: list[str] = []
    resolved_suburbs: dict[str, str] = {}

    for name in body.best_locations:
        result = _geocode_suburb(name)
        if result is None:
            unrecognised.append(name)
            continue
        h3_id, _, _, resolved_name = result
        resolved_suburbs[name] = resolved_name
        best_h3s.append(h3_id)
        vec = _vec_for_h3(h3_id)
        if vec is not None:
            location_vecs.append(vec)

    # ── Geocode worst locations ───────────────────────────────────────────────
    failure_h3s: list[str] = []
    failure_vecs: list[np.ndarray] = []

    for name in body.worst_locations:
        result = _geocode_suburb(name)
        if result is None:
            unrecognised.append(name)
            continue
        h3_id, _, _, resolved_name = result
        resolved_suburbs[name] = resolved_name
        failure_h3s.append(h3_id)
        vec = _vec_for_h3(h3_id)
        if vec is not None:
            failure_vecs.append(vec)

    n_locations = len(location_vecs)

    # ── Client weight by number of valid locations ────────────────────────────
    weight_table = {0: 0.0, 1: 0.20, 2: 0.35, 3: 0.50, 4: 0.65}
    if body.mode in ("fresh", "overseas") and n_locations == 0:
        client_weight = 0.0
    elif n_locations >= 5:
        client_weight = 0.80
    else:
        client_weight = weight_table.get(n_locations, 0.0)

    # ── Blend client + gold ───────────────────────────────────────────────────
    if n_locations > 0 and client_weight > 0:
        client_avg = np.mean(location_vecs, axis=0).astype(np.float32)
        cn = np.linalg.norm(client_avg)
        client_avg = client_avg / (cn + 1e-9)
        blended = client_weight * client_avg + (1 - client_weight) * gold_vec
    else:
        client_avg = None
        blended = gold_vec.copy()

    bn = np.linalg.norm(blended)
    final_vec = blended / (bn + 1e-9)

    # ── Failure vector ────────────────────────────────────────────────────────
    failure_vector: Optional[list[float]] = None
    failure_summary: Optional[str] = None
    if failure_vecs:
        fv_avg = np.mean(failure_vecs, axis=0).astype(np.float32)
        fn = np.linalg.norm(fv_avg)
        fv_avg = fv_avg / (fn + 1e-9)
        failure_vector = [round(float(x), 6) for x in fv_avg]
        top_fail_cells = [cell_ids[i] for i in np.argsort(suburb_matrix @ fv_avg)[::-1][:20]]
        fail_ph = ", ".join(f"'{c}'" for c in top_fail_cells)
        fail_cats = [r[0] for r in state["get_con"]().execute(f"""
            SELECT category_label, COUNT(*) AS cnt FROM venues
            WHERE h3_r7 IN ({fail_ph}) AND is_closed = false
              AND category_label IS NOT NULL
            GROUP BY category_label ORDER BY cnt DESC LIMIT 3
        """).fetchall()]
        failure_summary = (
            "Struggling locations tend to be near: " + ", ".join(fail_cats) + "."
            if fail_cats else "Failure pattern identified."
        )

    # ── Gold standard match ───────────────────────────────────────────────────
    gold_match = float(
        cosine_similarity(final_vec.reshape(1, -1), gold_vec.reshape(1, -1))[0][0]
    )
    gold_match = float(np.clip(gold_match, 0, 1))

    # ── Top 20 matching suburbs (for gold stars on scatter) ───────────────────
    sims = suburb_matrix @ final_vec
    top20_idx = np.argsort(sims)[::-1][:20]
    top_suburb_h3s = [cell_ids[i] for i in top20_idx]

    # ── Top categories from actual venue data in gold-standard suburbs ───────
    # Query the most common venue category_labels from the top-matching suburbs
    # rather than exposing raw TF-IDF tokens to the UI.
    top_cell_ids = [cell_ids[i] for i in np.argsort(suburb_matrix @ final_vec)[::-1][:50]]
    placeholders = ", ".join(f"'{c}'" for c in top_cell_ids)
    cat_rows = state["get_con"]().execute(f"""
        SELECT category_label, COUNT(*) AS cnt
        FROM venues
        WHERE h3_r7 IN ({placeholders})
          AND is_closed = false
          AND category_label IS NOT NULL
          AND category_label NOT ILIKE '%road%'
          AND category_label NOT ILIKE '%bus stop%'
        GROUP BY category_label
        ORDER BY cnt DESC
        LIMIT 8
    """).fetchall()
    total_cat = sum(r[1] for r in cat_rows) or 1
    top_categories = [
        {"category": row[0], "weight": round(row[1] / total_cat, 4)}
        for row in cat_rows
    ]

    # ── DNA summary (AI-generated) ────────────────────────────────────────────
    # gap_cats computed below alongside improvement_hint, so we defer the
    # narrative call until after the gap analysis block.

    # ── Improvement hint ──────────────────────────────────────────────────────
    # Compare gold-standard suburbs vs client suburbs by actual venue category mix
    gold_top_ids = [cell_ids[i] for i in np.argsort(suburb_matrix @ gold_vec)[::-1][:30]]
    if top_cell_ids and gold_top_ids:
        gold_ph = ", ".join(f"'{c}'" for c in gold_top_ids)
        client_ph = ", ".join(f"'{c}'" for c in top_cell_ids[:30])
        gold_mix = {r[0]: r[1] for r in state["get_con"]().execute(f"""
            SELECT category_label, COUNT(*) FROM venues
            WHERE h3_r7 IN ({gold_ph}) AND is_closed = false
              AND category_label IS NOT NULL GROUP BY category_label
        """).fetchall()}
        client_mix = {r[0]: r[1] for r in state["get_con"]().execute(f"""
            SELECT category_label, COUNT(*) FROM venues
            WHERE h3_r7 IN ({client_ph}) AND is_closed = false
              AND category_label IS NOT NULL GROUP BY category_label
        """).fetchall()}
        gold_total = sum(gold_mix.values()) or 1
        client_total = sum(client_mix.values()) or 1
        gaps = sorted(
            [(cat, gold_mix[cat] / gold_total - client_mix.get(cat, 0) / client_total)
             for cat in gold_mix if gold_mix[cat] / gold_total > 0.01],
            key=lambda x: -x[1]
        )[:3]
        gap_cats = [g[0] for g in gaps if g[1] > 0.005]
    else:
        gap_cats = []

    # ── Data confidence ───────────────────────────────────────────────────────
    if n_locations >= 5:
        data_confidence = "HIGH"
    elif n_locations >= 2:
        data_confidence = "MEDIUM"
    else:
        data_confidence = "LOW"

    # ── AI-generated narrative (all card text) ────────────────────────────────
    narrative = generate_dna_narrative(
        mode=body.mode,
        category=body.category,
        top_categories=top_categories,
        n_locations=n_locations,
        gold_standard_match_pct=int(round(gold_match * 100)),
        client_weight=round(client_weight, 2),
        data_confidence=data_confidence,
        gap_cats=gap_cats,
        resolved_suburbs=resolved_suburbs,
        failure_summary=failure_summary,
    )
    dna_summary      = narrative.dna_summary
    improvement_hint = narrative.improvement_hint

    # ── Project client locations into UMAP space ──────────────────────────────
    reducer = state.get("reducer")
    client_umap_points: list[dict] = []
    if reducer is None:
        log.debug("UMAP reducer not available — skipping client projection")
    elif location_vecs:
        expected = getattr(reducer, "n_features_in_", None)
        actual   = location_vecs[0].shape[0]
        if expected is not None and expected != actual:
            log.warning(
                f"UMAP dimension mismatch: reducer expects {expected} features, "
                f"vector has {actual} — skipping projection"
            )
        else:
            for vec in location_vecs:
                try:
                    pt = reducer.transform(vec.reshape(1, -1))
                    client_umap_points.append({
                        "umap_x": float(pt[0][0]),
                        "umap_y": float(pt[0][1]),
                    })
                except Exception as exc:
                    log.warning(f"UMAP transform failed: {exc}")
                    break  # if one fails they'll all fail

    # ── Persist state for downstream /scan fallback ───────────────────────────
    state["current_dna"] = final_vec.reshape(1, -1)

    return FingerprintResponse(
        top_categories=top_categories,
        dna_summary=dna_summary,
        top_suburb_h3s=top_suburb_h3s,
        n_locations=n_locations,
        mode=body.mode,
        success_vector=[round(float(x), 6) for x in final_vec],
        failure_vector=failure_vector,
        failure_summary=failure_summary,
        failure_h3s=failure_h3s,
        gold_standard_match=round(gold_match, 4),
        gold_standard_match_pct=int(round(gold_match * 100)),
        improvement_hint=improvement_hint,
        client_weight=round(client_weight, 2),
        data_confidence=data_confidence,
        client_umap_points=client_umap_points,
        unrecognised_suburbs=unrecognised,
        resolved_suburbs=resolved_suburbs,
        client_mean_gold_similarity=round(gold_match, 4),
        explainer_dna=narrative.explainer_dna,
        explainer_opportunities=narrative.explainer_opportunities,
        explainer_comparison=narrative.explainer_comparison,
        explainer_locations=narrative.explainer_locations,
        explainer_risk=narrative.explainer_risk,
    )
