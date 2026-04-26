"""
POST /report/pdf
Plain-English franchise location report written by an AI real estate advisor.
Designed for franchise founders with no data background — readable, decisive, professional.
"""

from __future__ import annotations

import io
import os
from datetime import date
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from state import state
from routers.location import (
    _real_monthly_series, _compute_trajectory, _compute_competition,
)

router = APIRouter()


def _run_comparison_agent(
    category: str,
    h3_r7_list: list[str],
    fingerprint_result: dict | None,
    top_categories: list[dict] | None,
) -> dict:
    """Invoke the LangGraph comparison_agent for an AI-driven head-to-head."""
    if not os.environ.get("COHERE_API_KEY") or len(h3_r7_list) < 2:
        return {}
    try:
        from agents.graph import vantage_graph
        fp_payload = fingerprint_result or {}
        if not fp_payload and top_categories:
            fp_payload = {"top_categories": top_categories}
        graph_state = {
            "messages": [],
            "task": "compare",
            "next_agent": "",
            "completed": [],
            "category": category,
            "h3_r7": None,
            "h3_r7_list": h3_r7_list,
            "fingerprint_result": fp_payload,
            "user_question": None,
            "conversation_history": None,
            "eda_insights": None,
            "statistician_report": None,
            "confidence_badges": None,
            "dna_narrative": None,
            "opportunity_analysis": None,
            "risk_assessment": None,
            "comparison_result": None,
            "chat_response": None,
            "report_sections": None,
            "final_output": None,
        }
        result = vantage_graph.invoke(graph_state)
        return result.get("comparison_result") or {}
    except Exception:
        return {}


class SavedSuburb(BaseModel):
    h3_r7: str
    locality: str
    state: str
    score: Optional[float] = None


class ReportRequest(BaseModel):
    h3_r7: str
    category: str
    scan_score: Optional[int] = None
    is_btb: Optional[bool] = None
    btb_reason: Optional[str] = None
    success_vector: Optional[list[float]] = None
    failure_vector: Optional[list[float]] = None
    saved_suburbs: Optional[list[SavedSuburb]] = None
    dna_summary: Optional[str] = None
    top_categories: Optional[list[dict]] = None


# ── Real-time data fetch ─────────────────────────────────────────────────────

_TRAJ_MAP = {"OPEN": "GROWING", "CLOSING": "NARROWING", "INSUFFICIENT_DATA": "STABLE"}


def _fetch_location_data(con, h3_r7: str, category: str,
                          success_vector=None, failure_vector=None) -> dict | None:
    row = con.execute("""
        SELECT ss.fingerprint_score, ss.diversity_score, ss.risk_score,
               ss.risk_level, ss.data_confidence, ss.venue_count,
               COALESCE(ss.locality, ss.cell_id) AS locality,
               COALESCE(ss.state, 'AU') AS state
        FROM suburb_scores ss
        WHERE ss.cell_id = ?
          AND LOWER(REPLACE(ss.category, 'é', 'e')) = LOWER(REPLACE(?, 'é', 'e'))
    """, [h3_r7, category]).fetchone()
    if not row:
        return None

    monthly = _real_monthly_series(con, h3_r7)
    traj_score, traj_raw = _compute_trajectory(monthly)
    comp_count, comp_score, cluster_desc = _compute_competition(con, h3_r7, category)

    fp_score = (row[0] or 0) / 100.0
    if success_vector:
        sv  = np.array(success_vector, dtype=np.float32)
        idx = state["cell_id_to_idx"].get(h3_r7)
        if idx is not None:
            fp_score = float(np.clip(np.dot(state["suburb_matrix"][idx], sv), 0.0, 1.0))

    failure_penalty = 0.0
    if failure_vector and success_vector:
        fv  = np.array(failure_vector, dtype=np.float32)
        idx = state["cell_id_to_idx"].get(h3_r7)
        if idx is not None:
            fsim = float(np.clip(np.dot(state["suburb_matrix"][idx], fv), 0.0, 1.0))
            failure_penalty = 0.25 if fsim > 0.85 else 0.15 if fsim > 0.70 else 0.0

    div_score  = (row[1] or 0) / 100.0
    risk_score = (row[2] or 0) / 100.0
    composite  = float(np.clip(
        0.30 * fp_score + 0.25 * traj_score + 0.20 * div_score
        + 0.15 * risk_score + 0.10 * comp_score - failure_penalty, 0.0, 1.0,
    ))

    return {
        "composite":    composite,
        "fp_score":     fp_score,
        "traj_score":   traj_score,
        "traj_label":   _TRAJ_MAP.get(traj_raw, "STABLE"),
        "comp_score":   comp_score,
        "comp_count":   comp_count,
        "cluster_desc": cluster_desc,
        "div_score":    div_score,
        "risk_score":   risk_score,
        "risk_level":   (row[3] or "MEDIUM"),
        "data_conf":    (row[4] or "MEDIUM"),
        "venue_count":  (row[5] or 0),
        "locality":     row[6],
        "state_code":   row[7],
        "monthly":      monthly,
    }


# ── AI narrative – senior real estate advisor, plain English ─────────────────

