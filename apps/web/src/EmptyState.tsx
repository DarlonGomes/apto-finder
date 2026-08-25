// PRD 9.3: an empty result names which filter is doing the damage, with the
// count you'd get by relaxing it. Each candidate is one probe query
// (limit=1, we only read total_matching), fired only when the list is empty.

import { useQuery } from "@tanstack/react-query";
import { brl, fetchUnits, type Filters } from "./api";

function relaxations(f: Filters): { label: string; next: Filters }[] {
  const out: { label: string; next: Filters }[] = [];
  if (f.total_max != null) {
    // +33%, rounded to R$100, mirroring the PRD's "34 match under R$4,000"
    const raised = Math.round((f.total_max * 1.33) / 10_000) * 10_000;
    out.push({ label: `teto ${brl(raised)}`, next: { ...f, total_max: raised } });
  }
  if (f.neighborhoods.length > 0)
    out.push({ label: "todos os bairros", next: { ...f, neighborhoods: [] } });
  if (f.pets === "required")
    out.push({ label: "pet não confirmado", next: { ...f, pets: "unknown_ok" } });
  if (f.cost_confidence === "complete")
    out.push({ label: "preço incompleto também", next: { ...f, cost_confidence: "any" } });
  if (f.area_min != null) out.push({ label: "sem área mínima", next: { ...f, area_min: null } });
  if (f.sources.length > 0) out.push({ label: "todas as fontes", next: { ...f, sources: [] } });
  if (f.parking_min > 0) out.push({ label: "sem vaga", next: { ...f, parking_min: 0 } });
  return out;
}

export function EmptyState({
  filters,
  onApply,
}: {
  filters: Filters;
  onApply: (f: Filters) => void;
}) {
  const cands = relaxations(filters);
  const probes = useQuery({
    queryKey: ["empty-probes", filters],
    enabled: cands.length > 0,
    queryFn: async () => {
      const rs = await Promise.all(cands.map((c) => fetchUnits(c.next, null, 1)));
      return cands
        .map((c, i) => ({ ...c, count: rs[i]?.total_matching ?? 0 }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
    },
  });

  return (
    <div className="p-4 text-sm">
      <p className="text-muted">Nenhum imóvel com esses filtros.</p>
      {probes.data && probes.data.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {probes.data.map((s) => (
            <li key={s.label}>
              <button
                onClick={() => onApply(s.next)}
                className="border-rule rounded border px-2 py-1 text-xs font-medium"
              >
                {s.label}: <span className="tabular">{s.count}</span>{" "}
                {s.count === 1 ? "imóvel" : "imóveis"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {probes.isSuccess && probes.data.length === 0 && (
        <p className="mt-1 text-xs text-muted">
          Nem afrouxando um filtro por vez. Comece de novo pelos Filtros.
        </p>
      )}
    </div>
  );
}
