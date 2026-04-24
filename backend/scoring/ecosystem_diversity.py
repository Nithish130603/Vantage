"""
Signal 4 — Ecosystem Diversity
Shannon entropy of category mix in the H3 cell.
Higher diversity = better supporting ecosystem for a new business.
Returns a score in [0, 1].
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Optional


def shannon_entropy(counts: list[int]) -> float:
    total = sum(counts)
    if total == 0:
        return 0.0
    entropy = 0.0
    for c in counts:
        if c > 0:
            p = c / total
            entropy -= p * math.log2(p)
    return entropy


def ecosystem_diversity(
    category_labels: list[str],
    entropy_floor: float = 0.0,
    entropy_ceil: Optional[float] = None,
) -> float:
    """
    Parameters
    ----------
    category_labels : list of category_label strings for all open venues in cell
    entropy_floor   : minimum entropy to map to score 0 (from eda_decisions.json)
    entropy_ceil    : max entropy used for normalisation (computed if None)

    Returns
    -------
    score in [0, 1]
    """
    if not category_labels:
        return 0.0

    counts = list(Counter(category_labels).values())
    h = shannon_entropy(counts)

    # theoretical maximum entropy = log2(n_unique_categories)
    n_unique = len(set(category_labels))
    h_max = math.log2(n_unique) if n_unique > 1 else 1.0
    if entropy_ceil is not None:
        h_max = max(h_max, entropy_ceil)

    if h_max <= entropy_floor:
        return 1.0 if h >= entropy_floor else 0.0

    score = (h - entropy_floor) / (h_max - entropy_floor)
    return float(max(0.0, min(1.0, score)))


def ecosystem_diversity_bulk(
    rows: list[tuple[str, str]],
    entropy_floor: float = 0.0,
) -> dict[str, float]:
    """
    Parameters
    ----------
    rows          : list of (h3_r7, category_label) for all open venues
    entropy_floor : from eda_decisions.json

    Returns
    -------
    dict mapping h3_r7 → diversity score

    Uses a global empirical ceiling (95th percentile of all cells' raw entropy)
    instead of per-cell theoretical max. This prevents small cells with few
    categories from getting inflated 100% scores.
    """
    from collections import defaultdict

    cell_cats: dict[str, list[str]] = defaultdict(list)
    for h3_r7, cat in rows:
        if cat:
            cell_cats[h3_r7].append(cat)

    # Compute raw entropies first to find a global ceiling
    raw_entropies: dict[str, float] = {}
    for cell, cats in cell_cats.items():
        counts = list(Counter(cats).values())
        raw_entropies[cell] = shannon_entropy(counts)

    if not raw_entropies:
        return {}

    # Use 95th percentile of observed entropies as the global ceiling
    # This makes scores comparable across cells of different sizes
    import numpy as np
    entropy_vals = list(raw_entropies.values())
    global_ceil = float(np.percentile(entropy_vals, 95)) if len(entropy_vals) >= 5 else max(entropy_vals)
    global_ceil = max(global_ceil, entropy_floor + 0.1)  # avoid division by zero

    return {
        cell: ecosystem_diversity(
            cats,
            entropy_floor=entropy_floor,
            entropy_ceil=global_ceil,
        )
        for cell, cats in cell_cats.items()
    }
