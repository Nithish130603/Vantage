# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Vantage — Location Intelligence Platform
## Hackathon: CommSTEM × SuData Data-Hack 2026

## What we are building
A location intelligence web app that decodes the commercial DNA of
successful business locations using Foursquare's 100M place dataset,
then finds unexplored expansion opportunities using UMAP embeddings.

## The user
Franchise founders with 5-30 locations who need to find where to
open next — without consultants, without guesswork.

## Stack
- Backend:  FastAPI + DuckDB + Python  →  backend/
- Frontend: Next.js 15 + TypeScript + Tailwind + Mapbox  →  frontend/
- Data:     Foursquare OS Places + H3 + TF-IDF + UMAP  →  data/

## Development commands

### Backend (backend/)
```bash
# Install dependencies
pip install -r requirements.txt

# Run dev server (port 8000, reload on change)
uvicorn main:app --reload --port 8000

# Run a single test
pytest tests/test_fingerprint.py -v

# Run all tests
pytest

# Load/query the database directly
python -c "import duckdb; con = duckdb.connect('vantage.duckdb'); print(con.execute('SHOW TABLES').fetchall())"
```

### Frontend (frontend/)
```bash
# Install dependencies
npm install

# Run dev server (port 3000)
npm run dev

# Type-check without building
npm run type-check

# Build for production
npm run build

# Lint
npm run lint
```

### Data pipeline (data/)
```bash
# All pipeline constants come from eda_decisions.json — never hardcode thresholds
python pipeline.py          # full ETL: ingest → features → UMAP → scores → DuckDB
python embed.py             # refit UMAP only (outputs reducer.pkl + umap_coords)
python score.py             # recompute suburb_scores from existing features
```

## Architecture

### Request flow
```
Browser → Next.js (3000) → FastAPI (8000) → DuckDB (vantage.duckdb)
                                           ↓
                                    tfidf.pkl / reducer.pkl (in-memory at startup)
```

### Backend layout
- `main.py` — FastAPI app, mounts all routers
- `routers/` — one file per endpoint group (fingerprint, scan, location, embedding, report)
- `scoring/` — the 5 scoring signal implementations (one module each)
- `vantage.duckdb` — single-file database; never commit binary changes
- `tfidf.pkl` / `reducer.pkl` — loaded once at startup, never retrained at request time

### Frontend layout
- `app/` — Next.js App Router; each route is a folder with `page.tsx`
- `components/map/` — Mapbox GL components (client-only, dynamic import required)
- `components/charts/` — Recharts wrappers
- `components/ui/` — shadcn primitives
- API calls go through `lib/api.ts` — single source of truth for endpoint URLs

### Data pipeline
Constants (cluster radius, entropy floor, score weights, etc.) live in
`data/eda_decisions.json`. Import them rather than hardcoding.

Scoring pipeline order: venues → H3 aggregation → TF-IDF fit → UMAP fit →
signal computation (all 5) → weighted sum → write to `suburb_scores`.

## Database — vantage.duckdb (in backend/)
Tables:
- `venues` — AU venues, H3 indexes, `is_closed`, `is_stale`, `category_label`
- `suburb_cells` — H3-7 cells, venue counts, coordinates
- `umap_coords` — 2D UMAP x/y per suburb
- `suburb_scores` — pre-computed scores per suburb per category

## Key model files (in backend/)
- `tfidf.pkl`   → fitted TF-IDF vectoriser (fitted on all venue category strings)
- `reducer.pkl` → fitted UMAP reducer (2D projection of suburb TF-IDF vectors)

## The 5 scoring signals
1. **Fingerprint Match**     — TF-IDF + cosine similarity to uploaded locations
2. **Market Trajectory**     — Mann-Kendall trend test on venue counts over time
3. **Competitive Pressure**  — DBSCAN clustering density around target category
4. **Ecosystem Diversity**   — Shannon entropy of category mix in the H3 cell
5. **Risk Signals**          — area closure rate + saturation + immaturity

## API endpoints (port 8000)
```
POST /fingerprint    — build DNA from uploaded locations (returns vector + top categories)
GET  /scan           — return all scored suburbs (pre-computed, filtered by category)
GET  /location/{id}  — full location detail + chart data for each signal
GET  /embedding      — UMAP coords for scatter plot (all suburbs)
POST /report/pdf     — generate PDF summary for a selected suburb
```

## Design direction
Dark mode only. Background `#0A0A0B`.
Font: Fraunces (display) + Geist (body).
Accent: teal `#0D7377`. Navy `#1B2A4A`.
Use skeleton loaders, not spinners. No lorem ipsum.
Never: purple gradients, Inter as primary, "AI-powered" (say "data science-driven").

## Active skills — use these always
- `fastapi-duckdb-builder`  → all backend work
- `nextjs-dataviz`          → map + charts + data screens
- `data-hack-strategist`    → product decisions

## Never do
- No Streamlit
- No trained classifier on `date_closed` labels (only 6% coverage)
- No magic numbers — all constants from `data/eda_decisions.json`
- Don't commit `vantage.duckdb` or `*.pkl` — they are runtime artifacts
