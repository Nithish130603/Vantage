"""
Vantage LangGraph multi-agent supervisor graph.

Graph topology (supervisor → worker → supervisor → … → END):
    supervisor routes to one of:
      eda_agent | statistician | dna_analyst | market_scout |
      risk_analyst | comparison_agent | report_writer

Task flows (rule-based, no LLM in supervisor):
    "eda"     → eda_agent → FINISH
    "audit"   → statistician → FINISH
    "analyze" → dna_analyst → market_scout → risk_analyst → report_writer → FINISH
    "compare" → comparison_agent → FINISH
    "report"  → risk_analyst → report_writer → FINISH

chat_agent is exported separately — the /agent/chat endpoint invokes it
directly with the full conversation history, bypassing the supervisor.
"""

from __future__ import annotations

import json
import os
import re
from typing import Literal

from langchain_cohere import ChatCohere
from langchain_core.messages import HumanMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import create_react_agent

from agents.schema import VantageState
from agents.prompts import (
    EDA_SYSTEM_PROMPT,
    STATISTICIAN_SYSTEM_PROMPT,
    DNA_SYSTEM_PROMPT,
    SCOUT_SYSTEM_PROMPT,
    RISK_SYSTEM_PROMPT,
    COMPARISON_SYSTEM_PROMPT,
    CHAT_SYSTEM_PROMPT,
    REPORT_SYSTEM_PROMPT,
)
from agents.tools import (
    EDA_TOOLS, STAT_TOOLS, DNA_TOOLS, SCOUT_TOOLS,
    RISK_TOOLS, COMPARISON_TOOLS, CHAT_TOOLS,
)

# ── LLM ───────────────────────────────────────────────────────────────────────

_llm = ChatCohere(
    model="command-a-03-2025",
    cohere_api_key=os.environ.get("COHERE_API_KEY", ""),
    temperature=0,
)

# ── Per-agent react sub-graphs ─────────────────────────────────────────────────

_eda_agent         = create_react_agent(_llm, EDA_TOOLS,         prompt=EDA_SYSTEM_PROMPT)
_stat_agent        = create_react_agent(_llm, STAT_TOOLS,        prompt=STATISTICIAN_SYSTEM_PROMPT)
_dna_agent         = create_react_agent(_llm, DNA_TOOLS,         prompt=DNA_SYSTEM_PROMPT)
_scout_agent       = create_react_agent(_llm, SCOUT_TOOLS,       prompt=SCOUT_SYSTEM_PROMPT)
_risk_agent        = create_react_agent(_llm, RISK_TOOLS,        prompt=RISK_SYSTEM_PROMPT)
_comparison_agent  = create_react_agent(_llm, COMPARISON_TOOLS,  prompt=COMPARISON_SYSTEM_PROMPT)
_writer_agent      = create_react_agent(_llm, [],                prompt=REPORT_SYSTEM_PROMPT)

# Exported for direct use by the /agent/chat endpoint (stateful, bypasses supervisor)
chat_agent = create_react_agent(_llm, CHAT_TOOLS, prompt=CHAT_SYSTEM_PROMPT)

# ── Task → agent flow mapping ──────────────────────────────────────────────────

_FLOWS: dict[str, list[str]] = {
    "eda":     ["eda_agent",    "FINISH"],
    "audit":   ["statistician", "FINISH"],
    "analyze": ["dna_analyst", "market_scout", "risk_analyst", "report_writer", "FINISH"],
    "compare": ["comparison_agent", "FINISH"],
    "report":  ["risk_analyst", "report_writer", "FINISH"],
}


def _next_in_flow(task: str, completed: list[str]) -> str:
    flow = _FLOWS.get(task, ["FINISH"])
    for step in flow:
        if step not in completed:
            return step
    return "FINISH"


# ── Supervisor node ────────────────────────────────────────────────────────────

