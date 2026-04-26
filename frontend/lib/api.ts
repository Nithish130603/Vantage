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
  explainer_dna: string;
  explainer_opportunities: string;
  explainer_comparison: string;
  explainer_locations: string;
  explainer_risk: string;
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
  signal_insight: string;
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
  ai_recommendation: string;
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

export interface CategoryItem {
  name: string;
  venue_count: number;
  display_order: number;
}

export interface CategoriesResponse {
  categories: CategoryItem[];
  total: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  question: string;
  category?: string;
  h3_r7?: string;
  fingerprint_result?: Record<string, unknown>;
  conversation_history: ChatMessage[];
}

export interface ChatResponse {
  response: string;
  conversation_history: ChatMessage[];
}

export interface CompareRequest {
  category: string;
  h3_r7_list: string[];
  fingerprint_result?: Record<string, unknown>;
}

export interface CompareResponse {
  category: string;
  suburbs_compared: string[];
  comparison_result: Record<string, string> | null;
  final_output: string;
  completed: string[];
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  categories(): Promise<CategoriesResponse> {
    return json<CategoriesResponse>(`${BASE}/categories`);
  },

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
    // Use POST when vectors are present to avoid URL length limits
    const hasVectors = opts?.successVector?.length || opts?.failureVector?.length;
    if (hasVectors) {
      return json<ScanResponse>(`${BASE}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          region: opts?.region ?? null,
          client_mean_gold: opts?.clientMeanGold ?? null,
          success_vector: opts?.successVector ?? null,
          failure_vector: opts?.failureVector ?? null,
          limit: opts?.limit ?? 200,
        }),
      });
    }
    // Simple GET for queries without large vectors
    const params = new URLSearchParams({ category });
    if (opts?.region) params.set("region", opts.region);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.clientMeanGold != null)
      params.set("client_mean_gold", String(opts.clientMeanGold));
    return json<ScanResponse>(`${BASE}/scan?${params}`);
  },

  location(h3r7: string, category: string): Promise<LocationDetail> {
    return json<LocationDetail>(
      `${BASE}/location/${h3r7}?category=${encodeURIComponent(category)}`
    );
  },

  locationPost(
    h3r7: string,
    opts: { category: string; successVector?: number[] | null; failureVector?: number[] | null }
  ): Promise<LocationDetail> {
    return json<LocationDetail>(`${BASE}/location/${h3r7}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: opts.category,
        success_vector: opts.successVector ?? null,
        failure_vector: opts.failureVector ?? null,
      }),
    });
  },

  explainStream(
    req: {
      signal_name: string;
      score: number;
      badge: string;
      chart_data: Record<string, unknown>[];
      locality: string;
      state: string;
      category: string;
    },
    onToken: (token: string) => void,
    onDone: (text: string) => void,
    onError: (detail: string) => void,
  ): () => void {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${BASE}/agent/explain/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          onError(`API ${res.status}: ${text}`);
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "token") { onToken(event.content); fullText += event.content; }
              else if (event.type === "done") onDone(event.text || fullText);
              else if (event.type === "error") onError(event.detail);
            } catch { /* ignore parse errors */ }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") onError(String(e));
      }
    })();
    return () => controller.abort();
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

  chat(req: ChatRequest): Promise<ChatResponse> {
    return json<ChatResponse>(`${BASE}/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  },

  chatStream(
    req: ChatRequest,
    onToken: (token: string) => void,
    onDone: (response: string, history: ChatMessage[]) => void,
    onError: (detail: string) => void,
  ): () => void {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${BASE}/agent/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          onError(`API ${res.status}: ${text}`);
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "token") onToken(event.content);
              else if (event.type === "done") onDone(event.response, event.conversation_history);
              else if (event.type === "error") onError(event.detail);
            } catch {}
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") onError(String(e));
      }
    })();
    return () => controller.abort();
  },

  compare(req: CompareRequest): Promise<CompareResponse> {
    return json<CompareResponse>(`${BASE}/agent/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  },

  async downloadReport(
    h3r7: string,
    category: string,
    locality?: string,
    state?: string,
    scanScore?: number,
    isBtb?: boolean,
    btbReason?: string | null,
    opts?: {
      successVector?: number[] | null;
      failureVector?: number[] | null;
      savedSuburbs?: { h3_r7: string; locality: string; state: string; score?: number }[];
      dnaSummary?: string | null;
      topCategories?: { category: string; weight: number }[] | null;
    },
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
        ...(opts?.successVector  && { success_vector: opts.successVector }),
        ...(opts?.failureVector  && { failure_vector: opts.failureVector }),
        ...(opts?.savedSuburbs?.length && { saved_suburbs: opts.savedSuburbs }),
        ...(opts?.dnaSummary     && { dna_summary: opts.dnaSummary }),
        ...(opts?.topCategories  && { top_categories: opts.topCategories }),
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
    a.download = `Vantage_${name}_${category.replace(/\s+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
