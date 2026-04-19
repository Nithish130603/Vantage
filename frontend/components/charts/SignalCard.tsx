"use client";

import type { SignalDetail } from "@/lib/api";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  signal: SignalDetail;
  insight?: string;
}

const TEAL = "#0D7377";

function getBadgeColor(signal: SignalDetail): string {
  const s = signal.score;
  const badge = signal.badge ?? "";
  if (badge === "GROWING" || badge === "LOW" || badge === "LOW RISK") return TEAL;
  if (badge === "NARROWING" || badge === "HIGH" || badge === "HIGH RISK") return "#C0392B";
  if (badge === "STABLE" || badge === "MEDIUM" || badge === "MODERATE") return "#2A6DB5";
  // percentage badges — use score
  return s >= 0.70 ? TEAL : s >= 0.45 ? "#2A6DB5" : "#D4821A";
}

export default function SignalCard({ signal, insight }: Props) {
  const pct = Math.round(signal.score * 100);
  const labelText = signal.badge || `${pct}`;
  const labelColor = getBadgeColor(signal);

  const renderChart = () => {
    if (!signal.chart_data?.length) return null;

    if (signal.name === "Market Trajectory") {
      return (
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={signal.chart_data}>
            <XAxis dataKey="month" hide />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "#131316",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6,
                fontSize: 11,
              }}
            />
            <Line
              type="monotoneX"
              dataKey="count"
              stroke={TEAL}
              strokeWidth={2}
              dot={{ r: 2, fill: "#131316", stroke: TEAL, strokeWidth: 1.5 }}
              activeDot={{ r: 4, fill: TEAL, stroke: "#131316" }}
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (signal.name === "Risk Signals") {
      return (
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={signal.chart_data} layout="vertical">
            <XAxis type="number" hide />
            <YAxis dataKey="status" type="category" width={40} tick={{ fontSize: 10, fill: "#8B8B99" }} />
            <Tooltip
              contentStyle={{
                background: "#131316",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6,
                fontSize: 11,
              }}
            />
            <Bar dataKey="count" fill={TEAL} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // default: horizontal bar for category breakdowns
    const top5 = signal.chart_data.slice(0, 5);
    return (
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={top5} layout="vertical">
          <XAxis type="number" hide />
          <YAxis
            dataKey="category"
            type="category"
            width={80}
            tick={{ fontSize: 9, fill: "#8B8B99" }}
          />
          <Tooltip
            contentStyle={{
              background: "#131316",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              fontSize: 11,
            }}
          />
          <Bar dataKey="count" fill={TEAL} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="bg-[#131316] border border-white/8 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-[#F0F0F2]">{signal.name}</h3>
        <span
          className="text-xs font-mono font-medium tracking-wider px-2 py-0.5 rounded"
          style={{ color: labelColor, backgroundColor: `${labelColor}18` }}
        >
          {labelText}
        </span>
      </div>
      <p className="text-[10px] text-[#555566] mb-3 leading-relaxed">
        {signal.description}
      </p>

      {/* Score bar */}
      <div className="h-1 bg-white/8 rounded-full overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: labelColor }}
        />
      </div>

      {renderChart()}

      {insight && (
        <p className="text-[11px] text-[#8B8B99] leading-relaxed mt-3 pt-3 border-t border-white/6">
          {insight}
        </p>
      )}
    </div>
  );
}
