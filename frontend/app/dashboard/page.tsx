"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Trash2, Plus, LogOut, BarChart3 } from "lucide-react";
import { supabase, supabaseEnabled } from "@/lib/supabase";
import { listAnalyses, deleteAnalysis, type Analysis } from "@/lib/analyses";
import AuthModal from "@/components/ui/AuthModal";

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!supabaseEnabled) { setLoading(false); return; }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) {
        listAnalyses().then((a) => { setAnalyses(a); setLoading(false); });
      } else {
        setLoading(false);
        setShowAuth(true);
      }
    });
  }, []);

  async function handleSignOut() {
    if (supabaseEnabled) await supabase.auth.signOut();
    router.push("/");
  }

  async function handleDelete(id: string) {
    await deleteAnalysis(id);
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
  }

  function resumeAnalysis(analysis: Analysis) {
    sessionStorage.setItem("vantage_dna", JSON.stringify(analysis.fingerprint_result));
    sessionStorage.setItem("vantage_category", analysis.category);
    sessionStorage.setItem("vantage_region", analysis.region);
    router.push("/dna");
  }

  return (
    <main className="min-h-screen px-6 py-12" style={{ backgroundColor: "#0A0A0B" }}>
      <AuthModal
        open={showAuth && !user}
        onClose={() => { if (!user) router.push("/"); }}
        onSuccess={() => {
          setShowAuth(false);
          if (!supabaseEnabled) return;
          supabase.auth.getUser().then(({ data }) => {
            setUser(data.user);
            listAnalyses().then(setAnalyses);
          });
        }}
      />

      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <p className="text-[10px] font-mono tracking-[0.25em] text-[#0D7377] uppercase mb-1">
              Vantage · Dashboard
            </p>
            <h1 className="text-2xl font-light" style={{ fontFamily: "var(--font-fraunces)", color: "#F0F0F2" }}>
              Your analyses
            </h1>
            {user?.email && (
              <p className="text-xs text-[#555566] mt-0.5">{user.email}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{ background: "#0D7377", color: "#fff" }}
            >
              <Plus size={13} />
              New analysis
            </button>
            <button
              onClick={handleSignOut}
              className="p-2 rounded-lg text-[#555566] hover:text-[#F0F0F2] transition-colors"
              style={{ border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-20 rounded-xl" />
            ))}
          </div>
        ) : analyses.length === 0 ? (
          <div
            className="rounded-2xl p-12 text-center"
            style={{ border: "1px dashed rgba(255,255,255,0.08)" }}
          >
            <BarChart3 size={32} className="text-[#3A3A4A] mx-auto mb-4" />
            <p className="text-sm text-[#555566] mb-5">No saved analyses yet.</p>
            <button
              onClick={() => router.push("/")}
              className="px-5 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: "#0D7377", color: "#fff" }}
            >
              Run your first analysis →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {analyses.map((a, i) => (
              <motion.div
                key={a.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-4 rounded-xl px-5 py-4 group"
                style={{ background: "#131316", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#F0F0F2] font-medium truncate">{a.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-[#0D7377]">{a.category}</span>
                    <span className="text-[#3A3A4A]">·</span>
                    <span className="text-[10px] text-[#555566]">{a.region}</span>
                    <span className="text-[#3A3A4A]">·</span>
                    <span className="text-[10px] text-[#555566]">
                      {new Date(a.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    {a.saved_suburbs.length > 0 && (
                      <>
                        <span className="text-[#3A3A4A]">·</span>
                        <span className="text-[10px] text-[#555566]">{a.saved_suburbs.length} suburbs saved</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="p-1.5 rounded-lg text-[#3A3A4A] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    onClick={() => resumeAnalysis(a)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: "rgba(13,115,119,0.12)", color: "#0D7377", border: "1px solid rgba(13,115,119,0.2)" }}
                  >
                    View map <ArrowRight size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
