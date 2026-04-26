"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import { listAnalyses, deleteAnalysis, updateSavedSuburbs, type Analysis } from "@/lib/analyses";
import { listUserStores, addUserStore, deleteUserStore, type UserStore } from "@/lib/stores";
import { api } from "@/lib/api";
import AuthModal from "@/components/ui/AuthModal";
import {
  ArrowRight, LogOut, Plus, Bookmark, Star, Ban, Tag, Trash2,
  TrendingUp, TrendingDown, MapPin, Layers, ChevronRight, User,
  AlertTriangle, Store,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "overview" | "stores" | "saved" | "insights";

interface SavedLocEntry {
  h3_r7: string;
  locality: string;
  state: string;
  label: string;
  source: "exact_match" | "recommendation" | "avoid";
  storeType: string;
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function loadSavedH3s(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("vantage_saved") ?? "[]") as string[]; }
  catch { return []; }
}

type SavedMeta = { h3_r7: string; locality: string; state: string; source?: "exact_match" | "recommendation" | "avoid"; storeType?: string };
function loadSavedMeta(): Record<string, SavedMeta> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem("vantage_saved_meta") ?? "{}") as Record<string, SavedMeta>; }
  catch { return {}; }
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

// ── Illustrated avatar ────────────────────────────────────────────────────────

const AVATAR_PALETTES = [
  { bg: "rgba(13,197,204,0.15)", ring: "rgba(13,197,204,0.45)", text: "#0DC5CC" },
  { bg: "rgba(130,185,155,0.15)", ring: "rgba(130,185,155,0.45)", text: "#82B99B" },
  { bg: "rgba(232,197,71,0.15)",  ring: "rgba(232,197,71,0.45)",  text: "#E8C547" },
  { bg: "rgba(111,168,220,0.15)", ring: "rgba(111,168,220,0.45)", text: "#6FA8DC" },
  { bg: "rgba(179,157,219,0.15)", ring: "rgba(179,157,219,0.45)", text: "#B39DDB" },
];

function pickPalette(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
  return AVATAR_PALETTES[Math.abs(h) % AVATAR_PALETTES.length];
}

