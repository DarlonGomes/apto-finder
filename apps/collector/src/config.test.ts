import { test } from "node:test";
import assert from "node:assert/strict";
import { fromSearches, NO_MAX_CENTS, type SweepConfig } from "./config.js";

const base = {
  city: "Rio de Janeiro", state: "Rio de Janeiro", neighborhoods: ["Tijuca"],
  quintoandar: { bounds: { north: 0, south: 0, east: 0, west: 0 }, extraNeighborhoods: ["Largo do Machado"] },
  totalMinCents: 300000, totalMaxCents: 600000, totalMaxOverrides: {},
  minBedrooms: 2, minBathrooms: 2, minParking: 1, rejectNoPets: true,
} satisfies SweepConfig;

const s = (o: object) => ({
  neighborhoods: ["Tijuca"], total_min_cents: null, total_max_cents: null,
  bedrooms_min: null, bathrooms_min: null, parking_min: null, pets: "any" as const, ...o,
});

test("no searches keeps the file config", () => {
  assert.equal(fromSearches(base, []), base);
});

test("union takes the loosest limits per neighborhood", () => {
  const c = fromSearches(base, [
    s({ neighborhoods: ["Tijuca", "Largo do Machado"], total_min_cents: 200000, total_max_cents: 500000, bedrooms_min: 2, pets: "unknown_ok" }),
    s({ neighborhoods: ["Tijuca", "Botafogo"], total_min_cents: 400000, total_max_cents: 800000, bedrooms_min: 3, parking_min: 1, pets: "required" }),
  ]);
  assert.deepEqual(c.neighborhoods, ["Tijuca", "Botafogo"]); // QA-only name routed out of Glue
  assert.deepEqual(c.quintoandar.extraNeighborhoods, ["Largo do Machado"]);
  assert.deepEqual(c.totalMaxOverrides, { Tijuca: 800000, "Largo do Machado": 500000, Botafogo: 800000 });
  assert.equal(c.totalMaxCents, 800000);
  assert.equal(c.totalMinCents, 200000);
  assert.equal(c.minBedrooms, 2);
  assert.equal(c.minBathrooms, 1); // unset = 1
  assert.equal(c.minParking, 0); // one search doesn't care
  assert.equal(c.rejectNoPets, true); // every search has pets
});

test("a search without max or pets loosens everything", () => {
  const c = fromSearches(base, [s({ total_max_cents: 500000, pets: "required" }), s({})]);
  assert.equal(c.totalMaxOverrides.Tijuca, NO_MAX_CENTS);
  assert.equal(c.rejectNoPets, false);
});
