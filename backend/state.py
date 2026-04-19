"""Shared application state — loaded once at startup, read by all routers."""
from typing import Any

state: dict[str, Any] = {}