function IllustratedAvatar({ initial, name, size = 56 }: { initial: string; name: string; size?: number }) {
  const p = pickPalette(name || "G");
  const r = size / 2;
  const ir = r * 0.72;
  return (
    <div style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        {/* Dashed outer ring */}
        <circle cx={r} cy={r} r={r - 1} stroke={p.ring} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.6" />
        {/* Fill */}
        <circle cx={r} cy={r} r={r - 4} fill={p.bg} />
        {/* Shoulder silhouette arc */}
        <path d={`M ${r - ir * 0.7} ${size - 4} Q ${r} ${size - ir * 0.55} ${r + ir * 0.7} ${size - 4}`}
          stroke={p.ring} strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
        {/* Head circle */}
        <circle cx={r} cy={r * 0.82} r={ir * 0.52} fill={p.bg} stroke={p.ring} strokeWidth="1" />
        {/* Initial */}
        <text x={r} y={r * 0.82 + ir * 0.19} textAnchor="middle" dominantBaseline="middle"
          style={{ fontFamily: "Georgia, serif", fontSize: ir * 0.58, fontWeight: 400 }} fill={p.text}>
          {initial}
        </text>
      </svg>
      <motion.div
        style={{ position: "absolute", inset: -5, borderRadius: "50%", border: `1px solid ${p.ring}`, pointerEvents: "none" }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.5, 0.1, 0.5] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

// ── Delete account dialog ─────────────────────────────────────────────────────

function DeleteAccountDialog({
  open, loading, error, onClose, onConfirm,
}: { open: boolean; loading: boolean; error: string | null; onClose: () => void; onConfirm: () => void }) {
  const [inputVal, setInputVal] = useState("");
  const confirmed = inputVal === "DELETE";

  useEffect(() => { if (!open) setInputVal(""); }, [open]);

  if (!open) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(2,5,9,0.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: 420, background: "rgba(12,14,18,0.98)", border: "1px solid rgba(217,100,89,0.3)", borderRadius: 4, padding: "28px 28px 24px", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(217,100,89,0.1)", border: "1px solid rgba(217,100,89,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <AlertTriangle size={16} style={{ color: "rgba(217,100,89,0.9)" }} />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 17, fontWeight: 400, color: "#F0F0F2", lineHeight: 1.2 }}>Delete Account</p>
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(217,100,89,0.65)", letterSpacing: "0.1em", marginTop: 3 }}>THIS ACTION CANNOT BE UNDONE</p>
          </div>
        </div>

        {/* Warning */}
        <div style={{ padding: "14px 16px", marginBottom: 20, background: "rgba(217,100,89,0.05)", border: "1px solid rgba(217,100,89,0.15)", borderRadius: 3, borderLeft: "3px solid rgba(217,100,89,0.5)" }}>
          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, color: "rgba(240,240,242,0.7)", lineHeight: 1.7 }}>
            Permanently deletes your account and all associated analyses, saved locations, and preferences. Your data cannot be recovered after deletion.
          </p>
        </div>

        {/* Confirm input */}
        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 8, letterSpacing: "0.05em" }}>
          Type{" "}<span style={{ color: "rgba(217,100,89,0.8)", fontWeight: 700 }}>DELETE</span>{" "}to confirm
        </p>
        <input
          type="text" value={inputVal} onChange={(e) => setInputVal(e.target.value)}
          placeholder="DELETE" autoFocus
          style={{ width: "100%", padding: "9px 12px", marginBottom: 20, fontFamily: "var(--font-geist-mono)", fontSize: 12, letterSpacing: "0.1em", background: "rgba(0,0,0,0.4)", border: `1px solid ${confirmed ? "rgba(217,100,89,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 3, color: confirmed ? "rgba(217,100,89,0.9)" : "#F0F0F2", outline: "none", transition: "border-color 0.15s, color 0.15s" }}
        />

        {/* Error message */}
        {error && (
          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, color: "rgba(217,100,89,0.9)", background: "rgba(217,100,89,0.08)", border: "1px solid rgba(217,100,89,0.25)", borderRadius: 3, padding: "9px 12px", marginBottom: 16, lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: "9px 0", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", borderRadius: 3, cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.7)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.45)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
          >
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!confirmed || loading}
            style={{ flex: 1, padding: "9px 0", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.12em", color: confirmed ? "rgba(217,100,89,0.95)" : "rgba(217,100,89,0.3)", border: `1px solid ${confirmed ? "rgba(217,100,89,0.45)" : "rgba(217,100,89,0.15)"}`, background: confirmed ? "rgba(217,100,89,0.08)" : "transparent", borderRadius: 3, cursor: confirmed && !loading ? "pointer" : "not-allowed", transition: "all 0.15s" }}
          >
            {loading ? "Deleting..." : "Delete Account"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Add store modal ───────────────────────────────────────────────────────────

const PERF_OPTIONS = [
  { value: "best",  label: "Best performing",   color: "#82B99B", bg: "rgba(130,185,155,0.08)", border: "rgba(130,185,155,0.35)" },
  { value: "worst", label: "Underperforming",   color: "rgba(217,136,128,0.85)", bg: "rgba(217,136,128,0.06)", border: "rgba(217,136,128,0.3)" },
] as const;

type LocationSuggestion =
  | { kind: "place";  description: string; place_id: string }
  | { kind: "suburb"; locality: string; state: string; h3_r7: string };

const STATE_NAME_MAP: Record<string, string> = {
  "new south wales": "NSW", "victoria": "VIC", "queensland": "QLD",
  "western australia": "WA", "south australia": "SA", "tasmania": "TAS",
  "australian capital territory": "ACT", "northern territory": "NT",
};

function parseLocality(description: string): { locality: string; state: string } {
  const parts = description.split(",").map((p) => p.trim());
  const locality = parts[0] ?? description;
  let state = "NSW";
  for (const part of parts) {
    const lower = part.toLowerCase().replace(/\s*\d+$/, "").trim();
    if (STATE_NAME_MAP[lower]) { state = STATE_NAME_MAP[lower]; break; }
  }
  return { locality, state };
}

function AddStoreModal({
  open, categories, onClose, onAdd,
}: { open: boolean; categories: string[]; onClose: () => void; onAdd: (s: { category: string; locality: string; state: string; performance: "best" | "worst" }) => Promise<void>; }) {
  const [inputVal,    setInputVal]    = useState("");
  const [locality,    setLocality]    = useState("");
  const [state,       setState]       = useState("");
  const [category,    setCategory]    = useState("");
  const [performance, setPerformance] = useState<"best" | "worst">("best");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [dropOpen,    setDropOpen]    = useState(false);
  const [activeIdx,   setActiveIdx]   = useState(-1);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [dropPos,     setDropPos]     = useState({ top: 0, left: 0, width: 0 });
  const [mounted,     setMounted]     = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) {
      setInputVal(""); setLocality(""); setState(""); setCategory("");
      setPerformance("best"); setError(null); setSuggestions([]); setDropOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!dropOpen || !wrapRef.current) return;
    const update = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [dropOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = inputVal.trim();
    if (q.length < 2) { setSuggestions([]); setDropOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoadingSugg(true);
      try {
        const places = await api.placesAutocomplete(q, 6);
        if (places.length > 0) {
          setSuggestions(places.map((p) => ({ ...p, kind: "place" as const })));
          setDropOpen(true); setActiveIdx(-1); return;
        }
        const suburbs = await api.suggest(q, 8);
        setSuggestions(suburbs.map((s) => ({ ...s, kind: "suburb" as const })));
        setDropOpen(suburbs.length > 0); setActiveIdx(-1);
      } catch { setSuggestions([]); }
      finally { setLoadingSugg(false); }
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputVal]);

  const pickSuggestion = useCallback((s: LocationSuggestion) => {
    const { locality: loc, state: st } = s.kind === "suburb"
      ? { locality: s.locality, state: s.state }
      : parseLocality(s.description);
    setLocality(loc);
    setState(st);
    setInputVal(`${loc}, ${st}`);
    setSuggestions([]); setDropOpen(false); setActiveIdx(-1);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeIdx >= 0 && suggestions[activeIdx]) pickSuggestion(suggestions[activeIdx]); }
    else if (e.key === "Escape") { setDropOpen(false); setActiveIdx(-1); }
  }

  async function handleSave() {
    if (!locality.trim() || !category) { setError("Please fill in all fields."); return; }
    setSaving(true); setError(null);
    try {
      await onAdd({ category, locality: locality.trim(), state: state || "NSW", performance });
      onClose();
    } catch {
      setError("Failed to save store. Please try again.");
    } finally { setSaving(false); }
  }

  if (!open) return null;

  const inputBase: React.CSSProperties = {
    width: "100%", padding: "9px 12px",
    fontFamily: "var(--font-geist-mono)", fontSize: 12,
    background: "rgba(0,0,0,0.35)", border: "1px solid rgba(0,210,230,0.18)",
    borderRadius: 3, color: "#F0F0F2", outline: "none",
    transition: "border-color 0.15s",
  };

  const locFilled = !!locality.trim();

  const dropdown = dropOpen && suggestions.length > 0 ? (
    <div style={{
      position: "absolute", top: dropPos.top, left: dropPos.left, width: dropPos.width,
      background: "#131316", border: "1px solid #26262B", borderRadius: 6,
      boxShadow: "0 8px 28px rgba(0,0,0,0.6)", zIndex: 9999, overflow: "hidden",
    }}>
      {suggestions.map((s, i) => {
        const label = s.kind === "place" ? s.description : s.locality;
        const comma = label.indexOf(",");
        const main  = comma > 0 ? label.slice(0, comma) : label;
        const sub   = comma > 0 ? label.slice(comma + 1).trim() : null;
        const badge = s.kind === "suburb" ? s.state : null;
        const key   = s.kind === "place" ? s.place_id : s.h3_r7;
        return (
          <button key={key} onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
            onMouseEnter={() => setActiveIdx(i)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
              background: activeIdx === i ? "rgba(13,199,204,0.12)" : "transparent",
              border: "none", borderBottom: i < suggestions.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              cursor: "pointer", textAlign: "left", transition: "background 0.1s" }}>
            <svg width="11" height="14" viewBox="0 0 11 14" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
              <path d="M5.5 0C3.02 0 1 2.02 1 4.5c0 3.375 4.5 9 4.5 9s4.5-5.625 4.5-9C10 2.02 7.98 0 5.5 0Zm0 6.125a1.625 1.625 0 1 1 0-3.25 1.625 1.625 0 0 1 0 3.25Z" fill="#0DC5CC" />
            </svg>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, color: activeIdx === i ? "#F0F0F2" : "#C8C8D4",
                fontFamily: "var(--font-geist-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {main.toLowerCase().startsWith(inputVal.toLowerCase())
                  ? <><strong style={{ color: "#F0F0F2", fontWeight: 600 }}>{main.slice(0, inputVal.length)}</strong>{main.slice(inputVal.length)}</>
                  : main}
              </span>
              {sub && <span style={{ display: "block", fontSize: 11, color: "#555566", fontFamily: "var(--font-geist-sans)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>}
            </span>
            {badge && <span style={{ fontSize: 10, color: "#555566", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.08em", flexShrink: 0 }}>{badge}</span>}
          </button>
        );
      })}
      <div style={{ padding: "5px 14px", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "#3A3A4A", fontFamily: "var(--font-geist-mono)" }}>© OpenStreetMap contributors</span>
      </div>
    </div>
  ) : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(2,5,9,0.85)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: 440, background: "rgba(12,14,18,0.98)", border: "1px solid rgba(0,210,230,0.2)", borderRadius: 4, padding: "28px 28px 24px", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(0,210,230,0.08)", border: "1px solid rgba(0,210,230,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Store size={14} style={{ color: "#0DC5CC" }} />
          </div>
          <div>
            <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 17, fontWeight: 400, color: "#F0F0F2", lineHeight: 1.2 }}>Add Your Store</p>
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(0,210,230,0.5)", letterSpacing: "0.1em", marginTop: 2 }}>SAVE A STORE YOU OWN</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Location */}
          <div>
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", marginBottom: 7 }}>STORE LOCATION</p>
            <div ref={wrapRef} style={{ position: "relative" }}>
              <input ref={inputRef} type="text" value={inputVal}
                onChange={(e) => { setInputVal(e.target.value); setLocality(""); setState(""); }}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setDropOpen(false), 160)}
                onFocus={() => suggestions.length > 0 && setDropOpen(true)}
                placeholder="Start typing a suburb or address…"
                style={{ ...inputBase, paddingRight: loadingSugg ? "32px" : "12px" }}
              />
              {loadingSugg && (
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "rgba(0,210,230,0.4)", fontFamily: "var(--font-geist-mono)" }}>…</span>
              )}
              {locFilled && (
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "rgba(0,210,230,0.6)", fontFamily: "var(--font-geist-mono)" }}>{state}</span>
              )}
              {mounted && typeof document !== "undefined" && createPortal(dropdown, document.body)}
            </div>
          </div>

          {/* Category */}
          <div>
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", marginBottom: 7 }}>BUSINESS CATEGORY</p>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputBase, cursor: "pointer", appearance: "none" }}>
              <option value="" disabled style={{ background: "#0a0a0b" }}>Select category…</option>
              {categories.map((c) => <option key={c} value={c} style={{ background: "#0a0a0b" }}>{c}</option>)}
            </select>
          </div>

          {/* Performance */}
          <div>
            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", marginBottom: 7 }}>HOW IS THIS STORE PERFORMING?</p>
            <div style={{ display: "flex", gap: 8 }}>
              {PERF_OPTIONS.map((opt) => (
                <button key={opt.value} type="button" onClick={() => setPerformance(opt.value)}
                  style={{ flex: 1, padding: "9px 0", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.07em", borderRadius: 3, cursor: "pointer", transition: "all 0.15s",
                    color: performance === opt.value ? opt.color : "rgba(255,255,255,0.3)",
                    border: `1px solid ${performance === opt.value ? opt.border : "rgba(255,255,255,0.1)"}`,
                    background: performance === opt.value ? opt.bg : "transparent",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(217,136,128,0.85)", letterSpacing: "0.05em" }}>{error}</p>}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "9px 0", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", borderRadius: 3, cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.65)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !locFilled || !category}
            style={{ flex: 1, padding: "9px 0", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.12em", borderRadius: 3, cursor: !saving && locFilled && category ? "pointer" : "not-allowed", transition: "all 0.15s",
              color: locFilled && category ? "#0DC5CC" : "rgba(0,210,230,0.3)",
              border: `1px solid ${locFilled && category ? "rgba(0,210,230,0.45)" : "rgba(0,210,230,0.15)"}`,
              background: locFilled && category ? "rgba(0,210,230,0.08)" : "transparent",
            }}>
            {saving ? "Saving…" : "Add Store"}
          </button>
        </div>
      </motion.div>
    </div>
  );
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

function VantageSidebar({ open, onToggle, hasAnalysis = true }: { open: boolean; onToggle: () => void; hasAnalysis?: boolean }) {
  const router = useRouter();
  const [lockedNudge, setLockedNudge] = useState(false);
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
        <button onClick={onToggle}
          className="w-7 h-7 rounded flex items-center justify-center transition-all shrink-0"
          style={{ color: "rgba(0,210,230,0.4)", border: "1px solid rgba(0,210,230,0.14)", background: "transparent" }}>
          {open
            ? <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 2L4 5.5 7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M4 2l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
        </button>
      </div>

      {open && (
        <p className="px-5 pt-5 pb-2" style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(0,210,230,0.7)", fontWeight: 700 }}>
          Navigation
        </p>
      )}

      <nav className="flex-1 px-2 space-y-0.5 mt-1">
        {NAV_ITEMS.map((item) => {
          const locked = item.label !== "Dashboard" && !hasAnalysis;
          return (
            <div key={item.label}
              onClick={() => {
                if (locked) { setLockedNudge(true); setTimeout(() => setLockedNudge(false), 2400); return; }
                router.push(item.path);
              }}
              className="flex items-center rounded-sm transition-all duration-150"
              style={{
                gap: open ? 10 : 0, justifyContent: open ? "flex-start" : "center",
                padding: open ? "9px 10px" : "9px 0",
                background: "transparent", borderLeft: "2px solid transparent",
                color: locked ? "rgba(200,230,235,0.28)" : "rgba(200,230,235,0.85)",
                cursor: locked ? "not-allowed" : "pointer",
                opacity: locked ? 0.45 : 1,
              }}>
              <span style={{ opacity: locked ? 0.4 : 0.6, flexShrink: 0 }}>{item.icon}</span>
              <AnimatePresence>
                {open && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}
                    style={{ fontSize: 14, letterSpacing: "0.04em", whiteSpace: "nowrap", fontWeight: 600 }}>
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
              {locked && open && (
                <svg className="ml-auto" width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="1.5" y="4.5" width="7" height="5" rx="1" stroke="rgba(0,210,230,0.25)" strokeWidth="1"/>
                  <path d="M3 4.5V3a2 2 0 014 0v1.5" stroke="rgba(0,210,230,0.25)" strokeWidth="1" strokeLinecap="round"/>
                </svg>
              )}
            </div>
          );
        })}
      </nav>
      {lockedNudge && open && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-sm" style={{ background: "rgba(0,210,230,0.06)", border: "1px solid rgba(0,210,230,0.2)", fontSize: 11, color: "rgba(0,210,230,0.7)", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.04em", lineHeight: 1.5 }}>
          Run your first analysis on the Dashboard to unlock.
        </div>
      )}

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

function AnalysisCard({ a, rank, isTop, router, onDelete }: {
  a: Analysis; rank: number; isTop: boolean; router: ReturnType<typeof useRouter>; onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
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

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setDeleting(true);
    onDelete?.();
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
        {/* DNA score */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 26, fontWeight: 300, color: isTop ? "#0DC5CC" : "rgba(255,255,255,0.4)", lineHeight: 1 }}>
            {goldPct.toFixed(0)}<span style={{ fontSize: 13 }}>%</span>
          </p>
          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 8, color: "rgba(255,255,255,0.18)", letterSpacing: "0.12em", marginTop: 2 }}>DNA MATCH</p>
        </div>
        {/* Delete control */}
        {onDelete && (
          <div style={{ flexShrink: 0, marginLeft: 4 }}>
            {!confirming ? (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
                title="Delete analysis"
                style={{ padding: 4, color: "rgba(217,100,89,0.45)", background: "transparent", border: "none", cursor: "pointer", borderRadius: 2, display: "flex", alignItems: "center" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(217,100,89,0.9)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(217,100,89,0.45)"; }}
              >
                <Trash2 size={13} />
              </button>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
                  style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, padding: "3px 8px", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", borderRadius: 2, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, padding: "3px 8px", color: "rgba(217,100,89,0.9)", border: "1px solid rgba(217,100,89,0.3)", background: "rgba(217,100,89,0.08)", borderRadius: 2, cursor: "pointer", opacity: deleting ? 0.5 : 1 }}
                >
                  {deleting ? "…" : "Delete"}
                </button>
              </div>
            )}
          </div>
        )}
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

function SavedCard({ entry, index, onOpen, onDelete }: { entry: SavedLocEntry; index: number; onOpen: () => void; onDelete?: () => void }) {
  const isRec   = entry.source === "recommendation";
  const isAvoid = entry.source === "avoid";
  const borderColor = isRec ? "rgba(232,197,71,0.15)" : isAvoid ? "rgba(217,100,89,0.15)" : "rgba(0,210,230,0.12)";
  const bgColor     = isRec ? "rgba(232,197,71,0.025)" : isAvoid ? "rgba(217,100,89,0.025)" : "rgba(0,210,230,0.025)";
  const labelColor  = isRec ? "rgba(232,197,71,0.45)" : isAvoid ? "rgba(217,100,89,0.5)" : "rgba(0,210,230,0.38)";
  const displayName = entry.locality && entry.locality !== entry.h3_r7
    ? `${entry.locality}, ${entry.state}`
    : entry.h3_r7;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      onClick={onOpen}
      style={{
        padding: "12px 14px", borderRadius: 2, cursor: "pointer",
        border: `1px solid ${borderColor}`,
        background: bgColor,
        display: "flex", alignItems: "center", gap: 9,
        transition: "border-color 0.15s, background 0.15s",
      }}
      whileHover={{ scale: 1.01 }}
    >
      {isRec
        ? <Star size={11} style={{ color: "#E8C547", flexShrink: 0 }} />
        : isAvoid
          ? <Ban size={11} style={{ color: "rgba(217,100,89,0.8)", flexShrink: 0 }} />
          : <Bookmark size={11} style={{ color: "#0DC5CC", flexShrink: 0 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 12, color: "#F0F0F2", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {displayName}
        </p>
        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: labelColor, marginTop: 3, letterSpacing: "0.05em" }}>{entry.label}</p>
      </div>
      {/* Right: trash (immediate) + navigate arrow */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Remove"
            style={{ padding: "2px 3px", color: "rgba(217,100,89,0.45)", background: "transparent", border: "none", cursor: "pointer", borderRadius: 2, display: "flex", alignItems: "center" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(217,100,89,0.9)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(217,100,89,0.45)"; }}
          >
            <Trash2 size={10} />
          </button>
        )}
        <ChevronRight size={11} style={{ color: "rgba(255,255,255,0.25)" }} />
      </div>
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
  const [user,          setUser]          = useState<{ email?: string; user_metadata?: Record<string, string> } | null>(null);
  const [analyses,      setAnalyses]      = useState<Analysis[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [showAuth,      setShowAuth]      = useState(false);
  const [authDismissed, setAuthDismissed] = useState(false);
  const [tab,           setTab]           = useState<Tab>("overview");
  const [sidebarOpen,   setSidebarOpen]   = useState(true);
  const [savedH3s,      setSavedH3s]      = useState<string[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [hasAnalysis,      setHasAnalysis]      = useState(false);
  const [deleteLoading,    setDeleteLoading]    = useState(false);
  const [deleteError,      setDeleteError]      = useState<string | null>(null);
  const [userStores,       setUserStores]       = useState<UserStore[]>([]);
  const [showAddStore,     setShowAddStore]     = useState(false);
  const [allCategories,    setAllCategories]    = useState<string[]>([]);

  // Read localStorage after mount
  useEffect(() => { setSavedH3s(loadSavedH3s()); }, []);
  useEffect(() => {
    setHasAnalysis(analyses.length > 0 || !!sessionStorage.getItem("vantage_dna"));
  }, [analyses.length]);

  // Load categories for the Add Store modal
  useEffect(() => {
    api.categories().then((r) => setAllCategories(r.categories.map((c) => c.name))).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    const [data, stores] = await Promise.all([listAnalyses(), listUserStores()]);

    // If no persisted analyses but there's an active session, include it
    const sessionAnalysis = getSessionAnalysis();
    const merged = data.length > 0 ? data : sessionAnalysis ? [sessionAnalysis] : [];
    setAnalyses(merged);
    setUserStores(stores);
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
        if (!authDismissed) setShowAuth(true);
      }
    });
  }, [loadData, authDismissed]);

  async function handleSignOut() {
    if (supabaseEnabled) await supabase.auth.signOut();
    router.push("/setup");
  }

  async function handleDeleteAccount() {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      if (supabaseEnabled) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
          const res = await fetch(`${BASE}/user/delete`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error(text || `Delete failed (${res.status})`);
          }
          await supabase.auth.signOut();
        }
      }
      localStorage.removeItem("vantage_saved");
      localStorage.removeItem("vantage_saved_meta");
      sessionStorage.clear();
      setShowDeleteDialog(false);
      router.push("/setup");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account. Please try again.");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleAddStore(s: { category: string; locality: string; state: string; performance: "best" | "worst" }) {
    const created = await addUserStore(s);
    if (!created) throw new Error("Failed to save store — check your connection and try again.");
    setUserStores((prev) => [created, ...prev]);
  }

  async function handleDeleteStore(id: string) {
    await deleteUserStore(id);
    setUserStores((prev) => prev.filter((s) => s.id !== id));
  }

  async function handleDeleteAnalysis(id: string) {
    await deleteAnalysis(id);
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
  }

  function handleDeleteSaved(h3_r7: string) {
    // Remove from localStorage
    const newH3s = savedH3s.filter((h) => h !== h3_r7);
    localStorage.setItem("vantage_saved", JSON.stringify(newH3s));
    const meta = loadSavedMeta();
    delete meta[h3_r7];
    localStorage.setItem("vantage_saved_meta", JSON.stringify(meta));
    setSavedH3s(newH3s);
    // Update analyses state immediately + persist to Supabase
    setAnalyses((prev) => prev.map((a) => {
      if (!a.saved_suburbs.includes(h3_r7)) return a;
      const updated = a.saved_suburbs.filter((h) => h !== h3_r7);
      updateSavedSuburbs(a.id, updated);
      return { ...a, saved_suburbs: updated };
    }));
  }

  // Derived stats
  const allAnalyses      = analyses;
  const totalLocations   = allAnalyses.reduce((s, a) => s + getNLocations(a), 0);
  const totalSaved       = allAnalyses.reduce((s, a) => s + a.saved_suburbs.length, 0) + savedH3s.length;
  const uniqueCategories = [...new Set(allAnalyses.map((a) => a.category))];
  const sortedByGold     = [...allAnalyses].sort((a, b) => getGoldPct(b) - getGoldPct(a));
  const topAnalyses      = sortedByGold.slice(0, 3);
  const highZoneCount = topAnalyses.filter((a) => getGoldPct(a) >= 60).length;

  // Saved location entries — resolve locality/state from meta
  const savedMeta = loadSavedMeta();
  const savedFromAnalyses: SavedLocEntry[] = allAnalyses.flatMap((a) =>
    a.saved_suburbs.map((h3) => ({
      h3_r7: h3,
      locality: savedMeta[h3]?.locality ?? h3,
      state: savedMeta[h3]?.state ?? "AU",
      label: "Recommendation",
      source: (savedMeta[h3]?.source ?? "recommendation") as "exact_match" | "recommendation" | "avoid",
      storeType: savedMeta[h3]?.storeType ?? a.category,
    }))
  );
  const savedLocal: SavedLocEntry[] = savedH3s.map((h3) => {
    const meta   = savedMeta[h3];
    const source = meta?.source ?? "exact_match";
    const label  = source === "avoid" ? "Avoid Zone" : source === "recommendation" ? "Recommendation" : "Exact Match";
    return {
      h3_r7: h3,
      locality: meta?.locality ?? h3,
      state: meta?.state ?? "AU",
      label,
      source,
      storeType: meta?.storeType ?? "",
    };
  });
  // Deduplicate by H3 — prefer savedLocal (has explicit source/storeType from bookmark action)
  const seenH3s = new Set<string>();
  const allSaved: SavedLocEntry[] = [];
  for (const entry of savedLocal) {
    if (!seenH3s.has(entry.h3_r7)) { seenH3s.add(entry.h3_r7); allSaved.push(entry); }
  }
  for (const entry of savedFromAnalyses) {
    if (!seenH3s.has(entry.h3_r7)) { seenH3s.add(entry.h3_r7); allSaved.push(entry); }
  }

  const storeTypeGroups = new Map<string, SavedLocEntry[]>();
  for (const entry of allSaved) {
    const key = entry.storeType || "Other";
    if (!storeTypeGroups.has(key)) storeTypeGroups.set(key, []);
    storeTypeGroups.get(key)!.push(entry);
  }
  const sortedStoreTypes = [...storeTypeGroups.keys()].sort((a, b) =>
    a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)
  );

  const fullName    = user?.user_metadata?.full_name ?? "";
  const displayName = fullName || (user?.email ? user.email.split("@")[0] : "Your Portfolio");
  const avatarInitial = (fullName?.[0] ?? user?.email?.[0] ?? "G").toUpperCase();
  const managedCount = userStores.length > 0 ? userStores.length : totalLocations;
  const bannerLine = allAnalyses.length === 0
    ? "No analyses yet — run your first scan to build your profile."
    : `You manage ${managedCount} location${managedCount !== 1 ? "s" : ""} across ${allAnalyses.length} ${allAnalyses.length === 1 ? "analysis" : "analyses"} — ${highZoneCount} high-performing zone${highZoneCount !== 1 ? "s" : ""} identified.`;

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
        open={showAuth && !user && !authDismissed}
        onClose={() => setShowAuth(false)}
        onGuest={() => setAuthDismissed(true)}
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
      <VantageSidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} hasAnalysis={hasAnalysis} />

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
                onClick={() => { setAuthDismissed(false); setShowAuth(true); }}
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
              {/* Illustrated avatar */}
              <IllustratedAvatar initial={avatarInitial} name={displayName} size={56} />

              <div style={{ flex: 1 }}>
                <motion.p
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15, duration: 0.45 }}
                  style={{ fontFamily: "var(--font-fraunces)", fontSize: 22, fontWeight: 400, color: "#F0F0F2", lineHeight: 1.2, marginBottom: 4 }}
                >
                  Welcome, {displayName} 👋
                </motion.p>
                <motion.p
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25, duration: 0.45 }}
                  style={{ fontFamily: "var(--font-fraunces)", fontSize: 14, fontWeight: 300, color: "rgba(240,240,242,0.55)", lineHeight: 1.5 }}
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
            <TabBtn label="Stores"   active={tab === "stores"}   count={userStores.length}  onClick={() => setTab("stores")} />
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
                  <AnalysisCard a={sortedByGold[0]} rank={0} isTop router={router} onDelete={() => handleDeleteAnalysis(sortedByGold[0].id)} />

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

              {/* Section header + Add Store button */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
                <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(0,210,230,0.45)", fontWeight: 700 }}>
                  Your Stores
                </p>
                {user && (
                  <button
                    onClick={() => setShowAddStore(true)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.1em", color: "#0DC5CC", border: "1px solid rgba(0,210,230,0.28)", background: "rgba(0,210,230,0.06)", borderRadius: 2, cursor: "pointer", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,210,230,0.12)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.5)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,210,230,0.06)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.28)"; }}
                  >
                    <Plus size={11} /> Add Store
                  </button>
                )}
              </div>

              {userStores.length === 0 ? (
                <EmptyState
                  label="No stores added yet"
                  sub="Add the stores you own to track and compare their performance."
                  cta="Add Your First Store"
                  onCta={() => user ? setShowAddStore(true) : router.push("/setup")}
                />
              ) : (
                <>
                  {/* Best performing */}
                  {userStores.filter((s) => s.performance === "best").length > 0 && (
                    <div style={{ marginBottom: 28 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <TrendingUp size={12} style={{ color: "#82B99B" }} />
                        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(130,185,155,0.7)", fontWeight: 700 }}>
                          Best Performing
                        </p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {userStores.filter((s) => s.performance === "best").map((store, i) => (
                          <motion.div key={store.id}
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                            style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", border: "1px solid rgba(130,185,155,0.18)", borderRadius: 2, background: "rgba(130,185,155,0.03)" }}
                          >
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(130,185,155,0.1)", border: "1px solid rgba(130,185,155,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <Store size={13} style={{ color: "#82B99B" }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {store.locality}, {store.state}
                              </p>
                              <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(130,185,155,0.6)", marginTop: 3, letterSpacing: "0.08em" }}>
                                {store.category}
                              </p>
                            </div>
                            <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "#82B99B", border: "1px solid rgba(130,185,155,0.28)", borderRadius: 2, padding: "2px 7px", letterSpacing: "0.07em", flexShrink: 0 }}>
                              BEST
                            </span>
                            <button onClick={() => handleDeleteStore(store.id)}
                              style={{ padding: 5, background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", borderRadius: 2, flexShrink: 0, transition: "color 0.15s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(217,100,89,0.7)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.2)"; }}>
                              <Trash2 size={13} />
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Underperforming */}
                  {userStores.filter((s) => s.performance === "worst").length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <TrendingDown size={12} style={{ color: "rgba(217,136,128,0.75)" }} />
                        <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(217,136,128,0.55)", fontWeight: 700 }}>
                          Underperforming
                        </p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {userStores.filter((s) => s.performance === "worst").map((store, i) => (
                          <motion.div key={store.id}
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                            style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 16px", border: "1px solid rgba(217,136,128,0.15)", borderRadius: 2, background: "rgba(217,136,128,0.025)" }}
                          >
                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(217,136,128,0.08)", border: "1px solid rgba(217,136,128,0.22)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <Store size={13} style={{ color: "rgba(217,136,128,0.8)" }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {store.locality}, {store.state}
                              </p>
                              <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(217,136,128,0.55)", marginTop: 3, letterSpacing: "0.08em" }}>
                                {store.category}
                              </p>
                            </div>
                            <span style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, color: "rgba(217,136,128,0.8)", border: "1px solid rgba(217,136,128,0.25)", borderRadius: 2, padding: "2px 7px", letterSpacing: "0.07em", flexShrink: 0 }}>
                              UNDERPERFORMING
                            </span>
                            <button onClick={() => handleDeleteStore(store.id)}
                              style={{ padding: 5, background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", borderRadius: 2, flexShrink: 0, transition: "color 0.15s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(217,100,89,0.7)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.2)"; }}>
                              <Trash2 size={13} />
                            </button>
                          </motion.div>
                        ))}
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
                  {sortedStoreTypes.map((storeType, gi) => {
                    const entries = storeTypeGroups.get(storeType)!;
                    const isLast  = gi === sortedStoreTypes.length - 1;
                    return (
                      <div key={storeType} style={{ marginBottom: isLast ? 0 : 28 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                          <Tag size={13} style={{ color: "#0DC5CC" }} />
                          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,210,230,0.55)", fontWeight: 700 }}>
                            {storeType} ({entries.length})
                          </p>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                          {entries.map((s, i) => (
                            <SavedCard
                              key={`${storeType}-${i}`}
                              entry={s}
                              index={i}
                              onOpen={() => router.push(
                                s.source === "avoid"          ? `/avoid?h3=${s.h3_r7}`
                                : s.source === "recommendation" ? `/recommendations?h3=${s.h3_r7}`
                                : `/map?h3=${s.h3_r7}`
                              )}
                              onDelete={() => handleDeleteSaved(s.h3_r7)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
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

          {/* ── ACCOUNT SETTINGS ────────────────────────────────────────── */}
          {user && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.4 }}
              style={{ marginTop: 40, paddingTop: 28, borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", marginBottom: 16, fontWeight: 700 }}>
                Account Settings
              </p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "rgba(217,100,89,0.03)", border: "1px solid rgba(217,100,89,0.12)", borderRadius: 3 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(240,240,242,0.75)", marginBottom: 3 }}>Delete Account</p>
                  <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(255,255,255,0.28)", letterSpacing: "0.04em" }}>
                    Permanently removes your account and all associated data.
                  </p>
                </div>
                <button
                  onClick={() => setShowDeleteDialog(true)}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", fontFamily: "var(--font-geist-mono)", fontSize: 10, letterSpacing: "0.1em", color: "rgba(217,100,89,0.8)", border: "1px solid rgba(217,100,89,0.25)", background: "rgba(217,100,89,0.05)", borderRadius: 3, cursor: "pointer", flexShrink: 0, transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(217,100,89,0.1)"; e.currentTarget.style.borderColor = "rgba(217,100,89,0.45)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(217,100,89,0.05)"; e.currentTarget.style.borderColor = "rgba(217,100,89,0.25)"; }}
                >
                  <Trash2 size={12} /> Delete Account
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Delete account confirmation dialog */}
      <DeleteAccountDialog
        open={showDeleteDialog}
        loading={deleteLoading}
        error={deleteError}
        onClose={() => { setShowDeleteDialog(false); setDeleteError(null); }}
        onConfirm={handleDeleteAccount}
      />

      {/* Add store modal */}
      <AddStoreModal
        open={showAddStore}
        categories={allCategories}
        onClose={() => setShowAddStore(false)}
        onAdd={handleAddStore}
      />
    </div>
  );
}
