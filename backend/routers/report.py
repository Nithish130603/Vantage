"""
POST /report/pdf

Generate a clear, decision-ready PDF report for a suburb + category.
Designed for franchise founders: plain English, decisive, professional.
"""

from __future__ import annotations

import io
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from state import state

router = APIRouter()


class ReportRequest(BaseModel):
    h3_r7: str
    category: str
    scan_score: Optional[int] = None    # runtime score from /scan (0–100); preferred over DB score
    is_btb: Optional[bool] = None
    btb_reason: Optional[str] = None    # "benchmark" | "discovery"


# ─────────────────────────────────────────────────────────────────────────────
# Plain-English helpers
# ─────────────────────────────────────────────────────────────────────────────

def _signal_insight(name: str, score: float) -> str:
    """One-sentence plain-English meaning of a signal score."""
    if name == "Fingerprint Match":
        if score >= 0.65:
            return (
                "This suburb's business mix closely resembles your best-performing locations — "
                "a strong commercial fit for your franchise."
            )
        if score >= 0.40:
            return (
                "Some similarities to your locations, but the commercial environment differs. "
                "You may need to adapt your offering to suit the local market."
            )
        return (
            "This suburb looks very different from your successful locations. "
            "The commercial mix is not well aligned with your franchise DNA."
        )
    if name == "Market Trajectory":
        if score >= 0.65:
            return (
                "New businesses are opening here consistently — demand is growing and the "
                "market is healthy. A positive signal for new entrants."
            )
        if score >= 0.40:
            return (
                "Openings and closures are roughly balanced. The market is stable but not "
                "accelerating — a moderate, steady environment."
            )
        return (
            "More businesses are closing than opening. The market may be contracting — "
            "timing your entry carefully is critical."
        )
    if name == "Competitive Pressure":
        if score >= 0.65:
            return (
                "Very few direct competitors nearby — you would be entering a largely open "
                "market with strong room to grow."
            )
        if score >= 0.40:
            return (
                "Some competitors are present but the market is not saturated. There is room "
                "to establish a foothold with the right strategy."
            )
        return (
            "This category is already heavily represented here. Strong differentiation will "
            "be essential to stand out from existing operators."
        )
    if name == "Ecosystem Diversity":
        if score >= 0.65:
            return (
                "A rich mix of cafes, retail, and services creates natural foot traffic that "
                "benefits new businesses opening in the area."
            )
        if score >= 0.40:
            return (
                "A reasonable variety of businesses supports trade, though the ecosystem is "
                "not exceptionally diverse."
            )
        return (
            "Limited variety in the local business mix means fewer complementary businesses "
            "to drive foot traffic to your location."
        )
    if name == "Risk Signals":
        if score >= 0.65:
            return (
                "Low closure rates and stable market conditions — this area shows minimal "
                "operational risk for a new business."
            )
        if score >= 0.40:
            return (
                "Moderate risk indicators detected. Worth monitoring the area closely before "
                "committing to a long-term lease."
            )
        return (
            "High closure rates or market saturation detected. There is elevated risk of "
            "underperformance — proceed with caution."
        )
    return ""


def _signal_rating(score: float) -> str:
    if score >= 0.65:
        return "Strong"
    if score >= 0.40:
        return "Moderate"
    return "Weak"