def supervisor(state: VantageState) -> dict:
    completed = state.get("completed") or []
    return {"next_agent": _next_in_flow(state["task"], completed)}


def _route_supervisor(state: VantageState) -> Literal[
    "eda_agent", "statistician", "dna_analyst", "market_scout",
    "risk_analyst", "comparison_agent", "report_writer", "__end__"
]:
    nxt = state.get("next_agent", "FINISH")
    return "__end__" if nxt == "FINISH" else nxt


# ── Worker helpers ─────────────────────────────────────────────────────────────

def _invoke_agent(react_agent, human_prompt: str) -> str:
    """Run a react sub-agent and return the final text response."""
    result = react_agent.invoke({"messages": [HumanMessage(content=human_prompt)]})
    for msg in reversed(result["messages"]):
        if isinstance(msg, AIMessage) and msg.content:
            c = msg.content
            return c if isinstance(c, str) else (
                "".join(b.get("text", "") for b in c if isinstance(b, dict))
                if isinstance(c, list) else str(c)
            )
    return ""


def _fp_summary(fingerprint_result: dict | None) -> str:
    """Produce a compact, human-readable summary of a fingerprint result."""
    if not fingerprint_result:
        return "No fingerprint data provided."
    top = fingerprint_result.get("top_categories", [])[:8]
    cats = ", ".join(
        f"{c['category']} ({c.get('weight', c.get('score', 0)):.2f})" if isinstance(c, dict) else str(c)
        for c in top
    )
    meta = {k: v for k, v in fingerprint_result.items()
            if k not in ("success_vector", "failure_vector", "top_categories")}
    return f"Top DNA categories: {cats or 'N/A'}\nMetadata: {json.dumps(meta)}"


def _parse_confidence_badges(stat_text: str) -> dict:
    """Extract the structured JSON confidence block from statistician output."""
    match = re.search(r"```json\s*(\{.*?\})\s*```", stat_text, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}


# ── Worker nodes ───────────────────────────────────────────────────────────────

def eda_agent(state: VantageState) -> dict:
    category_ctx = (
        f"Pay special attention to the '{state['category']}' category."
        if state.get("category") else "Analyse all categories."
    )
    output = _invoke_agent(_eda_agent, f"Perform a full EDA on the Vantage dataset. {category_ctx}")
    completed = (state.get("completed") or []) + ["eda_agent"]
    return {"eda_insights": output, "completed": completed,
            "next_agent": _next_in_flow(state["task"], completed)}


def statistician(state: VantageState) -> dict:
    category = state.get("category", "unknown")
    eda_ctx = f"\nEDA context:\n{state.get('eda_insights', '')[:600]}" if state.get("eda_insights") else ""
    prompt = (
        f"Audit and optimise the composite scoring formula for the '{category}' category.{eda_ctx}\n"
        "Run the full methodology: distributions → correlations → tier discrimination → "
        "gold standard validation → calibration → signal-to-composite → cross-category. "
        "End with the structured JSON confidence block as instructed."
    )
    output = _invoke_agent(_stat_agent, prompt)
    badges = _parse_confidence_badges(output)
    completed = (state.get("completed") or []) + ["statistician"]
    return {"statistician_report": output, "confidence_badges": badges,
            "completed": completed, "next_agent": _next_in_flow(state["task"], completed)}


def dna_analyst(state: VantageState) -> dict:
    category = state.get("category", "unknown")
    fp_summary = _fp_summary(state.get("fingerprint_result"))
    prompt = (
        f"Analyse the commercial DNA fingerprint for the '{category}' franchise.\n\n"
        f"FOUNDER'S FINGERPRINT:\n{fp_summary}\n\n"
        "Interpret what this DNA reveals about where this franchise thrives. "
        "Use get_top_suburbs_by_fingerprint to find the best suburb matches. "
        "Use get_gold_standard_profile to understand the ideal ecosystem. "
        "Generate a clear expansion hypothesis the founder can act on."
    )
    output = _invoke_agent(_dna_agent, prompt)
    completed = (state.get("completed") or []) + ["dna_analyst"]
    return {"dna_narrative": output, "completed": completed,
            "next_agent": _next_in_flow(state["task"], completed)}


