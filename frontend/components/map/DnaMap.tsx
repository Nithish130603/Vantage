"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { EmbeddingPoint } from "@/lib/api";
import { TIER_COLOR } from "@/lib/api";

interface Props {
  points: EmbeddingPoint[];
  goldH3s: Set<string>;
  clientH3s: Set<string>;
  category: string;
  activeFilter: string;
  onSelect: (p: EmbeddingPoint) => void;
}

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

function tierColor(tier: string | null): string {
  return TIER_COLOR[tier as keyof typeof TIER_COLOR] ?? "#2A2A32";
}

function tierRadius(tier: string | null): number {
  if (tier === "BETTER_THAN_BEST") return 7;
  if (tier === "STRONG")           return 5;
  if (tier === "WATCH")            return 3.5;
  if (tier === "AVOID")            return 3;
  return 2;
}

// Plain-English tier label
const TIER_LABEL: Record<string, string> = {
  BETTER_THAN_BEST: "Top opportunity",
  STRONG:           "Strong match",
  WATCH:            "Monitor",
  AVOID:            "High risk",
};

// Fallback when no Mapbox token
function FallbackDnaMap() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-[#0D0D10]">
      <p className="text-xs font-mono tracking-[0.2em] text-[#0D7377] uppercase">
        Mapbox token required
      </p>
      <p className="text-[#8B8B99] text-sm text-center max-w-xs leading-relaxed">
        Add{" "}
        <code className="font-mono text-[#F0F0F2] bg-white/5 px-1.5 py-0.5 rounded">
          NEXT_PUBLIC_MAPBOX_TOKEN
        </code>{" "}
        to <code className="font-mono text-[#F0F0F2] bg-white/5 px-1.5 py-0.5 rounded">frontend/.env.local</code>
      </p>
    </div>
  );
}

