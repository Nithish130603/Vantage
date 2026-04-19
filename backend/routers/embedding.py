"""
GET /embedding?category=Café

Returns UMAP 2D coordinates for the scatter plot, with scores and tier overlaid.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from state import state

router = APIRouter()


class EmbeddingPoint(BaseModel):
    h3_r7: str
    umap_x: float
    umap_y: float
    score: Optional[float]
    tier: Optional[str]
    locality: Optional[str]
    state: Optional[str]
    venue_count: int
    center_lat: float
    center_lon: float


@router.get("/embedding", response_model=list[EmbeddingPoint])
def get_embedding(
    category: str = Query(None, description="Overlay scores for this category"),
):
    con = state["get_con"]()

    if category:
        rows = con.execute("""
            SELECT
                u.h3_r7,
                u.umap_x,
                u.umap_y,
                ss.composite_score / 100.0  AS score,
                ss.tier,
                sc.locality,
                sc.state,
                sc.venue_count,
                sc.center_lat,
                sc.center_lon
            FROM umap_coords u
            JOIN suburb_cells sc ON sc.h3_r7 = u.h3_r7
            LEFT JOIN suburb_scores ss
                ON  ss.cell_id = u.h3_r7
                AND LOWER(REPLACE(ss.category, 'é', 'e'))
                  = LOWER(REPLACE(?, 'é', 'e'))
        """, [category]).fetchall()
    else:
        rows = con.execute("""
            SELECT
                u.h3_r7,
                u.umap_x,
                u.umap_y,
                NULL  AS score,
                NULL  AS tier,
                sc.locality,
                sc.state,
                sc.venue_count,
                sc.center_lat,
                sc.center_lon
            FROM umap_coords u
            JOIN suburb_cells sc ON sc.h3_r7 = u.h3_r7
        """).fetchall()

    return [
        EmbeddingPoint(
            h3_r7=r[0], umap_x=r[1], umap_y=r[2],
            score=r[3], tier=r[4],
            locality=r[5], state=r[6],
            venue_count=r[7], center_lat=r[8], center_lon=r[9],
        )
        for r in rows
    ]
