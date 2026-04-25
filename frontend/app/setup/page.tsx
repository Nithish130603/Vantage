"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api, type FingerprintRequest } from "@/lib/api";
import SuburbTagInput from "@/components/ui/SuburbTagInput";

// ── Constants (unchanged) ─────────────────────────────────────────────────────
const FALLBACK_CATEGORIES = ["Gym & Fitness", "Café", "Pharmacy"];
const REGIONS = ["All Australia", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];
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
  { label: "Dashboard", active: true,
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/></svg> },
  { label: "Insights", active: false,
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polyline points="1,11 5,6 8,9 14,3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="10,3 14,3 14,7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { label: "Exact Matches", active: false,
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="4.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" strokeWidth="1.1"/><line x1="6.5" y1="4.5" x2="6.5" y2="8.5" stroke="currentColor" strokeWidth="1.1"/></svg> },
  { label: "Recommendations", active: false,
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><polygon points="7.5,1 9.5,5.5 14.5,6 11,9.5 12,14.5 7.5,12 3,14.5 4,9.5 0.5,6 5.5,5.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg> },
  { label: "Avoid Zones", active: false,
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.2"/><line x1="3" y1="3" x2="12" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
  { label: "Ask Vantage", active: false,
    icon: <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1 1h13v9H8.5L5 13V10H1V1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg> },
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
    let baseR = Math.min(canvas.width, canvas.height) * 0.36;

    // Same nodes as Screen 0
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

    // Total frames: ~3.5s at 60fps = 210 frames
    const FRAMES = 210;
    let t = 0;
    let raf: number;

    function draw() {
      if (!ctx || !canvas) return;
      const progress = t / FRAMES; // 0 → 1

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#020509";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Phase 1 (0–0.3): Globe appears from small
      // Phase 2 (0.3–0.75): Globe is stable, showing
      // Phase 3 (0.75–1.0): Globe expands & fades (zoom-into-globe)
      let scale = 1, opacity = 1;
      if (progress < 0.3) {
        opacity = progress / 0.3;
        scale = 0.85 + 0.15 * (progress / 0.3);
      } else if (progress < 0.75) {
        opacity = 1;
        scale = 1;
      } else {
        const p = (progress - 0.75) / 0.25;
        scale = 1 + p * 4;
        opacity = 1 - p;
      }

      if (t >= FRAMES) {
        setVisible(false);
        onComplete();
        return;
      }

      const r = baseR;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);

      // Atmosphere glow
      const atmo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.55);
      atmo.addColorStop(0, "rgba(13,115,119,0.0)");
      atmo.addColorStop(0.4, "rgba(13,115,119,0.09)");
      atmo.addColorStop(1, "transparent");
      ctx.fillStyle = atmo;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2); ctx.fill();

      // Rim light
      const rim = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.05);
      rim.addColorStop(0, "transparent");
      rim.addColorStop(0.7, "rgba(0,210,230,0.08)");
      rim.addColorStop(1, "rgba(0,210,230,0.22)");
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2); ctx.fill();

      // Globe body clip
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      const bodyGrd = ctx.createRadialGradient(cx - r*0.2, cy - r*0.2, 0, cx, cy, r);
      bodyGrd.addColorStop(0, "rgba(6,20,28,0.95)");
      bodyGrd.addColorStop(1, "rgba(2,8,14,0.99)");
      ctx.fillStyle = bodyGrd; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      // Lat lines
      for (let i = 1; i < 9; i++) {
        const angle = (i / 9) * Math.PI;
        const latR = r * Math.sin(angle), latY = cy + r * Math.cos(angle);
        const isEq = i === 4;
        ctx.beginPath();
        ctx.ellipse(cx, latY, latR, latR * 0.15, 0, 0, Math.PI * 2);
        ctx.strokeStyle = isEq ? "rgba(0,220,240,0.32)" : "rgba(60,180,200,0.14)";
        ctx.lineWidth = isEq ? 1.0 : 0.6;
        ctx.stroke();
      }
      // Lon lines
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI + t * 0.003;
        const xR = r * Math.abs(Math.cos(angle));
        ctx.beginPath();
        ctx.ellipse(cx, cy, xR, r, 0, 0, Math.PI * 2);
        ctx.strokeStyle = i === 0 ? "rgba(0,220,240,0.24)" : "rgba(60,180,200,0.09)";
        ctx.lineWidth = i === 0 ? 0.9 : 0.5;
        ctx.stroke();
      }
      ctx.restore();

      // Globe outline
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,210,230,0.48)"; ctx.lineWidth = 1.2; ctx.stroke();

      // Network nodes + arcs
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
      {/* "INITIALISING" text during transition */}
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

