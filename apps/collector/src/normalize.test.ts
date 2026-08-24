import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGlue } from "./normalize.js";

function wrapper(listing: any, medias: any[] = []) {
  return { listing: { id: "123", status: "ACTIVE", ...listing }, account: {}, medias };
}

const RENTAL = {
  businessType: "RENTAL",
  price: "7000",
  monthlyCondoFee: "1368",
  iptu: "351",
  iptuPeriod: "YEARLY",
};

test("money becomes integer cents, yearly IPTU becomes monthly", () => {
  const l = normalizeGlue(wrapper({ pricingInfos: [RENTAL] }))!;
  assert.equal(l.rentCents, 700000);
  assert.equal(l.condoCents, 136800);
  assert.equal(l.iptuMonthlyCents, Math.round(35100 / 12)); // 2925
  assert.equal(l.costConfidence, "complete");
});

test("monthly IPTU is not divided", () => {
  const l = normalizeGlue(
    wrapper({ pricingInfos: [{ ...RENTAL, iptu: "100", iptuPeriod: "MONTHLY" }] }),
  )!;
  assert.equal(l.iptuMonthlyCents, 10000);
});

test("missing condo means partial confidence, not zero", () => {
  const l = normalizeGlue(wrapper({ pricingInfos: [{ businessType: "RENTAL", price: "2000" }] }))!;
  assert.equal(l.condoCents, null);
  assert.equal(l.costConfidence, "partial");
});

test("daily-rate (temporada) listings are dropped", () => {
  const daily = { ...RENTAL, rentalInfo: { period: "DAILY" } };
  assert.equal(normalizeGlue(wrapper({ pricingInfos: [daily] })), null);
});

test("SALE-only or unpriced listings are dropped", () => {
  assert.equal(normalizeGlue(wrapper({ pricingInfos: [{ businessType: "SALE", price: "500000" }] })), null);
  assert.equal(normalizeGlue(wrapper({ pricingInfos: [] })), null);
});

test("pets: amenity beats text, text fallback works both ways, silence stays null", () => {
  const amenity = normalizeGlue(wrapper({ pricingInfos: [RENTAL], amenities: ["PETS_ALLOWED"] }))!;
  assert.deepEqual([amenity.acceptsPets, amenity.petsEvidence], [true, "amenity"]);

  const yes = normalizeGlue(wrapper({ pricingInfos: [RENTAL], description: "Aceita pet pequeno" }))!;
  assert.deepEqual([yes.acceptsPets, yes.petsEvidence], [true, "description"]);

  const no = normalizeGlue(wrapper({ pricingInfos: [RENTAL], description: "Não aceita animais" }))!;
  assert.deepEqual([no.acceptsPets, no.petsEvidence], [false, "description"]);

  const unknown = normalizeGlue(wrapper({ pricingInfos: [RENTAL], description: "Ótimo apartamento" }))!;
  assert.deepEqual([unknown.acceptsPets, unknown.petsEvidence], [null, null]);
});

test("array fields take the first element", () => {
  const l = normalizeGlue(
    wrapper({ pricingInfos: [RENTAL], bedrooms: [2], usableAreas: ["70"], parkingSpaces: [1], unitFloor: 9 }),
  )!;
  assert.equal(l.bedrooms, 2);
  assert.equal(l.areaM2, 70);
  assert.equal(l.parkingSpots, 1);
  assert.equal(l.floor, 9);
});
