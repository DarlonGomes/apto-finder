import type { Source, StatusExtra, UnitsResponse, UnitStatus } from "@apto/shared";

export interface Filters {
  total_min: number | null; // cents
  total_max: number | null;
  bedrooms_min: number;
  parking_min: number;
  area_min: number | null; // m²
  pets: "required" | "unknown_ok" | "any";
  neighborhoods: string[];
  cost_confidence: "any" | "complete";
  sort: "total_asc" | "newest" | "price_per_m2" | "biggest_drop";
  status: "" | UnitStatus; // "" = all (server hides dismissed by default)
  sources: Source[];
}

export const DEFAULT_FILTERS: Filters = {
  total_min: null,
  total_max: null,
  bedrooms_min: 2,
  parking_min: 1,
  area_min: null,
  pets: "unknown_ok",
  neighborhoods: [],
  cost_confidence: "any",
  sort: "total_asc",
  status: "",
  sources: [],
};

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.total_min != null) p.set("total_min", String(f.total_min));
  if (f.total_max != null) p.set("total_max", String(f.total_max));
  if (f.bedrooms_min !== 1) p.set("bedrooms_min", String(f.bedrooms_min));
  if (f.parking_min > 0) p.set("parking_min", String(f.parking_min));
  if (f.area_min != null) p.set("area_min", String(f.area_min));
  if (f.pets !== "unknown_ok") p.set("pets", f.pets);
  if (f.neighborhoods.length) p.set("neighborhoods", f.neighborhoods.join(","));
  if (f.cost_confidence !== "any") p.set("cost_confidence", f.cost_confidence);
  if (f.sort !== "total_asc") p.set("sort", f.sort);
  if (f.status) p.set("status", f.status);
  if (f.sources.length) p.set("sources", f.sources.join(","));
  return p;
}

export function filtersFromParams(p: URLSearchParams): Filters {
  return {
    total_min: p.get("total_min") ? Number(p.get("total_min")) : null,
    total_max: p.get("total_max") ? Number(p.get("total_max")) : null,
    bedrooms_min: Number(p.get("bedrooms_min") ?? 2),
    parking_min: Number(p.get("parking_min") ?? 1),
    area_min: p.get("area_min") ? Number(p.get("area_min")) : null,
    pets: (p.get("pets") as Filters["pets"]) ?? "unknown_ok",
    neighborhoods: p.get("neighborhoods")?.split(",").filter(Boolean) ?? [],
    cost_confidence: (p.get("cost_confidence") as Filters["cost_confidence"]) ?? "any",
    sort: (p.get("sort") as Filters["sort"]) ?? "total_asc",
    status: (p.get("status") as Filters["status"]) ?? "",
    sources: (p.get("sources")?.split(",").filter(Boolean) ?? []) as Source[],
  };
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function fetchUnits(f: Filters, cursor?: string | null, limit = 30): Promise<UnitsResponse> {
  const p = filtersToParams(f);
  p.set("limit", String(limit));
  if (cursor) p.set("cursor", cursor);
  return fetch(`/api/units?${p}`).then((r) => json<UnitsResponse>(r));
}

// Compare view: every liked+ unit, no other filters, cheapest first.
export function fetchCompareUnits(): Promise<UnitsResponse> {
  return fetch(
    "/api/units?status=liked,visit_booked,proposal_made&pets=any&sort=total_asc&limit=100",
  ).then((r) => json<UnitsResponse>(r));
}

export function putNote(unitId: string, note: string): Promise<unknown> {
  return fetch(`/api/units/${unitId}/note`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note }),
  }).then(json);
}

export function putStatus(
  unitId: string,
  status: UnitStatus | null,
  extra?: StatusExtra,
): Promise<unknown> {
  return fetch(`/api/units/${unitId}/status`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, ...extra }),
  }).then(json);
}

export interface DetailListing {
  id: string;
  source: Source;
  source_listing_id: string;
  url: string;
  rent_cents: number;
  condo_cents: number | null;
  iptu_monthly_cents: number | null;
  insurance_cents: number | null;
  service_fee_cents: number | null;
  total_monthly_cents: number;
  cost_confidence: "complete" | "partial";
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parking_spots: number | null;
  area_m2: number | null;
  floor: number | null;
  accepts_pets: boolean | null;
  furnished: string | null;
  advertiser: string | null;
  first_seen_at: string;
  last_seen_at: string;
  delisted_at: string | null;
  photos: string[];
}

export interface UnitDetail {
  id: string;
  neighborhood: string;
  street: string | null;
  bedrooms: number | null;
  area_m2: number | null;
  parking_spots: number | null;
  status: UnitStatus | null;
  listings: DetailListing[];
  price_history: { listing_id: string; observed_at: string; total_monthly_cents: number }[];
}

export function fetchUnitDetail(id: string): Promise<UnitDetail> {
  return fetch(`/api/units/${id}`).then((r) => json<UnitDetail>(r));
}

export function fetchNeighborhoods(): Promise<{ neighborhood: string; units: number }[]> {
  return fetch("/api/neighborhoods").then((r) => json(r));
}

export function fetchMeta(): Promise<{ active_listings: number; units: number; last_sweep_at: string | null }> {
  return fetch("/api/meta").then((r) => json(r));
}

export const brl = (cents: number): string =>
  (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
