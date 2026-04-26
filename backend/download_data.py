"""
Download runtime data files from HuggingFace if not already present.
Runs automatically before the app starts (called from start.sh).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

HF_TOKEN = os.environ.get("HF_TOKEN", "")
BASE_URL  = "https://huggingface.co/datasets/nithish13063/vantage-data/resolve/main"
BASE_DIR  = Path(__file__).parent

FILES = ["vantage.duckdb", "tfidf.pkl", "reducer.pkl"]


def download_file(filename: str) -> None:
    dest = BASE_DIR / filename
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  ✓ {filename} already present ({dest.stat().st_size // 1024}KB)")
        return

    url     = f"{BASE_URL}/{filename}"
    headers = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}

    print(f"  ↓ Downloading {filename} ...")
    with requests.get(url, headers=headers, stream=True, timeout=300) as r:
        if r.status_code == 401:
            print(f"  ✗ 401 Unauthorised — set HF_TOKEN env variable", file=sys.stderr)
            sys.exit(1)
        if r.status_code == 404:
            print(f"  ✗ 404 Not found — check file exists in HuggingFace repo", file=sys.stderr)
            sys.exit(1)
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        downloaded = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 256):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // total
                    print(f"\r    {pct}% ({downloaded // (1024*1024)}MB / {total // (1024*1024)}MB)", end="", flush=True)
        print(f"\r  ✓ {filename} done ({downloaded // (1024*1024)}MB)          ")


if __name__ == "__main__":
    print("=== Vantage data bootstrap ===")
    for fname in FILES:
        download_file(fname)
    print("=== All data files ready ===\n")
