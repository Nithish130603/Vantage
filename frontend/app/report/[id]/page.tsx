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
import { ArrowLeft, Download, TrendingUp, AlertTriangle, CheckCircle, Info } from "lucide-react";
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

// ── Key Insights card ─────────────────────────────────────────────────────────

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
    detail.data_confidence === "HIGH"
      ? "#0D7377"
      : detail.data_confidence === "MEDIUM"
      ? "#D4A017"
      : "#C0392B";

  return (
    <div className="bg-[#131316] border border-white/8 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Info size={13} className="text-[#0D7377]" />
        <p className="text-[10px] font-mono tracking-[0.18em] text-[#0D7377] uppercase">
          Key Insights
        </p>
        <span
          className="ml-auto text-[9px] font-mono px-2 py-0.5 rounded"
          style={{ color: confColor, backgroundColor: `${confColor}18` }}
        >
          {detail.data_confidence} DATA CONFIDENCE
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Strengths */}
        <div>
          <p className="text-[10px] font-mono text-[#0D7377] uppercase mb-2 flex items-center gap-1">
            <CheckCircle size={10} /> Strengths
          </p>
          {strengths.length > 0 ? (
            <ul className="space-y-1.5">
              {strengths.map((s) => (
                <li key={s.name} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0D7377] mt-1.5 shrink-0" />
                  <p className="text-[11px] text-[#C8C8D4] leading-relaxed">
                    <span className="text-[#8B8B99]">{s.name}:</span>{" "}
                    {signalInsight(s).split(" — ")[0]}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[#555566]">No standout strengths detected.</p>
          )}
        </div>

        {/* Risks */}
        <div>
          <p className="text-[10px] font-mono text-[#C0392B] uppercase mb-2 flex items-center gap-1">
            <AlertTriangle size={10} /> Risks
          </p>
          {risks.length > 0 ? (
            <ul className="space-y-1.5">
              {risks.map((s) => (
                <li key={s.name} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C0392B] mt-1.5 shrink-0" />
                  <p className="text-[11px] text-[#C8C8D4] leading-relaxed">
                    <span className="text-[#8B8B99]">{s.name}:</span>{" "}
                    {signalInsight(s).split(" — ")[0]}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[#555566]">No critical risk signals detected.</p>
          )}
        </div>
      </div>

      {displayTier === "BETTER_THAN_BEST" && btbReason && (
        <div className="mt-3 pt-3 border-t border-white/6">
          <p className="text-[11px] text-[#E8C547] flex items-start gap-1.5">
            <span className="shrink-0 mt-0.5">★</span>
            {btbReason === "discovery"
              ? "Discovery opportunity — this suburb was identified through exceptional market signals (growth, low competition, ecosystem diversity, low risk), not DNA similarity. It represents a high-potential location you may not have otherwise considered."
              : "Benchmark match — this suburb's commercial profile is more similar to the industry gold standard than your current best locations, making it a stronger candidate for expansion."}
          </p>
        </div>
      )}

      {displayTier === "AVOID" && (
        <div className="mt-3 pt-3 border-t border-white/6">
          <p className="text-[11px] text-[#C0392B] flex items-center gap-1.5">
            <AlertTriangle size={11} />
            This location is classified as <strong>Avoid</strong> — risk indicators outweigh the
            commercial opportunity based on your franchise DNA.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Conclusion section ────────────────────────────────────────────────────────

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

  const verdictColor = isBtb || isRecommended ? "#0D7377" : isWatch ? "#D4A017" : "#C0392B";
  const verdictIcon = isBtb || isRecommended
    ? <CheckCircle size={16} style={{ color: verdictColor }} />
    : isWatch
    ? <AlertTriangle size={16} style={{ color: verdictColor }} />
    : <AlertTriangle size={16} style={{ color: verdictColor }} />;

  const verdictText = isBtb
    ? `${detail.locality} outperforms your current best locations. This is a high-priority expansion target.`
    : isRecommended
    ? `${detail.locality} is a strong candidate for ${detail.category} expansion. The commercial fundamentals align with your franchise DNA.`
    : isWatch
    ? `${detail.locality} shows potential but requires monitoring. Enter only if you can differentiate clearly from existing competition.`
    : `${detail.locality} does not meet the threshold for ${detail.category} expansion at this time. Elevated risk signals and a weak DNA match make this a low-priority location.`;

  const rec = detail.recommendation || buildRecommendation(detail, displayScore);

  return (
    <div className="border border-white/8 rounded-xl p-6 mb-6" style={{ backgroundColor: `${verdictColor}08` }}>
      <p className="text-[10px] font-mono tracking-[0.15em] uppercase mb-4" style={{ color: verdictColor }}>
        Conclusion
      </p>

      <div className="flex items-start gap-3 mb-4">
        {verdictIcon}
        <p className="text-base font-medium text-[#F0F0F2] leading-snug">
          {isRecommended || isBtb ? "Recommended" : isWatch ? "Proceed with caution" : "Not recommended"}
          {" "}
          <span className="text-sm font-light text-[#8B8B99]">
            — Score {displayScore}/100
          </span>
        </p>
      </div>

      <p className="text-sm text-[#C8C8D4] leading-relaxed mb-3">{verdictText}</p>

      <p className="text-[11px] text-[#8B8B99] leading-relaxed border-t border-white/6 pt-3">
        {rec}
      </p>
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

  // Compute display score and tier once — used throughout the page
  const displayScore = scanScore100 ?? (detail ? Math.round(detail.composite_score * 100) : 0);
  const displayLocality = detail?.locality ?? localityFromUrl;
  const displayState = detail?.state ?? stateFromUrl;
  const displayTier = scoreTierFromScan(displayScore, isBtbFromUrl);
  const isPartialLoad = !loading && !detail && !!error && !!localityFromUrl;

  return (
    <main className="min-h-screen px-6 py-8 max-w-4xl mx-auto">
      <ChatWidget
        category={category}
        h3_r7={id ?? undefined}
        fingerprintResult={fingerprintResult ?? undefined}
      />
      {/* Back */}
      <button
        onClick={() => router.push(`/map?category=${encodeURIComponent(category)}`)}
        className="flex items-center gap-1.5 text-sm text-[#8B8B99] hover:text-[#F0F0F2] transition-colors mb-8"
      >
        <ArrowLeft size={14} />
        Back to opportunity map
      </button>

      {loading && (
        <div className="space-y-4">
          <div className="skeleton h-10 w-64 rounded-lg" />
          <div className="skeleton h-5 w-40 rounded-lg" />
          <div className="skeleton h-32 rounded-xl mt-6" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-20 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {/* Partial load — show header + score from URL params when detail API 404s */}
      {isPartialLoad && displayScore > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <p className="text-xs font-mono tracking-[0.2em] text-[#0D7377] uppercase">
                  {category} · Location Report
                </p>
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded border"
                  style={{
                    color: TIER_COLOR[displayTier],
                    borderColor: `${TIER_COLOR[displayTier]}40`,
                    backgroundColor: `${TIER_COLOR[displayTier]}12`,
                  }}
                >
                  {displayTier === "BETTER_THAN_BEST"
                    ? btbReason === "discovery" ? "BETTER THAN BEST · DISCOVERY" : "BETTER THAN BEST · BENCHMARK"
                    : (TIER_LABEL[displayTier] ?? displayTier).toUpperCase()}
                </span>
              </div>
              <h1 className="text-3xl font-light mb-1" style={{ fontFamily: "var(--font-fraunces)" }}>
                {displayLocality}{displayState ? `, ${displayState}` : ""}
              </h1>
              <p className="text-xs text-[#555566] font-mono">{id}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-5xl font-light" style={{ color: TIER_COLOR[displayTier], fontFamily: "var(--font-fraunces)" }}>
                {displayScore}
              </p>
              <p className="text-xs text-[#555566]">opportunity score</p>
              <p className="text-[9px] text-[#3A3A4A] mt-0.5">out of 100</p>
            </div>
          </div>
          {btbReason === "discovery" && (
            <div className="bg-[#E8C547]/6 border border-[#E8C547]/20 rounded-xl p-4 mb-4 text-[11px] text-[#E8C547]/80 leading-relaxed">
              ★ Discovery opportunity — identified through strong market signals (growth, low competition, ecosystem diversity, low risk), not DNA similarity.
            </div>
          )}
          <div className="bg-[#131316] border border-white/8 rounded-xl p-5 text-sm text-[#8B8B99]">
            <p className="font-medium text-[#F0F0F2] mb-1">Detailed signal data unavailable</p>
            <p className="text-xs leading-relaxed">
              This suburb&apos;s per-signal breakdown hasn&apos;t been precomputed for this category. The Opportunity Score above ({displayScore}) was calculated in real-time using your franchise DNA.
            </p>
          </div>
        </motion.div>
      )}

      {error && !isPartialLoad && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-xl p-6 text-red-300 text-sm mb-6">
          {error}
        </div>
      )}

      {!loading && detail && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          {/* ── Header ─────────────────────────────────────────── */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <p className="text-xs font-mono tracking-[0.2em] text-[#0D7377] uppercase">
                  {category} · Location Report
                </p>
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded border"
                  style={{
                    color: TIER_COLOR[displayTier],
                    borderColor: `${TIER_COLOR[displayTier]}40`,
                    backgroundColor: `${TIER_COLOR[displayTier]}12`,
                  }}
                >
                  {displayTier === "BETTER_THAN_BEST"
                    ? btbReason === "discovery"
                      ? "BETTER THAN BEST · DISCOVERY"
                      : "BETTER THAN BEST · BENCHMARK"
                    : (TIER_LABEL[displayTier] ?? displayTier).toUpperCase()}
                </span>
              </div>
              <h1
                className="text-3xl font-light mb-1"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                {displayLocality}, {displayState}
              </h1>
              <p className="text-xs text-[#555566] font-mono">
                {detail.h3_r7} · {detail.venue_count} venues analysed
              </p>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="text-right">
                <p
                  className="text-5xl font-light"
                  style={{ color: TIER_COLOR[displayTier], fontFamily: "var(--font-fraunces)" }}
                >
                  {displayScore}
                </p>
                <p className="text-xs text-[#555566]">opportunity score</p>
                <p className="text-[9px] text-[#3A3A4A] mt-0.5">out of 100</p>
              </div>

              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 border border-white/8 hover:border-[#0D7377]/50 rounded-lg text-sm text-[#8B8B99] hover:text-[#F0F0F2] transition-colors disabled:opacity-50"
              >
                <Download size={14} />
                {downloading ? "Generating…" : "PDF Report"}
              </button>
            </div>
          </div>

          {/* PDF error */}
          {downloadError && (
            <div className="bg-red-950/20 border border-red-800/30 rounded-lg px-4 py-3 text-red-300 text-xs mb-4 flex items-center gap-2">
              <AlertTriangle size={12} />
              {downloadError}
            </div>
          )}

          {/* ── Key Insights ────────────────────────────────────── */}
          <KeyInsights detail={detail} displayTier={displayTier} btbReason={btbReason} />

          {/* ── Signal cards ────────────────────────────────────── */}
          <p className="text-[10px] font-mono tracking-[0.18em] text-[#8B8B99] uppercase mb-3 flex items-center gap-1.5">
            <TrendingUp size={10} /> 5 Scoring Signals
          </p>
          <p className="text-xs text-[#555566] mb-4 leading-relaxed">
            Each signal measures a different dimension of commercial viability. Together they form your Opportunity Score.
          </p>
          <div className="flex flex-col gap-4 mb-8">
            {detail.signals.map((sig, i) => (
              <motion.div
                key={sig.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
              >
                <SignalCard signal={sig} insight={signalInsight(sig)} />
              </motion.div>
            ))}
          </div>

          {/* ── Trajectory chart ────────────────────────────────── */}
          {(() => {
            const traj = detail.signals.find((s) => s.name === "Market Trajectory");
            const chartData = traj?.chart_data ?? [];
            return (
              <div className="bg-[#131316] border border-white/8 rounded-xl p-6 mb-6">
                <div className="flex items-start justify-between mb-1">
                  <h2 className="text-sm font-medium text-[#F0F0F2]">
                    24-Month Venue Growth
                  </h2>
                  <span className="text-[10px] font-mono text-[#555566]">
                    Monthly count
                  </span>
                </div>
                <p className="text-[11px] text-[#555566] mb-4 leading-relaxed">
                  Shows how many businesses opened (teal) and closed (red) each month, with the net change (yellow line). A rising yellow line means the area is growing.
                </p>
                {chartData.length === 0 ? (
                  <p className="text-xs text-[#555566] py-6 text-center">
                    Insufficient historical data for this suburb
                  </p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={160}>
                      <ComposedChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 9, fill: "#555566" }}
                          axisLine={false}
                          tickLine={false}
                          interval="preserveStartEnd"
                          label={{ value: "Month", position: "insideBottom", offset: -2, fontSize: 9, fill: "#3A3A4A" }}
                        />
                        <YAxis
                          tick={{ fontSize: 9, fill: "#555566" }}
                          axisLine={false}
                          tickLine={false}
                          width={28}
                          label={{ value: "Venues", angle: -90, position: "insideLeft", fontSize: 9, fill: "#3A3A4A" }}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" />
                        <Tooltip
                          contentStyle={{
                            background: "#131316",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 6,
                            fontSize: 11,
                          }}
                          formatter={(val, name) => {
                            const label = name === "created" ? "Opened" : name === "closed" ? "Closed" : "Net change";
                            return [val, label];
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 10, color: "#8B8B99", paddingTop: 8 }}
                          formatter={(value) =>
                            value === "created" ? "Opened" : value === "closed" ? "Closed" : "Net change"
                          }
                        />
                        <Bar dataKey="created" fill="#0D7377" fillOpacity={0.7} radius={[2, 2, 0, 0]} name="created" />
                        <Bar dataKey="closed" fill="#C0392B" fillOpacity={0.6} radius={[2, 2, 0, 0]} name="closed" />
                        <Line
                          type="monotone"
                          dataKey="net"
                          stroke="#E8C547"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 3, fill: "#E8C547" }}
                          name="net"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                    {(() => {
                      const last = chartData[chartData.length - 1] as Record<string, number> | undefined;
                      const net = last?.net ?? 0;
                      return (
                        <p className="text-[11px] text-[#8B8B99] mt-3 leading-relaxed">
                          {net > 0
                            ? `The most recent month shows a net gain of ${net} venue${net !== 1 ? "s" : ""} — demand in this area is growing.`
                            : net < 0
                            ? `The most recent month shows a net loss of ${Math.abs(net)} venue${Math.abs(net) !== 1 ? "s" : ""} — market contraction detected.`
                            : "Net venue change is flat — stable market conditions."}
                        </p>
                      );
                    })()}
                  </>
                )}
              </div>
            );
          })()}

          {/* ── Venue mix ───────────────────────────────────────── */}
          <div className="bg-[#131316] border border-white/8 rounded-xl p-6 mb-6">
            <h2 className="text-sm font-medium text-[#F0F0F2] mb-1">
              Venue Mix in {detail.locality}
            </h2>
            <p className="text-[11px] text-[#555566] mb-4 leading-relaxed">
              A diverse mix of complementary businesses (cafés, gyms, retail) increases foot traffic and supports new openings.
            </p>
            <div className="space-y-2">
              {detail.top_categories.map((tc) => {
                const maxCount = detail.top_categories[0]?.count ?? 1;
                return (
                  <div key={tc.category} className="flex items-center gap-3">
                    <span className="text-xs text-[#8B8B99] w-44 truncate">{tc.category}</span>
                    <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(tc.count / maxCount) * 100}%` }}
                        transition={{ duration: 0.8, delay: 0.3 }}
                        className="h-full bg-[#0D7377] rounded-full"
                      />
                    </div>
                    <span className="text-xs font-mono text-[#555566] w-8 text-right">
                      {tc.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Failure pattern check ───────────────────────────── */}
          {(hasFailureData || displayTier === "AVOID" || displayTier === "WATCH") && (
            <div
              className={`rounded-xl p-4 text-sm mb-6 ${
                displayTier === "AVOID" || resemblesFailure
                  ? "bg-red-950/20 border border-red-800/30 text-red-300"
                  : displayTier === "WATCH"
                  ? "bg-amber-950/20 border border-amber-700/30 text-amber-300"
                  : "bg-emerald-950/20 border border-emerald-700/30 text-emerald-300"
              }`}
            >
              {displayTier === "AVOID" ? (
                <span className="flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    <strong>High Risk Location:</strong> This location shows strong risk indicators — elevated closure rates, saturation, or a weak commercial DNA match. It is not recommended for expansion under current market conditions.
                    {resemblesFailure && " It also resembles your previously underperforming locations."}
                  </span>
                </span>
              ) : resemblesFailure ? (
                <span className="flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>⚠ This area resembles your worst-performing locations. Risk indicators suggest caution before committing.</span>
                </span>
              ) : displayTier === "WATCH" ? (
                <span className="flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>This location is in the Watch tier — some indicators are positive but the window may be narrowing. Monitor closely before committing.</span>
                </span>
              ) : (
                <span className="flex items-start gap-2">
                  <CheckCircle size={14} className="shrink-0 mt-0.5" />
                  <span>✓ No similarity to your failure pattern detected.</span>
                </span>
              )}
            </div>
          )}

          {/* ── Conclusion ──────────────────────────────────────── */}
          <ConclusionCard
            detail={detail}
            displayScore={displayScore}
            displayTier={displayTier}
          />
        </motion.div>
      )}
    </main>
  );
}

export default function ReportPage() {
  return (
    <Suspense>
      <ReportContent />
    </Suspense>
  );
}
