"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, X, Send, Loader2 } from "lucide-react";
import { api, type ChatMessage } from "@/lib/api";

interface Props {
  category?: string;
  h3_r7?: string;
  fingerprintResult?: Record<string, unknown>;
}

const SUGGESTIONS = [
  "Why does this suburb score here?",
  "What are the biggest risks?",
  "Where should I look instead?",
  "How does this compare to Sydney?",
];

export default function ChatWidget({ category, h3_r7, fingerprintResult }: Props) {
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");   // in-flight partial response
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const cancelRef  = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streaming]);

  const send = useCallback((question: string) => {
    if (!question.trim() || loading) return;
    setInput("");
    setError(null);
    setStreaming("");
    setLoading(true);

    // Optimistically add user message
    const userMsg: ChatMessage = { role: "user", content: question };
    setHistory(prev => [...prev, userMsg]);

    cancelRef.current = api.chatStream(
      {
        question,
        category,
        h3_r7,
        fingerprint_result: fingerprintResult,
        conversation_history: history,
      },
      (token) => setStreaming(prev => prev + token),
      (response, updatedHistory) => {
        setHistory(updatedHistory);
        setStreaming("");
        setLoading(false);
      },
      (detail) => {
        setError(
          detail.includes("503")
            ? "AI advisor is temporarily offline. Try again shortly."
            : "Something went wrong. Try again."
        );
        setHistory(prev => prev.slice(0, -1));   // remove optimistic user msg
        setStreaming("");
        setLoading(false);
      },
    );
  }, [loading, history, category, h3_r7, fingerprintResult]);

  function handleClose() {
    cancelRef.current?.();
    setOpen(false);
  }

  return (
    <>
      {/* Floating trigger */}
      <motion.button
        onClick={() => (open ? handleClose() : setOpen(true))}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full shadow-2xl text-sm font-medium transition-all"
        style={{
          background:   open ? "#0D7377" : "#131316",
          border:       "1px solid",
          borderColor:  open ? "#0D7377" : "rgba(255,255,255,0.1)",
          color:        open ? "#fff" : "#C8C8D4",
        }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
      >
        {open ? <X size={16} /> : <MessageSquare size={16} />}
        <span>{open ? "Close" : "Ask Vantage"}</span>
        {!open && history.length > 0 && (
          <span className="w-2 h-2 rounded-full bg-[#0D7377] absolute -top-0.5 -right-0.5" />
        )}
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-20 right-6 z-50 flex flex-col rounded-2xl shadow-2xl overflow-hidden"
            style={{
              width: 380,
              maxHeight: 540,
              background: "#0E0E12",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-2.5 px-4 py-3 shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="w-2 h-2 rounded-full bg-[#0D7377]" />
              <p className="text-[11px] font-mono tracking-[0.15em] text-[#0D7377] uppercase">
                Location Intelligence Advisor
              </p>
              {category && (
                <span className="ml-auto text-[10px] font-mono text-[#555566] truncate max-w-[110px]">
                  {category}
                </span>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {history.length === 0 && !loading && (
                <div className="space-y-3">
                  <p className="text-xs text-[#555566] leading-relaxed">
                    Ask me anything about suburbs, scores, risks, or where to expand next.
                  </p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="text-left text-[11px] text-[#8B8B99] px-3 py-2 rounded-lg transition-colors hover:text-[#F0F0F2]"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {history.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className="text-xs leading-relaxed px-3 py-2 rounded-xl max-w-[92%]"
                    style={
                      msg.role === "user"
                        ? { background: "#0D7377", color: "#fff" }
                        : {
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.07)",
                            color: "#C8C8D4",
                            whiteSpace: "pre-wrap",
                          }
                    }
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Streaming bubble — shows tokens as they arrive */}
              {(loading || streaming) && (
                <div className="flex justify-start">
                  <div
                    className="text-xs leading-relaxed px-3 py-2 rounded-xl max-w-[92%]"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      color: "#C8C8D4",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {streaming || (
                      <span className="flex items-center gap-1.5 text-[#555566]">
                        <Loader2 size={11} className="animate-spin" />
                        Thinking…
                      </span>
                    )}
                    {streaming && (
                      <span
                        className="inline-block w-0.5 h-3 ml-0.5 align-middle animate-pulse"
                        style={{ background: "#0D7377" }}
                      />
                    )}
                  </div>
                </div>
              )}

              {error && (
                <p className="text-[11px] text-[#C0392B] text-center px-2">{error}</p>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div
              className="px-3 py-3 shrink-0"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <form
                onSubmit={(e) => { e.preventDefault(); send(input); }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question…"
                  disabled={loading}
                  className="flex-1 text-xs bg-transparent outline-none text-[#F0F0F2] placeholder:text-[#3A3A4A]"
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="shrink-0 p-2 rounded-lg transition-all disabled:opacity-30"
                  style={{ background: "#0D7377" }}
                >
                  <Send size={13} className="text-white" />
                </button>
              </form>

              {history.length > 0 && !loading && (
                <button
                  onClick={() => setHistory([])}
                  className="mt-2 w-full text-center text-[10px] text-[#3A3A4A] hover:text-[#555566] transition-colors font-mono"
                >
                  Clear conversation
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
