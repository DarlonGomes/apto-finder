// Glue wrapper -> NormalizedListing (PRD 7.2).
// Glue money values are strings in whole reais; we store integer cents.
// IPTU arrives with iptuPeriod YEARLY or MONTHLY; yearly is divided by 12 HERE, never later.

import type { NormalizedListing, PetsEvidence } from "@apto/shared";

function centsFromReais(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function first(v: unknown): number | null {
  const x = Array.isArray(v) ? v[0] : v;
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

const PETS_YES = /aceita(?:m|-se)?\s+(?:pets?|animais|animal)|permitido\s+animais|pet\s*friendly/i;
const PETS_NO = /n[aã]o\s+(?:aceita(?:m|-se)?|s[aã]o\s+permitidos?)\s+(?:pets?|animais|animal)/i;

function petsFromText(text: string): { accepts: boolean; evidence: PetsEvidence } | null {
  if (PETS_NO.test(text)) return { accepts: false, evidence: "description" };
  if (PETS_YES.test(text)) return { accepts: true, evidence: "description" };
  return null;
}

/** Returns null for wrappers we can't price (no RENTAL entry or no rent). */
export function normalizeGlue(wrapper: any): NormalizedListing | null {
  const l = wrapper?.listing;
  if (!l || l.status === "INACTIVE") return null;

  const p = (l.pricingInfos ?? []).find((x: any) => x?.businessType === "RENTAL");
  // Temporada listings price per day; only monthly rentals attend us.
  if (p?.rentalInfo?.period && p.rentalInfo.period !== "MONTHLY") return null;
  const rentCents = centsFromReais(p?.price);
  if (!rentCents) return null;

  const condoCents = centsFromReais(p?.monthlyCondoFee);
  const iptuRaw = centsFromReais(p?.iptu ?? p?.yearlyIptu);
  const iptuMonthlyCents =
    iptuRaw == null
      ? null
      : p?.iptuPeriod === "MONTHLY"
        ? iptuRaw
        : Math.round(iptuRaw / 12); // YEARLY (the default) and anything else observed

  const amenities: string[] = l.amenities ?? [];
  let acceptsPets: boolean | null = null;
  let petsEvidence: PetsEvidence | null = null;
  if (amenities.includes("PETS_ALLOWED")) {
    acceptsPets = true;
    petsEvidence = "amenity";
  } else {
    const fromText = petsFromText(`${l.title ?? ""} ${l.description ?? ""}`);
    if (fromText) {
      acceptsPets = fromText.accepts;
      petsEvidence = fromText.evidence;
    }
  }

  const addr = l.address ?? {};
  const point = addr.point ?? {};

  return {
    source: "vivareal",
    sourceListingId: String(l.id),
    url: `https://www.vivareal.com.br/imovel/id-${l.id}/`,

    rentCents,
    condoCents,
    iptuMonthlyCents,
    insuranceCents: null, // Glue never itemizes these two
    serviceFeeCents: null,
    costConfidence: condoCents != null ? "complete" : "partial",

    bedrooms: first(l.bedrooms),
    suites: first(l.suites),
    bathrooms: first(l.bathrooms),
    parkingSpots: first(l.parkingSpaces),
    areaM2: first(l.usableAreas),
    floor: first(l.unitFloor),

    neighborhood: addr.neighborhood ?? null,
    street: addr.street ?? null,
    lat: point.lat ?? point.approximateLat ?? null,
    lng: point.lon ?? point.approximateLon ?? null,

    acceptsPets,
    petsEvidence,
    furnished: amenities.includes("FURNISHED") ? "full" : null,

    photoUrls: (wrapper.medias ?? [])
      .filter((m: any) => m?.type === "IMAGE" && m?.url)
      .slice(0, 5)
      .map((m: any) => m.url),
    advertiser: wrapper.account?.name ?? null,

    raw: wrapper,
  };
}
