const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Tier = "BETTER_THAN_BEST" | "PRIME" | "STRONG" | "WATCH" | "AVOID";

export interface FingerprintRequest {
  category: string;
  mode: "existing" | "fresh" | "overseas";
  best_locations: string[];
  worst_locations: string[];
  region: string;
}

export interface FingerprintResponse {
  top_categories: { category: string; weight: number }[];
  dna_summary: string;
  top_suburb_h3s: string[];
  n_locations: number;
  mode: string;
  success_vector: number[];
  failure_vector: number[] | null;
  failure_summary: string | null;
  failure_h3s: string[];
  gold_standard_match: number;
  gold_standard_match_pct: number;
  improvement_hint: string;
  client_weight: number;
  data_confidence: "HIGH" | "MEDIUM" | "LOW";
  client_umap_points: { umap_x: number; umap_y: number }[];
  unrecognised_suburbs: string[];
  resolved_suburbs: Record<string, string>;
  client_mean_gold_similarity: number;
}

export interface SuburbResult {
  h3_r7: string;
  locality: string;
  state: string;
  center_lat: number;
  center_lon: number;
  score: number;
  score_fingerprint: number;
  score_trajectory: number;
  score_competition: number;
  score_diversity: number;
  score_risk: number;
  venue_count: number;
  category: string;
  tier: Tier;
  trajectory_status: string;
  risk_level: string;
  is_better_than_best: boolean;
  btb_reason: "benchmark" | "discovery" | null;
  gold_std_similarity: number;
  competitor_count: number;
  data_confidence: string;
  failure_similarity: number | null;
  umap_x: number | null;
  umap_y: number | null;
}

export interface ScanResponse {
  suburbs: SuburbResult[];
  better_than_best_count: number;
  prime_count: number;
  total: number;
  tier_counts: Record<Tier, number>;
}

export interface SignalDetail {
  name: string;
  score: number;
  description: string;
  badge: string;
  chart_data: Record<string, unknown>[];
}

export interface LocationDetail {
  h3_r7: string;
  locality: string;
  state: string;
  center_lat: number;
  center_lon: number;
  venue_count: number;
  category: string;
  composite_score: number;
  tier: string;
  data_confidence: string;
  competitor_count: number;
  cluster_gap_description: string;
  recommendation: string;
  monthly_series: Record<string, unknown>[];
  signals: SignalDetail[];
  top_categories: { category: string; count: number }[];
}

export interface SuburbSuggestion {
  locality: string;
  state: string;
  h3_r7: string;
}

export interface EmbeddingPoint {
  h3_r7: string;
  umap_x: number;
  umap_y: number;
  score: number | null;
  tier: string | null;
  locality: string | null;
  state: string | null;
  venue_count: number;
  center_lat: number;
  center_lon: number;
}

export const TIER_COLOR: Record<Tier, string> = {
  BETTER_THAN_BEST: "#E8C547",
  PRIME: "#0D7377",
  STRONG: "#0D7377",
  WATCH: "#D4A017",
  AVOID: "#C0392B",
};

export const TIER_LABEL: Record<Tier, string> = {
  BETTER_THAN_BEST: "Better than your best",
  PRIME: "Prime opportunity",
  STRONG: "Strong",
  WATCH: "Watch — window narrowing",
  AVOID: "Avoid",
};

export const TIER_ORDER: Tier[] = ["BETTER_THAN_BEST", "PRIME", "STRONG", "WATCH", "AVOID"];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  fingerprint(req: FingerprintRequest): Promise<FingerprintResponse> {
    return json<FingerprintResponse>(`${BASE}/fingerprint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  },

  scan(
    category: string,
    opts?: {
      region?: string;
      clientMeanGold?: number;
      successVector?: number[];
      failureVector?: number[];
      limit?: number;
    }
  ): Promise<ScanResponse> {
    const params = new URLSearchParams({ category });
    if (opts?.region) params.set("region", opts.region);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.clientMeanGold != null)
      params.set("client_mean_gold", String(opts.clientMeanGold));
    if (opts?.successVector?.length)
      params.set("success_vector", JSON.stringify(opts.successVector));
    if (opts?.failureVector?.length)
      params.set("failure_vector", JSON.stringify(opts.failureVector));
    return json<ScanResponse>(`${BASE}/scan?${params}`);
  },

  location(h3r7: string, category: string): Promise<LocationDetail> {
    return json<LocationDetail>(
      `${BASE}/location/${h3r7}?category=${encodeURIComponent(category)}`
    );
  },

  embedding(category?: string): Promise<EmbeddingPoint[]> {
    const params = category ? `?category=${encodeURIComponent(category)}` : "";
    return json<EmbeddingPoint[]>(`${BASE}/embedding${params}`);
  },

  suggest(q: string, limit = 8): Promise<SuburbSuggestion[]> {
    return json<SuburbSuggestion[]>(
      `${BASE}/suggest?q=${encodeURIComponent(q)}&limit=${limit}`
    );
  },

  placesAutocomplete(
    q: string,
    limit = 6
  ): Promise<{ description: string; place_id: string }[]> {
    return json(
      `${BASE}/places/autocomplete?q=${encodeURIComponent(q)}&limit=${limit}`
    );
  },

  async downloadReport(
    h3r7: string,
    category: string,
    locality?: string,
    state?: string,
    scanScore?: number,
    isBtb?: boolean,
    btbReason?: string | null,
  ): Promise<void> {
    const res = await fetch(`${BASE}/report/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        h3_r7: h3r7,
        category,
        ...(scanScore != null && { scan_score: scanScore }),
        ...(isBtb != null    && { is_btb: isBtb }),
        ...(btbReason        && { btb_reason: btbReason }),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`PDF generation failed: ${text}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const name = locality ? `${locality.replace(/\s+/g, "_")}_${state ?? "AU"}` : h3r7;
    a.download = `Location_Report_${name}_${category.replace(/\s+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
