"""
/agent — multi-agent LangGraph endpoints.

POST /agent/analyze          → DNA + Scout + Risk + Report (main founder flow)
POST /agent/analyze/stream   → SSE streaming version
GET  /agent/eda              → EDA agent in isolation (background/admin)
GET  /agent/audit            → Statistician formula audit
POST /agent/compare          → Head-to-head suburb comparison
POST /agent/chat             → Conversational Q&A with full context
POST /agent/report/{h3_r7}   → AI narrative for one suburb
"""

from __future__ import annotations

import json
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, AIMessage
from pydantic import BaseModel, Field

router = APIRouter(prefix="/agent", tags=["agent"])

VALID_TASKS = {"eda", "audit", "analyze", "compare", "report"}


def _get_graph():
    from agents.graph import vantage_graph
    return vantage_graph


def _get_chat_agent():
    from agents.graph import chat_agent
    return chat_agent


def _check_api_key():
    if not os.environ.get("COHERE_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="COHERE_API_KEY environment variable is not set.",
        )


# ── Request / response models ──────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    task: str = "analyze"
    category: Optional[str] = None
    h3_r7: Optional[str] = None
    h3_r7_list: Optional[list[str]] = None
    fingerprint_result: Optional[dict] = None


class AgentResponse(BaseModel):
    task: str
    category: Optional[str] = None
    h3_r7: Optional[str] = None
    eda_insights: Optional[str] = None
    statistician_report: Optional[str] = None
    confidence_badges: Optional[dict] = None
    dna_narrative: Optional[str] = None
    opportunity_analysis: Optional[str] = None
    risk_assessment: Optional[str] = None
    comparison_result: Optional[dict] = None
    report_sections: Optional[dict] = None
    final_output: Optional[str] = None
    completed: list[str] = []


class CompareRequest(BaseModel):
    category: str = Field(..., description="Business category being evaluated")
    h3_r7_list: list[str] = Field(..., min_length=2, max_length=5,
                                   description="2–5 suburb h3_r7 codes to compare")
    fingerprint_result: Optional[dict] = Field(
        None, description="Founder's fingerprint from POST /fingerprint"
    )


class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    question: str = Field(..., description="The founder's latest question")
    category: Optional[str] = Field(None, description="Franchise category")
    h3_r7: Optional[str] = Field(None, description="Suburb currently being viewed")
    fingerprint_result: Optional[dict] = Field(None, description="Founder's fingerprint")
    conversation_history: list[ChatMessage] = Field(
        default_factory=list,
        description="Prior turns in the conversation [{role, content}, ...]"
    )


