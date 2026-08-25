// Unit detail (PRD 9.3): photo carousel, full cost breakdown, price history
// sparkline, every offer with an outbound link. No contact form.

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StatusExtra, UnitStatus } from "@apto/shared";
import type { DetailListing } from "./api";
import { brl, fetchUnitDetail } from "./api";
import { CostBar } from "./CostBar";
import { StatusActions } from "./StatusActions";

const SOURCE_LABELS: Record<string, string> = {
  vivareal: "VivaReal",
  zap: "ZAP",
  olx: "OLX",
  quintoandar: "QuintoAndar",
};

const COST_ROWS: [keyof DetailListing, string][] = [
  ["rent_cents", "aluguel"],
  ["condo_cents", "condomínio"],
  ["iptu_monthly_cents", "IPTU"],
  ["insurance_cents", "seguro incêndio"],
  ["service_fee_cents", "taxa de serviço"],
];

/** One polyline per listing, cheapest in ink, the rest muted. */
function Sparkline({
  listings,
  history,
}: {
  listings: DetailListing[];
  history: { listing_id: string; observed_at: string; total_monthly_cents: number }[];
}) {
  const series = listings
    .map((l) => history.filter((h) => h.listing_id === l.id))
    .filter((s) => s.length >= 2);
  if (series.length === 0) return null;

  const all = series.flat();
  const ts = all.map((h) => Date.parse(h.observed_at));
  const vs = all.map((h) => h.total_monthly_cents);
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  const [v0, v1] = [Math.min(...vs), Math.max(...vs)];
  const x = (t: number) => (t1 === t0 ? 0 : (100 * (t - t0)) / (t1 - t0));
  const y = (v: number) => (v1 === v0 ? 14 : 26 - (24 * (v - v0)) / (v1 - v0));

  return (
    <div>
      <svg viewBox="0 0 100 28" className="h-14 w-full" preserveAspectRatio="none">
        {series.map((s, i) => (
          <polyline
            key={i}
            fill="none"
            stroke={i === 0 ? "#14181C" : "#A8ADB5"}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            points={s.map((h) => `${x(Date.parse(h.observed_at))},${y(h.total_monthly_cents)}`).join(" ")}
          />
        ))}
      </svg>
      <p className="mt-0.5 text-[11px] text-muted">
        <span className="tabular">{brl(v0)}</span> – <span className="tabular">{brl(v1)}</span> desde{" "}
        {new Date(t0).toLocaleDateString("pt-BR")}
      </p>
    </div>
  );
}

/** Scroll-snap strip. Touch swipes natively; mouse gets drag-to-scroll
 *  (snap classes come off while dragging so scrollLeft wins, back on release). */
function Carousel({ photos }: { photos: string[] }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // one photo is 5/6 of the track width; snap settles it on the nearest one
  const page = (dir: 1 | -1) =>
    track.current!.scrollBy({ left: dir * track.current!.clientWidth * (5 / 6), behavior: "smooth" });

  return (
    <div className="relative">
      {photos.length > 1 &&
        ([["‹", -1], ["›", 1]] as const).map(([glyph, dir]) => (
          <button
            key={glyph}
            onClick={() => page(dir)}
            aria-label={dir === 1 ? "próxima foto" : "foto anterior"}
            className={`absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-ink/50 text-lg text-paper md:flex ${
              dir === 1 ? "right-2" : "left-2"
            }`}
          >
            {glyph}
          </button>
        ))}
      <div
        ref={track}
      className={`no-scrollbar flex gap-1 overflow-x-auto ${
        dragging ? "cursor-grabbing" : "snap-x snap-mandatory cursor-grab"
      }`}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") return;
        drag.current = { x: e.clientX, left: track.current!.scrollLeft };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.abs(e.clientX - d.x) > 4)
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        track.current!.scrollLeft = d.left - (e.clientX - d.x);
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      {photos.map((p) => (
        <img
          key={p}
          src={p}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-64 w-5/6 shrink-0 snap-center select-none object-cover md:h-80"
        />
        ))}
      </div>
    </div>
  );
}

