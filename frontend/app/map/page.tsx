"use client";

import { useEffect, useState, useRef, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  api,
  type SuburbResult,
  type FingerprintResponse,
  TIER_COLOR,
  TIER_LABEL,
  type Tier,
} from "@/lib/api";
import { ArrowLeft, ChevronRight, Info, Bookmark, BookmarkCheck } from "lucide-react";
import dynamic from "next/dynamic";

const OpportunityMap = dynamic(
  () => import("@/components/map/OpportunityMap"),
  { ssr: false, loading: () => <div className="flex-1 bg-[#0D0D10]" /> }
);

type Filter = Tier | "ALL" | "SAVED" | "EXACT_MATCH";

const EXACT_MATCH_COLOR = "#A78BFA";

// ── Category definitions shown in tooltips ────────────────────────────────────
const TIER_DEF: Record<string, string> = {
  BETTER_THAN_BEST:
    "Locations that outperform your current best stores. They match the industry gold standard more closely than your own locations do — high-potential, non-obvious expansion targets.",
  STRONG:
    "Strong commercial DNA match. These suburbs share the same ecosystem mix as your best locations. Score ≥ 60.",
  WATCH:
    "Moderate fit. The window may be narrowing — growing competition or slowing market. Worth monitoring. Score 40–59.",
  AVOID:
    "Elevated risk. High closure rates, saturation, or weak commercial fundamentals. Score < 40.",
};

const TIER_SCORE_RANGE: Record<string, string> = {
  BETTER_THAN_BEST: "Score ≥ 60 + beats your benchmark",
  STRONG:           "Score ≥ 60",
  WATCH:            "Score 40–59",
  AVOID:            "Score < 40",
};

// ── localStorage bookmark helpers ─────────────────────────────────────────────

