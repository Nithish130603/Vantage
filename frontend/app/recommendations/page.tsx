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
import { ArrowLeft, Info, Bookmark, BookmarkCheck, ChevronRight } from "lucide-react";
import dynamic from "next/dynamic";

const OpportunityMap = dynamic(
  () => import("@/components/map/OpportunityMap"),
  { ssr: false, loading: () => <div style={{ flex: 1, background: "#020509" }} /> }
);
const ChatWidget    = dynamic(() => import("@/components/ui/ChatWidget"),    { ssr: false });
const CompareDrawer = dynamic(() => import("@/components/ui/CompareDrawer"), { ssr: false });

type Filter = Tier | "ALL" | "SAVED" | "EXACT_MATCH";

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_DEF: Record<string, string> = {
  BETTER_THAN_BEST: "Locations that outperform your current best stores — high-potential, non-obvious expansion targets.",
  STRONG:  "Strong commercial DNA match. These suburbs share the same ecosystem as your best locations. Score ≥ 60.",
  WATCH:   "Moderate fit. Growing competition or slowing market — worth monitoring. Score 40–59.",
  AVOID:   "Elevated risk. High closure rates, saturation, or weak commercial fundamentals. Score < 40.",
};

const TIER_SCORE_RANGE: Record<string, string> = {
  BETTER_THAN_BEST: "Score ≥ 60 + beats your benchmark",
  STRONG: "Score ≥ 60",
  WATCH:  "Score 40–59",
  AVOID:  "Score < 40",
};

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadSaved(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem("vantage_saved") ?? "[]") as string[]); }
  catch { return new Set(); }
}
function persistSaved(s: Set<string>) {
  localStorage.setItem("vantage_saved", JSON.stringify([...s]));
}

// ── Sidebar nav items (Recommendations active) ────────────────────────────────

