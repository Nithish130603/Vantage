"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { SuburbResult, Tier } from "@/lib/api";
import { TIER_COLOR, TIER_LABEL } from "@/lib/api";

const EXACT_MATCH_COLOR = "#A78BFA";

interface Props {
  results: SuburbResult[];
  selected: SuburbResult | null;
  onSelect: (r: SuburbResult) => void;
  filter: string;
  savedH3s?: Set<string>;
  exactMatchH3s?: Set<string>;
}

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Tier display config
const TIER_CFG: Record<string, { radius: number; opacity: number; glowRadius: number }> = {
  BETTER_THAN_BEST: { radius: 9,  opacity: 1,    glowRadius: 22 },
  PRIME:            { radius: 7,  opacity: 0.95, glowRadius: 18 },
  STRONG:           { radius: 5,  opacity: 0.85, glowRadius: 14 },
  WATCH:            { radius: 3.5,opacity: 0.65, glowRadius: 0  },
  AVOID:            { radius: 2.5,opacity: 0.55, glowRadius: 0  },
};

const TIERS_WITH_GLOW = ["BETTER_THAN_BEST", "PRIME", "STRONG"];

function FallbackMap({ results, selected, onSelect }: Omit<Props, "filter">) {
  const tiers: Tier[] = ["BETTER_THAN_BEST", "PRIME", "STRONG", "WATCH", "AVOID"];
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 bg-[#0D0D10] p-8">
      <div className="text-center max-w-sm">
        <p className="text-xs font-mono tracking-[0.2em] text-[#0D7377] uppercase mb-2">Mapbox token required</p>
        <p className="text-[#8B8B99] text-sm leading-relaxed mb-3">
          Add <code className="font-mono text-[#F0F0F2] bg-white/5 px-1.5 py-0.5 rounded">NEXT_PUBLIC_MAPBOX_TOKEN</code> to{" "}
          <code className="font-mono text-[#F0F0F2] bg-white/5 px-1.5 py-0.5 rounded">frontend/.env.local</code>
        </p>
        <a href="https://account.mapbox.com" target="_blank" rel="noopener noreferrer" className="text-xs text-[#0D7377] underline">
          Get a free token at mapbox.com →
        </a>
      </div>
      <div className="w-full max-w-md space-y-2">
        {tiers.map((t) => {
          const group = results.filter((r) => r.tier === t);
          if (!group.length) return null;
          return (
            <div key={t}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: TIER_COLOR[t] }} />
                <span className="text-xs text-[#8B8B99] uppercase tracking-wider font-mono">{t.replace(/_/g, " ")}</span>
                <span className="text-xs text-[#555566]">{group.length} suburbs</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.slice(0, 6).map((r) => (
                  <button
                    key={r.h3_r7}
                    onClick={() => onSelect(r)}
                    className={`text-[10px] font-mono px-2 py-1 rounded border transition-all ${
                      selected?.h3_r7 === r.h3_r7
                        ? "border-[#0D7377] text-[#F0F0F2] bg-[#0D7377]/15"
                        : "border-white/8 text-[#8B8B99] hover:border-white/20"
                    }`}
                  >
                    {r.locality ?? `${r.center_lat.toFixed(2)},${r.center_lon.toFixed(2)}`}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildGeoJSON(
  results: SuburbResult[],
  activeFilter: string,
  savedH3s?: Set<string>,
  exactMatchH3s?: Set<string>
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: results
      .filter((r) => {
        if (activeFilter === "ALL") return true;
        if (activeFilter === "SAVED") return savedH3s?.has(r.h3_r7) ?? false;
        if (activeFilter === "EXACT_MATCH") return exactMatchH3s?.has(r.h3_r7) ?? false;
        if (activeFilter === "BETTER_THAN_BEST") return r.tier === "BETTER_THAN_BEST";
        return r.tier === activeFilter;
      })
      .map((r) => {
        const isExact = exactMatchH3s?.has(r.h3_r7) ?? false;
        const color = isExact && (activeFilter === "ALL" || activeFilter === "EXACT_MATCH")
          ? EXACT_MATCH_COLOR
          : (TIER_COLOR[r.tier] ?? "#555566");
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [r.center_lon, r.center_lat] },
          properties: {
            h3_r7:           r.h3_r7,
            tier:            r.tier,
            score:           r.score,
            score100:        Math.round(r.score * 100),
            locality:        r.locality ?? "",
            state:           r.state ?? "",
            venue_count:     r.venue_count,
            trajectory:      r.trajectory_status ?? "",
            risk:            r.risk_level ?? "",
            is_btb:          r.is_better_than_best ? 1 : 0,
            is_exact:        isExact ? 1 : 0,
            color,
            glow_radius:     TIER_CFG[r.tier]?.glowRadius ?? 0,
            dot_radius:      isExact ? 6 : (TIER_CFG[r.tier]?.radius ?? 3),
            dot_opacity:     isExact ? 0.95 : (TIER_CFG[r.tier]?.opacity ?? 0.7),
            has_glow:        TIERS_WITH_GLOW.includes(r.tier) ? 1 : 0,
          },
        };
      }),
  };
}

export default function OpportunityMap({ results, selected, onSelect, filter, savedH3s }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<unknown>(null);
  const [ready, setReady] = useState(false);
  const resultsRef  = useRef(results);
  resultsRef.current = results;

  // Add pulsing BTB image to map
  const addPulsingDot = useCallback((map: unknown) => {
    const m = map as {
      addImage: (name: string, img: unknown, opts?: unknown) => void;
      triggerRepaint: () => void;
    };
    const size = 120;
    const duration = 1600;
    const dot = {
      width: size,
      height: size,
      data: new Uint8ClampedArray(size * size * 4),
      ctx: null as CanvasRenderingContext2D | null,
      onAdd() {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        this.ctx = canvas.getContext("2d");
      },
      render() {
        const t = (performance.now() % duration) / duration;
        const ctx = this.ctx!;
        const c  = size / 2;
        const innerR = c * 0.28;
        const outerR = c * 0.55 + c * 0.45 * t;
        ctx.clearRect(0, 0, size, size);
        // Pulsing outer ring
        ctx.beginPath();
        ctx.arc(c, c, outerR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232,197,71,${0.45 * (1 - t)})`;
        ctx.fill();
        // Mid glow
        ctx.beginPath();
        ctx.arc(c, c, c * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(232,197,71,0.12)";
        ctx.fill();
        // Core
        ctx.beginPath();
        ctx.arc(c, c, innerR, 0, Math.PI * 2);
        ctx.fillStyle = "#E8C547";
        ctx.fill();
        this.data = ctx.getImageData(0, 0, size, size).data;
        m.triggerRepaint();
        return true;
      },
    };
    m.addImage("pulsing-btb", dot, { pixelRatio: 2 });
  }, []);

  const initMap = useCallback(async () => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;
    const mapboxgl = (await import("mapbox-gl")).default;
    await import("mapbox-gl/dist/mapbox-gl.css");
    (mapboxgl as { accessToken: string }).accessToken = TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [133.8, -27.5],
      zoom: 4,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("load", () => {
      addPulsingDot(map);

      const geojson = buildGeoJSON(resultsRef.current, "ALL", savedH3s);

      // Source with clustering for regular dots
      map.addSource("suburbs-cluster", {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: 10,
        clusterRadius: 40,
      });

      // Source without clustering for BTB (so pulsing shows individually)
      map.addSource("suburbs-btb", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: geojson.features.filter(
            (f) => (f.properties as { tier: string }).tier === "BETTER_THAN_BEST"
          ),
        },
      });

      // Cluster circles
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "suburbs-cluster",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step", ["get", "point_count"],
            "#1A3A3A", 10,
            "#0D5C60", 30,
            "#0D7377",
          ],
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 30, 30],
          "circle-opacity": 0.85,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#0A0A0B",
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "suburbs-cluster",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
        },
        paint: { "text-color": "#F0F0F2" },
      });

      // Glow layer for STRONG / PRIME / BTB
      map.addLayer({
        id: "pins-glow",
        type: "circle",
        source: "suburbs-cluster",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "has_glow"], 1]],
        paint: {
          "circle-radius":  ["get", "glow_radius"],
          "circle-color":   ["get", "color"],
          "circle-opacity": 0.12,
          "circle-blur":    1.2,
        },
      });

      // Regular dots (AVOID, WATCH, STRONG — not BTB which uses pulsing)
      map.addLayer({
        id: "suburb-pins",
        type: "circle",
        source: "suburbs-cluster",
        filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "tier"], "BETTER_THAN_BEST"]],
        paint: {
          "circle-radius":       ["get", "dot_radius"],
          "circle-color":        ["get", "color"],
          "circle-opacity":      ["get", "dot_opacity"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,0,0,0.4)",
          "circle-stroke-opacity": 0.5,
        },
      });

      // BTB: pulsing image
      map.addLayer({
        id: "btb-pulse",
        type: "symbol",
        source: "suburbs-btb",
        layout: {
          "icon-image":            "pulsing-btb",
          "icon-size":             0.55,
          "icon-allow-overlap":    true,
          "icon-ignore-placement": true,
        },
      });

      // BTB: ★ text overlay
      map.addLayer({
        id: "btb-star",
        type: "symbol",
        source: "suburbs-btb",
        layout: {
          "text-field":            "★",
          "text-size":             13,
          "text-anchor":           "center",
          "text-allow-overlap":    true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color":       "#E8C547",
          "text-halo-color":  "#0A0A0B",
          "text-halo-width":  1,
        },
      });

      // ── Hover popup ───────────────────────────────────────────────
      const popup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: "280px",
        className: "opp-popup",
      });

      const HOVER_LAYERS = ["suburb-pins", "btb-pulse"];

      HOVER_LAYERS.forEach((layerId) => {
        map.on("mouseenter", layerId, (e) => {
          map.getCanvas().style.cursor = "pointer";
          const feat = e.features?.[0];
          if (!feat) return;
          const p = feat.properties as {
            locality: string; state: string; tier: string;
            score100: number; venue_count: number; trajectory: string; risk: string;
          };
          const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
          const isBTB = p.tier === "BETTER_THAN_BEST";
          const tierLabel = TIER_LABEL[p.tier as keyof typeof TIER_LABEL] ?? p.tier;
          const color = TIER_COLOR[p.tier as keyof typeof TIER_COLOR] ?? "#8B8B99";
          popup
            .setLngLat(coords)
            .setHTML(`
              <div class="opp-popup-inner">
                ${isBTB ? '<p class="opp-btb-badge">★ Top opportunity</p>' : ""}
                <p class="opp-name">${p.locality || "Suburb"}, ${p.state}</p>
                <div class="opp-row">
                  <span class="opp-score" style="color:${color}">${p.score100}</span>
                  <span class="opp-score-label">Opportunity Score</span>
                </div>
                <p class="opp-tier" style="color:${color}">${tierLabel}</p>
                ${p.trajectory ? `<p class="opp-meta">${p.trajectory} · ${p.risk}</p>` : ""}
                <p class="opp-hint">Click to view full report →</p>
              </div>
            `)
            .addTo(map);
        });

        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });

        map.on("click", layerId, (e) => {
          const feat = e.features?.[0];
          if (!feat) return;
          const h3 = feat.properties?.h3_r7;
          const r = resultsRef.current.find((x) => x.h3_r7 === h3);
          if (r) onSelect(r);
        });
      });

      // Zoom into cluster on click
      map.on("click", "clusters", (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const clusterId = feat.properties?.cluster_id;
        const src = map.getSource("suburbs-cluster") as {
          getClusterExpansionZoom: (id: number, cb: (err: unknown, zoom: number) => void) => void;
        };
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
          (map as unknown as {
            easeTo: (o: { center: [number, number]; zoom: number }) => void;
          }).easeTo({ center: coords, zoom });
        });
      });

      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });

      setReady(true);
    });
  }, [addPulsingDot, onSelect]);

  useEffect(() => {
    initMap();
    return () => {
      if (mapRef.current) {
        (mapRef.current as { remove: () => void }).remove();
        mapRef.current = null;
      }
    };
  }, [initMap]);

  // Update source data when filter changes
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current as {
      getSource: (id: string) => { setData: (d: GeoJSON.FeatureCollection) => void } | undefined;
    };

    const filtered = buildGeoJSON(resultsRef.current, filter, savedH3s);

    map.getSource("suburbs-cluster")?.setData(filtered);
    map.getSource("suburbs-btb")?.setData({
      type: "FeatureCollection",
      features: filtered.features.filter(
        (f) => (f.properties as { tier: string }).tier === "BETTER_THAN_BEST"
      ),
    });
  }, [filter, ready, savedH3s]);

  // Fly to selected suburb
  useEffect(() => {
    if (!selected || !mapRef.current) return;
    (mapRef.current as {
      flyTo: (o: { center: [number, number]; zoom: number; speed: number }) => void;
    }).flyTo({ center: [selected.center_lon, selected.center_lat], zoom: 13, speed: 1.4 });
  }, [selected]);

  if (!TOKEN) return <FallbackMap results={results} selected={selected} onSelect={onSelect} />;

  return (
    <>
      <style>{`
        .opp-popup .mapboxgl-popup-content {
          background: #131316;
          border: 1px solid #26262B;
          border-radius: 10px;
          box-shadow: 0 12px 40px rgba(0,0,0,0.7);
          padding: 12px 16px;
        }
        .opp-popup .mapboxgl-popup-tip { display: none; }
        .opp-popup-inner { font-family: system-ui, -apple-system, sans-serif; }
        .opp-btb-badge { font-size: 11px; color: #E8C547; margin: 0 0 4px; font-weight: 600; }
        .opp-name { font-size: 15px; font-weight: 600; color: #F0F0F2; margin: 0 0 8px; }
        .opp-row { display: flex; align-items: baseline; gap: 6px; margin: 0 0 4px; }
        .opp-score { font-size: 28px; font-weight: 300; line-height: 1; }
        .opp-score-label { font-size: 10px; color: #555566; text-transform: uppercase; letter-spacing: 0.1em; }
        .opp-tier { font-size: 12px; margin: 0 0 4px; }
        .opp-meta { font-size: 11px; color: #555566; margin: 0 0 6px; }
        .opp-hint { font-size: 10px; color: #3A3A4A; margin: 6px 0 0; }
      `}</style>

      {/* On-map legend */}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          right: 16,
          zIndex: 10,
          background: "rgba(13,13,14,0.88)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 10,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {[
          { color: "#E8C547", label: "Top opportunity", star: true },
          { color: "#0D7377", label: "Strong match" },
          { color: "#D4A017", label: "Watch" },
          { color: "#C0392B", label: "Avoid" },
        ].map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width={14} height={14} viewBox="0 0 14 14">
              {item.star ? (
                <path
                  d="M7 0.5l1.55 3.14 3.46.5-2.51 2.44.59 3.45L7 8.42l-3.09 1.61.59-3.45L2 4.14l3.46-.5z"
                  fill={item.color}
                />
              ) : (
                <circle cx={7} cy={7} r={5} fill={item.color} opacity={0.9} />
              )}
            </svg>
            <span style={{ fontSize: 11, color: "#C8C8D4", fontFamily: "system-ui" }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      <div ref={containerRef} className="h-full w-full" />
    </>
  );
}
