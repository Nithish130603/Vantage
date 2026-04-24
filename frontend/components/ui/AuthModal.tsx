"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AuthModal({ open, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSuccess?.();
        onClose();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "#0E0E12", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {/* Header */}
            <div className="flex items-center px-6 pt-6 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div>
                <p className="text-[10px] font-mono tracking-[0.2em] text-[#0D7377] uppercase mb-1">
                  Vantage · Location Intelligence
                </p>
                <h2 className="text-lg font-light" style={{ fontFamily: "var(--font-fraunces)", color: "#F0F0F2" }}>
                  {mode === "signin" ? "Sign in" : "Create account"}
                </h2>
              </div>
              <button onClick={onClose} className="ml-auto text-[#555566] hover:text-[#F0F0F2] transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-6">
              {sent ? (
                <div className="text-center py-4">
                  <Mail size={32} className="text-[#0D7377] mx-auto mb-3" />
                  <p className="text-sm text-[#F0F0F2] font-medium mb-1">Check your email</p>
                  <p className="text-xs text-[#555566]">
                    We sent a confirmation link to <span className="text-[#C8C8D4]">{email}</span>
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs text-[#8B8B99] mb-1.5">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="you@yourfranchise.com"
                      className="w-full text-sm outline-none text-[#F0F0F2] placeholder:text-[#3A3A4A]"
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

                  <div>
                    <label className="block text-xs text-[#8B8B99] mb-1.5">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      placeholder="Min 8 characters"
                      className="w-full text-sm outline-none text-[#F0F0F2] placeholder:text-[#3A3A4A]"
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

                  {error && (
                    <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
                    style={{ background: "#0D7377", color: "#fff" }}
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin mx-auto" />
                    ) : mode === "signin" ? "Sign in" : "Create account"}
                  </button>

                  <p className="text-center text-xs text-[#555566]">
                    {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
                    <button
                      type="button"
                      onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
                      className="text-[#0D7377] hover:underline"
                    >
                      {mode === "signin" ? "Sign up" : "Sign in"}
                    </button>
                  </p>
                </form>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