export function Detail({
  id,
  onClose,
  onTriage,
}: {
  id: string;
  onClose: () => void;
  onTriage: (unitId: string, status: UnitStatus | null, extra?: StatusExtra) => void;
}) {
  const q = useQuery({ queryKey: ["unit", id], queryFn: () => fetchUnitDetail(id) });

  const u = q.data;
  const active = u?.listings.filter((l) => !l.delisted_at) ?? [];
  const cheapest = active[0] ?? u?.listings[0];
  // All photos across offers, deduped: identical uploads share the same CDN path.
  const photos = [...new Set((u?.listings ?? []).flatMap((l) => l.photos))];

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-paper">
      <header className="border-rule sticky top-0 z-10 flex items-center gap-3 border-b bg-paper/95 px-4 py-3 backdrop-blur">
        <button onClick={onClose} className="text-sm font-medium" aria-label="voltar">
          ← voltar
        </button>
        {u && (
          <span className="min-w-0 flex-1 truncate text-sm text-muted">
            {u.neighborhood}
            {u.street ? ` · ${u.street}` : ""}
          </span>
        )}
        {cheapest && (
          <span className="tabular shrink-0 text-base font-semibold">
            {brl(cheapest.total_monthly_cents)}
          </span>
        )}
      </header>

      {q.isLoading && <p className="p-4 text-sm text-muted">Carregando…</p>}
      {q.isError && <p className="p-4 text-sm text-flag">Não deu para carregar este imóvel.</p>}

      {u && cheapest && (
        <div className="mx-auto max-w-lg pb-8 md:max-w-3xl">
          {photos.length > 0 && <Carousel photos={photos} />}

          <div className="space-y-6 px-4 pt-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {(
                [
                  ["🛏️", `${u.bedrooms ?? "?"} quartos`],
                  ["🛁", `${cheapest.bathrooms ?? "?"} banheiros`],
                  ["📐", `${u.area_m2 ?? "?"} m²`],
                  [
                    "🚗",
                    `${u.parking_spots ?? 0} vaga${(u.parking_spots ?? 0) > 1 ? "s" : ""}`,
                  ],
                  ...(cheapest.floor != null
                    ? [["🏢", `${cheapest.floor}º andar`] as [string, string]]
                    : []),
                ] as [string, string][]
              ).map(([icon, text]) => (
                <span key={text}>
                  <span aria-hidden="true">{icon}</span> {text}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <StatusActions
                status={u.status}
                onTriage={(status, extra) => onTriage(u.id, status, extra)}
              />
            </div>

            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Custo mensal
              </h2>
              <CostBar cheapest={cheapest} />
              <table className="tabular mt-3 w-full text-sm">
                <tbody>
                  {COST_ROWS.map(([key, label]) => {
                    const v = cheapest[key] as number | null;
                    return (
                      <tr key={key} className="border-rule border-b">
                        <td className="py-1.5 text-muted">{label}</td>
                        <td className="py-1.5 text-right">
                          {v != null ? brl(v) : key === "condo_cents" ? "não informado" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td className="py-1.5 font-semibold">total</td>
                    <td className="py-1.5 text-right font-semibold">
                      {brl(cheapest.total_monthly_cents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Histórico de preço
              </h2>
              <Sparkline listings={u.listings} history={u.price_history} />
              <p className="text-xs text-muted">
                no ar desde{" "}
                {new Date(
                  Math.min(...u.listings.map((l) => Date.parse(l.first_seen_at))),
                ).toLocaleDateString("pt-BR")}
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Anúncios ({u.listings.length})
              </h2>
              <ul className="space-y-2">
                {u.listings.map((l) => (
                  <li
                    key={l.id}
                    className={`border-rule flex items-center justify-between gap-2 rounded border p-2.5 text-sm ${
                      l.delisted_at ? "opacity-50" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{SOURCE_LABELS[l.source] ?? l.source}</span>
                      {l.advertiser ? <span className="text-muted"> · {l.advertiser}</span> : null}
                      {l.delisted_at ? <span className="text-flag"> · saiu do ar</span> : null}
                      {l.cost_confidence === "partial" ? (
                        <span className="text-muted"> · condomínio ?</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular font-semibold">{brl(l.total_monthly_cents)}</span>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="border-rule rounded border px-2 py-0.5 text-xs font-medium text-muted"
                      >
                        abrir ↗
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
