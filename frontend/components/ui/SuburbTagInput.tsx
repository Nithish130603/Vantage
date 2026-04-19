"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/lib/api";

type Suggestion =
  | { kind: "place";  description: string; place_id: string }
  | { kind: "suburb"; locality: string;    state: string; h3_r7: string };

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  variant?: "default" | "danger";
}

export default function SuburbTagInput({
  value,
  onChange,
  placeholder = "Start typing an address or suburb…",
  maxTags = 20,
  variant = "default",
}: Props) {
  const accent = variant === "danger" ? "#D4A017" : "#0D7377";
  const [inputVal, setInputVal]         = useState("");
  const [suggestions, setSuggestions]   = useState<Suggestion[]>([]);
  const [open, setOpen]                 = useState(false);
  const [activeIdx, setActiveIdx]       = useState(-1);
  const [loading, setLoading]           = useState(false);

  const inputRef    = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused   = useRef(false);

  // Debounced fetch — Photon (OSM) first, falls back to local /suggest
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = inputVal.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const places = await api.placesAutocomplete(q, 6);
        if (places.length > 0) {
          setSuggestions(places.map((p) => ({ ...p, kind: "place" as const })));
          setOpen(true);
          setActiveIdx(-1);
          return;
        }
        // Photon empty — fall back to local DuckDB suburb names
        const suburbs = await api.suggest(q, 8);
        setSuggestions(suburbs.map((s) => ({ ...s, kind: "suburb" as const })));
        setOpen(suburbs.length > 0);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [inputVal]);

  const addLocation = useCallback(
    (label: string) => {
      const trimmed = label.trim();
      if (!trimmed || value.includes(trimmed) || value.length >= maxTags) return;
      onChange([...value, trimmed]);
      setInputVal("");
      setSuggestions([]);
      setOpen(false);
      setActiveIdx(-1);
      inputRef.current?.focus();
    },
    [value, onChange, maxTags]
  );

  const removeLocation = useCallback(
    (label: string) => onChange(value.filter((v) => v !== label)),
    [value, onChange]
  );

  const selectSuggestion = useCallback(
    (s: Suggestion) => addLocation(s.kind === "place" ? s.description : s.locality),
    [addLocation]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
        break;
      case "Enter":
      case ",":
        e.preventDefault();
        if (activeIdx >= 0 && suggestions[activeIdx]) {
          selectSuggestion(suggestions[activeIdx]);
        } else if (inputVal.trim().length >= 2) {
          addLocation(inputVal.trim());
        }
        break;
      case "Escape":
        setOpen(false);
        setActiveIdx(-1);
        break;
      case "Backspace":
        if (!inputVal && value.length > 0) removeLocation(value[value.length - 1]);
        break;
    }
  };

  return (
    <div style={{ position: "relative" }}>
      {/* Input area */}
      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          backgroundColor: "#0A0A0B",
          border: `1px solid ${isFocused.current && open ? "#0D7377" : "#26262B"}`,
          borderRadius: 6,
          padding: "8px 10px",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          cursor: "text",
          minHeight: 44,
          transition: "border-color 0.15s",
        }}
      >
        {value.map((label) => (
          <span
            key={label}
            title={label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              backgroundColor: `${accent}22`,
              border: `1px solid ${accent}58`,
              borderRadius: 4,
              padding: "3px 8px 3px 10px",
              fontSize: 12,
              color: accent,
              fontFamily: "var(--font-geist-sans)",
              whiteSpace: "nowrap",
              maxWidth: 260,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                removeLocation(label);
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: accent,
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
                opacity: 0.7,
                flexShrink: 0,
              }}
              aria-label={`Remove ${label}`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            isFocused.current = true;
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => {
            isFocused.current = false;
            setTimeout(() => setOpen(false), 160);
          }}
          placeholder={value.length === 0 ? placeholder : "Add another…"}
          style={{
            flex: "1 1 160px",
            minWidth: 140,
            background: "none",
            border: "none",
            outline: "none",
            color: "#F0F0F2",
            fontSize: 13,
            fontFamily: "var(--font-geist-sans)",
            padding: "2px 4px",
          }}
        />
      </div>

      {/* Dropdown */}
      {open && (
        <div
          ref={dropdownRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "#131316",
            border: "1px solid #26262B",
            borderRadius: 6,
            boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
            zIndex: 100,
            overflow: "hidden",
          }}
        >
          {loading && suggestions.length === 0 && (
            <div style={{ padding: "10px 14px", fontSize: 12, color: "#555566" }}>
              Searching…
            </div>
          )}

          {suggestions.map((s, i) => {
            const label      = s.kind === "place" ? s.description : s.locality;
            const commaIdx   = label.indexOf(",");
            const mainText   = commaIdx > 0 ? label.slice(0, commaIdx) : label;
            const subText    = commaIdx > 0 ? label.slice(commaIdx + 1).trim() : null;
            const stateBadge = s.kind === "suburb" ? s.state : null;
            const key        = s.kind === "place" ? s.place_id : s.h3_r7;

            return (
              <button
                key={key}
                onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 14px",
                  background: activeIdx === i ? `${accent}1e` : "transparent",
                  border: "none",
                  borderBottom: i < suggestions.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.1s",
                }}
              >
                {/* Pin icon */}
                <svg width="11" height="14" viewBox="0 0 11 14" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
                  <path
                    d="M5.5 0C3.02 0 1 2.02 1 4.5c0 3.375 4.5 9 4.5 9s4.5-5.625 4.5-9C10 2.02 7.98 0 5.5 0Zm0 6.125a1.625 1.625 0 1 1 0-3.25 1.625 1.625 0 0 1 0 3.25Z"
                    fill={accent}
                  />
                </svg>

                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      color: activeIdx === i ? "#F0F0F2" : "#C8C8D4",
                      fontFamily: "var(--font-geist-sans)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {mainText.toLowerCase().startsWith(inputVal.toLowerCase()) ? (
                      <>
                        <strong style={{ color: "#F0F0F2", fontWeight: 600 }}>
                          {mainText.slice(0, inputVal.length)}
                        </strong>
                        {mainText.slice(inputVal.length)}
                      </>
                    ) : (
                      mainText
                    )}
                  </span>
                  {subText && (
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "#555566",
                        fontFamily: "var(--font-geist-sans)",
                        marginTop: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {subText}
                    </span>
                  )}
                </span>

                {stateBadge && (
                  <span style={{ fontSize: 10, color: "#555566", fontFamily: "var(--font-geist-mono)", letterSpacing: "0.08em", flexShrink: 0 }}>
                    {stateBadge}
                  </span>
                )}
              </button>
            );
          })}

          {/* OSM attribution — required by Photon/OSM terms */}
          {suggestions.length > 0 && (
            <div
              style={{
                padding: "5px 14px",
                borderTop: "1px solid rgba(255,255,255,0.04)",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 0a5 5 0 1 0 0 10A5 5 0 0 0 5 0Zm.5 7.5h-1v-3h1v3Zm0-4h-1v-1h1v1Z" fill="#3A3A4A" />
              </svg>
              <span style={{ fontSize: 10, color: "#3A3A4A", fontFamily: "var(--font-geist-mono)" }}>
                © OpenStreetMap contributors
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
