// Compare view (?view=compare): every liked+ unit side by side, attributes as
// rows, units as columns. Sticky label column, horizontal scroll on the phone.
// Best value per comparable row gets the good highlight. Notes save on blur.

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UnitCard } from "@apto/shared";
import { brl, fetchCompareUnits, putNote } from "./api";
import { who } from "./Card";
import { CostBar } from "./CostBar";
import { fmtDist, nearestStation } from "./stations";

const STATUS_LABELS: Record<string, string> = {
  liked: "❤️ gostei",
  visit_booked: "📅 visita",
  proposal_made: "📝 proposta",
};

/** Best value in a row, or null when fewer than two units have one or all tie. */
function bestVal(
  units: UnitCard[],
  get: (u: UnitCard) => number | null,
  dir: "min" | "max",
): number | null {
  const vals = units.map(get).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const b = dir === "min" ? Math.min(...vals) : Math.max(...vals);
  return vals.every((v) => v === b) ? null : b;
}

/** Shared per-unit note, saved on blur. Used by Compare and Detail. */
export function NoteField({ unitId, note }: { unitId: string; note: string | null }) {
  const qc = useQueryClient();
  const [text, setText] = useState(note ?? "");
  const save = useMutation({
    mutationFn: (n: string) => putNote(unitId, n),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["compare"] });
      qc.invalidateQueries({ queryKey: ["unit", unitId] });
    },
  });
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== (note ?? "") && save.mutate(text)}
        rows={3}
        placeholder="ex: cheiro de mofo, sem elevador…"
        className="border-rule w-full rounded border bg-paper p-1.5 text-xs"
      />
      {save.isError && <p className="text-xs text-flag">erro ao salvar</p>}
    </div>
  );
}

