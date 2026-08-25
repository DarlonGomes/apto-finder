import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGlue, normalizeQuintoAndar } from "./normalize.js";

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

// QuintoAndar: money is whole reais; iptuPlusCondominium is a lump, iptu and
// homeInsurance itemized, taxa de serviço is the remainder to totalCost.
const QA_HIT = {
  id: 894725943,
  rent: 3000,
  totalCost: 4200,
  iptuPlusCondominium: 900,
  iptu: 100,
  homeInsurance: 50,
  area: 68,
  address: "Rua Paulino Fernandes",
  neighbourhood: "Botafogo",
  bedrooms: 2,
  bathrooms: 2,
  parkingSpaces: 1,
  isFurnished: false,
  amenities: [] as string[],
  imageList: ["a.jpg", "b.jpg"],
  location: { lat: -22.95, lon: -43.18 },
};

test("quintoandar: cost decomposes and components sum to totalCost", () => {
  const l = normalizeQuintoAndar(QA_HIT)!;
  assert.equal(l.rentCents, 300000);
  assert.equal(l.condoCents, 80000); // lump 900 minus iptu 100
  assert.equal(l.iptuMonthlyCents, 10000);
  assert.equal(l.insuranceCents, 5000);
  assert.equal(l.serviceFeeCents, 25000); // remainder to totalCost 4200
  assert.equal(l.costConfidence, "complete");
  const sum =
    l.rentCents + l.condoCents! + l.iptuMonthlyCents! + l.insuranceCents! + l.serviceFeeCents!;
  assert.equal(sum, 420000);
});

test("quintoandar: missing iptu lumps into condo, total still right", () => {
  const l = normalizeQuintoAndar({ ...QA_HIT, iptu: undefined })!;
  assert.equal(l.condoCents, 90000);
  assert.equal(l.iptuMonthlyCents, null);
  assert.equal(l.serviceFeeCents, 25000);
});

test("quintoandar: missing condo lump means partial, no fee guessing", () => {
  const l = normalizeQuintoAndar({ ...QA_HIT, iptuPlusCondominium: undefined, iptu: undefined })!;
  assert.equal(l.condoCents, null);
  assert.equal(l.serviceFeeCents, null);
  assert.equal(l.costConfidence, "partial");
});

test("quintoandar: unrentable hits are dropped", () => {
  assert.equal(normalizeQuintoAndar({ ...QA_HIT, rent: undefined }), null);
  assert.equal(normalizeQuintoAndar({ ...QA_HIT, id: undefined }), null);
});

test("quintoandar: pets amenity, furnished flag, urls", () => {
  const l = normalizeQuintoAndar({
    ...QA_HIT,
    amenities: ["PODE_TER_ANIMAIS_DE_ESTIMACAO"],
    isFurnished: true,
  })!;
  assert.deepEqual([l.acceptsPets, l.petsEvidence], [true, "amenity"]);
  assert.equal(l.furnished, "full");
  assert.equal(l.url, "https://www.quintoandar.com.br/imovel/894725943");
  assert.equal(l.photoUrls[0], "https://www.quintoandar.com.br/img/xlg/a.jpg");

  const plain = normalizeQuintoAndar(QA_HIT)!;
  assert.deepEqual([plain.acceptsPets, plain.petsEvidence], [null, null]);
  assert.equal(plain.furnished, "none");
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
