"""
Signal 2 — Market Trajectory
Mann-Kendall trend test on monthly venue creation counts.
Positive tau → growing market; negative tau → shrinking.
Returns a score in [0, 1] where 0.5 is flat/unknown.
"""

from __future__ import annotations

import numpy as np


def _mann_kendall_tau(series: list[float]) -> float:
    """Compute Mann-Kendall S statistic normalised to tau ∈ [-1, 1]."""
    n = len(series)
    if n < 4:
        return 0.0
    s = 0
    for i in range(n - 1):
        for j in range(i + 1, n):
            diff = series[j] - series[i]
            if diff > 0:
                s += 1
            elif diff < 0:
                s -= 1
    n_pairs = n * (n - 1) / 2
    return s / n_pairs if n_pairs > 0 else 0.0


def market_trajectory(
    date_created_list: list[str],
    reference_date: str = "2026-01-01",
) -> float:
    """
    Parameters
    ----------
    date_created_list : ISO date strings for all venues in the suburb
    reference_date    : upper bound for the time window (ISO date string)

    Returns
    -------
    score in [0, 1]
        > 0.5 → growing market
        = 0.5 → flat / insufficient data
        < 0.5 → declining market
    """
    from datetime import datetime

    ref = datetime.fromisoformat(reference_date)

    # bucket into months over a 5-year window
    buckets: dict[tuple[int, int], int] = {}
    cutoff = ref.replace(year=ref.year - 5)

    for ds in date_created_list:
        if not ds:
            continue
        try:
            d = datetime.fromisoformat(ds[:10])
        except ValueError:
            continue
        if d < cutoff or d > ref:
            continue
        key = (d.year, d.month)
        buckets[key] = buckets.get(key, 0) + 1

    if len(buckets) < 4:
        return 0.5

    # build time-ordered counts
    sorted_keys = sorted(buckets.keys())
    counts = [float(buckets[k]) for k in sorted_keys]

    tau = _mann_kendall_tau(counts)
    # map tau ∈ [-1, 1] → score ∈ [0, 1]
    return float(np.clip(0.5 + 0.5 * tau, 0.0, 1.0))


def market_trajectory_bulk(
    rows: list[tuple[str, str]],
) -> dict[str, float]:
    """
    Parameters
    ----------
    rows : list of (h3_r7, date_created) tuples

    Returns
    -------
    dict mapping h3_r7 → trajectory score
    """
    from collections import defaultdict

    cell_dates: dict[str, list[str]] = defaultdict(list)
    for h3_r7, date_created in rows:
        if date_created:
            cell_dates[h3_r7].append(date_created)

    return {cell: market_trajectory(dates) for cell, dates in cell_dates.items()}
