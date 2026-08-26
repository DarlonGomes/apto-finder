// Map view (?view=map): every unit matching the current filters as a pin
// (shortlisted ones bigger and green), metro stations underneath. Lazy-loaded
// from App so Leaflet and its CSS stay out of the main bundle.

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { UnitCard } from "@apto/shared";
import { brl, fetchUnits, type Filters } from "./api";
import { STATION_ICON, STATIONS } from "./stations";

// Walk the cursor so the map shows the whole result set, not the first page.
async function fetchAll(f: Filters): Promise<UnitCard[]> {
  const out: UnitCard[] = [];
  let cursor: string | null = null;
  do {
    const page = await fetchUnits(f, cursor, 100);
    out.push(...page.units);
    cursor = page.next_cursor;
  } while (cursor && out.length < 1000);
  return out;
}

/** One unit on a small map with the metro stations around it (detail screen). */
export function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false }).setView([lat, lng], 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(m);
    for (const [name, sLat, sLng, kind] of STATIONS)
      L.circleMarker([sLat, sLng], {
        radius: kind === "metro" ? 5 : 4,
        color: kind === "metro" ? "#6B7280" : "#A8ADB5",
        fillColor: "#FAFAF7",
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(`${STATION_ICON[kind]} ${name}`)
        .addTo(m);
    L.circleMarker([lat, lng], {
      radius: 9,
      color: "#14181C",
      fillColor: "#14181C",
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(m);
    return () => {
      m.remove();
    };
  }, [lat, lng]);
  return <div ref={el} className="border-rule h-48 w-full rounded border" />;
}

export default function MapView({
  filters,
  onOpen,
  onClose,
}: {
  filters: Filters;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const q = useQuery({ queryKey: ["map", filters], queryFn: () => fetchAll(filters) });
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current).setView([-22.93, -43.2], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(m);
    for (const [name, lat, lng, kind] of STATIONS)
      L.circleMarker([lat, lng], {
        radius: kind === "metro" ? 4 : 3,
        color: kind === "metro" ? "#6B7280" : "#A8ADB5",
        fillColor: "#FAFAF7",
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(`${STATION_ICON[kind]} ${name}`)
        .addTo(m);
    pins.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = pins.current;
    if (!m || !g || !q.data) return;
    g.clearLayers();
    const pts: L.LatLngTuple[] = [];
    for (const u of q.data) {
      if (u.lat == null || u.lng == null) continue;
      const hot = !!u.status && u.status !== "dismissed";
      L.circleMarker([u.lat, u.lng], {
        radius: hot ? 9 : 6,
        color: hot ? "#2F6B4F" : "#14181C",
        fillColor: hot ? "#2F6B4F" : "#14181C",
        fillOpacity: hot ? 0.9 : 0.55,
        weight: 1,
      })
        .bindTooltip(`${brl(u.cheapest.total_monthly_cents)} · ${u.neighborhood}`)
        .on("click", () => onOpen(u.id))
        .addTo(g);
      pts.push([u.lat, u.lng]);
    }
    // Fit once per mount; refetches after a status change must not re-zoom.
    if (pts.length && !fitted.current) {
      m.fitBounds(L.latLngBounds(pts), { padding: [24, 24] });
      fitted.current = true;
    }
  }, [q.data, onOpen]);

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-paper">
      <header className="border-rule flex items-center justify-between border-b px-4 py-3">
        <h1 className="text-sm font-semibold">
          Mapa · <span className="tabular">{q.data?.length ?? "…"}</span> imóveis
        </h1>
        <button onClick={onClose} className="rounded border border-ink px-3 py-1 text-xs font-medium">
          fechar
        </button>
      </header>
      {q.isError && <p className="p-4 text-sm text-flag">API fora do ar.</p>}
      <div ref={el} className="flex-1" />
    </div>
  );
}