// ── Flat world-map canvas — matches Screen 0's palette exactly ────────────────
function WorldMapCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number, t = 0;

    // City nodes — approximate Mercator positions (x,y as fraction of viewport)
    const CITIES = [
      // AU (highlighted — these are what we score)
      { fx: 0.838, fy: 0.73,  bright: true,  label: "SYD" },
      { fx: 0.828, fy: 0.78,  bright: true,  label: "MEL" },
      { fx: 0.853, fy: 0.665, bright: false, label: "BNE" },
      { fx: 0.745, fy: 0.72,  bright: false, label: "PER" },
      // International
      { fx: 0.878, fy: 0.795, bright: false, label: "AKL" },
      { fx: 0.742, fy: 0.575, bright: true,  label: "SIN" },
      { fx: 0.843, fy: 0.365, bright: true,  label: "TYO" },
      { fx: 0.800, fy: 0.34,  bright: false, label: "SHA" },
      { fx: 0.648, fy: 0.465, bright: false, label: "MUM" },
      { fx: 0.588, fy: 0.43,  bright: true,  label: "DXB" },
      { fx: 0.472, fy: 0.275, bright: true,  label: "LON" },
      { fx: 0.482, fy: 0.305, bright: false, label: "PAR" },
      { fx: 0.234, fy: 0.34,  bright: true,  label: "NYC" },
      { fx: 0.114, fy: 0.395, bright: false, label: "LAX" },
      { fx: 0.52,  fy: 0.21,  bright: false, label: "MOS" },
    ];
    const CONNS = [
      [0,1],[0,5],[0,6],[5,6],[5,8],[8,9],[9,10],[10,12],[12,13],[10,11],[5,7],[6,7],[3,5],[2,5],[1,6],[10,14],
    ];

    function setup() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    setup();
    window.addEventListener("resize", setup);

    function draw() {
      if (!ctx || !canvas) return;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Base background — exactly Screen 0's color
      ctx.fillStyle = "#020509";
      ctx.fillRect(0, 0, W, H);

      // Subtle nebula-like atmospheric zones
      const zones = [
        { x: W*0.82, y: H*0.7, r: 280, c: "rgba(13,115,119,0.06)" },
        { x: W*0.47, y: H*0.3, r: 200, c: "rgba(0,100,140,0.05)" },
        { x: W*0.23, y: H*0.35,r: 180, c: "rgba(13,115,119,0.04)" },
        { x: W*0.74, y: H*0.58,r: 160, c: "rgba(0,80,120,0.05)" },
      ];
      for (const z of zones) {
        const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
        g.addColorStop(0, z.c); g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.fill();
      }

      // Flat world-map lat/lon grid — matches Screen 0's globe grid style
      const LAT_LINES = 7;
      for (let i = 0; i <= LAT_LINES; i++) {
        const y = H * (i / LAT_LINES);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y);
        const isEq = i === Math.floor(LAT_LINES / 2);
        ctx.strokeStyle = isEq ? "rgba(0,210,230,0.12)" : "rgba(60,180,200,0.055)";
        ctx.lineWidth = isEq ? 0.8 : 0.4;
        ctx.stroke();
      }
      const LON_LINES = 14;
      for (let i = 0; i <= LON_LINES; i++) {
        const x = W * (i / LON_LINES);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H);
        ctx.strokeStyle = i === 7 ? "rgba(0,210,230,0.1)" : "rgba(60,180,200,0.04)";
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }

      // Faint star field (same micro-dots as Screen 0)
      if (t === 0) {
        // Draw once — static stars
        for (let i = 0; i < 200; i++) {
          ctx.beginPath();
          ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 0.9 + 0.1, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200,220,240,${Math.random() * 0.3 + 0.04})`;
          ctx.fill();
        }
      }

      // Arc connections between cities
      for (const [a, b] of CONNS) {
        const ca = CITIES[a], cb = CITIES[b];
        const ax = ca.fx * W, ay = ca.fy * H;
        const bx = cb.fx * W, by = cb.fy * H;
        const mx = (ax + bx) / 2, my = (ay + by) / 2 - Math.hypot(bx - ax, by - ay) * 0.18;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.025 + a * 0.7);
        const alpha = (ca.bright || cb.bright ? 0.22 : 0.10) * pulse;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
        ctx.strokeStyle = `rgba(0,210,230,${alpha})`;
        ctx.lineWidth = 0.7; ctx.stroke();
      }

      // City nodes
      for (const city of CITIES) {
        const x = city.fx * W, y = city.fy * H;
        const pulse = 1 + 0.2 * Math.sin(t * 0.07 + x * 0.005);

        if (city.bright) {
          // Outer glow
          const glow = ctx.createRadialGradient(x, y, 0, x, y, 20 * pulse);
          glow.addColorStop(0, "rgba(0,210,230,0.22)");
          glow.addColorStop(1, "transparent");
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(x, y, 20 * pulse, 0, Math.PI * 2); ctx.fill();

          // Ring
          ctx.beginPath(); ctx.arc(x, y, 5 * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(0,220,240,0.55)"; ctx.lineWidth = 0.8; ctx.stroke();

          // Core
          ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(100,240,255,0.9)"; ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(x, y, 3 * pulse, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(0,210,230,0.28)"; ctx.lineWidth = 0.7; ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(80,200,220,0.55)"; ctx.fill();
        }
      }

      // Animated scan line — same as Screen 0
      const scanY = ((t * 1.2) % (H * 1.15)) - H * 0.07;
      const scanG = ctx.createLinearGradient(0, scanY - 6, 0, scanY + 6);
      scanG.addColorStop(0, "transparent");
      scanG.addColorStop(0.5, "rgba(0,210,230,0.18)");
      scanG.addColorStop(1, "transparent");
      ctx.fillStyle = scanG;
      ctx.fillRect(0, scanY - 6, W, 12);

      t++;
      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", setup);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// ── Loading overlay (unchanged) ───────────────────────────────────────────────
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

  const [transitionDone, setTransitionDone]   = useState(false);
  const [sidebarOpen, setSidebarOpen]         = useState(true);

  // All original state (untouched)
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

  const canSubmit = selectedCategory !== null && !loading;

  // All original handlers (untouched)
  async function runDemo() {
    setError(null); setLoading(true);
    try {
      const req: FingerprintRequest = { category: "Gym & Fitness", mode: "existing", best_locations: DEMO_BEST, worst_locations: DEMO_WORST, region: "All Australia" };
      const result = await api.fingerprint(req);
      sessionStorage.setItem("vantage_dna", JSON.stringify(result));
      sessionStorage.setItem("vantage_category", "Gym & Fitness");
      sessionStorage.setItem("vantage_region", "All Australia");
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
      router.push("/dna");
    } catch (e) { setError(e instanceof Error ? e.message : "API error — is the backend running?"); }
    finally { setLoading(false); }
  };

  // Card border style
  const situCard = (active: boolean): React.CSSProperties => ({
    borderRadius: 4,
    border: `1px solid ${active ? "rgba(0,210,230,0.45)" : "rgba(0,210,230,0.12)"}`,
    borderLeft: `2px solid ${active ? "#0DC5CC" : "rgba(0,210,230,0.12)"}`,
    backgroundColor: active ? "rgba(0,210,230,0.06)" : "rgba(4,12,20,0.72)",
    padding: "14px 16px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    backdropFilter: "blur(6px)",
    boxShadow: active ? "0 0 20px rgba(0,210,230,0.06)" : "none",
  });

  return (
    <>
      {/* Globe entrance transition */}
      {!transitionDone && <GlobeTransition onComplete={() => setTransitionDone(true)} />}

      <LoadingOverlay visible={loading} />

      <AnimatePresence>
        {transitionDone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="h-screen overflow-hidden flex"
            style={{ backgroundColor: "#020509", fontFamily: "var(--font-geist-mono)" }}
          >
            {/* ── BACKGROUND ─────────────────────────────────────────────── */}
            <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
              <WorldMapCanvas />
              {/* Edge vignette — same as Screen 0 */}
              <div style={{
                position: "absolute", inset: 0,
                background: "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 30%, rgba(2,5,9,0.72) 100%)",
              }}/>
            </div>

            {/* ═══════════════════════════════════════════════════════════
                COLLAPSIBLE SIDEBAR — Screen 0 palette
            ═══════════════════════════════════════════════════════════ */}
            <motion.aside
              animate={{ width: sidebarOpen ? 218 : 60 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="relative z-10 flex flex-col shrink-0 overflow-hidden"
              style={{
                borderRight: "1px solid rgba(0,210,230,0.1)",
                background: "linear-gradient(180deg, rgba(2,7,14,0.98) 0%, rgba(2,5,10,0.98) 100%)",
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

              {/* Expand button (collapsed state) */}
              {!sidebarOpen && (
                <button onClick={() => setSidebarOpen(true)} className="flex items-center justify-center mx-auto mt-3 w-8 h-8 rounded transition-all"
                  style={{ color: "rgba(0,210,230,0.5)", border: "1px solid rgba(0,210,230,0.18)", background: "rgba(0,210,230,0.04)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#0DC5CC"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.45)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(0,210,230,0.5)"; e.currentTarget.style.borderColor = "rgba(0,210,230,0.18)"; }}>
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M4 2l3 3.5-3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )}

              {/* Nav label */}
              {sidebarOpen && (
                <p className="px-5 pt-5 pb-2" style={{ fontSize: 10, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(0,210,230,0.7)", fontWeight: 700 }}>
                  Navigation
                </p>
              )}

              {/* Nav items */}
              <nav className="flex-1 px-2 space-y-0.5 mt-1">
                {NAV_ITEMS.map((item) => (
                  <div key={item.label}
                    className="flex items-center rounded-sm transition-all duration-150"
                    style={{
                      gap: sidebarOpen ? 10 : 0, justifyContent: sidebarOpen ? "flex-start" : "center",
                      padding: sidebarOpen ? "9px 10px" : "9px 0",
                      background: item.active ? "rgba(0,210,230,0.08)" : "transparent",
                      borderLeft: item.active && sidebarOpen ? "2px solid rgba(0,210,230,0.7)" : "2px solid transparent",
                      color: item.active ? "#0DC5CC" : "rgba(200,230,235,0.85)",
                    }}>
                    <span style={{ opacity: item.active ? 1 : 0.65, flexShrink: 0 }}>{item.icon}</span>
                    <AnimatePresence>
                      {sidebarOpen && (
                        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }} style={{ fontSize: 14, letterSpacing: "0.04em", whiteSpace: "nowrap", fontWeight: 600 }}>
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {item.active && sidebarOpen && (
                      <motion.div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0DC5CC" }}
                        animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }} />
                    )}
                  </div>
                ))}
              </nav>

              {/* System status */}
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

              {/* User profile */}
              <AnimatePresence>
                {sidebarOpen && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="px-3 pb-4" style={{ borderTop: "1px solid rgba(0,210,230,0.08)", paddingTop: 12 }}>
                    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-sm"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,210,230,0.1)" }}>
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
                MAIN CONTENT
            ═══════════════════════════════════════════════════════════ */}
            <div className="relative z-10 flex-1 flex flex-col min-w-0">

              {/* Top bar — Screen 0 style */}
              <div className="flex items-center justify-between px-6 py-3.5 shrink-0"
                style={{ borderBottom: "1px solid rgba(0,210,230,0.1)", background: "rgba(2,5,9,0.65)", backdropFilter: "blur(8px)" }}>
                <div>
                  <p style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(0,210,230,0.95)", marginBottom: 4, fontWeight: 600 }}>
                    Vantage · Location Intelligence
                  </p>
                  <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "0.01em", color: "#FFFFFF", fontFamily: "var(--font-geist-sans)" }}>
                    Where should your next store go?
                  </h1>
                </div>
                <div className="flex items-center gap-5">
                  <button onClick={runDemo}
                    className="flex items-center gap-2 transition-all"
                    style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(0,210,230,0.7)", border: "1px solid rgba(0,210,230,0.22)", borderRadius: 3, padding: "6px 13px", background: "rgba(0,210,230,0.04)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(0,210,230,0.55)"; e.currentTarget.style.color = "#0DC5CC"; e.currentTarget.style.background = "rgba(0,210,230,0.08)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(0,210,230,0.22)"; e.currentTarget.style.color = "rgba(0,210,230,0.7)"; e.currentTarget.style.background = "rgba(0,210,230,0.04)"; }}>
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><polygon points="2,1 9,5 2,9" fill="currentColor"/></svg>
                    Demo — Gym &amp; Fitness
                  </button>
                  <div className="flex items-center gap-2">
                    <motion.span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0D9BA0" }}
                      animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
                    <span style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(0,155,160,0.85)" }}>System Online</span>
                  </div>
                </div>
              </div>

              {/* ── TWO-COLUMN BODY ────────────────────────────────────────── */}
              <div className="flex-1 flex min-h-0 overflow-hidden">

                {/* LEFT COLUMN — config cards */}
                <div className="flex-1 overflow-y-auto px-6 py-5 min-w-0">
                  <div style={{ maxWidth: 620 }}>

                    {/* Card 1: Engine Configuration */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
                      className="rounded" style={{ marginBottom: 14, border: "1px solid rgba(0,210,230,0.14)", background: "rgba(2,8,16,0.72)", backdropFilter: "blur(10px)", padding: "18px 20px" }}>
                      <div className="flex items-center gap-2.5 mb-5">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <circle cx="7" cy="7" r="3" stroke="#0DC5CC" strokeWidth="1"/>
                          <circle cx="7" cy="7" r="6" stroke="rgba(0,210,230,0.4)" strokeWidth="0.7" strokeDasharray="2 1.5"/>
                        </svg>
                        <p style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: "#0DC5CC", fontWeight: 700 }}>
                          Step 1 — Your Business
                        </p>
                      </div>

                      {/* Industry + Region side-by-side */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(0,210,230,0.95)", marginBottom: 10, fontWeight: 600 }}>
                            What type of business? {!selectedCategory && <span style={{ color: "#0DC5CC", fontSize: 10 }}>· Pick one</span>}
                          </p>
                          <VantageSelect value={selectedCategory} onChange={setSelectedCategory}
                            options={categories} placeholder="Select industry…" loading={categoriesLoading} />
                        </div>
                        <div>
                          <p style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(0,210,230,0.95)", marginBottom: 10, fontWeight: 600 }}>
                            Where in Australia?
                          </p>
                          <VantageSelect value={selectedRegion} onChange={setSelectedRegion} options={REGIONS} />
                        </div>
                      </div>
                    </motion.div>

                    {/* Card 2: Your Situation */}
                    <motion.div
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}
                      className="rounded" style={{ border: "1px solid rgba(0,210,230,0.14)", background: "rgba(2,8,16,0.72)", backdropFilter: "blur(10px)", padding: "18px 20px" }}>
                      <div className="flex items-center gap-2.5 mb-5">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <polygon points="7,1 8.5,5.5 13,6 9.5,9 10.5,13.5 7,11 3.5,13.5 4.5,9 1,6 5.5,5.5" stroke="#0DC5CC" strokeWidth="0.9" strokeLinejoin="round"/>
                        </svg>
                        <p style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: "#0DC5CC", fontWeight: 700 }}>
                          Step 2 — About You
                        </p>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

                        {/* Card A */}
                        <div onClick={() => setSituation("A")} style={situCard(situation === "A")}>
                          <div className="flex items-center gap-2.5 mb-1">
                            <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                              style={{ border: `1.5px solid ${situation==="A" ? "#0DC5CC" : "rgba(0,210,230,0.35)"}` }}>
                              {situation==="A" && <div className="w-2 h-2 rounded-full" style={{ backgroundColor:"#0DC5CC" }}/>}
                            </div>
                            <p style={{ fontSize: 16, color: "#FFFFFF", fontFamily: "var(--font-geist-sans)", fontWeight: 600 }}>I already have stores</p>
                          </div>
                          <p style={{ fontSize: 13, color: "rgba(0,210,230,0.85)", marginLeft: 26 }}>Use your best locations to find similar ones</p>
                          <AnimatePresence>
                            {situation === "A" && (
                              <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:"auto" }} exit={{ opacity:0, height:0 }} transition={{ duration:0.22 }} className="overflow-hidden">
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

                        {/* Card B */}
                        <div onClick={() => setSituation("B")} style={situCard(situation === "B")}>
                          <div className="flex items-center gap-2.5 mb-1">
                            <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                              style={{ border: `1.5px solid ${situation==="B" ? "#0DC5CC" : "rgba(0,210,230,0.35)"}` }}>
                              {situation==="B" && <div className="w-2 h-2 rounded-full" style={{ backgroundColor:"#0DC5CC" }}/>}
                            </div>
                            <p style={{ fontSize: 16, color: "#FFFFFF", fontFamily: "var(--font-geist-sans)", fontWeight: 600 }}>I'm new to Australia</p>
                          </div>
                          <p style={{ fontSize: 13, color: "rgba(0,210,230,0.85)", marginLeft: 26 }}>
                            We'll use top-performing {selectedCategory ? selectedCategory.toLowerCase() : "business"} location data to guide you
                          </p>
                        </div>

                        {/* Card C */}
                        <div onClick={() => setSituation("C")} style={situCard(situation === "C")}>
                          <div className="flex items-center gap-2.5 mb-1">
                            <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                              style={{ border: `1.5px solid ${situation==="C" ? "#0DC5CC" : "rgba(0,210,230,0.35)"}` }}>
                              {situation==="C" && <div className="w-2 h-2 rounded-full" style={{ backgroundColor:"#0DC5CC" }}/>}
                            </div>
                            <p style={{ fontSize: 16, color: "#FFFFFF", fontFamily: "var(--font-geist-sans)", fontWeight: 600 }}>I'm coming from overseas</p>
                          </div>
                          <p style={{ fontSize: 13, color: "rgba(0,210,230,0.85)", marginLeft: 26 }}>We'll match your overseas success to the best Australian suburbs</p>
                          <AnimatePresence>
                            {situation === "C" && (
                              <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:"auto" }} exit={{ opacity:0, height:0 }} transition={{ duration:0.22 }} className="overflow-hidden">
                                <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                                  <textarea rows={3} value={overseasRaw} onChange={(e) => setOverseasRaw(e.target.value)}
                                    placeholder="Manhattan NY, Brooklyn NY, Chicago IL"
                                    style={{ width:"100%", backgroundColor:"rgba(2,8,16,0.8)", border:"1px solid rgba(0,210,230,0.18)", borderRadius:4, padding:"10px 12px", fontSize:12, color:"rgba(200,235,240,0.88)", fontFamily:"var(--font-geist-mono)", resize:"none", outline:"none" }}
                                    onFocus={(e) => (e.target.style.borderColor = "rgba(0,210,230,0.5)")}
                                    onBlur={(e) => (e.target.style.borderColor = "rgba(0,210,230,0.18)")}/>
                                  <p style={{ fontSize: 10, marginTop: 5, color: "rgba(0,210,230,0.38)" }}>Your home-country locations — optional</p>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                      </div>
                    </motion.div>

                    {/* Error */}
                    {error && (
                      <div className="flex items-start gap-2 rounded px-4 py-3 mt-3"
                        style={{ fontSize: 12, background:"rgba(127,29,29,0.18)", border:"1px solid rgba(153,27,27,0.35)", color:"#fca5a5" }}>
                        <span style={{ flexShrink:0 }}>!</span> {error}
                      </div>
                    )}

                  </div>
                </div>

                {/* RIGHT PANEL — sticky CTA */}
                <motion.div
                  initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 }}
                  className="shrink-0 py-5 pr-5 pl-3"
                  style={{ width: 268 }}>

                  <div style={{ position: "sticky", top: 20, display: "flex", flexDirection: "column", gap: 10 }}>

                  {/* ── CTA CARD ─────────────────────────────────────────── */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
                    style={{
                      border: `1px solid ${canSubmit ? "rgba(0,210,230,0.28)" : "rgba(0,210,230,0.09)"}`,
                      background: "rgba(2,8,16,0.9)",
                      backdropFilter: "blur(14px)",
                      borderRadius: 6,
                      padding: "18px 18px 16px",
                      transition: "border-color 0.35s ease, box-shadow 0.35s ease",
                      boxShadow: canSubmit ? "0 0 60px rgba(0,210,230,0.07), 0 0 120px rgba(0,210,230,0.03)" : "none",
                      position: "relative",
                      overflow: "hidden",
                    }}>

                    {/* Corner accents */}
                    {canSubmit && [
                      { top: 0, left: 0, borderTop: "1px solid rgba(0,210,230,0.45)", borderLeft: "1px solid rgba(0,210,230,0.45)" },
                      { top: 0, right: 0, borderTop: "1px solid rgba(0,210,230,0.45)", borderRight: "1px solid rgba(0,210,230,0.45)" },
                      { bottom: 0, left: 0, borderBottom: "1px solid rgba(0,210,230,0.45)", borderLeft: "1px solid rgba(0,210,230,0.45)" },
                      { bottom: 0, right: 0, borderBottom: "1px solid rgba(0,210,230,0.45)", borderRight: "1px solid rgba(0,210,230,0.45)" },
                    ].map((s, i) => (
                      <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.05 }}
                        style={{ position: "absolute", width: 10, height: 10, ...s }} />
                    ))}

                    {/* Status chip */}
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
                      <motion.div
                        style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: canSubmit ? "#0DC5CC" : "rgba(0,210,230,0.2)", flexShrink: 0 }}
                        animate={canSubmit ? { opacity: [1, 0.25, 1] } : { opacity: 0.2 }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      />
                      <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", color: canSubmit ? "rgba(0,210,230,0.75)" : "rgba(0,210,230,0.25)", fontWeight: 700 }}>
                        {canSubmit ? "Ready for Analysis" : "Configure above"}
                      </p>
                    </div>

                    {/* Industry display */}
                    <div style={{ minHeight: 58, marginBottom: 16 }}>
                      <AnimatePresence mode="wait">
                        {canSubmit ? (
                          <motion.div key="active" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22 }}>
                            <p style={{ fontFamily: "var(--font-fraunces)", fontSize: 24, fontWeight: 300, color: "#F0F0F2", lineHeight: 1.2, marginBottom: 5 }}>
                              {selectedCategory}
                            </p>
                            <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 10, color: "rgba(0,210,230,0.5)", letterSpacing: "0.08em" }}>
                              {selectedRegion} · 7,734 suburbs
                            </p>
                          </motion.div>
                        ) : (
                          <motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            style={{ fontFamily: "var(--font-fraunces)", fontSize: 20, fontWeight: 300, color: "rgba(200,230,235,0.14)", lineHeight: 1.35 }}>
                            Select industry<br />to begin
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* ── THE BUTTON ── */}
                    <motion.button
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      style={{
                        width: "100%",
                        padding: "13px 0",
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 4,
                        fontFamily: "var(--font-geist-mono)",
                        fontSize: 11,
                        letterSpacing: "0.24em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                        background: "transparent",
                        border: `1px solid ${canSubmit ? "#0DC5CC" : "rgba(0,210,230,0.1)"}`,
                        color: canSubmit ? "#0DC5CC" : "rgba(0,210,230,0.18)",
                        cursor: canSubmit ? "pointer" : "not-allowed",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        boxShadow: canSubmit
                          ? "0 0 20px rgba(0,210,230,0.12), inset 0 0 18px rgba(0,210,230,0.04)"
                          : "none",
                        transition: "box-shadow 0.2s ease",
                      }}
                      whileHover={canSubmit ? { scale: 1.015 } : {}}
                      whileTap={canSubmit ? { scale: 0.985 } : {}}
                      onMouseEnter={(e) => {
                        if (!canSubmit) return;
                        e.currentTarget.style.background = "rgba(0,210,230,0.06)";
                        e.currentTarget.style.boxShadow = "0 0 36px rgba(0,210,230,0.22), inset 0 0 28px rgba(0,210,230,0.08)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.boxShadow = canSubmit ? "0 0 20px rgba(0,210,230,0.12), inset 0 0 18px rgba(0,210,230,0.04)" : "none";
                      }}>
                      {/* Breathing inner glow */}
                      {canSubmit && (
                        <motion.div
                          style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(0,210,230,0.07) 0%, transparent 55%)", pointerEvents: "none" }}
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                        />
                      )}
                      <span style={{ position: "relative" }}>Analyse Locations</span>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ position: "relative" }}>
                        <path d="M1 11L11 1M11 1H4M11 1V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </motion.button>

                    {canSubmit && (
                      <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, textAlign: "center", marginTop: 9, color: "rgba(0,210,230,0.28)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                        Data science–driven · {selectedRegion}
                      </p>
                    )}
                  </motion.div>

                  {/* ── YOUR CHOICES ─────────────────────────────────────── */}
                  <motion.div
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}
                    style={{ padding: "14px 16px", border: "1px solid rgba(0,210,230,0.09)", borderRadius: 6, background: "rgba(2,8,16,0.75)", backdropFilter: "blur(8px)" }}>
                    <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.26em", textTransform: "uppercase", color: "rgba(0,210,230,0.45)", marginBottom: 12, fontWeight: 700 }}>Your Choices</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[
                        { label: "Industry", val: selectedCategory ?? "—", active: !!selectedCategory },
                        { label: "Region",   val: selectedRegion,           active: true },
                        { label: "Mode",     val: situation === "A" ? "Scale Existing" : situation === "B" ? "Start Fresh" : situation === "C" ? "Enter Australia" : "—", active: !!situation },
                      ].map((row) => (
                        <div key={row.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(0,210,230,0.4)", fontWeight: 700, flexShrink: 0 }}>{row.label}</p>
                          <p style={{ fontFamily: "var(--font-geist-mono)", fontSize: 11, color: row.active ? "#F0F0F2" : "rgba(200,230,235,0.2)", fontWeight: row.active ? 600 : 400, textAlign: "right" }}>{row.val}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>

                  </div>
                </motion.div>
              </div>

              {/* ── HORIZONTAL PROCESS STEPS — bottom bar ─────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                className="shrink-0 flex items-center px-6 py-3"
                style={{ borderTop: "1px solid rgba(0,210,230,0.1)", background: "rgba(2,5,9,0.72)", backdropFilter: "blur(8px)" }}>

                <p style={{ fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(0,210,230,0.75)", marginRight: 20, whiteSpace: "nowrap", fontWeight: 700 }}>
                  How it works
                </p>

                <div className="flex items-center gap-0 flex-1">
                  {[
                    { n: "01", t: "Decode DNA",     d: "Extract commercial fingerprint" },
                    { n: "02", t: "Scan Australia",  d: "Score 7,734 suburbs" },
                    { n: "03", t: "Find the Gap",    d: "Surface high-opportunity zones" },
                  ].map((step, i) => (
                    <div key={step.n} className="flex items-center">
                      <div className="flex items-center gap-2.5 px-4 py-2 rounded"
                        style={{ background: "rgba(0,210,230,0.04)", border: "1px solid rgba(0,210,230,0.1)" }}>
                        <span style={{ fontSize: 12, color: "#0DC5CC", letterSpacing: "0.1em", fontWeight: 700, flexShrink: 0 }}>{step.n}</span>
                        <div>
                          <p style={{ fontSize: 13, color: "#FFFFFF", lineHeight: 1, letterSpacing: "0.03em", fontWeight: 600 }}>{step.t}</p>
                          <p style={{ fontSize: 11, color: "rgba(0,210,230,0.7)", marginTop: 3, letterSpacing: "0.02em" }}>{step.d}</p>
                        </div>
                      </div>
                      {i < 2 && (
                        <div className="flex items-center px-3">
                          <div style={{ width: 20, height: 1, background: "rgba(0,210,230,0.25)" }}/>
                          <svg width="6" height="8" viewBox="0 0 6 8" fill="none" style={{ marginLeft: -1 }}>
                            <path d="M1 1l4 3-4 3" stroke="rgba(0,210,230,0.4)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Scan line indicator — matches Screen 0 */}
                <div className="flex items-center gap-2 ml-auto pl-4">
                  <div style={{ width:1, height:24, background:"rgba(0,210,230,0.15)" }}/>
                  <div>
                    <p style={{ fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(0,210,230,0.35)" }}>V.04.2-ALPHA</p>
                  </div>
                </div>

              </motion.div>

            </div>{/* end main */}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Corner brackets — same as Screen 0 */}
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

      {/* Scan line — same as Screen 0 */}
      {transitionDone && (
        <motion.div className="fixed inset-x-0 h-px pointer-events-none z-20"
          style={{ background: "linear-gradient(to right, transparent 0%, rgba(0,210,230,0.35) 40%, rgba(0,210,230,0.6) 50%, rgba(0,210,230,0.35) 60%, transparent 100%)" }}
          animate={{ top: ["8%", "92%", "8%"] }} transition={{ duration: 9, repeat: Infinity, ease: "linear" }} />
      )}
    </>
  );
}
