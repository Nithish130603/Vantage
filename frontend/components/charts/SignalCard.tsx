"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { SignalDetail } from "@/lib/api";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export interface ExplainCardState {
  text: string;
  loading: boolean;
  error?: string;
}

interface Props {
  signal: SignalDetail;
  /** Deprecated static insight — used as placeholder only when no AI text available */
  insight?: string;
  /** Call this to start a streaming AI explanation. Returns a cancel fn. */
  explainStream?: (
    onToken: (t: string) => void,
    onDone: (full: string) => void,
    onError: (err: string) => void,
  ) => () => void;
  /** Shared state lifted to parent so it persists when card is collapsed/re-opened */
  explainState?: ExplainCardState;
  onExplainStateChange?: (s: ExplainCardState) => void;
}

// ── Per-signal accent colours ─────────────────────────────────────────────────
export const SIGNAL_PALETTE: Record<string, { accent: string; bg: string; border: string }> = {
  "Fingerprint Match":    { accent: "#A78BFA", bg: "rgba(167,139,250,0.07)", border: "rgba(167,139,250,0.28)" },
  "Market Trajectory":   { accent: "#34D399", bg: "rgba(52,211,153,0.07)",  border: "rgba(52,211,153,0.28)"  },
  "Competitive Pressure":{ accent: "#FB923C", bg: "rgba(251,146,60,0.07)",  border: "rgba(251,146,60,0.28)"  },
  "Ecosystem Diversity": { accent: "#38BDF8", bg: "rgba(56,189,248,0.07)",  border: "rgba(56,189,248,0.28)"  },
  "Risk Signals":        { accent: "#F472B6", bg: "rgba(244,114,182,0.07)", border: "rgba(244,114,182,0.28)" },
};
const FALLBACK = { accent: "#0DC5CC", bg: "rgba(13,197,204,0.07)", border: "rgba(13,197,204,0.28)" };

function scoreColor(s: number) {
  return s >= 0.65 ? "#0DC5CC" : s >= 0.40 ? "#E8C547" : "#E05555";
}


const MONO = "var(--font-geist-mono, monospace)";
const SERIF = "var(--font-fraunces, serif)";

