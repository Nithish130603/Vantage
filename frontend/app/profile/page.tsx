"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import { listAnalyses, type Analysis } from "@/lib/analyses";
import AuthModal from "@/components/ui/AuthModal";
import {
  ArrowRight, LogOut, Plus, Bookmark, Star,
  TrendingUp, TrendingDown, MapPin, Layers, ChevronRight, User,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "overview" | "stores" | "saved" | "insights";

interface SavedLocEntry {
  h3_r7: string;
  label: string;
  type: "recommendation" | "exact_match";
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function loadSavedH3s(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("vantage_saved") ?? "[]") as string[]; }
  catch { return []; }
}

function getSessionAnalysis(): Analysis | null {
  if (typeof window === "undefined") return null;
  try {
    const dna      = sessionStorage.getItem("vantage_dna");
    const category = sessionStorage.getItem("vantage_category");
    const region   = sessionStorage.getItem("vantage_region");
    if (!dna || !category) return null;
    return {
      id: "session",
      user_id: "local",
      name: `${category} · ${region ?? "Australia"}`,
      category: category,
      region: region ?? "All Australia",
      fingerprint_result: JSON.parse(dna),
      saved_suburbs: loadSavedH3s(),
      created_at: new Date().toISOString(),
    };
  } catch { return null; }
}

function fp(a: Analysis): Record<string, unknown> {
  return (a.fingerprint_result ?? {}) as Record<string, unknown>;
}
function getGoldPct(a: Analysis): number {
  const v = fp(a).gold_standard_match_pct;
  return typeof v === "number" ? v : 0;
}
function getDnaSummary(a: Analysis): string {
  const v = fp(a).dna_summary;
  return typeof v === "string" ? v : "";
}
function getFailureSummary(a: Analysis): string | null {
  const v = fp(a).failure_summary;
  return typeof v === "string" ? v : null;
}
function getTopCategories(a: Analysis): { category: string; weight: number }[] {
  const v = fp(a).top_categories;
  if (!Array.isArray(v)) return [];
  return (v as { category: string; weight: number }[]).slice(0, 5);
}
function getNLocations(a: Analysis): number {
  const v = fp(a).n_locations;
  return typeof v === "number" ? v : 0;
}
function getDataConfidence(a: Analysis): string {
  const v = fp(a).data_confidence;
  return typeof v === "string" ? v : "—";
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ── Animated scan-line background ─────────────────────────────────────────────

function ScanCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    let id: number; let scanY = 0;
    function resize() { if (!c) return; c.width = c.offsetWidth; c.height = c.offsetHeight; }
    resize();
    function draw() {
      if (!c || !ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      scanY = (scanY + 0.3) % c.height;
      const g = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 16);
      g.addColorStop(0, "rgba(0,210,230,0)");
      g.addColorStop(1, "rgba(0,210,230,0.03)");
      ctx.fillStyle = g; ctx.fillRect(0, scanY - 60, c.width, 76);
      id = requestAnimationFrame(draw);
    }
    id = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(c);
    return () => { cancelAnimationFrame(id); ro.disconnect(); };
  }, []);
  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}
    />
  );
}

// ── Grid particle background ──────────────────────────────────────────────────

function GridCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    let id: number;
    function resize() { if (!c) return; c.width = c.offsetWidth; c.height = c.offsetHeight; }
    resize();
    function draw() {
      if (!c || !ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const step = 48;
      ctx.strokeStyle = "rgba(0,210,230,0.03)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < c.width; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke();
      }
      for (let y = 0; y < c.height; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
      }
      id = requestAnimationFrame(draw);
    }
    id = requestAnimationFrame(draw);
    const ro = new ResizeObserver(resize); ro.observe(c);
    return () => { cancelAnimationFrame(id); ro.disconnect(); };
  }, []);
  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0, opacity: 0.5 }}
    />
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    label: "Dashboard", path: "/setup",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg>,
  },
  {
    label: "Insights", path: "/dna",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polyline points="1,11 5,6 8,9 14,3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="10,3 14,3 14,7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
  {
    label: "Exact Matches", path: "/map",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" strokeWidth="1.1"/><line x1="6.5" y1="4.5" x2="6.5" y2="8.5" stroke="currentColor" strokeWidth="1.1"/></svg>,
  },
  {
    label: "Recommendations", path: "/recommendations",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polygon points="7.5,1 9.5,5.5 14.5,6 11,9.5 12,14.5 7.5,12 3,14.5 4,9.5 0.5,6 5.5,5.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  },
  {
    label: "Avoid Zones", path: "/map",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.2"/><line x1="3" y1="3" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  },
];

function VantageSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const router = useRouter();
  return (
    <motion.aside
      animate={{ width: open ? 218 : 60 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="relative z-10 flex flex-col shrink-0 overflow-hidden"
      style={{ borderRight: "1px solid rgba(0,210,230,0.1)", background: "linear-gradient(180deg, rgba(2,7,14,0.98) 0%, rgba(2,5,10,0.98) 100%)" }}
    >
      <div
        className="flex items-center px-3.5 py-5 shrink-0"
        style={{ borderBottom: "1px solid rgba(0,210,230,0.09)", justifyContent: open ? "space-between" : "center" }}
      >
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
          <button onClick={onToggle}
            className="w-7 h-7 rounded flex items-center justify-center transition-all"
            style={{ color: "rgba(0,210,230,0.4)", border: "1px solid rgba(0,210,230,0.14)", background: "transparent" }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 2L4 5.5 7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>

      {!open && (
        <button onClick={onToggle} className="flex items-center justify-center mx-auto mt-3 w-8 h-8 rounded transition-all"
          style={{ color: "rgba(0,210,230,0.5)", border: "1px solid rgba(0,210,230,0.18)", background: "rgba(0,210,230,0.04)" }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M4 2l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}

      {open && (
        <p className="px-5 pt-5 pb-2" style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(0,210,230,0.7)", fontWeight: 700 }}>
          Navigation
        </p>
      )}

      <nav className="flex-1 px-2 space-y-0.5 mt-1">
        {NAV_ITEMS.map((item) => (
          <div key={item.label} onClick={() => router.push(item.path)}
            className="flex items-center rounded-sm transition-all duration-150 cursor-pointer"
            style={{
              gap: open ? 10 : 0, justifyContent: open ? "flex-start" : "center",
              padding: open ? "9px 10px" : "9px 0",
              background: "transparent", borderLeft: "2px solid transparent",
              color: "rgba(200,230,235,0.85)",
            }}>
            <span style={{ opacity: 0.6, flexShrink: 0 }}>{item.icon}</span>
            <AnimatePresence>
              {open && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}
                  style={{ fontSize: 14, letterSpacing: "0.04em", whiteSpace: "nowrap", fontWeight: 600 }}>
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        ))}
      </nav>

      {/* User Profile — active */}
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="px-3 py-2.5 mx-3 mb-3 rounded-sm"
            style={{ background: "rgba(0,210,230,0.08)", border: "1px solid rgba(0,210,230,0.3)" }}>
            <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#0DC5CC", marginBottom: 6, fontWeight: 700 }}>User Profile</p>
            <div className="flex items-center gap-2">
              <motion.div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0DC5CC" }}
                animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
              <span style={{ fontSize: 12, letterSpacing: "0.04em", color: "#0DC5CC", fontWeight: 600 }}>Viewing now</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = false, delay = 0 }: {
  label: string; value: string | number; sub?: string; accent?: boolean; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{
        padding: "20px", borderRadius: 2,
        background: accent ? "rgba(0,210,230,0.04)" : "rgba(2,7,14,0.85)",
        border: `1px solid ${accent ? "rgba(0,210,230,0.22)" : "rgba(0,210,230,0.08)"}`,
        display: "flex", flexDirection: "column", gap: 6,
      }}
    >
      <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: accent ? "rgba(0,210,230,0.65)" : "rgba(255,255,255,0.28)", fontWeight: 700 }}>{label}</p>
      <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 38, fontWeight: 300, color: accent ? "#0DC5CC" : "#F0F0F2", lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: "0.06em" }}>{sub}</p>}
    </motion.div>
  );
}

