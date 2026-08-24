import { useQuery } from "@tanstack/react-query";

interface Meta {
  active_listings: number;
  last_sweep_at: string | null;
}

export default function App() {
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: async (): Promise<Meta> => {
      const res = await fetch("/api/meta");
      if (!res.ok) throw new Error(`meta: ${res.status}`);
      return res.json();
    },
  });

  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="text-lg font-semibold">Apto Finder</h1>
      <p className="text-muted mt-2 text-sm">
        {meta.isLoading && "Carregando..."}
        {meta.isError && "API fora do ar."}
        {meta.data && (
          <span className="tabular">
            {meta.data.active_listings} anúncios ativos
            {meta.data.last_sweep_at &&
              ` · última varredura ${new Date(meta.data.last_sweep_at).toLocaleString("pt-BR")}`}
          </span>
        )}
      </p>
    </main>
  );
}
