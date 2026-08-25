-- Status v2: append-only events with actor (who did what) instead of one
-- anonymous row per unit. Statuses: liked | visit_booked | proposal_made | dismissed.
-- Current status of a unit = its latest event.

CREATE TABLE status_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id     uuid NOT NULL REFERENCES units(id),
  status      text NOT NULL,
  actor       text,            -- Cf-Access-Authenticated-User-Email; null for pre-migration rows and wrangler dev
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON status_events (unit_id, id DESC);

-- Carry over existing triage (actor unknown), mapping old names to new.
INSERT INTO status_events (unit_id, status, actor, created_at)
SELECT unit_id,
       CASE status
         WHEN 'shortlisted' THEN 'liked'
         WHEN 'visited'     THEN 'visit_booked'
         WHEN 'contacted'   THEN 'proposal_made'
         ELSE status
       END,
       NULL,
       COALESCE(updated_at, now())
FROM unit_status;

-- unit_status is kept so the currently deployed worker keeps working until
-- main is merged. ponytail: drop it in a later migration.
