// Hourly sweep (PRD 7): collect -> normalize -> upsert + price diff.
// Runs OFF Cloudflare (home machine, PRD 5.1). Schedule with cron:
//   0 * * * * cd ~/Projects/apto-finder && pnpm --filter collector sweep

import { fetchPartition, WINDOW_MAX } from "./glue.js";
import { normalizeGlue } from "./normalize.js";
import { connect, saveListing } from "./db.js";

// Search criteria. Glue's bedrooms/bathrooms/parkingSpaces are exact-match
// lists, so "2 or more" is spelled "2,3,...". Names need accents (Grajau -> 0
// results). "Largo do Machado" is not in Glue's taxonomy; Catete covers it.
const NEIGHBORHOODS = (process.env.NEIGHBORHOODS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (NEIGHBORHOODS.length === 0) {
  NEIGHBORHOODS.push(
    "Tijuca", "Grajaú", "Vila Isabel", "Andaraí", "Barra da Tijuca",
    "Botafogo", "Gávea", "Catete", "Flamengo", "Humaitá", "Lagoa",
  );
}

const listUp = (min: number) => Array.from({ length: 9 - min }, (_, i) => min + i).join(",");
const FILTER_PARAMS = {
  bedrooms: listUp(2),
  bathrooms: listUp(2),
  parkingSpaces: listUp(1),
};
const TOTAL_MIN_CENTS = 300_000;
const TOTAL_MAX_CENTS = 600_000;
// ponytail: padded cap for Barra, just for validation; remove when done
const TOTAL_MAX_OVERRIDES: Record<string, number> = { "Barra da Tijuca": 700_000 };

const client = await connect();
const started = Date.now();
let saved = 0;
let skipped = 0;
let outOfBand = 0;
let noPets = 0;

try {
  for (const hood of NEIGHBORHOODS) {
    const maxCents = TOTAL_MAX_OVERRIDES[hood] ?? TOTAL_MAX_CENTS;
    const { wrappers, totalCount, coverageGap } = await fetchPartition(hood, {
      ...FILTER_PARAMS,
      // rent-only filter; rent <= total, so this is a safe superset of the total cap
      priceMax: String(maxCents / 100),
    });
    if (coverageGap) {
      console.warn(`COVERAGE GAP: ${hood} has ${totalCount} listings, window is ${WINDOW_MAX}`);
    }
    for (const w of wrappers) {
      const l = normalizeGlue(w);
      if (!l) {
        skipped++;
        continue;
      }
      const total =
        l.rentCents + (l.condoCents ?? 0) + (l.iptuMonthlyCents ?? 0) +
        (l.insuranceCents ?? 0) + (l.serviceFeeCents ?? 0);
      // Over max: unknown components only push it higher, safe to drop.
      // Under min: only drop when pricing is complete; a partial listing's
      // unknown condo could still put it in range.
      if (total > maxCents || (l.costConfidence === "complete" && total < TOTAL_MIN_CENTS)) {
        outOfBand++;
        continue;
      }
      // Pet friendly required: drop only an explicit "no". Unknown is kept —
      // most listings state nothing, and unknown is not "no" (PRD 6).
      if (l.acceptsPets === false) {
        noPets++;
        continue;
      }
      await saveListing(client, l);
      saved++;
    }
    console.log(`${hood}: ${wrappers.length} fetched (totalCount ${totalCount})`);
  }
} finally {
  await client.end();
}

console.log(
  `sweep done: ${saved} saved, ${outOfBand} out of price band, ${noPets} no-pets, ${skipped} unpriceable, ` +
    `${Math.round((Date.now() - started) / 1000)}s`,
);
