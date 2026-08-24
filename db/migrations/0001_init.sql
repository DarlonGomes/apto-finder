-- Schema from PRD section 6. Apply with:
--   psql "$DATABASE_URL" -f db/migrations/0001_init.sql

CREATE TABLE units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- resolved best guess across all listings in the cluster
  neighborhood    text NOT NULL,
  street          text,
  lat             double precision,
  lng             double precision,
  bedrooms        smallint,
  area_m2         smallint,
  parking_spots   smallint,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE listings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id               uuid REFERENCES units(id),

  source                text NOT NULL,       -- vivareal | zap | olx | quintoandar
  source_listing_id     text NOT NULL,
  url                   text NOT NULL,

  -- money: always monthly, always BRL cents, always integers
  rent_cents            integer NOT NULL,
  condo_cents           integer,
  iptu_monthly_cents    integer,
  insurance_cents       integer,
  service_fee_cents     integer,
  total_monthly_cents   integer GENERATED ALWAYS AS (
    rent_cents
    + COALESCE(condo_cents, 0)
    + COALESCE(iptu_monthly_cents, 0)
    + COALESCE(insurance_cents, 0)
    + COALESCE(service_fee_cents, 0)
  ) STORED,
  cost_confidence       text NOT NULL,       -- complete | partial

  bedrooms              smallint,
  suites                smallint,
  bathrooms             smallint,
  parking_spots         smallint,
  area_m2               smallint,
  floor                 smallint,

  neighborhood          text,
  street                text,
  lat                   double precision,
  lng                   double precision,
  geohash               text,

  accepts_pets          boolean,             -- NULL = unknown, and that matters
  pets_evidence         text,                -- 'amenity' | 'description' | NULL
  furnished             text,                -- none | partial | full

  photo_hashes          bigint[],
  advertiser            text,

  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  delisted_at           timestamptz,
  raw                   jsonb NOT NULL,

  UNIQUE (source, source_listing_id)
);

CREATE TABLE price_history (
  listing_id            uuid REFERENCES listings(id),
  observed_at           timestamptz NOT NULL DEFAULT now(),
  total_monthly_cents   integer NOT NULL,
  PRIMARY KEY (listing_id, observed_at)
);

CREATE TABLE unit_status (
  unit_id     uuid PRIMARY KEY REFERENCES units(id),
  status      text NOT NULL,     -- shortlisted | dismissed | contacted | visited
  note        text,
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX ON listings (total_monthly_cents) WHERE delisted_at IS NULL;
CREATE INDEX ON listings (neighborhood, bedrooms) WHERE delisted_at IS NULL;
CREATE INDEX ON listings (geohash);
CREATE INDEX ON listings (unit_id);
