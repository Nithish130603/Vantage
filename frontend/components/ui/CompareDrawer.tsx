"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GitCompare, X, Loader2, Trophy, AlertTriangle, CheckCircle2 } from "lucide-react";

const COMPARE_STEPS = [
  "Fetching suburb scores…",
  "Comparing growth trajectories…",
  "Analysing venue mix…",
  "Identifying key differentiators…",
  "Writing comparison report…",
];

function CompareProgress() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStep(s => Math.min(s + 1, COMPARE_STEPS.length - 1));
    }, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col gap-3 py-8 px-2">
      {COMPARE_STEPS.map((label, i) => (
        <div key={i} className="flex items-center gap-3">
          {i < step ? (
            <CheckCircle2 size={14} className="text-[#0D7377] shrink-0" />
          ) : i === step ? (
            <Loader2 size={14} className="animate-spin text-[#0D7377] shrink-0" />
          ) : (
            <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ border: "1px solid rgba(255,255,255,0.12)" }} />
          )}
          <p
            className="text-xs transition-colors"
            style={{ color: i <= step ? "#C8C8D4" : "#3A3A4A" }}
          >
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}
import { api } from "@/lib/api";

interface Props {
  savedH3s: string[];
  category: string;
  fingerprintResult?: Record<string, unknown>;
  savedNames?: Record<string, string>; // h3_r7 → locality
}

export default function CompareDrawer({
  savedH3s,
  category,
  fingerprintResult,
  savedNames = {},
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligible = savedH3s.slice(0, 5); // API accepts max 5

  async function runCompare() {
    if (eligible.length < 2) return;
    setLoading(true);
    setResult(null);
    setWinner(null);
    setError(null);
    try {
      const res = await api.compare({
        category,
        h3_r7_list: eligible,
        fingerprint_result: fingerprintResult,
      });
      setResult(res.final_output);
      setWinner(res.comparison_result?.winner ?? null);
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("503")
          ? "AI comparison is temporarily offline. Try again shortly."
          : "Comparison failed. Try again."
      );
    } finally {
      setLoading(false);
    }
  }

  if (savedH3s.length < 2) return null;

  return (
    <>
      {/* Trigger button — sits above the chat button */}
      <motion.button
        onClick={() => { setOpen(true); if (!result && !loading) runCompare(); }}
        className="fixed bottom-6 right-[168px] z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-2xl text-sm font-medium transition-all"
        style={{
          background: "#131316",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "#C8C8D4",
        }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1 }}
      >
        <GitCompare size={15} />
        <span>Compare {eligible.length} saved</span>
      </motion.button>

      {/* Slide-up drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl shadow-2xl overflow-hidden"
            style={{
              maxHeight: "75vh",
              background: "#0E0E12",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {/* Handle + header */}
            <div
              className="flex items-center gap-3 px-6 py-4 shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="w-8 h-1 rounded-full bg-white/10 mx-auto absolute top-3 left-1/2 -translate-x-1/2" />
              <GitCompare size={15} className="text-[#0D7377]" />
              <p className="text-[11px] font-mono tracking-[0.15em] text-[#0D7377] uppercase">
                Head-to-Head Comparison · {category}
              </p>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto text-[#555566] hover:text-[#F0F0F2] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Suburb list */}
            <div
              className="flex gap-2 px-6 py-3 shrink-0 flex-wrap"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              {eligible.map((h3) => (
                <span
                  key={h3}
                  className="text-[10px] font-mono px-2.5 py-1 rounded-full"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#8B8B99",
                  }}
                >
                  {savedNames[h3] ?? h3.slice(0, 10)}
                </span>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
              {loading && <CompareProgress />}

              {error && (
                <div className="flex items-start gap-2 bg-red-950/30 border border-red-800/30 rounded-xl p-4 text-xs text-red-300">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {winner && !loading && (
                <div
                  className="flex items-center gap-3 rounded-xl p-4 mb-4"
                  style={{
                    background: "rgba(232,197,71,0.06)",
                    border: "1px solid rgba(232,197,71,0.2)",
                  }}
                >
                  <Trophy size={16} className="text-[#E8C547] shrink-0" />
                  <div>
                    <p className="text-[10px] font-mono tracking-wider text-[#E8C547] uppercase mb-0.5">
                      Winner
                    </p>
                    <p className="text-sm text-[#F0F0F2] font-medium leading-snug">
                      {winner}
                    </p>
                  </div>
                </div>
              )}

              {result && !loading && (
                <div
                  className="text-xs text-[#C8C8D4] leading-relaxed whitespace-pre-wrap rounded-xl p-4"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {result}
                </div>
              )}
            </div>

            {/* Footer */}
            {!loading && (result || error) && (
              <div
                className="px-6 py-4 flex gap-3 shrink-0"
                style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
              >
                <button
                  onClick={() => { setResult(null); setWinner(null); runCompare(); }}
                  className="text-xs text-[#8B8B99] hover:text-[#F0F0F2] transition-colors font-mono"
                >
                  Re-run analysis
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="ml-auto text-xs px-4 py-2 rounded-lg transition-colors font-medium"
                  style={{ background: "#0D7377", color: "#fff" }}
                >
                  Close
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
