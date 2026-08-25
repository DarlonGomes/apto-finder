// Bottom sheet, thumb-reachable. Live result count on the apply button (PRD 9.3).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Source } from "@apto/shared";
import { fetchNeighborhoods, fetchUnits, type Filters } from "./api";

const TOTAL_STEPS = [2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 8000];

const SOURCES: [Source, string][] = [
  ["vivareal", "VivaReal"],
  ["olx", "OLX"],
  ["zap", "ZAP"],
  ["quintoandar", "QuintoAndar"],
];

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-rule rounded border bg-paper px-2 py-1.5"
      >
        {children}
      </select>
    </label>
  );
}

export function FilterSheet({
  filters,
  onApply,
  onClose,
}: {
  filters: Filters;
  onApply: (f: Filters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(filters);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft({ ...draft, [k]: v });

  const hoods = useQuery({ queryKey: ["neighborhoods"], queryFn: fetchNeighborhoods });
  const preview = useQuery({
    queryKey: ["preview", draft],
    queryFn: () => fetchUnits(draft, null, 1),
  });

  return (
    // Bottom sheet on mobile, centered modal on desktop
    <div
      className="fixed inset-0 z-20 flex flex-col justify-end md:items-center md:justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/30" />
      <div
        className="border-rule relative max-h-[85vh] w-full overflow-y-auto rounded-t-xl border-t bg-paper p-4 pb-6 md:max-w-md md:rounded-xl md:border md:p-6 md:shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Total cost first, the largest control on screen */}
        <p className="text-sm font-semibold">Custo total mensal</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Select
            label="de"
            value={String(draft.total_min ?? "")}
            onChange={(v) => set("total_min", v ? Number(v) : null)}
          >
            <option value="">qualquer</option>
            {TOTAL_STEPS.map((r) => (
              <option key={r} value={r * 100}>
                R$ {r.toLocaleString("pt-BR")}
              </option>
            ))}
          </Select>
          <Select
            label="até"
            value={String(draft.total_max ?? "")}
            onChange={(v) => set("total_max", v ? Number(v) : null)}
          >
            <option value="">qualquer</option>
            {TOTAL_STEPS.map((r) => (
              <option key={r} value={r * 100}>
                R$ {r.toLocaleString("pt-BR")}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Select label="Quartos" value={String(draft.bedrooms_min)} onChange={(v) => set("bedrooms_min", Number(v))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </Select>
          <Select label="Vagas" value={String(draft.parking_min)} onChange={(v) => set("parking_min", Number(v))}>
            {[0, 1, 2].map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </Select>
          <Select
            label="Área mín."
            value={String(draft.area_min ?? "")}
            onChange={(v) => set("area_min", v ? Number(v) : null)}
          >
            <option value="">qualquer</option>
            {[50, 60, 70, 80, 90, 100, 120].map((n) => (
              <option key={n} value={n}>{n} m²+</option>
            ))}
          </Select>
          <Select label="Pets" value={draft.pets} onChange={(v) => set("pets", v as Filters["pets"])}>
            <option value="unknown_ok">aceita ou não informado</option>
            <option value="required">confirmado</option>
            <option value="any">tanto faz</option>
          </Select>
          <Select
            label="Preço"
            value={draft.cost_confidence}
            onChange={(v) => set("cost_confidence", v as Filters["cost_confidence"])}
          >
            <option value="any">qualquer</option>
            <option value="complete">só completo</option>
          </Select>
        </div>

        <p className="mt-4 text-sm font-semibold">Fonte</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SOURCES.map(([value, label]) => {
            const on = draft.sources.includes(value);
            return (
              <button
                key={value}
                onClick={() =>
                  set(
                    "sources",
                    on ? draft.sources.filter((s) => s !== value) : [...draft.sources, value],
                  )
                }
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  on ? "border-ink bg-ink text-paper" : "border-rule bg-paper text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-sm font-semibold">Bairros</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(hoods.data ?? []).map(({ neighborhood, units }) => {
            const on = draft.neighborhoods.includes(neighborhood);
            return (
              <button
                key={neighborhood}
                onClick={() =>
                  set(
                    "neighborhoods",
                    on
                      ? draft.neighborhoods.filter((n) => n !== neighborhood)
                      : [...draft.neighborhoods, neighborhood],
                  )
                }
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  on ? "border-ink bg-ink text-paper" : "border-rule bg-paper text-ink"
                }`}
              >
                {neighborhood} <span className="tabular opacity-60">{units}</span>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onApply(draft)}
          className="mt-5 w-full rounded-lg bg-ink py-3 text-sm font-semibold text-paper"
        >
          {preview.data ? `Ver ${preview.data.total_matching} imóveis` : "Aplicar"}
        </button>
      </div>
    </div>
  );
}
