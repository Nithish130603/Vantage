"""
Signal 3 — Competitive Pressure
DBSCAN cluster density of competing venues around a target category.
Higher density of same-category venues = higher competitive pressure = lower score.
Returns a score in [0, 1] where 1 = low competition.
"""

from __future__ import annotations

import numpy as np
from sklearn.cluster import DBSCAN


# ~500 m in radians for haversine (500 m / Earth radius 6371000 m)
_500M_RAD = 500.0 / 6_371_000.0


def competitive_pressure(
    venue_lats: list[float],
    venue_lons: list[float],
    target_category: str,
    venue_categories: list[str],
    eps_rad: float = _500M_RAD,
    min_samples: int = 3,
) -> float:
    """
    Parameters
    ----------
    venue_lats        : latitude for every venue in the suburb cell
    venue_lons        : longitude for every venue in the suburb cell
    target_category   : category label we're scoring for
    venue_categories  : category_label for every venue (parallel to lats/lons)
    eps_rad           : DBSCAN epsilon in radians (~500 m)
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

    xy = np.radians(np.array(coords))
    db = DBSCAN(eps=eps_rad, min_samples=min_samples, metric="haversine").fit(xy)
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
    Compute competitive pressure for every H3 cell, using k-ring (k=1)
    neighbors so that competitors near cell boundaries aren't invisible.

    For each cell we:
      1. Gather same-category venues from the cell + its 6 H3 neighbors
      2. Run DBSCAN on the combined neighborhood
      3. Only measure the clustered fraction for venues IN the target cell
         (neighbors provide context but don't inflate the target's score)

    Parameters
    ----------
    rows            : list of (h3_r7, lat, lon, category_label)
    target_category : category to score against

    Returns
    -------
    dict mapping h3_r7 → competitive_pressure score
    """
    import h3
    from collections import defaultdict

    # Build per-cell venue index
    cell_data: dict[str, list[tuple[float, float, str]]] = defaultdict(list)
    for h3_r7, lat, lon, cat in rows:
        cell_data[h3_r7].append((lat, lon, cat))

    results: dict[str, float] = {}

    for cell in cell_data:
        # Gather venues from this cell + k-ring(1) neighbors
        try:
            neighborhood = h3.grid_disk(cell, 1)  # returns set of 7 cells
        except Exception:
            neighborhood = {cell}  # fallback if h3 fails

        # Collect all same-category competitors in the neighborhood
        all_coords: list[tuple[float, float]] = []
        # Track which indices belong to the TARGET cell
        target_indices: list[int] = []

        for neighbor_cell in neighborhood:
            for lat, lon, cat in cell_data.get(neighbor_cell, []):
                if cat == target_category:
                    idx = len(all_coords)
                    all_coords.append((lat, lon))
                    if neighbor_cell == cell:
                        target_indices.append(idx)

        n_target = len(target_indices)

        # No competitors in or near this cell
        if n_target == 0:
            results[cell] = 1.0
            continue

        n_total = len(all_coords)

        # Too few competitors for DBSCAN — use simple count heuristic
        if n_total < 3:
            results[cell] = max(0.0, 1.0 - n_target / 10.0)
            continue

        # Run DBSCAN on the full neighborhood
        xy = np.radians(np.array(all_coords))
        db = DBSCAN(eps=_500M_RAD, min_samples=3, metric="haversine").fit(xy)
        labels = db.labels_

        # Count how many of the TARGET cell's venues are in dense clusters
        n_clustered_target = sum(1 for i in target_indices if labels[i] >= 0)
        cluster_ratio = n_clustered_target / n_target

        results[cell] = float(np.clip(1.0 - cluster_ratio, 0.0, 1.0))

    return results
