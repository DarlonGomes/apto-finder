// Shared shapes between collector, worker, and web.
// Money is always monthly BRL integer cents. Never floats.

export type Source = "vivareal" | "zap" | "olx" | "quintoandar";
export type CostConfidence = "complete" | "partial";
export type UnitStatus = "shortlisted" | "dismissed" | "contacted" | "visited";
export type Furnished = "none" | "partial" | "full";
export type PetsEvidence = "amenity" | "description";

/** Output of every per-source adapter. One shape, whatever the portal. */
export interface NormalizedListing {
  source: Source;
  sourceListingId: string;
  url: string;

  rentCents: number;
  condoCents: number | null;
  iptuMonthlyCents: number | null;
  insuranceCents: number | null;
  serviceFeeCents: number | null;
  costConfidence: CostConfidence;

  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpots: number | null;
  areaM2: number | null;
  floor: number | null;

  neighborhood: string | null;
  street: string | null;
  lat: number | null;
  lng: number | null;

  acceptsPets: boolean | null; // null = unknown, and that matters
  petsEvidence: PetsEvidence | null;
  furnished: Furnished | null;

  photoUrls: string[];
  advertiser: string | null;

  raw: unknown;
}

/** A unit as returned by GET /api/units. */
export interface UnitCard {
  id: string;
  neighborhood: string;
  street: string | null;
  bedrooms: number | null;
  area_m2: number | null;
  parking_spots: number | null;
  accepts_pets: boolean | null;
  pets_evidence: PetsEvidence | null;
  cheapest: {
    total_monthly_cents: number;
    rent_cents: number;
    condo_cents: number | null;
    iptu_monthly_cents: number | null;
    insurance_cents: number | null;
    service_fee_cents: number | null;
    cost_confidence: CostConfidence;
    source: Source;
    url: string;
  };
  listing_count: number;
  price_spread_cents: number;
  days_listed: number;
  price_change_pct: number | null;
  thumbnail: string | null;
  status: UnitStatus | null;
}

export interface UnitsResponse {
  units: UnitCard[];
  next_cursor: string | null;
  total_matching: number;
}
