"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  api,
  type LocationDetail,
  type SignalDetail,
  TIER_COLOR,
  TIER_LABEL,
  type Tier,
} from "@/lib/api";
import { ArrowLeft, Download, TrendingUp, AlertTriangle, CheckCircle, Info, ChevronDown } from "lucide-react";
import SignalCard from "@/components/charts/SignalCard";
import dynamic from "next/dynamic";

const ChatWidget = dynamic(() => import("@/components/ui/ChatWidget"), { ssr: false });

// ── Tier helpers ──────────────────────────────────────────────────────────────

function scoreTierFromScan(score100: number, isBtb: boolean): Tier {
  if (isBtb && score100 >= 60) return "BETTER_THAN_BEST";
  if (score100 >= 60) return "STRONG";
  if (score100 >= 40) return "WATCH";
  return "AVOID";
}

// ── Plain-English signal interpretation ───────────────────────────────────────

function signalInsight(signal: SignalDetail): string {
  const s = signal.score;
  switch (signal.name) {
    case "Fingerprint Match":
      return s >= 0.65
        ? "This suburb's business mix closely resembles your best-performing locations — a strong commercial fit."
        : s >= 0.40
          ? "Some similarities to your locations, but the commercial environment is noticeably different."
          : "This suburb's business mix looks very different from your successful locations.";
    case "Market Trajectory":
      return s >= 0.65
        ? "New businesses are opening here consistently — demand is growing and the market is healthy."
        : s >= 0.40
          ? "Business openings and closures are roughly balanced — the market is steady but not accelerating."
          : "More businesses are closing than opening here — the local market may be contracting.";
    case "Competitive Pressure":
      return s >= 0.65
        ? "Very few direct competitors nearby — you'd be entering an open market."
        : s >= 0.40
          ? "Some competitors present, but not saturated. Room to establish a foothold."
          : "This category is heavily represented here. Standing out will require strong differentiation.";
    case "Ecosystem Diversity":
      return s >= 0.65
        ? "A rich mix of complementary businesses — cafés, retail, services — drives natural foot traffic."
        : s >= 0.40
          ? "A reasonable variety of businesses that can support trade, though not exceptionally diverse."
          : "Limited variety in the local business mix — fewer complementary businesses to drive foot traffic.";
    case "Risk Signals":
      return s >= 0.65
        ? "Low closure rates and stable lease conditions — this area shows minimal operational risk."
        : s >= 0.40
          ? "Moderate risk indicators. Worth monitoring before committing to a long-term lease."
          : "High closure rates or market saturation detected. Elevated operational risk.";
    default:
      return "";
  }
}

// ── Recommendation builder ────────────────────────────────────────────────────

