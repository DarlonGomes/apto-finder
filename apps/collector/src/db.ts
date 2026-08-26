// Upsert normalized listings and append price_history on total change (PRD 7.4).

import pg from "pg";

export type Client = pg.Client;
import type { NormalizedListing } from "@apto/shared";

export async function connect(): Promise<Client> {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_POOLED;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

const UPSERT = `
INSERT INTO listings (
  source, source_listing_id, url,
  rent_cents, condo_cents, iptu_monthly_cents, insurance_cents, service_fee_cents,
  cost_confidence,
  bedrooms, suites, bathrooms, parking_spots, area_m2, floor,
  neighborhood, street, lat, lng,
  accepts_pets, pets_evidence, furnished, advertiser, raw
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
)
ON CONFLICT (source, source_listing_id) DO UPDATE SET
  url = EXCLUDED.url,
  rent_cents = EXCLUDED.rent_cents,
  condo_cents = EXCLUDED.condo_cents,
  iptu_monthly_cents = EXCLUDED.iptu_monthly_cents,
  insurance_cents = EXCLUDED.insurance_cents,
  service_fee_cents = EXCLUDED.service_fee_cents,
  cost_confidence = EXCLUDED.cost_confidence,
  bedrooms = EXCLUDED.bedrooms,
  suites = EXCLUDED.suites,
  bathrooms = EXCLUDED.bathrooms,
  parking_spots = EXCLUDED.parking_spots,
  area_m2 = EXCLUDED.area_m2,
  floor = EXCLUDED.floor,
  neighborhood = EXCLUDED.neighborhood,
  street = EXCLUDED.street,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  accepts_pets = EXCLUDED.accepts_pets,
  pets_evidence = EXCLUDED.pets_evidence,
  furnished = EXCLUDED.furnished,
  advertiser = EXCLUDED.advertiser,
  raw = EXCLUDED.raw,
  last_seen_at = now(),
  delisted_at = NULL
RETURNING id, total_monthly_cents`;

// Append only when the total differs from the most recent observation.
const PRICE_POINT = `
INSERT INTO price_history (listing_id, total_monthly_cents)
SELECT $1, $2::integer
WHERE COALESCE((
  SELECT ph.total_monthly_cents FROM price_history ph
  WHERE ph.listing_id = $1
  ORDER BY ph.observed_at DESC LIMIT 1
), -1) <> $2::integer`;

// Until the dedup pipeline (milestone 4) clusters listings, every listing gets
// its own unit, reusing the listing's uuid. Dedup will re-point unit_id later.
const SEED_UNIT = `
WITH need AS (
  SELECT id, neighborhood, street, lat, lng, bedrooms, area_m2, parking_spots
  FROM listings WHERE id = $1 AND unit_id IS NULL
), ins AS (
  INSERT INTO units (id, neighborhood, street, lat, lng, bedrooms, area_m2, parking_spots)
  SELECT id, COALESCE(neighborhood, ''), street, lat, lng, bedrooms, area_m2, parking_spots
  FROM need
  ON CONFLICT (id) DO NOTHING
)
UPDATE listings SET unit_id = id WHERE id IN (SELECT id FROM need)`;

export async function saveListing(client: Client, l: NormalizedListing): Promise<void> {
  const { rows } = await client.query(UPSERT, [
    l.source, l.sourceListingId, l.url,
    l.rentCents, l.condoCents, l.iptuMonthlyCents, l.insuranceCents, l.serviceFeeCents,
    l.costConfidence,
    l.bedrooms, l.suites, l.bathrooms, l.parkingSpots, l.areaM2, l.floor,
    l.neighborhood, l.street, l.lat, l.lng,
    l.acceptsPets, l.petsEvidence, l.furnished, l.advertiser, JSON.stringify(l.raw),
  ]);
  const row = rows[0];
  await client.query(PRICE_POINT, [row.id, row.total_monthly_cents]);
  await client.query(SEED_UNIT, [row.id]);
}
