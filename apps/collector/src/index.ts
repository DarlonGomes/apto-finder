// Hourly sweep (PRD 7): collect -> normalize -> upsert + price diff.
// Runs OFF Cloudflare (home machine, PRD 5.1). Schedule with cron:
//   0 * * * * cd ~/Projects/apto-finder && pnpm --filter collector sweep

import type { NormalizedListing } from "@apto/shared";
import { fetchPartition, WINDOW_MAX } from "./glue.js";
import { fetchQuintoAndar } from "./quintoandar.js";
import { normalizeGlue, normalizeQuintoAndar } from "./normalize.js";
import { connect, saveListing } from "./db.js";
import { dedupe } from "./dedupe.js";
import { loadConfig } from "./config.js";

// Search criteria come from apto.config.json (see config.ts). Glue's
// bedrooms/bathrooms/parkingSpaces are exact-match lists, so "2 or more" is
// spelled "2,3,...". Glue neighborhood names need accents (Grajau -> 0 results).
const cfg = loadConfig();
const NEIGHBORHOODS = cfg.neighborhoods;
const PLACE = { city: cfg.city, state: cfg.state };

const listUp = (min: number) => Array.from({ length: 9 - min }, (_, i) => min + i).join(",");
const FILTER_PARAMS = {
  bedrooms: listUp(cfg.minBedrooms),
  bathrooms: listUp(cfg.minBathrooms),
  parkingSpaces: listUp(cfg.minParking),
};
const TOTAL_MIN_CENTS = cfg.totalMinCents;
const TOTAL_MAX_CENTS = cfg.totalMaxCents;
const TOTAL_MAX_OVERRIDES = cfg.totalMaxOverrides;

// QuintoAndar neighbourhood is free text with spelling drift ("Grajau", trailing
// spaces). Match accent-folded and store OUR canonical spelling, so the SPA
// filter and the delist query keep working on exact names. extraNeighborhoods
// are QA-only names (Glue's taxonomy lacks them).
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
const QA_CANON = new Map(
  [...NEIGHBORHOODS, ...cfg.quintoandar.extraNeighborhoods].map((n) => [fold(n), n]),
);

const client = await connect();
const started = Date.now();
let saved = 0;
let skipped = 0;
let outOfBand = 0;
let noPets = 0;
let delisted = 0;

// Shared triage (band + pets), both sources. Over max: unknown components only
// push it higher, safe to drop. Under min: only drop when pricing is complete;
// a partial listing's unknown condo could still put it in range. Pets: drop
// only an explicit "no" — unknown is not "no" (PRD 6).
async function triageAndSave(l: NormalizedListing | null): Promise<void> {
  if (!l) {
    skipped++;
    return;
  }
  const maxCents = TOTAL_MAX_OVERRIDES[l.neighborhood ?? ""] ?? TOTAL_MAX_CENTS;
  const total =
    l.rentCents + (l.condoCents ?? 0) + (l.iptuMonthlyCents ?? 0) +
    (l.insuranceCents ?? 0) + (l.serviceFeeCents ?? 0);
  if (total > maxCents || (l.costConfidence === "complete" && total < TOTAL_MIN_CENTS)) {
    outOfBand++;
    return;
  }
  if (cfg.rejectNoPets && l.acceptsPets === false) {
    noPets++;
    return;
  }
  await saveListing(client, l);
  saved++;
}

try {
  for (const hood of NEIGHBORHOODS) {
    const maxCents = TOTAL_MAX_OVERRIDES[hood] ?? TOTAL_MAX_CENTS;
    const { wrappers, totalCount, coverageGap } = await fetchPartition(PLACE, hood, {
      ...FILTER_PARAMS,
      // rent-only filter; rent <= total, so this is a safe superset of the total cap
      priceMax: String(maxCents / 100),
    });
    if (coverageGap) {
      console.warn(`COVERAGE GAP: ${hood} has ${totalCount} listings, window is ${WINDOW_MAX}`);
    }
    for (const w of wrappers) await triageAndSave(normalizeGlue(w));
    console.log(`${hood}: ${wrappers.length} fetched (totalCount ${totalCount})`);
  }

  // QuintoAndar: one city-wide partition (its API is map-bounds only), cheapest
  // first, fetch stops past the largest neighborhood cap; per-listing caps and
  // the neighborhood scope apply here.
  const qaHits = await fetchQuintoAndar({
    minBedrooms: cfg.minBedrooms,
    minBathrooms: cfg.minBathrooms,
    minParking: cfg.minParking,
    maxTotalCents: Math.max(TOTAL_MAX_CENTS, ...Object.values(TOTAL_MAX_OVERRIDES)),
    bounds: cfg.quintoandar.bounds,
  });
  let qaInScope = 0;
  for (const h of qaHits) {
    const canon = QA_CANON.get(fold(h?.neighbourhood ?? ""));
    if (!canon) continue;
    qaInScope++;
    const l = normalizeQuintoAndar(h);
    if (l) l.neighborhood = canon;
    await triageAndSave(l);
  }
  console.log(`quintoandar: ${qaInScope} in scope of ${qaHits.length} fetched`);

  // PRD 7.4: absent from ~2 consecutive hourly sweeps -> delisted. Runs only
  // after a fully successful sweep and only for the neighborhoods it covered,
  // so a dead collector or partial run can never mass-delist. Reappearance
  // clears delisted_at in the upsert.
  // ponytail: timestamp heuristic instead of sweep ids; 2h15m ~= missed twice
  if (saved > 0) {
    const { rowCount } = await client.query(
      `UPDATE listings SET delisted_at = now()
       WHERE delisted_at IS NULL
         AND neighborhood = ANY($1)
         AND last_seen_at < now() - interval '2 hours 15 minutes'`,
      [[...QA_CANON.values()]],
    );
    delisted = rowCount ?? 0;
  }

  // PRD 7.3: cluster duplicate listings into one unit, after every collection.
  await dedupe(client);
} finally {
  await client.end();
}

console.log(
  `sweep done: ${saved} saved, ${delisted} delisted, ${outOfBand} out of price band, ${noPets} no-pets, ` +
    `${skipped} unpriceable, ${Math.round((Date.now() - started) / 1000)}s`,
);