def market_scout(state: VantageState) -> dict:
    category = state.get("category", "unknown")
    h3 = state.get("h3_r7")
    fp_summary = _fp_summary(state.get("fingerprint_result"))
    location_ctx = f"The founder is specifically interested in suburb {h3}." if h3 else ""
    dna_ctx = (state.get("dna_narrative") or "")[:600]
    prompt = (
        f"Identify the best expansion opportunities for '{category}'. {location_ctx}\n\n"
        f"FOUNDER'S DNA:\n{fp_summary}\n\n"
        f"DNA ANALYST CONTEXT:\n{dna_ctx}\n\n"
        "Prioritise suburbs where the founder's top DNA categories are present and growing. "
        "Use get_whitespace_gaps to surface genuine first-mover opportunities. "
        "Rank the top 5 with a strategic rationale for each."
    )
    output = _invoke_agent(_scout_agent, prompt)
    completed = (state.get("completed") or []) + ["market_scout"]
    return {"opportunity_analysis": output, "completed": completed,
            "next_agent": _next_in_flow(state["task"], completed)}


def risk_analyst(state: VantageState) -> dict:
    category = state.get("category", "unknown")
    h3 = state.get("h3_r7")
    target_ctx = f"Focus on suburb H3 cell '{h3}'." if h3 else "Analyse risk across the top opportunities."
    opp_ctx = (state.get("opportunity_analysis") or "")[:500]
    prompt = (
        f"Perform a risk assessment for '{category}' expansion. {target_ctx}\n\n"
        f"OPPORTUNITY CONTEXT:\n{opp_ctx}\n\n"
        "Break down the specific risk factors with exact numbers. "
        "For any high-risk suburb, use get_nearest_better_suburb to suggest a safer alternative."
    )
    output = _invoke_agent(_risk_agent, prompt)
    completed = (state.get("completed") or []) + ["risk_analyst"]
    return {"risk_assessment": output, "completed": completed,
            "next_agent": _next_in_flow(state["task"], completed)}


def comparison_agent(state: VantageState) -> dict:
    category = state.get("category", "unknown")
    h3_list = state.get("h3_r7_list") or []
    fp_summary = _fp_summary(state.get("fingerprint_result"))
    prompt = (
        f"Compare these shortlisted suburbs for a '{category}' franchise expansion.\n"
        f"Suburbs to compare (h3_r7 codes): {json.dumps(h3_list)}\n\n"
        f"FOUNDER'S DNA:\n{fp_summary}\n\n"
        f"Pass the suburb list as a JSON array to get_suburbs_side_by_side: '{json.dumps(h3_list)}'\n"
        "Run the full comparison methodology and produce the structured report with a clear winner."
    )
    output = _invoke_agent(_comparison_agent, prompt)
    structured = _parse_comparison_result(output)
    completed = (state.get("completed") or []) + ["comparison_agent"]
    return {"comparison_result": structured, "final_output": output,
            "completed": completed, "next_agent": "FINISH"}


def _parse_comparison_result(text: str) -> dict:
    """Extract key sections from the comparison report into a structured dict."""
    result: dict = {"full": text}
    for key, marker in [
        ("winner", "WINNER"), ("scorecard", "SIGNAL SCORECARD"),
        ("differentiators", "KEY DIFFERENTIATORS"),
        ("runner_up_case", "RUNNER-UP CASE"),
        ("red_flags", "RED FLAGS"), ("verdict", "VERDICT"),
    ]:
        idx = text.upper().find(f"**{marker}**")
        if idx == -1:
            idx = text.upper().find(marker)
        if idx == -1:
            continue
        start = idx + len(marker) + 2  # skip ** **
        # find next section marker
        end = len(text)
        for other in ["WINNER", "SIGNAL SCORECARD", "KEY DIFFERENTIATORS",
                      "RUNNER-UP CASE", "RED FLAGS", "VERDICT"]:
            if other == marker:
                continue
            for prefix in [f"**{other}**", other]:
                oi = text.upper().find(prefix, start)
                if oi != -1 and oi < end:
                    end = oi
        result[key] = text[start:end].strip()
    return result


