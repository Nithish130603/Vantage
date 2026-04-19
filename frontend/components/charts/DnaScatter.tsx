"use client";

import { useMemo } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
import type { EmbeddingPoint } from "@/lib/api";

interface Props {
  points: EmbeddingPoint[];
  goldH3s: Set<string>;
}

const CustomTooltip = ({
  active, payload,
}: {
  active?: boolean;
  payload?: { payload: EmbeddingPoint & { isGold: boolean } }[];
}) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-[#131316] border border-white/8 rounded-lg p-3 text-xs pointer-events-none">
      <p className="font-mono text-[#8B8B99] mb-1 text-[10px]">{p.h3_r7}</p>
      <p>{p.center_lat.toFixed(3)}, {p.center_lon.toFixed(3)}</p>
      <p className="text-[#8B8B99]">{p.venue_count} venues</p>
      {p.isGold && <p className="text-[#F5A623] mt-1 font-medium">⭐ Top DNA match</p>}
    </div>
  );
};

function Dot(props: {
  cx?: number; cy?: number;
  payload?: EmbeddingPoint & { isGold: boolean };
}) {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload) return null;
  if (payload.isGold) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={14} fill="#E8C547" opacity={0.15} />
        <circle cx={cx} cy={cy} r={8} fill="#E8C547" opacity={0.4} />
        <circle cx={cx} cy={cy} r={3.5} fill="#E8C547" />
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          fontSize={7} fill="#131316">★</text>
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={2} fill="#A0A0B0" opacity={0.15} />;
}

export default function DnaScatter({ points, goldH3s }: Props) {
  const data = useMemo(
    () => points.map((p) => ({ ...p, isGold: goldH3s.has(p.h3_r7) })),
    [points, goldH3s]
  );

  // Render regular dots first, gold stars on top
  const regular = data.filter((d) => !d.isGold);
  const gold    = data.filter((d) => d.isGold);

  return (
    <ResponsiveContainer width="100%" height={440}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
        <XAxis dataKey="umap_x" hide />
        <YAxis dataKey="umap_y" hide />
        <Tooltip content={<CustomTooltip />} />
        <Scatter
          data={regular}
          shape={(p: { cx?: number; cy?: number; payload?: EmbeddingPoint & { isGold: boolean } }) => <Dot {...p} />}
        />
        <Scatter
          data={gold}
          shape={(p: { cx?: number; cy?: number; payload?: EmbeddingPoint & { isGold: boolean } }) => <Dot {...p} />}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
