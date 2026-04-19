"""
Refit UMAP only — reads vantage.duckdb, loads tfidf.pkl,
refits reducer, writes reducer.pkl + updates umap_coords table.

Usage:
    python data/embed.py
    python data/embed.py --db backend/vantage.duckdb
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import duckdb
import joblib
import numpy as np
from sklearn.decomposition import TruncatedSVD
from umap import UMAP

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("embed")

ROOT       = Path(__file__).parent.parent
DEFAULT_DB = ROOT / "backend" / "vantage.duckdb"
TFIDF_PKL  = ROOT / "backend" / "tfidf.pkl"
REDUCER_PKL = ROOT / "backend" / "reducer.pkl"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(DEFAULT_DB))
    args = parser.parse_args()

    log.info("Loading TF-IDF vectorizer from %s", TFIDF_PKL)
    vectorizer = joblib.load(TFIDF_PKL)

    con = duckdb.connect(args.db)

    log.info("Building suburb corpus …")
    suburb_docs = con.execute("""
        SELECT h3_r7, string_agg(category_label, ' ') AS doc
        FROM venues
        WHERE category_label IS NOT NULL AND is_closed = false
        GROUP BY h3_r7
        HAVING count(*) >= 5
        ORDER BY h3_r7
    """).fetchall()

    cell_ids = [r[0] for r in suburb_docs]
    corpus   = [r[1] for r in suburb_docs]
    log.info("Suburbs: %d", len(cell_ids))

    X = vectorizer.transform(corpus)
    n_samples, n_dims = X.shape

    if n_dims > 100:
        log.info("TruncatedSVD %d → 100 dims …", n_dims)
        svd = TruncatedSVD(n_components=100, random_state=42)
        X_dense = svd.fit_transform(X)
        log.info("SVD variance explained: %.1f%%", svd.explained_variance_ratio_.sum() * 100)
    else:
        X_dense = X.toarray() if hasattr(X, "toarray") else np.array(X)

    n_neighbors = min(15, n_samples - 1)
    # Use euclidean after SVD pre-reduction — equivalent to cosine in the
    # original space but ~10× faster on CPU (avoids building a full pairwise
    # cosine distance matrix).
    log.info("Fitting UMAP (n_neighbors=%d, metric=euclidean) …", n_neighbors)
    reducer = UMAP(
        n_components=2, n_neighbors=n_neighbors,
        min_dist=0.1, metric="euclidean",
        random_state=42, low_memory=True, verbose=True,
        n_epochs=200,
    )
    coords = reducer.fit_transform(X_dense)
    log.info("UMAP done — shape: %s", coords.shape)

    try:
        joblib.dump(reducer, REDUCER_PKL)
        log.info("Saved reducer.pkl (%.1f KB)", REDUCER_PKL.stat().st_size / 1024)
    except Exception as e:
        log.warning("Could not save reducer.pkl: %s (coords still written to DB)", e)

    con.execute("CREATE OR REPLACE TABLE umap_coords (h3_r7 VARCHAR PRIMARY KEY, umap_x DOUBLE, umap_y DOUBLE)")
    rows = [(cell_ids[i], float(coords[i, 0]), float(coords[i, 1])) for i in range(len(cell_ids))]
    con.executemany("INSERT INTO umap_coords VALUES (?, ?, ?)", rows)
    con.close()
    log.info("umap_coords updated — %d rows", len(rows))


if __name__ == "__main__":
    main()
