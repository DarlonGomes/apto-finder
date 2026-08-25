-- Visit and proposal details on status events.
ALTER TABLE status_events
  ADD COLUMN visit_at     timestamptz,  -- visit_booked: scheduled date/time
  ADD COLUMN amount_cents integer,      -- proposal_made: offer, integer BRL cents
  ADD COLUMN note         text;         -- proposal_made: optional context (e.g. issues justifying a lower offer)
