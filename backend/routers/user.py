"""
routers/user.py — account management endpoints.

DELETE /user/delete
  Accepts the user's Supabase JWT as a Bearer token, verifies it, then
  uses the service-role key to delete the account from auth.users via
  the Supabase Admin REST API.  The cascade on analyses + user_stores
  tables removes all associated data automatically.
"""

from __future__ import annotations

import os
import httpx
from fastapi import APIRouter, Header, HTTPException

router = APIRouter(prefix="/user", tags=["user"])

SUPABASE_URL             = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


@router.delete("/delete")
async def delete_account(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=503,
            detail="SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env",
        )

    token = authorization[7:]  # strip "Bearer "

    async with httpx.AsyncClient(timeout=15) as client:
        # Resolve the user from their own JWT
        user_resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
            },
        )
        if user_resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired session")

        user_id = user_resp.json().get("id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Could not resolve user ID")

        # Delete via Admin API — only the service role key can do this
        del_resp = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
            },
        )
        if del_resp.status_code not in (200, 204):
            raise HTTPException(
                status_code=del_resp.status_code,
                detail=del_resp.text or "Supabase admin delete failed",
            )

    return {"success": True}