function TabBtn({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase",
        color: active ? "#0DC5CC" : "rgba(255,255,255,0.28)", fontWeight: 700,
        paddingBottom: 10, background: "transparent", border: "none",
        borderBottom: `2px solid ${active ? "#0DC5CC" : "transparent"}`,
        cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6,
      }}
    >
      {label}
      {count !== undefined && (
        <span style={{
          fontSize: 9, padding: "1px 5px", borderRadius: 2,
          background: active ? "rgba(0,210,230,0.15)" : "rgba(255,255,255,0.06)",
          color: active ? "#0DC5CC" : "rgba(255,255,255,0.3)",
        }}>{count}</span>
      )}
    </button>
  );
}

function ConfidencePill({ conf }: { conf: string }) {
  const color = conf === "HIGH" ? "#82B99B" : conf === "MEDIUM" ? "#E8C547" : "rgba(217,136,128,0.8)";
  return (
    <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color, letterSpacing: "0.1em",
      padding: "2px 7px", border: `1px solid ${color}30`, borderRadius: 2, fontWeight: 700 }}>
      {conf}
    </span>
  );
}

function AnalysisCard({ a, rank, isTop, router }: {
  a: Analysis; rank: number; isTop: boolean; router: ReturnType<typeof useRouter>;
}) {
  const goldPct  = getGoldPct(a);
  const topCats  = getTopCategories(a);
  const nLocs    = getNLocations(a);
  const conf     = getDataConfidence(a);
  const hasFail  = !!getFailureSummary(a);
  const isSession = a.id === "session";

  function resume() {
    if (!isSession) {
      sessionStorage.setItem("vantage_dna", JSON.stringify(a.fingerprint_result));
      sessionStorage.setItem("vantage_category", a.category);
      sessionStorage.setItem("vantage_region", a.region);
    }
    router.push("/dna");
  }

  const borderColor = isTop ? "rgba(0,210,230,0.22)" : "rgba(255,255,255,0.06)";
  const bg = isTop ? "rgba(0,210,230,0.025)" : "rgba(2,5,9,0.55)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.07, ease: [0.22, 1, 0.36, 1] }}
      style={{ border: `1px solid ${borderColor}`, background: bg, borderRadius: 2, overflow: "hidden" }}
    >
      {/* Header */}
      <div style={{ padding: "13px 16px", borderBottom: "1px solid rgba(0,210,230,0.06)", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flexShrink: 0 }}>
          {isTop
            ? <TrendingUp size={14} style={{ color: "#0DC5CC" }} />
            : hasFail
              ? <TrendingDown size={14} style={{ color: "rgba(217,136,128,0.75)" }} />
              : <Layers size={14} style={{ color: "rgba(255,255,255,0.25)" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, color: "#F0F0F2", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</p>
          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(0,210,230,0.5)", letterSpacing: "0.12em", marginTop: 3 }}>
            {a.category} · {a.region} · {fmtDate(a.created_at)}
          </p>
        </div>
        {/* DNA score ring */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 26, fontWeight: 300, color: isTop ? "#0DC5CC" : "rgba(255,255,255,0.4)", lineHeight: 1 }}>
            {goldPct.toFixed(0)}<span style={{ fontSize: 13 }}>%</span>
          </p>
          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 8, color: "rgba(255,255,255,0.18)", letterSpacing: "0.12em", marginTop: 2 }}>DNA MATCH</p>
        </div>
      </div>

      {/* Score bar */}
      <div style={{ height: 2, background: "rgba(0,210,230,0.06)" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(goldPct, 100)}%` }}
          transition={{ duration: 0.8, delay: rank * 0.07 + 0.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: "100%", background: isTop ? "#0DC5CC" : "rgba(217,136,128,0.5)" }}
        />
      </div>

      {/* Meta */}
      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <MapPin size={10} style={{ color: "rgba(0,210,230,0.4)" }} />
          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
            {nLocs > 0 ? `${nLocs} location${nLocs !== 1 ? "s" : ""}` : "Session data"}
          </span>
        </div>
        <ConfidencePill conf={conf} />
        {a.saved_suburbs.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Bookmark size={10} style={{ color: "rgba(232,197,71,0.6)" }} />
            <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(255,255,255,0.28)" }}>{a.saved_suburbs.length} saved</span>
          </div>
        )}
        <button
          onClick={resume}
          style={{
            marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px", fontFamily: "var(--font-geist-mono)", fontSize: 10,
            letterSpacing: "0.1em", color: "#0DC5CC", border: "1px solid rgba(0,210,230,0.2)",
            background: "rgba(0,210,230,0.04)", borderRadius: 2, cursor: "pointer",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,210,230,0.1)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.4)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,210,230,0.04)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.2)"; }}
        >
          Open <ArrowRight size={11} />
        </button>
      </div>

      {/* Category tags */}
      {topCats.length > 0 && (
        <div style={{ padding: "0 16px 12px", display: "flex", flexWrap: "wrap", gap: 5 }}>
          {topCats.map((c) => (
            <span key={c.category} style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.08em",
              color: "rgba(0,210,230,0.5)", border: "1px solid rgba(0,210,230,0.1)", borderRadius: 2, padding: "2px 7px" }}>
              {c.category}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function SavedCard({ entry, index }: { entry: SavedLocEntry; index: number }) {
  const isRec = entry.type === "recommendation";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      style={{
        padding: "12px 14px", borderRadius: 2,
        border: `1px solid ${isRec ? "rgba(232,197,71,0.15)" : "rgba(0,210,230,0.12)"}`,
        background: isRec ? "rgba(232,197,71,0.025)" : "rgba(0,210,230,0.025)",
        display: "flex", alignItems: "flex-start", gap: 9,
      }}
    >
      {isRec
        ? <Star size={11} style={{ color: "#E8C547", flexShrink: 0, marginTop: 2 }} />
        : <Bookmark size={11} style={{ color: "#0DC5CC", flexShrink: 0, marginTop: 2 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "#F0F0F2", wordBreak: "break-all", letterSpacing: "0.04em" }}>{entry.h3_r7}</p>
        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: isRec ? "rgba(232,197,71,0.45)" : "rgba(0,210,230,0.38)", marginTop: 3, letterSpacing: "0.05em" }}>{entry.label}</p>
      </div>
      <ChevronRight size={11} style={{ color: "rgba(255,255,255,0.12)", flexShrink: 0, marginTop: 2 }} />
    </motion.div>
  );
}

function EmptyState({ label, sub, cta, onCta }: { label: string; sub: string; cta: string; onCta: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      style={{ textAlign: "center", padding: "64px 24px", border: "1px dashed rgba(0,210,230,0.1)", borderRadius: 2 }}
    >
      <motion.div
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(0,210,230,0.05)", border: "1px solid rgba(0,210,230,0.15)", margin: "0 auto 18px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(0,210,230,0.3)" }} />
      </motion.div>
      <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 18, fontWeight: 300, color: "#F0F0F2", marginBottom: 6 }}>{label}</p>
      <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, color: "rgba(255,255,255,0.28)", marginBottom: 22, letterSpacing: "0.05em" }}>{sub}</p>
      <button onClick={onCta}
        style={{ padding: "8px 22px", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.15em",
          textTransform: "uppercase", color: "#0DC5CC", border: "1px solid rgba(0,210,230,0.25)",
          background: "rgba(0,210,230,0.06)", borderRadius: 2, cursor: "pointer" }}>
        {cta} →
      </button>
    </motion.div>
  );
}

// ── Page skeleton ─────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div style={{ padding: "28px" }}>
      <style>{`@keyframes shimmer { 0%,100%{opacity:0.4} 50%{opacity:1} }`}</style>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ height: 100, borderRadius: 2, background: "rgba(0,210,230,0.04)", border: "1px solid rgba(0,210,230,0.07)", animation: `shimmer ${1.2 + i * 0.15}s ease-in-out infinite` }} />
        ))}
      </div>
      <div style={{ height: 130, borderRadius: 2, background: "rgba(0,210,230,0.03)", border: "1px solid rgba(0,210,230,0.07)", animation: "shimmer 1.4s ease-in-out infinite" }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const [user,        setUser]        = useState<{ email?: string } | null>(null);
  const [analyses,    setAnalyses]    = useState<Analysis[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showAuth,    setShowAuth]    = useState(false);
  const [tab,         setTab]         = useState<Tab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [savedH3s,    setSavedH3s]    = useState<string[]>([]);

  // Read localStorage after mount
  useEffect(() => { setSavedH3s(loadSavedH3s()); }, []);

  const loadData = useCallback(async () => {
    const data = await listAnalyses();

    // If no persisted analyses but there's an active session, include it
    const sessionAnalysis = getSessionAnalysis();
    const merged = data.length > 0 ? data : sessionAnalysis ? [sessionAnalysis] : [];
    setAnalyses(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabaseEnabled) {
      // No Supabase — show whatever session data is available
      const sessionAnalysis = getSessionAnalysis();
      if (sessionAnalysis) setAnalyses([sessionAnalysis]);
      setLoading(false);
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser(data.user);
        loadData();
      } else {
        // Not signed in — still show session data, and offer sign-in
        const sessionAnalysis = getSessionAnalysis();
        if (sessionAnalysis) setAnalyses([sessionAnalysis]);
        setLoading(false);
        setShowAuth(true);
      }
    });
  }, [loadData]);

  async function handleSignOut() {
    if (supabaseEnabled) await supabase.auth.signOut();
    router.push("/setup");
  }

  // Derived stats
  const allAnalyses      = analyses;
  const totalLocations   = allAnalyses.reduce((s, a) => s + getNLocations(a), 0);
  const totalSaved       = allAnalyses.reduce((s, a) => s + a.saved_suburbs.length, 0) + savedH3s.length;
  const uniqueCategories = [...new Set(allAnalyses.map((a) => a.category))];
  const sortedByGold     = [...allAnalyses].sort((a, b) => getGoldPct(b) - getGoldPct(a));
  const topAnalyses      = sortedByGold.slice(0, 3);
  const lowAnalyses      = sortedByGold
    .slice()
    .reverse()
    .filter((a) => getGoldPct(a) < 60)
    .slice(0, 2);
  const highZoneCount = topAnalyses.filter((a) => getGoldPct(a) >= 60).length;

  // Saved location entries
  const savedFromAnalyses: SavedLocEntry[] = allAnalyses.flatMap((a) =>
    a.saved_suburbs.map((h3) => ({ h3_r7: h3, label: `${a.category} · ${a.region}`, type: "recommendation" as const }))
  );
  const savedLocal: SavedLocEntry[] = savedH3s.map((h3) => ({
    h3_r7: h3, label: "Exact match", type: "exact_match" as const,
  }));
  const allSaved = [...savedFromAnalyses, ...savedLocal];

  const displayName = user?.email ? user.email.split("@")[0] : "Your Portfolio";
  const bannerLine = allAnalyses.length === 0
    ? "No analyses yet — run your first scan to build your profile."
    : `You manage ${totalLocations} location${totalLocations !== 1 ? "s" : ""} across ${allAnalyses.length} ${allAnalyses.length === 1 ? "analysis" : "analyses"} — ${highZoneCount} high-performing zone${highZoneCount !== 1 ? "s" : ""} identified.`;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", backgroundColor: "#020509", position: "relative" }}>
      <GridCanvas />
      <ScanCanvas />

      {/* Corner brackets — cinematic frame */}
      {[{ top: 8, left: 8 }, { top: 8, right: 8 }, { bottom: 8, left: 8 }, { bottom: 8, right: 8 }].map((pos, i) => (
        <div key={i} style={{ position: "fixed", width: 18, height: 18, zIndex: 50, pointerEvents: "none", ...pos,
          borderTop:    i < 2   ? "1px solid rgba(0,210,230,0.2)" : undefined,
          borderBottom: i >= 2  ? "1px solid rgba(0,210,230,0.2)" : undefined,
          borderLeft:   i % 2 === 0 ? "1px solid rgba(0,210,230,0.2)" : undefined,
          borderRight:  i % 2 === 1 ? "1px solid rgba(0,210,230,0.2)" : undefined,
        }} />
      ))}

      {/* Auth modal — only shows when Supabase is enabled and user is not signed in */}
      <AuthModal
        open={showAuth && !user}
        onClose={() => setShowAuth(false)}
        onSuccess={() => {
          setShowAuth(false);
          if (!supabaseEnabled) return;
          setLoading(true);
          supabase.auth.getUser().then(({ data }) => {
            setUser(data.user);
            // always call loadData which sets loading=false when done
            loadData();
          });
        }}
      />

      {/* Sidebar */}
      <VantageSidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 1 }}>

        {/* Top bar */}
        <div style={{ padding: "12px 28px", borderBottom: "1px solid rgba(0,210,230,0.1)", background: "rgba(2,5,9,0.97)", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.26em", textTransform: "uppercase", color: "rgba(0,210,230,0.55)", marginBottom: 4, fontWeight: 700 }}>
              Vantage · User Profile
            </p>
            <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 20, fontWeight: 300, color: "#F0F0F2", lineHeight: 1.2 }}>
              {displayName}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!user && supabaseEnabled && (
              <button
                onClick={() => setShowAuth(true)}
                style={{ padding: "7px 14px", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.1em",
                  color: "#0DC5CC", border: "1px solid rgba(0,210,230,0.25)", background: "rgba(0,210,230,0.06)",
                  borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <User size={12} /> Sign in
              </button>
            )}
            <button
              onClick={() => router.push("/setup")}
              style={{ padding: "7px 14px", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.1em",
                color: "#0DC5CC", border: "1px solid rgba(0,210,230,0.2)", background: "rgba(0,210,230,0.04)",
                borderRadius: 2, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <Plus size={12} /> New Analysis
            </button>
            {user && (
              <button onClick={handleSignOut}
                style={{ padding: "7px 9px", border: "1px solid rgba(255,255,255,0.07)", background: "transparent", borderRadius: 2, cursor: "pointer", color: "rgba(255,255,255,0.3)" }}>
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "28px 28px 40px" }}>

          {/* ── BANNER ──────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            style={{ marginBottom: 28, padding: "22px 26px", position: "relative", overflow: "hidden",
              background: "linear-gradient(135deg, rgba(0,210,230,0.055) 0%, rgba(0,80,110,0.035) 100%)",
              border: "1px solid rgba(0,210,230,0.18)", borderRadius: 2 }}
          >
            {/* Animated glow */}
            <motion.div
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              style={{ position: "absolute", top: 0, right: 0, width: 200, height: "100%", pointerEvents: "none",
                background: "radial-gradient(ellipse at 80% 50%, rgba(0,210,230,0.06) 0%, transparent 70%)" }}
            />
            {/* Corner marks */}
            {[{ top: 0, left: 0 }, { top: 0, right: 0 }, { bottom: 0, left: 0 }, { bottom: 0, right: 0 }].map((pos, i) => (
              <div key={i} style={{ position: "absolute", width: 12, height: 12, ...pos,
                borderTop:    i < 2   ? "1px solid rgba(0,210,230,0.35)" : undefined,
                borderBottom: i >= 2  ? "1px solid rgba(0,210,230,0.35)" : undefined,
                borderLeft:   i % 2 === 0 ? "1px solid rgba(0,210,230,0.35)" : undefined,
                borderRight:  i % 2 === 1 ? "1px solid rgba(0,210,230,0.35)" : undefined,
              }} />
            ))}

            <div style={{ display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
              {/* Avatar orb */}
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(0,210,230,0.07)",
                border: "1px solid rgba(0,210,230,0.25)", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0, position: "relative" }}>
                <motion.div
                  style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(0,210,230,0.55)" }}
                  animate={{ scale: [1, 1.18, 1] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                  style={{ position: "absolute", inset: -6, borderRadius: "50%", border: "1px solid rgba(0,210,230,0.15)" }}
                  animate={{ scale: [1, 1.12, 1], opacity: [0.6, 0.2, 0.6] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <motion.p
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  style={{ fontFamily: "var(--font-fraunces)", fontSize: 17, fontWeight: 400, color: "#F0F0F2", lineHeight: 1.4 }}
                >
                  {bannerLine}
                </motion.p>
                {user?.email && (
                  <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(0,210,230,0.45)", marginTop: 5, letterSpacing: "0.1em" }}>
                    {user.email}
                  </p>
                )}
              </div>

              {!loading && allAnalyses.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                  {[
                    { val: allAnalyses.length, lbl: "Analyses" },
                    { val: totalSaved,          lbl: "Saved" },
                    { val: highZoneCount,       lbl: "Hot Zones" },
                  ].map(({ val, lbl }) => (
                    <div key={lbl} style={{ textAlign: "center", padding: "8px 16px",
                      background: "rgba(0,210,230,0.05)", border: "1px solid rgba(0,210,230,0.12)", borderRadius: 2 }}>
                      <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 26, fontWeight: 300, color: "#0DC5CC", lineHeight: 1 }}>{val}</p>
                      <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 8, color: "rgba(0,210,230,0.4)", letterSpacing: "0.15em", marginTop: 4 }}>{lbl.toUpperCase()}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* ── TABS ────────────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 26, borderBottom: "1px solid rgba(0,210,230,0.07)", marginBottom: 28 }}>
            <TabBtn label="Overview" active={tab === "overview"} count={allAnalyses.length} onClick={() => setTab("overview")} />
            <TabBtn label="Stores"   active={tab === "stores"}   count={allAnalyses.length} onClick={() => setTab("stores")} />
            <TabBtn label="Saved"    active={tab === "saved"}    count={allSaved.length}    onClick={() => setTab("saved")} />
            <TabBtn label="Insights" active={tab === "insights"} count={allAnalyses.length} onClick={() => setTab("insights")} />
          </div>

          {/* ── LOADING SKELETON ────────────────────────────────────────── */}
          {loading && <PageSkeleton />}

          {/* ── OVERVIEW ────────────────────────────────────────────────── */}
          {!loading && tab === "overview" && (
            <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
                <StatCard label="Analyses Run"        value={allAnalyses.length} sub="total scans"            accent delay={0} />
                <StatCard label="Locations Uploaded"  value={totalLocations}     sub="to build DNA"           delay={0.06} />
                <StatCard label="Categories"          value={uniqueCategories.length} sub={uniqueCategories.slice(0,2).join(", ") || "—"} delay={0.12} />
                <StatCard label="Saved Locations"     value={totalSaved}         sub="matches + recs"         delay={0.18} />
              </div>

              {allAnalyses.length > 0 ? (
                <>
                  <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(0,210,230,0.45)", marginBottom: 14, fontWeight: 700 }}>
                    Best Performing Analysis
                  </p>
                  <AnalysisCard a={sortedByGold[0]} rank={0} isTop router={router} />

                  {uniqueCategories.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(0,210,230,0.45)", marginBottom: 14, fontWeight: 700 }}>
                        Categories Explored
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {uniqueCategories.map((cat, i) => (
                          <motion.div key={cat} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
                            style={{ padding: "8px 18px", border: "1px solid rgba(0,210,230,0.14)", borderRadius: 2, background: "rgba(0,210,230,0.025)" }}>
                            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, color: "rgba(0,210,230,0.7)", letterSpacing: "0.07em" }}>{cat}</p>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <EmptyState label="No analyses yet" sub="Run a scan to start building your profile." cta="Start Analysis" onCta={() => router.push("/setup")} />
              )}
            </motion.div>
          )}

          {/* ── STORES ──────────────────────────────────────────────────── */}
          {!loading && tab === "stores" && (
            <motion.div key="stores" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              {allAnalyses.length === 0 ? (
                <EmptyState label="No store analyses" sub="Upload your locations to see performance breakdowns." cta="Run Analysis" onCta={() => router.push("/setup")} />
              ) : (
                <>
                  {topAnalyses.length > 0 && (
                    <div style={{ marginBottom: 28 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <TrendingUp size={13} style={{ color: "#0DC5CC" }} />
                        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,210,230,0.55)", fontWeight: 700 }}>
                          High-Performing Zones
                        </p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {topAnalyses.map((a, i) => <AnalysisCard key={a.id} a={a} rank={i} isTop router={router} />)}
                      </div>
                    </div>
                  )}

                  {lowAnalyses.length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <TrendingDown size={13} style={{ color: "rgba(217,136,128,0.7)" }} />
                        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(217,136,128,0.45)", fontWeight: 700 }}>
                          Lower-Performing Zones
                        </p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {lowAnalyses.map((a, i) => <AnalysisCard key={a.id} a={a} rank={i} isTop={false} router={router} />)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ── SAVED LOCATIONS ─────────────────────────────────────────── */}
          {!loading && tab === "saved" && (
            <motion.div key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              {allSaved.length === 0 ? (
                <EmptyState label="No saved locations" sub="Bookmark locations from the map or recommendations screen." cta="Go to Map" onCta={() => router.push("/map")} />
              ) : (
                <>
                  {savedFromAnalyses.length > 0 && (
                    <div style={{ marginBottom: 28 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <Star size={13} style={{ color: "#E8C547" }} />
                        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(232,197,71,0.6)", fontWeight: 700 }}>
                          Saved Recommendations ({savedFromAnalyses.length})
                        </p>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                        {savedFromAnalyses.map((s, i) => <SavedCard key={`r-${i}`} entry={s} index={i} />)}
                      </div>
                    </div>
                  )}

                  {savedLocal.length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <Bookmark size={13} style={{ color: "#0DC5CC" }} />
                        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,210,230,0.55)", fontWeight: 700 }}>
                          Saved Exact Matches ({savedLocal.length})
                        </p>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                        {savedLocal.map((s, i) => <SavedCard key={`e-${i}`} entry={s} index={i} />)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ── INSIGHTS ────────────────────────────────────────────────── */}
          {!loading && tab === "insights" && (
            <motion.div key="insights" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              {allAnalyses.length === 0 ? (
                <EmptyState label="No insights yet" sub="Run an analysis to unlock DNA insights for your franchise." cta="Start Analysis" onCta={() => router.push("/setup")} />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {allAnalyses.map((a, i) => {
                    const summary  = getDnaSummary(a);
                    const failSum  = getFailureSummary(a);
                    if (!summary && !failSum) return null;
                    return (
                      <motion.div key={a.id}
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                        style={{ padding: "18px 20px", border: "1px solid rgba(0,210,230,0.1)", borderRadius: 2, background: "rgba(2,5,9,0.65)" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#0DC5CC", flexShrink: 0 }} />
                          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "#0DC5CC", letterSpacing: "0.1em", fontWeight: 700 }}>{a.name}</p>
                          <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(255,255,255,0.18)", marginLeft: "auto" }}>
                            {a.category} · {fmtDate(a.created_at)}
                          </span>
                        </div>
                        {summary && (
                          <div style={{ marginBottom: failSum ? 12 : 0 }}>
                            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 8, letterSpacing: "0.18em", color: "rgba(130,185,155,0.65)", textTransform: "uppercase", marginBottom: 7 }}>Success DNA</p>
                            <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 14, fontWeight: 300, color: "rgba(240,240,242,0.78)", lineHeight: 1.65 }}>{summary}</p>
                          </div>
                        )}
                        {failSum && (
                          <div style={{ paddingTop: summary ? 12 : 0, borderTop: summary ? "1px solid rgba(0,210,230,0.06)" : "none" }}>
                            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 8, letterSpacing: "0.18em", color: "rgba(217,136,128,0.55)", textTransform: "uppercase", marginBottom: 7 }}>Risk Pattern</p>
                            <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 14, fontWeight: 300, color: "rgba(217,136,128,0.65)", lineHeight: 1.65 }}>{failSum}</p>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
