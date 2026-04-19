"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api, type FingerprintRequest } from "@/lib/api";
import SuburbTagInput from "@/components/ui/SuburbTagInput";

const CATEGORIES = ["Gym & Fitness", "Café", "Pharmacy"];
const REGIONS = ["All Australia", "NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

type Situation = "A" | "B" | "C" | null;

function parseLocations(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function UploadPage() {
  const router = useRouter();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [situation, setSituation] = useState<Situation>(null);
  const [bestLocations, setBestLocations] = useState<string[]>([]);
  const [worstLocations, setWorstLocations] = useState<string[]>([]);
  const [overseasRaw, setOverseasRaw] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("All Australia");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = selectedCategory !== null && !loading;

  const handleSubmit = async () => {
    if (!selectedCategory) return;
    setError(null);
    setLoading(true);

    try {
      const mode =
        situation === "A" ? "existing" : situation === "C" ? "overseas" : "fresh";

      const best_locations =
        situation === "A"
          ? bestLocations
          : situation === "C"
          ? parseLocations(overseasRaw)
          : [];

      const worst_locations = situation === "A" ? worstLocations : [];

      const req: FingerprintRequest = {
        category: selectedCategory,
        mode,
        best_locations,
        worst_locations,
        region: selectedRegion,
      };

      const result = await api.fingerprint(req);
      sessionStorage.setItem("vantage_dna", JSON.stringify(result));
      sessionStorage.setItem("vantage_category", selectedCategory);
      sessionStorage.setItem("vantage_region", selectedRegion);
      router.push("/dna");
    } catch (e) {
      setError(e instanceof Error ? e.message : "API error — is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      className="relative min-h-screen flex flex-col items-center justify-center px-6 py-20 overflow-hidden"
      style={{ backgroundColor: "#0A0A0B" }}
    >
      {/* ── Atmospheric background layer ───────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {/* Dot grid */}
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <pattern id="dotgrid" x="0" y="0" width="38" height="38" patternUnits="userSpaceOnUse">
              <circle cx="19" cy="19" r="1" fill="#0D7377" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dotgrid)" opacity="0.07" />
        </svg>

        {/* Radial teal glow — upper right */}
        <div style={{
          position: "absolute", top: "-15%", right: "-8%",
          width: "55%", height: "70%",
          background: "radial-gradient(ellipse, rgba(13,115,119,0.10) 0%, transparent 68%)",
        }} />

        {/* Radial teal glow — lower left */}
        <div style={{
          position: "absolute", bottom: "-10%", left: "-5%",
          width: "38%", height: "50%",
          background: "radial-gradient(ellipse, rgba(13,115,119,0.06) 0%, transparent 70%)",
        }} />

        {/* Bottom vignette */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: "28%",
          background: "linear-gradient(to top, rgba(10,10,11,0.60), transparent)",
        }} />

        {/* Scattered location nodes */}
        {([
          { x: "6%",  y: "13%", core: 5, ring: 14, op: 0.18 },
          { x: "88%", y: "9%",  core: 7, ring: 20, op: 0.22 },
          { x: "78%", y: "40%", core: 4, ring: 12, op: 0.16 },
          { x: "93%", y: "65%", core: 6, ring: 17, op: 0.19 },
          { x: "11%", y: "72%", core: 3, ring: 10, op: 0.14 },
          { x: "60%", y: "88%", core: 5, ring: 14, op: 0.15 },
          { x: "83%", y: "82%", core: 3, ring: 9,  op: 0.12 },
          { x: "42%", y: "6%",  core: 4, ring: 11, op: 0.13 },
        ] as { x: string; y: string; core: number; ring: number; op: number }[]).map((pin, i) => (
          <div key={i} style={{ position: "absolute", left: pin.x, top: pin.y, transform: "translate(-50%,-50%)" }}>
            <div style={{
              position: "absolute", left: "50%", top: "50%",
              width: pin.ring * 2, height: pin.ring * 2, borderRadius: "50%",
              border: "1px solid rgba(13,115,119,0.55)",
              transform: "translate(-50%,-50%)", opacity: pin.op,
            }} />
            <div style={{
              position: "absolute", left: "50%", top: "50%",
              width: pin.core * 2, height: pin.core * 2, borderRadius: "50%",
              backgroundColor: "#0D7377", opacity: pin.op + 0.08,
              transform: "translate(-50%,-50%)",
            }} />
          </div>
        ))}

        {/* Faint coordinate labels */}
        <span style={{ position: "absolute", bottom: 18, right: 22, fontSize: 9, fontFamily: "monospace", color: "#0D7377", opacity: 0.18, letterSpacing: "0.1em" }}>
          −33.8688, 151.2093
        </span>
        <span style={{ position: "absolute", top: 18, left: 22, fontSize: 9, fontFamily: "monospace", color: "#0D7377", opacity: 0.18, letterSpacing: "0.1em" }}>
          −27.4698, 153.0251
        </span>
        <span style={{ position: "absolute", top: 18, right: 22, fontSize: 9, fontFamily: "monospace", color: "#0D7377", opacity: 0.12, letterSpacing: "0.1em" }}>
          AU · H3 r7
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-xl relative"
        style={{ zIndex: 1 }}
      >
        {/* Eyebrow */}
        <p
          className="mb-5"
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: 10,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "#0D7377",
          }}
        >
          Vantage · Location Intelligence
        </p>

        {/* Main heading */}
        <h1
          className="mb-3 font-light leading-[1.08]"
          style={{
            fontFamily: "var(--font-fraunces)",
            fontSize: "clamp(48px, 6vw, 68px)",
            color: "#F0F0F2",
            fontWeight: 300,
          }}
        >
          Find your next
          <br />
          location.
        </h1>

        <p
          className="mb-12"
          style={{
            fontSize: 14,
            color: "#555566",
            lineHeight: 1.6,
            fontFamily: "var(--font-geist-sans)",
          }}
        >
          Decode your franchise DNA. Find where to open next.
        </p>

        {/* Form card with teal left accent */}
        <div
          className="relative rounded-xl overflow-hidden"
          style={{ border: "1px solid #26262B" }}
        >
          {/* Teal vertical bar */}
          <div
            className="absolute inset-y-0 left-0 w-[3px]"
            style={{ backgroundColor: "#0D7377" }}
          />

          <div className="pl-7 pr-6 py-8 space-y-9">

            {/* ── Step 1 — Category ───────────────────────────────── */}
            <div>
              <p
                className="mb-4"
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "#0D7377",
                }}
              >
                What type of business?
              </p>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelectedCategory(c)}
                    style={{
                      borderRadius: 4,
                      fontSize: 13,
                      fontFamily: "var(--font-geist-sans)",
                      padding: "6px 14px",
                      border: selectedCategory === c ? "none" : "1px solid #26262B",
                      backgroundColor: selectedCategory === c ? "#0D7377" : "transparent",
                      color: selectedCategory === c ? "#fff" : "#8B8B99",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Step 2 — Situation ───────────────────────────────── */}
            <div>
              <p
                className="mb-4"
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "#555566",
                }}
              >
                Your situation
              </p>
              <div className="space-y-2.5">

                {/* Card A */}
                <div
                  onClick={() => setSituation("A")}
                  style={{
                    borderRadius: 8,
                    border: situation === "A" ? "none" : "1px solid #26262B",
                    borderLeft: situation === "A" ? "2px solid #0D7377" : "1px solid #26262B",
                    backgroundColor: situation === "A" ? "rgba(13,115,119,0.06)" : "transparent",
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <p style={{ fontSize: 13, color: "#F0F0F2", fontWeight: 500, marginBottom: 2 }}>
                    I have existing locations
                  </p>
                  <p style={{ fontSize: 12, color: "#555566" }}>
                    We&apos;ll build your franchise DNA from your stores
                  </p>

                  <AnimatePresence>
                    {situation === "A" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-5 space-y-4" onClick={(e) => e.stopPropagation()}>
                          <div>
                            <p style={{ fontSize: 11, color: "#8B8B99", marginBottom: 6 }}>
                              Your best performing locations
                            </p>
                            <SuburbTagInput
                              value={bestLocations}
                              onChange={setBestLocations}
                              placeholder="Type a suburb…"
                              maxTags={20}
                            />
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <p style={{ fontSize: 11, color: "#8B8B99" }}>
                                Struggling or closed locations
                              </p>
                              <span
                                style={{
                                  fontSize: 9,
                                  fontFamily: "var(--font-geist-mono)",
                                  letterSpacing: "0.05em",
                                  padding: "2px 6px",
                                  borderRadius: 3,
                                  border: "1px solid rgba(13,115,119,0.3)",
                                  color: "#0D7377",
                                }}
                              >
                                Optional
                              </span>
                            </div>
                            <SuburbTagInput
                              value={worstLocations}
                              onChange={setWorstLocations}
                              placeholder="Type a suburb…"
                              maxTags={10}
                              variant="danger"
                            />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Card B */}
                <div
                  onClick={() => setSituation("B")}
                  style={{
                    borderRadius: 8,
                    border: situation === "B" ? "none" : "1px solid #26262B",
                    borderLeft: situation === "B" ? "2px solid #0D7377" : "1px solid #26262B",
                    backgroundColor: situation === "B" ? "rgba(13,115,119,0.06)" : "transparent",
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <p style={{ fontSize: 13, color: "#F0F0F2", fontWeight: 500, marginBottom: 2 }}>
                    Starting fresh
                  </p>
                  <p style={{ fontSize: 12, color: "#555566" }}>
                    We&apos;ll use data from successful{" "}
                    {selectedCategory ? selectedCategory.toLowerCase() : "businesses"} across
                    Australia
                  </p>
                </div>

                {/* Card C */}
                <div
                  onClick={() => setSituation("C")}
                  style={{
                    borderRadius: 8,
                    border: situation === "C" ? "none" : "1px solid #26262B",
                    borderLeft: situation === "C" ? "2px solid #0D7377" : "1px solid #26262B",
                    backgroundColor: situation === "C" ? "rgba(13,115,119,0.06)" : "transparent",
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <p style={{ fontSize: 13, color: "#F0F0F2", fontWeight: 500, marginBottom: 2 }}>
                    Entering Australia from overseas
                  </p>
                  <p style={{ fontSize: 12, color: "#555566" }}>
                    We&apos;ll translate your success pattern to Australian equivalents
                  </p>

                  <AnimatePresence>
                    {situation === "C" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-5" onClick={(e) => e.stopPropagation()}>
                          <textarea
                            rows={3}
                            value={overseasRaw}
                            onChange={(e) => setOverseasRaw(e.target.value)}
                            placeholder="Manhattan NY, Brooklyn NY, Chicago IL"
                            style={{
                              width: "100%",
                              backgroundColor: "#0A0A0B",
                              border: "1px solid #26262B",
                              borderRadius: 6,
                              padding: "10px 12px",
                              fontSize: 13,
                              color: "#F0F0F2",
                              fontFamily: "var(--font-geist-sans)",
                              resize: "none",
                              outline: "none",
                            }}
                            onFocus={(e) => (e.target.style.borderColor = "#0D7377")}
                            onBlur={(e) => (e.target.style.borderColor = "#26262B")}
                          />
                          <p style={{ fontSize: 10, color: "#3A3A4A", marginTop: 4 }}>
                            Optional — your home country locations
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

              </div>
            </div>

            {/* ── Step 3 — Region ─────────────────────────────────── */}
            <div>
              <p
                className="mb-4"
                style={{
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "#555566",
                }}
              >
                Region
              </p>
              <div className="flex flex-wrap gap-2">
                {REGIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedRegion(r)}
                    style={{
                      borderRadius: 4,
                      fontSize: 12,
                      fontFamily: "var(--font-geist-mono)",
                      padding: "5px 11px",
                      border: selectedRegion === r ? "none" : "1px solid #26262B",
                      backgroundColor: selectedRegion === r ? "#0D7377" : "transparent",
                      color: selectedRegion === r ? "#fff" : "#555566",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <p
                style={{
                  fontSize: 12,
                  color: "#f87171",
                  backgroundColor: "rgba(127,29,29,0.15)",
                  border: "1px solid rgba(153,27,27,0.3)",
                  borderRadius: 6,
                  padding: "8px 12px",
                }}
              >
                {error}
              </p>
            )}

            {/* CTA */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: "100%",
                height: 48,
                borderRadius: 8,
                border: "none",
                backgroundColor: canSubmit ? "#0D7377" : "#1A2A2A",
                color: canSubmit ? "#fff" : "#3A5050",
                fontSize: 14,
                fontFamily: "var(--font-geist-sans)",
                fontWeight: 500,
                cursor: canSubmit ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "background-color 0.2s ease, color 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (canSubmit) (e.currentTarget.style.backgroundColor = "#0f8a8f");
              }}
              onMouseLeave={(e) => {
                if (canSubmit) (e.currentTarget.style.backgroundColor = "#0D7377");
              }}
            >
              {loading ? (
                <>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                  Analysing…
                </>
              ) : (
                "Analyse locations →"
              )}
            </button>

          </div>
        </div>
      </motion.div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );

}
