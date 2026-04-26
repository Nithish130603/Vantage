"""
GET  /location/{h3_r7}?category=Café    — pre-computed scores (backward compat)
POST /location/{h3_r7}                  — personalised: recomputes fingerprint +
                                          composite from the user's DNA vector;
                                          fetches real-time monthly series from venues.
"""

from __future__ import annotations

import json as json_lib
from typing import Any, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from state import state
from narrative import generate_location_insights

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
    signal_insight: str = ""   # AI-generated plain-English interpretation


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
    ai_recommendation: str = ""   # AI-generated recommendation
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

    # ── AI-generated signal insights + recommendation ─────────────────────────
    location_narrative = generate_location_insights(
        locality=locality,
        state=state_code,
        category=category,
        composite_score=round(composite, 4),
        tier=tier,
        signals=[{"name": s.name, "score": s.score, "badge": s.badge} for s in signals],
        top_categories=top_cats,
        competitor_count=comp_count,
        data_confidence=data_conf,
    )
    for sig in signals:
        sig.signal_insight = location_narrative["signal_insights"].get(sig.name, "")

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
        ai_recommendation=location_narrative["recommendation"],
        monthly_series=monthly_series,
        signals=signals,
        top_categories=top_cats,
    )


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _fetch_db_row(con, h3_r7: str, category: str):
    """Return the raw suburb_scores row or raise 404."""
    row = con.execute("""
        SELECT
            ss.composite_score, ss.tier,
            ss.fingerprint_score, ss.trajectory_score, ss.trajectory_status,
            ss.competition_score, ss.competitor_count, ss.cluster_gap_description,
            ss.diversity_score,
            ss.risk_score, ss.risk_level, ss.top_risk_factors,
            ss.data_confidence, ss.recommendation,
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
    return row


def _real_monthly_series(con, h3_r7: str) -> list[dict]:
    """
    Compute month-by-month venue creation across all available history.
    Uses all date_created data (no cutoff) so sparse suburbs still get a full
    picture. Closure counts added where date_closed is available.
    Returns [{month, created, closed, net}, ...] sorted ascending.
    """
    rows = con.execute("""
        SELECT
            strftime(CAST(date_created AS DATE), '%Y-%m') AS month,
            COUNT(*) AS created
        FROM venues
        WHERE h3_r7 = ?
          AND date_created IS NOT NULL
        GROUP BY 1
        ORDER BY 1
    """, [h3_r7]).fetchall()

    closed_rows = con.execute("""
        SELECT
            strftime(CAST(date_closed AS DATE), '%Y-%m') AS month,
            COUNT(*) AS closed
        FROM venues
        WHERE h3_r7 = ?
          AND date_closed IS NOT NULL
        GROUP BY 1
    """, [h3_r7]).fetchall()
    closed_by_month = {r[0]: r[1] for r in closed_rows}

    series = []
    for r in rows:
        month = r[0]
        created = r[1]
        closed = closed_by_month.get(month, 0)
        series.append({
            "month":   month,
            "created": created,
            "closed":  closed,
            "net":     created - closed,
        })
    return series


def _compute_trajectory(monthly_series: list[dict]) -> tuple[float, str]:
    """
    Real-time trajectory score from live monthly venue data.
    Compares recent 12-month activity vs the historical baseline.
    Returns (score 0-1, status label).
    """
    if len(monthly_series) < 4:
        return 0.5, "INSUFFICIENT_DATA"

    vals = [d.get("net", d.get("created", d.get("count", 0))) for d in monthly_series]
    n = len(vals)

    recent = vals[-min(12, n):]
    baseline = vals[:-min(12, n)] if n > 12 else vals

    recent_mean = sum(recent) / len(recent)
    base_mean = sum(baseline) / len(baseline) if baseline else recent_mean

    # Kendall-tau trend on the recent window
    concordant = discordant = 0
    for i in range(len(recent) - 1):
        for j in range(i + 1, len(recent)):
            if recent[j] > recent[i]:
                concordant += 1
            elif recent[j] < recent[i]:
                discordant += 1
    pairs = len(recent) * (len(recent) - 1) / 2
    tau = (concordant - discordant) / pairs if pairs > 0 else 0.0

    base_ref = max(abs(base_mean), 0.1)
    change_ratio = (recent_mean - base_mean) / base_ref

    if tau > 0.25 or change_ratio > 0.20:
        score = min(0.5 + abs(tau) * 0.35 + max(change_ratio, 0) * 0.15, 1.0)
        status = "OPEN"
    elif tau < -0.25 or change_ratio < -0.20:
        score = max(0.5 - abs(tau) * 0.35 - max(-change_ratio, 0) * 0.15, 0.0)
        status = "CLOSING"
    else:
        score = 0.5
        status = "STABLE"

    return round(score, 3), status


def _compute_competition(con, h3_r7: str, category: str) -> tuple[int, float, str]:
    """
    Real-time competition score: counts live same-category venues in this cell.
    Returns (competitor_count, score 0-1, description).
    Higher score = better (fewer competitors = more opportunity).
    """
    row = con.execute("""
        SELECT COUNT(*) FROM venues
        WHERE h3_r7 = ?
          AND is_closed = false
          AND LOWER(REPLACE(category_label, 'é', 'e')) = LOWER(REPLACE(?, 'é', 'e'))
    """, [h3_r7, category]).fetchone()
    count = row[0] if row else 0

    if count == 0:
        score = 1.0
        desc = "First-mover opportunity — no direct competitors found in this area"
    elif count <= 2:
        score = 0.80
        desc = f"{count} competitor{'s' if count != 1 else ''} nearby — low competition, good room to establish"
    elif count <= 5:
        score = 0.60
        desc = f"{count} competitors nearby — moderate competition, differentiation is key"
    elif count <= 10:
        score = 0.35
        desc = f"{count} competitors nearby — high competition, location needs a strong point of difference"
    else:
        score = max(0.10, 0.35 - (count - 10) * 0.02)
        desc = f"{count} competitors nearby — heavily saturated market"

    return count, round(score, 3), desc


def _build_signals(
    fp_score: float, traj_score: float, traj_label: str,
    comp_score: float, comp_count: int, cluster_desc: str,
    div_score: float, risk_score: float, risk_level: str,
    risk_chart: list[dict], fp_chart: list[dict], monthly_series: list[dict],
    top_cats: list[dict],
) -> list[SignalDetail]:
    return [
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
            description=(
                f"Based on {len(monthly_series)} months of venue creation data"
                + (f" ({monthly_series[0]['month']} – {monthly_series[-1]['month']})" if monthly_series else "")
                + ". A growing market means more foot traffic and lower vacancy risk."
            ),
            chart_data=monthly_series,
        ),
        SignalDetail(
            name="Competitive Pressure",
            score=round(comp_score, 3),
            badge=f"{comp_count} competitor{'s' if comp_count != 1 else ''}",
            description=cluster_desc,
            chart_data=([{"category": "Direct competitors", "count": comp_count}] + top_cats[:5])
            if comp_count > 0
            else top_cats[:6],
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


# ── POST /location/{h3_r7} — personalised ─────────────────────────────────────

class LocationRequest(BaseModel):
    category: str
    success_vector: Optional[list[float]] = None
    failure_vector: Optional[list[float]] = None


@router.post("/location/{h3_r7}", response_model=LocationDetail)
def get_location_personalised(h3_r7: str, body: LocationRequest):
    """
    Personalised location detail.
    When success_vector is supplied the fingerprint score (and composite score)
    are recomputed at runtime using the user's actual DNA, not the generic
    pre-computed value.  Monthly series is always fetched live from the venues
    table so it reflects the real 36-month creation/closure history.
    """
    con = state["get_con"]()
    row = _fetch_db_row(con, h3_r7, body.category)

    div_score     = (row[8] or 0) / 100.0
    risk_score    = (row[9] or 0) / 100.0
    risk_level    = row[10] or "MEDIUM"
    data_conf     = row[12] or "MEDIUM"
    recommendation = row[13] or ""
    venue_count   = row[14] or 0
    locality      = row[15]
    state_code    = row[16]
    lat           = row[17] or 0.0
    lon           = row[18] or 0.0

    # ── Personalised fingerprint score ─────────────────────────────────────────
    fp_score = (row[2] or 0) / 100.0   # fallback to generic pre-computed value
    if body.success_vector:
        sv = np.array(body.success_vector, dtype=np.float32)
        idx = state["cell_id_to_idx"].get(h3_r7)
        if idx is not None:
            suburb_vec = state["suburb_matrix"][idx]
            fp_score = float(np.clip(np.dot(suburb_vec, sv), 0.0, 1.0))

    # ── Personalised failure penalty ───────────────────────────────────────────
    failure_penalty = 0.0
    if body.failure_vector and body.success_vector:
        fv = np.array(body.failure_vector, dtype=np.float32)
        idx = state["cell_id_to_idx"].get(h3_r7)
        if idx is not None:
            failure_sim = float(np.clip(np.dot(state["suburb_matrix"][idx], fv), 0.0, 1.0))
            if failure_sim > 0.85:
                failure_penalty = 0.25
            elif failure_sim > 0.70:
                failure_penalty = 0.15

    # ── Real-time monthly series ───────────────────────────────────────────────
    monthly_series = _real_monthly_series(con, h3_r7)

    # ── Real-time trajectory from live monthly data ────────────────────────────
    traj_score, traj_raw = _compute_trajectory(monthly_series)
    traj_label = _TRAJ_MAP.get(traj_raw, "STABLE")

    # ── Real-time competition from live venues ─────────────────────────────────
    comp_count, comp_score, cluster_desc = _compute_competition(con, h3_r7, body.category)

    # ── Recompute composite with all real-time scores ──────────────────────────
    composite = float(np.clip(
        0.30 * fp_score
        + 0.25 * traj_score
        + 0.20 * div_score
        + 0.15 * risk_score
        + 0.10 * comp_score
        - failure_penalty,
        0.0, 1.0,
    ))

    # ── Top categories from live venues ───────────────────────────────────────
    top_cats_rows = con.execute("""
        SELECT category_label, count(*) AS cnt
        FROM venues
        WHERE h3_r7 = ? AND is_closed = false AND category_label IS NOT NULL
        GROUP BY category_label
        ORDER BY cnt DESC
        LIMIT 12
    """, [h3_r7]).fetchall()
    top_cats = [{"category": r[0], "count": r[1]} for r in top_cats_rows]

    # ── Risk chart ─────────────────────────────────────────────────────────────
    risk_chart: list[dict] = []
    top_risk_raw = row[11]
    if top_risk_raw:
        try:
            factors = json_lib.loads(top_risk_raw)
            risk_chart = [{"category": f, "count": 1} for f in factors]
        except Exception:
            pass
    if not risk_chart:
        risk_chart = [{"category": f"Risk {round(risk_score * 100)}/100", "count": round(risk_score * 100)}]

    fp_chart = [{"category": c["category"], "count": c["count"]} for c in top_cats[:8]]

    tier = (
        "BETTER_THAN_BEST" if composite >= 0.68 else
        "STRONG"           if composite >= 0.60 else
        "WATCH"            if composite >= 0.40 else
        "AVOID"
    )

    signals = _build_signals(
        fp_score, traj_score, traj_label,
        comp_score, comp_count, cluster_desc,
        div_score, risk_score, risk_level,
        risk_chart, fp_chart, monthly_series, top_cats,
    )

    # ── AI-generated signal insights + recommendation ─────────────────────────
    location_narrative = generate_location_insights(
        locality=locality,
        state=state_code,
        category=body.category,
        composite_score=round(composite, 4),
        tier=tier,
        signals=[{"name": s.name, "score": s.score, "badge": s.badge} for s in signals],
        top_categories=top_cats,
        competitor_count=comp_count,
        data_confidence=data_conf,
    )
    for sig in signals:
        sig.signal_insight = location_narrative["signal_insights"].get(sig.name, "")

    return LocationDetail(
        h3_r7=h3_r7,
        center_lat=lat,
        center_lon=lon,
        venue_count=venue_count,
        locality=locality,
        state=state_code,
        category=body.category,
        composite_score=round(composite, 4),
        tier=tier,
        data_confidence=data_conf,
        competitor_count=comp_count,
        cluster_gap_description=cluster_desc,
        recommendation=recommendation,
        ai_recommendation=location_narrative["recommendation"],
        monthly_series=monthly_series,
        signals=signals,
        top_categories=top_cats,
    )
