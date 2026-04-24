"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, BookmarkCheck } from "lucide-react";
import { saveAnalysis } from "@/lib/analyses";

interface Props {
  open: boolean;
  onClose: () => void;
  category: string;
  region: string;
  fingerprintResult: Record<string, unknown>;
  onSaved?: (analysisId: string) => void;
}

export default function SaveAnalysisModal({
  open, onClose, category, region, fingerprintResult, onSaved,
}: Props) {
  const [name, setName] = useState(`${category} — ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const analysis = await saveAnalysis(name.trim(), category, region, fingerprintResult);
      if (!analysis) throw new Error("Sign in to save analyses");
      onSaved?.(analysis.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.16 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm rounded-2xl shadow-2xl"
            style={{ background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex items-center px-5 pt-5 pb-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2.5">
                <BookmarkCheck size={15} className="text-[#0D7377]" />
                <p className="text-sm font-medium text-[#F0F0F2]">Save this analysis</p>
              </div>
              <button onClick={onClose} className="ml-auto text-[#555566] hover:text-[#F0F0F2] transition-colors">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSave} className="px-5 py-5 space-y-4">
              <div>
                <label className="block text-xs text-[#8B8B99] mb-1.5">Analysis name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full text-sm outline-none text-[#F0F0F2]"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = "#0D7377")}
                  onBlur={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
                />
              </div>

              <div className="flex gap-2 text-xs text-[#555566] font-mono">
                <span className="px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)" }}>{category}</span>
                <span className="px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)" }}>{region}</span>
              </div>

              {error && (
                <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2 rounded-lg text-xs text-[#8B8B99] transition-colors hover:text-[#F0F0F2]"
                  style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  Skip
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{ background: "#0D7377", color: "#fff" }}
                >
                  {loading ? <Loader2 size={12} className="animate-spin mx-auto" /> : "Save"}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
