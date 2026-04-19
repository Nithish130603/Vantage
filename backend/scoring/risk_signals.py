"""
Signal 5 — Risk Signals
Composite of three sub-signals:
  - closure_rate   : fraction of venues that are closed (high = risky)
  - saturation     : venue count relative to cell area proxy (high = risky)
  - immaturity     : fraction of venues created < 18 months ago (high = risky)

Returns a score in [0, 1] where 1 = low risk.
"""

from __future__ import annotations

from datetime import datetime


def risk_signals(
    is_closed_list: list[bool],
    date_created_list: list[str],
    total_venue_count: int,
    saturation_cap: int = 200,
    immaturity_months: int = 18,
    reference_date: str = "2026-01-01",
) -> float:
    """
    Parameters
    ----------
    is_closed_list    : bool per venue in the cell
    date_created_list : ISO date string per venue in the cell
    total_venue_count : total venues in cell (including closed)
    saturation_cap    : venue count beyond which saturation score → 0
    immaturity_months : venues newer than this are considered immature
    reference_date    : today's date for age calculation

    Returns
    -------
    risk score in [0, 1]  (1 = very safe, 0 = very risky)
    """
    n = max(len(is_closed_list), 1)

    # sub-signal 1: closure rate
    n_closed = sum(1 for x in is_closed_list if x)
    closure_rate = n_closed / n
    closure_score = 1.0 - closure_rate

    # sub-signal 2: saturation
    saturation_score = max(0.0, 1.0 - total_venue_count / saturation_cap)

    # sub-signal 3: immaturity
    ref = datetime.fromisoformat(reference_date)
    cutoff = ref.replace(year=ref.year - (immaturity_months // 12),
                         month=ref.month - (immaturity_months % 12)
                         if ref.month > immaturity_months % 12
                         else ref.month + 12 - (immaturity_months % 12))
    n_immature = 0
    n_dated = 0
    for ds in date_created_list:
        if not ds:
            continue
        try:
            d = datetime.fromisoformat(ds[:10])
            n_dated += 1
            if d > cutoff:
                n_immature += 1
        except ValueError:
            continue

    immaturity_rate = n_immature / n_dated if n_dated > 0 else 0.0
    immaturity_score = 1.0 - immaturity_rate

    # equal-weight composite
    composite = (closure_score + saturation_score + immaturity_score) / 3.0
    return float(max(0.0, min(1.0, composite)))


def risk_signals_bulk(
    rows: list[tuple[str, bool, str]],
    venue_counts: dict[str, int],
    saturation_cap: int = 200,
) -> dict[str, float]:
    """
    Parameters
    ----------
    rows          : list of (h3_r7, is_closed, date_created)
    venue_counts  : dict h3_r7 → total venue count
    saturation_cap: venue count ceiling for saturation sub-signal

    Returns
    -------
    dict mapping h3_r7 → risk score
    """
    from collections import defaultdict

    cell_data: dict[str, dict] = defaultdict(
        lambda: {"closed": [], "dates": []}
    )
    for h3_r7, is_closed, date_created in rows:
        cell_data[h3_r7]["closed"].append(bool(is_closed))
        cell_data[h3_r7]["dates"].append(date_created or "")

    return {
        cell: risk_signals(
            d["closed"],
            d["dates"],
            venue_counts.get(cell, len(d["closed"])),
            saturation_cap=saturation_cap,
        )
        for cell, d in cell_data.items()
    }