function loadSaved(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem("vantage_saved") ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function persistSaved(s: Set<string>) {
  localStorage.setItem("vantage_saved", JSON.stringify([...s]));
}

// ── Opportunity Distribution bar ──────────────────────────────────────────────

function OpportunityDistribution({
  tierCounts,
  totalScored,
  onFilterSelect,
  activeFilter,
}: {
  tierCounts: Record<Tier, number>;
  totalScored: number;
  onFilterSelect: (f: Filter) => void;
  activeFilter: Filter;
}) {
  const [hoveredTier, setHoveredTier] = useState<Tier | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const tiers: Tier[] = ["BETTER_THAN_BEST", "STRONG", "WATCH", "AVOID"];
  const visibleTiers = tiers.filter((t) => (tierCounts[t] ?? 0) > 0);

  return (
    <div className="ml-auto flex flex-col gap-2 min-w-[280px] max-w-sm">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] font-mono tracking-[0.18em] text-[#8B8B99] uppercase">
            Opportunity Distribution
          </p>
          <div className="group relative">
            <Info size={10} className="text-[#3A3A4A] cursor-help" />
            <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-50 w-56 bg-[#131316] border border-[#26262B] rounded-lg p-3 text-[10px] text-[#8B8B99] leading-relaxed shadow-2xl">
              Breakdown of all scored suburbs by opportunity category.
              Click a segment to filter the map.
            </div>
          </div>
        </div>
        <p className="text-[10px] font-mono text-[#555566]">
          {totalScored.toLocaleString()} suburbs analysed
        </p>
      </div>

      {/* Stacked bar */}
      <div className="relative">
        <div className="flex w-full h-3 rounded-full overflow-hidden bg-white/4">
          {visibleTiers.map((t) => {
            const count = tierCounts[t] ?? 0;
            const pct = (count / totalScored) * 100;
            return (
              <button
                key={t}
                onClick={() => onFilterSelect(t)}
                onMouseEnter={() => setHoveredTier(t)}
                onMouseLeave={() => setHoveredTier(null)}
                style={{
                  width: `${pct}%`,
                  backgroundColor: TIER_COLOR[t],
                  opacity: activeFilter === "ALL" || activeFilter === t ? 1 : 0.35,
                  transition: "opacity 0.2s, width 0.4s",
                  cursor: "pointer",
                }}
                className="h-full focus:outline-none"
              />
            );
          })}
        </div>

        {/* Hover tooltip */}
        {hoveredTier && (
          <div
            ref={tooltipRef}
            className="absolute bottom-full right-0 mb-2 z-50 bg-[#131316] border border-[#26262B] rounded-xl p-3 shadow-2xl pointer-events-none"
            style={{ minWidth: 220 }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: TIER_COLOR[hoveredTier] }}
              />
              <p className="text-xs font-medium text-[#F0F0F2]">
                {TIER_LABEL[hoveredTier]}
              </p>
            </div>
            <p className="text-[11px] text-[#8B8B99] leading-relaxed mb-2">
              {TIER_DEF[hoveredTier]}
            </p>
            <div className="flex items-baseline gap-2 border-t border-white/6 pt-2">
              <span className="text-lg font-light text-[#F0F0F2]">
                {(tierCounts[hoveredTier] ?? 0).toLocaleString()}
              </span>
              <span className="text-[10px] text-[#555566]">
                suburbs ·{" "}
                {(((tierCounts[hoveredTier] ?? 0) / totalScored) * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-[9px] text-[#3A3A4A] mt-1 font-mono">
              {TIER_SCORE_RANGE[hoveredTier]}
            </p>
          </div>
        )}
      </div>

      {/* Per-tier mini legend */}
      <div className="flex gap-3 flex-wrap">
        {visibleTiers.map((t) => {
          const count = tierCounts[t] ?? 0;
          const pct   = ((count / totalScored) * 100).toFixed(0);
          return (
            <button
              key={t}
              onClick={() => onFilterSelect(t)}
              className="flex items-center gap-1.5 transition-opacity"
              style={{ opacity: activeFilter === "ALL" || activeFilter === t ? 1 : 0.4 }}
            >
              {t === "BETTER_THAN_BEST" ? (
                <span style={{ color: TIER_COLOR[t], fontSize: 10 }}>★</span>
              ) : (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: TIER_COLOR[t] }}
                />
              )}
              <span className="text-[9px] font-mono text-[#8B8B99] whitespace-nowrap">
                {t === "BETTER_THAN_BEST" ? "Opportunity" : TIER_LABEL[t]}
                <span className="text-[#555566] ml-1">{count.toLocaleString()} ({pct}%)</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── BTB empty-state card ──────────────────────────────────────────────────────

function BtbEmptyState({ isFreshMode }: { isFreshMode: boolean }) {
  return (
    <div className="mx-4 my-4 p-4 rounded-xl border border-[#E8C547]/20 bg-[#E8C547]/4">
      <div className="flex items-start gap-2.5">
        <span className="text-base leading-none mt-0.5">⭐</span>
        <div>
          <p className="text-xs font-medium text-[#E8C547] mb-1">
            No &ldquo;Better Than Best&rdquo; opportunities found
          </p>
          <p className="text-[11px] text-[#8B8B99] leading-relaxed">
            {isFreshMode
              ? "You're using industry benchmark data without personal locations. Better Than Best opportunities are calculated by comparing suburbs against your own best stores — enter your existing locations on Screen 1 to unlock this."
              : "No suburbs in this region currently outperform your benchmark. Try expanding to All Australia, or refine your best-performing locations on Screen 1."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Saved empty-state ─────────────────────────────────────────────────────────

function SavedEmptyState() {
  return (
    <div className="mx-4 my-4 p-4 rounded-xl border border-white/8 bg-white/2">
      <div className="flex items-start gap-2.5">
        <Bookmark size={14} className="text-[#555566] mt-0.5 shrink-0" />
        <div>
          <p className="text-xs font-medium text-[#8B8B99] mb-1">No saved locations yet</p>
          <p className="text-[11px] text-[#555566] leading-relaxed">
            Click the bookmark icon on any result to save it here for easy comparison.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Filter pill row ───────────────────────────────────────────────────────────

function FilterPills({
  filter,
  setFilter,
  tierCounts,
  totalScored,
  btbCount,
  savedCount,
  exactMatchCount,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  tierCounts: Record<Tier, number>;
  totalScored: number;
  btbCount: number;
  savedCount: number;
  exactMatchCount: number;
}) {
  const pills: { key: Filter; label: string; count: number; color: string; def: string }[] = [
    {
      key: "ALL", label: "All", count: totalScored,
      color: "#8B8B99",
      def: "Show all categories",
    },
    {
      key: "BETTER_THAN_BEST", label: "⭐ Better Than Best", count: btbCount,
      color: TIER_COLOR.BETTER_THAN_BEST,
      def: TIER_DEF.BETTER_THAN_BEST,
    },
    {
      key: "STRONG", label: "Strong", count: tierCounts.STRONG ?? 0,
      color: TIER_COLOR.STRONG,
      def: TIER_DEF.STRONG,
    },
    {
      key: "WATCH", label: "Watch", count: tierCounts.WATCH ?? 0,
      color: TIER_COLOR.WATCH,
      def: TIER_DEF.WATCH,
    },
    {
      key: "AVOID", label: "Avoid", count: tierCounts.AVOID ?? 0,
      color: TIER_COLOR.AVOID,
      def: TIER_DEF.AVOID,
    },
    ...(exactMatchCount > 0
      ? [{
          key: "EXACT_MATCH" as Filter,
          label: "◈ Exact Match",
          count: exactMatchCount,
          color: EXACT_MATCH_COLOR,
          def: "Suburbs whose commercial makeup most closely mirrors your successful locations — ranked purely by fingerprint similarity, not opportunity score.",
        }]
      : []),
    ...(savedCount > 0
      ? [{
          key: "SAVED" as Filter,
          label: `⭐ Saved`,
          count: savedCount,
          color: "#E8C547",
          def: "Your bookmarked expansion candidates",
        }]
      : []),
  ];

  return (
    <div className="flex gap-1.5 mt-3 flex-wrap">
      {pills.map((p) => {
        const isActive = filter === p.key;
        return (
          <button
            key={p.key}
            onClick={() => setFilter(p.key)}
            title={p.def}
            className="flex items-center gap-1 transition-all"
            style={{
              fontSize: 10,
              fontFamily: "var(--font-geist-mono)",
              padding: "4px 10px",
              borderRadius: 99,
              border: isActive ? "none" : "1px solid rgba(255,255,255,0.08)",
              backgroundColor: isActive ? `${p.color}22` : "transparent",
              color: isActive ? p.color : "#555566",
              cursor: "pointer",
            }}
          >
            {p.label}
            <span style={{ opacity: 0.65, marginLeft: 3 }}>
              {p.count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Bookmark button ───────────────────────────────────────────────────────────

function BookmarkBtn({
  saved,
  onToggle,
}: {
  saved: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={saved ? "Remove from saved" : "Save this location"}
      className="shrink-0 transition-colors p-0.5 rounded"
      style={{ color: saved ? "#E8C547" : "#3A3A4A" }}
      onMouseEnter={(e) => { if (!saved) (e.currentTarget as HTMLElement).style.color = "#8B8B99"; }}
      onMouseLeave={(e) => { if (!saved) (e.currentTarget as HTMLElement).style.color = "#3A3A4A"; }}
    >
      {saved
        ? <BookmarkCheck size={13} fill="#E8C547" />
        : <Bookmark size={13} />}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function MapContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [results, setResults]         = useState<SuburbResult[]>([]);
  const [selected, setSelected]       = useState<SuburbResult | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [btbCount, setBtbCount]       = useState(0);
  const [totalScored, setTotalScored] = useState(0);
  const [filter, setFilter]           = useState<Filter>("ALL");
  const [tierCounts, setTierCounts]   = useState<Record<Tier, number>>({
    BETTER_THAN_BEST: 0, PRIME: 0, STRONG: 0, WATCH: 0, AVOID: 0,
  });
  const [savedH3s, setSavedH3s] = useState<Set<string>>(loadSaved);

  const toggleSave = useCallback((h3_r7: string) => {
    setSavedH3s((prev) => {
      const next = new Set(prev);
      if (next.has(h3_r7)) next.delete(h3_r7);
      else next.add(h3_r7);
      persistSaved(next);
      return next;
    });
  }, []);

  const ss = typeof sessionStorage !== "undefined" ? sessionStorage : null;
  const category =
    ss?.getItem("vantage_category") ?? params.get("category") ?? "Gym & Fitness";
  const region = ss?.getItem("vantage_region") ?? "All Australia";

  const dna = (() => {
    try {
      return JSON.parse(ss?.getItem("vantage_dna") ?? "{}") as Partial<FingerprintResponse>;
    } catch {
      return {} as Partial<FingerprintResponse>;
    }
  })();

  const isFreshMode    = (dna.mode === "fresh") || ((dna.n_locations ?? 0) === 0);
  const failureSet     = new Set(dna.failure_h3s ?? []);
  const clientMeanGold = dna.gold_standard_match;

  // Exact matches — top ~15% by fingerprint similarity score
  const exactMatchH3s = useMemo(() => {
    if (!results.length) return new Set<string>();
    const sorted = [...results].sort((a, b) => b.score_fingerprint - a.score_fingerprint);
    const cutoffIdx = Math.max(1, Math.floor(sorted.length * 0.15));
    const cutoffScore = Math.max(sorted[cutoffIdx - 1]?.score_fingerprint ?? 0, 0.50);
    return new Set(sorted.filter((r) => r.score_fingerprint >= cutoffScore).map((r) => r.h3_r7));
  }, [results]);

  useEffect(() => {
    api
      .scan(category, {
        region,
        clientMeanGold,
        successVector: dna.success_vector ?? undefined,
        failureVector: dna.failure_vector ?? undefined,
        limit: 200,
      })
      .then((resp) => {
        setResults(resp.suburbs);
        setBtbCount(resp.better_than_best_count);
        setTotalScored(resp.total);
        if (resp.tier_counts) setTierCounts(resp.tier_counts as Record<Tier, number>);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exactMatchCount = exactMatchH3s.size;

  const visibleResults =
    filter === "ALL"
      ? results
      : filter === "SAVED"
      ? results.filter((r) => savedH3s.has(r.h3_r7))
      : filter === "EXACT_MATCH"
      ? [...results].sort((a, b) => b.score_fingerprint - a.score_fingerprint).filter((r) => exactMatchH3s.has(r.h3_r7))
      : filter === "BETTER_THAN_BEST"
      ? results.filter((r) => r.tier === "BETTER_THAN_BEST")
      : results.filter((r) => r.tier === filter);

  const showBtbEmpty =
    !loading && !error && filter === "BETTER_THAN_BEST" && visibleResults.length === 0;

  const showSavedEmpty =
    !loading && !error && filter === "SAVED" && visibleResults.length === 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: "#0A0A0B" }}>

      {/* ── Top bar ──────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-5 py-3 border-b border-white/8 shrink-0"
        style={{ backgroundColor: "#0A0A0B" }}
      >
        <button
          onClick={() => router.push("/dna")}
          className="flex items-center gap-1.5 text-sm text-[#8B8B99] hover:text-[#F0F0F2] transition-colors shrink-0"
        >
          <ArrowLeft size={14} />
        </button>

        <div className="shrink-0">
          <p className="text-[10px] font-mono tracking-[0.2em] text-[#0D7377] uppercase leading-none">
            Step 3 of 3 · Opportunity Map
          </p>
          <p className="text-lg font-light leading-tight" style={{ fontFamily: "var(--font-fraunces)" }}>
            {category} opportunities across {region}
          </p>
        </div>

        {/* Opportunity Distribution */}
        {totalScored > 0 && (
          <OpportunityDistribution
            tierCounts={tierCounts}
            totalScored={totalScored}
            onFilterSelect={setFilter}
            activeFilter={filter}
          />
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar ─────────────────────────────────── */}
        <div className="w-80 shrink-0 border-r border-white/8 bg-[#0A0A0B] flex flex-col overflow-hidden">

          {/* Sidebar header */}
          <div className="px-4 pt-4 pb-3 border-b border-white/8 shrink-0">
            <p className="text-[10px] font-mono tracking-[0.15em] text-[#8B8B99] uppercase mb-0.5">
              {filter === "SAVED" ? "Saved Locations" : "Opportunities"}
            </p>
            <p className="text-2xl font-light text-[#0D7377]" style={{ fontFamily: "var(--font-fraunces)" }}>
              {loading
                ? "Loading…"
                : filter === "SAVED"
                ? `${savedH3s.size} saved`
                : `${results.length.toLocaleString()} results`}
            </p>
            <p className="text-xs text-[#555566]">
              {filter === "SAVED"
                ? "Your shortlisted expansion candidates"
                : `Top results out of ${totalScored.toLocaleString()} scored suburbs.`}
            </p>

            {/* BTB notice */}
            {!loading && btbCount > 0 && filter !== "SAVED" && (
              <p className="text-xs text-[#E8C547] mt-1.5 flex items-center gap-1.5">
                <span>⭐</span>
                <span>
                  <strong>{btbCount.toLocaleString()}</strong> outperform your best location
                </span>
              </p>
            )}
            {!loading && btbCount === 0 && !isFreshMode && filter !== "SAVED" && (
              <p className="text-[10px] text-[#555566] mt-1.5 leading-relaxed">
                No suburbs currently outperform your benchmark in this region.
              </p>
            )}

            <FilterPills
              filter={filter}
              setFilter={setFilter}
              tierCounts={tierCounts}
              totalScored={totalScored}
              btbCount={btbCount}
              savedCount={savedH3s.size}
              exactMatchCount={exactMatchCount}
            />
          </div>

          {/* Suburb list */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="skeleton h-16 rounded-lg" />
                ))}
              </div>
            )}

            {error && <p className="text-red-400 text-xs p-4">{error}</p>}

            {showBtbEmpty && <BtbEmptyState isFreshMode={isFreshMode} />}
            {showSavedEmpty && <SavedEmptyState />}

            {!loading && !error && !showBtbEmpty && !showSavedEmpty &&
              visibleResults.map((r, i) => {
                const resemblesFailure =
                  failureSet.has(r.h3_r7) ||
                  (r.failure_similarity != null && r.failure_similarity > 0.70);
                const isBtb  = r.tier === "BETTER_THAN_BEST";
                const isSaved = savedH3s.has(r.h3_r7);

                return (
                  <motion.div
                    key={r.h3_r7}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.025, 0.45) }}
                    onClick={() => setSelected(r)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(r)}
                    className={`w-full flex items-start gap-3 px-4 py-3 border-b border-white/5 text-left hover:bg-white/4 transition-colors cursor-pointer ${
                      selected?.h3_r7 === r.h3_r7
                        ? "bg-[#0D7377]/10 border-l-2 border-l-[#0D7377]"
                        : ""
                    }`}
                  >
                    <span className="text-xs font-mono text-[#555566] w-5 pt-0.5 shrink-0">
                      {i + 1}
                    </span>

                    {/* Tier dot / star */}
                    {isBtb ? (
                      <span className="text-[#E8C547] text-sm mt-0.5 shrink-0 leading-none">★</span>
                    ) : (
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                        style={{ backgroundColor: TIER_COLOR[r.tier] }}
                      />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-sm text-[#F0F0F2] font-medium truncate">
                          {r.locality}, {r.state}
                        </p>
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0"
                          style={{
                            color: TIER_COLOR[r.tier],
                            borderColor: `${TIER_COLOR[r.tier]}40`,
                            backgroundColor: `${TIER_COLOR[r.tier]}12`,
                          }}
                        >
                          {isBtb ? "Better Than Best" : (TIER_LABEL[r.tier] ?? r.tier)}
                        </span>
                      </div>
                      <p className="text-xs text-[#555566]">
                        {r.trajectory_status} · {r.risk_level}
                      </p>
                      {isBtb && r.btb_reason && (
                        <p className="text-[10px] text-[#E8C547]/70 mt-0.5">
                          {r.btb_reason === "discovery"
                            ? "↗ Discovery — strong market signals"
                            : "↗ Beats your benchmark"}
                        </p>
                      )}
                      {resemblesFailure && (
                        <p className="text-[10px] text-amber-400 mt-0.5">
                          ⚠ Resembles failure pattern
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <div className="text-right">
                        <span
                          className="text-xl font-light block leading-none"
                          style={{ color: TIER_COLOR[r.tier], fontFamily: "var(--font-fraunces)" }}
                        >
                          {(r.score * 100).toFixed(0)}
                        </span>
                        <span className="text-[9px] text-[#3A3A4A] font-mono uppercase tracking-wider">
                          score
                        </span>
                      </div>
                      <BookmarkBtn saved={isSaved} onToggle={() => toggleSave(r.h3_r7)} />
                    </div>
                  </motion.div>
                );
              })}
          </div>
        </div>

        {/* ── Map ────────────────────────────────────────── */}
        <div className="flex-1 relative">
          {!loading && (
            <OpportunityMap
              results={results}
              selected={selected}
              onSelect={setSelected}
              filter={filter}
              savedH3s={savedH3s}
              exactMatchH3s={exactMatchH3s}
            />
          )}

          {/* Selected suburb CTA */}
          <AnimatePresence>
            {selected && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#131316] border border-white/10 rounded-2xl px-6 py-4 flex items-center gap-6 shadow-2xl z-10"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {selected.tier === "BETTER_THAN_BEST" ? (
                      <span className="text-[#E8C547]">★</span>
                    ) : (
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: TIER_COLOR[selected.tier] }}
                      />
                    )}
                    <span className="text-xs text-[#8B8B99]">
                      {selected.tier === "BETTER_THAN_BEST"
                        ? selected.btb_reason === "discovery"
                          ? "Better Than Best · Discovery"
                          : "Better Than Best · Benchmark"
                        : TIER_LABEL[selected.tier]}
                    </span>
                  </div>
                  <p className="text-lg font-light" style={{ fontFamily: "var(--font-fraunces)" }}>
                    {selected.locality}, {selected.state}
                  </p>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span
                      className="text-2xl font-light"
                      style={{ color: TIER_COLOR[selected.tier], fontFamily: "var(--font-fraunces)" }}
                    >
                      {(selected.score * 100).toFixed(0)}
                    </span>
                    <span className="text-[10px] text-[#555566] uppercase tracking-wider font-mono">
                      Opportunity Score
                    </span>
                  </div>
                  <p className="text-xs text-[#555566]">
                    {selected.venue_count} venues · {selected.trajectory_status}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Inline bookmark in CTA */}
                  <button
                    onClick={() => toggleSave(selected.h3_r7)}
                    className="flex items-center gap-1.5 border border-white/10 rounded-xl px-3 py-2.5 text-xs transition-all hover:border-[#E8C547]/30"
                    style={{ color: savedH3s.has(selected.h3_r7) ? "#E8C547" : "#555566" }}
                  >
                    {savedH3s.has(selected.h3_r7)
                      ? <><BookmarkCheck size={13} fill="#E8C547" /> Saved</>
                      : <><Bookmark size={13} /> Save</>}
                  </button>

                  <button
                    onClick={() =>
                      router.push(
                        `/report/${selected.h3_r7}?category=${encodeURIComponent(category)}&score=${Math.round(selected.score * 100)}&btb=${selected.is_better_than_best ? "1" : "0"}${selected.btb_reason ? `&btb_reason=${selected.btb_reason}` : ""}&locality=${encodeURIComponent(selected.locality)}&state=${encodeURIComponent(selected.state)}`
                      )
                    }
                    className="flex items-center gap-1.5 bg-[#0D7377] hover:bg-teal-600 text-white rounded-xl px-5 py-2.5 text-sm font-medium transition-all"
                  >
                    View report
                    <ChevronRight size={14} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  return (
    <Suspense>
      <MapContent />
    </Suspense>
  );
}
