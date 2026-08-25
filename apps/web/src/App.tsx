import { useEffect, useRef, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { StatusExtra, UnitCard, UnitStatus } from "@apto/shared";
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
import { Detail } from "./Detail";
import { EmptyState } from "./EmptyState";
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
  // Detail overlay rides a `unit` URL param so back closes it and links share it.
  const [detailId, setDetailId] = useState<string | null>(
    () => new URLSearchParams(location.search).get("unit"),
  );
  useEffect(() => {
    const onPop = () => setDetailId(new URLSearchParams(location.search).get("unit"));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const openDetail = (id: string) => {
    const url = new URL(location.href);
    url.searchParams.set("unit", id);
    history.pushState(null, "", url);
    setDetailId(id);
  };
  const [toast, setToast] = useState<{ unit: UnitCard; status: UnitStatus } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const qc = useQueryClient();

  // URL is the state (PRD 9.4)
  useEffect(() => {
    const params = filtersToParams(filters);
    const unit = new URLSearchParams(location.search).get("unit");
    if (unit) params.set("unit", unit);
    const p = params.toString();
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
    mutationFn: ({
      unit,
      status,
      extra,
    }: {
      unit: UnitCard;
      status: UnitStatus | null;
      extra?: StatusExtra;
    }) => putStatus(unit.id, status, extra),
    // Optimistic: dismissed leaves the list instantly, other statuses update in place
    onMutate: async ({ unit, status, extra }) => {
      await qc.cancelQueries({ queryKey: ["units"] });
      qc.setQueryData(["units", filters], (data: any) =>
        data
          ? {
              ...data,
              pages: data.pages.map((p: any) => ({
                ...p,
                units:
                  status === "dismissed"
                    ? p.units.filter((u: UnitCard) => u.id !== unit.id)
                    : p.units.map((u: UnitCard) =>
                        u.id === unit.id
                          ? {
                              ...u,
                              status,
                              status_actor: null,
                              status_visit_at: extra?.visit_at ?? null,
                              status_amount_cents: extra?.amount_cents ?? null,
                              status_note: extra?.note ?? null,
                            }
                          : u,
                      ),
              })),
            }
          : data,
      );
      if (status === "dismissed") {
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
    filters.area_min != null && `${filters.area_min}m²+`,
    filters.pets === "required" && "pet confirmado",
    filters.sources.length > 0 && filters.sources.join(", "),
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
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value as Filters["status"] })
              }
              className="border-rule rounded border bg-paper px-2 py-1 text-xs"
            >
              <option value="">todos</option>
              <option value="liked">❤️ gostei</option>
              <option value="visit_booked">📅 visita</option>
              <option value="proposal_made">📝 proposta</option>
              <option value="dismissed">descartados</option>
            </select>
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
          <EmptyState filters={filters} onApply={setFilters} />
        )}
        <div className="md:grid md:grid-cols-2 md:gap-4 md:p-4">
          {all.map((u) => (
            <Card
              key={u.id}
              unit={u}
              onOpen={openDetail}
              onTriage={(unit, status, extra) => triage.mutate({ unit, status, extra })}
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

      {detailId && <Detail id={detailId} onClose={() => history.back()} />}

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
          <span>Descartado</span>
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