def report_writer(state: VantageState) -> dict:
    category = state.get("category", "unknown")
    h3 = state.get("h3_r7", "the target suburb")
    badges = state.get("confidence_badges") or {}
    confidence_ctx = (
        f"Formula confidence from Statistician: {json.dumps(badges)}"
        if badges else "Formula confidence: not audited in this run."
    )
    prompt = (
        f"Write a complete location intelligence report for a '{category}' franchise expansion "
        f"targeting {h3}.\n\n"
        f"DNA ANALYSIS:\n{state.get('dna_narrative') or 'Not available'}\n\n"
        f"OPPORTUNITY ANALYSIS:\n{state.get('opportunity_analysis') or 'Not available'}\n\n"
        f"RISK ASSESSMENT:\n{state.get('risk_assessment') or 'Not available'}\n\n"
        f"{confidence_ctx}\n\n"
        "Write the full 5-section report. Where confidence badges are available, "
        "reference them in the Executive Summary."
    )
    output = _invoke_agent(_writer_agent, prompt)
    completed = (state.get("completed") or []) + ["report_writer"]
    return {
        "report_sections": _parse_report_sections(output),
        "final_output": output,
        "completed": completed,
        "next_agent": "FINISH",
    }


def _parse_report_sections(text: str) -> dict:
    sections: dict = {"full": text}
    markers = {
        "executive_summary":  "EXECUTIVE SUMMARY",
        "dna_story":          "LOCATION DNA STORY",
        "opportunity_analysis": "OPPORTUNITY ANALYSIS",
        "risk_assessment":    "RISK ASSESSMENT",
        "recommendation":     "RECOMMENDATION",
    }
    upper = text.upper()
    for key, marker in markers.items():
        idx = upper.find(marker)
        if idx == -1:
            continue
        start = idx + len(marker)
        end = len(text)
        for other in markers.values():
            if other == marker:
                continue
            oi = upper.find(other, start)
            if oi != -1 and oi < end:
                end = oi
        sections[key] = text[start:end].strip()
    return sections


# ── Assemble the supervisor graph ──────────────────────────────────────────────

def build_graph():
    workflow = StateGraph(VantageState)

    workflow.add_node("supervisor",       supervisor)
    workflow.add_node("eda_agent",        eda_agent)
    workflow.add_node("statistician",     statistician)
    workflow.add_node("dna_analyst",      dna_analyst)
    workflow.add_node("market_scout",     market_scout)
    workflow.add_node("risk_analyst",     risk_analyst)
    workflow.add_node("comparison_agent", comparison_agent)
    workflow.add_node("report_writer",    report_writer)

    workflow.add_edge(START, "supervisor")

    workflow.add_conditional_edges(
        "supervisor",
        _route_supervisor,
        {
            "eda_agent":        "eda_agent",
            "statistician":     "statistician",
            "dna_analyst":      "dna_analyst",
            "market_scout":     "market_scout",
            "risk_analyst":     "risk_analyst",
            "comparison_agent": "comparison_agent",
            "report_writer":    "report_writer",
            "__end__":          END,
        },
    )

    for worker in ["eda_agent", "statistician", "dna_analyst", "market_scout",
                   "risk_analyst", "comparison_agent", "report_writer"]:
        workflow.add_edge(worker, "supervisor")

    return workflow.compile()


vantage_graph = build_graph()
