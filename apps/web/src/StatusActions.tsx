// Pipeline CTAs (gostei / visita / proposta) + the modal that collects
// visit datetime or proposal amount. Shared by Card and Detail.

import { useState } from "react";
import type { StatusExtra, UnitStatus } from "@apto/shared";

const ACTIONS: [Exclude<UnitStatus, "dismissed">, string][] = [
  ["liked", "❤️ Gostei"],
  ["visit_booked", "📅 Visita"],
  ["proposal_made", "📝 Proposta"],
];

function StatusModal({
  kind,
  onSubmit,
  onClose,
}: {
  kind: "visit_booked" | "proposal_made";
  onSubmit: (extra: StatusExtra) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/30" />
      <form
        className="border-rule relative w-full max-w-sm space-y-3 rounded-xl border bg-paper p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (kind === "visit_booked") {
            onSubmit({ visit_at: new Date(f.get("visit_at") as string).toISOString() });
          } else {
            onSubmit({
              amount_cents: Math.round(Number(f.get("amount")) * 100),
              note: (f.get("note") as string) || null,
            });
          }
        }}
      >
        <p className="text-sm font-semibold">
          {kind === "visit_booked" ? "📅 Agendar visita" : "📝 Registrar proposta"}
        </p>
        {kind === "visit_booked" ? (
          <label className="block text-sm">
            <span className="text-muted">quando</span>
            <input
              name="visit_at"
              type="datetime-local"
              required
              autoFocus
              className="border-rule mt-1 w-full rounded border bg-paper px-2 py-1.5 text-sm"
            />
          </label>
        ) : (
          <>
            <label className="block text-sm">
              <span className="text-muted">valor (R$)</span>
              <input
                name="amount"
                type="number"
                inputMode="decimal"
                min="1"
                step="0.01"
                required
                autoFocus
                placeholder="3000"
                className="border-rule mt-1 w-full rounded border bg-paper px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">observação (opcional)</span>
              <input
                name="note"
                type="text"
                className="border-rule mt-1 w-full rounded border bg-paper px-2 py-1.5 text-sm"
              />
            </label>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="border-rule rounded border px-3 py-1.5 text-sm text-muted"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded bg-good px-3 py-1.5 text-sm font-medium text-white"
          >
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}

export function StatusActions({
  status,
  onTriage,
}: {
  status: UnitStatus | null;
  onTriage: (status: UnitStatus | null, extra?: StatusExtra) => void;
}) {
  const [modal, setModal] = useState<"visit_booked" | "proposal_made" | null>(null);
  // Pipeline: stages already passed stay marked (outline), current one is filled.
  const rank = status && status !== "dismissed" ? ACTIONS.findIndex(([s]) => s === status) : -1;
  return (
    <>
      {ACTIONS.map(([s, label], i) => (
        <button
          key={s}
          disabled={i < rank}
          onClick={() => {
            if (status === s) onTriage(null);
            else if (s === "liked") onTriage("liked");
            else setModal(s);
          }}
          className={`whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium ${
            i === rank
              ? "border-good bg-good text-white"
              : i < rank
                ? "border-good text-good"
                : "border-rule text-muted"
          }`}
        >
          {label}
        </button>
      ))}
      {modal && (
        <StatusModal
          kind={modal}
          onClose={() => setModal(null)}
          onSubmit={(extra) => {
            onTriage(modal, extra);
            setModal(null);
          }}
        />
      )}
    </>
  );
}
