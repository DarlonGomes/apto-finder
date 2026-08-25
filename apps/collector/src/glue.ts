// Glue API client (VivaReal/ZAP/OLX backend). Requests go through curl (see curl.ts).
// Measured limits: size max 30, from+size max 1500.

import { curlJson, sleep, UA } from "./curl.js";

const BASE = "https://glue-api.vivareal.com/v2/listings";
export const PAGE_SIZE = 30;
export const WINDOW_MAX = 1500;
const RATE_LIMIT_MS = 1500;

const HEADER_ARGS = [
  "-H", "x-domain: www.vivareal.com.br",
  "-H", "accept: application/json",
  "-H", "accept-language: pt-BR,pt;q=0.9",
  "-H", "origin: https://www.vivareal.com.br",
  "-H", "referer: https://www.vivareal.com.br/",
  "-H", `user-agent: ${UA}`,
];

function buildUrl(neighborhood: string, from: number, extraParams: Record<string, string>): string {
  const p = new URLSearchParams({
    ...extraParams,
    business: "RENTAL",
    listingType: "USED",
    usageTypes: "RESIDENTIAL",
    unitTypes: "APARTMENT",
    addressCity: "Rio de Janeiro",
    addressState: "Rio de Janeiro",
    addressNeighborhood: neighborhood,
    addressType: "neighborhood",
    includeFields: "search(result(listings),totalCount)", // required; omitting is a 400
    size: String(PAGE_SIZE),
    from: String(from),
  });
  return `${BASE}?${p}`;
}

export interface PartitionResult {
  wrappers: any[]; // {listing, account, medias}
  totalCount: number;
  coverageGap: boolean; // totalCount exceeds the reachable window
}

/** Fetch every reachable page of one neighborhood partition, politely. */
export async function fetchPartition(
  neighborhood: string,
  extraParams: Record<string, string> = {},
): Promise<PartitionResult> {
  const wrappers: any[] = [];
  let totalCount = 0;
  for (let from = 0; from + PAGE_SIZE <= WINDOW_MAX; from += PAGE_SIZE) {
    if (from > 0) await sleep(RATE_LIMIT_MS);
    const { status, json } = await curlJson(buildUrl(neighborhood, from, extraParams), HEADER_ARGS);
    if (status !== 200) throw new Error(`glue ${neighborhood} from=${from}: HTTP ${status}`);
    totalCount = json?.search?.totalCount ?? totalCount;
    const page: any[] = json?.search?.result?.listings ?? [];
    wrappers.push(...page);
    if (from + PAGE_SIZE >= totalCount || page.length < PAGE_SIZE) break;
  }
  return { wrappers, totalCount, coverageGap: totalCount > WINDOW_MAX };
}
