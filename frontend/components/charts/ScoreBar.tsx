"use client";

interface Props {
  label: string;
  value: number; // 0–1
}

export default function ScoreBar({ label, value }: Props) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.7 ? "#0D7377" : value >= 0.45 ? "#6B8FA8" : "#555566";

  return (
    <div>
      <p className="text-[10px] text-[#8B8B99] mb-1 truncate">{label}</p>
      <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-[10px] text-[#8B8B99] mt-0.5">{pct}</p>
    </div>
  );
}
