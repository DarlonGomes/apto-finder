// One unit card. Swipe left dismisses, swipe right likes; explicit CTAs
// track the pipeline: liked -> visit booked -> proposal made.

import { useRef, useState } from "react";
import type { StatusExtra, UnitCard, UnitStatus } from "@apto/shared";
import { brl } from "./api";
import { CostBar } from "./CostBar";

const SWIPE_THRESHOLD = 80;

const ACTIONS: [Exclude<UnitStatus, "dismissed">, string][] = [
  ["liked", "❤️ Gostei"],
  ["visit_booked", "📅 Visita"],
  ["proposal_made", "📝 Proposta"],
];

// ponytail: two known household emails, prettify by substring
const who = (email: string) => (email.includes("amanda") ? "Amanda" : "Darlon");

const SOURCE_LABELS: Record<string, string> = {
  vivareal: "VivaReal",
  zap: "ZAP",
  olx: "OLX",
  quintoandar: "QuintoAndar",
};

export function Card({
  unit,
  onTriage,
}: {
  unit: UnitCard;
  onTriage: (unit: UnitCard, status: UnitStatus | null, extra?: StatusExtra) => void;
}) {
  const [dx, setDx] = useState(0);
  const [editing, setEditing] = useState<"visit_booked" | "proposal_made" | null>(null);
  const start = useRef<{ x: number; y: number; scrolling: boolean } | null>(null);

  const pets =
    unit.accepts_pets === true
      ? `sim${unit.pets_evidence === "description" ? "*" : ""}`
      : unit.accepts_pets === false
        ? "não"
        : "não informado";
  const details: [string, string][] = [
    ["🛏️", `${unit.bedrooms ?? "?"} quartos`],
    ["📐", `${unit.area_m2 ?? "?"} m²`],
    ["🚗", `${unit.parking_spots ?? 0} vaga${(unit.parking_spots ?? 0) > 1 ? "s" : ""}`],
    ["🐾", `aceita pet: ${pets}`],
    ["🏷️", SOURCE_LABELS[unit.cheapest.source] ?? unit.cheapest.source],
  ];

  const flags = [
    unit.listing_count > 1 && `${unit.listing_count} anúncios · menor preço`,
    unit.price_change_pct != null && unit.price_change_pct < 0 && `${unit.price_change_pct}%`,
    unit.days_listed >= 30 && `${unit.days_listed} dias no ar`,
  ].filter(Boolean);

  return (
    <div className="border-rule relative overflow-hidden md:rounded-lg md:border">
      {/* action hints behind the card while swiping */}
      {dx !== 0 && (
        <div
          className={`absolute inset-0 flex items-center px-6 text-sm font-medium text-white ${
            dx > 0 ? "justify-start bg-good" : "justify-end bg-flag"
          }`}
        >
          {dx > 0 ? "❤️ gostei" : "descartar"}
        </div>
      )}
      <article
        className="border-rule flex h-full gap-3 border-b bg-paper p-4 md:border-b-0"
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
          else if (final >= SWIPE_THRESHOLD) onTriage(unit, "liked");
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
            className="h-24 w-24 shrink-0 rounded object-cover md:h-32 md:w-40"
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
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
            {details.map(([icon, text]) => (
              <span key={text} className="truncate">
                <span aria-hidden="true">{icon}</span> {text}
              </span>
            ))}
          </div>
          {flags.length > 0 && (
            <p className="mt-1 truncate text-xs font-medium text-flag">{flags.join(" · ")}</p>
          )}
          {editing ? (
            <form
              className="mt-2 flex flex-wrap items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (editing === "visit_booked") {
                  const v = f.get("visit_at") as string;
                  onTriage(unit, "visit_booked", { visit_at: new Date(v).toISOString() });
                } else {
                  onTriage(unit, "proposal_made", {
                    amount_cents: Math.round(Number(f.get("amount")) * 100),
                    note: (f.get("note") as string) || null,
                  });
                }
                setEditing(null);
              }}
            >
              {editing === "visit_booked" ? (
                <input
                  name="visit_at"
                  type="datetime-local"
                  required
                  className="border-rule rounded border bg-paper px-2 py-0.5 text-xs"
                />
              ) : (
                <>
                  <input
                    name="amount"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="0.01"
                    required
                    placeholder="R$"
                    className="border-rule w-24 rounded border bg-paper px-2 py-0.5 text-xs"
                  />
                  <input
                    name="note"
                    type="text"
                    placeholder="observação (opcional)"
                    className="border-rule min-w-0 flex-1 rounded border bg-paper px-2 py-0.5 text-xs"
                  />
                </>
              )}
              <button type="submit" className="rounded bg-good px-2 py-0.5 text-xs font-medium text-white">
                OK
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-1 text-xs text-muted"
              >
                ✕
              </button>
            </form>
          ) : (
            <div className="mt-2 flex items-center gap-1.5">
              {ACTIONS.map(([status, label]) => (
                <button
                  key={status}
                  onClick={() => {
                    if (unit.status === status) onTriage(unit, null);
                    else if (status === "liked") onTriage(unit, "liked");
                    else setEditing(status);
                  }}
                  className={`rounded border px-2 py-0.5 text-xs font-medium ${
                    unit.status === status
                      ? "border-good bg-good text-white"
                      : "border-rule text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
              <a
                href={unit.cheapest.url}
                target="_blank"
                rel="noreferrer"
                draggable={false}
                className="border-rule ml-auto shrink-0 rounded border px-2 py-0.5 text-xs font-medium text-muted"
              >
                abrir ↗
              </a>
            </div>
          )}
          {unit.status && unit.status !== "dismissed" && (
            <p className="mt-1 truncate text-xs text-muted">
              {[
                unit.status_visit_at &&
                  new Date(unit.status_visit_at).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                unit.status_amount_cents != null && brl(unit.status_amount_cents),
                unit.status_note,
                unit.status_actor && who(unit.status_actor),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </article>
    </div>
  );
}
