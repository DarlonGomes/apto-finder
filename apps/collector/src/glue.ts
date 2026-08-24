// Glue API client (VivaReal/ZAP/OLX backend). Requests go through curl:
// Node/undici's TLS fingerprint gets a Cloudflare 403; curl passes (spike finding).
// Measured limits: size max 30, from+size max 1500.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
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
  "-H", "user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function curlJson(url: string): Promise<{ status: number; json: any }> {
  const { stdout } = await exec(
    "curl",
    ["-s", "-w", "\n%{http_code}", "--http2", ...HEADER_ARGS, url],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const nl = stdout.lastIndexOf("\n");
  let json: any = null;
  try {
    json = JSON.parse(stdout.slice(0, nl));
  } catch {
    /* error bodies can be HTML */
  }
  return { status: Number(stdout.slice(nl + 1)), json };
}

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
    const { status, json } = await curlJson(buildUrl(neighborhood, from, extraParams));
    if (status !== 200) throw new Error(`glue ${neighborhood} from=${from}: HTTP ${status}`);
    totalCount = json?.search?.totalCount ?? totalCount;
    const page: any[] = json?.search?.result?.listings ?? [];
    wrappers.push(...page);
    if (from + PAGE_SIZE >= totalCount || page.length < PAGE_SIZE) break;
  }
  return { wrappers, totalCount, coverageGap: totalCount > WINDOW_MAX };
}