function buildRecommendation(detail: LocationDetail, score100: number): string {
  const [fp, traj, comp, div, risk] = detail.signals.map((s) => s.score);

  const fpText = `This suburb matches ${(fp * 100).toFixed(0)}% of your franchise DNA`;
  const trajText =
    traj >= 0.65
      ? "the market is actively growing with new venues appearing month-on-month"
      : traj >= 0.40
        ? "venue growth is stable — no sharp acceleration or decline"
        : "new venue creation has been slowing — timing matters here";
  const compText =
    comp >= 0.65
      ? `${detail.category} competitors are sparse with no dominant cluster nearby`
      : comp >= 0.40
        ? "competition is moderate — room exists but the category is establishing"
        : `${detail.category} is already well-represented — differentiation will be critical`;
  const divText =
    div >= 0.65
      ? "A rich ecosystem of complementary businesses drives foot traffic"
      : div >= 0.40
        ? "The venue mix is adequate for supporting trade"
        : "Limited category variety — consider whether natural foot traffic is sufficient";
  const riskText =
    risk >= 0.65
      ? "with low closure rates and a mature venue mix, risk is minimal"
      : risk >= 0.40
        ? "moderate risk indicators suggest monitoring before committing"
        : "elevated closure rates or saturation signals warrant caution";
  const verdict =
    score100 >= 80
      ? "This location ranks among your top matches — move quickly."
      : score100 >= 60
        ? "A strong candidate worth a site inspection."
        : score100 >= 40
          ? "Solid fundamentals with some headwinds to weigh. Proceed cautiously — monitor the market before committing."
          : "Not recommended under current market conditions.";

  return `${fpText}, and ${trajText}. ${compText}. ${divText}, while ${riskText}. ${verdict}`;
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const T = {
  teal: "#0DC5CC",
  tealDim: "rgba(0,210,230,0.55)",
  tealBorder: "rgba(0,210,230,0.18)",
  tealBg: "rgba(0,210,230,0.06)",
  bg: "#020509",
  surface: "rgba(4,10,22,0.92)",
  surface2: "rgba(2,6,15,0.98)",
  border: "rgba(0,210,230,0.12)",
  borderHi: "rgba(0,210,230,0.35)",
  text: "#FFFFFF",
  textMid: "rgba(200,220,230,0.85)",
  textDim: "rgba(150,175,190,0.65)",
  gold: "#E8C547",
  red: "#E05555",
  mono: "var(--font-geist-mono)",
  serif: "var(--font-fraunces)",
};

// ── Key Insights ──────────────────────────────────────────────────────────────

function KeyInsights({
  detail,
  displayTier,
  btbReason,
}: {
  detail: LocationDetail;
  displayTier: Tier;
  btbReason: "benchmark" | "discovery" | null;
}) {
  const strengths = detail.signals.filter((s) => s.score >= 0.65);
  const risks = detail.signals.filter((s) => s.score < 0.40);
  const confColor =
    detail.data_confidence === "HIGH" ? T.teal :
      detail.data_confidence === "MEDIUM" ? T.gold : T.red;

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Data confidence strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Info size={12} style={{ color: T.tealDim }} />
        <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.22em", color: T.tealDim, textTransform: "uppercase", fontWeight: 700 }}>
          Key Insights
        </span>
        <span style={{ marginLeft: "auto", fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", padding: "3px 10px", borderRadius: 4, color: confColor, background: `${confColor}18`, border: `1px solid ${confColor}35` }}>
          {detail.data_confidence} DATA CONFIDENCE
        </span>
      </div>

      {/* Two-column strengths / risks */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Strengths */}
        <div style={{ background: "rgba(13,197,204,0.05)", border: `1px solid rgba(0,210,230,0.18)`, borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <CheckCircle size={14} style={{ color: T.teal }} />
            <p style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.2em", color: T.teal, textTransform: "uppercase", fontWeight: 800 }}>
              Location Strengths
            </p>
          </div>
          {strengths.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {strengths.map((s, i) => (
                <div key={s.name} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.tealDim, fontWeight: 800, minWidth: 22, paddingTop: 1 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>{s.name}</p>
                    <p style={{ fontSize: 13, color: T.textMid, lineHeight: 1.6, fontWeight: 500 }}>
                      {signalInsight(s).split(" — ")[0]}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: T.textDim, fontWeight: 500 }}>No standout strengths detected.</p>
          )}
        </div>

        {/* Risks */}
        <div style={{ background: "rgba(224,85,85,0.05)", border: "1px solid rgba(224,85,85,0.18)", borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <AlertTriangle size={14} style={{ color: T.red }} />
            <p style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.2em", color: T.red, textTransform: "uppercase", fontWeight: 800 }}>
              Critical Risks
            </p>
          </div>
          {risks.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {risks.map((s, i) => (
                <div key={s.name} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: "rgba(224,85,85,0.6)", fontWeight: 800, minWidth: 22, paddingTop: 1 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>{s.name}</p>
                    <p style={{ fontSize: 13, color: T.textMid, lineHeight: 1.6, fontWeight: 500 }}>
                      {signalInsight(s).split(" — ")[0]}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: T.textDim, fontWeight: 500 }}>No critical risk signals detected.</p>
          )}
        </div>
      </div>

      {/* BTB / Avoid callout */}
      {displayTier === "BETTER_THAN_BEST" && btbReason && (
        <div style={{ marginTop: 12, padding: "14px 18px", borderRadius: 10, background: `${T.gold}0A`, border: `1px solid ${T.gold}30`, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ color: T.gold, flexShrink: 0, marginTop: 1 }}>★</span>
          <p style={{ fontSize: 13, color: `${T.gold}CC`, lineHeight: 1.65, fontWeight: 500 }}>
            {btbReason === "discovery"
              ? "Discovery opportunity — this suburb was identified through exceptional market signals (growth, low competition, ecosystem diversity, low risk), not DNA similarity. It represents a high-potential location you may not have otherwise considered."
              : "Benchmark match — this suburb's commercial profile is more similar to the industry gold standard than your current best locations, making it a stronger candidate for expansion."}
          </p>
        </div>
      )}
      {displayTier === "AVOID" && (
        <div style={{ marginTop: 12, padding: "14px 18px", borderRadius: 10, background: `${T.red}0A`, border: `1px solid ${T.red}30`, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle size={14} style={{ color: T.red, flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 13, color: `${T.red}CC`, lineHeight: 1.65, fontWeight: 500 }}>
            This location is classified as <strong>Avoid</strong> — risk indicators outweigh the commercial opportunity based on your franchise DNA.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Conclusion ────────────────────────────────────────────────────────────────

function ConclusionCard({
  detail,
  displayScore,
  displayTier,
}: {
  detail: LocationDetail;
  displayScore: number;
  displayTier: Tier;
}) {
  const isRecommended = displayScore >= 60;
  const isWatch = displayTier === "WATCH";
  const isBtb = displayTier === "BETTER_THAN_BEST";

  const verdictColor = isBtb || isRecommended ? T.teal : isWatch ? T.gold : T.red;
  const verdictIcon = isBtb || isRecommended
    ? <CheckCircle size={18} style={{ color: verdictColor, flexShrink: 0 }} />
    : <AlertTriangle size={18} style={{ color: verdictColor, flexShrink: 0 }} />;

  const verdictLabel = isBtb ? "High-Priority Target"
    : isRecommended ? "Recommended"
      : isWatch ? "Proceed with Caution"
        : "Not Recommended";

  const verdictText = isBtb
    ? `${detail.locality} outperforms your current best locations. This is a high-priority expansion target.`
    : isRecommended
      ? `${detail.locality} is a strong candidate for ${detail.category} expansion. The commercial fundamentals align with your franchise DNA.`
      : isWatch
        ? `${detail.locality} shows potential but requires monitoring. Enter only if you can differentiate clearly from existing competition.`
        : `${detail.locality} does not meet the threshold for ${detail.category} expansion at this time. Elevated risk signals and a weak DNA match make this a low-priority location.`;

  const rec = detail.recommendation || buildRecommendation(detail, displayScore);

  return (
    <div style={{ borderRadius: 16, padding: "24px 26px", marginBottom: 32, background: `${verdictColor}08`, border: `1px solid ${verdictColor}28`, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: "15%", bottom: "15%", width: 3, borderRadius: 3, background: `linear-gradient(180deg, transparent, ${verdictColor}, transparent)` }} />
      <p style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.26em", textTransform: "uppercase", color: verdictColor, fontWeight: 800, marginBottom: 16, opacity: 0.8 }}>
        Conclusion · Deep Dive Report
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {verdictIcon}
        <p style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 400, color: T.text, lineHeight: 1.2 }}>
          {verdictLabel}
          <span style={{ fontSize: 15, fontWeight: 300, color: T.textDim, marginLeft: 12 }}>
            — Score {displayScore}/100
          </span>
        </p>
      </div>
      <p style={{ fontSize: 15, color: T.textMid, lineHeight: 1.7, marginBottom: 14, fontWeight: 500 }}>{verdictText}</p>
      <div style={{ borderTop: `1px solid ${verdictColor}18`, paddingTop: 14 }}>
        <p style={{ fontSize: 13, color: T.textDim, lineHeight: 1.75, fontWeight: 500 }}>{rec}</p>
      </div>
    </div>
  );
}

// ── Main report ───────────────────────────────────────────────────────────────

function ReportContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const ss = typeof sessionStorage !== "undefined" ? sessionStorage : null;
  const category =
    searchParams.get("category") ??
    ss?.getItem("vantage_category") ??
    "Gym & Fitness";

  const fingerprintResult = (() => {
    try {
      return JSON.parse(ss?.getItem("vantage_dna") ?? "null") as Record<string, unknown> | null;
    } catch {
      return null;
    }
  })();

  const [detail, setDetail] = useState<LocationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSignals, setExpandedSignals] = useState<Set<number>>(new Set([0]));

  useEffect(() => {
    if (!id) return;
    api
      .location(id, category)
      .then(setDetail)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, category]);

  const handleDownload = async () => {
    if (!id || !detail) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await api.downloadReport(
        id, category, displayLocality, displayState,
        displayScore, isBtbFromUrl, btbReason,
      );
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "PDF generation failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const failureH3s = (() => {
    try {
      const dna = JSON.parse(ss?.getItem("vantage_dna") ?? "{}");
      return (dna.failure_h3s ?? []) as string[];
    } catch {
      return [] as string[];
    }
  })();

  const hasFailureData = failureH3s.length > 0;
  const resemblesFailure = hasFailureData && id ? failureH3s.includes(id) : false;

  const scanScore100 = searchParams.get("score") ? parseInt(searchParams.get("score")!) : null;
  const isBtbFromUrl = searchParams.get("btb") === "1";
  const btbReason = searchParams.get("btb_reason") as "benchmark" | "discovery" | null;
  const localityFromUrl = searchParams.get("locality") ?? "";
  const stateFromUrl = searchParams.get("state") ?? "";

  const displayScore = scanScore100 ?? (detail ? Math.round(detail.composite_score * 100) : 0);
  const displayLocality = detail?.locality ?? localityFromUrl;
  const displayState = detail?.state ?? stateFromUrl;
  const displayTier = scoreTierFromScan(displayScore, isBtbFromUrl);
  const isPartialLoad = !loading && !detail && !!error && !!localityFromUrl;

  const tierColor = TIER_COLOR[displayTier];

  return (
    <main style={{ minHeight: "100vh", backgroundColor: T.bg, backgroundImage: "radial-gradient(rgba(0,210,230,0.04) 1px, transparent 1px)", backgroundSize: "28px 28px", padding: "0 0 60px 0" }}>
      <style>{`
        @keyframes hud-pulse { 0%,100%{opacity:0.7}50%{opacity:1} }
        .hud-dot { animation: hud-pulse 2.8s ease-in-out infinite; }
      `}</style>

      <ChatWidget
        category={category}
        h3_r7={id ?? undefined}
        fingerprintResult={fingerprintResult ?? undefined}
      />

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: `1px solid ${T.border}`, background: "rgba(2,5,9,0.98)", padding: "14px 40px", display: "flex", alignItems: "center", gap: 20, position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(16px)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${T.teal}, transparent)` }} />
        <button
          onClick={() => router.push(`/map?category=${encodeURIComponent(category)}`)}
          style={{ display: "flex", alignItems: "center", gap: 7, background: T.tealBg, border: `1px solid ${T.tealBorder}`, borderRadius: 8, padding: "7px 13px", color: T.teal, fontSize: 12, fontWeight: 700, fontFamily: T.mono, cursor: "pointer", letterSpacing: "0.05em", transition: "all 0.15s" }}
        >
          <ArrowLeft size={13} /> Back to Map
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="hud-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: T.teal }} />
          <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.26em", color: T.tealDim, textTransform: "uppercase", fontWeight: 700 }}>
            Deep Dive Report // {category}
          </span>
        </div>
        {!loading && detail && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderRadius: 8, border: `1px solid ${T.border}`, background: "rgba(0,210,230,0.04)", color: T.teal, fontSize: 12, fontWeight: 700, fontFamily: T.mono, cursor: "pointer", opacity: downloading ? 0.5 : 1, letterSpacing: "0.05em" }}
          >
            <Download size={13} />
            {downloading ? "Generating…" : "PDF Report"}
          </button>
        )}
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 40px 0" }}>

        {/* ── Loading ────────────────────────────────────────────────────────── */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="skeleton" style={{ height: 48, width: 320, borderRadius: 10 }} />
            <div className="skeleton" style={{ height: 24, width: 200, borderRadius: 8 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12 }} />
              ))}
            </div>
          </div>
        )}

        {/* ── Partial load ───────────────────────────────────────────────────── */}
        {isPartialLoad && displayScore > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
            <HeaderSection
              displayLocality={displayLocality}
              displayState={displayState}
              displayScore={displayScore}
              displayTier={displayTier}
              tierColor={tierColor}
              btbReason={btbReason}
              h3id={id ?? ""}
              venueCount={null}
              dataConfidence={null}
            />
            {btbReason === "discovery" && (
              <div style={{ background: `${T.gold}0A`, border: `1px solid ${T.gold}25`, borderRadius: 12, padding: "14px 18px", marginBottom: 20, fontSize: 13, color: `${T.gold}CC`, lineHeight: 1.65, fontWeight: 500 }}>
                ★ Discovery opportunity — identified through strong market signals (growth, low competition, ecosystem diversity, low risk), not DNA similarity.
              </div>
            )}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: "20px 24px", fontSize: 14, color: T.textDim }}>
              <p style={{ fontWeight: 700, color: T.text, marginBottom: 6, fontSize: 15 }}>Detailed signal data unavailable</p>
              <p style={{ lineHeight: 1.7, fontWeight: 500 }}>
                This suburb&apos;s per-signal breakdown hasn&apos;t been precomputed for this category. The Opportunity Score above ({displayScore}) was calculated in real-time using your franchise DNA.
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────────── */}
        {error && !isPartialLoad && (
          <div style={{ background: "rgba(224,85,85,0.08)", border: "1px solid rgba(224,85,85,0.25)", borderRadius: 14, padding: "18px 22px", color: T.red, fontSize: 14, marginBottom: 24, fontWeight: 500 }}>
            {error}
          </div>
        )}

        {/* ── PDF error ──────────────────────────────────────────────────────── */}
        {downloadError && (
          <div style={{ background: "rgba(224,85,85,0.07)", border: "1px solid rgba(224,85,85,0.22)", borderRadius: 10, padding: "12px 16px", color: T.red, fontSize: 13, marginBottom: 20, display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
            <AlertTriangle size={13} /> {downloadError}
          </div>
        )}

        {/* ── Full report ────────────────────────────────────────────────────── */}
        {!loading && detail && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>

            {/* Header */}
            <HeaderSection
              displayLocality={displayLocality}
              displayState={displayState}
              displayScore={displayScore}
              displayTier={displayTier}
              tierColor={tierColor}
              btbReason={btbReason}
              h3id={detail.h3_r7}
              venueCount={detail.venue_count}
              dataConfidence={detail.data_confidence}
            />

            {/* Key Insights — 2-col strengths / risks */}
            <KeyInsights detail={detail} displayTier={displayTier} btbReason={btbReason} />

            {/* Signals + Chart — stacked */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>

              {/* Trajectory chart — full width */}
              {(() => {
                const traj = detail.signals.find((s) => s.name === "Market Trajectory");
                const chartData = traj?.chart_data ?? [];
                return (
                  <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "20px 24px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                      <div>
                        <p style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 400, color: T.text, marginBottom: 4 }}>
                          24-Month Venue Growth
                        </p>
                        <p style={{ fontSize: 12, color: T.textDim, fontWeight: 500 }}>
                          Opened vs Closed (Aggregate Data)
                        </p>
                      </div>
                    </div>
                    {chartData.length === 0 ? (
                      <p style={{ fontSize: 13, color: T.textDim, padding: "24px 0", textAlign: "center", fontWeight: 500 }}>
                        Insufficient historical data for this suburb
                      </p>
                    ) : (
                      <>
                        <ResponsiveContainer width="100%" height={180}>
                          <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                            <XAxis
                              dataKey="month"
                              tick={{ fontSize: 10, fill: "rgba(150,175,190,0.55)", fontWeight: 600 }}
                              axisLine={false} tickLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: "rgba(150,175,190,0.55)", fontWeight: 600 }}
                              axisLine={false} tickLine={false} width={28}
                            />
                            <ReferenceLine y={0} stroke="rgba(0,210,230,0.08)" />
                            <Tooltip
                              contentStyle={{ background: "rgba(2,5,12,0.97)", border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 12, fontWeight: 600 }}
                              formatter={(val, name) => {
                                const label = name === "created" ? "Opened" : name === "closed" ? "Closed" : "Net change";
                                return [val, label];
                              }}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 11, color: T.textDim, paddingTop: 10, fontWeight: 600 }}
                              formatter={(value) => value === "created" ? "Opened" : value === "closed" ? "Closed" : "Net change"}
                            />
                            <Bar dataKey="created" fill={T.teal} fillOpacity={0.65} radius={[2, 2, 0, 0]} name="created" />
                            <Bar dataKey="closed" fill={T.red} fillOpacity={0.55} radius={[2, 2, 0, 0]} name="closed" />
                            <Line type="monotone" dataKey="net" stroke={T.gold} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: T.gold }} name="net" />
                          </ComposedChart>
                        </ResponsiveContainer>
                        {(() => {
                          const last = chartData[chartData.length - 1] as Record<string, number> | undefined;
                          const net = last?.net ?? 0;
                          return (
                            <p style={{ fontSize: 13, color: T.textDim, marginTop: 10, lineHeight: 1.65, fontWeight: 500 }}>
                              {net > 0
                                ? `Net gain of ${net} venue${net !== 1 ? "s" : ""} last month — demand is growing.`
                                : net < 0
                                  ? `Net loss of ${Math.abs(net)} venue${Math.abs(net) !== 1 ? "s" : ""} last month — market contraction detected.`
                                  : "Net venue change is flat — stable market conditions."}
                            </p>
                          );
                        })()}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Signal cards — full width */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <TrendingUp size={12} style={{ color: T.tealDim }} />
                  <p style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.22em", color: T.tealDim, textTransform: "uppercase", fontWeight: 800 }}>
                    5 Scoring Signals
                  </p>
                </div>
                <p style={{ fontSize: 13, color: T.textDim, marginBottom: 14, lineHeight: 1.6, fontWeight: 500 }}>
                  Each signal measures a different dimension of commercial viability.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {detail.signals.map((sig, i) => {
                    const isOpen = expandedSignals.has(i);
                    const scoreColor =
                      sig.score >= 0.65 ? T.teal :
                        sig.score >= 0.40 ? T.gold : T.red;
                    return (
                      <motion.div
                        key={sig.name}
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.07 }}
                        style={{ border: `1px solid ${isOpen ? T.tealBorder : T.border}`, borderRadius: 10, overflow: "hidden", background: T.surface }}
                      >
                        {/* Header row — always visible, click to toggle */}
                        <button
                          onClick={() => setExpandedSignals(prev => {
                            const next = new Set(prev);
                            isOpen ? next.delete(i) : next.add(i);
                            return next;
                          })}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                        >
                          <span style={{ fontFamily: T.mono, fontSize: 10, color: T.textDim, fontWeight: 700, minWidth: 18 }}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1 }}>
                            {sig.name}
                          </span>
                          <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 800, color: scoreColor, minWidth: 36, textAlign: "right" }}>
                            {(sig.score * 100).toFixed(0)}
                          </span>
                          <ChevronDown
                            size={13}
                            style={{ color: T.textDim, flexShrink: 0, transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                          />
                        </button>
                        {/* Collapsible body */}
                        {isOpen && (
                          <div style={{ padding: "0 14px 14px 14px", borderTop: `1px solid ${T.border}` }}>
                            <SignalCard signal={sig} insight={signalInsight(sig)} />
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Venue mix */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "22px 26px", marginBottom: 16 }}>
              <p style={{ fontFamily: T.serif, fontSize: 18, fontWeight: 400, color: T.text, marginBottom: 4 }}>
                Venue Mix in {detail.locality}
              </p>
              <p style={{ fontSize: 13, color: T.textDim, marginBottom: 18, lineHeight: 1.6, fontWeight: 500 }}>
                A diverse mix of complementary businesses increases foot traffic and supports new openings.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {detail.top_categories.map((tc) => {
                  const maxCount = detail.top_categories[0]?.count ?? 1;
                  const pct = ((tc.count / maxCount) * 100).toFixed(0);
                  return (
                    <div key={tc.category} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span style={{ fontSize: 13, color: T.textMid, width: 180, flexShrink: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tc.category}
                      </span>
                      <div style={{ flex: 1, height: 6, background: "rgba(0,210,230,0.08)", borderRadius: 99, overflow: "hidden" }}>
                        <motion.div
                          initial={{ width: 0 }} animate={{ width: `${(tc.count / maxCount) * 100}%` }}
                          transition={{ duration: 0.9, delay: 0.2 }}
                          style={{ height: "100%", background: `linear-gradient(90deg, ${T.teal}, rgba(0,210,230,0.5))`, borderRadius: 99 }}
                        />
                      </div>
                      <span style={{ fontSize: 12, fontFamily: T.mono, color: T.teal, fontWeight: 700, minWidth: 36, textAlign: "right" }}>
                        {pct}%
                      </span>
                      <span style={{ fontSize: 12, fontFamily: T.mono, color: T.textDim, fontWeight: 600, minWidth: 28, textAlign: "right" }}>
                        {tc.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Failure pattern check */}
            {(hasFailureData || displayTier === "AVOID" || displayTier === "WATCH") && (
              <div style={{
                borderRadius: 14, padding: "16px 20px", marginBottom: 16,
                background: displayTier === "AVOID" || resemblesFailure ? "rgba(224,85,85,0.07)" : displayTier === "WATCH" ? "rgba(232,197,71,0.07)" : "rgba(13,197,204,0.07)",
                border: `1px solid ${displayTier === "AVOID" || resemblesFailure ? "rgba(224,85,85,0.25)" : displayTier === "WATCH" ? "rgba(232,197,71,0.25)" : "rgba(13,197,204,0.2)"}`,
              }}>
                {displayTier === "AVOID" ? (
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <AlertTriangle size={15} style={{ color: T.red, flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 14, color: `${T.red}CC`, lineHeight: 1.65, fontWeight: 600 }}>
                      <strong style={{ color: T.red }}>High Risk Location:</strong> Elevated closure rates, saturation, or a weak commercial DNA match. Not recommended for expansion.
                      {resemblesFailure && " It also resembles your previously underperforming locations."}
                    </p>
                  </div>
                ) : resemblesFailure ? (
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <AlertTriangle size={15} style={{ color: T.gold, flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 14, color: `${T.gold}CC`, lineHeight: 1.65, fontWeight: 600 }}>
                      ⚠ This area resembles your worst-performing locations. Risk indicators suggest caution before committing.
                    </p>
                  </div>
                ) : displayTier === "WATCH" ? (
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <AlertTriangle size={15} style={{ color: T.gold, flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 14, color: `${T.gold}CC`, lineHeight: 1.65, fontWeight: 600 }}>
                      Watch tier — some indicators are positive but the window may be narrowing. Monitor closely before committing.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <CheckCircle size={15} style={{ color: T.teal, flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 14, color: T.teal, lineHeight: 1.65, fontWeight: 600 }}>
                      No similarity to your failure pattern detected.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Conclusion */}
            <ConclusionCard detail={detail} displayScore={displayScore} displayTier={displayTier} />
          </motion.div>
        )}
      </div>
    </main>
  );
}

// ── Header section (reused for partial + full load) ───────────────────────────

function HeaderSection({
  displayLocality, displayState, displayScore, displayTier, tierColor,
  btbReason, h3id, venueCount, dataConfidence,
}: {
  displayLocality: string; displayState: string; displayScore: number;
  displayTier: Tier; tierColor: string; btbReason: "benchmark" | "discovery" | null;
  h3id: string; venueCount: number | null; dataConfidence: string | null;
}) {
  const confColor =
    dataConfidence === "HIGH" ? T.teal :
      dataConfidence === "MEDIUM" ? T.gold :
        dataConfidence ? T.red : "rgba(150,175,190,0.5)";

  const tierLabel = displayTier === "BETTER_THAN_BEST"
    ? btbReason === "discovery" ? "BETTER THAN BEST · DISCOVERY" : "BETTER THAN BEST · BENCHMARK"
    : (TIER_LABEL[displayTier] ?? displayTier).toUpperCase();

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Breadcrumb */}
      <p style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.22em", color: T.tealDim, textTransform: "uppercase", fontWeight: 700, marginBottom: 12 }}>
        {h3id ? `Deep Dive Report // ${h3id}` : "Deep Dive Report"}
      </p>

      {/* Name + stat boxes */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
        {/* Name + badge */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
            <h1 style={{ fontFamily: T.serif, fontSize: 44, fontWeight: 400, color: T.text, lineHeight: 1.1, margin: 0 }}>
              {displayLocality}{displayState ? `, ${displayState}` : ""}
            </h1>
            <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.15em", padding: "5px 12px", borderRadius: 6, color: tierColor, background: `${tierColor}18`, border: `1px solid ${tierColor}40`, fontWeight: 800 }}>
              {tierLabel}
            </span>
          </div>
          {venueCount !== null && (
            <p style={{ fontFamily: T.mono, fontSize: 11, color: T.textDim, fontWeight: 600, letterSpacing: "0.08em" }}>
              {venueCount} venues analysed
            </p>
          )}
        </div>

        {/* Score box */}
        <div style={{ background: T.surface, border: `1px solid ${T.borderHi}`, borderRadius: 14, padding: "16px 24px", textAlign: "center", minWidth: 130, position: "relative" }}>
          <div style={{ position: "absolute", inset: -1, borderRadius: 14, boxShadow: `0 0 24px ${tierColor}25`, pointerEvents: "none" }} />
          <p style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.2em", color: T.textDim, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
            Opportunity Score
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, justifyContent: "center" }}>
            <span style={{ fontFamily: T.serif, fontSize: 52, fontWeight: 400, color: tierColor, lineHeight: 1, textShadow: `0 0 28px ${tierColor}60` }}>
              {displayScore}
            </span>
            <span style={{ fontFamily: T.mono, fontSize: 13, color: T.textDim, fontWeight: 700 }}>/100</span>
          </div>
        </div>

        {/* Data confidence box */}
        {dataConfidence && (
          <div style={{ background: T.surface, border: `1px solid ${confColor}30`, borderRadius: 14, padding: "16px 24px", textAlign: "center", minWidth: 130 }}>
            <p style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.2em", color: T.textDim, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
              Data Confidence
            </p>
            <p style={{ fontFamily: T.serif, fontSize: 24, fontWeight: 400, color: confColor, lineHeight: 1.1, letterSpacing: "0.01em" }}>
              {dataConfidence}
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 3, marginTop: 8 }}>
              {["HIGH", "MEDIUM", "LOW"].map((level) => (
                <div key={level} style={{ width: 20, height: 4, borderRadius: 2, background: level === "HIGH" ? T.teal : level === "MEDIUM" ? T.gold : T.red, opacity: dataConfidence === level ? 1 : 0.2 }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense>
      <ReportContent />
    </Suspense>
  );
}
