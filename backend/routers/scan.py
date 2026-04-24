"""
GET /scan?category=Café&limit=200

Returns pre-computed suburb_scores with optional runtime re-ranking when a
client DNA vector is supplied.  suburb_scores already contains locality, state,
lat, lon — only umap_coords needs a JOIN.
"""

from __future__ import annotations

import json
from typing import Optional

import numpy as np
from fastapi import APIRouter, Query
from pydantic import BaseModel

from state import state

router = APIRouter()

# Map real trajectory values → frontend-expected labels
_TRAJ_MAP = {
    "OPEN":              "GROWING",
    "CLOSING":           "NARROWING",
    "INSUFFICIENT_DATA": "STABLE",
}


class SuburbResult(BaseModel):
    h3_r7: str
    locality: str
    state: str
    center_lat: float
    center_lon: float
    score: float                    # composite_score / 100
    score_fingerprint: float
    score_trajectory: float
    score_competition: float
    score_diversity: float
    score_risk: float
    venue_count: int
    category: str
    tier: str
    trajectory_status: str          # GROWING | STABLE | NARROWING
    risk_level: str
    is_better_than_best: bool
    btb_reason: Optional[str] = None  # "benchmark" | "discovery" | None
    gold_std_similarity: float
    competitor_count: int
    data_confidence: str
    failure_similarity: Optional[float] = None
    umap_x: Optional[float] = None
    umap_y: Optional[float] = None


class ScanResponse(BaseModel):
    suburbs: list[SuburbResult]
    better_than_best_count: int
    prime_count: int
    total: int
    tier_counts: dict[str, int]


class ScanRequest(BaseModel):
    """POST body for /scan — avoids URL length limits with large vectors."""
    category: str
    region: Optional[str] = None
    client_mean_gold: Optional[float] = None
    success_vector: Optional[list[float]] = None
    failure_vector: Optional[list[float]] = None
    limit: int = 200
    min_score: float = 0.0


def _tier_from_score(s: float, is_btb: bool = False) -> str:
    """
    Assign tier from composite score.

    BETTER_THAN_BEST is only awarded when the suburb genuinely beats the
    client's own best location (is_btb=True).  Without a client benchmark
    we never produce BTB — callers who don't have a benchmark should pass
    is_btb=False (the default), which collapses the top band into STRONG.

    Thresholds (score is 0-1):
      BTB   : is_btb=True  AND score ≥ 0.60
      STRONG: score ≥ 0.60 (when not BTB)
      WATCH : 0.40 – 0.59
      AVOID : < 0.40
    """
    pct = s * 100
    if is_btb and pct >= 60:
        return "BETTER_THAN_BEST"
    if pct >= 60:
        return "STRONG"
    if pct >= 40:
        return "WATCH"
    return "AVOID"


