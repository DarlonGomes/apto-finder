// Milestone 0: Glue API spike (PRD 11).
// Answers: field shape, pagination cap, pricing completeness.
// Run: pnpm --filter collector spike:glue
// Raw dumps land in ./spike-out/ (gitignored).
//
// ponytail: requests go through curl, not fetch. Node/undici's TLS fingerprint
// gets a Cloudflare 403 on this API; curl with browser headers passes.

import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const BASE = "https://glue-api.vivareal.com/v2/listings";
const OUT = new URL("../spike-out/", import.meta.url).pathname;

const HEADER_ARGS = [
  "-H", "x-domain: www.vivareal.com.br",
  "-H", "accept: application/json",
  "-H", "accept-language: pt-BR,pt;q=0.9",
  "-H", "origin: https://www.vivareal.com.br",
  "-H", "referer: https://www.vivareal.com.br/",
  "-H", "user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildUrl(from: number, size: number, neighborhood?: string): string {
  const p = new URLSearchParams({
    business: "RENTAL",
    listingType: "USED",
    usageTypes: "RESIDENTIAL",
    unitTypes: "APARTMENT",
    addressCity: "Rio de Janeiro",
    addressState: "Rio de Janeiro",
    // includeFields is REQUIRED; omitting it is a 400
    includeFields: "search(result(listings),totalCount)",
    size: String(size),
    from: String(from),
  });
  if (neighborhood) {
    p.set("addressNeighborhood", neighborhood);
    p.set("addressType", "neighborhood");
  }
  return `${BASE}?${p}`;
}

async function fetchPage(from: number, size: number, neighborhood?: string) {
  const url = buildUrl(from, size, neighborhood);
  const { stdout } = await exec(
    "curl",
    ["-s", "-w", "\n%{http_code}", "--http2", ...HEADER_ARGS, url],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const nl = stdout.lastIndexOf("\n");
  const status = Number(stdout.slice(nl + 1));
  const text = stdout.slice(0, nl);
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  return { status, text, json };
}

function rentalPricing(l: any): any | null {
  const infos = l?.listing?.pricingInfos;
  if (!Array.isArray(infos)) return null;
  return infos.find((p: any) => p.businessType === "RENTAL") ?? null;
}

await mkdir(OUT, { recursive: true });

// --- A. Field shape: one tiny page, dumped raw ---------------------------
console.log("A. field shape (Botafogo, size=2)...");
const shape = await fetchPage(0, 2, "Botafogo");
await writeFile(`${OUT}shape.json`, shape.text);
if (shape.status !== 200 || !shape.json) {
  console.error(`  status ${shape.status}, body starts: ${shape.text.slice(0, 200)}`);
  process.exit(1);
}
const first = shape.json?.search?.result?.listings?.[0];
console.log(`  totalCount (Botafogo rental apt): ${shape.json?.search?.totalCount}`);
console.log(`  wrapper keys: ${first ? Object.keys(first).join(", ") : "??"}`);
console.log(`  RENTAL pricingInfo: ${JSON.stringify(rentalPricing(first))}`);
console.log(`  raw dump: spike-out/shape.json`);

// --- B. Pricing completeness over all of Botafogo -------------------------
// Measured limits: size max 30 (>=32 is a 400), from+size max 1500
// ("From is above acceptable limit" past that). Partitions must stay <1500.
console.log("\nB. pricing completeness (Botafogo, pages of 30)...");
let seen = 0, withCondo = 0, withIptu = 0, withTotal = 0, withPhash = 0;
for (const from of Array.from({ length: 10 }, (_, i) => i * 30)) {
  await sleep(1500);
  const page = await fetchPage(from, 30, "Botafogo");
  const listings: any[] = page.json?.search?.result?.listings ?? [];
  if (page.status !== 200) {
    console.log(`  from=${from}: status ${page.status}`);
    continue;
  }
  await writeFile(`${OUT}page-${from}.json`, page.text);
  for (const l of listings) {
    const p = rentalPricing(l);
    if (!p) continue;
    seen++;
    if (Number(p.monthlyCondoFee) > 0) withCondo++;
    if (Number(p.yearlyIptu) > 0 || Number(p.iptu) > 0) withIptu++;
    if (Number(p.rentalInfo?.monthlyRentalTotalPrice) > 0) withTotal++;
    if (l.listing?.phashSourceId) withPhash++;
  }
  console.log(`  from=${from}: ${listings.length} listings`);
}
if (seen > 0) {
  const pct = (n: number) => `${((100 * n) / seen).toFixed(1)}%`;
  console.log(
    `  of ${seen}: condo ${pct(withCondo)}, iptu ${pct(withIptu)},` +
      ` precomputed total ${pct(withTotal)}, phashSourceId ${pct(withPhash)}`,
  );
}

// --- C. Pagination cap (city-wide so the count is big enough) ------------
// Confirms the measured window: last reachable page is from=1470 size=30.
console.log("\nC. pagination cap probe (all Rio)...");
for (const from of [1470, 1500]) {
  await sleep(1500);
  const page = await fetchPage(from, 30);
  const n = page.json?.search?.result?.listings?.length ?? 0;
  const total = page.json?.search?.totalCount;
  const msg =
    page.status === 200
      ? `${n} listings (totalCount ${total})`
      : `status ${page.status}: ${page.text.slice(0, 120).replace(/\s+/g, " ")}`;
  console.log(`  from=${from}: ${msg}`);
}

console.log("\ndone.");
