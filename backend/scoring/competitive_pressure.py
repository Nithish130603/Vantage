"""
Signal 3 — Competitive Pressure
DBSCAN cluster density of competing venues around a target category.
Higher density of same-category venues = higher competitive pressure = lower score.
Returns a score in [0, 1] where 1 = low competition.
"""

from __future__ import annotations

import numpy as np
from sklearn.cluster import DBSCAN


# ~500 m in degrees latitude (approximate, good enough for suburb level)
_500M_DEG = 0.0045


def competitive_pressure(
    venue_lats: list[float],
    venue_lons: list[float],
    target_category: str,
    venue_categories: list[str],
    eps_deg: float = _500M_DEG,
    min_samples: int = 3,
) -> float:
    """
    Parameters
    ----------
    venue_lats        : latitude for every venue in the suburb cell
    venue_lons        : longitude for every venue in the suburb cell
    target_category   : category label we're scoring for
    venue_categories  : category_label for every venue (parallel to lats/lons)
    eps_deg           : DBSCAN epsilon in degrees (~500 m)
    min_samples       : DBSCAN minimum cluster size

    Returns
    -------
    score in [0, 1] — 1 = no competition, 0 = extremely dense cluster
    """
    if not venue_lats:
        return 1.0

    # filter to same-category competitors
    coords = [
        (lat, lon)
        for lat, lon, cat in zip(venue_lats, venue_lons, venue_categories)
        if cat == target_category
    ]

    n_competitors = len(coords)
    if n_competitors == 0:
        return 1.0
    if n_competitors < min_samples:
        # a few scattered competitors — light pressure
        return max(0.0, 1.0 - n_competitors / 10.0)

    xy = np.array(coords)
    db = DBSCAN(eps=eps_deg, min_samples=min_samples, metric="euclidean").fit(xy)
    labels = db.labels_

    n_clustered = int(np.sum(labels >= 0))
    cluster_ratio = n_clustered / n_competitors  # fraction inside dense clusters

    # raw_pressure: 0 = all scattered, 1 = all in dense clusters
    raw_pressure = cluster_ratio
    return float(np.clip(1.0 - raw_pressure, 0.0, 1.0))


def competitive_pressure_bulk(
    rows: list[tuple[str, float, float, str]],
    target_category: str,
) -> dict[str, float]:
    """
    Parameters
    ----------
    rows            : list of (h3_r7, lat, lon, category_label)
    target_category : category to score against

    Returns
    -------
    dict mapping h3_r7 → competitive_pressure score
    """
    from collections import defaultdict

    cell_data: dict[str, dict] = defaultdict(lambda: {"lats": [], "lons": [], "cats": []})
    for h3_r7, lat, lon, cat in rows:
        cell_data[h3_r7]["lats"].append(lat)
        cell_data[h3_r7]["lons"].append(lon)
        cell_data[h3_r7]["cats"].append(cat)

    return {
        cell: competitive_pressure(
            d["lats"], d["lons"], target_category, d["cats"]
        )
        for cell, d in cell_data.items()
    }
