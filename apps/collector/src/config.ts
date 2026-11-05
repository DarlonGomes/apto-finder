// Sweep criteria live in apto.config.json at the repo root (gitignored, yours);
// apto.config.example.json is the committed fallback, so a fresh clone sweeps
// Rio with the original criteria without editing anything.

import { existsSync, readFileSync } from "node:fs";

export interface SweepConfig {
  city: string;
  state: string;
  neighborhoods: string[];
  quintoandar: {
    bounds: { north: number; south: number; east: number; west: number };
    extraNeighborhoods: string[];
  };
  totalMinCents: number;
  totalMaxCents: number;
  totalMaxOverrides: Record<string, number>;
  minBedrooms: number;
  minBathrooms: number;
  minParking: number;
  rejectNoPets: boolean;
}

const ROOT = new URL("../../../", import.meta.url).pathname;

export function loadConfig(): SweepConfig {
  const real = `${ROOT}apto.config.json`;
  const path = existsSync(real) ? real : `${ROOT}apto.config.example.json`;
  const c = JSON.parse(readFileSync(path, "utf8"));
  // Trust boundary is the user's own file; just fail loudly on the obvious mistakes.
  for (const k of ["city", "state", "neighborhoods", "quintoandar", "totalMinCents", "totalMaxCents",
                   "minBedrooms", "minBathrooms", "minParking"] as const)
    if (c[k] === undefined) throw new Error(`${path}: missing "${k}"`);
  if (!Array.isArray(c.neighborhoods) || c.neighborhoods.length === 0)
    throw new Error(`${path}: "neighborhoods" must be a non-empty array`);
  for (const k of ["totalMinCents", "totalMaxCents", "minBedrooms", "minBathrooms", "minParking"] as const)
    if (!Number.isInteger(c[k])) throw new Error(`${path}: "${k}" must be an integer`);
  console.log(`config: ${path.replace(ROOT, "")} (${c.neighborhoods.length} neighborhoods)`);
  return {
    ...c,
    totalMaxOverrides: c.totalMaxOverrides ?? {},
    rejectNoPets: c.rejectNoPets ?? true,
    quintoandar: { extraNeighborhoods: [], ...c.quintoandar },
  };
}

export interface SearchCriteria {
  neighborhoods: string[];
  total_min_cents: number | null;
  total_max_cents: number | null;
  bedrooms_min: number | null;
  bathrooms_min: number | null;
  parking_min: number | null;
  pets: "required" | "unknown_ok" | "any";
}

// A search without a max still needs a Glue priceMax.
// ponytail: fixed R$30k ceiling; a big neighborhood with no max can hit Glue's
// 1500-result window (sweep logs COVERAGE GAP), partition by price if it does.
export const NO_MAX_CENTS = 3_000_000;

/** Sweep the union of every user search: each neighborhood gets the loosest
 *  limits of the searches that include it. The Worker re-applies each search's
 *  exact criteria at read time. No searches = the config file as-is. */
export function fromSearches(base: SweepConfig, searches: SearchCriteria[]): SweepConfig {
  if (searches.length === 0) return base;
  const qaOnly = new Set(base.quintoandar.extraNeighborhoods);
  const hoods = [...new Set(searches.flatMap((s) => s.neighborhoods))];
  const overrides: Record<string, number> = {};
  for (const h of hoods)
    overrides[h] = Math.max(
      ...searches.filter((s) => s.neighborhoods.includes(h)).map((s) => s.total_max_cents ?? NO_MAX_CENTS),
    );
  const loosest = (k: "bedrooms_min" | "bathrooms_min" | "parking_min" | "total_min_cents", dflt: number) =>
    Math.min(...searches.map((s) => s[k] ?? dflt));
  return {
    ...base,
    neighborhoods: hoods.filter((h) => !qaOnly.has(h)),
    quintoandar: { ...base.quintoandar, extraNeighborhoods: hoods.filter((h) => qaOnly.has(h)) },
    totalMinCents: loosest("total_min_cents", 0),
    totalMaxCents: Math.max(...Object.values(overrides)),
    totalMaxOverrides: overrides,
    minBedrooms: loosest("bedrooms_min", 1),
    minBathrooms: loosest("bathrooms_min", 1),
    minParking: loosest("parking_min", 0),
    rejectNoPets: searches.every((s) => s.pets !== "any"),
  };
}
