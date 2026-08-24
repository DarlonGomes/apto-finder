import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { UnitCard, UnitStatus } from "@apto/shared";
import {
  DEFAULT_FILTERS,
  fetchMeta,
  fetchUnits,
  filtersFromParams,
  filtersToParams,
  putStatus,
  type Filters,
} from "./api";
import { Card } from "./Card";
import { FilterSheet } from "./FilterSheet";

const SORT_LABELS: Record<Filters["sort"], string> = {
  total_asc: "menor custo total",
  newest: "mais recentes",
  price_per_m2: "preço por m²",
  biggest_drop: "maior queda",
};

function initialFilters(): Filters {
  const url = new URLSearchParams(location.search);
  if ([...url.keys()].length > 0) return filtersFromParams(url);
  try {
    const saved = localStorage.getItem("filters");
    if (saved) return { ...DEFAULT_FILTERS, ...JSON.parse(saved) };
  } catch {
    /* private mode etc. */
  }
  return DEFAULT_FILTERS;
}

export default function App() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ unit: UnitCard; status: UnitStatus } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const qc = useQueryClient();

  // URL is the state (PRD 9.4)
  useEffect(() => {
    const p = filtersToParams(filters).toString();
    history.replaceState(null, "", p ? `?${p}` : location.pathname);
    try {
      localStorage.setItem("filters", JSON.stringify(filters));
    } catch {
      /* best effort */
    }
  }, [filters]);

  const units = useInfiniteQuery({
    queryKey: ["units", filters],
    queryFn: ({ pageParam }) => fetchUnits(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    placeholderData: keepPreviousData,
  });
  const meta = useQuery({ queryKey: ["meta"], queryFn: fetchMeta, staleTime: 60_000 });

  const triage = useMutation({
    mutationFn: ({ unit, status }: { unit: UnitCard; status: UnitStatus | null }) =>
      putStatus(unit.id, status),
    // Optimistic: the card leaves the list instantly (PRD: swiping must feel instant)
    onMutate: async ({ unit, status }) => {
      await qc.cancelQueries({ queryKey: ["units"] });
      qc.setQueryData(["units", filters], (data: any) =>
        data && status
          ? {
              ...data,
              pages: data.pages.map((p: any) => ({
                ...p,
                units: p.units.filter((u: UnitCard) => u.id !== unit.id),
              })),
            }
          : data,
      );
      if (status === "dismissed" || status === "shortlisted") {
        clearTimeout(toastTimer.current);
        setToast({ unit, status });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["units"] }),
  });

  const all = units.data?.pages.flatMap((p) => p.units) ?? [];
  const total = units.data?.pages[0]?.total_matching ?? 0;

  const chips = [
    filters.neighborhoods.length > 0 && filters.neighborhoods.join(", "),
    (filters.total_min != null || filters.total_max != null) &&
      `R$${((filters.total_min ?? 0) / 100 / 1000).toFixed(1)}k–${
        filters.total_max != null ? (filters.total_max / 100 / 1000).toFixed(1) + "k" : "∞"
      }`,
    filters.pets === "required" && "pet confirmado",
    filters.cost_confidence === "complete" && "preço completo",
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-lg md:max-w-5xl">
      <header className="border-rule sticky top-0 z-10 border-b bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            <span className="tabular">{total}</span> imóveis
          </span>
          <div className="flex items-center gap-2">
            <select
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value as Filters["sort"] })}
              className="border-rule rounded border bg-paper px-2 py-1 text-xs"
            >
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button
              onClick={() => setSheetOpen(true)}
              className="rounded border border-ink px-3 py-1 text-xs font-medium"
            >
              Filtros
            </button>
          </div>
        </div>
        {chips.length > 0 && <p className="mt-1 truncate text-xs text-muted">{chips.join(" · ")}</p>}
      </header>

      {meta.data?.last_sweep_at && (
        <p className="border-rule border-b px-4 py-1.5 text-xs text-muted">
          dados de {new Date(meta.data.last_sweep_at).toLocaleString("pt-BR")}
        </p>
      )}

      <main>
        {units.isLoading && <p className="p-4 text-sm text-muted">Carregando…</p>}
        {units.isError && <p className="p-4 text-sm text-flag">API fora do ar.</p>}
        {units.isSuccess && all.length === 0 && (
          <p className="p-4 text-sm text-muted">
            Nenhum imóvel com esses filtros. Afrouxe o custo total ou os bairros.
          </p>
        )}
        <div className="md:grid md:grid-cols-2 md:gap-4 md:p-4">
          {all.map((u) => (
            <Card
              key={u.id}
              unit={u}
              onTriage={(unit, status) => triage.mutate({ unit, status })}
            />
          ))}
        </div>
        {units.hasNextPage && (
          <button
            onClick={() => units.fetchNextPage()}
            disabled={units.isFetchingNextPage}
            className="w-full py-4 text-sm font-medium text-muted"
          >
            {units.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        )}
      </main>

      {sheetOpen && (
        <FilterSheet
          filters={filters}
          onApply={(f) => {
            setFilters(f);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-2.5 text-sm text-paper shadow-lg">
          <span>{toast.status === "dismissed" ? "Descartado" : "Shortlist"}</span>
          <button
            className="font-semibold underline"
            onClick={() => {
              triage.mutate({ unit: toast.unit, status: null });
              clearTimeout(toastTimer.current);
              setToast(null);
            }}
          >
            Desfazer
          </button>
        </div>
      )}
    </div>
  );
}
