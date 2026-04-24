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
    Blend of two signals (50/50):
      1. Mann-Kendall direction (tau) — is the trend positive or negative?
      2. YoY growth rate — last 12 months vs prior 12 months.

    This catches both long-run trend (MK) and recent acceleration (YoY),
    which pure MK misses when a market is flat for 3 years then surges.

    Returns
    -------
    score in [0, 1]
        > 0.5 → growing market
        = 0.5 → flat / insufficient data
        < 0.5 → declining market
    """
    from datetime import datetime

    ref = datetime.fromisoformat(reference_date)
    cutoff_5y = ref.replace(year=ref.year - 5)
    cutoff_1y = ref.replace(year=ref.year - 1)
    cutoff_2y = ref.replace(year=ref.year - 2)

    buckets: dict[tuple[int, int], int] = {}
    last_12: int = 0
    prior_12: int = 0

    for ds in date_created_list:
        if not ds:
            continue
        try:
            d = datetime.fromisoformat(ds[:10])
        except ValueError:
            continue

        if cutoff_5y <= d <= ref:
            key = (d.year, d.month)
            buckets[key] = buckets.get(key, 0) + 1

        if cutoff_1y < d <= ref:
            last_12 += 1
        elif cutoff_2y < d <= cutoff_1y:
            prior_12 += 1

    if len(buckets) < 4:
        return 0.5

    # Signal 1: Mann-Kendall direction
    sorted_keys = sorted(buckets.keys())
    counts = [float(buckets[k]) for k in sorted_keys]
    tau = _mann_kendall_tau(counts)
    mk_score = float(np.clip(0.5 + 0.5 * tau, 0.0, 1.0))

    # Signal 2: YoY growth rate using log-ratio for better discrimination
    # log2(1.0) = 0 → score 0.5 (flat), log2(2.0) = 1 → score 0.75 (doubled)
    # log2(4.0) = 2 → score 1.0 (quadrupled), log2(0.5) = -1 → score 0.25 (halved)
    if prior_12 == 0:
        yoy_score = 0.6 if last_12 > 0 else 0.5  # new market or no data
    else:
        yoy_ratio = max(last_12 / prior_12, 0.01)  # avoid log(0)
        yoy_score = float(np.clip(0.5 + 0.25 * np.log2(yoy_ratio), 0.0, 1.0))

    return float(np.clip(0.5 * mk_score + 0.5 * yoy_score, 0.0, 1.0))


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
