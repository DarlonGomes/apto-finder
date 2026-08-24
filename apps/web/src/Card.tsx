// One unit card with swipe triage: left dismisses, right shortlists (PRD 9.3).

import { useRef, useState } from "react";
import type { UnitCard } from "@apto/shared";
import { brl } from "./api";
import { CostBar } from "./CostBar";

const SWIPE_THRESHOLD = 80;

export function Card({
  unit,
  onTriage,
}: {
  unit: UnitCard;
  onTriage: (unit: UnitCard, status: "dismissed" | "shortlisted") => void;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; scrolling: boolean } | null>(null);

  const meta = [
    unit.bedrooms != null && `${unit.bedrooms} quartos`,
    unit.area_m2 != null && `${unit.area_m2}m²`,
    unit.parking_spots != null && `${unit.parking_spots} vaga${unit.parking_spots > 1 ? "s" : ""}`,
    unit.accepts_pets === true && (unit.pets_evidence === "amenity" ? "aceita pet" : "aceita pet*"),
  ].filter(Boolean);

  const flags = [
    unit.listing_count > 1 && `${unit.listing_count} anúncios · menor preço`,
    unit.price_change_pct != null && unit.price_change_pct < 0 && `${unit.price_change_pct}%`,
    unit.days_listed >= 30 && `${unit.days_listed} dias no ar`,
  ].filter(Boolean);

  return (
    <div className="relative overflow-hidden">
      {/* action hints behind the card while swiping */}
      {dx !== 0 && (
        <div
          className={`absolute inset-0 flex items-center px-6 text-sm font-medium text-white ${
            dx > 0 ? "justify-start bg-good" : "justify-end bg-flag"
          }`}
        >
          {dx > 0 ? "shortlist" : "descartar"}
        </div>
      )}
      <article
        className="border-rule flex gap-3 border-b bg-paper p-4"
        style={{
          transform: `translateX(${dx}px)`,
          transition: start.current ? "none" : "transform 150ms",
          touchAction: "pan-y",
        }}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY, scrolling: false };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.scrolling) return;
          const dY = Math.abs(e.clientY - s.y);
          const dX = e.clientX - s.x;
          if (dY > 12 && dY > Math.abs(dX)) {
            s.scrolling = true;
            setDx(0);
            return;
          }
          if (Math.abs(dX) > 8) (e.target as Element).setPointerCapture?.(e.pointerId);
          setDx(dX);
        }}
        onPointerUp={() => {
          const final = dx;
          start.current = null;
          setDx(0);
          if (final <= -SWIPE_THRESHOLD) onTriage(unit, "dismissed");
          else if (final >= SWIPE_THRESHOLD) onTriage(unit, "shortlisted");
        }}
        onPointerCancel={() => {
          start.current = null;
          setDx(0);
        }}
      >
        {unit.thumbnail && (
          <img
            src={unit.thumbnail}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-20 w-24 shrink-0 rounded object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <a
              href={unit.cheapest.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm text-muted"
            >
              {unit.neighborhood}
              {unit.street ? ` · ${unit.street}` : ""}
            </a>
            <span className="tabular shrink-0 text-base font-semibold">
              {brl(unit.cheapest.total_monthly_cents)}
            </span>
          </div>
          <div className="mt-2">
            <CostBar cheapest={unit.cheapest} />
          </div>
          <p className="mt-2 truncate text-xs text-muted">{meta.join(" · ")}</p>
          {flags.length > 0 && (
            <p className="mt-1 truncate text-xs font-medium text-flag">{flags.join(" · ")}</p>
          )}
          {unit.status && (
            <p className="mt-1 text-xs font-medium text-good">{unit.status}</p>
          )}
        </div>
      </article>
    </div>
  );
}
