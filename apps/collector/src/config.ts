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
