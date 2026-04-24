"use client";

import { useEffect, useState, useMemo, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import {
  api,
  type FingerprintResponse,
  type EmbeddingPoint,
  type ScanResponse,
  TIER_COLOR,
} from "@/lib/api";
import { ArrowLeft, ArrowRight, AlertTriangle, CheckCircle, TrendingUp, BookmarkCheck } from "lucide-react";
import { supabase, supabaseEnabled } from "@/lib/supabase";

const DnaMap = dynamic(() => import("@/components/map/DnaMap"), {
  ssr: false,
  loading: () => <div className="flex-1 bg-[#0D0D10] rounded-lg" />,
});
const SaveAnalysisModal = dynamic(() => import("@/components/ui/SaveAnalysisModal"), { ssr: false });

// ── Animated score bar ────────────────────────────────────────────────────────

function ScoreBar({ value, color = "#0D7377" }: { value: number; color?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.width = "0%";
    const t = setTimeout(() => {
      el.style.transition = "width 1.2s cubic-bezier(0.22,1,0.36,1)";
      el.style.width = `${Math.min(100, value)}%`;
    }, 300);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div className="h-1.5 bg-white/6 rounded-full overflow-hidden">
      <div ref={ref} className="h-full rounded-full" style={{ backgroundColor: color }} />
    </div>
  );
}

// ── Tier count badge ──────────────────────────────────────────────────────────

function TierStat({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs text-[#8B8B99] flex-1">{label}</span>
      <span className="text-xs font-mono text-[#F0F0F2]">{count.toLocaleString()}</span>
    </div>
  );
}

// ── Legend row ────────────────────────────────────────────────────────────────

function LegendRow({
  star,
  ring,
  color,
  label,
  sub,
}: {
  star?: boolean;
  ring?: boolean;
  color: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <svg width={18} height={18} viewBox="0 0 18 18" className="shrink-0 mt-0.5">
        {star ? (
          <path
            d="M9 1l2.06 4.18 4.61.67-3.34 3.25.79 4.59L9 11.5l-4.12 2.19.79-4.59L2.33 5.85l4.61-.67z"
            fill={color}
          />
        ) : ring ? (
          <>
            <circle cx={9} cy={9} r={7} fill="none" stroke={color} strokeWidth={1.5} />
            <circle cx={9} cy={9} r={3} fill={color} />
          </>
        ) : (
          <circle cx={9} cy={9} r={5} fill={color} />
        )}
      </svg>
      <div>
        <p style={{ fontSize: 13, color: "#F0F0F2", lineHeight: 1.3 }}>{label}</p>
        <p
          style={{
            fontSize: 10,
            color: "#0D7377",
            fontFamily: "var(--font-geist-mono)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginTop: 2,
          }}
        >
          {sub}
        </p>
      </div>
    </div>
  );
}

// ── Filter pills ──────────────────────────────────────────────────────────────

const FILTERS = [
  { key: "ALL",              label: "All" },
  { key: "BETTER_THAN_BEST", label: "⭐ Opportunity" },
  { key: "STRONG",           label: "Strong" },
  { key: "WATCH",            label: "Watch" },
  { key: "AVOID",            label: "Avoid" },
];

// ── Main content ──────────────────────────────────────────────────────────────

function DnaContent() {
  const router = useRouter();
  const [fp, setFp]               = useState<FingerprintResponse | null>(null);
  const [category, setCategory]   = useState("Gym & Fitness");
  const [embedding, setEmbedding] = useState<EmbeddingPoint[]>([]);
  const [scanData, setScanData]   = useState<ScanResponse | null>(null);
  const [activeFilter, setActiveFilter] = useState("ALL");
  const [selected, setSelected]   = useState<EmbeddingPoint | null>(null);
  const [showSave, setShowSave]   = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [region, setRegion]       = useState("All Australia");

  useEffect(() => {
    if (!supabaseEnabled) return;
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem("vantage_dna");
    const cat    = sessionStorage.getItem("vantage_category") ?? "Gym & Fitness";
    const rgn    = sessionStorage.getItem("vantage_region") ?? "All Australia";
    setCategory(cat);
    setRegion(rgn);
    let parsedFp: FingerprintResponse | null = null;
    if (stored) {
      try { parsedFp = JSON.parse(stored) as FingerprintResponse; setFp(parsedFp); } catch { /* noop */ }
    }
    api.embedding(cat).then(setEmbedding).catch(() => {});
    api.scan(cat, {
      successVector: parsedFp?.success_vector ?? undefined,
      failureVector: parsedFp?.failure_vector ?? undefined,
      clientMeanGold: parsedFp?.client_mean_gold_similarity ?? undefined,
    }).then(setScanData).catch(() => {});
  }, []);

  // Navigate to report on map selection
  useEffect(() => {
    if (selected)
      router.push(`/report/${selected.h3_r7}?category=${encodeURIComponent(category)}`);
  }, [selected, router, category]);

  // Derive sets for the map
  const goldH3s = useMemo(() => new Set(fp?.top_suburb_h3s ?? []), [fp]);

  const clientH3s = useMemo(() => {
    if (!fp?.resolved_suburbs || !embedding.length) return new Set<string>();
    const names = new Set(
      Object.values(fp.resolved_suburbs).map((s) => s.toLowerCase())
    );
    return new Set(
      embedding
        .filter((p) => {
          const full = `${p.locality ?? ""}, ${p.state ?? ""}`.toLowerCase();
          return names.has(full) || names.has((p.locality ?? "").toLowerCase());
        })
        .map((p) => p.h3_r7)
    );
  }, [fp, embedding]);

  // Tier counts — prefer scan (same source as Screen 3) when available
  const tierCounts = useMemo(() => {
    if (scanData) return scanData.tier_counts as Record<string, number>;
    const counts: Record<string, number> = {
      BETTER_THAN_BEST: 0, STRONG: 0, WATCH: 0, AVOID: 0,
    };
    embedding.forEach((p) => {
      if (goldH3s.has(p.h3_r7)) counts.BETTER_THAN_BEST++;
      else if (p.tier) counts[p.tier] = (counts[p.tier] ?? 0) + 1;
    });
    return counts;
  }, [scanData, embedding, goldH3s]);

  const totalSuburbs = scanData?.total ?? embedding.length;
  const goldCount    = scanData?.better_than_best_count ?? goldH3s.size;
  const avoidCount   = tierCounts.AVOID ?? 0;

  if (!fp) {
    return (
      <div className="h-screen flex items-center justify-center text-[#555566] text-sm">
        No data found.{" "}
        <button onClick={() => router.push("/")} className="ml-2 text-[#0D7377] underline">
          Start over
        </button>
      </div>
    );
  }

  const isFresh         = fp.mode === "fresh" || fp.n_locations === 0;
  const topCats         = fp.top_categories.slice(0, 3);
  const confidenceColor =
    { HIGH: "#0D7377", MEDIUM: "#D4A017", LOW: "#C0392B" }[fp.data_confidence] ?? "#8B8B99";

  // Build a plain-English description of what drives success
  const dnaDrivers = topCats.map((c) => c.category).join(", ");
  const successSummary = isFresh
    ? `Across Australia, top-performing ${category.toLowerCase()} businesses are consistently found near ${dnaDrivers || "high-footfall commercial areas"}.`
    : fp.n_locations >= 1
    ? `Your strongest locations share a clear pattern: they are near ${dnaDrivers || "similar commercial environments"}. This is your franchise DNA.`
    : "";

  // Improvement hint — rewritten to plain English
  const rawHint = fp.improvement_hint ?? "";
  const plainHint = rawHint
    .replace(
      /Gold standard locations have more:/i,
      `Successful ${category.toLowerCase()} businesses are typically surrounded by more:`
    )
    .replace(
      /Your DNA closely matches the gold standard/i,
      `Your location profile closely matches the industry benchmark`
    );

  return (
    <div className="h-screen flex overflow-hidden" style={{ backgroundColor: "#0A0A0B" }}>

      {/* ── Left panel ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
        className="w-[38%] shrink-0 border-r border-white/8 flex flex-col overflow-y-auto"
        style={{ backgroundColor: "#131316" }}
      >
        <div className="flex flex-col gap-5 p-7 flex-1">

          {/* Back button */}
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 text-sm text-[#555566] hover:text-[#F0F0F2] transition-colors -mb-1 self-start"
          >
            <ArrowLeft size={14} />
            <span>Back to setup</span>
          </button>

          {/* Step label + title */}
          <div>
            <p className="text-[10px] font-mono tracking-[0.25em] text-[#0D7377] uppercase mb-2">
              Step 2 of 3 · DNA Reveal
            </p>
            <h1 className="text-3xl font-light" style={{ fontFamily: "var(--font-fraunces)" }}>
              {isFresh ? "Industry benchmark" : "Your franchise DNA"}
            </h1>
            {totalSuburbs > 0 && (
              <p className="text-xs text-[#555566] mt-1">
                {totalSuburbs.toLocaleString()} Australian suburbs analysed
              </p>
            )}
          </div>

          {/* DNA summary / mode block */}
          <div className="bg-[#0A0A0B] border border-white/8 rounded-xl p-4">
            <p className="text-[10px] font-mono tracking-[0.2em] text-[#0D7377] uppercase mb-2">
              {isFresh ? "Industry benchmark DNA" : "Your success DNA"}
            </p>
            {successSummary && (
              <p className="text-[#C8C8D4] text-sm leading-relaxed mb-3">{successSummary}</p>
            )}
            {topCats.length > 0 && (
              <div className="space-y-2">
                {topCats.map((tc) => (
                  <div key={tc.category}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[#8B8B99]">{tc.category}</span>
                      <span className="text-xs font-mono text-[#0D7377]">
                        {(tc.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                    <ScoreBar value={tc.weight * 100} color="#0D7377" />
                  </div>
                ))}
                <p className="text-[10px] text-[#555566] mt-2 leading-relaxed">
                  These are the commercial categories that best predict{" "}
                  {isFresh ? "industry" : "your"} success — how dominant each is in
                  the surrounding area.
                </p>
              </div>
            )}
          </div>

          {/* Gold standard match */}
          <div className="bg-[#0A0A0B] border border-white/8 rounded-xl p-4">
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <p className="text-[10px] font-mono tracking-[0.2em] text-[#8B8B99] uppercase mb-0.5">
                  Industry benchmark alignment
                </p>
                <p className="text-[11px] text-[#555566] leading-relaxed">
                  How closely {isFresh ? "this analysis" : "your locations"} match the
                  nationwide gold standard for {category.toLowerCase()} businesses
                </p>
              </div>
              <p
                className="text-3xl font-light shrink-0 ml-4"
                style={{ color: "#0D7377", fontFamily: "var(--font-fraunces)" }}
              >
                {fp.gold_standard_match_pct}%
              </p>
            </div>
            <ScoreBar value={fp.gold_standard_match_pct} color="#0D7377" />
            {plainHint && (
              <p className="text-[11px] text-[#555566] mt-3 leading-relaxed border-t border-white/5 pt-3">
                {plainHint}
              </p>
            )}
          </div>

          {/* Suburb distribution */}
          {totalSuburbs > 0 && (
            <div className="bg-[#0A0A0B] border border-white/8 rounded-xl p-4">
              <p className="text-[10px] font-mono tracking-[0.2em] text-[#8B8B99] uppercase mb-3 flex items-center gap-1.5">
                <TrendingUp size={10} /> Suburb opportunity breakdown
              </p>
              <TierStat
                color={TIER_COLOR.BETTER_THAN_BEST}
                label="Top opportunities (outperform your best)"
                count={tierCounts.BETTER_THAN_BEST ?? 0}
              />
              <TierStat
                color={TIER_COLOR.STRONG}
                label="Strong DNA match"
                count={tierCounts.STRONG ?? 0}
              />
              <TierStat
                color={TIER_COLOR.WATCH}
                label="Watch — window narrowing"
                count={tierCounts.WATCH ?? 0}
              />
              <TierStat
                color={TIER_COLOR.AVOID}
                label="Avoid — elevated risk"
                count={avoidCount}
              />
              {goldCount > 0 && (
                <p className="text-[11px] text-[#0D7377] mt-3 pt-2 border-t border-white/5 leading-relaxed">
                  ★ {goldCount} suburb{goldCount !== 1 ? "s" : ""} on the map match this DNA
                  most closely — shown as gold stars.
                </p>
              )}
            </div>
          )}

          {/* Failure pattern */}
          {fp.failure_summary && (
            <div className="bg-red-950/20 border border-red-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={12} className="text-red-400" />
                <p className="text-[10px] font-mono tracking-[0.2em] text-red-400 uppercase">
                  Locations to avoid
                </p>
              </div>
              <p className="text-[#8B8B99] text-xs leading-relaxed">{fp.failure_summary}</p>
              <p className="text-[10px] text-[#555566] mt-2">
                Suburbs resembling your worst locations are flagged on the map so you can
                avoid repeating those mistakes.
              </p>
            </div>
          )}

          {/* Blending note */}
          {fp.n_locations >= 1 && fp.n_locations <= 4 && (
            <div className="border border-[#0D7377]/20 bg-[#0D7377]/5 rounded-lg p-3 flex items-start gap-2">
              <CheckCircle size={13} className="text-[#0D7377] mt-0.5 shrink-0" />
              <p className="text-xs text-[#8B8B99] leading-relaxed">
                Based on{" "}
                <span className="text-[#F0F0F2]">
                  {fp.n_locations} location{fp.n_locations > 1 ? "s" : ""}
                </span>{" "}
                — blended with industry benchmark data to ensure reliability. More locations
                increases accuracy.
              </p>
            </div>
          )}

          {/* Unrecognised suburbs */}
          {fp.unrecognised_suburbs.length > 0 && (
            <div className="bg-amber-950/20 border border-amber-700/30 rounded-lg p-3">
              <p className="text-xs text-amber-400">
                <span className="font-medium">Could not find:</span>{" "}
                {fp.unrecognised_suburbs.join(", ")}
                <span className="block text-amber-600 mt-1">
                  Try the full suburb name (e.g. &quot;Surry Hills&quot;)
                </span>
              </p>
            </div>
          )}

          {/* Resolved suburbs */}
          {Object.keys(fp.resolved_suburbs ?? {}).length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-[#555566] uppercase tracking-wider mb-2">
                Locations used in analysis
              </p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(fp.resolved_suburbs).map(([input, resolved]) => (
                  <span
                    key={input}
                    className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#0D7377]/25 text-[#0D7377] bg-[#0D7377]/6"
                  >
                    {input.toLowerCase() !== resolved.split(",")[0].toLowerCase()
                      ? `${input} → ${resolved} ✓`
                      : `${resolved} ✓`}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Confidence + CTA */}
          <div className="mt-auto flex flex-col gap-4 pt-2">
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] font-mono tracking-[0.15em] px-3 py-1 rounded-full border"
                style={{
                  color: confidenceColor,
                  borderColor: `${confidenceColor}40`,
                  backgroundColor: `${confidenceColor}10`,
                }}
              >
                {fp.data_confidence} CONFIDENCE
              </span>
              <span className="text-[10px] text-[#555566]">
                {totalSuburbs > 0 ? `${totalSuburbs.toLocaleString()} suburbs scored` : ""}
              </span>
            </div>
            <div className="flex gap-2">
              {isLoggedIn && (
                <button
                  onClick={() => setShowSave(true)}
                  className="flex items-center gap-1.5 px-4 py-3.5 rounded-xl text-sm font-medium transition-all shrink-0"
                  style={{ border: "1px solid rgba(13,115,119,0.3)", color: "#0D7377" }}
                >
                  <BookmarkCheck size={14} />
                  Save
                </button>
              )}
              <button
                onClick={() => router.push(`/map?category=${encodeURIComponent(category)}`)}
                className="flex-1 flex items-center justify-center gap-2 bg-[#0D7377] hover:bg-teal-600 text-white rounded-xl py-3.5 text-sm font-medium transition-all"
              >
                Explore opportunities
                <ArrowRight size={15} />
              </button>
            </div>
          </div>

          {fp && (
            <SaveAnalysisModal
              open={showSave}
              onClose={() => setShowSave(false)}
              category={category}
              region={region}
              fingerprintResult={fp as unknown as Record<string, unknown>}
              onSaved={() => router.push("/dashboard")}
            />
          )}
        </div>
      </motion.div>

      {/* ── Right panel ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="flex-1 flex flex-col overflow-hidden"
        style={{ backgroundColor: "#0A0A0B" }}
      >
        {/* Header row */}
        <div className="px-6 pt-5 pb-3 shrink-0 flex items-center justify-between gap-4">
          <div>
            <p
              style={{
                fontFamily:    "var(--font-geist-mono)",
                fontSize:      11,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color:         "#0D7377",
              }}
            >
              Opportunity Map — {category}
            </p>
            {totalSuburbs > 0 && (
              <p className="text-[10px] text-[#555566] mt-0.5">
                Click any suburb to view the full analysis report
              </p>
            )}
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                style={{
                  fontSize:        11,
                  fontFamily:      "var(--font-geist-mono)",
                  letterSpacing:   "0.05em",
                  padding:         "4px 10px",
                  borderRadius:    4,
                  border:          activeFilter === f.key ? "none" : "1px solid #26262B",
                  backgroundColor: activeFilter === f.key ? "#0D7377" : "transparent",
                  color:           activeFilter === f.key ? "#fff" : "#555566",
                  cursor:          "pointer",
                  transition:      "all 0.15s",
                  whiteSpace:      "nowrap",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Map + legend row */}
        <div className="flex flex-1 gap-4 px-6 pb-3 overflow-hidden min-h-0">

          {/* Map */}
          <div className="flex-1 rounded-xl overflow-hidden border border-white/6 min-h-0">
            {embedding.length > 0 ? (
              <DnaMap
                points={embedding}
                goldH3s={goldH3s}
                clientH3s={clientH3s}
                category={category}
                activeFilter={activeFilter}
                onSelect={setSelected}
              />
            ) : (
              <div className="h-full flex items-center justify-center bg-[#0D0D10]">
                <div className="space-y-3">
                  {[200, 240, 180, 220].map((w, i) => (
                    <div key={i} className="skeleton rounded" style={{ height: 10, width: w }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="w-44 shrink-0 flex flex-col gap-4 pt-2">
            <p className="text-[9px] font-mono tracking-[0.18em] text-[#3A3A4A] uppercase">
              Map legend
            </p>
            <LegendRow
              star
              color="#E8C547"
              label="Top opportunity"
              sub="Outperforms benchmark"
            />
            <LegendRow color="#0D7377" label="Strong match" sub="High DNA similarity" />
            <LegendRow color="#D4A017" label="Watch" sub="Window narrowing" />
            <LegendRow color="#C0392B" label="Avoid" sub="Risk signals elevated" />
            {clientH3s.size > 0 && (
              <LegendRow ring color="#E8C547" label="Your stores" sub="Existing locations" />
            )}

            {/* Live counts */}
            {totalSuburbs > 0 && (
              <div className="mt-2 pt-3 border-t border-white/5 space-y-1.5">
                <p className="text-[9px] font-mono tracking-[0.18em] text-[#3A3A4A] uppercase mb-2">
                  Distribution
                </p>
                {[
                  { key: "BETTER_THAN_BEST", label: "Top" },
                  { key: "STRONG",           label: "Strong" },
                  { key: "WATCH",            label: "Watch" },
                  { key: "AVOID",            label: "Avoid" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-[10px] text-[#555566]">{label}</span>
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: TIER_COLOR[key as keyof typeof TIER_COLOR] ?? "#555566" }}
                    >
                      {(tierCounts[key] ?? 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Insight strip below map */}
        <div className="px-6 pb-5 shrink-0">
          <div
            style={{
              background: "rgba(13,115,119,0.06)",
              border: "1px solid rgba(13,115,119,0.2)",
              borderRadius: 10,
              padding: "12px 16px",
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: "#0D7377",
                    fontFamily: "var(--font-geist-mono)",
                    marginBottom: 6,
                  }}
                >
                  Reading this map
                </p>
                <p style={{ fontSize: 12, color: "#C8C8D4", lineHeight: 1.65 }}>
                  {isFresh
                    ? `Each dot represents one of the ${totalSuburbs.toLocaleString()} Australian suburbs scored for ${category} potential. Gold stars mark the top ${goldCount} suburbs that best match the industry benchmark DNA — these are your clearest first-mover opportunities.`
                    : `Each dot is one of ${totalSuburbs.toLocaleString()} suburbs scored against your franchise DNA. Gold stars (${goldCount} total) mark suburbs whose commercial mix most closely matches your best stores — the strongest expansion candidates.`}
                  {avoidCount > 0 &&
                    ` Red dots (${avoidCount.toLocaleString()} suburbs) show elevated-risk areas — high closure rates, over-saturation, or weak foot-traffic signals.`}
                  {clientH3s.size > 0 &&
                    ` Your ${clientH3s.size} existing location${clientH3s.size > 1 ? "s are" : " is"} shown with gold rings.`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className="text-3xl font-light"
                  style={{ color: "#0D7377", fontFamily: "var(--font-fraunces)", lineHeight: 1 }}
                >
                  {fp.gold_standard_match_pct}%
                </p>
                <p className="text-[10px] text-[#555566] mt-1 font-mono">
                  benchmark<br />alignment
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function DnaPage() {
  return (
    <Suspense>
      <DnaContent />
    </Suspense>
  );
}