def _why_bullets(signals: list[dict], score100: int, category: str, locality: str) -> list[str]:
    """Return 4–6 plain-English bullet points explaining the recommendation."""
    bullets: list[str] = []
    fp   = signals[0]["score"]
    traj = signals[1]["score"]
    comp = signals[2]["score"]
    div  = signals[3]["score"]
    risk = signals[4]["score"]

    bullets.append(
        f"DNA Match ({round(fp * 100)}%): "
        + (f"{locality}'s commercial mix closely mirrors your best locations."
           if fp >= 0.65
           else f"The commercial mix is only partially aligned with your franchise profile."
           if fp >= 0.40
           else f"The area's business environment differs significantly from your successful locations.")
    )
    bullets.append(
        "Market Trajectory: "
        + ("Strong business growth — new venues are opening month-on-month."
           if traj >= 0.65
           else "Stable market — no sharp acceleration or decline."
           if traj >= 0.40
           else "Market contraction — more closures than openings in recent months.")
    )
    bullets.append(
        "Competitive Landscape: "
        + (f"Low {category} saturation — open market with room for a new entrant."
           if comp >= 0.65
           else f"Moderate {category} competition — room exists but requires differentiation."
           if comp >= 0.40
           else f"High {category} density — the category is already well established here.")
    )
    bullets.append(
        "Foot Traffic Ecosystem: "
        + ("Rich mix of complementary businesses that naturally drive foot traffic."
           if div >= 0.65
           else "Adequate ecosystem — moderate foot traffic support."
           if div >= 0.40
           else "Thin ecosystem — limited complementary businesses to generate foot traffic.")
    )
    bullets.append(
        "Risk Assessment: "
        + ("Low closure rates and mature market — minimal operational risk."
           if risk >= 0.65
           else "Moderate risk level — manageable with a clear go-to-market strategy."
           if risk >= 0.40
           else "Elevated closure rates or saturation — above-average risk of underperformance.")
    )
    bullets.append(
        "Overall Score (%d/100): " % score100
        + ("Top-tier opportunity — act quickly before competitors move in."
           if score100 >= 80
           else "Strong candidate — site inspection recommended before committing."
           if score100 >= 60
           else "Moderate opportunity — solid fundamentals but proceed cautiously."
           if score100 >= 40
           else "Below threshold — insufficient commercial fundamentals for this category.")
    )
    return bullets


# ─────────────────────────────────────────────────────────────────────────────
# ReportLab helpers
# ─────────────────────────────────────────────────────────────────────────────

def _score_bar(score_pct: int, bar_color, bar_width: int = 280):
    """Filled progress bar rendered as a two-cell Table."""
    from reportlab.platypus import Table, TableStyle
    from reportlab.lib import colors as rc

    filled = max(2, int(bar_width * score_pct / 100))
    empty  = max(2, bar_width - filled)

    tbl = Table([["", ""]], colWidths=[filled, empty], rowHeights=[9])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0), bar_color),
        ("BACKGROUND",    (1, 0), (1, 0), rc.HexColor("#DDE2E6")),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
    ]))
    return tbl