// ── Score arc SVG ─────────────────────────────────────────────────────────────
function ScoreArc({ score }: { score: number }) {
  const pct  = Math.round(score * 100);
  const sc   = scoreColor(score);
  const r    = 26;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ * 0.75;
  return (
    <div style={{ position: "relative", width: 62, height: 62, flexShrink: 0 }}>
      <svg width="62" height="62" viewBox="0 0 62 62" style={{ transform: "rotate(135deg)" }}>
        <circle cx="31" cy="31" r={r} fill="none" stroke="rgba(255,255,255,0.06)"
          strokeWidth="5" strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeLinecap="round" />
        <circle cx="31" cy="31" r={r} fill="none" stroke={sc}
          strokeWidth="5" strokeDasharray={`${dash} ${circ - dash + circ * 0.25}`} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${sc}90)` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBottom: 4 }}>
        <span style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 400, color: sc, lineHeight: 1 }}>{pct}</span>
      </div>
    </div>
  );
}

// ── Market Trajectory — ECharts area sparkline ────────────────────────────────
function TrajectoryChart({ data, accent }: { data: { month: string; count?: number; created?: number }[]; accent: string }) {
  const option = useMemo(() => ({
    backgroundColor: "transparent",
    animation: true,
    animationDuration: 900,
    grid: { left: 36, right: 16, top: 12, bottom: 28 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(4,10,22,0.97)",
      borderColor: accent + "55",
      textStyle: { color: "#F0F0F2", fontFamily: MONO, fontSize: 12 },
      formatter: (p: { name: string; value: number }[]) =>
        `<div style="color:rgba(150,175,190,0.5);font-size:10px;margin-bottom:4px">${p[0].name}</div><b style="color:${accent};font-size:14px">${p[0].value} venues</b>`,
    },
    xAxis: {
      type: "category",
      data: data.map((d) => d.month),
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      axisTick: { show: false },
      axisLabel: { color: "rgba(150,175,190,0.5)", fontSize: 9, fontFamily: MONO, interval: "auto", showMinLabel: true, showMaxLabel: true },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "rgba(150,175,190,0.45)", fontSize: 9, fontFamily: MONO },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)", type: "dashed" } },
    },
    series: [{
      type: "line",
      data: data.map((d) => d.count ?? d.created ?? 0),
      smooth: 0.35,
      symbol: "circle",
      symbolSize: 7,
      lineStyle: { color: accent, width: 2.5, shadowColor: accent + "70", shadowBlur: 12 },
      itemStyle: { color: accent, borderColor: "rgba(4,10,22,0.9)", borderWidth: 2.5 },
      areaStyle: {
        color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: accent + "45" }, { offset: 1, color: accent + "04" }] },
      },
    }],
  }), [data, accent]);
  return <ReactECharts option={option} style={{ height: 160 }} opts={{ renderer: "svg" }} />;
}

// ── Risk Signals — horizontal bars ────────────────────────────────────────────
function RiskChart({ data, accent }: { data: { category?: string; status?: string; count: number }[]; accent: string }) {
  const labels = data.map((d) => d.category ?? d.status ?? "");
  const max = Math.max(...data.map((d) => d.count), 1);
  const option = useMemo(() => ({
    backgroundColor: "transparent",
    animation: true,
    grid: { left: 60, right: 44, top: 8, bottom: 8 },
    tooltip: {
      trigger: "axis", axisPointer: { type: "none" },
      backgroundColor: "rgba(4,10,22,0.97)",
      borderColor: accent + "55",
      textStyle: { color: "#F0F0F2", fontFamily: MONO, fontSize: 12 },
    },
    xAxis: { type: "value", show: false, max },
    yAxis: {
      type: "category", data: labels,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: "rgba(180,195,210,0.7)", fontSize: 10, fontFamily: MONO, fontWeight: "bold" },
    },
    series: [{
      type: "bar", data: data.map((d) => d.count), barMaxWidth: 14,
      itemStyle: {
        borderRadius: [0, 5, 5, 0],
        color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [{ offset: 0, color: accent + "ee" }, { offset: 1, color: accent + "33" }] },
      },
      label: { show: true, position: "right", color: "rgba(180,195,210,0.7)", fontSize: 10, fontFamily: MONO, fontWeight: "bold" },
    }],
  }), [labels, data, accent, max]);
  return <ReactECharts option={option} style={{ height: Math.max(data.length * 32, 100) }} opts={{ renderer: "svg" }} />;
}

// ── Category bars — fingerprint / competition / diversity ─────────────────────
function CategoryChart({ data, accent }: { data: { category: string; count: number }[]; accent: string }) {
  const top = data.slice(0, 7);
  const max = Math.max(...top.map((d) => d.count), 1);
  const option = useMemo(() => ({
    backgroundColor: "transparent",
    animation: true,
    grid: { left: 100, right: 44, top: 8, bottom: 8 },
    tooltip: {
      trigger: "axis", axisPointer: { type: "none" },
      backgroundColor: "rgba(4,10,22,0.97)",
      borderColor: accent + "55",
      textStyle: { color: "#F0F0F2", fontFamily: MONO, fontSize: 12 },
      formatter: (p: { name: string; value: number }[]) =>
        `<span style="color:rgba(150,175,190,0.6)">${p[0].name}</span><br/><b style="color:${accent};font-size:14px">${p[0].value}</b>`,
    },
    xAxis: { type: "value", show: false, max },
    yAxis: {
      type: "category", data: top.map((d) => d.category),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: "rgba(180,195,210,0.7)", fontSize: 10, fontFamily: MONO, overflow: "truncate", width: 95 },
    },
    series: [{
      type: "bar", data: top.map((d) => d.count), barMaxWidth: 14,
      itemStyle: {
        borderRadius: [0, 5, 5, 0],
        color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [{ offset: 0, color: accent + "ee" }, { offset: 1, color: accent + "30" }] },
      },
      label: { show: true, position: "right", color: "rgba(180,195,210,0.7)", fontSize: 10, fontFamily: MONO, fontWeight: "bold" },
      emphasis: { itemStyle: { color: accent } },
    }],
  }), [top, accent, max]);
  return <ReactECharts option={option} style={{ height: Math.max(top.length * 28, 100) }} opts={{ renderer: "svg" }} />;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SignalCard({
  signal,
  insight,
  explainStream,
  explainState,
  onExplainStateChange,
}: Props) {
  const [showExplain, setShowExplain] = useState(false);
  const palette = SIGNAL_PALETTE[signal.name] ?? FALLBACK;
  const { accent } = palette;
  const pct    = Math.round(signal.score * 100);
  const sc     = scoreColor(signal.score);
  const badge  = signal.badge || `${pct}%`;

  // Local streaming state (fallback when no lifted state is provided)
  const [localExplain, setLocalExplain] = useState<ExplainCardState>({ text: "", loading: false });
  const es    = explainState ?? localExplain;
  const setEs = onExplainStateChange ?? setLocalExplain;

  function handleExplain() {
    if (!showExplain) {
      setShowExplain(true);
      // Only trigger AI call if not already loaded / loading
      if (!es.text && !es.loading && explainStream) {
        setEs({ text: "", loading: true });
        let accumulated = "";
        const cancel = explainStream(
          (token) => {
            accumulated += token;
            setEs({ text: accumulated, loading: true });
          },
          (full) => setEs({ text: full || accumulated, loading: false }),
          (err)  => setEs({ text: accumulated, loading: false, error: err }),
        );
        // Store cancel so we don't leak; component unmount doesn't need it since
        // state is lifted to the parent page which stays mounted.
        return cancel;
      }
    } else {
      setShowExplain(false);
    }
  }

  const chart = (() => {
    if (!signal.chart_data?.length) return null;
    if (signal.name === "Market Trajectory")
      return <TrajectoryChart data={signal.chart_data as { month: string; count?: number; created?: number }[]} accent={accent} />;
    if (signal.name === "Risk Signals")
      return <RiskChart data={signal.chart_data as { category?: string; status?: string; count: number }[]} accent={accent} />;
    return <CategoryChart data={signal.chart_data as { category: string; count: number }[]} accent={accent} />;
  })();

  // AI insight text to display (live stream or static fallback)
  const aiText = es.text || insight || "";

  return (
    <div style={{
      background: `linear-gradient(135deg, ${accent}0a 0%, rgba(4,10,22,0.92) 60%)`,
      border: `1px solid ${accent}35`,
      borderRadius: 14,
      padding: "20px 22px",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Decorative top-right glow */}
      <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: `radial-gradient(circle, ${accent}18 0%, transparent 70%)`, pointerEvents: "none" }} />
      {/* Left accent stripe */}
      <div style={{ position: "absolute", left: 0, top: "8%", bottom: "8%", width: 3, borderRadius: 3, background: `linear-gradient(180deg, transparent, ${accent}, transparent)` }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
        <ScoreArc score={signal.score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#F0F0F2", margin: 0 }}>{signal.name}</h3>
            <span style={{ fontSize: 9, fontFamily: MONO, fontWeight: 800, letterSpacing: "0.12em", padding: "3px 9px", borderRadius: 5, color: accent, background: accent + "22", border: `1px solid ${accent}45` }}>
              {badge}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "rgba(160,180,200,0.6)", lineHeight: 1.55, margin: 0 }}>
            {signal.description}
          </p>
        </div>

        {/* Explain button */}
        <button
          onClick={handleExplain}
          disabled={es.loading}
          style={{
            flexShrink: 0,
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 13px", borderRadius: 8,
            background: showExplain ? accent + "25" : "rgba(255,255,255,0.04)",
            border: `1px solid ${showExplain ? accent + "60" : "rgba(255,255,255,0.1)"}`,
            color: showExplain ? accent : "rgba(180,195,210,0.6)",
            fontSize: 11, fontFamily: MONO, fontWeight: 700, letterSpacing: "0.06em",
            cursor: es.loading ? "wait" : "pointer", transition: "all 0.18s",
            opacity: es.loading ? 0.7 : 1,
          }}
        >
          {es.loading
            ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 13 }}>⟳</span> Analysing…</>
            : <><span style={{ fontSize: 13 }}>💡</span> {showExplain ? "Close" : "Explain"}</>
          }
        </button>
      </div>

      {/* Score bar */}
      <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 99, overflow: "hidden", marginBottom: 16 }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: `linear-gradient(90deg, ${accent}, ${sc})`,
          borderRadius: 99, boxShadow: `0 0 10px ${accent}55`,
          transition: "width 0.8s ease",
        }} />
      </div>

      {/* Chart */}
      {chart && (
        <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 10, padding: "12px 8px 8px" }}>
          {chart}
        </div>
      )}

      {/* Explain panel — AI streaming */}
      {showExplain && (
        <div style={{
          marginTop: 14,
          background: `linear-gradient(135deg, ${accent}12 0%, rgba(4,10,22,0.9) 100%)`,
          border: `1px solid ${accent}40`,
          borderRadius: 12,
          padding: "18px 20px",
          position: "relative",
        }}>
          <div style={{ position: "absolute", left: 0, top: "12%", bottom: "12%", width: 3, borderRadius: 3, background: `linear-gradient(180deg, transparent, ${accent}, transparent)` }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>💡</span>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.2em", color: accent, textTransform: "uppercase", fontWeight: 800 }}>
                AI Analysis
              </span>
              {es.loading && (
                <span style={{ fontFamily: MONO, fontSize: 9, color: "rgba(150,175,190,0.5)", letterSpacing: "0.1em" }}>
                  GENERATING…
                </span>
              )}
            </div>
            <button onClick={() => setShowExplain(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(150,175,190,0.5)", fontSize: 18, lineHeight: 1, padding: "0 2px" }}>×</button>
          </div>

          {aiText ? (
            <p style={{ fontSize: 14, color: "rgba(220,230,240,0.9)", lineHeight: 1.8, fontWeight: 500 }}>
              {aiText}
              {es.loading && <span style={{ opacity: 0.4 }}>▍</span>}
            </p>
          ) : es.loading ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 0" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: accent, opacity: 0.6, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "rgba(150,175,190,0.5)", fontStyle: "italic" }}>
              {es.error ? `Could not load explanation: ${es.error}` : "No explanation available."}
            </p>
          )}

          {signal.description && !es.loading && (
            <p style={{ fontSize: 12, color: "rgba(150,175,190,0.55)", marginTop: 10, lineHeight: 1.65, paddingTop: 10, borderTop: `1px solid ${accent}20` }}>
              <strong style={{ color: accent, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em" }}>HOW IT&apos;S MEASURED:</strong><br />
              {signal.description}
            </p>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{transform:scale(1);opacity:0.4} 50%{transform:scale(1.4);opacity:1} }
      `}</style>
    </div>
  );
}
