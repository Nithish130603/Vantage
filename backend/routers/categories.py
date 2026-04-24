"""
GET /categories
Returns the list of business categories that have been pre-scored
and are available for analysis.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from state import state

router = APIRouter()


class CategoryItem(BaseModel):
    name: str
    venue_count: int
    display_order: int


class CategoriesResponse(BaseModel):
    categories: list[CategoryItem]
    total: int


# Fallback if the categories table hasn't been created yet
_FALLBACK = [
    CategoryItem(name="Gym & Fitness", venue_count=0, display_order=0),
    CategoryItem(name="Café", venue_count=0, display_order=1),
    CategoryItem(name="Pharmacy", venue_count=0, display_order=2),
    CategoryItem(name="Restaurant", venue_count=0, display_order=3),
    CategoryItem(name="Retail", venue_count=0, display_order=4),
]


@router.get("/categories", response_model=CategoriesResponse)
def get_categories():
    """Return available pre-scored categories, ordered by display_order."""
    con = state["get_con"]()

    # Check if categories table exists
    tables = [
        r[0] for r in
        con.execute("SELECT table_name FROM information_schema.tables").fetchall()
    ]

    if "categories" not in tables:
        return CategoriesResponse(categories=_FALLBACK, total=len(_FALLBACK))

    rows = con.execute(
        "SELECT name, venue_count, display_order "
        "FROM categories ORDER BY display_order"
    ).fetchall()

    if not rows:
        return CategoriesResponse(categories=_FALLBACK, total=len(_FALLBACK))

    items = [
        CategoryItem(name=r[0], venue_count=r[1], display_order=r[2])
        for r in rows
    ]
    return CategoriesResponse(categories=items, total=len(items))