export function Compare({
  onOpen,
  onClose,
}: {
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const q = useQuery({ queryKey: ["compare"], queryFn: fetchCompareUnits });
  const units = q.data?.units ?? [];

  const perM2 = (u: UnitCard) =>
    u.area_m2 ? Math.round(u.cheapest.total_monthly_cents / u.area_m2) : null;
  const bestTotal = bestVal(units, (u) => u.cheapest.total_monthly_cents, "min");
  const bestArea = bestVal(units, (u) => u.area_m2, "max");
  const bestPerM2 = bestVal(units, perM2, "min");
  const bestDays = bestVal(units, (u) => u.days_listed, "max");
  const metro = (u: UnitCard) =>
    u.lat != null && u.lng != null ? nearestStation(u.lat, u.lng) : null;
  const bestMetro = bestVal(units, (u) => metro(u)?.meters ?? null, "min");
  const bestDrop = bestVal(
    units,
    (u) => (u.price_change_pct != null && u.price_change_pct < 0 ? u.price_change_pct : null),
    "min",
  );
  const hl = (isBest: boolean) => (isBest ? "font-semibold text-good" : "");

  const rows: { label: string; cell: (u: UnitCard) => ReactNode }[] = [
    {
      label: "total",
      cell: (u) => (
        <span className={`tabular text-base ${hl(u.cheapest.total_monthly_cents === bestTotal)}`}>
          {brl(u.cheapest.total_monthly_cents)}
        </span>
      ),
    },
    { label: "custo", cell: (u) => <CostBar cheapest={u.cheapest} /> },
    {
      label: "área",
      cell: (u) => (
        <span className={hl(u.area_m2 != null && u.area_m2 === bestArea)}>
          {u.area_m2 != null ? `${u.area_m2} m²` : "—"}
        </span>
      ),
    },
    { label: "quartos", cell: (u) => u.bedrooms ?? "—" },
    { label: "banheiros", cell: (u) => u.bathrooms ?? "—" },
    { label: "vagas", cell: (u) => u.parking_spots ?? 0 },
    {
      label: "R$/m²",
      cell: (u) => {
        const v = perM2(u);
        return v != null ? (
          <span className={`tabular ${hl(v === bestPerM2)}`}>{brl(v)}</span>
        ) : (
          "—"
        );
      },
    },
    {
      label: "dias no ar",
      cell: (u) => <span className={hl(u.days_listed === bestDays)}>{u.days_listed}</span>,
    },
    {
      label: "variação",
      cell: (u) =>
        u.price_change_pct != null ? (
          <span className={hl(u.price_change_pct === bestDrop)}>{u.price_change_pct}%</span>
        ) : (
          "—"
        ),
    },
    {
      label: "anúncios",
      cell: (u) =>
        `${u.listing_count}${u.price_spread_cents > 0 ? ` · Δ ${brl(u.price_spread_cents)}` : ""}`,
    },
    {
      label: "metrô",
      cell: (u) => {
        const m = metro(u);
        return m ? (
          <span className={hl(m.meters === bestMetro)}>
            {fmtDist(m.meters)} <span className="text-muted">{m.name}</span>
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      label: "pets",
      cell: (u) =>
        u.accepts_pets === true ? "sim" : u.accepts_pets === false ? "não" : "não informado",
    },
    {
      label: "status",
      cell: (u) =>
        [
          u.status && STATUS_LABELS[u.status],
          u.status_visit_at &&
            new Date(u.status_visit_at).toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
          u.status_amount_cents != null && brl(u.status_amount_cents),
        ]
          .filter(Boolean)
          .join(" · ") || "—",
    },
    {
      label: "quem curtiu",
      cell: (u) => {
        const names = [...new Set(u.liked_by.map(who))];
        return names.length === 2 ? "vocês dois" : (names[0] ?? "—");
      },
    },
    { label: "notas", cell: (u) => <NoteField key={u.id} unitId={u.id} note={u.note} /> },
  ];

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-paper">
      <header className="border-rule flex items-center justify-between border-b px-4 py-3">
        <h1 className="text-sm font-semibold">
          Comparar <span className="tabular">{units.length}</span> imóveis
        </h1>
        <button onClick={onClose} className="rounded border border-ink px-3 py-1 text-xs font-medium">
          fechar
        </button>
      </header>
      <div className="flex-1 overflow-auto">
        {q.isLoading && <p className="p-4 text-sm text-muted">Carregando…</p>}
        {q.isError && <p className="p-4 text-sm text-flag">API fora do ar.</p>}
        {q.isSuccess && units.length === 0 && (
          <p className="p-4 text-sm text-muted">
            Nenhum imóvel para comparar ainda. Deslize para a direita (❤️) nos que gostar.
          </p>
        )}
        {units.length > 0 && (
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-rule sticky left-0 top-0 z-10 border-b bg-paper" />
                {units.map((u) => (
                  <th
                    key={u.id}
                    className="border-rule sticky top-0 min-w-[46vw] max-w-[46vw] border-b bg-paper p-2 pb-3 text-left align-top font-normal md:min-w-[220px] md:max-w-[220px]"
                  >
                    {u.thumbnail && (
                      <img
                        src={u.thumbnail}
                        alt=""
                        loading="lazy"
                        onClick={() => onOpen(u.id)}
                        className="mb-1.5 h-20 w-full cursor-pointer rounded object-cover"
                      />
                    )}
                    <button onClick={() => onOpen(u.id)} className="text-left text-xs text-muted">
                      <span className="font-semibold text-ink">{u.neighborhood}</span>
                      {u.street && <span className="block truncate">{u.street}</span>}
                      {u.delisted_at && (
                        <span className="block font-medium text-flag">saiu do ar</span>
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-rule border-b">
                  <td className="sticky left-0 bg-paper py-2 pl-4 pr-2 align-top text-xs text-muted">
                    {r.label}
                  </td>
                  {units.map((u) => (
                    <td key={u.id} className="p-2 align-top">
                      {r.cell(u)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