def _ai_narrative(
    category: str, locality: str, state_code: str,
    composite: int, tier: str, venue_count: int, data_conf: str,
    fp_score: float, traj_score: float, traj_label: str,
    monthly_count: int, comp_score: float, comp_count: int,
    div_score: float, risk_score: float, risk_level: str,
    top_cats: list[tuple], saved_data: list[dict],
    dna_summary: str | None, top_franchise_cats: list[dict] | None,
    is_btb: bool,
) -> dict[str, str]:

    from langchain_cohere import ChatCohere
    from langchain_core.messages import HumanMessage

    llm = ChatCohere(
        model="command-a-03-2025",
        cohere_api_key=os.environ.get("COHERE_API_KEY", ""),
        temperature=0.45,
        max_tokens=2000,
    )

    venue_list = "\n".join(
        f"  - {n}: {c} location{'s' if c != 1 else ''}" for n, c in top_cats[:8]
    ) or "  No venue data available"

    comparison_lines = ""
    if saved_data:
        lines = []
        for s in saved_data[:4]:
            sc = round(s["score"] * 100) if s.get("score") else "N/A"
            lines.append(f"  - {s['locality']}, {s['state_code']}: scored {sc}/100, "
                         f"{s['comp_count']} competitor(s), market is {s['traj_label'].lower()}")
        comparison_lines = "OTHER AREAS BEING CONSIDERED:\n" + "\n".join(lines)

    dna_line = ""
    if dna_summary:
        dna_line = f"The franchise usually does well near: {dna_summary}"
    if top_franchise_cats:
        cats = ", ".join(c["category"] for c in top_franchise_cats[:5])
        dna_line += f"\nTypes of businesses near the franchise's best locations: {cats}"

    prompt = f"""You are Alex — a business advisor with 25 years of experience helping normal people open franchises and small businesses. You talk like a real person. Short sentences. Simple everyday words. Never use jargon. Write like you are giving advice to a friend who has never owned a business before.

Your client wants to open a {category} in {locality}, {state_code}.

THE DATA:
- Opportunity score: {composite} out of 100
- Rating: {tier.replace("_", " ")}
- Number of businesses already in this area: {venue_count}
- How reliable this data is: {data_conf}
{"- IMPORTANT: This location actually scores BETTER than the client's own existing stores!" if is_btb else ""}
{dna_line}

HOW THE SCORE WAS WORKED OUT:
- Does the area fit this type of franchise? {round(fp_score*100)}/100
- Is the market growing or shrinking? {round(traj_score*100)}/100 — currently {traj_label.lower()}
- Direct competitors nearby: {comp_count}
- Variety of businesses in the area: {round(div_score*100)}/100
- Risk from business closures: {risk_level} ({round(risk_score*100)}/100)

WHAT IS ALREADY IN THE AREA:
{venue_list}

{comparison_lines}

Write exactly 5 sections using the headings in square brackets below.

RULES:
- Use words a 14-year-old would understand
- Maximum 20 words per sentence
- Do NOT use these words: fingerprint, trajectory, ecosystem, composite, vector, algorithm, metric, leverage, synergy, nuanced, robust, dynamic, viability, commercial DNA, saturation
- Each section should be 2 to 4 sentences
- Be honest — if something is bad, say it is bad

[WHY_THIS_SCORE]
Explain in plain English why {locality} got {composite} out of 100. What does this score actually mean — is it good or bad? What was the biggest reason for this score?

[STRENGTHS]
List 2 or 3 good things about this location for a {category} business. Start each point on a new line with a dash (-). Use actual numbers from the data. Be specific.

[RISKS]
List 2 or 3 real concerns about this location. Start each point on a new line with a dash (-). Be honest. Do not make problems sound smaller than they are.

[MARKET_OUTLOOK]
Describe what the local market looks like right now. Is it growing or getting quieter? What does the mix of businesses in the area tell us? What should the client expect if they open here?

[RECOMMENDATION]
Give a clear answer: YES, NO, or MAYBE. Then give 2-3 sentences of practical advice. Tell the client exactly what to do next. Speak like a trusted friend.

[COMPARISON_VERDICT]
Only write this section if the client is comparing multiple areas (see "OTHER AREAS BEING CONSIDERED" above). If there are no other areas to compare, leave this blank.
If there are other areas: In 2-3 short sentences, tell the client which area looks best overall and why. Be direct — pick a winner and explain it simply. Do not use bullet points.
"""

    try:
        response = llm.invoke([HumanMessage(content=prompt)])
        raw = response.content if isinstance(response.content, str) else str(response.content)
    except Exception:
        raw = ""

    markers = {
        "[WHY_THIS_SCORE]":     "why_score",
        "[STRENGTHS]":          "strengths",
        "[RISKS]":              "risks",
        "[MARKET_OUTLOOK]":     "market_outlook",
        "[RECOMMENDATION]":     "recommendation",
        "[COMPARISON_VERDICT]": "comparison_verdict",
    }
    sections: dict[str, str] = {v: "" for v in markers.values()}
    current = None
    for line in raw.splitlines():
        s = line.strip()
        if s in markers:
            current = markers[s]
        elif current and s:
            sections[current] += (" " if sections[current] else "") + s

    # Robust fallbacks
    tier_label = tier.replace("_", " ").title()
    if not sections["why_score"]:
        sections["why_score"] = (
            f"{locality} scored {composite} out of 100 for {category} expansion, "
            f"putting it in the {tier_label} category. "
            + ("The area has solid fundamentals and is worth serious consideration." if composite >= 60
               else "There are some good signs here, but also real concerns to think through." if composite >= 40
               else "The data suggests this is not the right location at this time.")
        )
    if not sections["strengths"]:
        s_lines = []
        if comp_count == 0:
            s_lines.append(f"- No direct {category} competitors in the area — you could be the first one here")
        elif comp_count <= 2:
            s_lines.append(f"- Only {comp_count} direct competitor{'s' if comp_count!=1 else ''} — the market is not crowded yet")
        if traj_score >= 0.55:
            s_lines.append(f"- The local market is {traj_label.lower()} — more businesses are opening here than closing")
        if risk_score >= 0.65:
            s_lines.append("- Low risk area — businesses here tend to stay open and do well")
        sections["strengths"] = "\n".join(s_lines) or "- Limited data available — more research is needed"
    if not sections["risks"]:
        r_lines = []
        if fp_score < 0.40:
            r_lines.append(f"- The types of businesses in this area ({round(fp_score*100)}/100 match) look quite different from where this franchise usually does well")
        if div_score < 0.50:
            r_lines.append("- Not many different types of businesses nearby — foot traffic may be lower than ideal")
        if venue_count < 15:
            r_lines.append(f"- Only {venue_count} businesses in the whole area — this is a very small market")
        sections["risks"] = "\n".join(r_lines) or (
            "- Limited venue data for this area — a site visit is recommended before committing"
            if data_conf == "LOW"
            else "- No major red flags identified — this area looks broadly suitable"
        )
    if not sections["market_outlook"]:
        sections["market_outlook"] = (
            f"The market in {locality} is currently {traj_label.lower()}. "
            f"There {'are' if comp_count != 1 else 'is'} {comp_count} direct {category} "
            f"competitor{'s' if comp_count != 1 else ''} operating in this area. "
            + (f"The local business mix — mainly {', '.join(c[0] for c in top_cats[:3])} — "
               f"{'suggests decent foot traffic potential' if div_score >= 0.50 else 'suggests this is a quieter, less active area'}."
               if top_cats else "")
        )
    if not sections["comparison_verdict"] and saved_data:
        best = max(saved_data, key=lambda s: s.get("score") or 0, default=None)
        if best:
            best_score = round((best.get("score") or 0) * 100)
            if composite >= best_score:
                sections["comparison_verdict"] = (
                    f"Comparing all areas, {locality} looks like the strongest option with a score of {composite}/100. "
                    f"It scores higher than the other areas you are looking at. "
                    f"If the numbers hold up after a site visit, this would be my top pick."
                )
            else:
                sections["comparison_verdict"] = (
                    f"{best['locality']}, {best['state_code']} scores {best_score}/100 and currently looks stronger than {locality} ({composite}/100). "
                    f"That said, {locality} may still be worth visiting — a higher score does not always mean a better fit for your specific franchise. "
                    f"Go and see both areas in person before deciding."
                )

    if not sections["recommendation"]:
        if composite >= 60:
            sections["recommendation"] = (
                f"YES — {locality} looks like a solid option worth exploring further. "
                "Visit the area in person, check how busy it is at different times of day, "
                "and speak to a local property agent before making any commitments."
            )
        elif composite >= 40:
            sections["recommendation"] = (
                f"MAYBE — {locality} is not a clear yes or no right now. "
                "There are some good signs but a few things to watch closely. "
                "Go visit the area first before you decide."
            )
        else:
            sections["recommendation"] = (
                f"NO — {locality} does not score high enough to recommend right now. "
                f"At {composite}/100, there are likely better options available. "
                "Check the other areas on your shortlist first."
            )

    return sections


