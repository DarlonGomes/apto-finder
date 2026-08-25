-- Shared free-text note per unit (compare view). One row per unit; both
-- household users edit the same note. Dedupe folds loser notes into the
-- canonical unit before deleting losers; cascade cleans up what's left.
CREATE TABLE unit_notes (
  unit_id     uuid PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE,
  note        text NOT NULL,
  actor       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