class ChatResponse(BaseModel):
    response: str
    conversation_history: list[ChatMessage]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _initial_state(req: AnalyzeRequest) -> dict:
    return {
        "messages": [],
        "task": req.task,
        "next_agent": "",
        "completed": [],
        "category": req.category,
        "h3_r7": req.h3_r7,
        "h3_r7_list": req.h3_r7_list,
        "fingerprint_result": req.fingerprint_result,
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


_TOOL_NARRATION_PATTERNS = [
    r"(?i)^I(?:'ll| will) use (?:the )?[\w_]+ tool[^\n]*\n?",
    r"(?i)^Let me (?:call|use) (?:the )?[\w_]+ tool[^\n]*\n?",
    r"(?i)^Next step:\s*Use (?:the )?[\w_]+ tool[^\n]*\n?",
    r"(?i)^Step \d+:.*tool[^\n]*\n?",
    r"(?i)^I(?:'ll| will) now (?:use|call|look up|retrieve)[^\n]*\n?",
]

import re as _re

def _strip_tool_narration(text: str) -> str:
    """Remove any lines where the model narrated its own tool-calling process."""
    for pat in _TOOL_NARRATION_PATTERNS:
        text = _re.sub(pat, "", text, flags=_re.MULTILINE)
    return text.strip()


def _build_chat_context(req: ChatRequest) -> str:
    """Build the context block prepended to the first chat message."""
    parts = []
    if req.category:
        parts.append(f"Franchise category: {req.category}")
    if req.h3_r7:
        parts.append(f"Currently viewing suburb (h3_r7): {req.h3_r7}")
    if req.fingerprint_result:
        top = req.fingerprint_result.get("top_categories", [])[:6]
        cats = ", ".join(
            f"{c['category']} ({c.get('weight', c.get('score', 0)):.2f})" if isinstance(c, dict) else str(c)
            for c in top
        )
        if cats:
            parts.append(f"DNA top categories: {cats}")
    return "[Context: " + " | ".join(parts) + "]" if parts else ""


# ── POST /agent/analyze ────────────────────────────────────────────────────────

@router.post("/analyze", response_model=AgentResponse)
async def analyze(req: AnalyzeRequest):
    """
    Run the multi-agent pipeline for a franchise founder.

    task options:
    - "analyze"  DNA Analyst → Market Scout → Risk Analyst → Report Writer (main flow)
    - "report"   Risk Analyst → Report Writer (single suburb deep-dive)
    - "eda"      EDA Agent only (dataset analysis, best run once)
    - "audit"    Statistician only (formula confidence audit)
    - "compare"  Comparison Agent only (use /agent/compare instead for cleaner API)
    """
    _check_api_key()
    if req.task not in VALID_TASKS:
        raise HTTPException(400, f"Unknown task '{req.task}'. Valid: {sorted(VALID_TASKS)}")

    state = _initial_state(req)
    try:
        result = await _get_graph().ainvoke(state)
    except Exception as exc:
        raise HTTPException(500, f"Agent pipeline failed: {exc}")

    return AgentResponse(
        task=req.task,
        category=req.category,
        h3_r7=req.h3_r7,
        eda_insights=result.get("eda_insights"),
        statistician_report=result.get("statistician_report"),
        confidence_badges=result.get("confidence_badges"),
        dna_narrative=result.get("dna_narrative"),
        opportunity_analysis=result.get("opportunity_analysis"),
        risk_assessment=result.get("risk_assessment"),
        comparison_result=result.get("comparison_result"),
        report_sections=result.get("report_sections"),
        final_output=result.get("final_output"),
        completed=result.get("completed", []),
    )


# ── POST /agent/analyze/stream ─────────────────────────────────────────────────

@router.post("/analyze/stream")
async def analyze_stream(req: AnalyzeRequest):
    """
    SSE-streamed multi-agent pipeline.

    Each event is a JSON object:
      {"type": "token",        "content": "...", "node": "dna_analyst"}
      {"type": "node_complete","node": "dna_analyst", "output_key": "dna_narrative"}
      {"type": "done",         "completed": [...]}
      {"type": "error",        "detail": "..."}
    """
    _check_api_key()
    if req.task not in VALID_TASKS:
        raise HTTPException(400, f"Unknown task '{req.task}'.")

    state = _initial_state(req)

    _NODE_TO_KEY = {
        "eda_agent":        "eda_insights",
        "statistician":     "statistician_report",
        "dna_analyst":      "dna_narrative",
        "market_scout":     "opportunity_analysis",
        "risk_analyst":     "risk_assessment",
        "comparison_agent": "final_output",
        "report_writer":    "final_output",
    }

    async def generate():
        try:
            async for event in _get_graph().astream_events(state, version="v2"):
                ev   = event.get("event", "")
                name = event.get("name", "")
                node = event.get("metadata", {}).get("langgraph_node", name)

                if ev == "on_chat_model_stream":
                    chunk = event["data"].get("chunk")
                    content = ""
                    if chunk and hasattr(chunk, "content"):
                        raw = chunk.content
                        if isinstance(raw, str):
                            content = raw
                        elif isinstance(raw, list):
                            content = "".join(
                                b.get("text", "") for b in raw if isinstance(b, dict)
                            )
                    if content:
                        yield f"data: {json.dumps({'type': 'token', 'content': content, 'node': node})}\n\n"

                elif ev == "on_chain_end" and name in _NODE_TO_KEY:
                    out = event.get("data", {}).get("output", {})
                    key = _NODE_TO_KEY[name]
                    val = out.get(key, "") if isinstance(out, dict) else ""
                    yield f"data: {json.dumps({'type': 'node_complete', 'node': name, 'output_key': key, 'preview': str(val)[:200]})}\n\n"

        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── GET /agent/eda ─────────────────────────────────────────────────────────────

@router.get("/eda")
async def run_eda(category: Optional[str] = Query(None)):
    """Run the EDA agent. Best called once after the pipeline, not per user request."""
    _check_api_key()
    req = AnalyzeRequest(task="eda", category=category)
    state = _initial_state(req)
    try:
        result = await _get_graph().ainvoke(state)
    except Exception as exc:
        raise HTTPException(500, f"EDA agent failed: {exc}")
    return {"category": category, "eda_insights": result.get("eda_insights"),
            "completed": result.get("completed", [])}


# ── GET /agent/audit ───────────────────────────────────────────────────────────

@router.get("/audit")
async def run_audit(category: str = Query(..., description="Business category to audit")):
    """
    Run the Statistician agent to audit the scoring formula for a category.
    Returns narrative + structured confidence_badges JSON.
    """
    _check_api_key()
    req = AnalyzeRequest(task="audit", category=category)
    state = _initial_state(req)
    try:
        result = await _get_graph().ainvoke(state)
    except Exception as exc:
        raise HTTPException(500, f"Statistician agent failed: {exc}")
    return {
        "category": category,
        "statistician_report": result.get("statistician_report"),
        "confidence_badges":   result.get("confidence_badges"),
        "completed":           result.get("completed", []),
    }


# ── POST /agent/compare ────────────────────────────────────────────────────────

@router.post("/compare")
async def compare_suburbs(req: CompareRequest):
    """
    Head-to-head comparison of 2–5 shortlisted suburbs.

    Provide the founder's fingerprint_result (from POST /fingerprint) so the
    comparison is personalised to their specific DNA, not just raw scores.

    Returns a structured comparison with a clear winner and signal scorecard.
    """
    _check_api_key()
    if len(req.h3_r7_list) < 2:
        raise HTTPException(400, "Provide at least 2 suburb h3_r7 codes to compare.")

    state = _initial_state(AnalyzeRequest(
        task="compare",
        category=req.category,
        h3_r7_list=req.h3_r7_list,
        fingerprint_result=req.fingerprint_result,
    ))
    try:
        result = await _get_graph().ainvoke(state)
    except Exception as exc:
        raise HTTPException(500, f"Comparison agent failed: {exc}")

    return {
        "category":          req.category,
        "suburbs_compared":  req.h3_r7_list,
        "comparison_result": result.get("comparison_result"),
        "final_output":      result.get("final_output"),
        "completed":         result.get("completed", []),
    }


# ── POST /agent/chat/stream ────────────────────────────────────────────────────

@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """
    SSE-streamed version of /agent/chat. Each event is a JSON object:
      {"type": "token",  "content": "..."}   — partial text as it arrives
      {"type": "done",   "response": "..."}  — full response + updated history
      {"type": "error",  "detail": "..."}
    """
    _check_api_key()

    context_block = _build_chat_context(req)
    chat_agent = _get_chat_agent()

    messages = []
    for turn in req.conversation_history:
        if turn.role == "user":
            messages.append(HumanMessage(content=turn.content))
        else:
            messages.append(AIMessage(content=turn.content))

    new_question = req.question
    if context_block:
        new_question = f"{context_block}\n\n{req.question}"
    messages.append(HumanMessage(content=new_question))

    async def generate():
        # Track tool call depth so we only stream final-response tokens.
        # Cohere emits text before tool calls (reasoning) — we discard that.
        # After all tools complete, the next text is the user-facing answer.
        pending_tools = 0
        had_any_tool = False
        pre_tool_buffer = ""   # text before any tool call (may be discarded)
        full_response = ""

        try:
            async for event in chat_agent.astream_events({"messages": messages}, version="v2"):
                ev = event.get("event", "")

                if ev == "on_tool_start":
                    pending_tools += 1
                    had_any_tool = True
                    pre_tool_buffer = ""   # discard pre-tool reasoning text

                elif ev == "on_tool_end":
                    pending_tools = max(0, pending_tools - 1)

                elif ev == "on_chat_model_stream":
                    chunk = event["data"].get("chunk")
                    content = ""
                    if chunk and hasattr(chunk, "content"):
                        raw = chunk.content
                        if isinstance(raw, str):
                            content = raw
                        elif isinstance(raw, list):
                            content = "".join(
                                b.get("text", "") for b in raw if isinstance(b, dict)
                            )
                    if not content:
                        continue

                    if pending_tools > 0:
                        # Tool call in progress — skip tool JSON noise
                        continue
                    elif had_any_tool:
                        # Post-tool final answer — stream immediately
                        full_response += content
                        yield f"data: {json.dumps({'type': 'token', 'content': content})}\n\n"
                    else:
                        # No tool called yet — buffer (may be discarded if tool follows)
                        pre_tool_buffer += content

        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"
            return

        # If no tools were used, the buffered text is the complete response
        if not had_any_tool and pre_tool_buffer:
            full_response = _strip_tool_narration(pre_tool_buffer)
            yield f"data: {json.dumps({'type': 'token', 'content': full_response})}\n\n"
        elif full_response:
            full_response = _strip_tool_narration(full_response)

        updated_history = list(req.conversation_history) + [
            ChatMessage(role="user",      content=req.question),
            ChatMessage(role="assistant", content=full_response),
        ]
        yield f"data: {json.dumps({'type': 'done', 'response': full_response, 'conversation_history': [h.model_dump() for h in updated_history]})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST /agent/chat ───────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    Conversational Q&A with the Location Intelligence Advisor.

    Pass the full conversation_history on every request to maintain context.
    The response includes the updated history so you can pass it straight back
    on the next turn.

    Example questions:
    - "Why does Newtown score higher than Glebe?"
    - "Is there anywhere safer in Victoria with similar DNA?"
    - "What are the biggest risks in this suburb?"
    - "Show me whitespace gaps in Queensland."
    """
    _check_api_key()

    context_block = _build_chat_context(req)
    chat_agent = _get_chat_agent()

    # Build message list: history + new question
    messages = []
    for turn in req.conversation_history:
        if turn.role == "user":
            messages.append(HumanMessage(content=turn.content))
        else:
            messages.append(AIMessage(content=turn.content))

    # Prepend context to the very first user message (or the current question)
    new_question = req.question
    if context_block and not messages:
        # First message — embed context inline
        new_question = f"{context_block}\n\n{req.question}"
    elif context_block and messages:
        # Refresh context at start of current message so agent always has it
        new_question = f"{context_block}\n\n{req.question}"

    messages.append(HumanMessage(content=new_question))

    try:
        result = await chat_agent.ainvoke({"messages": messages})
    except Exception as exc:
        raise HTTPException(500, f"Chat agent failed: {exc}")

    # Extract final assistant response — skip messages that also contain tool_calls
    # (those are mid-reasoning turns, not the final answer)
    response_text = ""
    for msg in reversed(result["messages"]):
        if isinstance(msg, AIMessage) and msg.content and not getattr(msg, "tool_calls", None):
            c = msg.content
            response_text = c if isinstance(c, str) else (
                "".join(b.get("text", "") for b in c if isinstance(b, dict))
                if isinstance(c, list) else str(c)
            )
            break
    response_text = _strip_tool_narration(response_text)

    updated_history = list(req.conversation_history) + [
        ChatMessage(role="user",      content=req.question),
        ChatMessage(role="assistant", content=response_text),
    ]

    return ChatResponse(response=response_text, conversation_history=updated_history)


# ── POST /agent/report/{h3_r7} ─────────────────────────────────────────────────

@router.post("/report/{h3_r7}")
async def generate_ai_report(
    h3_r7: str,
    category: str = Query(..., description="Business category"),
    fingerprint_result: Optional[dict] = None,
):
    """
    AI-powered narrative report for a specific suburb.
    Runs Risk Analyst → Report Writer and returns structured sections.
    """
    _check_api_key()
    req = AnalyzeRequest(
        task="report",
        category=category,
        h3_r7=h3_r7,
        fingerprint_result=fingerprint_result,
    )
    state = _initial_state(req)
    try:
        result = await _get_graph().ainvoke(state)
    except Exception as exc:
        raise HTTPException(500, f"Report agent failed: {exc}")

    return {
        "h3_r7":           h3_r7,
        "category":        category,
        "report_sections": result.get("report_sections"),
        "final_output":    result.get("final_output"),
        "risk_assessment": result.get("risk_assessment"),
        "completed":       result.get("completed", []),
    }


# ── POST /agent/explain/stream ─────────────────────────────────────────────────

class ExplainRequest(BaseModel):
    signal_name: str = Field(..., description="e.g. 'Fingerprint Match'")
    score: float      = Field(..., description="0-1 score")
    badge: str        = Field(..., description="Human-readable badge text")
    chart_data: list[dict] = Field(default_factory=list)
    locality: str     = Field(..., description="Suburb name")
    state: str        = Field(default="AU")
    category: str     = Field(..., description="Franchise category")


def _build_explain_prompt(req: ExplainRequest) -> str:
    pct = round(req.score * 100)
    rating = "strong" if req.score >= 0.65 else "moderate" if req.score >= 0.40 else "weak"

    # Summarise chart_data into a compact readable form
    chart_summary = ""
    if req.chart_data:
        items = req.chart_data[:8]
        parts = []
        for item in items:
            # Support multiple key naming conventions
            label = item.get("category") or item.get("label") or item.get("month") or str(item)
            value = item.get("count") or item.get("value") or item.get("created") or ""
            extra = ""
            if item.get("closed") is not None:
                extra = f" (closed: {item.get('closed')}, net: {item.get('net')})"
            parts.append(f"{label}: {value}{extra}")
        chart_summary = "; ".join(parts)

    return f"""You are a concise location intelligence analyst for franchise expansion.
A franchise founder is reviewing a deep-dive report for {req.locality}, {req.state} — they want to expand their {req.category} business there.

They are looking at the **{req.signal_name}** signal card:
- Score: {pct}/100 ({rating}) — badge: {req.badge}
- Underlying data: {chart_summary if chart_summary else "no chart data available"}

Write exactly 2-3 sentences in plain English that:
1. Interpret what this specific score means for opening a {req.category} in {req.locality}
2. Reference 1-2 concrete numbers from the data above if meaningful
3. End with one practical implication or action the founder should take

No bullet points. No headings. Speak directly to the founder as "you". Be specific and honest."""


@router.post("/explain/stream")
async def explain_signal_stream(req: ExplainRequest):
    """
    SSE stream — AI-generated plain-English explanation of one scoring signal.
    Calls the LLM directly (NO tools) so the model only analyses the data
    we supply and never tries to look up external information.
    Events: {type: token, content} / {type: done, text} / {type: error}
    """
    _check_api_key()

    # Import the raw LLM (no tools bound — avoids the agent trying to look up
    # the suburb in its database tools and returning "couldn't find info")
    from agents.graph import _llm as _base_llm
    from langchain_cohere import ChatCohere
    import os as _os

    # Use a fresh LLM instance with slightly higher temperature for more
    # natural prose, and NO tools bound to it.
    _explain_llm = ChatCohere(
        model="command-a-03-2025",
        cohere_api_key=_os.environ.get("COHERE_API_KEY", ""),
        temperature=0.3,
    )

    prompt = _build_explain_prompt(req)
    messages = [HumanMessage(content=prompt)]

    async def generate():
        full_text = ""
        try:
            async for chunk in _explain_llm.astream(messages):
                content = ""
                raw = chunk.content
                if isinstance(raw, str):
                    content = raw
                elif isinstance(raw, list):
                    content = "".join(b.get("text", "") for b in raw if isinstance(b, dict))
                if content:
                    full_text += content
                    yield f"data: {json.dumps({'type': 'token', 'content': content})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"
            return

        yield f"data: {json.dumps({'type': 'done', 'text': full_text})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