def _scan_impl(
    category: str,
    region: Optional[str],
    client_mean_gold: Optional[float],
    sv: np.ndarray | None,
    fv: np.ndarray | None,
    limit: int,
    min_score: float,
) -> ScanResponse:
    con = state["get_con"]()
    suburb_matrix = state["suburb_matrix"]
    cell_id_to_idx = state["cell_id_to_idx"]

    # suburb_scores already carries locality/state/lat/lon — no suburb_cells JOIN needed
    query = """
        SELECT
            ss.cell_id,
            COALESCE(ss.locality, ss.cell_id)  AS locality,
            COALESCE(ss.state, 'AU')            AS state,
            ss.lat,
            ss.lon,
            ss.composite_score,
            ss.fingerprint_score,
            ss.trajectory_score,
            ss.competition_score,
            ss.diversity_score,
            ss.risk_score,
            ss.venue_count,
            ss.category,
            ss.tier,
            ss.trajectory_status,
            ss.risk_level,
            ss.is_better_than_best,
            ss.gold_std_similarity,
            ss.competitor_count,
            ss.data_confidence,
            uc.umap_x,
            uc.umap_y
        FROM suburb_scores ss
        LEFT JOIN umap_coords uc ON uc.h3_r7 = ss.cell_id
        WHERE LOWER(REPLACE(ss.category, 'é', 'e')) = LOWER(REPLACE(?, 'é', 'e'))
          AND ss.composite_score >= ?
    """
    # composite_score is an integer 0-100; convert min_score (0-1 float) accordingly
    params: list = [category, int(min_score * 100)]

    if region and region != "All Australia":
        query += " AND ss.state = ?"
        params.append(region)

    query += " ORDER BY ss.composite_score DESC"

    rows = con.execute(query, params).fetchall()

    suburbs: list[SuburbResult] = []
    for r in rows:
        cell_id   = r[0]
        score     = (r[5] or 0) / 100.0
        fp_score  = (r[6] or 0) / 100.0
        s_traj    = (r[7] or 0) / 100.0
        s_comp    = (r[8] or 0) / 100.0
        s_div     = (r[9] or 0) / 100.0
        s_risk    = (r[10] or 0) / 100.0
        gold_sim  = r[17] or 0.0
        failure_sim: Optional[float] = None

        traj_status = _TRAJ_MAP.get(r[14] or "INSUFFICIENT_DATA", "STABLE")

        # Runtime re-ranking when client vector is provided
        if sv is not None:
            idx = cell_id_to_idx.get(cell_id)
            if idx is not None:
                suburb_vec = suburb_matrix[idx]
                fp_score = float(np.clip(np.dot(suburb_vec, sv), 0, 1))

                if fv is not None:
                    failure_sim = float(np.clip(np.dot(suburb_vec, fv), 0, 1))

                score = float(np.clip(
                    0.30 * fp_score
                    + 0.25 * s_traj
                    + 0.20 * s_div
                    + 0.15 * s_risk
                    + 0.10 * s_comp,
                    0, 1,
                ))

                if failure_sim and failure_sim > 0.85:
                    score = max(0.0, score - 0.25)
                elif failure_sim and failure_sim > 0.70:
                    score = max(0.0, score - 0.15)

        # ── Better Than Best: two independent pathways ───────────────────────
        # Market opportunity score — independent of DNA/fingerprint match.
        # Uses only s_traj, s_comp, s_div, s_risk (never fp_score) so that
        # discovery candidates are not penalised for low DNA similarity.
        market_opportunity = (s_traj + s_comp + s_div + s_risk) / 4.0

        btb_reason: Optional[str] = None

        # Pathway 1 – Benchmark: suburb's gold-standard similarity exceeds the
        # client's own average (i.e., this suburb is closer to the gold
        # standard than the client's current portfolio).
        beats_benchmark = (
            client_mean_gold is not None
            and bool(gold_sim > client_mean_gold)
            and score >= 0.60
        )

        # Pathway 2 – Discovery: strong market fundamentals + high composite
        # score regardless of DNA similarity.  Threshold is tighter than
        # STRONG to surface only genuinely exceptional markets.
        is_discovery = market_opportunity >= 0.68 and score >= 0.68

        if beats_benchmark:
            is_btb = True
            btb_reason = "benchmark"
        elif is_discovery:
            is_btb = True
            btb_reason = "discovery"
        else:
            is_btb = False
            btb_reason = None

        tier = _tier_from_score(score, is_btb=is_btb)

        suburbs.append(SuburbResult(
            h3_r7=cell_id,
            locality=r[1],
            state=r[2],
            center_lat=r[3] or 0.0,
            center_lon=r[4] or 0.0,
            score=round(score, 4),
            score_fingerprint=round(fp_score, 4),
            score_trajectory=round(s_traj, 4),
            score_competition=round(s_comp, 4),
            score_diversity=round(s_div, 4),
            score_risk=round(s_risk, 4),
            venue_count=r[11] or 0,
            category=r[12],
            tier=tier,
            trajectory_status=traj_status,
            risk_level=r[15] or "MODERATE",
            is_better_than_best=is_btb,
            btb_reason=btb_reason,
            gold_std_similarity=round(gold_sim, 4),
            competitor_count=r[18] or 0,
            data_confidence=r[19] or "MEDIUM",
            failure_similarity=round(failure_sim, 4) if failure_sim is not None else None,
            umap_x=r[20],
            umap_y=r[21],
        ))

    # Sort all results by score descending before bucketing
    suburbs.sort(key=lambda s: s.score, reverse=True)
    true_total = len(suburbs)

    # Count tiers across the full unfiltered set
    tier_counts: dict[str, int] = {
        "BETTER_THAN_BEST": 0, "STRONG": 0, "WATCH": 0, "AVOID": 0,
    }
    for s in suburbs:
        if s.tier in tier_counts:
            tier_counts[s.tier] += 1

    # Return top `limit` results PER TIER so every category is represented.
    # The overall result set can be up to limit * 4 rows; already sorted by score.
    tier_buckets: dict[str, list[SuburbResult]] = {
        "BETTER_THAN_BEST": [],
        "STRONG":           [],
        "WATCH":            [],
        "AVOID":            [],
    }
    for s in suburbs:
        bucket = tier_buckets.get(s.tier)
        if bucket is not None and len(bucket) < limit:
            bucket.append(s)

    balanced = [s for bucket in tier_buckets.values() for s in bucket]
    balanced.sort(key=lambda s: s.score, reverse=True)

    return ScanResponse(
        suburbs=balanced,
        better_than_best_count=tier_counts.get("BETTER_THAN_BEST", 0),
        prime_count=0,
        total=true_total,
        tier_counts=tier_counts,
    )


@router.get("/scan", response_model=ScanResponse)
def scan_suburbs_get(
    category: str = Query(...),
    region: Optional[str] = Query(None),
    client_mean_gold: Optional[float] = Query(None),
    success_vector: Optional[str] = Query(None),   # JSON array
    failure_vector: Optional[str] = Query(None),   # JSON array
    limit: int = Query(200, ge=1, le=500),
    min_score: float = Query(0.0),
):
    """GET /scan — for simple queries or backward compatibility."""
    sv = np.array(json.loads(success_vector), dtype=np.float32) if success_vector else None
    fv = np.array(json.loads(failure_vector), dtype=np.float32) if failure_vector else None
    return _scan_impl(category, region, client_mean_gold, sv, fv, limit, min_score)


@router.post("/scan", response_model=ScanResponse)
def scan_suburbs_post(body: ScanRequest):
    """POST /scan — use when success_vector/failure_vector are large."""
    sv = np.array(body.success_vector, dtype=np.float32) if body.success_vector else None
    fv = np.array(body.failure_vector, dtype=np.float32) if body.failure_vector else None
    return _scan_impl(
        body.category, body.region, body.client_mean_gold,
        sv, fv, body.limit, body.min_score,
    )