# ── PDF helpers ───────────────────────────────────────────────────────────────

def _bar(score_pct: int, color, width: int):
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors as rc
    filled = max(3, int(width * score_pct / 100))
    empty  = max(3, width - filled)
    t = Table([["", ""]], colWidths=[filled, empty], rowHeights=[10])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0),(0,0), color),
        ("BACKGROUND", (1,0),(1,0), rc.HexColor("#E0E5EA")),
        ("TOPPADDING",    (0,0),(-1,-1), 0),
        ("BOTTOMPADDING", (0,0),(-1,-1), 0),
        ("LEFTPADDING",   (0,0),(-1,-1), 0),
        ("RIGHTPADDING",  (0,0),(-1,-1), 0),
    ]))
    return t


def _section_hdr(title: str, bg, W: float):
    from reportlab.platypus import Table, TableStyle, Paragraph
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors as rc
    p = Paragraph(title, ParagraphStyle("sh", fontName="Helvetica-Bold", fontSize=11,
                                         textColor=rc.white, leading=14))
    t = Table([[p]], colWidths=[W])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), bg),
        ("TOPPADDING",    (0,0),(-1,-1), 10),
        ("BOTTOMPADDING", (0,0),(-1,-1), 10),
        ("LEFTPADDING",   (0,0),(-1,-1), 14),
        ("RIGHTPADDING",  (0,0),(-1,-1), 14),
    ]))
    return t


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.post("/report/pdf")
def generate_pdf_report(body: ReportRequest):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib import colors as rc
        from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table,
            TableStyle, HRFlowable, KeepTogether,
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="reportlab not installed")

    con = state["get_con"]()
    data = _fetch_location_data(
        con, body.h3_r7, body.category,
        body.success_vector, body.failure_vector,
    )
    if not data:
        raise HTTPException(status_code=404, detail=f"{body.h3_r7} / {body.category} not found")

    locality   = data["locality"]
    state_code = data["state_code"]
    composite  = body.scan_score if body.scan_score is not None else round(data["composite"] * 100)
    is_btb     = body.is_btb or False

    if is_btb and composite >= 60:
        tier = "BETTER_THAN_BEST"
    elif composite >= 60:
        tier = "STRONG"
    elif composite >= 40:
        tier = "WATCH"
    else:
        tier = "AVOID"

    top_cats = con.execute("""
        SELECT category_label, count(*) AS cnt FROM venues
        WHERE h3_r7 = ? AND is_closed = false AND category_label IS NOT NULL
        GROUP BY category_label ORDER BY cnt DESC LIMIT 10
    """, [body.h3_r7]).fetchall()

    saved_data: list[dict] = []
    if body.saved_suburbs:
        for s in body.saved_suburbs[:4]:
            if s.h3_r7 == body.h3_r7:
                continue
            sd = _fetch_location_data(con, s.h3_r7, body.category)
            if sd:
                saved_data.append({
                    "locality":   s.locality or sd["locality"],
                    "state_code": s.state or sd["state_code"],
                    "score":      sd["composite"],
                    "comp_count": sd["comp_count"],
                    "traj_label": sd["traj_label"],
                    "tier": (
                        "BETTER_THAN_BEST" if sd["composite"] >= 0.68 else
                        "STRONG"           if sd["composite"] >= 0.60 else
                        "WATCH"            if sd["composite"] >= 0.40 else "AVOID"
                    ),
                })

    monthly = data["monthly"]

    # Run the LangGraph comparison agent when there are other saved suburbs.
    # This produces a fully agentic AI verdict (uses tools, real data) that
    # we merge into the PDF's comparison section.
    fingerprint_payload: dict | None = None
    if body.success_vector or body.failure_vector or body.top_categories or body.dna_summary:
        fingerprint_payload = {
            "success_vector": body.success_vector,
            "failure_vector": body.failure_vector,
            "top_categories": body.top_categories or [],
            "dna_summary":    body.dna_summary,
        }

    agent_compare: dict = {}
    if saved_data:
        agent_compare = _run_comparison_agent(
            category=body.category,
            h3_r7_list=[body.h3_r7] + [s.h3_r7 for s in (body.saved_suburbs or []) if s.h3_r7 != body.h3_r7][:4],
            fingerprint_result=fingerprint_payload,
            top_categories=body.top_categories,
        )

    try:
        narrative = _ai_narrative(
            category=body.category, locality=locality, state_code=state_code,
            composite=composite, tier=tier,
            venue_count=data["venue_count"], data_conf=data["data_conf"],
            fp_score=data["fp_score"], traj_score=data["traj_score"],
            traj_label=data["traj_label"], monthly_count=len(monthly),
            comp_score=data["comp_score"], comp_count=data["comp_count"],
            div_score=data["div_score"], risk_score=data["risk_score"],
            risk_level=data["risk_level"],
            top_cats=list(top_cats), saved_data=saved_data,
            dna_summary=body.dna_summary,
            top_franchise_cats=body.top_categories,
            is_btb=is_btb,
        )
    except Exception:
        narrative = {
            "why_score": f"{locality} scored {composite}/100. Retry the download to get the AI analysis.",
            "strengths": "- Retry the download for AI insights",
            "risks": "- Retry the download for AI insights",
            "market_outlook": "Retry the PDF download to generate AI insights.",
            "recommendation": "Retry the PDF download to generate the recommendation.",
        }

    # ── Colours ───────────────────────────────────────────────────────────────
    TEAL      = rc.HexColor("#0D7377")
    NAVY      = rc.HexColor("#1B2A4A")
    LIGHT_BG  = rc.HexColor("#F6F8FA")
    MED_GRAY  = rc.HexColor("#8B8B99")
    DARK      = rc.HexColor("#1A1A2E")
    DIVIDER   = rc.HexColor("#D0D5DD")

    TIER_BG = {
        "BETTER_THAN_BEST": rc.HexColor("#0D7377"),
        "STRONG":           rc.HexColor("#0D7377"),
        "WATCH":            rc.HexColor("#B07800"),
        "AVOID":            rc.HexColor("#9B2020"),
    }
    TIER_HEADLINE = {
        "BETTER_THAN_BEST": "TOP PICK — BETTER THAN YOUR EXISTING LOCATIONS",
        "STRONG":           "RECOMMENDED — THIS LOOKS LIKE A GOOD OPPORTUNITY",
        "WATCH":            "PROCEED WITH CAUTION — DO MORE RESEARCH FIRST",
        "AVOID":            "NOT RECOMMENDED — CONSIDER OTHER AREAS",
    }
    verdict_bg = TIER_BG[tier]

    _ss = getSampleStyleSheet()
    def S(base="Normal", **kw):
        return ParagraphStyle(f"_s{id(kw)}", parent=_ss[base], **kw)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=1.8*cm, rightMargin=1.8*cm,
                            topMargin=1.4*cm, bottomMargin=1.8*cm)
    W = 17.4 * cm
    story: list = []
    sp = lambda h=8: Spacer(1, h)

    # ── 1. HEADER ─────────────────────────────────────────────────────────────
    hdr = Table([[
        Paragraph("VANTAGE", S(fontSize=14, fontName="Helvetica-Bold", textColor=TEAL)),
        Paragraph(
            f"Location Report &nbsp;·&nbsp; {date.today().strftime('%d %B %Y')}",
            S(fontSize=8, textColor=MED_GRAY, alignment=TA_RIGHT),
        ),
    ]], colWidths=[W * 0.5, W * 0.5])
    hdr.setStyle(TableStyle([
        ("TOPPADDING", (0,0),(-1,-1), 0), ("BOTTOMPADDING", (0,0),(-1,-1), 0),
        ("VALIGN", (0,0),(-1,-1), "MIDDLE"),
    ]))
    story.append(hdr)
    story.append(HRFlowable(width="100%", thickness=3, color=TEAL, spaceAfter=10, spaceBefore=4))

    # ── 2. TITLE ──────────────────────────────────────────────────────────────
    story.append(Paragraph(
        f"{body.category.upper()} &nbsp;·&nbsp; EXPANSION REPORT",
        S(fontSize=9, textColor=TEAL, spaceAfter=4),
    ))
    story.append(Paragraph(
        f"{locality}, {state_code}",
        S(fontSize=30, fontName="Helvetica-Bold", textColor=NAVY, spaceAfter=3, leading=34),
    ))
    story.append(Paragraph(
        f"Based on {data['venue_count']} local businesses &nbsp;·&nbsp; Data quality: {data['data_conf']}",
        S(fontSize=8, textColor=MED_GRAY, spaceAfter=14),
    ))

    # ── 3. SCORE BANNER ───────────────────────────────────────────────────────
    # Left: big score number + "out of 100" in two separate rows (no overlap)
    score_inner = Table([
        [Paragraph(str(composite),
                   S(fontSize=46, fontName="Helvetica-Bold", textColor=rc.white,
                     alignment=TA_CENTER, leading=48))],
        [Paragraph("out of 100",
                   S(fontSize=9, textColor=rc.HexColor("#FFFFFFCC"),
                     alignment=TA_CENTER, leading=12))],
    ], colWidths=[3.6*cm])
    score_inner.setStyle(TableStyle([
        ("TOPPADDING",    (0,0),(-1,-1), 2),
        ("BOTTOMPADDING", (0,0),(-1,-1), 2),
        ("LEFTPADDING",   (0,0),(-1,-1), 0),
        ("RIGHTPADDING",  (0,0),(-1,-1), 0),
    ]))

    # Right: tier label + AI explanation
    right_inner = Table([
        [Paragraph(TIER_HEADLINE[tier],
                   S(fontSize=10, fontName="Helvetica-Bold", textColor=rc.white,
                     leading=13, spaceAfter=4))],
        [HRFlowable(width="100%", thickness=0.5, color=rc.HexColor("#FFFFFF55"),
                    spaceBefore=2, spaceAfter=6)],
        [Paragraph(narrative["why_score"],
                   S(fontSize=10, textColor=rc.HexColor("#FFFFFFEE"), leading=15))],
    ], colWidths=[12.8*cm])
    right_inner.setStyle(TableStyle([
        ("TOPPADDING",    (0,0),(-1,-1), 0),
        ("BOTTOMPADDING", (0,0),(-1,-1), 0),
        ("LEFTPADDING",   (0,0),(-1,-1), 0),
        ("RIGHTPADDING",  (0,0),(-1,-1), 0),
    ]))

    banner = Table([[score_inner, right_inner]], colWidths=[4.2*cm, 13.2*cm])
    banner.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), verdict_bg),
        ("VALIGN",        (0,0),(-1,-1), "MIDDLE"),
        ("TOPPADDING",    (0,0),(0,0), 20),
        ("BOTTOMPADDING", (0,0),(0,0), 20),
        ("LEFTPADDING",   (0,0),(0,0), 10),
        ("RIGHTPADDING",  (0,0),(0,0), 8),
        ("TOPPADDING",    (1,0),(1,0), 16),
        ("BOTTOMPADDING", (1,0),(1,0), 16),
        ("LEFTPADDING",   (1,0),(1,0), 16),
        ("RIGHTPADDING",  (1,0),(1,0), 16),
    ]))
    story.append(KeepTogether([banner]))
    story.append(sp(16))

    # ── 4. HOW WE SCORED THIS LOCATION ────────────────────────────────────────
    story.append(_section_hdr("HOW WE SCORED THIS LOCATION", NAVY, W))
    story.append(sp(6))
    story.append(Paragraph(
        "We checked 5 things to work out this score. Here is what we found for each one:",
        S(fontSize=9, textColor=DARK, leading=14, spaceAfter=8),
    ))

    def _indicator(score_0to1: float):
        if score_0to1 >= 0.65:
            return "GOOD", rc.HexColor("#0A5C50"), rc.HexColor("#E6F4F1")
        elif score_0to1 >= 0.40:
            return "OKAY", rc.HexColor("#7D5500"), rc.HexColor("#FFF8E8")
        else:
            return "CONCERN", rc.HexColor("#8B1A1A"), rc.HexColor("#FFF0F0")

    def _sig_row(question: str, score_0to1: float, plain_result: str, plain_meaning: str):
        label, col, _ = _indicator(score_0to1)
        result_cell = Table([
            [Paragraph(label, S(fontSize=8, fontName="Helvetica-Bold",
                                textColor=col, alignment=TA_CENTER, leading=10))],
            [Paragraph(plain_result, S(fontSize=8, textColor=col,
                                       alignment=TA_CENTER, leading=11))],
        ], colWidths=[3.4*cm])
        result_cell.setStyle(TableStyle([
            ("TOPPADDING",    (0,0),(-1,-1), 0),
            ("BOTTOMPADDING", (0,0),(-1,-1), 0),
            ("LEFTPADDING",   (0,0),(-1,-1), 0),
            ("RIGHTPADDING",  (0,0),(-1,-1), 0),
        ]))
        return [
            Paragraph(question, S(fontSize=9, fontName="Helvetica-Bold",
                                  textColor=DARK, leading=13)),
            result_cell,
            Paragraph(plain_meaning, S(fontSize=9, textColor=DARK, leading=13)),
        ]

    def _fp_meaning(s):
        if s >= 0.65: return f"Great match. This area already has the right types of businesses for a {body.category}."
        if s >= 0.40: return f"Partial match. Not a perfect fit, but it could still work with the right approach."
        return f"Poor match. This area looks quite different from where {body.category} businesses usually do well."

    def _traj_meaning(label):
        if label == "GROWING":   return "The area is getting busier. More businesses are opening here than closing."
        if label == "NARROWING": return "Warning — more businesses are closing here than opening. The area may be getting quieter."
        return "The market is steady. Not growing fast, but not declining either."

    def _comp_meaning(n):
        if n == 0:  return f"No one else is doing {body.category} here. You could be the first — a big advantage."
        if n <= 2:  return f"Only {n} direct competitor{'s' if n!=1 else ''}. The market is not crowded. There is room for you."
        if n <= 5:  return f"{n} competitors already here. There is competition, but you can still stand out."
        return f"{n} competitors in the area. It will be harder to win customers here."

    def _div_meaning(s):
        if s >= 0.65: return "Lots of different types of businesses nearby. That usually means more people walking past."
        if s >= 0.40: return "A decent mix of businesses nearby. Foot traffic is moderate — not the busiest spot."
        return "Not many different types of businesses here. Foot traffic is likely to be lower."

    def _risk_meaning(s, level):
        if s >= 0.65: return "Low risk. Businesses in this area tend to stay open and do well over time."
        if s >= 0.40: return "Medium risk. Some businesses have closed here. Worth watching carefully before committing."
        return "Higher risk. More businesses than usual have closed in this area. That is a real concern."

    sig_rows = [
        [
            Paragraph("What we checked", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
            Paragraph("Result", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white, alignment=TA_CENTER)),
            Paragraph("What this means for your business", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
        ],
        _sig_row("Does this area fit the franchise type?",
                 data["fp_score"], f"{round(data['fp_score']*100)}/100",
                 _fp_meaning(data["fp_score"])),
        _sig_row("Is the local market growing?",
                 data["traj_score"], data["traj_label"],
                 _traj_meaning(data["traj_label"])),
        _sig_row("How much competition is there?",
                 data["comp_score"], f"{data['comp_count']} nearby",
                 _comp_meaning(data["comp_count"])),
        _sig_row("How busy and varied is the area?",
                 data["div_score"], f"{round(data['div_score']*100)}/100",
                 _div_meaning(data["div_score"])),
        _sig_row("What is the risk level?",
                 data["risk_score"], data["risk_level"],
                 _risk_meaning(data["risk_score"], data["risk_level"])),
    ]

    sig_tbl = Table(sig_rows, colWidths=[5.0*cm, 3.6*cm, 8.8*cm])
    sig_tbl.setStyle(TableStyle([
        ("BACKGROUND",     (0,0),(-1,0), NAVY),
        ("ROWBACKGROUNDS", (0,1),(-1,-1), [rc.white, LIGHT_BG]),
        ("BOX",            (0,0),(-1,-1), 0.5, DIVIDER),
        ("INNERGRID",      (0,0),(-1,-1), 0.3, DIVIDER),
        ("TOPPADDING",     (0,0),(-1,-1), 10),
        ("BOTTOMPADDING",  (0,0),(-1,-1), 10),
        ("LEFTPADDING",    (0,0),(-1,-1), 10),
        ("RIGHTPADDING",   (0,0),(-1,-1), 10),
        ("VALIGN",         (0,0),(-1,-1), "MIDDLE"),
    ]))
    story.append(sig_tbl)
    story.append(sp(16))

    # ── 5. STRENGTHS & RISKS ──────────────────────────────────────────────────
    story.append(_section_hdr("WHAT'S WORKING IN YOUR FAVOUR — AND WHAT TO WATCH OUT FOR", NAVY, W))
    story.append(sp(6))

    def _parse_bullets(text: str) -> list[str]:
        items = []
        for line in text.replace("•", "-").splitlines():
            s = line.strip().lstrip("-").strip()
            if s:
                items.append(s)
        if not items and text.strip():
            items = [text.strip()]
        return items

    half = W * 0.5 - 4
    str_items = _parse_bullets(narrative["strengths"])
    rsk_items = _parse_bullets(narrative["risks"])

    GREEN_BG   = rc.HexColor("#0A5444")
    RED_BG     = rc.HexColor("#7A1818")
    GREEN_TEXT = rc.HexColor("#053D30")
    RED_TEXT   = rc.HexColor("#5C1010")

    str_paras = [
        Paragraph(f"✓  {t}", S(fontSize=9, textColor=GREEN_TEXT, leading=14, spaceAfter=5))
        for t in str_items
    ] or [Paragraph("No specific strengths identified.", S(fontSize=9, textColor=MED_GRAY))]

    rsk_paras = [
        Paragraph(f"⚠  {t}", S(fontSize=9, textColor=RED_TEXT, leading=14, spaceAfter=5))
        for t in rsk_items
    ] or [Paragraph("No specific risks identified.", S(fontSize=9, textColor=MED_GRAY))]

    max_r = max(len(str_paras), len(rsk_paras))
    sr_rows = [[
        Paragraph("✓  WORKING IN YOUR FAVOUR", S(fontSize=9, fontName="Helvetica-Bold", textColor=rc.white)),
        Paragraph("⚠  WATCH OUT FOR THESE", S(fontSize=9, fontName="Helvetica-Bold", textColor=rc.white)),
    ]]
    for i in range(max_r):
        sr_rows.append([
            str_paras[i] if i < len(str_paras) else Spacer(1, 1),
            rsk_paras[i] if i < len(rsk_paras) else Spacer(1, 1),
        ])

    sr_tbl = Table(sr_rows, colWidths=[half, half])
    sr_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(0,0), GREEN_BG),
        ("BACKGROUND",    (1,0),(1,0), RED_BG),
        ("BACKGROUND",    (0,1),(-1,-1), LIGHT_BG),
        ("BOX",           (0,0),(-1,-1), 0.5, DIVIDER),
        ("LINEAFTER",     (0,0),(0,-1), 0.3, DIVIDER),
        ("TOPPADDING",    (0,0),(-1,-1), 10),
        ("BOTTOMPADDING", (0,0),(-1,-1), 10),
        ("LEFTPADDING",   (0,0),(-1,-1), 12),
        ("RIGHTPADDING",  (0,0),(-1,-1), 12),
        ("VALIGN",        (0,0),(-1,-1), "TOP"),
    ]))
    story.append(sr_tbl)
    story.append(sp(16))

    # ── 6. MARKET OUTLOOK ─────────────────────────────────────────────────────
    story.append(_section_hdr("WHAT THE LOCAL MARKET LOOKS LIKE", NAVY, W))
    story.append(sp(6))
    story.append(Paragraph(
        narrative["market_outlook"],
        S(fontSize=10, textColor=DARK, leading=16, spaceAfter=10),
    ))

    if top_cats:
        story.append(Paragraph(
            f"Types of businesses already operating in {locality}:",
            S(fontSize=9, fontName="Helvetica-Bold", textColor=DARK, leading=13, spaceAfter=5),
        ))
        max_cnt = top_cats[0][1] if top_cats else 1
        v_rows = [[
            Paragraph("Business type", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
            Paragraph("Count", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white, alignment=TA_CENTER)),
            Paragraph("How common compared to the others", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
        ]]
        bar_w3 = int((W - 5.5*cm - 2.0*cm) * 72 / cm)
        for cat_name, cnt in top_cats:
            pct = round(cnt / max_cnt * 100)
            v_rows.append([
                Paragraph(cat_name or "—", S(fontSize=9, textColor=DARK, leading=12)),
                Paragraph(str(cnt), S(fontSize=9, textColor=DARK, alignment=TA_CENTER)),
                _bar(pct, TEAL, bar_w3),
            ])
        v_tbl = Table(v_rows, colWidths=[5.5*cm, 2.0*cm, W - 5.5*cm - 2.0*cm])
        v_tbl.setStyle(TableStyle([
            ("BACKGROUND",     (0,0),(-1,0), TEAL),
            ("ROWBACKGROUNDS", (0,1),(-1,-1), [rc.white, LIGHT_BG]),
            ("BOX",            (0,0),(-1,-1), 0.5, DIVIDER),
            ("INNERGRID",      (0,0),(-1,-1), 0.3, DIVIDER),
            ("TOPPADDING",     (0,0),(-1,-1), 7),
            ("BOTTOMPADDING",  (0,0),(-1,-1), 7),
            ("LEFTPADDING",    (0,0),(-1,-1), 9),
            ("RIGHTPADDING",   (0,0),(-1,-1), 9),
            ("VALIGN",         (0,0),(-1,-1), "MIDDLE"),
        ]))
        story.append(v_tbl)
    story.append(sp(16))

    # ── 7. COMPARISON TABLE (if saved suburbs) ────────────────────────────────
    if saved_data:
        story.append(_section_hdr("HOW THIS COMPARES TO OTHER AREAS YOU ARE LOOKING AT", NAVY, W))
        story.append(sp(6))
        story.append(Paragraph(
            "Here is how this location stacks up against the other areas on your shortlist:",
            S(fontSize=9, textColor=DARK, leading=14, spaceAfter=6),
        ))

        def _tier_short(t):
            return {"BETTER_THAN_BEST": "Top pick", "STRONG": "Good",
                    "WATCH": "Caution", "AVOID": "Avoid"}.get(t, "—")

        def _score_color(s):
            return (rc.HexColor("#0D7377") if s >= 60
                    else rc.HexColor("#C09000") if s >= 40
                    else rc.HexColor("#B02020"))

        cmp_rows = [[
            Paragraph("Location", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
            Paragraph("Score", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white, alignment=TA_CENTER)),
            Paragraph("Verdict", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white, alignment=TA_CENTER)),
            Paragraph("Competitors\nnearby", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white, alignment=TA_CENTER)),
            Paragraph("Market", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white, alignment=TA_CENTER)),
        ]]
        cur_c = _score_color(composite)
        cmp_rows.append([
            Paragraph(f"★  {locality}, {state_code} (this location)",
                      S(fontSize=9, fontName="Helvetica-Bold", textColor=rc.HexColor("#0D5C5F"), leading=12)),
            Paragraph(str(composite), S(fontSize=13, fontName="Helvetica-Bold", textColor=cur_c, alignment=TA_CENTER)),
            Paragraph(_tier_short(tier), S(fontSize=8, fontName="Helvetica-Bold", textColor=cur_c, alignment=TA_CENTER)),
            Paragraph(str(data["comp_count"]), S(fontSize=9, textColor=DARK, alignment=TA_CENTER)),
            Paragraph(data["traj_label"].title(), S(fontSize=8, textColor=DARK, alignment=TA_CENTER)),
        ])
        for s in saved_data:
            sc100 = round(s["score"] * 100) if s.get("score") else 0
            sc = _score_color(sc100)
            cmp_rows.append([
                Paragraph(f"{s['locality']}, {s['state_code']}", S(fontSize=9, textColor=DARK, leading=12)),
                Paragraph(str(sc100), S(fontSize=13, fontName="Helvetica-Bold", textColor=sc, alignment=TA_CENTER)),
                Paragraph(_tier_short(s["tier"]), S(fontSize=8, textColor=sc, alignment=TA_CENTER)),
                Paragraph(str(s["comp_count"]), S(fontSize=9, textColor=DARK, alignment=TA_CENTER)),
                Paragraph(s["traj_label"].title(), S(fontSize=8, textColor=DARK, alignment=TA_CENTER)),
            ])

        cmp_tbl = Table(cmp_rows, colWidths=[6.0*cm, 2.2*cm, 2.8*cm, 2.8*cm, 3.6*cm])
        cmp_tbl.setStyle(TableStyle([
            ("BACKGROUND",     (0,0),(-1,0), NAVY),
            ("BACKGROUND",     (0,1),(-1,1), rc.HexColor("#E8F5F5")),
            ("ROWBACKGROUNDS", (0,2),(-1,-1), [rc.white, LIGHT_BG]),
            ("BOX",            (0,0),(-1,-1), 0.5, DIVIDER),
            ("INNERGRID",      (0,0),(-1,-1), 0.3, DIVIDER),
            ("LINEABOVE",      (0,1),(-1,1), 2, rc.HexColor("#0D7377")),
            ("LINEBELOW",      (0,1),(-1,1), 2, rc.HexColor("#0D7377")),
            ("TOPPADDING",     (0,0),(-1,-1), 9),
            ("BOTTOMPADDING",  (0,0),(-1,-1), 9),
            ("LEFTPADDING",    (0,0),(-1,-1), 9),
            ("RIGHTPADDING",   (0,0),(-1,-1), 9),
            ("VALIGN",         (0,0),(-1,-1), "MIDDLE"),
        ]))
        story.append(cmp_tbl)
        story.append(sp(10))

        # ── Agentic AI verdict (LangGraph comparison_agent) ───────────────────
        agent_verdict_lines: list[str] = []
        if agent_compare:
            for key in ("winner", "differentiators", "verdict"):
                val = (agent_compare.get(key) or "").strip().strip("*").strip(":").strip()
                if val:
                    label = key.replace("_", " ").title()
                    agent_verdict_lines.append(f"<b>{label}.</b> {val}")
            red_flags = (agent_compare.get("red_flags") or "").strip().strip("*").strip(":").strip()
            if red_flags and red_flags.lower() not in {"none.", "none", "no red flags."}:
                agent_verdict_lines.append(f"<b>Red flags.</b> {red_flags}")

        verdict_text = (
            "<br/><br/>".join(agent_verdict_lines)
            if agent_verdict_lines
            else (narrative.get("comparison_verdict") or "").strip()
        )

        if verdict_text:
            verdict_box = Table([[
                Paragraph("OUR TAKE ON THE COMPARISON", S(fontSize=8, fontName="Helvetica-Bold",
                                                           textColor=TEAL, spaceAfter=4)),
                Paragraph(verdict_text,
                          S(fontSize=9, textColor=DARK, leading=14)),
            ]], colWidths=[4.8*cm, W - 4.8*cm])
            verdict_box.setStyle(TableStyle([
                ("BACKGROUND",    (0,0),(-1,-1), rc.HexColor("#EAF5F5")),
                ("BOX",           (0,0),(-1,-1), 0.5, TEAL),
                ("TOPPADDING",    (0,0),(-1,-1), 10),
                ("BOTTOMPADDING", (0,0),(-1,-1), 10),
                ("LEFTPADDING",   (0,0),(-1,-1), 12),
                ("RIGHTPADDING",  (0,0),(-1,-1), 12),
                ("VALIGN",        (0,0),(-1,-1), "TOP"),
            ]))
            story.append(verdict_box)
        story.append(sp(16))

    # ── 8. OUR RECOMMENDATION ─────────────────────────────────────────────────
    story.append(_section_hdr("OUR RECOMMENDATION", verdict_bg, W))
    story.append(sp(8))

    story.append(Paragraph(
        TIER_HEADLINE[tier],
        S(fontSize=13, fontName="Helvetica-Bold", textColor=verdict_bg, spaceAfter=6, leading=16),
    ))
    story.append(HRFlowable(width="100%", thickness=0.7, color=DIVIDER, spaceBefore=2, spaceAfter=10))
    story.append(Paragraph(
        narrative["recommendation"],
        S(fontSize=11, textColor=DARK, leading=17, spaceAfter=14),
    ))

    # Numbered next steps
    next_steps = [
        f"Visit {locality} in person. Walk around at different times of day — morning, lunch, and evening.",
        "Talk to a local property agent about available shops and what rent costs in this area.",
        (f"Visit the {data['comp_count']} existing {body.category} "
         f"{'businesses' if data['comp_count']!=1 else 'business'} in the area and see how busy they are."
         if data["comp_count"] > 0
         else f"Check the area for any {body.category} businesses that may have opened recently."),
        "Compare this location with others on your shortlist before making any final decisions.",
    ]
    if data["traj_score"] < 0.55:
        next_steps.append("Keep watching this area over the next 2-3 months to see if it picks up.")

    story.append(Paragraph("Your next steps:",
                            S(fontSize=10, fontName="Helvetica-Bold", textColor=DARK, spaceAfter=6)))
    for i, step in enumerate(next_steps, 1):
        story.append(Paragraph(
            f"  {i}.  {step}",
            S(fontSize=9, textColor=DARK, leading=14, leftIndent=8, spaceAfter=5),
        ))

    story.append(sp(14))

    # ── 9. FOOTER ─────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=DIVIDER, spaceBefore=4, spaceAfter=5))
    story.append(Paragraph(
        f"Generated by Vantage Location Intelligence · {date.today().strftime('%d %B %Y')} · "
        f"Data from Foursquare OS Places. For guidance only — always do your own research before signing a lease.",
        S(fontSize=7, textColor=MED_GRAY, leading=10),
    ))

    doc.build(story)
    buf.seek(0)

    safe = locality.replace(" ", "_").replace(",", "")
    fname = f"Vantage_{safe}_{state_code}_{body.category.replace(' ', '_')}_{date.today().isoformat()}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})
