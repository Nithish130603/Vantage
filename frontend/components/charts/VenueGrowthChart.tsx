"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const MONO = "var(--font-geist-mono, monospace)";
const SERIF = "var(--font-fraunces, serif)";

interface DataPoint {
  month: string;
  created?: number;
  closed?: number;
  net?: number;
  count?: number;
}

interface Props {
  data: DataPoint[];
}

export default function VenueGrowthChart({ data }: Props) {
  const option = useMemo(() => {
    const months = data.map((d) => d.month);
    const opened = data.map((d) => d.created ?? d.count ?? 0);
    const closed = data.map((d) => d.closed != null ? -(d.closed) : null);
    const net = data.map((d) => d.net ?? null);
    const hasOpened = opened.some((v) => v > 0);
    const hasClosed = closed.some((v) => v != null && v < 0);
    const hasNet = net.some((v) => v != null);

    const series = [];

    if (hasOpened) {
      series.push({
        name: "Opened",
        type: "bar",
        stack: "venues",
        data: opened,
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(13,197,204,0.92)" },
              { offset: 1, color: "rgba(13,197,204,0.28)" },
            ],
          },
        },
        emphasis: { itemStyle: { color: "rgba(13,197,204,1)" } },
        barMaxWidth: 20,
      });
    }

    if (hasClosed) {
      series.push({
        name: "Closed",
        type: "bar",
        stack: "venues",
        data: closed,
        itemStyle: {
          borderRadius: [0, 0, 3, 3],
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(224,85,85,0.30)" },
              { offset: 1, color: "rgba(224,85,85,0.85)" },
            ],
          },
        },
        emphasis: { itemStyle: { color: "rgba(224,85,85,1)" } },
        barMaxWidth: 20,
      });
    }

    if (hasNet) {
      series.push({
        name: "Net Change",
        type: "line",
        data: net,
        smooth: 0.3,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: {
          color: "#E8C547",
          width: 2.5,
          shadowColor: "#E8C54780",
          shadowBlur: 14,
        },
        itemStyle: {
          color: "#E8C547",
          borderColor: "rgba(4,10,22,0.9)",
          borderWidth: 2.5,
        },
        z: 10,
      });
    }

    return {
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 1000,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "rgba(4,10,22,0.97)",
        borderColor: "rgba(0,210,230,0.25)",
        borderWidth: 1,
        textStyle: { color: "#F0F0F2", fontFamily: MONO, fontSize: 12 },
        formatter: (params: { seriesName: string; value: number | null; marker: string; name?: string }[]) => {
          const month = params[0]?.name ?? "";
          const lines = params.map((p) => {
            if (p.value == null) return "";
            const v = Math.abs(p.value);
            const color =
              p.seriesName === "Opened" ? "#0DC5CC"
              : p.seriesName === "Closed" ? "#E05555"
              : "#E8C547";
            return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">${p.marker}<span style="color:rgba(160,180,200,0.7)">${p.seriesName}</span><span style="color:${color};font-weight:800;margin-left:auto">${v}</span></div>`;
          }).filter(Boolean).join("");
          return `<div style="min-width:140px"><div style="color:rgba(150,175,190,0.5);font-size:10px;margin-bottom:6px;letter-spacing:0.12em">${month}</div>${lines}</div>`;
        },
      },
      legend: {
        data: ["Opened", "Closed", "Net Change"].filter((n) => {
          if (n === "Opened") return hasOpened;
          if (n === "Closed") return hasClosed;
          return hasNet;
        }),
        bottom: 0,
        textStyle: { color: "rgba(150,175,190,0.65)", fontFamily: MONO, fontSize: 10, fontWeight: 600 },
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 6,
        itemGap: 20,
      },
      grid: { left: 36, right: 16, top: 12, bottom: 40 },
      xAxis: {
        type: "category",
        data: months,
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
        axisTick: { show: false },
        axisLabel: {
          color: "rgba(150,175,190,0.5)",
          fontSize: 9,
          fontFamily: MONO,
          interval: "auto",
          showMinLabel: true,
          showMaxLabel: true,
        },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "rgba(150,175,190,0.45)", fontSize: 9, fontFamily: MONO },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)", type: "dashed" } },
      },
      series,
    };
  }, [data]);

  const last = data[data.length - 1];
  const net = last?.net ?? null;

  return (
    <div>
      <ReactECharts option={option} style={{ height: 220 }} opts={{ renderer: "svg" }} />
      {net != null && (
        <p style={{
          fontSize: 12, color: "rgba(150,175,190,0.55)", marginTop: 10,
          lineHeight: 1.65, fontWeight: 500, fontFamily: SERIF, letterSpacing: "0.04em",
        }}>
          {net > 0
            ? `↑ Net gain of ${net} venue${net !== 1 ? "s" : ""} last month — demand is growing.`
            : net < 0
              ? `↓ Net loss of ${Math.abs(net)} venue${Math.abs(net) !== 1 ? "s" : ""} last month — market contraction detected.`
              : "→ Net venue change is flat — stable market conditions."}
        </p>
      )}
    </div>
  );
}