# ─────────────────────────────────────────────────────────────────────────────
# Main endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/report/pdf")
def generate_pdf_report(body: ReportRequest):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib import colors as rc
        from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT, TA_JUSTIFY
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table,
            TableStyle, HRFlowable, KeepTogether,
        )
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="reportlab not installed. Run: pip install reportlab",
        )

    con = state["get_con"]()

    row = con.execute("""
        SELECT
            ss.composite_score,   ss.tier,
            ss.fingerprint_score, ss.trajectory_score, ss.trajectory_status,
            ss.competition_score, ss.competitor_count, ss.cluster_gap_description,
            ss.diversity_score,   ss.risk_score,        ss.risk_level,
            ss.data_confidence,   ss.recommendation,    ss.venue_count,
            COALESCE(ss.locality, ss.cell_id) AS locality,
            COALESCE(ss.state, 'AU')           AS state
        FROM suburb_scores ss
        WHERE ss.cell_id = ?
          AND LOWER(REPLACE(ss.category, 'é', 'e')) = LOWER(REPLACE(?, 'é', 'e'))
    """, [body.h3_r7, body.category]).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"{body.h3_r7} / {body.category} not found")

    db_composite  = row[0] or 0
    db_tier       = row[1] or "WATCH"
    fp_score      = (row[2] or 0) / 100.0
    traj_score    = (row[3] or 0) / 100.0
    traj_status   = (row[4] or "STABLE").replace("_", " ").title()
    comp_score    = (row[5] or 0) / 100.0
    comp_count    = row[6] or 0
    div_score     = (row[8] or 0) / 100.0
    risk_score    = (row[9] or 0) / 100.0
    risk_level    = row[10] or "MEDIUM"
    data_conf     = row[11] or "MEDIUM"
    db_rec        = row[12] or ""
    venue_count   = row[13] or 0
    locality      = row[14] or body.h3_r7
    state_code    = row[15] or "AU"

    # Prefer the real-time scan score when the caller provides it
    composite = body.scan_score if body.scan_score is not None else db_composite
    is_btb    = body.is_btb if body.is_btb is not None else (db_tier == "BETTER_THAN_BEST")
    btb_reason = body.btb_reason or ""

    # Derive tier from composite + is_btb
    if is_btb and composite >= 60:
        display_tier = "BETTER_THAN_BEST"
    elif composite >= 60:
        display_tier = "STRONG"
    elif composite >= 40:
        display_tier = "WATCH"
    else:
        display_tier = "AVOID"

    top_cats = con.execute("""
        SELECT category_label, count(*) AS cnt
        FROM venues
        WHERE h3_r7 = ? AND is_closed = false AND category_label IS NOT NULL
        GROUP BY category_label ORDER BY cnt DESC LIMIT 8
    """, [body.h3_r7]).fetchall()

    signals = [
        {"name": "Fingerprint Match",    "score": fp_score,
         "badge": f"{round(fp_score * 100)}%",    "badge_label": "DNA Match"},
        {"name": "Market Trajectory",    "score": traj_score,
         "badge": traj_status,                     "badge_label": "Trajectory"},
        {"name": "Competitive Pressure", "score": comp_score,
         "badge": "Low" if comp_score >= 0.65 else "Medium" if comp_score >= 0.40 else "High",
         "badge_label": "Competition"},
        {"name": "Ecosystem Diversity",  "score": div_score,
         "badge": f"{round(div_score * 100)}%",   "badge_label": "Diversity"},
        {"name": "Risk Signals",         "score": risk_score,
         "badge": risk_level.title(),              "badge_label": "Risk"},
    ]

    strengths = [s for s in signals if s["score"] >= 0.65]
    risks     = [s for s in signals if s["score"] < 0.40]

    # ── Colour palette ────────────────────────────────────────────────────────
    TEAL      = rc.HexColor("#0D7377")
    NAVY      = rc.HexColor("#1B2A4A")
    LIGHT_BG  = rc.HexColor("#F5F7FA")
    MED_GRAY  = rc.HexColor("#8B8B99")
    DARK_GRAY = rc.HexColor("#3A3A4A")
    OFF_WHITE = rc.HexColor("#F0F0F2")
    DIVIDER   = rc.HexColor("#C8CDD2")

    TIER_LABEL_MAP = {
        "BETTER_THAN_BEST": "Better Than Best",
        "STRONG":           "Strong Opportunity",
        "WATCH":            "Watch — Monitor Closely",
        "AVOID":            "Avoid",
    }
    VERDICT_TEXT = {
        "BETTER_THAN_BEST": "RECOMMENDED — PRIORITY OPPORTUNITY",
        "STRONG":           "RECOMMENDED",
        "WATCH":            "PROCEED WITH CAUTION",
        "AVOID":            "NOT RECOMMENDED",
    }
    VERDICT_BODY = {
        "BETTER_THAN_BEST": (
            f"This location outperforms your current best stores. "
            f"The commercial fundamentals are exceptional — this is a high-priority expansion target."
        ),
        "STRONG": (
            f"The commercial fundamentals support a strong business case here. "
            f"A site inspection is the logical next step."
        ),
        "WATCH": (
            f"Some indicators are positive but the window may be narrowing. "
            f"Proceed only with a clear differentiation strategy and defined entry timeline."
        ),
        "AVOID": (
            f"Risk signals and weak market fundamentals make this a poor commercial fit. "
            f"Explore alternative locations with stronger underlying conditions."
        ),
    }

    verdict_text = VERDICT_TEXT[display_tier]
    verdict_body = VERDICT_BODY[display_tier]

    verdict_bg = (
        rc.HexColor("#0D7377") if composite >= 60
        else rc.HexColor("#B87800") if composite >= 40
        else rc.HexColor("#A0291E")
    )

    # ── Style factory ─────────────────────────────────────────────────────────
    _ss = getSampleStyleSheet()

    def S(base: str = "Normal", **kw) -> ParagraphStyle:
        return ParagraphStyle(f"_s{id(kw)}", parent=_ss[base], **kw)

    # Reusable named styles
    section_hdr = S(fontSize=10, fontName="Helvetica-Bold", textColor=OFF_WHITE,
                    spaceAfter=0, spaceBefore=0, leading=13)
    body_txt    = S(fontSize=9,  textColor=DARK_GRAY, leading=14, spaceAfter=0)
    muted_txt   = S(fontSize=8,  textColor=MED_GRAY,  leading=12, spaceAfter=0)
    center_txt  = S(fontSize=9,  textColor=DARK_GRAY, alignment=TA_CENTER, leading=12)
    bullet_txt  = S(fontSize=9,  textColor=DARK_GRAY, leading=14, leftIndent=10,
                    firstLineIndent=-10, spaceAfter=2)

    # ── Document setup ────────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.8*cm, rightMargin=1.8*cm,
        topMargin=1.4*cm,  bottomMargin=1.8*cm,
    )
    W = 17.4 * cm   # usable content width (A4 210mm − 2×18mm margins)
    W_int = int(W)

    story: list = []
    sp = lambda h=6: Spacer(1, h)

    # ── 1. HEADER ─────────────────────────────────────────────────────────────
    hdr_tbl = Table([[
        Paragraph("VANTAGE", S(fontSize=13, fontName="Helvetica-Bold", textColor=TEAL)),
        Paragraph(
            f"Location Intelligence Report &nbsp;·&nbsp; {date.today().strftime('%d %B %Y')}",
            S(fontSize=8, textColor=MED_GRAY, alignment=TA_RIGHT),
        ),
    ]], colWidths=[W * 0.5, W * 0.5])
    hdr_tbl.setStyle(TableStyle([
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(hdr_tbl)
    story.append(HRFlowable(width="100%", thickness=2.5, color=TEAL,
                             spaceAfter=10, spaceBefore=4))

    # ── 2. LOCATION IDENTITY ──────────────────────────────────────────────────
    story.append(Paragraph(
        f"{body.category.upper()} &nbsp;·&nbsp; LOCATION ANALYSIS REPORT",
        S(fontSize=8, fontName="Helvetica", textColor=TEAL, spaceAfter=4),
    ))
    story.append(Paragraph(
        f"{locality}, {state_code}",
        S(fontSize=26, fontName="Helvetica-Bold", textColor=NAVY, spaceAfter=2, leading=30),
    ))
    meta_parts = [f"{venue_count} businesses analysed"]
    if data_conf:
        meta_parts.append(f"Data confidence: {data_conf}")
    story.append(Paragraph(
        " &nbsp;·&nbsp; ".join(meta_parts),
        S(fontSize=8, textColor=MED_GRAY, spaceAfter=4),
    ))

    if is_btb and btb_reason:
        btb_label = (
            "★ Priority opportunity — outperforms your existing best locations (Discovery pathway)"
            if btb_reason == "discovery"
            else "★ Priority opportunity — outperforms your existing best locations (Benchmark match)"
        )
        story.append(Paragraph(btb_label,
                                S(fontSize=8, fontName="Helvetica-Bold",
                                  textColor=rc.HexColor("#B8952A"), spaceAfter=4)))

    story.append(sp(10))

    # ── 3. DECISION AT A GLANCE ───────────────────────────────────────────────
    # Score hero on left, verdict text on right — inside a verdict-coloured banner
    score_block = Table([[
        # Left: numeric score
        Table([[
            Paragraph(
                f'<font size="38"><b>{composite}</b></font>',
                S(fontSize=38, textColor=rc.white, alignment=TA_CENTER),
            ),
        ], [
            Paragraph("out of 100", S(fontSize=8, textColor=rc.HexColor("#FFFFFF99"),
                                       alignment=TA_CENTER)),
        ], [
            Paragraph("OPPORTUNITY\nSCORE",
                       S(fontSize=7, fontName="Helvetica-Bold",
                         textColor=rc.HexColor("#FFFFFF99"),
                         alignment=TA_CENTER, leading=9)),
        ]], colWidths=[3.2*cm]),

        # Right: tier + bar + verdict
        Table([[
            Paragraph(
                TIER_LABEL_MAP.get(display_tier, display_tier).upper(),
                S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white, spaceAfter=4),
            ),
        ], [
            _score_bar(composite, rc.white, bar_width=int(13.2 * 28.35)),
        ], [
            Paragraph(
                verdict_text,
                S(fontSize=13, fontName="Helvetica-Bold", textColor=rc.white,
                  spaceBefore=6, spaceAfter=2, leading=16),
            ),
        ], [
            Paragraph(
                verdict_body,
                S(fontSize=9, textColor=rc.HexColor("#FFFFFFCC"), leading=13),
            ),
        ]], colWidths=[13.8*cm]),
    ]], colWidths=[3.4*cm, 14.0*cm])

    score_block.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), verdict_bg),
        ("TOPPADDING",    (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("LEFTPADDING",   (0, 0), (0, 0),  10),
        ("RIGHTPADDING",  (0, 0), (0, 0),  6),
        ("LEFTPADDING",   (1, 0), (1, 0),  10),
        ("RIGHTPADDING",  (1, 0), (1, 0),  14),
        ("VALIGN",        (0, 0), (0, 0),  "MIDDLE"),
        ("VALIGN",        (1, 0), (1, 0),  "MIDDLE"),
    ]))
    story.append(KeepTogether([score_block]))
    story.append(sp(14))

    # ── 4. SECTION: KEY INSIGHTS ──────────────────────────────────────────────
    sec4_hdr = Table([[Paragraph("KEY INSIGHTS", section_hdr)]],
                      colWidths=[W])
    sec4_hdr.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), NAVY),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    story.append(sec4_hdr)
    story.append(sp(4))
    story.append(Paragraph(
        "The five signals below each measure a different aspect of commercial viability. "
        "Here is a plain-English summary of what the data tells us about this location.",
        S(fontSize=9, textColor=DARK_GRAY, leading=14, spaceAfter=6),
    ))

    # Two-column strengths / risks
    def _insight_items(items: list[dict], icon: str, color) -> list:
        if not items:
            return [Paragraph(f"No {icon.lower()} signals detected.", muted_txt)]
        out = []
        for s in items:
            short = _signal_insight(s["name"], s["score"]).split(" — ")[0].rstrip(".")
            out.append(Paragraph(
                f"{icon}  <b>{s['name']}:</b>  {short}.",
                S(fontSize=9, textColor=color, leading=13, spaceAfter=3,
                  leftIndent=0),
            ))
        return out

    str_items = _insight_items(strengths, "✓", rc.HexColor("#0A5C44"))
    rsk_items = _insight_items(risks,     "⚠", rc.HexColor("#8B1F1F"))
    max_rows  = max(len(str_items), len(rsk_items))

    insight_rows = [[
        Paragraph("✓  WHAT'S WORKING IN YOUR FAVOUR",
                   S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
        Paragraph("⚠  WHAT TO WATCH OUT FOR",
                   S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
    ]]
    for i in range(max_rows):
        insight_rows.append([
            str_items[i] if i < len(str_items) else Paragraph("", body_txt),
            rsk_items[i] if i < len(rsk_items) else Paragraph("", body_txt),
        ])

    half = W * 0.5 - 3
    ins_tbl = Table(insight_rows, colWidths=[half, half])
    ins_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, 0), rc.HexColor("#0D7377")),
        ("BACKGROUND",    (1, 0), (1, 0), rc.HexColor("#8B1F1F")),
        ("BACKGROUND",    (0, 1), (-1, -1), LIGHT_BG),
        ("BOX",           (0, 0), (-1, -1), 0.5, DIVIDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, DIVIDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 9),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 9),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(ins_tbl)
    story.append(sp(14))

    # ── 5. SECTION: OPPORTUNITY SCORE BREAKDOWN ───────────────────────────────
    sec5_hdr = Table([[Paragraph("OPPORTUNITY SCORE BREAKDOWN", section_hdr)]],
                      colWidths=[W])
    sec5_hdr.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), NAVY),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    story.append(sec5_hdr)
    story.append(sp(4))
    story.append(Paragraph(
        "Your Opportunity Score is built from five independent signals. "
        "Each is scored 0–100. Together they tell you whether this location is commercially "
        "viable for your franchise — and why.",
        S(fontSize=9, textColor=DARK_GRAY, leading=14, spaceAfter=6),
    ))

    # Signal table: Name | Bar + % | Rating | Plain English meaning
    sig_rows = [[
        Paragraph("Signal", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
        Paragraph("Score",  S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white,
                               alignment=TA_CENTER)),
        Paragraph("Rating", S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white,
                               alignment=TA_CENTER)),
        Paragraph("What this means for your business decision",
                   S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
    ]]

    for sig in signals:
        sc      = sig["score"]
        sc_pct  = round(sc * 100)
        bar_col = (rc.HexColor("#0D7377") if sc >= 0.65
                   else rc.HexColor("#D4A017") if sc >= 0.40
                   else rc.HexColor("#C0392B"))
        rating  = _signal_rating(sc)
        insight = _signal_insight(sig["name"], sc)

        bar_cell = Table([
            [_score_bar(sc_pct, bar_col, bar_width=52)],
            [Paragraph(f"{sc_pct}%", S(fontSize=8, textColor=bar_col, alignment=TA_CENTER))],
        ], colWidths=[54])

        sig_rows.append([
            Paragraph(f"<b>{sig['name']}</b>\n<font size='8' color='#8B8B99'>"
                       f"{sig['badge_label']}</font>",
                       S(fontSize=9, leading=13)),
            bar_cell,
            Paragraph(rating, S(fontSize=8, fontName="Helvetica-Bold",
                                  textColor=bar_col, alignment=TA_CENTER)),
            Paragraph(insight, S(fontSize=8, textColor=DARK_GRAY, leading=12)),
        ])

    sig_tbl = Table(sig_rows, colWidths=[3.8*cm, 2.0*cm, 2.2*cm, 9.1*cm])
    sig_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [rc.white, LIGHT_BG]),
        ("BOX",           (0, 0), (-1, -1), 0.5, DIVIDER),
        ("INNERGRID",     (0, 0), (-1, -1), 0.3, DIVIDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(sig_tbl)
    story.append(sp(14))

    # ── 6. SECTION: RISK ANALYSIS ─────────────────────────────────────────────
    sec6_hdr = Table([[Paragraph("RISK ANALYSIS", section_hdr)]],
                      colWidths=[W])
    sec6_hdr.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), NAVY),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    story.append(sec6_hdr)
    story.append(sp(4))

    risk_heading = (
        "LOW RISK — Favourable conditions for a new business"       if risk_score >= 0.65
        else "MODERATE RISK — Monitor closely before committing"    if risk_score >= 0.40
        else "HIGH RISK — Caution strongly advised"
    )
    risk_bg = (
        rc.HexColor("#EBF5F3") if risk_score >= 0.65
        else rc.HexColor("#FFF8E7") if risk_score >= 0.40
        else rc.HexColor("#FFF0F0")
    )
    risk_fg = (
        rc.HexColor("#0A5C44") if risk_score >= 0.65
        else rc.HexColor("#7A4F00") if risk_score >= 0.40
        else rc.HexColor("#8B1F1F")
    )
    risk_explanation = (
        f"This area has low business closure rates and stable market conditions. "
        f"There are currently {comp_count} direct {body.category} competitors — "
        f"the competitive environment is manageable and the market is not oversaturated."
        if risk_score >= 0.65
        else
        f"Moderate risk indicators are present. There are {comp_count} direct {body.category} "
        f"competitors, and the market shows some signs of consolidation. "
        f"Proceed with a clear strategy and defined timeline."
        if risk_score >= 0.40
        else
        f"Elevated risk: high closure rates or market saturation detected. "
        f"There are {comp_count} direct {body.category} competitors in the area. "
        f"A strong differentiation strategy is essential — and even then, risk is above average."
    )
    risk_score_pct = round(risk_score * 100)
    risk_bar_col   = (rc.HexColor("#0D7377") if risk_score >= 0.65
                      else rc.HexColor("#D4A017") if risk_score >= 0.40
                      else rc.HexColor("#C0392B"))

    risk_tbl = Table([[
        Table([[
            Paragraph(f"<b>{risk_heading}</b>",
                       S(fontSize=10, textColor=risk_fg, leading=14, spaceAfter=4)),
            _score_bar(risk_score_pct, risk_bar_col, bar_width=W_int - 50),
            Paragraph(f"Risk score: {risk_score_pct}/100",
                       S(fontSize=8, textColor=risk_fg, leading=11, spaceBefore=3, spaceAfter=4)),
            Paragraph(risk_explanation, S(fontSize=9, textColor=risk_fg, leading=13)),
        ]], colWidths=[W - 28]),
    ]], colWidths=[W])
    risk_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), risk_bg),
        ("BOX",           (0, 0), (-1, -1), 0.5, DIVIDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    story.append(risk_tbl)
    story.append(sp(14))

    # ── 7. SECTION: LOCAL VENUE MIX (optional) ───────────────────────────────
    if top_cats:
        sec7_hdr = Table([[Paragraph("LOCAL VENUE MIX", section_hdr)]], colWidths=[W])
        sec7_hdr.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), NAVY),
            ("TOPPADDING",    (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING",   (0, 0), (-1, -1), 12),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ]))
        story.append(sec7_hdr)
        story.append(sp(4))
        story.append(Paragraph(
            f"The chart below shows the most common business types in {locality}. "
            "A diverse mix of cafes, retail, and services generates natural foot traffic "
            "and makes it easier for new businesses to attract customers.",
            S(fontSize=9, textColor=DARK_GRAY, leading=14, spaceAfter=6),
        ))

        max_cnt = top_cats[0][1] if top_cats else 1
        venue_rows = [[
            Paragraph("Business Type",
                       S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
            Paragraph("Count",
                       S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white,
                         alignment=TA_CENTER)),
            Paragraph("Relative Presence  (bar = share of top business type)",
                       S(fontSize=8, fontName="Helvetica-Bold", textColor=rc.white)),
        ]]
        bar_col_w = int((W - 5.5*cm - 1.8*cm) * 28.35)
        for cat_name, cnt in top_cats:
            pct = round(cnt / max_cnt * 100)
            venue_rows.append([
                Paragraph(cat_name or "—", S(fontSize=9, textColor=DARK_GRAY, leading=12)),
                Paragraph(str(cnt), center_txt),
                _score_bar(pct, TEAL, bar_width=bar_col_w),
            ])

        venue_tbl = Table(venue_rows, colWidths=[5.5*cm, 1.8*cm, W - 5.5*cm - 1.8*cm])
        venue_tbl.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0), TEAL),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [rc.white, LIGHT_BG]),
            ("BOX",           (0, 0), (-1, -1), 0.5, DIVIDER),
            ("INNERGRID",     (0, 0), (-1, -1), 0.3, DIVIDER),
            ("TOPPADDING",    (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(venue_tbl)
        story.append(sp(14))

    # ── 8. SECTION: RECOMMENDATION ───────────────────────────────────────────
    sec8_hdr = Table([[Paragraph("RECOMMENDATION", section_hdr)]], colWidths=[W])
    sec8_hdr.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), NAVY),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    story.append(sec8_hdr)
    story.append(sp(4))

    rec_text = db_rec if db_rec else (
        f"Based on the analysis of {venue_count} businesses across {locality}, "
        f"this location scores {composite}/100 for {body.category} expansion. "
        + ("The commercial fundamentals are strong — this is a high-confidence recommendation."
           if composite >= 70
           else "The fundamentals are positive overall, though some signals warrant monitoring before committing."
           if composite >= 50
           else "The location presents mixed signals — any entry should be approached with a detailed risk mitigation plan."
           if composite >= 35
           else "The risk indicators outweigh the opportunities — alternative locations should be explored first.")
    )
    rec_tbl = Table([[
        Paragraph(rec_text, S(fontSize=9, textColor=DARK_GRAY, leading=15)),
    ]], colWidths=[W])
    rec_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), LIGHT_BG),
        ("LINEBEFORE",    (0, 0), (0, -1), 4, TEAL),
        ("BOX",           (0, 0), (-1, -1), 0.5, DIVIDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    story.append(rec_tbl)
    story.append(sp(14))

    # ── 9. SECTION: CONCLUSION & FINAL VERDICT ────────────────────────────────
    sec9_hdr = Table([[Paragraph("CONCLUSION  —  FINAL VERDICT", section_hdr)]], colWidths=[W])
    sec9_hdr.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), verdict_bg),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
    ]))
    story.append(sec9_hdr)
    story.append(sp(4))

    # Verdict statement
    verdict_statement = (
        f"{locality} is a <b>recommended location</b> for {body.category} expansion. "
        "The commercial fundamentals are strong and risk is manageable."
        if composite >= 60
        else f"{locality} requires <b>careful consideration</b> before committing to {body.category} expansion. "
        "Some indicators are positive but timing and strategy matter significantly here."
        if composite >= 40
        else f"{locality} is <b>not recommended</b> for {body.category} expansion at this time. "
        "The risk signals and weak commercial fundamentals make this a poor fit."
    )

    conclusion_tbl = Table([[
        Table([[
            Paragraph(verdict_text,
                       S(fontSize=14, fontName="Helvetica-Bold", textColor=verdict_bg,
                         spaceAfter=4, leading=17)),
            HRFlowable(width="100%", thickness=0.5, color=DIVIDER,
                       spaceBefore=2, spaceAfter=8),
            Paragraph(verdict_statement,
                       S(fontSize=10, textColor=DARK_GRAY, leading=15, spaceAfter=8)),
        ]], colWidths=[W - 28]),
    ]], colWidths=[W])
    conclusion_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), LIGHT_BG),
        ("LINEABOVE",     (0, 0), (-1, 0), 4, verdict_bg),
        ("BOX",           (0, 0), (-1, -1), 0.5, DIVIDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
    ]))
    story.append(conclusion_tbl)
    story.append(sp(8))

    # Reasoning bullets
    story.append(Paragraph(
        "Why this recommendation was made:",
        S(fontSize=9, fontName="Helvetica-Bold", textColor=DARK_GRAY,
          spaceAfter=5, spaceBefore=4),
    ))
    why_bullets = _why_bullets(signals, composite, body.category, locality)
    bullets_rows = [[Paragraph(f"• &nbsp; {b}", bullet_txt)] for b in why_bullets]
    bullet_tbl = Table(bullets_rows, colWidths=[W])
    bullet_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), LIGHT_BG),
        ("BOX",           (0, 0), (-1, -1), 0.5, DIVIDER),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 12),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [rc.white, LIGHT_BG]),
    ]))
    story.append(bullet_tbl)
    story.append(sp(8))

    # Next steps call-to-action
    next_step = (
        f"Recommended next step: Arrange a site inspection of {locality} "
        f"and validate foot traffic patterns before signing a lease."
        if composite >= 60
        else f"Recommended next step: Monitor {locality} over the next 3–6 months. "
        "Reassess once market trajectory and competition dynamics become clearer."
        if composite >= 40
        else f"Recommended next step: Focus your search on higher-scoring suburbs. "
        f"{locality} can be revisited if market conditions improve significantly."
    )
    story.append(Paragraph(
        next_step,
        S(fontSize=9, fontName="Helvetica-Bold", textColor=verdict_bg,
          leading=14, spaceAfter=0),
    ))
    story.append(sp(14))

    # ── 10. FOOTER ────────────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=DIVIDER,
                              spaceBefore=2, spaceAfter=5))
    story.append(Paragraph(
        f"Generated by Vantage Location Intelligence on {date.today().strftime('%d %B %Y')}. "
        "Analysis is based on Foursquare OS Places venue data, Mann-Kendall market trajectory "
        "testing, DBSCAN competitive clustering, and franchise DNA fingerprint matching. "
        "For strategic planning use only — not a substitute for professional due diligence.",
        S(fontSize=7, textColor=MED_GRAY, leading=10),
    ))

    # ── Build PDF ─────────────────────────────────────────────────────────────
    doc.build(story)
    buf.seek(0)

    safe_loc = locality.replace(" ", "_").replace(",", "")
    filename = (
        f"Vantage_Report_{safe_loc}_{state_code}_"
        f"{body.category.replace(' ', '_')}_{date.today().isoformat()}.pdf"
    )
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
