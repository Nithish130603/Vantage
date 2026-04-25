"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export default function LandingPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [coords, setCoords] = useState({ lat: "−33.8688", lon: "151.2093" });

  useEffect(() => {
    const AU_COORDS = [
      { lat: "−33.8688", lon: "151.2093" },
      { lat: "−37.8136", lon: "144.9631" },
      { lat: "−27.4698", lon: "153.0251" },
      { lat: "−31.9505", lon: "115.8605" },
      { lat: "−34.9285", lon: "138.6007" },
    ];
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % AU_COORDS.length;
      setCoords(AU_COORDS[i]);
    }, 2800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let t = 0;

    // Stars — generated once
    const STARS: { x: number; y: number; r: number; op: number; twinkle: number }[] = [];

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Regenerate stars on resize
      STARS.length = 0;
      for (let i = 0; i < 320; i++) {
        STARS.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.1 + 0.1,
          op: Math.random() * 0.55 + 0.05,
          twinkle: Math.random() * Math.PI * 2,
        });
      }
    }
    resize();
    window.addEventListener("resize", resize);

    const CX = () => canvas!.width / 2;
    const CY = () => canvas!.height / 2;
    const R  = () => Math.min(canvas!.width, canvas!.height) * 0.36;

    // Network nodes fixed on sphere surface
    const NODES = [
      { phi: 0.75, theta: 0.5  },
      { phi: 1.20, theta: 2.1  },
      { phi: 0.50, theta: 1.3  },
      { phi: 1.55, theta: 0.9  },
      { phi: 0.90, theta: 3.5  },
      { phi: 1.10, theta: 4.2  },
      { phi: 0.40, theta: 5.1  },
      { phi: 1.40, theta: 5.8  },
      { phi: 0.70, theta: 2.7  },
      { phi: 1.30, theta: 1.6  },
      { phi: 0.60, theta: 0.2  },
      { phi: 1.00, theta: 3.0  },
    ];
    const CONNECTIONS = [[0,2],[2,4],[1,3],[3,5],[6,8],[7,9],[0,6],[4,9],[10,2],[11,5],[1,10],[7,11]];

    function project(phi: number, theta: number, r: number, cx: number, cy: number) {
      const x = cx + r * Math.sin(phi) * Math.cos(theta);
      const y = cy + r * Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      return { x, y, z };
    }

    // Draw a great-circle arc between two projected points (curves over sphere)
    function drawArc(
      c: CanvasRenderingContext2D,
      ax: number, ay: number,
      bx: number, by: number,
      r: number,
      color: string,
      width: number
    ) {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2 - r * 0.10;
      c.beginPath();
      c.moveTo(ax, ay);
      c.quadraticCurveTo(mx, my, bx, by);
      c.strokeStyle = color;
      c.lineWidth = width;
      c.stroke();
    }

    function drawFrame() {
      if (!canvas || !ctx) return;
      const cx = CX(), cy = CY(), r = R();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // ── 1. STARFIELD ──────────────────────────────────────────────────
      for (const s of STARS) {
        const tw = 0.5 + 0.5 * Math.sin(s.twinkle + t * 0.018);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,220,240,${s.op * tw})`;
        ctx.fill();
      }

      // ── 2. GLOBE ATMOSPHERE (outer glow layers) ───────────────────────
      // Deep halo
      const atmo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.55);
      atmo.addColorStop(0,   "rgba(13,115,119,0.0)");
      atmo.addColorStop(0.4, "rgba(13,115,119,0.07)");
      atmo.addColorStop(0.75,"rgba(14,80,100,0.04)");
      atmo.addColorStop(1,   "transparent");
      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
      ctx.fill();

      // Rim light — bright cyan ring at globe edge
      const rim = ctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.05);
      rim.addColorStop(0, "transparent");
      rim.addColorStop(0.7,"rgba(0,210,230,0.07)");
      rim.addColorStop(1,  "rgba(0,210,230,0.18)");
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
      ctx.fill();

      // Specular highlight (top-left light source)
      const spec = ctx.createRadialGradient(cx - r*0.28, cy - r*0.32, 0, cx - r*0.28, cy - r*0.32, r * 0.65);
      spec.addColorStop(0,   "rgba(120,210,220,0.09)");
      spec.addColorStop(0.5, "rgba(40,160,180,0.03)");
      spec.addColorStop(1,   "transparent");
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // ── 3. GLOBE BODY (clipping region) ──────────────────────────────
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      // Dark fill
      const bodyGrd = ctx.createRadialGradient(cx - r*0.2, cy - r*0.2, 0, cx, cy, r);
      bodyGrd.addColorStop(0, "rgba(6,20,28,0.92)");
      bodyGrd.addColorStop(1, "rgba(2,8,14,0.97)");
      ctx.fillStyle = bodyGrd;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

      // ── LATITUDE LINES (bright, visible grid) ─────────────────────────
      const LAT_RINGS = 9; // more rings = denser grid
      for (let i = 1; i < LAT_RINGS; i++) {
        const angle = (i / LAT_RINGS) * Math.PI;
        const latR = r * Math.sin(angle);
        const latY = cy + r * Math.cos(angle);
        const isEquator = i === Math.floor(LAT_RINGS / 2);
        ctx.beginPath();
        ctx.ellipse(cx, latY, latR, latR * 0.15, 0, 0, Math.PI * 2);
        ctx.strokeStyle = isEquator
          ? "rgba(0,220,240,0.30)"   // equator brighter cyan
          : "rgba(60,180,200,0.13)";
        ctx.lineWidth = isEquator ? 1.0 : 0.6;
        ctx.stroke();
      }

      // ── LONGITUDE LINES (rotating, bright) ────────────────────────────
      const LON_LINES = 12;
      for (let i = 0; i < LON_LINES; i++) {
        const angle = (i / LON_LINES) * Math.PI + t * 0.003;
        const xRadius = r * Math.abs(Math.cos(angle));
        const isPrime = i === 0;
        ctx.beginPath();
        ctx.ellipse(cx, cy, xRadius, r, 0, 0, Math.PI * 2);
        ctx.strokeStyle = isPrime
          ? "rgba(0,220,240,0.22)"
          : "rgba(60,180,200,0.09)";
        ctx.lineWidth = isPrime ? 0.9 : 0.5;
        ctx.stroke();
      }

      ctx.restore(); // end globe clip

      // ── 4. GLOBE OUTLINE ──────────────────────────────────────────────
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,210,230,0.45)";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // ── 5. NETWORK NODES + ARCS ───────────────────────────────────────
      const projected = NODES.map(({ phi, theta }) =>
        project(phi, theta + t * 0.005, r, cx, cy)
      );

      // Arcs
      for (const [a, b] of CONNECTIONS) {
        const na = projected[a], nb = projected[b];
        if (na.z < 0 || nb.z < 0) continue;
        const depth = (na.z + nb.z) * 0.5;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.04 + a);
        drawArc(
          ctx, na.x, na.y, nb.x, nb.y, r,
          `rgba(0,210,230,${depth * 0.45 * pulse})`,
          0.8
        );
      }

      // Nodes
      for (const { x, y, z } of projected) {
        if (z < 0.02) continue;
        const depth  = (z + 0.4) * 0.7;
        const pulse  = 1 + 0.25 * Math.sin(t * 0.08 + x * 0.01);

        // Outer glow ring
        const glow = ctx.createRadialGradient(x, y, 0, x, y, 14 * pulse);
        glow.addColorStop(0,   `rgba(0,210,230,${depth * 0.25})`);
        glow.addColorStop(1,   "transparent");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 14 * pulse, 0, Math.PI * 2);
        ctx.fill();

        // Mid ring
        ctx.beginPath();
        ctx.arc(x, y, 5 * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,220,240,${depth * 0.6})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Core
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100,240,255,${depth})`;
        ctx.fill();
      }

      // ── 6. SHOOTING STAR (occasional) ─────────────────────────────────
      if (t % 280 < 60) {
        const progress = (t % 280) / 60;
        const sx = canvas.width * 0.15 + progress * canvas.width * 0.25;
        const sy = canvas.height * 0.12 + progress * canvas.height * 0.08;
        const len = 80 * Math.sin(progress * Math.PI);
        const grad = ctx.createLinearGradient(sx - len, sy - len * 0.4, sx, sy);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, `rgba(180,240,255,${0.7 * Math.sin(progress * Math.PI)})`);
        ctx.beginPath();
        ctx.moveTo(sx - len, sy - len * 0.4);
        ctx.lineTo(sx, sy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      t++;
      raf = requestAnimationFrame(drawFrame);
    }

    drawFrame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <main
      className="relative min-h-screen overflow-hidden flex flex-col"
      style={{ backgroundColor: "#020509", fontFamily: "var(--font-geist-mono)" }}
    >
      {/* Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Edge vignette — keeps focus on globe centre */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 70% 75% at 50% 50%, transparent 35%, rgba(2,5,9,0.75) 100%)",
        }}
      />

      {/* ── TOP BAR ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between px-8 py-6">
        <p className="text-[11px] tracking-[0.3em] text-white/40 uppercase">Vantage</p>
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] tracking-[0.2em] text-[#0D9BA0] uppercase">System Online</span>
          <motion.span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "#0D9BA0" }}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        </div>
      </div>

      {/* ── SIDE LABELS ──────────────────────────────────────────────── */}
      <div
        className="absolute left-7 top-1/2 z-10"
        style={{ writingMode: "vertical-rl", transform: "translateY(-50%) rotate(180deg)" }}
      >
        <span className="text-[8px] tracking-[0.3em] text-white/12 uppercase">Scanning Area 404</span>
      </div>
      <div
        className="absolute right-7 top-1/2 z-10"
        style={{ writingMode: "vertical-rl" }}
      >
        <span className="text-[8px] tracking-[0.3em] text-white/12 uppercase">Neural Link Established</span>
      </div>

      {/* ── CENTRE CONTENT ───────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6">

        {/* Tagline chip */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mb-7"
        >
          <span
            className="inline-block text-[10px] tracking-[0.24em] uppercase px-5 py-2"
            style={{
              color: "#0DC5CC",
              border: "1px solid rgba(13,197,204,0.3)",
              background: "rgba(13,197,204,0.04)",
              letterSpacing: "0.24em",
            }}
          >
            Don&apos;t guess where your next store goes. Know.
          </span>
        </motion.div>

        {/* Hero wordmark — dimmed, letting the globe breathe through */}
        <motion.h1
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.0, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="font-black uppercase leading-none mb-3 select-none"
          style={{
            fontSize: "clamp(68px, 13vw, 148px)",
            letterSpacing: "-0.025em",
            fontFamily: "var(--font-geist-sans)",
            // Ghosted: low fill with a bright teal outline glow
            color: "rgba(220,235,240,0.18)",
            textShadow: [
              "0 0 120px rgba(0,200,220,0.22)",
              "0 0  40px rgba(0,200,220,0.10)",
              "0 2px  0px rgba(0,0,0,0.9)",
            ].join(", "),
            WebkitTextStroke: "1px rgba(0,200,220,0.35)",
          }}
        >
          VANTAGE
        </motion.h1>

        {/* Subtle descriptor */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.85 }}
          className="text-[10px] tracking-[0.22em] uppercase mb-10"
          style={{ color: "rgba(100,160,180,0.45)" }}
        >
          Location Intelligence · Australia
        </motion.p>

        {/* CTA */}
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1.0 }}
          onClick={() => router.push("/setup")}
          className="group relative flex items-center gap-3 px-9 py-4 text-[11px] tracking-[0.25em] uppercase overflow-hidden"
          style={{
            border: "1px solid rgba(13,197,204,0.45)",
            background: "rgba(13,197,204,0.05)",
            color: "#0DC5CC",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(13,197,204,0.12)";
            e.currentTarget.style.borderColor = "rgba(13,197,204,0.8)";
            e.currentTarget.style.boxShadow = "0 0 32px rgba(13,197,204,0.15), inset 0 0 20px rgba(13,197,204,0.04)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(13,197,204,0.05)";
            e.currentTarget.style.borderColor = "rgba(13,197,204,0.45)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          Enter Terminal
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 11L11 1M11 1H4M11 1V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </motion.button>
      </div>

      {/* ── BOTTOM STATUS BAR ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.2 }}
        className="relative z-10 flex items-end justify-between px-8 py-6"
      >
        <div>
          <p className="text-[8px] tracking-[0.22em] text-white/20 uppercase mb-1.5">Global Node Connectivity</p>
          <div className="flex items-center gap-2">
            <div className="w-10 h-px" style={{ background: "linear-gradient(to right, rgba(13,197,204,0.7), transparent)" }} />
            <p className="text-[9px] tracking-[0.15em] text-[#0DC5CC]/70">99.98% Ops Stable</p>
          </div>
        </div>

        <div className="text-center">
          <p className="text-[8px] tracking-[0.22em] text-white/20 uppercase mb-1.5">Current Lat / Long</p>
          <motion.p
            key={coords.lat}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-[9px] tracking-[0.1em]"
            style={{ color: "rgba(150,210,220,0.45)" }}
          >
            {coords.lat}° S &nbsp;·&nbsp; {coords.lon}° E
          </motion.p>
        </div>

        <div className="text-right">
          <p className="text-[8px] tracking-[0.22em] text-white/20 uppercase mb-1.5">System Core</p>
          <p className="text-[9px] tracking-[0.1em]" style={{ color: "rgba(150,210,220,0.45)" }}>V.04.2-ALPHA</p>
        </div>
      </motion.div>

      {/* ── SCAN LINE ─────────────────────────────────────────────────── */}
      <motion.div
        className="absolute inset-x-0 h-px pointer-events-none z-20"
        style={{ background: "linear-gradient(to right, transparent 0%, rgba(0,210,230,0.35) 40%, rgba(0,210,230,0.6) 50%, rgba(0,210,230,0.35) 60%, transparent 100%)" }}
        animate={{ top: ["8%", "92%", "8%"] }}
        transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
      />

      {/* ── CORNER BRACKETS ───────────────────────────────────────────── */}
      {[
        { top: 16, left: 16 },
        { top: 16, right: 16 },
        { bottom: 16, left: 16 },
        { bottom: 16, right: 16 },
      ].map((pos, i) => (
        <div key={i} className="absolute z-10 pointer-events-none" style={{ ...pos, width: 20, height: 20 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            {i === 0 && <><path d="M0 10V0H10" stroke="rgba(13,197,204,0.25)" strokeWidth="1"/></>}
            {i === 1 && <><path d="M20 10V0H10" stroke="rgba(13,197,204,0.25)" strokeWidth="1"/></>}
            {i === 2 && <><path d="M0 10V20H10" stroke="rgba(13,197,204,0.25)" strokeWidth="1"/></>}
            {i === 3 && <><path d="M20 10V20H10" stroke="rgba(13,197,204,0.25)" strokeWidth="1"/></>}
          </svg>
        </div>
      ))}
    </main>
  );
}
