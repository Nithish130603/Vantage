"""
DuckDB-backed tools for Vantage agents.

Each tool opens its own read-only connection so agents can be called
from any thread without sharing handles. Results are returned as
JSON strings so the LLM can reason over them directly.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

import duckdb
from langchain_core.tools import tool

_DB_PATH = str(Path(__file__).parent.parent / "vantage.duckdb")

# ── connection helper ──────────────────────────────────────────────────────────

def _con() -> duckdb.DuckDBPyConnection:
    return duckdb.connect(_DB_PATH, read_only=True)


def _safe_select(sql: str) -> str:
    """Execute a SELECT-only query and return JSON rows (max 200)."""
    stripped = sql.strip().upper()
    if not stripped.startswith("SELECT") and not stripped.startswith("WITH"):
        return json.dumps({"error": "Only SELECT queries are permitted."})
    try:
        con = _con()
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchmany(200)
        con.close()
        return json.dumps([dict(zip(cols, r)) for r in rows])
    except Exception as exc:
        return json.dumps({"error": str(exc)})


# ── EDA tools ─────────────────────────────────────────────────────────────────

@tool
def get_dataset_overview() -> str:
    """
    Return high-level statistics about the Vantage dataset: row counts per
    table, total AU venues, closed/stale venue rates, and H3 cell count.
    """
    sql = """
        SELECT
            (SELECT count(*) FROM venues)                               AS total_venues,
            (SELECT count(*) FROM venues WHERE is_closed = true)        AS closed_venues,
            (SELECT count(*) FROM venues WHERE is_stale  = true)        AS stale_venues,
            (SELECT count(DISTINCT h3_r7) FROM venues)                  AS unique_cells,
            (SELECT count(DISTINCT locality) FROM suburb_cells)         AS unique_localities,
            (SELECT count(*) FROM suburb_cells)                         AS suburb_cells_rows,
            (SELECT count(*) FROM suburb_scores)                        AS precomputed_scores
    """
    return _safe_select(sql)


@tool
def get_category_distribution(limit: int = 20) -> str:
    """
    Return the top venue categories by count, including the percentage of
    total venues and how many suburbs contain each category.
    """
    sql = f"""
        SELECT
            category_label,
            count(*)                                    AS venue_count,
            round(count(*) * 100.0 / (SELECT count(*) FROM venues), 2) AS pct_of_total,
            count(DISTINCT h3_r7)                       AS suburb_count
        FROM venues
        WHERE category_label IS NOT NULL AND is_closed = false
        GROUP BY category_label
        ORDER BY venue_count DESC
        LIMIT {int(limit)}
    """
    return _safe_select(sql)


@tool
def get_data_quality_report() -> str:
    """
    Audit data quality: null rates for critical columns, stale-data
    proportion, closure label coverage, and date range of the dataset.
    """
    sql = """
        SELECT
            count(*)                                                AS total,
            round(count(*) FILTER (WHERE latitude  IS NULL) * 100.0 / count(*), 2) AS pct_null_lat,
            round(count(*) FILTER (WHERE longitude IS NULL) * 100.0 / count(*), 2) AS pct_null_lon,
            round(count(*) FILTER (WHERE category_label IS NULL) * 100.0 / count(*), 2) AS pct_null_category,
            round(count(*) FILTER (WHERE date_created IS NULL) * 100.0 / count(*), 2) AS pct_null_date_created,
            round(count(*) FILTER (WHERE date_closed IS NOT NULL) * 100.0 / count(*), 2) AS closure_label_coverage_pct,
            round(count(*) FILTER (WHERE is_stale = true) * 100.0 / count(*), 2)  AS pct_stale,
            round(count(*) FILTER (WHERE is_closed = true) * 100.0 / count(*), 2) AS pct_closed,
            min(date_created)   AS earliest_created,
            max(date_created)   AS latest_created,
            min(date_refreshed) AS earliest_refreshed,
            max(date_refreshed) AS latest_refreshed
        FROM venues
    """
    return _safe_select(sql)


@tool
def get_geographic_distribution() -> str:
    """
    Show how venues are distributed across Australian states/regions,
    including venue counts and average venues-per-suburb for each state.
    """
    sql = """
        SELECT
            sc.state,
            count(DISTINCT v.h3_r7)   AS suburbs,
            count(v.fsq_place_id)     AS venues,
            round(avg(sc.venue_count), 1) AS avg_venues_per_suburb
        FROM venues v
        JOIN suburb_cells sc ON v.h3_r7 = sc.h3_r7
        WHERE v.is_closed = false
        GROUP BY sc.state
        ORDER BY venues DESC
    """
    return _safe_select(sql)


@tool
def get_venue_creation_trend() -> str:
    """
    Return monthly venue creation counts across the full dataset to reveal
    overall market growth or decline trends.
    """
    sql = """
        SELECT
            strftime('%Y-%m', date_created::DATE) AS month,
            count(*)                        AS venues_created
        FROM venues
        WHERE date_created IS NOT NULL
          AND date_created >= (SELECT max(date_created) FROM venues) - INTERVAL '5 years'
        GROUP BY month
        ORDER BY month
    """
    return _safe_select(sql)


@tool
def get_umap_cluster_stats() -> str:
    """
    Report on UMAP embedding quality: how many suburbs have coordinates,
    the x/y range, and which suburb has the most extreme position (an outlier check).
    """
    sql = """
        SELECT
            count(*)            AS suburbs_with_umap,
            round(min(umap_x), 3)  AS x_min,
            round(max(umap_x), 3)  AS x_max,
            round(min(umap_y), 3)  AS y_min,
            round(max(umap_y), 3)  AS y_max,
            round(stddev(umap_x), 3) AS x_stddev,
            round(stddev(umap_y), 3) AS y_stddev
        FROM umap_coords
    """
    return _safe_select(sql)


# ── DNA / Fingerprint tools ────────────────────────────────────────────────────

@tool
def get_top_suburbs_by_fingerprint(category: str, limit: int = 10) -> str:
    """
    Return suburbs with the highest fingerprint (DNA) match score for a
    business category. Scores are integers 0-100 (e.g. 73 = 73/100).
    Tiers: BETTER_THAN_BEST | STRONG | WATCH | AVOID.
    trajectory_status: OPEN (growing) | CLOSING (declining) | INSUFFICIENT_DATA.
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            locality, state,
            cell_id         AS h3_r7,
            tier,
            fingerprint_score,
            composite_score,
            diversity_score,
            trajectory_score,
            trajectory_status,
            venue_count
        FROM suburb_scores
        WHERE LOWER(REPLACE(category, 'é', 'e')) = LOWER(REPLACE('{cat}', 'é', 'e'))
        ORDER BY fingerprint_score DESC
        LIMIT {int(limit)}
    """
    return _safe_select(sql)


@tool
def get_gold_standard_profile(category: str) -> str:
    """
    Return the top surrounding categories from the gold standard profile
    for a business category — these represent the ideal commercial ecosystem.
    """
    sql = f"""
        SELECT category, top_surrounding_categories, sample_size
        FROM gold_standards
        WHERE lower(category) = lower('{category.replace("'", "''")}')
        LIMIT 1
    """
    return _safe_select(sql)


@tool
def get_available_categories() -> str:
    """List all business categories available in the suburb_scores table."""
    sql = """
        SELECT DISTINCT category, count(*) AS suburbs_scored
        FROM suburb_scores
        GROUP BY category
        ORDER BY suburbs_scored DESC
    """
    return _safe_select(sql)


# ── Market Scout tools ─────────────────────────────────────────────────────────

@tool
def get_top_opportunities(category: str, limit: int = 15) -> str:
    """
    Return top-ranked expansion opportunities for a category, sorted by
    composite score. All scores are integers 0-100.
    Tiers: BETTER_THAN_BEST | STRONG | WATCH | AVOID.
    trajectory_status: OPEN | CLOSING | INSUFFICIENT_DATA.
    risk_level: LOW | MEDIUM | HIGH (HIGH risk_score = SAFE, LOW risk_score = RISKY).
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            locality, state,
            cell_id         AS h3_r7,
            tier,
            composite_score,
            fingerprint_score   AS dna_match,
            trajectory_score    AS market_trajectory,
            diversity_score     AS ecosystem_diversity,
            competition_score   AS competitive_pressure,
            risk_score,
            trajectory_status,
            risk_level,
            competitor_count,
            venue_count,
            recommendation
        FROM suburb_scores
        WHERE LOWER(REPLACE(category, 'é', 'e')) = LOWER(REPLACE('{cat}', 'é', 'e'))
        ORDER BY composite_score DESC
        LIMIT {int(limit)}
    """
    return _safe_select(sql)


@tool
def get_location_detail(h3_r7: str) -> str:
    """
    Return complete scoring detail for one suburb H3 cell, including all
    5 signal scores, tier, risk level, and the pre-computed recommendation text.
    """
    sql = f"""
        SELECT *
        FROM suburb_scores
        WHERE cell_id = '{h3_r7.replace("'", "''")}'
        LIMIT 5
    """
    return _safe_select(sql)


@tool
def get_suburb_venue_mix(h3_r7: str, limit: int = 15) -> str:
    """
    Return the top venue categories present in a suburb, showing the
    commercial mix that defines its ecosystem.
    """
    sql = f"""
        SELECT
            category_label,
            count(*) AS venue_count,
            round(count(*) * 100.0 / sum(count(*)) OVER (), 1) AS pct
        FROM venues
        WHERE h3_r7 = '{h3_r7.replace("'", "''")}' AND is_closed = false
        GROUP BY category_label
        ORDER BY venue_count DESC
        LIMIT {int(limit)}
    """
    return _safe_select(sql)


@tool
def get_trajectory_data(h3_r7: str) -> str:
    """
    Return monthly venue creation counts for a suburb over the past 5 years
    to assess market growth trajectory.
    """
    sql = f"""
        SELECT
            strftime('%Y-%m', date_created::DATE) AS month,
            count(*)                        AS venues_added
        FROM venues
        WHERE h3_r7 = '{h3_r7.replace("'", "''")}' AND date_created IS NOT NULL
          AND date_created >= now() - INTERVAL '5 years'
        GROUP BY month
        ORDER BY month
    """
    return _safe_select(sql)


@tool
def get_tier_summary(category: str) -> str:
    """
    Summarise how suburbs are distributed across tiers for a category.
    Tiers: BETTER_THAN_BEST | STRONG | WATCH | AVOID (highest to lowest quality).
    """
    sql = f"""
        SELECT
            tier,
            count(*)                       AS suburb_count,
            avg(composite_score)           AS avg_score,
            avg(fingerprint_score)         AS avg_fingerprint,
            avg(trajectory_score)          AS avg_trajectory
        FROM suburb_scores
        WHERE lower(category) = lower('{category.replace("'", "''")}')
        GROUP BY tier
        ORDER BY avg_score DESC
    """
    return _safe_select(sql)


# ── Risk Analyst tools ─────────────────────────────────────────────────────────

@tool
def get_risk_breakdown(h3_r7: str, category: str) -> str:
    """
    Return detailed risk signal data for a specific suburb and category:
    risk score (integer 0-100, higher = safer), risk level (LOW/MEDIUM/HIGH),
    closure rate context, saturation, and immaturity.
    """
    sql = f"""
        SELECT
            locality, state,
            risk_score,
            risk_level,
            competition_score,
            competitor_count,
            cluster_gap_description,
            venue_count,
            data_confidence,
            is_better_than_best
        FROM suburb_scores
        WHERE cell_id = '{h3_r7.replace("'", "''")}'
          AND LOWER(REPLACE(category, 'é', 'e')) = LOWER(REPLACE('{category.replace("'", "''")}', 'é', 'e'))
        LIMIT 1
    """
    return _safe_select(sql)


@tool
def get_closure_rate_comparison(category: str) -> str:
    """
    Compare closure rates across suburbs for a category: which suburbs have
    the highest and lowest closure concentrations, vs the category average.
    """
    sql = f"""
        WITH cat_venues AS (
            SELECT v.h3_r7, sc.locality, sc.state,
                   count(*) AS total,
                   count(*) FILTER (WHERE v.is_closed = true) AS closed
            FROM venues v
            JOIN suburb_cells sc ON v.h3_r7 = sc.h3_r7
            WHERE v.category_label ILIKE '%{category.replace("'", "''")}%'
            GROUP BY v.h3_r7, sc.locality, sc.state
            HAVING count(*) >= 3
        )
        SELECT
            locality, state,
            total, closed,
            round(closed * 100.0 / total, 1) AS closure_pct
        FROM cat_venues
        ORDER BY closure_pct DESC
        LIMIT 20
    """
    return _safe_select(sql)


@tool
def get_competitive_density(h3_r7: str, category: str) -> str:
    """
    Return competitor counts for a suburb and its neighbours, revealing
    whether the target is in an oversaturated cluster or a whitespace gap.
    """
    sql = f"""
        SELECT
            sc.locality, sc.state,
            count(v.fsq_place_id)   AS competitor_count,
            count(*) FILTER (WHERE v.is_closed = true)  AS closed_count,
            round(count(*) FILTER (WHERE v.is_closed = true) * 100.0 / nullif(count(*), 0), 1) AS closure_pct
        FROM venues v
        JOIN suburb_cells sc ON v.h3_r7 = sc.h3_r7
        WHERE v.h3_r7 = '{h3_r7.replace("'", "''")}'
          AND v.category_label ILIKE '%{category.replace("'", "''")}%'
        GROUP BY sc.locality, sc.state
    """
    return _safe_select(sql)


@tool
def get_high_risk_suburbs(category: str, limit: int = 10) -> str:
    """
    Return the riskiest suburbs for a category (lowest risk_score = highest risk).
    risk_score is 0-100; 0 = most dangerous, 100 = safest.
    Use this to identify what makes locations risky and warn founders away.
    """
    sql = f"""
        SELECT locality, state,
               cell_id         AS h3_r7,
               risk_score,
               risk_level,
               composite_score,
               tier
        FROM suburb_scores
        WHERE lower(category) = lower('{category.replace("'", "''")}')
        ORDER BY risk_score ASC
        LIMIT {int(limit)}
    """
    return _safe_select(sql)


# ── Statistician tools ────────────────────────────────────────────────────────

@tool
def get_signal_distribution_stats(category: str) -> str:
    """
    For each of the 5 scoring signals, return mean, standard deviation, min,
    max, and quartiles (P25, median, P75) across all suburbs for a category.
    High stddev means a signal is discriminating; low stddev means it barely varies.
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            round(avg(fingerprint_score),  4) AS fp_mean,
            round(stddev(fingerprint_score),4) AS fp_std,
            round(min(fingerprint_score),  4) AS fp_min,
            round(max(fingerprint_score),  4) AS fp_max,
            round(percentile_cont(0.25) WITHIN GROUP (ORDER BY fingerprint_score), 4) AS fp_p25,
            round(percentile_cont(0.50) WITHIN GROUP (ORDER BY fingerprint_score), 4) AS fp_median,
            round(percentile_cont(0.75) WITHIN GROUP (ORDER BY fingerprint_score), 4) AS fp_p75,

            round(avg(trajectory_score),  4) AS traj_mean,
            round(stddev(trajectory_score),4) AS traj_std,
            round(min(trajectory_score),  4) AS traj_min,
            round(max(trajectory_score),  4) AS traj_max,
            round(percentile_cont(0.25) WITHIN GROUP (ORDER BY trajectory_score), 4) AS traj_p25,
            round(percentile_cont(0.50) WITHIN GROUP (ORDER BY trajectory_score), 4) AS traj_median,
            round(percentile_cont(0.75) WITHIN GROUP (ORDER BY trajectory_score), 4) AS traj_p75,

            round(avg(diversity_score),  4) AS div_mean,
            round(stddev(diversity_score),4) AS div_std,
            round(min(diversity_score),  4) AS div_min,
            round(max(diversity_score),  4) AS div_max,
            round(percentile_cont(0.25) WITHIN GROUP (ORDER BY diversity_score), 4) AS div_p25,
            round(percentile_cont(0.50) WITHIN GROUP (ORDER BY diversity_score), 4) AS div_median,
            round(percentile_cont(0.75) WITHIN GROUP (ORDER BY diversity_score), 4) AS div_p75,

            round(avg(competition_score),  4) AS comp_mean,
            round(stddev(competition_score),4) AS comp_std,
            round(min(competition_score),  4) AS comp_min,
            round(max(competition_score),  4) AS comp_max,
            round(percentile_cont(0.25) WITHIN GROUP (ORDER BY competition_score), 4) AS comp_p25,
            round(percentile_cont(0.50) WITHIN GROUP (ORDER BY competition_score), 4) AS comp_median,
            round(percentile_cont(0.75) WITHIN GROUP (ORDER BY competition_score), 4) AS comp_p75,

            round(avg(risk_score),  4) AS risk_mean,
            round(stddev(risk_score),4) AS risk_std,
            round(min(risk_score),  4) AS risk_min,
            round(max(risk_score),  4) AS risk_max,
            round(percentile_cont(0.25) WITHIN GROUP (ORDER BY risk_score), 4) AS risk_p25,
            round(percentile_cont(0.50) WITHIN GROUP (ORDER BY risk_score), 4) AS risk_median,
            round(percentile_cont(0.75) WITHIN GROUP (ORDER BY risk_score), 4) AS risk_p75,

            count(*) AS n_suburbs
        FROM suburb_scores
        WHERE lower(category) = lower('{cat}')
    """
    return _safe_select(sql)


@tool
def get_signal_correlation_matrix(category: str) -> str:
    """
    Compute the Pearson correlation coefficient between every pair of the
    5 scoring signals. Values near ±1 indicate redundancy between signals;
    near 0 means they capture independent information.
    High correlation (>0.7) between two signals suggests one may be redundant.
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            round(corr(fingerprint_score, trajectory_score),  3) AS fp_x_traj,
            round(corr(fingerprint_score, diversity_score),   3) AS fp_x_div,
            round(corr(fingerprint_score, competition_score), 3) AS fp_x_comp,
            round(corr(fingerprint_score, risk_score),        3) AS fp_x_risk,
            round(corr(trajectory_score,  diversity_score),   3) AS traj_x_div,
            round(corr(trajectory_score,  competition_score), 3) AS traj_x_comp,
            round(corr(trajectory_score,  risk_score),        3) AS traj_x_risk,
            round(corr(diversity_score,   competition_score), 3) AS div_x_comp,
            round(corr(diversity_score,   risk_score),        3) AS div_x_risk,
            round(corr(competition_score, risk_score),        3) AS comp_x_risk,
            count(*) AS n
        FROM suburb_scores
        WHERE lower(category) = lower('{cat}')
    """
    return _safe_select(sql)


@tool
def get_tier_discrimination_stats(category: str) -> str:
    """
    Return mean of each signal broken down by tier (BETTER_THAN_BEST/STRONG/WATCH/AVOID).
    The signal with the largest top-minus-bottom tier gap (in stddev units)
    is the most discriminating and deserves a higher weight in the composite formula.
    This is the core statistical evidence for weight optimisation.
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            tier,
            count(*) AS n,
            round(avg(fingerprint_score),  4) AS fp_mean,
            round(avg(trajectory_score),   4) AS traj_mean,
            round(avg(diversity_score),    4) AS div_mean,
            round(avg(competition_score),  4) AS comp_mean,
            round(avg(risk_score),         4) AS risk_mean,
            round(avg(composite_score),    4) AS composite_mean,
            round(stddev(composite_score), 4) AS composite_std
        FROM suburb_scores
        WHERE lower(category) = lower('{cat}')
        GROUP BY tier
        ORDER BY composite_mean DESC
    """
    return _safe_select(sql)


@tool
def get_gold_standard_signal_profile(category: str) -> str:
    """
    Compare signal scores for suburbs flagged as 'better than best' (gold standard
    exemplars) against all other suburbs. A signal with a large gap between
    gold-standard and regular suburbs is a strong predictor of success.
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            CASE WHEN is_better_than_best THEN 'gold_exemplar' ELSE 'regular' END AS group_label,
            count(*) AS n,
            round(avg(fingerprint_score),  4) AS fp_mean,
            round(avg(trajectory_score),   4) AS traj_mean,
            round(avg(diversity_score),    4) AS div_mean,
            round(avg(competition_score),  4) AS comp_mean,
            round(avg(risk_score),         4) AS risk_mean,
            round(avg(composite_score),    4) AS composite_mean
        FROM suburb_scores
        WHERE lower(category) = lower('{cat}')
        GROUP BY group_label
        ORDER BY composite_mean DESC
    """
    return _safe_select(sql)


@tool
def get_composite_score_calibration(category: str) -> str:
    """
    Return the full composite score distribution: decile breakpoints, tier
    proportions, and whether scores are well-spread or pathologically clustered.
    A healthy scoring system should have roughly 10-20% BETTER_THAN_BEST, 30-40% STRONG, rest WATCH/AVOID.
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            round(percentile_cont(0.10) WITHIN GROUP (ORDER BY composite_score), 4) AS p10,
            round(percentile_cont(0.25) WITHIN GROUP (ORDER BY composite_score), 4) AS p25,
            round(percentile_cont(0.50) WITHIN GROUP (ORDER BY composite_score), 4) AS p50,
            round(percentile_cont(0.75) WITHIN GROUP (ORDER BY composite_score), 4) AS p75,
            round(percentile_cont(0.90) WITHIN GROUP (ORDER BY composite_score), 4) AS p90,
            round(percentile_cont(0.95) WITHIN GROUP (ORDER BY composite_score), 4) AS p95,
            round(avg(composite_score), 4)    AS mean_score,
            round(stddev(composite_score), 4) AS std_score,
            count(*) FILTER (WHERE tier = 'BETTER_THAN_BEST') AS better_than_best_count,
            count(*) FILTER (WHERE tier = 'STRONG')           AS strong_count,
            count(*) FILTER (WHERE tier = 'WATCH')            AS watch_count,
            count(*) FILTER (WHERE tier = 'AVOID')            AS avoid_count,
            count(*) AS total
        FROM suburb_scores
        WHERE lower(category) = lower('{cat}')
    """
    return _safe_select(sql)


@tool
def get_signal_to_composite_correlations(category: str) -> str:
    """
    Compute the Pearson correlation of each signal against the final composite score.
    A signal with high correlation to composite is highly influential; low correlation
    means the current weight is not letting it contribute meaningfully.
    This directly measures whether weights are aligned with signal impact.
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            round(corr(fingerprint_score,  composite_score), 3) AS fp_x_composite,
            round(corr(trajectory_score,   composite_score), 3) AS traj_x_composite,
            round(corr(diversity_score,    composite_score), 3) AS div_x_composite,
            round(corr(competition_score,  composite_score), 3) AS comp_x_composite,
            round(corr(risk_score,         composite_score), 3) AS risk_x_composite,
            count(*) AS n
        FROM suburb_scores
        WHERE lower(category) = lower('{cat}')
    """
    return _safe_select(sql)


@tool
def get_cross_category_signal_stability() -> str:
    """
    Check how consistent signal distributions are across different business
    categories. High variance in signal means across categories suggests the
    formula needs category-specific weights rather than a single global formula.
    """
    sql = """
        SELECT
            category,
            count(*) AS n,
            round(avg(fingerprint_score),  3) AS fp_mean,
            round(avg(trajectory_score),   3) AS traj_mean,
            round(avg(diversity_score),    3) AS div_mean,
            round(avg(competition_score),  3) AS comp_mean,
            round(avg(risk_score),         3) AS risk_mean,
            round(stddev(fingerprint_score),  3) AS fp_std,
            round(stddev(trajectory_score),   3) AS traj_std,
            round(stddev(diversity_score),    3) AS div_std
        FROM suburb_scores
        GROUP BY category
        ORDER BY n DESC
    """
    return _safe_select(sql)


@tool
def get_current_weights_context() -> str:
    """
    Return the current scoring formula weights hard-coded in the system.
    Use this as the baseline before proposing any optimisation.
    """
    weights = {
        "fingerprint_match": 0.30,
        "market_trajectory": 0.25,
        "ecosystem_diversity": 0.20,
        "risk_signals": 0.15,
        "competitive_pressure": 0.10,
        "total": 1.00,
        "note": "These are the current fixed weights used in precompute.py and scan.py"
    }
    return json.dumps(weights)


# ── Comparison tools ──────────────────────────────────────────────────────────

@tool
def get_suburbs_side_by_side(h3_r7_list_json: str, category: str) -> str:
    """
    Pull all 5 scoring signals for a list of suburbs at once so they can be
    compared head-to-head. h3_r7_list_json must be a JSON array of h3_r7 strings,
    e.g. '["abc123", "def456", "ghi789"]'.
    Returns one row per suburb ordered by composite score descending.
    All scores are integers 0-100. Tiers: BETTER_THAN_BEST | STRONG | WATCH | AVOID.
    """
    try:
        h3_list = json.loads(h3_r7_list_json)
    except Exception:
        return json.dumps({"error": "h3_r7_list_json must be a valid JSON array of strings"})
    if not h3_list:
        return json.dumps({"error": "Empty suburb list"})
    placeholders = ", ".join(f"'{h.replace(chr(39), '')}'" for h in h3_list)
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            locality, state,
            cell_id         AS h3_r7,
            tier,
            composite_score,
            fingerprint_score   AS fingerprint_match,
            trajectory_score    AS market_trajectory,
            diversity_score     AS ecosystem_diversity,
            competition_score   AS competitive_pressure,
            risk_score,
            trajectory_status, risk_level,
            competitor_count, venue_count,
            recommendation
        FROM suburb_scores
        WHERE cell_id IN ({placeholders})
          AND LOWER(REPLACE(category, 'é', 'e')) = LOWER(REPLACE('{cat}', 'é', 'e'))
        ORDER BY composite_score DESC
    """
    return _safe_select(sql)


@tool
def get_trajectory_comparison(h3_r7_list_json: str) -> str:
    """
    Return monthly venue creation counts for each suburb in the list over the
    last 3 years, so growth trajectories can be compared side by side.
    h3_r7_list_json must be a JSON array of h3_r7 strings.
    """
    try:
        h3_list = json.loads(h3_r7_list_json)
    except Exception:
        return json.dumps({"error": "h3_r7_list_json must be a valid JSON array"})
    placeholders = ", ".join(f"'{h.replace(chr(39), '')}'" for h in h3_list)
    sql = f"""
        SELECT
            v.h3_r7,
            sc.locality,
            strftime('%Y-%m', v.date_created::DATE) AS month,
            count(*) AS venues_added
        FROM venues v
        JOIN suburb_cells sc ON v.h3_r7 = sc.h3_r7
        WHERE v.h3_r7 IN ({placeholders})
          AND v.date_created IS NOT NULL
          AND v.date_created >= now() - INTERVAL '3 years'
        GROUP BY v.h3_r7, sc.locality, month
        ORDER BY v.h3_r7, month
    """
    return _safe_select(sql)


@tool
def get_venue_mix_side_by_side(h3_r7_list_json: str, top_n: int = 8) -> str:
    """
    Return the top venue categories for each suburb in the comparison list.
    Reveals whether suburbs have similar or different commercial ecosystems.
    h3_r7_list_json must be a JSON array of h3_r7 strings.
    """
    try:
        h3_list = json.loads(h3_r7_list_json)
    except Exception:
        return json.dumps({"error": "h3_r7_list_json must be a valid JSON array"})
    placeholders = ", ".join(f"'{h.replace(chr(39), '')}'" for h in h3_list)
    sql = f"""
        WITH ranked AS (
            SELECT
                v.h3_r7,
                sc.locality,
                v.category_label,
                count(*) AS venue_count,
                row_number() OVER (PARTITION BY v.h3_r7 ORDER BY count(*) DESC) AS rn
            FROM venues v
            JOIN suburb_cells sc ON v.h3_r7 = sc.h3_r7
            WHERE v.h3_r7 IN ({placeholders}) AND v.is_closed = false
            GROUP BY v.h3_r7, sc.locality, v.category_label
        )
        SELECT h3_r7, locality, category_label, venue_count
        FROM ranked
        WHERE rn <= {int(top_n)}
        ORDER BY h3_r7, venue_count DESC
    """
    return _safe_select(sql)


@tool
def get_whitespace_gaps(category: str, limit: int = 10) -> str:
    """
    Find suburbs with strong fingerprint match and ecosystem diversity but low
    competitor count — these are genuine whitespace gaps where demand exists
    but supply is thin. Ideal for first-mover expansion.
    Scores are integers 0-100; thresholds: fingerprint_score > 55, diversity_score > 50.
    """
    cat = category.replace("'", "''")
    sql = f"""
        SELECT
            locality, state,
            cell_id         AS h3_r7,
            tier,
            composite_score,
            fingerprint_score   AS fingerprint_match,
            diversity_score     AS ecosystem_diversity,
            competitor_count,
            risk_score,
            trajectory_status
        FROM suburb_scores
        WHERE LOWER(REPLACE(category, 'é', 'e')) = LOWER(REPLACE('{cat}', 'é', 'e'))
          AND fingerprint_score > 55
          AND diversity_score   > 50
          AND competitor_count  < 3
        ORDER BY fingerprint_score DESC, diversity_score DESC
        LIMIT {int(limit)}
    """
    return _safe_select(sql)


@tool
def get_nearest_better_suburb(h3_r7: str, category: str) -> str:
    """
    Given a suburb that the founder is interested in but which scores poorly,
    find the top 5 highest-scoring suburbs in the same state as a fallback
    recommendation — 'here's where you should look instead.'
    """
    h3_r7_clean = h3_r7.replace("'", "''")
    cat = category.replace("'", "''")
    sql = f"""
        WITH target_state AS (
            SELECT state FROM suburb_cells WHERE h3_r7 = '{h3_r7_clean}' LIMIT 1
        )
        SELECT
            ss.locality, ss.state,
            ss.cell_id  AS h3_r7,
            ss.tier,
            ss.composite_score,
            ss.fingerprint_score    AS fingerprint_match,
            ss.trajectory_score     AS market_trajectory,
            ss.risk_score,
            ss.recommendation
        FROM suburb_scores ss
        JOIN target_state ts ON ss.state = ts.state
        WHERE LOWER(REPLACE(ss.category, 'é', 'e')) = LOWER(REPLACE('{cat}', 'é', 'e'))
          AND ss.cell_id != '{h3_r7_clean}'
        ORDER BY ss.composite_score DESC
        LIMIT 5
    """
    return _safe_select(sql)


@tool
def get_suburb_percentile_rank(h3_r7: str, category: str) -> str:
    """
    Return how a suburb ranks relative to all other scored suburbs for a
    category. Returns its composite score, percentile rank (0-100, higher is
    better), and the count of suburbs it beats. Useful for telling a founder
    'this suburb is in the top 8% of all locations for your category.'
    """
    h3_r7_clean = h3_r7.replace("'", "''")
    cat = category.replace("'", "''")
    sql = f"""
        WITH ranked AS (
            SELECT
                cell_id,
                locality,
                state,
                composite_score,
                tier,
                percent_rank() OVER (ORDER BY composite_score) AS percentile
            FROM suburb_scores
            WHERE LOWER(REPLACE(category, 'é', 'e')) = LOWER(REPLACE('{cat}', 'é', 'e'))
        ),
        total AS (SELECT count(*) AS n FROM ranked)
        SELECT
            r.locality,
            r.state,
            r.composite_score,
            r.tier,
            round(r.percentile * 100, 1)     AS percentile_rank,
            round((1 - r.percentile) * 100, 1) AS top_pct,
            t.n                                AS total_suburbs_scored
        FROM ranked r, total t
        WHERE r.cell_id = '{h3_r7_clean}'
    """
    return _safe_select(sql)


# ── Safe free-form query (EDA agent only) ──────────────────────────────────────

@tool
def query_database(sql: str) -> str:
    """
    Execute a read-only SQL SELECT query against vantage.duckdb and return
    up to 200 rows as JSON. Tables available: venues, suburb_cells,
    umap_coords, suburb_scores, gold_standards.
    Only SELECT and WITH (CTE) queries are permitted.
    """
    return _safe_select(sql)


# ── Tool sets per agent ────────────────────────────────────────────────────────

EDA_TOOLS = [
    get_dataset_overview,
    get_category_distribution,
    get_data_quality_report,
    get_geographic_distribution,
    get_venue_creation_trend,
    get_umap_cluster_stats,
    query_database,
]

DNA_TOOLS = [
    get_top_suburbs_by_fingerprint,
    get_gold_standard_profile,
    get_available_categories,
    get_tier_summary,
    get_suburb_venue_mix,
]

SCOUT_TOOLS = [
    get_top_opportunities,
    get_location_detail,
    get_suburb_venue_mix,
    get_trajectory_data,
    get_tier_summary,
    get_suburb_percentile_rank,
]

RISK_TOOLS = [
    get_risk_breakdown,
    get_closure_rate_comparison,
    get_competitive_density,
    get_high_risk_suburbs,
    get_location_detail,
]

STAT_TOOLS = [
    get_signal_distribution_stats,
    get_signal_correlation_matrix,
    get_tier_discrimination_stats,
    get_gold_standard_signal_profile,
    get_composite_score_calibration,
    get_signal_to_composite_correlations,
    get_cross_category_signal_stability,
    get_current_weights_context,
]

COMPARISON_TOOLS = [
    get_suburbs_side_by_side,
    get_trajectory_comparison,
    get_venue_mix_side_by_side,
    get_whitespace_gaps,
    get_nearest_better_suburb,
    get_gold_standard_profile,
    get_tier_summary,
]

# Chat agent gets the broadest tool access — it must answer any follow-up question
CHAT_TOOLS = [
    get_location_detail,
    get_suburb_venue_mix,
    get_trajectory_data,
    get_risk_breakdown,
    get_competitive_density,
    get_top_opportunities,
    get_tier_summary,
    get_gold_standard_profile,
    get_composite_score_calibration,
    get_suburbs_side_by_side,
    get_whitespace_gaps,
    get_nearest_better_suburb,
    get_high_risk_suburbs,
    get_top_suburbs_by_fingerprint,
    get_signal_to_composite_correlations,
    get_suburb_percentile_rank,
]
