"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { EmbeddingPoint } from "@/lib/api";

interface Props {
  points: EmbeddingPoint[];
  category?: string;
  onSelect: (h3r7: string) => void;
}

function scoreToColor(score: number | null): string {
  if (score === null) return "#333344";
  if (score >= 0.75) return "#0D7377";
  if (score >= 0.55) return "#1A6B7C";
  if (score >= 0.4)  return "#2A4060";
  return "#1C1C2A";
}

// Recharts CustomDot that forwards click events
function Dot(props: {
  cx?: number;
  cy?: number;
  payload?: EmbeddingPoint;
  onSelect: (h3r7: string) => void;
}) {
  const { cx = 0, cy = 0, payload, onSelect } = props;
  if (!payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={scoreToColor(payload.score)}
      stroke="none"
      style={{ cursor: "pointer" }}
      onClick={() => onSelect(payload.h3_r7)}
    />
  );
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: EmbeddingPoint }[];
}) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-[#131316] border border-white/8 rounded-lg p-3 text-xs">
      <p className="font-mono text-[#8B8B99] mb-1">{p.h3_r7}</p>
      <p>
        {p.center_lat.toFixed(3)}, {p.center_lon.toFixed(3)}
      </p>
      <p className="text-[#8B8B99]">{p.venue_count} venues</p>
      {p.score !== null && (
        <p className="text-[#0D7377] mt-1">Score: {(p.score * 100).toFixed(0)}</p>
      )}
    </div>
  );
};

export default function UmapScatter({ points, onSelect }: Props) {
  const data = useMemo(() => points, [points]);

  return (
    <div className="flex-1 bg-[#0D0D10] border border-white/8 rounded-xl overflow-hidden min-h-[500px]">
      <ResponsiveContainer width="100%" height={560}>
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
          <XAxis dataKey="umap_x" hide />
          <YAxis dataKey="umap_y" hide />
          <Tooltip content={<CustomTooltip />} />
          <Scatter
            data={data}
            shape={(props: { cx?: number; cy?: number; payload?: EmbeddingPoint }) => (
              <Dot {...props} onSelect={onSelect} />
            )}
          >
            {data.map((entry) => (
              <Cell key={entry.h3_r7} fill={scoreToColor(entry.score)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 px-6 pb-4 text-xs text-[#8B8B99]">
        <span>Score:</span>
        {[
          { color: "#0D7377", label: "≥75" },
          { color: "#1A6B7C", label: "55–74" },
          { color: "#2A4060", label: "40–54" },
          { color: "#1C1C2A", label: "<40" },
        ].map((l) => (
          <span key={l.label} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: l.color }}
            />
            {l.label}
          </span>
        ))}
        <span className="ml-auto">Click a dot to open location report</span>
      </div>
    </div>
  );
}
