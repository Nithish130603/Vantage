"use client";

import { useEffect, useState, useMemo, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import {
  api,
  type FingerprintResponse,
  type EmbeddingPoint,
  type ScanResponse,
  TIER_COLOR,
} from "@/lib/api";
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle,
  BookmarkCheck,
  ChevronDown,
} from "lucide-react";
import { supabase, supabaseEnabled } from "@/lib/supabase";

const SaveAnalysisModal = dynamic(
  () => import("@/components/ui/SaveAnalysisModal"),
  { ssr: false }
);

// ── Stable constants ──────────────────────────────────────────────────────────

const ENTRY_MESSAGES = [
  "Analysing your locations…",
  "Building franchise DNA…",
  "Scoring suburbs across Australia…",
];

const EXIT_MESSAGES = [
  "Decoding your success pattern…",
  "Mapping high-opportunity zones…",
  "Finding your next location…",
];

const NAV_ITEMS = [
  { label: "Dashboard", active: false, path: "/setup",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg> },
  { label: "Insights", active: true, path: "/dna",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polyline points="1,11 5,6 8,9 14,3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="10,3 14,3 14,7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { label: "Exact Matches", active: false, path: "/map",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" strokeWidth="1.1"/><line x1="6.5" y1="4.5" x2="6.5" y2="8.5" stroke="currentColor" strokeWidth="1.1"/></svg> },
  { label: "Recommendations", active: false, path: "/recommendations",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polygon points="7.5,1 9.5,5.5 14.5,6 11,9.5 12,14.5 7.5,12 3,14.5 4,9.5 0.5,6 5.5,5.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg> },
  { label: "Avoid Zones", active: false, path: "/map",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.2"/><line x1="3" y1="3" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
];

// ── World map canvas (fixed decorative background) ────────────────────────────

function WorldMapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    let scanY = 0;
    const CITIES = [
      { x: 0.14, y: 0.38 }, { x: 0.12, y: 0.35 }, { x: 0.06, y: 0.38 },
      { x: 0.47, y: 0.28 }, { x: 0.50, y: 0.26 }, { x: 0.52, y: 0.30 },
      { x: 0.55, y: 0.24 }, { x: 0.65, y: 0.32 }, { x: 0.72, y: 0.27 },
      { x: 0.77, y: 0.30 }, { x: 0.76, y: 0.38 }, { x: 0.73, y: 0.47 },
      { x: 0.80, y: 0.55 }, { x: 0.85, y: 0.62 }, { x: 0.84, y: 0.60 },
      { x: 0.86, y: 0.58 }, { x: 0.24, y: 0.55 }, { x: 0.13, y: 0.48 },
    ];
    const ARCS: [number, number][] = [
      [7, 8], [8, 9], [9, 10], [10, 11], [11, 13],
      [4, 5], [5, 7], [0, 4], [1, 2], [0, 17],
      [13, 14], [14, 15], [6, 8], [3, 4], [12, 13],
    ];
    function resize() {
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();
    function draw(t: number) {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const W = canvas.width, H = canvas.height;
      ARCS.forEach(([a, b]) => {
        const c1 = CITIES[a], c2 = CITIES[b];
        const x1 = c1.x * W, y1 = c1.y * H, x2 = c2.x * W, y2 = c2.y * H;
        const cx = (x1 + x2) / 2, cy = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.28;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.strokeStyle = "rgba(0,210,230,0.07)"; ctx.lineWidth = 0.8; ctx.stroke();
      });
      CITIES.forEach((c, i) => {
        const x = c.x * W, y = c.y * H;
        const isAU = i >= 12 && i <= 15;
        const pulse = 0.5 + 0.5 * Math.sin(t / 1100 + i * 0.65);
        ctx.beginPath(); ctx.arc(x, y, isAU ? 3.5 : 1.8, 0, Math.PI * 2);
        ctx.fillStyle = isAU ? `rgba(0,210,230,${0.55 + pulse * 0.35})` : `rgba(0,210,230,${0.12 + pulse * 0.12})`;
        ctx.fill();
        if (isAU) {
          ctx.beginPath(); ctx.arc(x, y, 8 + pulse * 4, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0,210,230,${0.12 * pulse})`; ctx.lineWidth = 1; ctx.stroke();
        }
      });
      scanY = (scanY + 0.25) % H;
      const grad = ctx.createLinearGradient(0, scanY - 50, 0, scanY + 12);
      grad.addColorStop(0, "rgba(0,210,230,0)"); grad.addColorStop(1, "rgba(0,210,230,0.05)");
      ctx.fillStyle = grad; ctx.fillRect(0, scanY - 50, W, 62);
      animId = requestAnimationFrame(draw);
    }
    animId = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(canvas);
    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, []);
  return (
    <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.2, zIndex: 0 }} />
  );
}

// ── Radar canvas (for transition overlays) ────────────────────────────────────

function RadarCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let animId: number;
    const start = Date.now();
    const pts = Array.from({ length: 28 }, (_, i) => ({
      r: 0.18 + (Math.sin(i * 127.3) * 0.5 + 0.5) * 0.72,
      a: (i / 28) * Math.PI * 2 + Math.sin(i * 31.7) * 0.8,
      s: 1.5 + Math.abs(Math.sin(i * 53.1)) * 2.5,
    }));
    function draw() {
      if (!canvas || !ctx) return;
      const W = canvas.width, H = canvas.height;
      const cx = W / 2, cy = H / 2;
      const maxR = Math.min(W, H) * 0.42;
      const elapsed = (Date.now() - start) / 1000;
      const sweep = elapsed * Math.PI * 0.7;
      ctx.clearRect(0, 0, W, H);
      // Concentric rings
      [0.25, 0.5, 0.75, 1].forEach((f, i) => {
        ctx.beginPath(); ctx.arc(cx, cy, f * maxR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,210,230,${0.04 + i * 0.02})`; ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
      });
      // Radial lines
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
        ctx.strokeStyle = "rgba(0,210,230,0.04)"; ctx.lineWidth = 0.5; ctx.stroke();
      }
      // Sweep arc
      const sweepW = Math.PI / 2.2;
      ctx.save(); ctx.translate(cx, cy);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, maxR, sweep - sweepW, sweep); ctx.closePath();
      const sg = ctx.createLinearGradient(
        Math.cos(sweep - sweepW) * maxR * 0.5, Math.sin(sweep - sweepW) * maxR * 0.5,
        Math.cos(sweep) * maxR * 0.5, Math.sin(sweep) * maxR * 0.5
      );
      sg.addColorStop(0, "rgba(0,210,230,0)"); sg.addColorStop(1, "rgba(0,210,230,0.14)");
      ctx.fillStyle = sg; ctx.fill(); ctx.restore();
      // Leading edge
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweep) * maxR, cy + Math.sin(sweep) * maxR);
      ctx.strokeStyle = "rgba(0,210,230,0.9)"; ctx.lineWidth = 1.5; ctx.stroke();
      // Data points
      pts.forEach((p) => {
        const px = cx + Math.cos(p.a) * p.r * maxR;
        const py = cy + Math.sin(p.a) * p.r * maxR;
        let diff = (sweep % (Math.PI * 2)) - p.a;
        if (diff < 0) diff += Math.PI * 2;
        let alpha = diff < 0.12 ? diff / 0.12 : Math.max(0, 1 - (diff - 0.12) / (Math.PI * 1.4));
        alpha = Math.max(0, Math.min(1, alpha));
        if (alpha > 0.03) {
          ctx.beginPath(); ctx.arc(px, py, p.s, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,210,230,${alpha * 0.88})`; ctx.fill();
        }
      });
      // Center glow + dot
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
      glow.addColorStop(0, "rgba(0,210,230,0.3)"); glow.addColorStop(1, "rgba(0,210,230,0)");
      ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,210,230,1)"; ctx.fill();
      animId = requestAnimationFrame(draw);
    }
    function resize() { if (!canvas) return; canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; }
    resize();
    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);
  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

// ── Transition overlay (entry + exit) ─────────────────────────────────────────

function TransitionOverlay({ messages, totalMs, onDone }: { messages: string[]; totalMs: number; onDone: () => void }) {
  const [phase, setPhase] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const step = Math.floor(totalMs / messages.length);
    const timers: ReturnType<typeof setTimeout>[] = [];
    messages.forEach((_, i) => { if (i > 0) timers.push(setTimeout(() => setPhase(i), step * i)); });
    timers.push(setTimeout(() => doneRef.current(), totalMs));
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.45 }}
      style={{ position: "fixed", inset: 0, zIndex: 200, backgroundColor: "#020509", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28 }}
    >
      {/* Corner brackets */}
      {([
        { top: 22, left: 22, borderTop: "1px solid rgba(0,210,230,0.4)", borderLeft: "1px solid rgba(0,210,230,0.4)" },
        { top: 22, right: 22, borderTop: "1px solid rgba(0,210,230,0.4)", borderRight: "1px solid rgba(0,210,230,0.4)" },
        { bottom: 22, left: 22, borderBottom: "1px solid rgba(0,210,230,0.4)", borderLeft: "1px solid rgba(0,210,230,0.4)" },
        { bottom: 22, right: 22, borderBottom: "1px solid rgba(0,210,230,0.4)", borderRight: "1px solid rgba(0,210,230,0.4)" },
      ] as React.CSSProperties[]).map((s, i) => (
        <div key={i} style={{ position: "absolute", width: 22, height: 22, ...s }} />
      ))}

      {/* Radar */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        style={{ width: 230, height: 230 }}
      >
        <RadarCanvas />
      </motion.div>

      {/* Label */}
      <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(0,210,230,0.4)", marginTop: -8 }}>
        VANTAGE · INTELLIGENCE
      </p>

      {/* Cycling message */}
      <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <AnimatePresence mode="wait">
          <motion.p
            key={phase}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.38 }}
            style={{ fontFamily: "var(--font-fraunces)", fontSize: 30, fontWeight: 400, color: "#F0F0F2", textAlign: "center", maxWidth: 460, lineHeight: 1.3 }}
          >
            {messages[phase]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Progress bar */}
      <div style={{ width: 320, height: 2, background: "rgba(0,210,230,0.08)", borderRadius: 1, overflow: "hidden" }}>
        <motion.div
          initial={{ width: "0%" }} animate={{ width: "100%" }}
          transition={{ duration: totalMs / 1000, ease: "linear" }}
          style={{ height: "100%", background: "rgba(0,210,230,0.85)", borderRadius: 1 }}
        />
      </div>

      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.13)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.1em" }}>
        Data-science driven · Foursquare 100M places
      </p>
    </motion.div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function VantageSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const router = useRouter();
  return (
    <motion.aside
      animate={{ width: open ? 218 : 60 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="relative z-10 flex flex-col shrink-0 overflow-hidden"
      style={{ borderRight: "1px solid rgba(0,210,230,0.1)", background: "linear-gradient(180deg, rgba(2,7,14,0.98) 0%, rgba(2,5,10,0.98) 100%)", backdropFilter: "blur(10px)" }}
    >
      {/* Logo + toggle */}
      <div className="flex items-center px-3.5 py-5 shrink-0"
        style={{ borderBottom: "1px solid rgba(0,210,230,0.09)", justifyContent: open ? "space-between" : "center" }}>
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
              className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded flex items-center justify-center shrink-0"
                style={{ background: "rgba(0,210,230,0.1)", border: "1px solid rgba(0,210,230,0.3)" }}>
                <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="2" fill="#0DC5CC"/>
                  <circle cx="6" cy="6" r="5" stroke="#0DC5CC" strokeWidth="0.8" strokeDasharray="2 1.5"/>
                </svg>
              </div>
              <div>
                <p style={{ fontSize: 13, letterSpacing: "0.15em", color: "#FFFFFF", textTransform: "uppercase", lineHeight: 1, fontWeight: 700 }}>Vantage</p>
                <p style={{ fontSize: 10, letterSpacing: "0.12em", marginTop: 3, color: "#0DC5CC", fontWeight: 600 }}>Intelligence</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!open && (
          <div className="w-7 h-7 rounded flex items-center justify-center"
            style={{ background: "rgba(0,210,230,0.1)", border: "1px solid rgba(0,210,230,0.3)" }}>
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="2" fill="#0DC5CC"/>
              <circle cx="6" cy="6" r="5" stroke="#0DC5CC" strokeWidth="0.8" strokeDasharray="2 1.5"/>
            </svg>
          </div>
        )}
        {open && (
          <button onClick={() => onToggle()}
            className="w-7 h-7 rounded flex items-center justify-center transition-all"
            style={{ color: "rgba(0,210,230,0.4)", border: "1px solid rgba(0,210,230,0.14)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#0DC5CC"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.4)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(0,210,230,0.4)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.14)"; }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 2L4 5.5 7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>

      {/* Expand button (collapsed) */}
      {!open && (
        <button onClick={() => onToggle()} className="flex items-center justify-center mx-auto mt-3 w-8 h-8 rounded transition-all"
          style={{ color: "rgba(0,210,230,0.5)", border: "1px solid rgba(0,210,230,0.18)", background: "rgba(0,210,230,0.04)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#0DC5CC"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.45)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(0,210,230,0.5)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.18)"; }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M4 2l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}

      {/* Nav label */}
      {open && (
        <p className="px-5 pt-5 pb-2" style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(0,210,230,0.7)", fontWeight: 700 }}>
          Navigation
        </p>
      )}

      {/* Nav items */}
      <nav className="flex-1 px-2 space-y-0.5 mt-1">
        {NAV_ITEMS.map((item) => (
          <div key={item.label}
            onClick={() => router.push(item.path)}
            className="flex items-center rounded-sm transition-all duration-150 cursor-pointer"
            style={{
              gap: open ? 10 : 0, justifyContent: open ? "flex-start" : "center",
              padding: open ? "9px 10px" : "9px 0",
              background: item.active ? "rgba(0,210,230,0.08)" : "transparent",
              borderLeft: item.active && open ? "2px solid rgba(0,210,230,0.7)" : "2px solid transparent",
              color: item.active ? "#0DC5CC" : "rgba(200,230,235,0.85)",
            }}>
            <span style={{ opacity: item.active ? 1 : 0.65, flexShrink: 0 }}>{item.icon}</span>
            <AnimatePresence>
              {open && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.1 }}
                  style={{ fontSize: 14, letterSpacing: "0.04em", whiteSpace: "nowrap", fontWeight: item.active ? 700 : 600 }}>
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
            {item.active && open && (
              <motion.div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0DC5CC" }}
                animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }} />
            )}
          </div>
        ))}
      </nav>

      {/* System status */}
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="px-3 py-2.5 mx-3 mb-3 rounded-sm"
            style={{ background: "rgba(0,210,230,0.04)", border: "1px solid rgba(0,210,230,0.1)", cursor: "pointer" }}
            onClick={() => router.push("/profile")}>
            <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,210,230,0.75)", marginBottom: 6, fontWeight: 700 }}>User Profile</p>
            <div className="flex items-center gap-2">
              <motion.div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0DC5CC" }}
                animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
              <span style={{ fontSize: 12, letterSpacing: "0.04em", color: "#0DC5CC", fontWeight: 600 }}>View profile →</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

// ── Animated score bar ────────────────────────────────────────────────────────

function ScoreBar({ value, color = "rgba(0,210,230,0.75)" }: { value: number; color?: string }) {
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
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
      <div ref={ref} className="h-full rounded-full" style={{ backgroundColor: color }} />
    </div>
  );
}

// ── Tier count row ────────────────────────────────────────────────────────────

function TierStat({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs flex-1" style={{ color: "rgba(200,210,218,0.85)", fontWeight: 500 }}>{label}</span>
      <span className="text-xs font-mono shrink-0" style={{ color: "rgba(0,210,230,0.85)", fontFamily: "var(--font-geist-mono)", fontWeight: 600 }}>
        {count.toLocaleString()}
      </span>
    </div>
  );
}

// ── Insight card ──────────────────────────────────────────────────────────────

function InsightCard({ label, children, explainer, delay = 0, colSpan = 1 }: {
  label: string; children: React.ReactNode; explainer?: string; delay?: number; colSpan?: 1 | 2;
}) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{
        gridColumn: colSpan === 2 ? "1 / -1" : undefined,
        background: "rgba(4,8,16,0.82)",
        border: "1px solid rgba(0,210,230,0.1)",
        borderRadius: 16,
        padding: "20px 22px",
        backdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <p style={{ fontSize: 9, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(0,210,230,0.6)", fontFamily: "var(--font-geist-mono)" }}>
        {label}
      </p>
      {children}
      {explainer && (
        <div>
          <button onClick={() => setOpen(!open)}
            className="flex items-center gap-1 transition-colors"
            style={{ fontSize: 11, color: open ? "rgba(0,210,230,0.6)" : "rgba(255,255,255,0.22)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 500 }}>
            <ChevronDown size={10} style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
            <span style={{ marginLeft: 4 }}>What does this mean?</span>
          </button>
          {open && (
            <p style={{ fontSize: 12, color: "rgba(190,200,212,0.7)", lineHeight: 1.7, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(0,210,230,0.07)", fontWeight: 400 }}>
              {explainer}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────

function DnaContent() {
  const router = useRouter();

  // ── All state (no hooks after conditional returns) ──
  const [fp, setFp]                   = useState<FingerprintResponse | null>(null);
  const [category, setCategory]       = useState("Gym & Fitness");
  const [embedding, setEmbedding]     = useState<EmbeddingPoint[]>([]);
  const [scanData, setScanData]       = useState<ScanResponse | null>(null);
  const [showSave, setShowSave]       = useState(false);
  const [isLoggedIn, setIsLoggedIn]   = useState(false);
  const [region, setRegion]           = useState("All Australia");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showEntry, setShowEntry]     = useState(false);
  const [showExit, setShowExit]       = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem("vantage_dna_entry_played")) {
      setShowEntry(true);
    }
  }, []);

  useEffect(() => {
    if (!supabaseEnabled) return;
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem("vantage_dna");
    const cat    = sessionStorage.getItem("vantage_category") ?? "Gym & Fitness";
    const rgn    = sessionStorage.getItem("vantage_region") ?? "All Australia";
    setCategory(cat); setRegion(rgn);
    let parsedFp: FingerprintResponse | null = null;
    if (stored) {
      try { parsedFp = JSON.parse(stored) as FingerprintResponse; setFp(parsedFp); } catch { /* noop */ }
    }
    api.embedding(cat).then(setEmbedding).catch(() => {});
    api.scan(cat, {
      successVector:  parsedFp?.success_vector             ?? undefined,
      failureVector:  parsedFp?.failure_vector             ?? undefined,
      clientMeanGold: parsedFp?.client_mean_gold_similarity ?? undefined,
    }).then(setScanData).catch(() => {});
  }, []);

  const tierCounts = useMemo(() => {
    if (scanData) return scanData.tier_counts as Record<string, number>;
    const counts: Record<string, number> = { BETTER_THAN_BEST: 0, STRONG: 0, WATCH: 0, AVOID: 0 };
    embedding.forEach((p) => { if (p.tier) counts[p.tier] = (counts[p.tier] ?? 0) + 1; });
    return counts;
  }, [scanData, embedding]);

  const totalSuburbs = scanData?.total ?? embedding.length;
  const goldCount    = scanData?.better_than_best_count ?? (tierCounts.BETTER_THAN_BEST ?? 0);
  const avoidCount   = tierCounts.AVOID ?? 0;

  // ── No data guard (after all hooks) ──
  if (!fp) {
    return (
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", backgroundColor: "#020509" }}>
        <WorldMapCanvas />
        <VantageSidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.3)" }}>
            No data found.{" "}
            <button onClick={() => router.push("/setup")} style={{ color: "rgba(0,210,230,0.75)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}>
              Start over
            </button>
          </p>
        </div>
      </div>
    );
  }

  const isFresh         = fp.mode === "fresh" || fp.n_locations === 0;
  const topCats         = fp.top_categories.slice(0, 3);
  const confidenceColor = { HIGH: "rgba(0,210,230,0.9)", MEDIUM: "#D4A017", LOW: "#C0392B" }[fp.data_confidence] ?? "rgba(150,150,160,0.7)";
  const dnaDrivers      = topCats.map((c) => c.category).join(", ");
  const successSummary  = isFresh
    ? `Across Australia, top-performing ${category.toLowerCase()} businesses are consistently found near ${dnaDrivers || "high-footfall commercial areas"}.`
    : fp.n_locations >= 1
    ? `Your strongest locations share a clear pattern: they're near ${dnaDrivers || "similar commercial environments"}. This is your franchise DNA.`
    : "";
  const rawHint   = fp.improvement_hint ?? "";
  const plainHint = rawHint
    .replace(/Gold standard locations have more:/i, `Successful ${category.toLowerCase()} businesses are typically surrounded by more:`)
    .replace(/Your DNA closely matches the gold standard/i, "Your location profile closely matches the industry benchmark");

  function handleExplore() {
    if (sessionStorage.getItem("vantage_dna_exit_played")) {
      router.push(`/map?category=${encodeURIComponent(category)}`);
    } else {
      setShowExit(true);
    }
  }
  function onExitDone() {
    sessionStorage.setItem("vantage_dna_exit_played", "1");
    router.push(`/map?category=${encodeURIComponent(category)}`);
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", backgroundColor: "#020509" }}>
      <WorldMapCanvas />

      {/* ── Transition overlays ── */}
      <AnimatePresence>
        {showEntry && (
          <TransitionOverlay key="entry" messages={ENTRY_MESSAGES} totalMs={2500} onDone={() => {
            sessionStorage.setItem("vantage_dna_entry_played", "1");
            setShowEntry(false);
          }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showExit && (
          <TransitionOverlay key="exit" messages={EXIT_MESSAGES} totalMs={2700} onDone={onExitDone} />
        )}
      </AnimatePresence>

      {/* ── Sidebar ── */}
      <VantageSidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      {/* ── Main scrollable content ── */}
      <div style={{ flex: 1, overflowY: "auto", position: "relative", zIndex: 1 }}>

        {/* Corner brackets (scoped to content area) */}
        <div style={{ position: "fixed", top: 16, right: 16, width: 20, height: 20, borderTop: "1px solid rgba(0,210,230,0.25)", borderRight: "1px solid rgba(0,210,230,0.25)", pointerEvents: "none", zIndex: 2 }} />
        <div style={{ position: "fixed", bottom: 16, right: 16, width: 20, height: 20, borderBottom: "1px solid rgba(0,210,230,0.25)", borderRight: "1px solid rgba(0,210,230,0.25)", pointerEvents: "none", zIndex: 2 }} />

        <div style={{ maxWidth: 980, margin: "0 auto", padding: "36px 32px 72px" }}>

          {/* ── Header ── */}
          <motion.div
            initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
            style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 32 }}
          >
            <div>
              <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(0,210,230,0.65)", marginBottom: 10 }}>
                Vantage · Step 2 of 3 · Your Results
              </p>
              <h1 style={{ fontFamily: "var(--font-fraunces)", fontSize: 40, fontWeight: 300, color: "#F0F0F2", lineHeight: 1.15 }}>
                {isFresh ? "Industry benchmark" : "Your franchise DNA"}
              </h1>
              {totalSuburbs > 0 && (
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.28)", marginTop: 6, fontWeight: 400 }}>
                  {totalSuburbs.toLocaleString()} Australian suburbs analysed for {category}
                </p>
              )}
            </div>

            {/* Hero % */}
            <motion.div
              initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.65, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              style={{ textAlign: "right", flexShrink: 0, marginLeft: 32 }}
            >
              <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 88, fontWeight: 300, color: "rgba(0,210,230,0.92)", lineHeight: 1, textShadow: "0 0 48px rgba(0,210,230,0.22)" }}>
                {fp.gold_standard_match_pct}%
              </p>
              <p style={{ fontSize: 9, fontFamily: "var(--font-geist-mono)", letterSpacing: "0.2em", color: "rgba(255,255,255,0.22)", marginTop: 6, fontWeight: 600 }}>
                BENCHMARK MATCH
              </p>
            </motion.div>
          </motion.div>

          {/* ── Summary strip ── */}
          {successSummary && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.25 }}
              style={{ marginBottom: 28, padding: "14px 20px", borderRadius: 12, background: "rgba(0,210,230,0.04)", border: "1px solid rgba(0,210,230,0.14)", borderLeft: "3px solid rgba(0,210,230,0.5)" }}
            >
              <p style={{ fontSize: 15, color: "rgba(215,222,230,0.9)", lineHeight: 1.72, fontWeight: 400 }}>
                {successSummary}
              </p>
            </motion.div>
          )}

          {/* ── Cards grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            {/* DNA Fingerprint */}
            {topCats.length > 0 && (
              <InsightCard
                label="Your success DNA"
                delay={0.3}
                explainer={`These are the types of businesses most commonly found near your best locations. When a suburb has lots of these nearby, it's a strong signal it could work well for your ${category.toLowerCase()}.`}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                  {topCats.map((tc) => (
                    <div key={tc.category}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 14, color: "rgba(235,240,245,0.92)", fontWeight: 500 }}>{tc.category}</span>
                        <span style={{ fontSize: 12, fontFamily: "var(--font-geist-mono)", color: "rgba(0,210,230,0.85)", fontWeight: 600 }}>
                          {(tc.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      <ScoreBar value={tc.weight * 100} />
                    </div>
                  ))}
                  <p style={{ fontSize: 12, color: "rgba(150,162,175,0.65)", lineHeight: 1.55, marginTop: 2 }}>
                    Strength of each signal in predicting {isFresh ? "industry" : "your"} success.
                  </p>
                </div>
              </InsightCard>
            )}

            {/* Suburb breakdown */}
            {totalSuburbs > 0 && (
              <InsightCard
                label="Where to look in Australia"
                delay={0.35}
                explainer="We scored every Australian suburb based on how closely it matches your DNA. 'Top opportunities' are the ones most likely to succeed. 'Avoid' areas have risk factors like high closure rates or oversaturation."
              >
                <div>
                  <TierStat color={TIER_COLOR.BETTER_THAN_BEST} label="Top opportunities — outperform the benchmark" count={tierCounts.BETTER_THAN_BEST ?? 0} />
                  <TierStat color={TIER_COLOR.STRONG} label="Strong — solid expansion candidates" count={tierCounts.STRONG ?? 0} />
                  <TierStat color={TIER_COLOR.WATCH} label="Watch — proceed with caution" count={tierCounts.WATCH ?? 0} />
                  <TierStat color={TIER_COLOR.AVOID} label="Avoid — risk signals elevated" count={avoidCount} />
                  {goldCount > 0 && (
                    <p style={{ fontSize: 12, color: "rgba(0,210,230,0.72)", marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(0,210,230,0.08)", lineHeight: 1.55, fontWeight: 500 }}>
                      ★ {goldCount} suburb{goldCount !== 1 ? "s" : ""} beat the gold standard — your clearest first-mover opportunities.
                    </p>
                  )}
                </div>
              </InsightCard>
            )}

            {/* Benchmark detail */}
            <InsightCard
              label="How you compare to the best"
              delay={0.4}
              explainer={`We compared your profile against Australia's top-performing ${category.toLowerCase()} businesses. Above 70% means your locations are in environments very similar to the best in the country.`}
            >
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 4 }}>
                <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 56, fontWeight: 300, color: "rgba(0,210,230,0.92)", lineHeight: 1 }}>
                  {fp.gold_standard_match_pct}%
                </p>
                <span style={{ fontSize: 9, fontFamily: "var(--font-geist-mono)", letterSpacing: "0.14em", padding: "3px 8px", borderRadius: 3, border: `1px solid ${confidenceColor}40`, color: confidenceColor, backgroundColor: `${confidenceColor}12`, marginBottom: 7, fontWeight: 600 }}>
                  {fp.data_confidence} CONFIDENCE
                </span>
              </div>
              <ScoreBar value={fp.gold_standard_match_pct} />
              {plainHint && (
                <p style={{ fontSize: 12, color: "rgba(165,175,188,0.78)", marginTop: 12, lineHeight: 1.65, fontWeight: 400 }}>
                  {plainHint}
                </p>
              )}
            </InsightCard>

            {/* Locations used */}
            <InsightCard
              label="Locations used in this analysis"
              delay={0.4}
              explainer="These are the exact locations we used to build your DNA. The more you add, the more accurate your results."
            >
              {fp.n_locations >= 1 && fp.n_locations <= 4 && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, paddingBottom: 12, marginBottom: 4, borderBottom: "1px solid rgba(0,210,230,0.07)" }}>
                  <CheckCircle size={13} style={{ color: "rgba(0,210,230,0.65)", marginTop: 1, flexShrink: 0 }} />
                  <p style={{ fontSize: 12, color: "rgba(175,185,195,0.88)", lineHeight: 1.65, fontWeight: 400 }}>
                    Based on{" "}
                    <span style={{ color: "rgba(240,242,245,0.92)", fontWeight: 600 }}>
                      {fp.n_locations} location{fp.n_locations > 1 ? "s" : ""}
                    </span>{" "}
                    — blended with industry data for reliability.
                  </p>
                </div>
              )}
              {Object.keys(fp.resolved_suburbs ?? {}).length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(fp.resolved_suburbs).map(([input, resolved]) => (
                    <span key={input} style={{ fontSize: 10, fontFamily: "var(--font-geist-mono)", padding: "3px 9px", borderRadius: 4, border: "1px solid rgba(0,210,230,0.22)", color: "rgba(0,210,230,0.84)", background: "rgba(0,210,230,0.05)", fontWeight: 500 }}>
                      {input.toLowerCase() !== resolved.split(",")[0].toLowerCase() ? `${input} → ${resolved} ✓` : `${resolved} ✓`}
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: "rgba(140,150,162,0.55)", fontWeight: 400 }}>Using industry benchmark data — no custom locations added.</p>
              )}
              {fp.unrecognised_suburbs.length > 0 && (
                <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(212,160,23,0.07)", borderRadius: 6, border: "1px solid rgba(212,160,23,0.2)" }}>
                  <p style={{ fontSize: 11, color: "#D4A017", lineHeight: 1.55, fontWeight: 500 }}>
                    <span style={{ fontWeight: 600 }}>Could not find:</span>{" "}
                    {fp.unrecognised_suburbs.join(", ")}
                    <span style={{ display: "block", color: "rgba(212,160,23,0.55)", marginTop: 3, fontWeight: 400 }}>
                      Try the full suburb name (e.g. &quot;Surry Hills&quot;)
                    </span>
                  </p>
                </div>
              )}
            </InsightCard>

            {/* Failure pattern — full width, conditional */}
            {fp.failure_summary && (
              <InsightCard
                label="Locations to avoid"
                delay={0.45}
                colSpan={2}
                explainer="These patterns come from your underperforming locations. We flag any suburb that looks similar so you don't repeat the same mistakes."
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <AlertTriangle size={15} style={{ color: "#D4A017", marginTop: 2, flexShrink: 0 }} />
                  <p style={{ fontSize: 14, color: "rgba(210,200,178,0.9)", lineHeight: 1.72, fontWeight: 400 }}>{fp.failure_summary}</p>
                </div>
              </InsightCard>
            )}

            {/* Blending note — full width, conditional */}
            {fp.n_locations >= 1 && fp.n_locations <= 4 && !fp.failure_summary && (
              <InsightCard label="Data reliability note" delay={0.45} colSpan={2}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <CheckCircle size={14} style={{ color: "rgba(0,210,230,0.65)", marginTop: 2, flexShrink: 0 }} />
                  <p style={{ fontSize: 13, color: "rgba(180,192,205,0.85)", lineHeight: 1.7, fontWeight: 400 }}>
                    With{" "}
                    <span style={{ color: "rgba(240,242,245,0.92)", fontWeight: 600 }}>
                      {fp.n_locations} location{fp.n_locations > 1 ? "s" : ""}
                    </span>
                    , your DNA has been blended with industry benchmark data to ensure reliability. Adding more locations will sharpen the analysis.
                  </p>
                </div>
              </InsightCard>
            )}
          </div>

          {/* ── CTA row ── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.55 }}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 28 }}
          >
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", fontFamily: "var(--font-geist-mono)", fontWeight: 500 }}>
              {totalSuburbs > 0 ? `${totalSuburbs.toLocaleString()} suburbs scored · ${region}` : region}
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              {isLoggedIn && (
                <button
                  onClick={() => setShowSave(true)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 22px", borderRadius: 12, border: "1px solid rgba(0,210,230,0.22)", color: "rgba(0,210,230,0.8)", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "none", transition: "all 0.15s" }}
                >
                  <BookmarkCheck size={15} />
                  Save analysis
                </button>
              )}
              <button
                onClick={handleExplore}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 32px", borderRadius: 12, background: "rgba(0,210,230,0.1)", border: "2px solid rgba(0,210,230,0.5)", color: "rgba(0,210,230,0.97)", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 0 32px rgba(0,210,230,0.12)", transition: "all 0.15s", letterSpacing: "0.02em" }}
              >
                Explore opportunities
                <ArrowRight size={17} />
              </button>
            </div>
          </motion.div>
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
  );
}

export default function DnaPage() {
  return (
    <Suspense>
      <DnaContent />
    </Suspense>
  );
}
