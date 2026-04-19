# Vantage — Location Intelligence for Franchise Founders

Data-driven location decisions for franchise expansion.

## Screenshot
![Vantage Dashboard](docs/screenshots/dashboard.png)

## What it does
Vantage is a powerful location intelligence platform built to help franchise founders find the perfect spot for their next store. By analyzing geographic, demographic, and foot traffic patterns, it scores potential locations based on their viability and growth potential. Our predictive models minimize the risk of new investments by relying on actionable, real-world data insights.

## How it works

| Scoring Signal | Description |
| :--- | :--- |
| **Foot Traffic Density** | Measures the volume of people moving through a location daily. |
| **Competitor Proximity** | Analyzes the distance and density of similar businesses in the area. |
| **Demographic Alignment** | Matches the local population's profile to your target customer base. |
| **Accessibility Score** | Evaluates public transit access and parking availability. |
| **Growth Potential** | Estimates future neighborhood development and real estate trends. |

## Tech Stack

**Data**
- Python, DuckDB, UMAP, Pandas

**Backend**
- FastAPI, Uvicorn, Pydantic

**Frontend**
- Next.js 15, React, Tailwind CSS

**Infrastructure**
- Vercel (Frontend Hosting), Railway (Backend Container)

## Project Structure
```text
vantage/
├── backend/
│   └── main.py
├── data/
│   ├── eda.py
│   ├── pipeline.py
│   └── precompute.py
├── frontend/
│   ├── src/
│   └── package.json
└── README.md
```

## Local Development Setup

### Prerequisites
- Python 3.10+
- Node.js 18+

### Backend setup
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend setup
```bash
cd frontend
npm install
npm run dev
```

### Environment variables
Frontend `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```
Backend `.env`:
```env
# Database and API keys
```

## Data Pipeline
To process the data locally, run the data pipeline scripts from the `data/` directory:
- `python data/eda.py` (Perform exploratory data analysis)
- `python data/pipeline.py` (Run core data cleaning and aggregation)
- `python data/precompute.py` (Precompute signals and generate caches)

## API Endpoints
- `GET /api/venues` - Returns a list of venues with scores
- `GET /api/venues/{id}` - Returns deep-dive details for a specific venue
- `GET /api/suburbs` - Returns location intelligence aggregated by suburb
- `POST /api/predict` - Submits custom weights to score a hypothetical site
- `GET /api/health` - Simple health check endpoint

## Deployment
Vantage is optimized for a split deployment architecture. The FastAPI backend and its required data stores are deployed via a Docker container on **Railway**, while the statically optimized Next.js frontend is deployed to **Vercel** for low-latency delivery.

## License
MIT
