import { test } from "node:test";
import assert from "node:assert/strict";
import { score, streetMatch, clusterUnits, type DedupeRow } from "./dedupe.js";

let n = 0;
function row(over: Partial<DedupeRow> = {}): DedupeRow {
  n++;
  return {
    id: `l${n}`,
    unit_id: `u${n}`,
    source: "vivareal",
    source_id: null,
    first_seen_at: `2026-08-0${(n % 9) + 1}T00:00:00Z`,
    lat: -22.95,
    lng: -43.18,
    bedrooms: 2,
    area_m2: 70,
    parking_spots: 1,
    floor: 5,
    street: "Rua Voluntários da Pátria",
    total: 400000,
    media_hashes: ["aa", "bb", "cc"],
    ...over,
  };
}

test("same source + sourceId is a match regardless of anything else", () => {
  const a = row({ source_id: "x", lat: -22.0, area_m2: 200 });
  const b = row({ source_id: "x", lat: -23.0, area_m2: 50 });
  assert.equal(score(a, b), 10);
});

test("block rejects: different bedrooms, far apart, area gap, missing geo", () => {
  assert.equal(score(row(), row({ bedrooms: 3 })), 0);
  assert.equal(score(row(), row({ lat: -22.98 })), 0);
  assert.equal(score(row(), row({ area_m2: 80 })), 0);
  assert.equal(score(row(), row({ lat: null })), 0);
});

test("full agreement scores 1.0, photo overlap drives the merge", () => {
  assert.equal(score(row(), row()), 10);
  // photos + price alone reach the 0.7 threshold
  const a = row({ parking_spots: null, floor: null, street: null });
  const b = row({ parking_spots: 2, floor: 3, street: "Rua Outra Qualquer" });
  assert.ok(score(a, b) >= 7);
});

test("one shared photo is not a photo match (shared facade shots)", () => {
  const a = row({ media_hashes: ["aa", "xx", "yy"], floor: null, street: null, parking_spots: null });
  const b = row({ media_hashes: ["aa", "zz", "ww"], floor: null, street: null, parking_spots: null });
  assert.ok(score(a, b) < 7); // only price (2)
});

test("no photo overlap cannot reach the threshold", () => {
  const a = row({ media_hashes: [] });
  const b = row({ media_hashes: [] });
  assert.equal(score(a, b), 5); // price+parking+floor+street, still short
});

test("street matching is accent/prefix tolerant", () => {
  assert.ok(streetMatch("Rua Voluntários da Pátria", "R. Voluntarios da Patria"));
  assert.ok(streetMatch("Avenida Maracanã", "Av Maracana"));
  assert.ok(!streetMatch("Rua A", "Rua B")); // too short
  assert.ok(!streetMatch(null, "Rua Qualquer"));
});

test("clusterUnits is transitive and only returns real clusters", () => {
  const a = row({ media_hashes: ["1", "2", "3"] });
  const b = row({ media_hashes: ["2", "3", "4"] });
  const c = row({ media_hashes: ["3", "4", "5"] }); // chains a-b-c
  const lone = row({ media_hashes: ["9", "8"], lat: -22.99, lng: -43.3 });
  const clusters = clusterUnits([a, b, c, lone]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0]!.sort(), [a.unit_id, b.unit_id, c.unit_id].sort());
});

test("already-merged units do not produce clusters", () => {
  const a = row();
  const b = row({ unit_id: a.unit_id });
  assert.deepEqual(clusterUnits([a, b]), []);
});
