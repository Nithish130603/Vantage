"""
Signal 1 — Fingerprint Match
Cosine similarity between a suburb's TF-IDF vector and the uploaded-location
DNA vector.  Returns a score in [0, 1].
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer


def fingerprint_match(
    dna_vector: np.ndarray,
    suburb_vectors: np.ndarray,
) -> np.ndarray:
    """
    Parameters
    ----------
    dna_vector     : (1, n_features) normalised TF-IDF vector of the franchise DNA
    suburb_vectors : (n_suburbs, n_features) TF-IDF matrix of all suburbs

    Returns
    -------
    scores : (n_suburbs,) cosine similarity in [0, 1]
    """
    if dna_vector.ndim == 1:
        dna_vector = dna_vector.reshape(1, -1)

    sims = cosine_similarity(dna_vector, suburb_vectors)[0]
    # cosine similarity is already in [-1, 1]; TF-IDF vectors are non-negative
    # so range is [0, 1]
    return np.clip(sims, 0.0, 1.0).astype(np.float32)


def build_dna_vector(
    category_docs: list[str],
    vectorizer: TfidfVectorizer,
) -> np.ndarray:
    """
    Build the franchise DNA vector from a list of category strings
    (one per uploaded location).

    Parameters
    ----------
    category_docs : list of category_label strings for each uploaded location
    vectorizer    : fitted TfidfVectorizer from tfidf.pkl

    Returns
    -------
    (1, n_features) dense numpy array
    """
    combined_doc = " ".join(category_docs)
    vec = vectorizer.transform([combined_doc])
    arr = vec.toarray() if hasattr(vec, "toarray") else np.array(vec)
    # L2-normalise so cosine == dot-product
    norm = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm
    return arr.astype(np.float32)
