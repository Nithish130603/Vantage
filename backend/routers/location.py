"""
GET /location/{h3_r7}?category=Café

Full location detail using real pre-computed scores from suburb_scores.
"""

from __future__ import annotations

import json as json_lib
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from state import state

router = APIRouter()

_TRAJ_MAP = {
    "OPEN":              "GROWING",
    "CLOSING":           "NARROWING",
    "INSUFFICIENT_DATA": "STABLE",
}


class SignalDetail(BaseModel):
    name: str
    score: float          # 0–1
    description: str
    badge: str
    chart_data: list[dict[str, Any]]


class LocationDetail(BaseModel):
    h3_r7: str
    center_lat: float
    center_lon: float
    venue_count: int
    locality: str
    state: str
    category: str
    composite_score: float        # 0–1
    tier: str
    data_confidence: str
    competitor_count: int
    cluster_gap_description: str
    recommendation: str
    monthly_series: list[dict[str, Any]]
    signals: list[SignalDetail]
    top_categories: list[dict[str, Any]]


@router.get("/location/{h3_r7}", response_model=LocationDetail)
def get_location(
    h3_r7: str,
    category: str = Query(...),
):
    con = state["get_con"]()

    row = con.execute("""
        SELECT
            ss.composite_score, ss.tier,
            ss.fingerprint_score, ss.trajectory_score, ss.trajectory_status,
            ss.competition_score, ss.competitor_count, ss.cluster_gap_description,
            ss.diversity_score,
            ss.risk_score, ss.risk_level, ss.top_risk_factors,
            ss.data_confidence, ss.recommendation, ss.monthly_series,
            ss.venue_count,
            COALESCE(ss.locality, ss.cell_id) AS locality,
            COALESCE(ss.state, 'AU') AS state,
            ss.lat, ss.lon
        FROM suburb_scores ss
        WHERE ss.cell_id = ?
          AND LOWER(REPLACE(ss.category, 'é', 'e')) = LOWER(REPLACE(?, 'é', 'e'))
    """, [h3_r7, category]).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"{h3_r7} / {category} not found")

    composite     = (row[0] or 0) / 100.0
    tier          = row[1] or "WATCH"
    fp_score      = (row[2] or 0) / 100.0
    traj_score    = (row[3] or 0) / 100.0
    traj_raw      = row[4] or "INSUFFICIENT_DATA"
    comp_score    = (row[5] or 0) / 100.0
    comp_count    = row[6] or 0
    cluster_desc  = row[7] or "No data"
    div_score     = (row[8] or 0) / 100.0
    risk_score    = (row[9] or 0) / 100.0
    risk_level    = row[10] or "MEDIUM"
    data_conf     = row[12] or "MEDIUM"
    recommendation = row[13] or ""
    monthly_json  = row[14]
    venue_count   = row[15] or 0
    locality      = row[16]
    state_code    = row[17]
    lat           = row[18] or 0.0
    lon           = row[19] or 0.0

    traj_label = _TRAJ_MAP.get(traj_raw, "STABLE")

    monthly_series: list[dict] = []
    if monthly_json:
        try:
            monthly_series = json_lib.loads(monthly_json)
        except Exception:
            pass

    # Top category mix for this cell from venues
    top_cats_rows = con.execute("""
        SELECT category_label, count(*) AS cnt
        FROM venues
        WHERE h3_r7 = ? AND is_closed = false AND category_label IS NOT NULL
        GROUP BY category_label
        ORDER BY cnt DESC
        LIMIT 12
    """, [h3_r7]).fetchall()
    top_cats = [{"category": r[0], "count": r[1]} for r in top_cats_rows]

    # Risk factors chart — parse the JSON text from DB
    risk_chart: list[dict] = []
    top_risk_raw = row[11]
    if top_risk_raw:
        try:
            factors = json_lib.loads(top_risk_raw)
            risk_chart = [{"label": f, "value": 1} for f in factors]
        except Exception:
            pass
    if not risk_chart:
        risk_chart = [
            {"label": f"Risk score: {round(risk_score * 100)}/100", "value": round(risk_score * 100)},
        ]

    # Fingerprint match chart — top surrounding categories as evidence
    fp_chart = [{"category": c["category"], "count": c["count"]} for c in top_cats[:8]]

    signals = [
        SignalDetail(
            name="Fingerprint Match",
            score=round(fp_score, 3),
            badge=f"{round(fp_score * 100)}%",
            description="How closely this suburb's surrounding businesses match the commercial ecosystem your franchise thrives in",
            chart_data=fp_chart,
        ),
        SignalDetail(
            name="Market Trajectory",
            score=round(traj_score, 3),
            badge=traj_label,
            description="Whether new businesses are opening here — a growing market means more foot traffic and lower vacancy risk",
            chart_data=monthly_series,
        ),
        SignalDetail(
            name="Competitive Pressure",
            score=round(comp_score, 3),
            badge="LOW" if comp_score >= 0.65 else "MEDIUM" if comp_score >= 0.40 else "HIGH",
            description=cluster_desc,
            chart_data=[{"label": "Competitors", "value": comp_count}],
        ),
        SignalDetail(
            name="Ecosystem Diversity",
            score=round(div_score, 3),
            badge=f"{round(div_score * 100)}%",
            description="How varied the local business mix is — diverse neighbourhoods generate more cross-category foot traffic",
            chart_data=top_cats[:8],
        ),
        SignalDetail(
            name="Risk Signals",
            score=round(risk_score, 3),
            badge=risk_level,
            description="Composite of how many businesses have closed here, how saturated the category is, and how stable the market has been",
            chart_data=risk_chart,
        ),
    ]

    return LocationDetail(
        h3_r7=h3_r7,
        center_lat=lat,
        center_lon=lon,
        venue_count=venue_count,
        locality=locality,
        state=state_code,
        category=category,
        composite_score=round(composite, 4),
        tier=tier,
        data_confidence=data_conf,
        competitor_count=comp_count,
        cluster_gap_description=cluster_desc,
        recommendation=recommendation,
        monthly_series=monthly_series,
        signals=signals,
        top_categories=top_cats,
    )
