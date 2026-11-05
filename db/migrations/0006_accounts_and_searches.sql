-- Accounts (email OTP, no passwords) and shared searches. Replaces Cloudflare
-- Access: the Worker now owns auth. A search is the shared space: its members
-- see the same units, statuses and notes. People can belong to several.

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL UNIQUE CHECK (email = lower(email)),
  first_name         text,          -- NULL until onboarding is done
  last_name          text,
  home_neighborhood  text,
  home_city          text,
  referral           text,          -- how they found the site
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- One pending code per email; a new request replaces it.
CREATE TABLE login_codes (
  email       text PRIMARY KEY,
  code_hash   text NOT NULL,        -- sha256 hex of the 6-digit code
  expires_at  timestamptz NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,     -- sha256 hex of the cookie value
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
CREATE INDEX ON sessions (user_id);

-- Daily-scan criteria. Everything but neighborhoods is optional (NULL = no limit).
CREATE TABLE searches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  city             text NOT NULL DEFAULT 'Rio de Janeiro',
  neighborhoods    text[] NOT NULL CHECK (cardinality(neighborhoods) > 0),
  total_min_cents  integer,
  total_max_cents  integer,
  bedrooms_min     smallint,
  bathrooms_min    smallint,
  parking_min      smallint,
  pets             text NOT NULL DEFAULT 'any' CHECK (pets IN ('required', 'unknown_ok', 'any')),
  furnished        text NOT NULL DEFAULT 'any' CHECK (furnished IN ('any', 'yes', 'no')),
  facilities       text[] NOT NULL DEFAULT '{}',  -- keys of FACILITIES in @apto/shared
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Membership is by email so an invite works before the invitee signs up.
CREATE TABLE search_members (
  search_id   uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(email)),
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (search_id, email)
);
CREATE INDEX ON search_members (email);

-- Existing triage becomes the first search, criteria from apto.config.example.json,
-- members = everyone who ever set a status or note. Only when there is triage.
INSERT INTO searches (id, name, neighborhoods, total_min_cents, total_max_cents,
                      bedrooms_min, bathrooms_min, parking_min, pets)
SELECT '00000000-0000-0000-0000-000000000001', 'Casa',
  ARRAY['Tijuca','Grajaú','Vila Isabel','Andaraí','Barra da Tijuca','Botafogo',
        'Gávea','Catete','Flamengo','Humaitá','Lagoa','Largo do Machado'],
  300000, 700000, 2, 2, 1, 'unknown_ok'
WHERE EXISTS (SELECT 1 FROM status_events) OR EXISTS (SELECT 1 FROM unit_notes);

INSERT INTO search_members (search_id, email)
SELECT DISTINCT '00000000-0000-0000-0000-000000000001'::uuid, lower(actor)
FROM (SELECT actor FROM status_events UNION SELECT actor FROM unit_notes) a
WHERE actor IS NOT NULL
  AND EXISTS (SELECT 1 FROM searches WHERE id = '00000000-0000-0000-0000-000000000001');

-- Statuses and notes now belong to a search.
ALTER TABLE status_events ADD COLUMN search_id uuid REFERENCES searches(id) ON DELETE CASCADE;
UPDATE status_events SET search_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE status_events ALTER COLUMN search_id SET NOT NULL;
CREATE INDEX ON status_events (search_id, unit_id, id DESC);

ALTER TABLE unit_notes ADD COLUMN search_id uuid REFERENCES searches(id) ON DELETE CASCADE;
UPDATE unit_notes SET search_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE unit_notes ALTER COLUMN search_id SET NOT NULL;
ALTER TABLE unit_notes DROP CONSTRAINT unit_notes_pkey;
ALTER TABLE unit_notes ADD PRIMARY KEY (search_id, unit_id);
