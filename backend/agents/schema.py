from __future__ import annotations

from typing import Annotated, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages


class VantageState(TypedDict):
    messages: Annotated[list, add_messages]

    # Task control
    task: str           # "eda" | "audit" | "analyze" | "compare" | "report" | "chat"
    next_agent: str
    completed: list[str]

    # Inputs
    category: Optional[str]
    h3_r7: Optional[str]
    h3_r7_list: Optional[list[str]]     # for comparison: 2–5 shortlisted suburbs
    fingerprint_result: Optional[dict]  # full output of POST /fingerprint
    user_question: Optional[str]        # for chat: the founder's latest question
    conversation_history: Optional[list]  # for chat: [{role, content}, ...]

    # Agent outputs
    eda_insights: Optional[str]
    statistician_report: Optional[str]
    confidence_badges: Optional[dict]   # structured JSON parsed from statistician output
    dna_narrative: Optional[str]
    opportunity_analysis: Optional[str]
    risk_assessment: Optional[str]
    comparison_result: Optional[dict]   # structured head-to-head comparison
    chat_response: Optional[str]        # latest chat agent response
    report_sections: Optional[dict]

    # Final synthesized output
    final_output: Optional[str]
