"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { SignalDetail } from "@/lib/api";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const MONO = "var(--font-geist-mono, monospace)";

const SIGNAL_SHORT: Record<string, string> = {
  "Fingerprint Match": "DNA Match",
  "Market Trajectory": "Trajectory",
  "Competitive Pressure": "Competition",
  "Ecosystem Diversity": "Diversity",
  "Risk Signals": "Risk",
};

const SIGNAL_ACCENT: Record<string, string> = {
  "Fingerprint Match": "#A78BFA",
  "Market Trajectory": "#34D399",
  "Competitive Pressure": "#FB923C",
  "Ecosystem Diversity": "#38BDF8",
  "Risk Signals": "#F472B6",
};

function tierLabel(s: number) {
  return s >= 0.65 ? "Strong" : s >= 0.40 ? "Moderate" : "Weak";
}

interface Props {
  signals: SignalDetail[];
}

export default function SignalRadar({ signals }: Props) {
  const option = useMemo(() => {
    const indicators = signals.map((s) => ({
      name: SIGNAL_SHORT[s.name] ?? s.name,
      max: 1,
    }));

    const values = signals.map((s) => s.score);

    return {
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 900,
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(4,10,22,0.97)",
        borderColor: "rgba(0,210,230,0.25)",
        borderWidth: 1,
        textStyle: { color: "#F0F0F2", fontFamily: MONO, fontSize: 12 },
        formatter: () => {
          const rows = signals.map((s) => {
            const accent = SIGNAL_ACCENT[s.name] ?? "#0DC5CC";
            const pct = Math.round(s.score * 100);
            const label = tierLabel(s.score);
            return `<div style="display:flex;align-items:center;gap:10px;margin-top:5px">
              <span style="width:8px;height:8px;border-radius:50%;background:${accent};flex-shrink:0;display:inline-block"></span>
              <span style="color:rgba(180,200,215,0.75);flex:1;font-size:11px">${SIGNAL_SHORT[s.name] ?? s.name}</span>
              <span style="color:${accent};font-weight:800;font-size:12px">${pct}</span>
              <span style="color:rgba(150,175,190,0.5);font-size:10px">${label}</span>
            </div>`;
          }).join("");
          return `<div style="padding:4px 2px;min-width:190px"><div style="color:rgba(150,175,190,0.5);font-size:10px;letter-spacing:0.18em;margin-bottom:8px">SIGNAL SCORES</div>${rows}</div>`;
        },
      },
      radar: {
        indicator: indicators,
        shape: "polygon",
        radius: "68%",
        center: ["50%", "54%"],
        splitNumber: 4,
        axisName: {
          color: "rgba(180,200,220,0.75)",
          fontSize: 11,
          fontFamily: MONO,
          fontWeight: 700,
        },
        axisLine: { lineStyle: { color: "rgba(0,210,230,0.12)" } },
        splitLine: { lineStyle: { color: "rgba(0,210,230,0.08)", type: "dashed" } },
        splitArea: { show: false },
      },
      series: [
        {
          type: "radar",
          data: [{ value: values, name: "Signals" }],
          lineStyle: {
            color: "#0DC5CC",
            width: 2,
            shadowColor: "#0DC5CC70",
            shadowBlur: 10,
          },
          areaStyle: {
            color: {
              type: "radial",
              x: 0.5, y: 0.5, r: 0.5,
              colorStops: [
                { offset: 0, color: "rgba(13,197,204,0.35)" },
                { offset: 1, color: "rgba(13,197,204,0.06)" },
              ],
            },
          },
          itemStyle: {
            color: "#0DC5CC",
            borderColor: "rgba(4,10,22,0.9)",
            borderWidth: 2,
          },
          symbolSize: 6,
          symbol: "circle",
          emphasis: {
            lineStyle: { width: 3 },
            areaStyle: { color: "rgba(13,197,204,0.28)" },
          },
        },
      ],
    };
  }, [signals]);

  return (
    <ReactECharts
      option={option}
      style={{ height: 280 }}
      opts={{ renderer: "svg" }}
    />
  );
}