const NAV_ITEMS = [
  { label: "Dashboard", active: false, path: "/setup",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg> },
  { label: "Insights", active: false, path: "/dna",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polyline points="1,11 5,6 8,9 14,3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="10,3 14,3 14,7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { label: "Exact Matches", active: false, path: "/map",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" strokeWidth="1.1"/><line x1="6.5" y1="4.5" x2="6.5" y2="8.5" stroke="currentColor" strokeWidth="1.1"/></svg> },
  { label: "Recommendations", active: true, path: "/recommendations",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polygon points="7.5,1 9.5,5.5 14.5,6 11,9.5 12,14.5 7.5,12 3,14.5 4,9.5 0.5,6 5.5,5.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg> },
  { label: "Avoid Zones", active: false, path: "/map",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.2"/><line x1="3" y1="3" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
];

// ── Sidebar ───────────────────────────────────────────────────────────────────

function VantageSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const router = useRouter();
  return (
    <motion.aside
      animate={{ width: open ? 218 : 60 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="relative z-10 flex flex-col shrink-0 overflow-hidden"
      style={{ borderRight: "1px solid rgba(0,210,230,0.1)", background: "linear-gradient(180deg, rgba(2,7,14,0.98) 0%, rgba(2,5,10,0.98) 100%)" }}
    >
      <div className="flex items-center px-3.5 py-5 shrink-0"
        style={{ borderBottom: "1px solid rgba(0,210,230,0.09)", justifyContent: open ? "space-between" : "center" }}>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
              className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded flex items-center justify-center shrink-0"
                style={{ background: "rgba(0,210,230,0.1)", border: "1px solid rgba(0,210,230,0.3)" }}>
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="2" fill="#0DC5CC"/>
                  <circle cx="6" cy="6" r="5" stroke="#0DC5CC" strokeWidth="0.8" strokeDasharray="2 1.5"/>
                </svg>
              </div>
              <div>
                <p style={{ fontSize: 13, letterSpacing: "0.15em", color: "#FFFFFF", textTransform: "uppercase", lineHeight: 1, fontWeight: 700 }}>Vantage</p>
                <p style={{ fontSize: 10, letterSpacing: "0.12em", marginTop: 3, color: "#0DC5CC", fontWeight: 600 }}>Intelligence</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!open && (
          <div className="w-7 h-7 rounded flex items-center justify-center"
            style={{ background: "rgba(0,210,230,0.1)", border: "1px solid rgba(0,210,230,0.3)" }}>
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="2" fill="#0DC5CC"/>
              <circle cx="6" cy="6" r="5" stroke="#0DC5CC" strokeWidth="0.8" strokeDasharray="2 1.5"/>
            </svg>
          </div>
        )}
        {open && (
          <button onClick={onToggle}
            className="w-7 h-7 rounded flex items-center justify-center transition-all"
            style={{ color: "rgba(0,210,230,0.4)", border: "1px solid rgba(0,210,230,0.14)", background: "transparent" }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 2L4 5.5 7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>
      {!open && (
        <button onClick={onToggle} className="flex items-center justify-center mx-auto mt-3 w-8 h-8 rounded transition-all"
          style={{ color: "rgba(0,210,230,0.5)", border: "1px solid rgba(0,210,230,0.18)", background: "rgba(0,210,230,0.04)" }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M4 2l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
      {open && (
        <p className="px-5 pt-5 pb-2" style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(0,210,230,0.7)", fontWeight: 700 }}>
          Navigation
        </p>
      )}
      <nav className="flex-1 px-2 space-y-0.5 mt-1">
        {NAV_ITEMS.map((item) => (
          <div key={item.label} onClick={() => router.push(item.path)}
            className="flex items-center rounded-sm transition-all duration-150 cursor-pointer"
            style={{
              gap: open ? 10 : 0, justifyContent: open ? "flex-start" : "center",
              padding: open ? "9px 10px" : "9px 0",
              background: item.active ? "rgba(0,210,230,0.08)" : "transparent",
              borderLeft: item.active && open ? "2px solid rgba(0,210,230,0.7)" : "2px solid transparent",
              color: item.active ? "#0DC5CC" : "rgba(200,230,235,0.85)",
            }}>
            <span style={{ opacity: item.active ? 1 : 0.65, flexShrink: 0 }}>{item.icon}</span>
            <AnimatePresence>
              {open && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  style={{ fontSize: 14, letterSpacing: "0.04em", whiteSpace: "nowrap", fontWeight: item.active ? 700 : 600 }}>
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
            {item.active && open && (
              <motion.div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0DC5CC" }}
                animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }} />
            )}
          </div>
        ))}
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="px-3 py-2.5 mx-3 mb-3 rounded-sm"
            style={{ background: "rgba(0,210,230,0.04)", border: "1px solid rgba(0,210,230,0.1)", cursor: "pointer" }}
            onClick={() => router.push("/profile")}>
            <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,210,230,0.75)", marginBottom: 6, fontWeight: 700 }}>User Profile</p>
            <div className="flex items-center gap-2">
              <motion.div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0DC5CC" }}
                animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
              <span style={{ fontSize: 12, letterSpacing: "0.04em", color: "#0DC5CC", fontWeight: 600 }}>View profile →</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

// ── Opportunity distribution bar ──────────────────────────────────────────────

function OpportunityDistribution({ tierCounts, totalScored, onFilterSelect, activeFilter }: {
  tierCounts: Record<Tier, number>; totalScored: number;
  onFilterSelect: (f: Filter) => void; activeFilter: Filter;
}) {
  const [hoveredTier, setHoveredTier] = useState<Tier | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tiers: Tier[] = ["BETTER_THAN_BEST", "STRONG", "WATCH", "AVOID"];
  const visibleTiers  = tiers.filter((t) => (tierCounts[t] ?? 0) > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260, maxWidth: 340 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.18em", color: "rgba(0,210,230,0.5)", textTransform: "uppercase", fontWeight: 700 }}>
            Opportunity Distribution
          </p>
          <div style={{ position: "relative" }} className="group">
            <Info size={10} style={{ color: "rgba(255,255,255,0.2)", cursor: "help" }} />
            <div style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: 6, display: "none", zIndex: 50, width: 220, background: "rgba(4,8,16,0.96)", border: "1px solid rgba(0,210,230,0.12)", borderRadius: 8, padding: 10, fontSize: 10, color: "rgba(180,190,205,0.7)", lineHeight: 1.6, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
              className="group-hover:block">
              Breakdown of scored suburbs by category. Click a segment to filter.
            </div>
          </div>
        </div>
        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
          {totalScored.toLocaleString()} suburbs
        </p>
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", width: "100%", height: 10, borderRadius: 99, overflow: "hidden", background: "rgba(255,255,255,0.04)" }}>
          {visibleTiers.map((t) => {
            const pct = ((tierCounts[t] ?? 0) / totalScored) * 100;
            return (
              <button key={t} onClick={() => onFilterSelect(t)}
                onMouseEnter={() => setHoveredTier(t)} onMouseLeave={() => setHoveredTier(null)}
                style={{ width: `${pct}%`, backgroundColor: TIER_COLOR[t], opacity: activeFilter === "ALL" || activeFilter === t ? 1 : 0.3, transition: "opacity 0.2s", cursor: "pointer" }}
                className="h-full focus:outline-none"
              />
            );
          })}
        </div>
        {hoveredTier && (
          <div ref={tooltipRef}
            style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: 8, zIndex: 50, minWidth: 200, background: "rgba(4,8,16,0.96)", border: "1px solid rgba(0,210,230,0.12)", borderRadius: 10, padding: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", pointerEvents: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: TIER_COLOR[hoveredTier], display: "inline-block" }} />
              <p style={{ fontSize: 12, fontWeight: 600, color: "#F0F0F2" }}>{TIER_LABEL[hoveredTier]}</p>
            </div>
            <p style={{ fontSize: 11, color: "rgba(170,180,195,0.7)", lineHeight: 1.6, marginBottom: 8 }}>{TIER_DEF[hoveredTier]}</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, borderTop: "1px solid rgba(0,210,230,0.07)", paddingTop: 8 }}>
              <span style={{ fontFamily: "var(--font-fraunces)", fontSize: 18, fontWeight: 300, color: "#F0F0F2" }}>{(tierCounts[hoveredTier] ?? 0).toLocaleString()}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>suburbs · {(((tierCounts[hoveredTier] ?? 0) / totalScored) * 100).toFixed(1)}%</span>
            </div>
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(0,210,230,0.4)", marginTop: 4 }}>{TIER_SCORE_RANGE[hoveredTier]}</p>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {visibleTiers.map((t) => {
          const count = tierCounts[t] ?? 0;
          const pct   = ((count / totalScored) * 100).toFixed(0);
          return (
            <button key={t} onClick={() => onFilterSelect(t)}
              style={{ display: "flex", alignItems: "center", gap: 5, opacity: activeFilter === "ALL" || activeFilter === t ? 1 : 0.35, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              {t === "BETTER_THAN_BEST"
                ? <span style={{ color: TIER_COLOR[t], fontSize: 9 }}>★</span>
                : <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: TIER_COLOR[t], display: "inline-block" }} />}
              <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(180,190,205,0.7)", whiteSpace: "nowrap", fontWeight: 500 }}>
                {t === "BETTER_THAN_BEST" ? "Opportunity" : TIER_LABEL[t]}
                <span style={{ color: "rgba(255,255,255,0.25)", marginLeft: 4 }}>{count.toLocaleString()} ({pct}%)</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Empty states ──────────────────────────────────────────────────────────────

function BtbEmptyState({ isFreshMode }: { isFreshMode: boolean }) {
  return (
    <div style={{ margin: 16, padding: 16, borderRadius: 12, border: "1px solid rgba(232,197,71,0.2)", background: "rgba(232,197,71,0.04)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>⭐</span>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#E8C547", marginBottom: 5 }}>No "Better Than Best" opportunities found</p>
          <p style={{ fontSize: 11, color: "rgba(160,170,185,0.7)", lineHeight: 1.6 }}>
            {isFreshMode
              ? "Add your existing locations on Screen 1 to unlock Better Than Best opportunities."
              : "No suburbs currently outperform your benchmark in this region. Try All Australia."}
          </p>
        </div>
      </div>
    </div>
  );
}

function SavedEmptyState() {
  return (
    <div style={{ margin: 16, padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Bookmark size={14} style={{ color: "rgba(140,155,175,0.5)", marginTop: 1, flexShrink: 0 }} />
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(140,155,175,0.7)", marginBottom: 4 }}>No saved locations yet</p>
          <p style={{ fontSize: 11, color: "rgba(120,130,150,0.55)", lineHeight: 1.6 }}>Click the bookmark icon on any result to save it here.</p>
        </div>
      </div>
    </div>
  );
}

// ── Filter pills ──────────────────────────────────────────────────────────────

function FilterPills({ filter, setFilter, tierCounts, totalScored, btbCount, savedCount }: {
  filter: Filter; setFilter: (f: Filter) => void;
  tierCounts: Record<Tier, number>; totalScored: number; btbCount: number; savedCount: number;
}) {
  const pills: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "ALL",              label: "All",                count: totalScored,              color: "rgba(180,190,205,0.7)" },
    { key: "BETTER_THAN_BEST", label: "⭐ Better Than Best", count: btbCount,                color: TIER_COLOR.BETTER_THAN_BEST },
    { key: "STRONG",           label: "Strong",             count: tierCounts.STRONG ?? 0,   color: TIER_COLOR.STRONG },
    { key: "WATCH",            label: "Watch",              count: tierCounts.WATCH ?? 0,    color: TIER_COLOR.WATCH },
    { key: "AVOID",            label: "Avoid",              count: tierCounts.AVOID ?? 0,    color: TIER_COLOR.AVOID },
    ...(savedCount > 0 ? [{ key: "SAVED" as Filter, label: "Saved", count: savedCount, color: "#E8C547" }] : []),
  ];
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
      {pills.map((p) => {
        const isActive = filter === p.key;
        return (
          <button key={p.key} onClick={() => setFilter(p.key)}
            style={{
              fontSize: 10, fontFamily: "var(--font-geist-mono)", padding: "4px 10px", borderRadius: 99,
              border: isActive ? "none" : "1px solid rgba(255,255,255,0.07)",
              backgroundColor: isActive ? `${p.color}22` : "transparent",
              color: isActive ? p.color : "rgba(140,155,175,0.55)",
              cursor: "pointer", fontWeight: isActive ? 600 : 500, transition: "all 0.15s",
            }}>
            {p.label} <span style={{ opacity: 0.6, marginLeft: 3 }}>{p.count.toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Bookmark button ───────────────────────────────────────────────────────────

function BookmarkBtn({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="shrink-0 transition-colors p-0.5 rounded"
      style={{ color: saved ? "#E8C547" : "#3A3A4A" }}
      onMouseEnter={(e) => { if (!saved) (e.currentTarget as HTMLElement).style.color = "#8B8B99"; }}
      onMouseLeave={(e) => { if (!saved) (e.currentTarget as HTMLElement).style.color = "#3A3A4A"; }}>
      {saved ? <BookmarkCheck size={13} fill="#E8C547" /> : <Bookmark size={13} />}
    </button>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────

function RecommendationsContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [results, setResults]         = useState<SuburbResult[]>([]);
  const [selected, setSelected]       = useState<SuburbResult | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [btbCount, setBtbCount]       = useState(0);
  const [totalScored, setTotalScored] = useState(0);
  const [filter, setFilter]           = useState<Filter>("ALL");
  const [tierCounts, setTierCounts]   = useState<Record<Tier, number>>({ BETTER_THAN_BEST: 0, PRIME: 0, STRONG: 0, WATCH: 0, AVOID: 0 });
  const [savedH3s, setSavedH3s]       = useState<Set<string>>(loadSaved);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const toggleSave = useCallback((h3_r7: string) => {
    setSavedH3s((prev) => {
      const next = new Set(prev);
      next.has(h3_r7) ? next.delete(h3_r7) : next.add(h3_r7);
      persistSaved(next);
      return next;
    });
  }, []);

  const ss = typeof sessionStorage !== "undefined" ? sessionStorage : null;
  const category = ss?.getItem("vantage_category") ?? params.get("category") ?? "Gym & Fitness";
  const region   = ss?.getItem("vantage_region") ?? "All Australia";

  const dna = (() => {
    try { return JSON.parse(ss?.getItem("vantage_dna") ?? "{}") as Partial<FingerprintResponse>; }
    catch { return {} as Partial<FingerprintResponse>; }
  })();

  const isFreshMode    = (dna.mode === "fresh") || ((dna.n_locations ?? 0) === 0);
  const failureSet     = new Set(dna.failure_h3s ?? []);
  const clientMeanGold = dna.gold_standard_match;

  const exactMatchH3s = useMemo(() => {
    if (!results.length) return new Set<string>();
    const sorted      = [...results].sort((a, b) => b.score_fingerprint - a.score_fingerprint);
    const cutoffIdx   = Math.max(1, Math.floor(sorted.length * 0.15));
    const cutoffScore = Math.max(sorted[cutoffIdx - 1]?.score_fingerprint ?? 0, 0.50);
    return new Set(sorted.filter((r) => r.score_fingerprint >= cutoffScore).map((r) => r.h3_r7));
  }, [results]);

  useEffect(() => {
    api.scan(category, {
      region, clientMeanGold,
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

  const visibleResults =
    filter === "ALL"              ? results
    : filter === "SAVED"          ? results.filter((r) => savedH3s.has(r.h3_r7))
    : filter === "BETTER_THAN_BEST" ? results.filter((r) => r.tier === "BETTER_THAN_BEST")
    : filter === "EXACT_MATCH"    ? results
    : results.filter((r) => r.tier === filter);

  const showBtbEmpty   = !loading && !error && filter === "BETTER_THAN_BEST" && visibleResults.length === 0;
  const showSavedEmpty = !loading && !error && filter === "SAVED" && visibleResults.length === 0;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", backgroundColor: "#020509" }}>

      {/* Sidebar */}
      <VantageSidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(0,210,230,0.1)", background: "rgba(2,5,9,0.98)", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <button onClick={() => router.push(`/map?category=${encodeURIComponent(category)}`)}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 13, flexShrink: 0, padding: 0 }}>
            <ArrowLeft size={14} />
          </button>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.26em", textTransform: "uppercase", color: "rgba(0,210,230,0.6)", marginBottom: 4, fontWeight: 700 }}>
              Step 3 of 3 · Recommendations
            </p>
            <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 20, fontWeight: 300, color: "#F0F0F2", lineHeight: 1.2 }}>
              Recommendations for {category}
            </p>
          </div>
          {totalScored > 0 && (
            <OpportunityDistribution
              tierCounts={tierCounts}
              totalScored={totalScored}
              onFilterSelect={setFilter}
              activeFilter={filter}
            />
          )}
        </div>

        {/* Split panel */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Results list */}
          <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(0,210,230,0.1)", background: "rgba(2,5,9,0.6)" }}>
            <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(0,210,230,0.07)", flexShrink: 0 }}>
              <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(0,210,230,0.55)", marginBottom: 4, fontWeight: 700 }}>
                {filter === "SAVED" ? "Saved Locations" : "Opportunities"}
              </p>
              <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 22, fontWeight: 300, color: loading ? "rgba(0,210,230,0.5)" : "rgba(0,210,230,0.88)", lineHeight: 1 }}>
                {loading ? "Loading…" : filter === "SAVED" ? `${savedH3s.size} saved` : `${visibleResults.length.toLocaleString()} results`}
              </p>
              <p style={{ fontSize: 11, color: "rgba(180,190,205,0.5)", marginTop: 4 }}>
                {filter === "SAVED" ? "Your shortlisted candidates" : `Top results of ${totalScored.toLocaleString()} scored suburbs.`}
              </p>
              {!loading && btbCount > 0 && filter !== "SAVED" && (
                <p style={{ fontSize: 12, color: "#E8C547", marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
                  <span>⭐</span>
                  <span><strong>{btbCount.toLocaleString()}</strong> outperform your best location</span>
                </p>
              )}
              <FilterPills filter={filter} setFilter={setFilter} tierCounts={tierCounts} totalScored={totalScored} btbCount={btbCount} savedCount={savedH3s.size} />
            </div>

            {/* Scrollable list */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {loading && (
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="skeleton" style={{ height: 64, borderRadius: 8 }} />
                  ))}
                </div>
              )}
              {error && <p style={{ color: "#D98880", fontSize: 12, padding: 16 }}>{error}</p>}
              {showBtbEmpty && <BtbEmptyState isFreshMode={isFreshMode} />}
              {showSavedEmpty && <SavedEmptyState />}
              {!loading && !error && !showBtbEmpty && !showSavedEmpty && visibleResults.map((r, i) => {
                const resemblesFailure = failureSet.has(r.h3_r7) || (r.failure_similarity != null && r.failure_similarity > 0.70);
                const isBtb    = r.tier === "BETTER_THAN_BEST";
                const isSaved  = savedH3s.has(r.h3_r7);
                const isSelected = selected?.h3_r7 === r.h3_r7;
                return (
                  <motion.div
                    key={r.h3_r7}
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.025, 0.45) }}
                    onClick={() => setSelected(r)}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setSelected(r)}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "12px 16px",
                      borderBottom: "1px solid rgba(0,210,230,0.05)",
                      borderLeft: isSelected ? "2px solid rgba(0,210,230,0.6)" : "2px solid transparent",
                      background: isSelected ? "rgba(0,210,230,0.05)" : "transparent",
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgba(0,210,230,0.03)"; }}
                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 10, fontFamily: "var(--font-geist-mono)", color: "rgba(255,255,255,0.22)", width: 18, paddingTop: 2, flexShrink: 0, fontWeight: 500 }}>
                      {i + 1}
                    </span>
                    {isBtb
                      ? <span style={{ color: "#E8C547", fontSize: 13, marginTop: 1, flexShrink: 0, lineHeight: 1 }}>★</span>
                      : <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: TIER_COLOR[r.tier] }} />
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                        <p style={{ fontSize: 14, color: "#FFFFFF", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.locality}, {r.state}
                        </p>
                        <span style={{ fontSize: 9, fontFamily: "var(--font-geist-mono)", padding: "2px 6px", borderRadius: 3, border: `1px solid ${TIER_COLOR[r.tier]}50`, color: TIER_COLOR[r.tier], background: `${TIER_COLOR[r.tier]}18`, flexShrink: 0, fontWeight: 700 }}>
                          {isBtb ? "Better Than Best" : (TIER_LABEL[r.tier] ?? r.tier)}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: "rgba(180,195,210,0.75)", fontFamily: "var(--font-geist-mono)", fontWeight: 600 }}>
                        {r.trajectory_status} · {r.risk_level}
                      </p>
                      {isBtb && r.btb_reason && (
                        <p style={{ fontSize: 10, color: "rgba(232,197,71,0.7)", marginTop: 2 }}>
                          {r.btb_reason === "discovery" ? "↗ Discovery — strong market signals" : "↗ Beats your benchmark"}
                        </p>
                      )}
                      {resemblesFailure && (
                        <p style={{ fontSize: 10, color: "rgba(212,160,23,0.8)", marginTop: 2 }}>⚠ Resembles failure pattern</p>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontFamily: "var(--font-fraunces)", fontSize: 24, fontWeight: 400, color: TIER_COLOR[r.tier], lineHeight: 1, display: "block" }}>
                          {(r.score * 100).toFixed(0)}
                        </span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.12em", fontWeight: 700 }}>SCORE</span>
                      </div>
                      <BookmarkBtn saved={isSaved} onToggle={() => toggleSave(r.h3_r7)} />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Map */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden", height: "100%" }}>
            <div style={{ position: "absolute", top: 10, left: 10, width: 16, height: 16, borderTop: "1px solid rgba(0,210,230,0.35)", borderLeft: "1px solid rgba(0,210,230,0.35)", zIndex: 5, pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: 10, right: 10, width: 16, height: 16, borderTop: "1px solid rgba(0,210,230,0.35)", borderRight: "1px solid rgba(0,210,230,0.35)", zIndex: 5, pointerEvents: "none" }} />
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

            {/* Selected suburb popup */}
            <AnimatePresence>
              {selected && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
                  style={{
                    position: "absolute", bottom: 96, left: "50%", transform: "translateX(-50%)",
                    background: "rgba(2,5,9,0.97)", border: "1px solid rgba(0,210,230,0.25)",
                    borderRadius: 18, padding: "18px 24px",
                    display: "flex", alignItems: "center", gap: 24,
                    boxShadow: "0 8px 40px rgba(0,0,0,0.7), 0 0 28px rgba(0,210,230,0.08)",
                    backdropFilter: "blur(24px)", zIndex: 10,
                    maxWidth: "calc(100% - 48px)", whiteSpace: "nowrap",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      {selected.tier === "BETTER_THAN_BEST"
                        ? <span style={{ color: "#E8C547" }}>★</span>
                        : <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: TIER_COLOR[selected.tier], display: "inline-block" }} />
                      }
                      <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono)", color: "rgba(180,190,205,0.7)", fontWeight: 500 }}>
                        {selected.tier === "BETTER_THAN_BEST"
                          ? selected.btb_reason === "discovery" ? "Better Than Best · Discovery" : "Better Than Best"
                          : TIER_LABEL[selected.tier]}
                      </span>
                    </div>
                    <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 22, fontWeight: 400, color: "#FFFFFF", lineHeight: 1.2 }}>
                      {selected.locality}, {selected.state}
                    </p>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                      <span style={{ fontFamily: "var(--font-fraunces)", fontSize: 32, fontWeight: 400, color: TIER_COLOR[selected.tier], lineHeight: 1 }}>
                        {(selected.score * 100).toFixed(0)}
                      </span>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.15em", fontWeight: 700 }}>OPPORTUNITY SCORE</span>
                    </div>
                    <p style={{ fontSize: 12, color: "rgba(180,195,210,0.75)", marginTop: 3, fontWeight: 500 }}>
                      {selected.venue_count} venues · {selected.trajectory_status}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <button
                      onClick={() => toggleSave(selected.h3_r7)}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", color: savedH3s.has(selected.h3_r7) ? "#E8C547" : "rgba(140,155,175,0.6)", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
                      {savedH3s.has(selected.h3_r7) ? <><BookmarkCheck size={13} fill="#E8C547" /> Saved</> : <><Bookmark size={13} /> Save</>}
                    </button>
                    <button
                      onClick={() => router.push(`/report/${selected.h3_r7}?category=${encodeURIComponent(category)}&score=${Math.round(selected.score * 100)}&btb=${selected.is_better_than_best ? "1" : "0"}${selected.btb_reason ? `&btb_reason=${selected.btb_reason}` : ""}&locality=${encodeURIComponent(selected.locality)}&state=${encodeURIComponent(selected.state)}`)}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 10, background: "rgba(0,210,230,0.12)", border: "1px solid rgba(0,210,230,0.4)", color: "rgba(0,210,230,0.95)", fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 0 16px rgba(0,210,230,0.1)" }}>
                      View report <ChevronRight size={14} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* AI widgets */}
      <ChatWidget category={category} h3_r7={selected?.h3_r7} fingerprintResult={dna as Record<string, unknown>} />
      <CompareDrawer
        savedH3s={[...savedH3s]}
        category={category}
        fingerprintResult={dna as Record<string, unknown>}
        savedNames={Object.fromEntries(results.filter((r) => savedH3s.has(r.h3_r7)).map((r) => [r.h3_r7, `${r.locality}, ${r.state}`]))}
      />
    </div>
  );
}

export default function RecommendationsPage() {
  return (
    <Suspense>
      <RecommendationsContent />
    </Suspense>
  );
}
