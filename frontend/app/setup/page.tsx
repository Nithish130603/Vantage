"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api, type FingerprintRequest } from "@/lib/api";
import { addUserStore } from "@/lib/stores";
import SuburbTagInput from "@/components/ui/SuburbTagInput";

// ── Constants ─────────────────────────────────────────────────────────────────
const FALLBACK_CATEGORIES = ["Gym & Fitness", "Café", "Pharmacy", "Restaurant", "Retail"];
const REGIONS = ["All Australia", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "China", "India", "Japan", "South Korea",
  "Singapore", "New Zealand", "Germany", "France", "Italy", "Spain", "Netherlands",
  "Sweden", "Norway", "Denmark", "Switzerland", "Austria", "Belgium", "Portugal",
  "Brazil", "Mexico", "Argentina", "Colombia", "Chile", "Peru",
  "South Africa", "Nigeria", "Kenya", "Egypt", "Morocco",
  "United Arab Emirates", "Saudi Arabia", "Israel", "Turkey", "Pakistan", "Bangladesh",
  "Indonesia", "Malaysia", "Thailand", "Vietnam", "Philippines", "Taiwan", "Hong Kong",
  "Russia", "Poland", "Czech Republic", "Hungary", "Romania", "Ukraine",
  "Ireland", "Scotland", "Finland", "Greece", "Other",
];
const DEMO_BEST  = ["Bondi Beach NSW", "Surry Hills NSW", "South Yarra VIC", "Fitzroy VIC", "New Farm QLD"];
const DEMO_WORST = ["Broken Hill NSW"];
const LOADING_MESSAGES = [
  "Initialising location engine…",
  "Decoding your success pattern…",
  "Vectorising commercial DNA…",
  "Scanning 7,734 Australian suburbs…",
  "Mapping high-opportunity zones…",
  "Calculating cosine similarity…",
  "Identifying expansion windows…",
  "Compiling intelligence report…",
];
type Situation = "A" | "B" | "C" | null;
function parseLocations(raw: string): string[] {
  return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

// ── Sidebar nav items ─────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { label: "Dashboard", active: true, path: "/setup",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg> },
  { label: "Insights", active: false, path: "/dna",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polyline points="1,11 5,6 8,9 14,3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="10,3 14,3 14,7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { label: "Exact Matches", active: false, path: "/map",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" strokeWidth="1.1"/><line x1="6.5" y1="4.5" x2="6.5" y2="8.5" stroke="currentColor" strokeWidth="1.1"/></svg> },
  { label: "Recommendations", active: false, path: "/recommendations",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polygon points="7.5,1 9.5,5.5 14.5,6 11,9.5 12,14.5 7.5,12 3,14.5 4,9.5 0.5,6 5.5,5.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg> },
  { label: "Avoid Zones", active: false, path: "/avoid",
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.2"/><line x1="3" y1="3" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
];

// ── Globe-to-map entrance transition ─────────────────────────────────────────
function GlobeTransition({ onComplete }: { onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const baseR = Math.min(canvas.width, canvas.height) * 0.36;

    const NODES = [
      { phi: 0.75, theta: 0.5  }, { phi: 1.20, theta: 2.1  },
      { phi: 0.50, theta: 1.3  }, { phi: 1.55, theta: 0.9  },
      { phi: 0.90, theta: 3.5  }, { phi: 1.10, theta: 4.2  },
      { phi: 0.40, theta: 5.1  }, { phi: 1.40, theta: 5.8  },
      { phi: 0.70, theta: 2.7  }, { phi: 1.30, theta: 1.6  },
      { phi: 0.60, theta: 0.2  }, { phi: 1.00, theta: 3.0  },
    ];
    const CONNECTIONS = [[0,2],[2,4],[1,3],[3,5],[6,8],[7,9],[0,6],[4,9],[10,2],[11,5],[1,10],[7,11]];

    function project(phi: number, theta: number, r: number) {
      return {
        x: cx + r * Math.sin(phi) * Math.cos(theta),
        y: cy + r * Math.cos(phi),
        z: Math.sin(phi) * Math.sin(theta),
      };
    }

    const FRAMES = 210;
    let t = 0;
    let raf: number;

    function draw() {
      if (!ctx || !canvas) return;
      const progress = t / FRAMES;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#020509";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let scale = 1, opacity = 1;
      if (progress < 0.3) {
        opacity = progress / 0.3;
        scale = 0.85 + 0.15 * (progress / 0.3);
      } else if (progress < 0.75) {
        opacity = 1; scale = 1;
      } else {
        const p = (progress - 0.75) / 0.25;
        scale = 1 + p * 4; opacity = 1 - p;
      }

      if (t >= FRAMES) { setVisible(false); onComplete(); return; }

      const r = baseR;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);

      const atmo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.55);
      atmo.addColorStop(0, "rgba(13,115,119,0.0)");
      atmo.addColorStop(0.4, "rgba(13,115,119,0.09)");
      atmo.addColorStop(1, "transparent");
      ctx.fillStyle = atmo;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2); ctx.fill();

      const rim = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.05);
      rim.addColorStop(0, "transparent");
      rim.addColorStop(0.7, "rgba(0,210,230,0.08)");
      rim.addColorStop(1, "rgba(0,210,230,0.22)");
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      const bodyGrd = ctx.createRadialGradient(cx - r*0.2, cy - r*0.2, 0, cx, cy, r);
      bodyGrd.addColorStop(0, "rgba(6,20,28,0.95)");
      bodyGrd.addColorStop(1, "rgba(2,8,14,0.99)");
      ctx.fillStyle = bodyGrd; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      for (let i = 1; i < 9; i++) {
        const angle = (i / 9) * Math.PI;
        const latR = r * Math.sin(angle), latY = cy + r * Math.cos(angle);
        const isEq = i === 4;
        ctx.beginPath();
        ctx.ellipse(cx, latY, latR, latR * 0.15, 0, 0, Math.PI * 2);
        ctx.strokeStyle = isEq ? "rgba(0,220,240,0.32)" : "rgba(60,180,200,0.14)";
        ctx.lineWidth = isEq ? 1.0 : 0.6; ctx.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI + t * 0.003;
        const xR = r * Math.abs(Math.cos(angle));
        ctx.beginPath();
        ctx.ellipse(cx, cy, xR, r, 0, 0, Math.PI * 2);
        ctx.strokeStyle = i === 0 ? "rgba(0,220,240,0.24)" : "rgba(60,180,200,0.09)";
        ctx.lineWidth = i === 0 ? 0.9 : 0.5; ctx.stroke();
      }
      ctx.restore();

      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,210,230,0.48)"; ctx.lineWidth = 1.2; ctx.stroke();

      const proj = NODES.map(({ phi, theta }) => project(phi, theta + t * 0.005, r));
      for (const [a, b] of CONNECTIONS) {
        const na = proj[a], nb = proj[b];
        if (na.z < 0 || nb.z < 0) continue;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.04 + a);
        const depth = (na.z + nb.z) * 0.5;
        const mx = (na.x + nb.x) / 2, my = (na.y + nb.y) / 2 - r * 0.1;
        ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.quadraticCurveTo(mx, my, nb.x, nb.y);
        ctx.strokeStyle = `rgba(0,210,230,${depth * 0.45 * pulse})`; ctx.lineWidth = 0.9; ctx.stroke();
      }
      for (const { x, y, z } of proj) {
        if (z < 0.02) continue;
        const depth = (z + 0.4) * 0.7, pulse = 1 + 0.25 * Math.sin(t * 0.08 + x * 0.01);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 14 * pulse);
        glow.addColorStop(0, `rgba(0,210,230,${depth * 0.28})`); glow.addColorStop(1, "transparent");
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 14 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100,240,255,${depth})`; ctx.fill();
      }

      ctx.restore();
      t++;
      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50" style={{ backgroundColor: "#020509" }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div className="absolute inset-0 flex items-end justify-center pb-16 pointer-events-none">
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.6, 0.6, 0] }}
          transition={{ duration: 3.5, times: [0, 0.15, 0.7, 1] }}
          style={{ fontSize: 10, letterSpacing: "0.35em", color: "rgba(0,210,230,0.6)", textTransform: "uppercase", fontFamily: "var(--font-geist-mono)" }}
        >
          Entering Terminal · Calibrating
        </motion.p>
      </div>
    </div>
  );
}

// ── Loading overlay ───────────────────────────────────────────────────────────
function LoadingOverlay({ visible }: { visible: boolean }) {
  const [msgIdx, setMsgIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!visible) { setMsgIdx(0); setProgress(0); return; }
    const id = setInterval(() => {
      setMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length);
      setProgress((p) => Math.min(p + 100 / LOADING_MESSAGES.length, 95));
    }, 1400);
    return () => clearInterval(id);
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    let t = 0, raf: number;
    const NODES = Array.from({ length: 18 }, () => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4 }));
    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const n of NODES) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
        if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
      }
      for (let i = 0; i < NODES.length; i++) for (let j = i + 1; j < NODES.length; j++) {
        const dx = NODES[i].x - NODES[j].x, dy = NODES[i].y - NODES[j].y, dist = Math.sqrt(dx*dx+dy*dy);
        if (dist < 220) {
          ctx.beginPath(); ctx.moveTo(NODES[i].x, NODES[i].y); ctx.lineTo(NODES[j].x, NODES[j].y);
          ctx.strokeStyle = `rgba(0,210,230,${(1 - dist/220)*0.18})`; ctx.lineWidth = 0.7; ctx.stroke();
        }
      }
      for (const n of NODES) {
        const pulse = 1 + 0.3 * Math.sin(t * 0.05 + n.x);
        ctx.beginPath(); ctx.arc(n.x, n.y, 2.5 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,210,230,0.55)"; ctx.fill();
      }
      t++; raf = requestAnimationFrame(draw);
    }
    draw(); return () => cancelAnimationFrame(raf);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ backgroundColor: "rgba(2,5,9,0.97)", fontFamily: "var(--font-geist-mono)" }}>
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          {[{top:24,left:24},{top:24,right:24},{bottom:24,left:24},{bottom:24,right:24}].map((pos,i)=>(
            <div key={i} className="absolute pointer-events-none" style={{...pos,width:28,height:28}}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                {i===0&&<path d="M0 14V0H14" stroke="rgba(0,210,230,0.4)" strokeWidth="1"/>}
                {i===1&&<path d="M28 14V0H14" stroke="rgba(0,210,230,0.4)" strokeWidth="1"/>}
                {i===2&&<path d="M0 14V28H14" stroke="rgba(0,210,230,0.4)" strokeWidth="1"/>}
                {i===3&&<path d="M28 14V28H14" stroke="rgba(0,210,230,0.4)" strokeWidth="1"/>}
              </svg>
            </div>
          ))}
          <div className="relative z-10 flex flex-col items-center gap-8 px-8 text-center max-w-md">
            <div className="relative w-20 h-20 flex items-center justify-center">
              <motion.div className="absolute inset-0 rounded-full" style={{ border: "1px solid rgba(0,210,230,0.5)" }}
                animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }} transition={{ duration: 2.2, repeat: Infinity }} />
              <motion.div className="absolute inset-2 rounded-full" style={{ border: "1px solid rgba(0,210,230,0.3)" }}
                animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0, 0.4] }} transition={{ duration: 2.2, repeat: Infinity, delay: 0.4 }} />
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: "#0DC5CC", boxShadow: "0 0 20px rgba(13,197,204,0.8)" }} />
            </div>
            <div>
              <p className="text-[11px] tracking-[0.3em] text-white/40 uppercase mb-3">Location Intelligence · Processing</p>
              <AnimatePresence mode="wait">
                <motion.p key={msgIdx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35 }} className="text-[15px] tracking-[0.08em]" style={{ color: "#0DC5CC" }}>
                  {LOADING_MESSAGES[msgIdx]}
                </motion.p>
              </AnimatePresence>
            </div>
            <div className="w-64 h-px relative" style={{ background: "rgba(255,255,255,0.06)" }}>
              <motion.div className="absolute inset-y-0 left-0 h-full"
                style={{ background: "linear-gradient(to right, #0D7377, #0DC5CC)", boxShadow: "0 0 8px rgba(13,197,204,0.6)" }}
                animate={{ width: `${progress}%` }} transition={{ duration: 0.5 }} />
            </div>
            <p className="text-[11px] tracking-[0.2em] text-white/30 uppercase">
              {LOADING_MESSAGES.indexOf(LOADING_MESSAGES[msgIdx]) + 1} / {LOADING_MESSAGES.length}
            </p>
          </div>
          <motion.div className="absolute inset-x-0 h-px pointer-events-none"
            style={{ background: "linear-gradient(to right, transparent 0%, rgba(0,210,230,0.4) 50%, transparent 100%)" }}
            animate={{ top: ["5%", "95%", "5%"] }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Styled select dropdown ────────────────────────────────────────────────────
function VantageSelect({ value, onChange, options, placeholder, loading: isLoading }: {
  value: string | null; onChange: (v: string) => void; options: string[]; placeholder?: string; loading?: boolean;
}) {
  return (
    <div className="relative" style={{ width: "100%" }}>
      {isLoading ? (
        <div style={{ height: 44, borderRadius: 4, background: "rgba(0,210,230,0.04)", border: "1px solid rgba(0,210,230,0.12)", animation: "pulse 1.5s ease-in-out infinite" }}/>
      ) : (
        <>
          <select
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            style={{
              width: "100%", appearance: "none", WebkitAppearance: "none",
              backgroundColor: value ? "rgba(0,210,230,0.07)" : "rgba(6,18,24,0.85)",
              border: value ? "1px solid rgba(0,210,230,0.45)" : "1px solid rgba(0,210,230,0.18)",
              borderRadius: 4, padding: "11px 40px 11px 14px",
              fontSize: 13, letterSpacing: "0.06em", fontFamily: "var(--font-geist-mono)",
              color: value ? "rgba(200,240,245,0.95)" : "rgba(0,210,230,0.45)",
              cursor: "pointer", outline: "none", transition: "all 0.15s ease",
              boxShadow: value ? "0 0 14px rgba(0,210,230,0.07)" : "none",
            }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(0,210,230,0.6)"; e.target.style.boxShadow = "0 0 20px rgba(0,210,230,0.1)"; }}
            onBlur={(e) => { e.target.style.borderColor = value ? "rgba(0,210,230,0.45)" : "rgba(0,210,230,0.18)"; e.target.style.boxShadow = value ? "0 0 14px rgba(0,210,230,0.07)" : "none"; }}
          >
            <option value="" disabled style={{ background: "#04090f", color: "rgba(0,210,230,0.45)" }}>{placeholder ?? "Select…"}</option>
            {options.map((o) => (
              <option key={o} value={o} style={{ background: "#04090f", color: "rgba(200,240,245,0.9)" }}>{o}</option>
            ))}
          </select>
          <div className="absolute pointer-events-none" style={{ right: 13, top: "50%", transform: "translateY(-50%)" }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 4l3.5 3.5L9 4" stroke={value ? "rgba(0,210,230,0.8)" : "rgba(0,210,230,0.35)"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const router = useRouter();

  const [transitionDone, setTransitionDone]   = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem("vantage_intro_done") === "1"
  );
  // True once the user has run at least one analysis this session
  const [analysisDone] = useState(
    () => typeof sessionStorage !== "undefined" && !!sessionStorage.getItem("vantage_dna")
  );
  const [lockedNudge, setLockedNudge] = useState(false);
  const [sidebarOpen, setSidebarOpen]         = useState(true);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories]             = useState<string[]>(FALLBACK_CATEGORIES);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [situation, setSituation]               = useState<Situation>(null);
  const [bestLocations, setBestLocations]       = useState<string[]>([]);
  const [worstLocations, setWorstLocations]     = useState<string[]>([]);
  const [overseasRaw, setOverseasRaw]           = useState("");
  const [selectedRegion, setSelectedRegion]     = useState("All Australia");
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState<string | null>(null);

  useEffect(() => {
    api.categories()
      .then((resp) => { if (resp.categories.length > 0) setCategories(resp.categories.map((c) => c.name)); })
      .catch(() => {})
      .finally(() => setCategoriesLoading(false));
  }, []);

  const canSubmit = selectedCategory !== null && !loading && (situation !== "A" || bestLocations.length > 0);

  async function runDemo() {
    setError(null); setLoading(true);
    try {
      const req: FingerprintRequest = { category: "Gym & Fitness", mode: "existing", best_locations: DEMO_BEST, worst_locations: DEMO_WORST, region: "All Australia" };
      const result = await api.fingerprint(req);
      sessionStorage.setItem("vantage_dna", JSON.stringify(result));
      sessionStorage.setItem("vantage_category", "Gym & Fitness");
      sessionStorage.setItem("vantage_region", "All Australia");
      sessionStorage.setItem("vantage_mode", "existing");
      router.push("/dna");
    } catch (e) { setError(e instanceof Error ? e.message : "Demo failed — is the backend running?"); }
    finally { setLoading(false); }
  }

  const handleSubmit = async () => {
    if (!selectedCategory) return;
    setError(null); setLoading(true);
    try {
      const mode = situation === "A" ? "existing" : situation === "C" ? "overseas" : "fresh";
      const best_locations  = situation === "A" ? bestLocations  : situation === "C" ? parseLocations(overseasRaw) : [];
      const worst_locations = situation === "A" ? worstLocations : [];
      const req: FingerprintRequest = { category: selectedCategory, mode, best_locations, worst_locations, region: selectedRegion };
      const result = await api.fingerprint(req);
      sessionStorage.setItem("vantage_dna", JSON.stringify(result));
      sessionStorage.setItem("vantage_category", selectedCategory);
      sessionStorage.setItem("vantage_region", selectedRegion);
      sessionStorage.setItem("vantage_mode", mode);

      // Auto-sync uploaded locations → user_stores (fire-and-forget)
      if (mode === "existing" && result.resolved_suburbs) {
        const resolved = result.resolved_suburbs as Record<string, string>;
        const toSync = [
          ...best_locations.filter((l) => resolved[l]).map((l) => ({ raw: l, performance: "best" as const })),
          ...worst_locations.filter((l) => resolved[l]).map((l) => ({ raw: l, performance: "worst" as const })),
        ];
        toSync.forEach(({ raw, performance }) => {
          const canonical = resolved[raw];
          const sep = canonical.lastIndexOf(", ");
          const locality = sep >= 0 ? canonical.slice(0, sep) : canonical;
          const state    = sep >= 0 ? canonical.slice(sep + 2) : "AU";
          addUserStore({ category: selectedCategory!, locality, state, performance }).catch(() => {});
        });
      }

      router.push("/dna");
    } catch (e) { setError(e instanceof Error ? e.message : "API error — is the backend running?"); }
    finally { setLoading(false); }
  };

  // Bento card style — matches reference design
  const bentoCard = (active: boolean): React.CSSProperties => ({
    background: active ? "rgba(8,38,48,0.88)" : "rgba(25,31,49,0.8)",
    backdropFilter: "blur(8px)",
    border: active ? "2px solid #00daf3" : "1px solid rgba(59,73,76,0.6)",
    borderRadius: 8,
    padding: 20,
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    cursor: "pointer",
    position: "relative",
    transition: "all 0.15s ease",
    boxShadow: active ? "0 0 20px rgba(0,218,243,0.1)" : "none",
  });

  const circleNum: React.CSSProperties = {
    width: 24, height: 24, borderRadius: "50%",
    background: "rgba(39,79,85,0.6)", color: "#00e5ff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontWeight: 700, border: "1px solid rgba(59,73,76,0.8)", flexShrink: 0,
  };

  const cardStyle: React.CSSProperties = {
    background: "rgba(21,27,45,0.7)", backdropFilter: "blur(12px)",
    borderRadius: 12, border: "1px solid rgba(193,234,241,0.2)",
    padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    position: "relative", overflow: "hidden",
  };

  const card2Style: React.CSSProperties = {
    background: "rgba(21,27,45,0.7)", backdropFilter: "blur(12px)",
    borderRadius: 12, border: "1px solid rgba(193,234,241,0.2)",
    padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  };

  const checkIcon = (
    <svg style={{ position: "absolute", top: 16, right: 16, color: "#00daf3", flexShrink: 0 }} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
      <polyline points="22,4 12,14.01 9,11.01"/>
    </svg>
  );

  return (
    <>
      {!transitionDone && <GlobeTransition onComplete={() => { sessionStorage.setItem("vantage_intro_done", "1"); setTransitionDone(true); }} />}
      <LoadingOverlay visible={loading} />

      <AnimatePresence>
        {transitionDone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="h-screen overflow-hidden flex"
            style={{ backgroundColor: "#0c1324", fontFamily: "var(--font-geist-mono)" }}
          >
            {/* ── BACKGROUND ─────────────────────────────────────────────── */}
            <div className="fixed inset-0 z-0 pointer-events-none">
              {/* top + bottom gradient vignette */}
              <div style={{
                position: "absolute", inset: 0, zIndex: 1,
                background: "linear-gradient(to top, #070d1f 0%, transparent 40%, rgba(7,13,31,0.8) 100%)",
              }}/>
              {/* CRT scan-line pattern */}
              <div style={{
                position: "absolute", inset: 0, zIndex: 1, opacity: 0.5,
                backgroundImage: "linear-gradient(to bottom, transparent 50%, rgba(0,218,243,0.05) 51%, transparent 51%)",
                backgroundSize: "100% 4px",
              }}/>
              {/* map image — same source as reference */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Dark cybernetic map visualization with glowing cyan nodes"
                style={{
                  width: "100%", height: "100%", objectFit: "cover",
                  opacity: 0.30, mixBlendMode: "screen",
                  filter: "grayscale(50%) sepia(20%) hue-rotate(180deg) brightness(1.1)",
                }}
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBxVxJUkoTJnYYytEG9CwAqyPSZOgNfXRXYZlgonWUufYOcIXLMGX-5nIEXk6V6z6Bf4EycLDxqcADbOroxC-8lyPc-PWh_xt18IZtER9xXDdYzT6sNwiqQqmtFgJZTiNxUraYuvVg1FKWmWhHKPt-nZYdTR4wpRZPAIm6xGkryA9eRbWFE0-OQph00VzR8a02D5aKhnU1f_51fPcX9lF2Xaumgh5piVLFicnu51cNOTOd47fvjhRafeBpQNUQlwMz5CeUlC2i9ZPc"
              />
            </div>

            {/* ═══════════════════════════════════════════════════════════
                COLLAPSIBLE SIDEBAR
            ═══════════════════════════════════════════════════════════ */}
            <motion.aside
              animate={{ width: sidebarOpen ? 218 : 60 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="relative z-20 flex flex-col shrink-0 overflow-hidden"
              style={{
                borderRight: "1px solid rgba(0,210,230,0.1)",
                background: "linear-gradient(180deg, rgba(5,10,20,0.98) 0%, rgba(4,8,18,0.98) 100%)",
                backdropFilter: "blur(10px)",
              }}
            >
              {/* Logo + Toggle */}
              <div className="flex items-center px-3.5 py-5 shrink-0"
                style={{ borderBottom: "1px solid rgba(0,210,230,0.09)", justifyContent: sidebarOpen ? "space-between" : "center" }}>
                <AnimatePresence>
                  {sidebarOpen && (
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
                {!sidebarOpen && (
                  <div className="w-7 h-7 rounded flex items-center justify-center"
                    style={{ background: "rgba(0,210,230,0.1)", border: "1px solid rgba(0,210,230,0.3)" }}>
                    <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="2" fill="#0DC5CC"/>
                      <circle cx="6" cy="6" r="5" stroke="#0DC5CC" strokeWidth="0.8" strokeDasharray="2 1.5"/>
                    </svg>
                  </div>
                )}
                {sidebarOpen && (
                  <button onClick={() => setSidebarOpen(false)}
                    className="w-7 h-7 rounded flex items-center justify-center transition-all"
                    style={{ color: "rgba(0,210,230,0.4)", border: "1px solid rgba(0,210,230,0.14)", background: "transparent" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#0DC5CC"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(0,210,230,0.4)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.14)"; }}>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7 2L4 5.5 7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                )}
              </div>

              {!sidebarOpen && (
                <button onClick={() => setSidebarOpen(true)} className="flex items-center justify-center mx-auto mt-3 w-8 h-8 rounded transition-all"
                  style={{ color: "rgba(0,210,230,0.5)", border: "1px solid rgba(0,210,230,0.18)", background: "rgba(0,210,230,0.04)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#0DC5CC"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.45)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(0,210,230,0.5)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.18)"; }}>
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M4 2l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )}

              {sidebarOpen && (
                <p className="px-5 pt-5 pb-2" style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(0,210,230,0.7)", fontWeight: 700 }}>
                  Navigation
                </p>
              )}

              <nav className="flex-1 px-2 space-y-0.5 mt-1">
                {NAV_ITEMS.map((item) => {
                  const locked = !item.active && !analysisDone;
                  return (
                    <div key={item.label}
                      onClick={() => {
                        if (item.active) return;
                        if (locked) {
                          setLockedNudge(true);
                          setTimeout(() => setLockedNudge(false), 2400);
                          return;
                        }
                        router.push(item.path);
                      }}
                      className="flex items-center rounded-sm transition-all duration-150"
                      style={{
                        gap: sidebarOpen ? 10 : 0, justifyContent: sidebarOpen ? "flex-start" : "center",
                        padding: sidebarOpen ? "9px 10px" : "9px 0",
                        background: item.active ? "rgba(0,210,230,0.08)" : "transparent",
                        borderLeft: item.active && sidebarOpen ? "2px solid rgba(0,210,230,0.7)" : "2px solid transparent",
                        color: item.active ? "#0DC5CC" : locked ? "rgba(200,230,235,0.28)" : "rgba(200,230,235,0.85)",
                        cursor: item.active ? "default" : locked ? "not-allowed" : "pointer",
                        opacity: locked ? 0.45 : 1,
                      }}>
                      <span style={{ opacity: item.active ? 1 : locked ? 0.4 : 0.65, flexShrink: 0 }}>{item.icon}</span>
                      <AnimatePresence>
                        {sidebarOpen && (
                          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.1 }} style={{ fontSize: 14, letterSpacing: "0.04em", whiteSpace: "nowrap", fontWeight: item.active ? 700 : 600 }}>
                            {item.label}
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {item.active && sidebarOpen && (
                        <motion.div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0DC5CC" }}
                          animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }} />
                      )}
                      {locked && sidebarOpen && (
                        <svg className="ml-auto" width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <rect x="1.5" y="4.5" width="7" height="5" rx="1" stroke="rgba(0,210,230,0.25)" strokeWidth="1"/>
                          <path d="M3 4.5V3a2 2 0 014 0v1.5" stroke="rgba(0,210,230,0.25)" strokeWidth="1" strokeLinecap="round"/>
                        </svg>
                      )}
                    </div>
                  );
                })}
              </nav>

              {/* Locked nudge */}
              <AnimatePresence>
                {lockedNudge && sidebarOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.18 }}
                    style={{ margin: "0 12px 8px", padding: "8px 10px", borderRadius: 3, background: "rgba(0,210,230,0.05)", border: "1px solid rgba(0,210,230,0.2)", borderLeft: "2px solid rgba(0,210,230,0.5)" }}
                  >
                    <p style={{ fontSize: 10, color: "rgba(0,210,230,0.75)", letterSpacing: "0.04em", lineHeight: 1.5 }}>
                      Complete the analysis first to unlock navigation.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {sidebarOpen && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="px-3 py-2.5 mx-3 mb-3 rounded-sm"
                    style={{ background: "rgba(0,210,230,0.04)", border: "1px solid rgba(0,210,230,0.1)" }}>
                    <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,210,230,0.75)", marginBottom: 6, fontWeight: 700 }}>System</p>
                    <div className="flex items-center gap-2">
                      <motion.div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0DC5CC" }}
                        animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.6, repeat:Infinity }} />
                      <span style={{ fontSize: 12, letterSpacing: "0.04em", color: "#0DC5CC", fontWeight: 600 }}>7,734 suburbs live</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {sidebarOpen && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="px-3 pb-4" style={{ borderTop: "1px solid rgba(0,210,230,0.08)", paddingTop: 12 }}>
                    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-sm"
                      onClick={() => router.push("/profile")}
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,210,230,0.1)", cursor: "pointer" }}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "rgba(0,210,230,0.1)", border: "1px solid rgba(0,210,230,0.3)" }}>
                        <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
                          <circle cx="5.5" cy="3.5" r="2" stroke="#0DC5CC" strokeWidth="1"/>
                          <path d="M1 10c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="#0DC5CC" strokeWidth="1" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <div>
                        <p style={{ fontSize: 13, color: "#FFFFFF", letterSpacing: "0.03em", fontWeight: 700 }}>User Profile</p>
                        <p style={{ fontSize: 11, letterSpacing: "0.06em", color: "#0DC5CC", marginTop: 2, fontWeight: 600 }}>Franchise Founder</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {!sidebarOpen && (
                <div className="flex justify-center pb-4 mt-auto">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(0,210,230,0.1)", border: "1px solid rgba(0,210,230,0.28)" }}>
                    <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
                      <circle cx="5.5" cy="3.5" r="2" stroke="#0DC5CC" strokeWidth="1"/>
                      <path d="M1 10c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="#0DC5CC" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                  </div>
                </div>
              )}
            </motion.aside>

            {/* ═══════════════════════════════════════════════════════════
                MAIN CONTENT + FOOTER
            ═══════════════════════════════════════════════════════════ */}
            <div className="relative z-10 flex-1 flex flex-col min-w-0 h-screen">

              {/* Scrollable content area */}
              <div className="flex-1 overflow-y-auto">
                <div style={{
                  maxWidth: 800, margin: "0 auto", padding: "48px 24px 24px",
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", minHeight: "calc(100vh - 32px)",
                }}>
                  <div style={{ width: "100%", maxWidth: 600, display: "flex", flexDirection: "column", gap: 24 }}>

                    {/* Header */}
                    <motion.header
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
                      style={{ textAlign: "center", marginBottom: 16 }}
                    >
                      <button onClick={runDemo}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 8,
                          fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase",
                          color: "rgba(0,210,230,0.7)", border: "1px solid rgba(0,210,230,0.22)",
                          borderRadius: 3, padding: "6px 13px", background: "rgba(0,210,230,0.04)",
                          cursor: "pointer", fontFamily: "var(--font-geist-mono)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,210,230,0.55)"; e.currentTarget.style.color = "#0DC5CC"; e.currentTarget.style.background = "rgba(0,210,230,0.08)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,210,230,0.22)"; e.currentTarget.style.color = "rgba(0,210,230,0.7)"; e.currentTarget.style.background = "rgba(0,210,230,0.04)"; }}
                      >
                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><polygon points="2,1 9,5 2,9" fill="currentColor"/></svg>
                        Demo — Gym &amp; Fitness
                      </button>
                    </motion.header>

                    {/* Card 1 — Your Business */}
                    <motion.section
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.10 }}
                      style={cardStyle}
                    >
                      {/* top shimmer line */}
                      <div style={{
                        position: "absolute", top: 0, left: 0, right: 0, height: 1,
                        background: "linear-gradient(to right, transparent, rgba(193,234,241,0.3), transparent)",
                      }}/>

                      <h2 style={{ fontSize: 24, fontWeight: 600, color: "#00daf3", marginBottom: 24, display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-geist-sans)" }}>
                        <span style={circleNum}>1</span>
                        Your Business
                      </h2>

                      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <label style={{ fontSize: 12, letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase", color: "#bac9cc" }}>
                            Business Type
                          </label>
                          <VantageSelect value={selectedCategory} onChange={setSelectedCategory}
                            options={categories} placeholder="Select sector…" loading={categoriesLoading} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <label style={{ fontSize: 12, letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase", color: "#bac9cc" }}>
                            Target Vector (Location)
                          </label>
                          <VantageSelect value={selectedRegion} onChange={setSelectedRegion} options={REGIONS} />
                        </div>
                      </div>
                    </motion.section>

                    {/* Card 2 — About You */}
                    <motion.section
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
                      style={card2Style}
                    >
                      <h2 style={{ fontSize: 24, fontWeight: 600, color: "#00daf3", marginBottom: 24, display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-geist-sans)" }}>
                        <span style={circleNum}>2</span>
                        About You
                      </h2>

                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                        {/* Bento A — I already have stores */}
                        <div onClick={() => setSituation("A")} style={bentoCard(situation === "A")}>
                          <div style={{
                            width: 40, height: 40, borderRadius: 4, flexShrink: 0,
                            background: situation === "A" ? "rgba(39,79,85,0.6)" : "rgba(46,52,71,0.8)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: situation === "A" ? "#00e5ff" : "#849396",
                            transition: "all 0.15s ease",
                          }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                              <polyline points="9,22 9,12 15,12 15,22"/>
                            </svg>
                          </div>
                          <div style={{ flex: 1 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#dce1fb", marginBottom: 4, fontFamily: "var(--font-geist-sans)" }}>I already have stores</h3>
                            <p style={{ fontSize: 14, color: "#bac9cc" }}>You have stores already — we&apos;ll find the best new spots without hurting your current ones.</p>
                            <AnimatePresence>
                              {situation === "A" && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                                  <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                                    <div>
                                      <p style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(0,210,230,0.95)", marginBottom: 8, fontWeight: 600 }}>Your best locations</p>
                                      <SuburbTagInput value={bestLocations} onChange={setBestLocations} placeholder="Type a suburb…" maxTags={20}/>
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 mb-2">
                                        <p style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(200,230,235,0.9)", fontWeight: 600 }}>Locations that didn't work</p>
                                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, color: "rgba(0,210,230,0.55)", border: "1px solid rgba(0,210,230,0.2)" }}>Optional</span>
                                      </div>
                                      <SuburbTagInput value={worstLocations} onChange={setWorstLocations} placeholder="Type a suburb…" maxTags={10} variant="danger"/>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          {situation === "A" && checkIcon}
                        </div>

                        {/* Bento B — I'm new to Australia */}
                        <div onClick={() => setSituation("B")} style={bentoCard(situation === "B")}>
                          <div style={{
                            width: 40, height: 40, borderRadius: 4, flexShrink: 0,
                            background: situation === "B" ? "rgba(39,79,85,0.6)" : "rgba(46,52,71,0.8)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: situation === "B" ? "#00e5ff" : "#849396",
                            transition: "all 0.15s ease",
                          }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 19V5M12 19l-5-5M12 19l5-5"/>
                              <line x1="5" y1="22" x2="19" y2="22"/>
                            </svg>
                          </div>
                          <div style={{ flex: 1 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#dce1fb", marginBottom: 4, fontFamily: "var(--font-geist-sans)" }}>I&apos;m opening my first store</h3>
                            <p style={{ fontSize: 14, color: "#bac9cc" }}>No stores yet? We&apos;ll show you the best areas to open your very first location in Australia.</p>
                          </div>
                          {situation === "B" && checkIcon}
                        </div>

                        {/* Bento C — I'm coming from overseas */}
                        <div onClick={() => setSituation("C")} style={bentoCard(situation === "C")}>
                          <div style={{
                            width: 40, height: 40, borderRadius: 4, flexShrink: 0,
                            background: situation === "C" ? "rgba(39,79,85,0.6)" : "rgba(46,52,71,0.8)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: situation === "C" ? "#00e5ff" : "#849396",
                            transition: "all 0.15s ease",
                          }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/>
                              <line x1="2" y1="12" x2="22" y2="12"/>
                              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                            </svg>
                          </div>
                          <div style={{ flex: 1 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 600, color: "#dce1fb", marginBottom: 4, fontFamily: "var(--font-geist-sans)" }}>I&apos;m coming from overseas</h3>
                            <p style={{ fontSize: 14, color: "#bac9cc" }}>Already running a business abroad? Tell us where, and we&apos;ll find similar spots in Australia.</p>
                            <AnimatePresence>
                              {situation === "C" && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                                  <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                                    <label style={{ display: "block", fontSize: 12, letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase", color: "rgba(0,210,230,0.95)", marginBottom: 8 }}>
                                      Which country are you coming from?
                                    </label>
                                    <div className="relative">
                                      <select
                                        value={overseasRaw}
                                        onChange={(e) => setOverseasRaw(e.target.value)}
                                        style={{
                                          width: "100%", appearance: "none", WebkitAppearance: "none",
                                          backgroundColor: overseasRaw ? "rgba(0,210,230,0.07)" : "rgba(6,18,24,0.85)",
                                          border: overseasRaw ? "1px solid rgba(0,210,230,0.45)" : "1px solid rgba(0,210,230,0.18)",
                                          borderRadius: 4, padding: "11px 40px 11px 14px",
                                          fontSize: 13, letterSpacing: "0.04em", fontFamily: "var(--font-geist-mono)",
                                          color: overseasRaw ? "rgba(200,240,245,0.95)" : "rgba(0,210,230,0.45)",
                                          cursor: "pointer", outline: "none", transition: "all 0.15s ease",
                                        }}
                                        onFocus={(e) => { e.target.style.borderColor = "rgba(0,210,230,0.6)"; }}
                                        onBlur={(e) => { e.target.style.borderColor = overseasRaw ? "rgba(0,210,230,0.45)" : "rgba(0,210,230,0.18)"; }}
                                      >
                                        <option value="" disabled style={{ background: "#04090f", color: "rgba(0,210,230,0.45)" }}>Select your country…</option>
                                        {COUNTRIES.map((c) => (
                                          <option key={c} value={c} style={{ background: "#04090f", color: "rgba(200,240,245,0.9)" }}>{c}</option>
                                        ))}
                                      </select>
                                      <div className="absolute pointer-events-none" style={{ right: 13, top: "50%", transform: "translateY(-50%)" }}>
                                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                                          <path d="M2 4l3.5 3.5L9 4" stroke={overseasRaw ? "rgba(0,210,230,0.8)" : "rgba(0,210,230,0.35)"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          {situation === "C" && checkIcon}
                        </div>

                      </div>
                    </motion.section>

                    {/* ANALYZE LOCATIONS button */}
                    <motion.div
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
                      style={{ display: "flex", justifyContent: "center" }}
                    >
                      <button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        style={{
                          width: "100%", maxWidth: 384,
                          background: canSubmit ? "rgba(0,218,243,0.2)" : "rgba(0,218,243,0.05)",
                          color: canSubmit ? "#00daf3" : "rgba(0,218,243,0.3)",
                          border: canSubmit ? "1px solid #00daf3" : "1px solid rgba(0,218,243,0.2)",
                          borderRadius: 4, padding: "16px 32px",
                          fontFamily: "var(--font-geist-mono)", fontSize: 12,
                          letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700,
                          cursor: canSubmit ? "pointer" : "not-allowed",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          backdropFilter: "blur(12px)",
                          boxShadow: canSubmit ? "0 0 15px rgba(0,218,243,0.3)" : "none",
                          transition: "all 0.3s ease",
                        }}
                        onMouseEnter={(e) => { if (!canSubmit) return; e.currentTarget.style.background = "rgba(0,218,243,0.3)"; e.currentTarget.style.boxShadow = "0 0 25px rgba(0,218,243,0.6)"; }}
                        onMouseLeave={(e) => { if (!canSubmit) return; e.currentTarget.style.background = "rgba(0,218,243,0.2)"; e.currentTarget.style.boxShadow = "0 0 15px rgba(0,218,243,0.3)"; }}
                      >
                        ANALYZE LOCATIONS
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                          <line x1="11" y1="8" x2="11" y2="14"/>
                          <line x1="8" y1="11" x2="14" y2="11"/>
                        </svg>
                      </button>
                    </motion.div>

                    {/* Error */}
                    {error && (
                      <div className="flex items-start gap-2 rounded px-4 py-3"
                        style={{ fontSize: 12, background: "rgba(127,29,29,0.18)", border: "1px solid rgba(153,27,27,0.35)", color: "#fca5a5" }}>
                        <span style={{ flexShrink: 0 }}>!</span> {error}
                      </div>
                    )}

                  </div>
                </div>
              </div>

              {/* ── FOOTER — reference style ──────────────────────────────── */}
              <footer style={{
                flexShrink: 0,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0 16px", height: 32,
                borderTop: "1px solid rgba(0,218,243,0.2)",
                background: "rgba(5,10,20,0.95)",
                backdropFilter: "blur(8px)",
                boxShadow: "0 -4px 12px rgba(0,0,0,0.5)",
                fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
                fontFamily: "var(--font-geist-mono)",
              }}>
                <span style={{ color: "#0DC5CC" }}>© 2026 VANTAGE · LOCATION INTELLIGENCE PLATFORM</span>
                <div style={{ display: "flex", gap: 24 }}>
                  <a href="#" style={{ color: "#475569", textDecoration: "none" }}>Privacy Policy</a>
                  <a href="#" style={{ color: "#0DC5CC", display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
                    <motion.span
                      style={{ width: 6, height: 6, borderRadius: "50%", background: "#0DC5CC", display: "inline-block" }}
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity }}
                    />
                    Service Status
                  </a>
                  <a href="#" style={{ color: "#475569", textDecoration: "none" }}>Node Map</a>
                </div>
              </footer>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Corner brackets */}
      {[{top:0,left:0},{top:0,right:0},{bottom:0,left:0},{bottom:0,right:0}].map((pos,i)=>(
        <div key={i} className="fixed z-10 pointer-events-none" style={{...pos,width:20,height:20}}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            {i===0&&<path d="M0 10V0H10" stroke="rgba(13,197,204,0.25)" strokeWidth="1"/>}
            {i===1&&<path d="M20 10V0H10" stroke="rgba(13,197,204,0.25)" strokeWidth="1"/>}
            {i===2&&<path d="M0 10V20H10" stroke="rgba(13,197,204,0.25)" strokeWidth="1"/>}
            {i===3&&<path d="M20 10V20H10" stroke="rgba(13,197,204,0.25)" strokeWidth="1"/>}
          </svg>
        </div>
      ))}

      {/* Scan line */}
      {transitionDone && (
        <motion.div className="fixed inset-x-0 h-px pointer-events-none z-20"
          style={{ background: "linear-gradient(to right, transparent 0%, rgba(0,210,230,0.35) 40%, rgba(0,210,230,0.6) 50%, rgba(0,210,230,0.35) 60%, transparent 100%)" }}
          animate={{ top: ["8%", "92%", "8%"] }} transition={{ duration: 9, repeat: Infinity, ease: "linear" }} />
      )}
    </>
  );
}
