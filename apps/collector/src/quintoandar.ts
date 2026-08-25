// QuintoAndar yellow-pages search API. Spike findings (2026-08-25):
// - GET www.quintoandar.com.br/api/yellow-pages/v2/search; `return` field list is
//   REQUIRED (400 without). Unknown requested fields are silently dropped.
// - Geo is map bounds only (no neighborhood param): one Rio-wide box, callers
//   post-filter on `neighbourhood`.
// - min_bedrooms/min_bathrooms/parking_spaces mean "N or more"; house_type exact.
// - sorting[criteria]=total_cost&order=asc, so paging stops once totalCost
//   passes the cap. No server-side price filter exists (cost_range 500s).
// - Money is whole reais. `iptu` and `homeInsurance` are itemized;
//   condo = iptuPlusCondominium - iptu; taxa de serviço is the remainder.
// - Listing URL: /imovel/{id} (301s to the slugged URL). Images: /img/xlg/{file}.

import { curlJson, sleep, UA } from "./curl.js";

const BASE = "https://www.quintoandar.com.br/api/yellow-pages/v2/search";
const PAGE_SIZE = 100;
const RATE_LIMIT_MS = 1500;

const HEADERS = [
  "-H", `user-agent: ${UA}`,
  "-H", "accept: application/json",
  "-H", "accept-language: pt-BR,pt;q=0.9",
];

// Generous box over the whole municipality; the neighborhood post-filter
// discards Niterói/Baixada spillover.
const RIO_BOUNDS = { north: "-22.74", south: "-23.10", east: "-43.09", west: "-43.80" };

const RETURN_FIELDS = [
  "id", "rent", "totalCost", "iptuPlusCondominium", "iptu", "homeInsurance",
  "area", "address", "neighbourhood", "city", "bedrooms", "bathrooms",
  "parkingSpaces", "isFurnished", "amenities", "imageList", "type", "location",
].join(",");

export interface QaFilters {
  minBedrooms: number;
  minBathrooms: number;
  minParking: number;
  maxTotalCents: number; // stop paging past this (cheapest-first sort)
}

/** All Rio hits up to the total-cost cap, cheapest first. */
export async function fetchQuintoAndar(f: QaFilters): Promise<any[]> {
  const hits: any[] = [];
  const maxReais = f.maxTotalCents / 100;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (offset > 0) await sleep(RATE_LIMIT_MS);
    const p = new URLSearchParams({
      availability: "any",
      occupancy: "any",
      business_context: "RENT",
      "map[bounds_north]": RIO_BOUNDS.north,
      "map[bounds_south]": RIO_BOUNDS.south,
      "map[bounds_east]": RIO_BOUNDS.east,
      "map[bounds_west]": RIO_BOUNDS.west,
      house_type: "Apartamento",
      min_bedrooms: String(f.minBedrooms),
      min_bathrooms: String(f.minBathrooms),
      parking_spaces: String(f.minParking),
      "sorting[criteria]": "total_cost",
      "sorting[order]": "asc",
      page_size: String(PAGE_SIZE),
      offset: String(offset),
      return: RETURN_FIELDS,
    });
    const { status, json } = await curlJson(`${BASE}?${p}`, HEADERS);
    if (status !== 200) throw new Error(`quintoandar offset=${offset}: HTTP ${status}`);
    const page: any[] = (json?.hits?.hits ?? []).map((h: any) => h._source);
    const inBand = page.filter((s) => typeof s?.totalCost !== "number" || s.totalCost <= maxReais);
    hits.push(...inBand);
    if (page.length < PAGE_SIZE || inBand.length < page.length) break;
  }
  return hits;
}