export default function DnaMap({
  points,
  goldH3s,
  clientH3s,
  category,
  activeFilter,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<unknown>(null);
  const markersRef   = useRef<unknown[]>([]);
  const [ready, setReady] = useState(false);

  // Build GeoJSON from points
  const buildGeoJSON = useCallback(
    (pts: EmbeddingPoint[], filter: string): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: pts
        .filter((p) => {
          if (filter === "ALL") return true;
          if (filter === "GOLD") return goldH3s.has(p.h3_r7);
          return p.tier === filter;
        })
        .map((p) => {
          const role = goldH3s.has(p.h3_r7)
            ? "gold"
            : clientH3s.has(p.h3_r7)
            ? "client"
            : "normal";
          return {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.center_lon, p.center_lat] },
            properties: {
              h3_r7:    p.h3_r7,
              tier:     p.tier ?? "",
              score:    p.score ?? 0,
              locality: p.locality ?? "",
              state:    p.state ?? "",
              role,
              color:    role === "gold" ? "#E8C547" : tierColor(p.tier),
              radius:   role === "gold" ? 9 : tierRadius(p.tier),
            },
          };
        }),
    }),
    [goldH3s, clientH3s]
  );

  const initMap = useCallback(async () => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;

    const mapboxgl = (await import("mapbox-gl")).default;
    await import("mapbox-gl/dist/mapbox-gl.css");
    (mapboxgl as { accessToken: string }).accessToken = TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [133.8, -27.5],
      zoom: 3.8,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("load", () => {
      const geojson = buildGeoJSON(points, "ALL");

      map.addSource("dna-points", { type: "geojson", data: geojson });

      // Glow for gold / top opportunity
      map.addLayer({
        id: "dna-glow",
        type: "circle",
        source: "dna-points",
        filter: ["==", ["get", "role"], "gold"],
        paint: {
          "circle-radius": 20,
          "circle-color": "#E8C547",
          "circle-opacity": 0.18,
          "circle-blur": 1,
        },
      });

      // All dots
      map.addLayer({
        id: "dna-dots",
        type: "circle",
        source: "dna-points",
        filter: ["!=", ["get", "role"], "client"],
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color":  ["get", "color"],
          "circle-opacity": [
            "case",
            ["==", ["get", "role"], "gold"], 1,
            ["==", ["get", "tier"], "AVOID"], 0.65,
            ["==", ["get", "tier"], "WATCH"], 0.45,
            0.75,
          ],
          "circle-stroke-width": ["case", ["==", ["get", "role"], "gold"], 1.5, 0],
          "circle-stroke-color": "#0A0A0B",
        },
      });

      // Client locations — white ring
      map.addLayer({
        id: "dna-client",
        type: "circle",
        source: "dna-points",
        filter: ["==", ["get", "role"], "client"],
        paint: {
          "circle-radius": 10,
          "circle-color":  "rgba(232,197,71,0.15)",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#E8C547",
        },
      });

      // Star labels on gold points
      map.addLayer({
        id: "dna-stars",
        type: "symbol",
        source: "dna-points",
        filter: ["==", ["get", "role"], "gold"],
        layout: {
          "text-field": "★",
          "text-size": 14,
          "text-anchor": "center",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#E8C547",
          "text-halo-color": "#0A0A0B",
          "text-halo-width": 1.5,
        },
      });

      // Popup on click
      const popup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: "260px",
        className: "dna-popup",
      });

      map.on("mouseenter", "dna-dots", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feat = e.features?.[0];
        if (!feat) return;
        const p = feat.properties as {
          locality: string; state: string; tier: string; score: number; role: string;
        };
        const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
        const scoreStr = p.score > 0 ? `${Math.round(p.score * 100)}` : "–";
        const tierLabel = TIER_LABEL[p.tier] ?? p.tier;
        popup
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:system-ui;padding:2px 0">
              <p style="font-size:14px;font-weight:600;color:#F0F0F2;margin:0 0 3px">${p.locality || "Suburb"}</p>
              <p style="font-size:11px;color:#8B8B99;margin:0 0 6px">${p.state}</p>
              ${p.score > 0 ? `<p style="font-size:22px;font-weight:300;color:#0D7377;margin:0 0 4px;line-height:1">${scoreStr}</p>` : ""}
              <p style="font-size:11px;color:#555566;margin:0">${tierLabel}</p>
              <p style="font-size:10px;color:#3A3A4A;margin:4px 0 0">Click for full report →</p>
            </div>
          `)
          .addTo(map);
      });

      map.on("mouseleave", "dna-dots", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      map.on("mouseenter", "dna-stars", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const feat = e.features?.[0];
        if (!feat) return;
        const p = feat.properties as {
          locality: string; state: string; tier: string; score: number;
        };
        const coords = (feat.geometry as GeoJSON.Point).coordinates as [number, number];
        popup
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family:system-ui;padding:2px 0">
              <p style="font-size:13px;color:#E8C547;margin:0 0 2px;font-weight:600">★ Top opportunity</p>
              <p style="font-size:14px;font-weight:600;color:#F0F0F2;margin:0 0 3px">${p.locality || "Suburb"}</p>
              <p style="font-size:11px;color:#8B8B99;margin:0 0 6px">${p.state}</p>
              ${p.score > 0 ? `<p style="font-size:22px;font-weight:300;color:#E8C547;margin:0 0 4px;line-height:1">${Math.round(p.score * 100)}</p>` : ""}
              <p style="font-size:10px;color:#3A3A4A;margin:4px 0 0">Click for full report →</p>
            </div>
          `)
          .addTo(map);
      });

      map.on("mouseleave", "dna-stars", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      map.on("click", ["dna-dots", "dna-stars"], (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const h3 = feat.properties?.h3_r7;
        const pt = points.find((p) => p.h3_r7 === h3);
        if (pt) onSelect(pt);
      });

      setReady(true);
    });
  }, [points, buildGeoJSON, onSelect]);

  // Init once
  useEffect(() => {
    initMap();
    return () => {
      markersRef.current.forEach((m) => (m as { remove: () => void }).remove());
      markersRef.current = [];
      if (mapRef.current) {
        (mapRef.current as { remove: () => void }).remove();
        mapRef.current = null;
      }
    };
  }, [initMap]);

  // Update filter without remounting
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current as {
      getSource: (id: string) => { setData: (d: GeoJSON.FeatureCollection) => void } | undefined;
    };
    const src = map.getSource("dna-points");
    if (src) src.setData(buildGeoJSON(points, activeFilter));
  }, [activeFilter, points, buildGeoJSON, ready]);

  if (!TOKEN) return <FallbackDnaMap />;

  return (
    <>
      <style>{`
        .dna-popup .mapboxgl-popup-content {
          background: #131316;
          border: 1px solid #26262B;
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.65);
          padding: 10px 14px;
        }
        .dna-popup .mapboxgl-popup-tip { display: none; }
      `}</style>
      <div ref={containerRef} className="h-full w-full" />
    </>
  );
}
