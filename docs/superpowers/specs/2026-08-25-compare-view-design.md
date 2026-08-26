# Compare view

2026-08-25. Side-by-side matrix of shortlisted units so the two of us can pick the apartment. PRD scope rule check: this is the "spot a good one sooner" endgame, it turns 8 shortlisted units into 1 lease.

## Population

Every unit whose current status is `liked`, `visit_booked`, or `proposal_made`. No manual add-to-compare UI: swipe-right is the selection mechanism. Sorted by total cost ascending. One fetch, limit 100, no pagination (real volume is under 20).

Known limitation, deliberate: a unit whose listings all delist drops out of the matrix, same as the results list. Disappearing is signal. Add an `include_delisted` flag later only if it bites.

## Entry and routing

`?view=compare` URL param, same pattern as the `?unit=` detail overlay: header button opens it (label shows the liked+ count), back button closes it, URL shareable. Full-screen overlay component `Compare.tsx`.

## Layout

Attributes as rows, units as columns. Sticky attribute-label column, sticky header row (thumbnail, neighborhood, total). Horizontal scroll on the phone (about two unit columns visible), everything fits on desktop. Thumbnail tap opens the existing detail overlay.

Best value per comparable row highlighted with the `--good` token: lowest total, biggest area, lowest R$/m², most days listed (leverage), biggest price drop. Highlight only when at least two units have the value and the values differ.

Rows: total (tabular figures), cost bar (reuse `CostBar`), area, quartos, banheiros, vagas, R$/m², dias no ar, variacao de preco, anuncios (count + spread), pets, status (badge + visit date or proposal amount), quem curtiu, notas.

## Data changes

`GET /api/units` gains three fields on each unit:

- `bathrooms`: already on the cheapest listing, just not selected.
- `liked_by`: distinct actors who ever emitted a `liked` event for the unit (the current response only carries the latest event's actor, which loses "both of us liked this").
- `note`: from the new `unit_notes` table.

## Notes

Migration `0005_unit_notes.sql`:

```sql
CREATE TABLE unit_notes (
  unit_id     uuid PRIMARY KEY REFERENCES units(id) ON DELETE CASCADE,
  note        text NOT NULL,
  actor       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

One shared note per unit, both users edit the same text. New endpoint `PUT /api/units/:id/note` upserts it (empty note deletes the row), actor from the Access header. In the matrix: tap-to-edit textarea, saved on blur.

Dedupe integration: when `dedupe.ts` merges units, loser notes are folded into the canonical unit (concatenated, newline-separated) before the loser units are deleted. Without this a cluster merge would silently drop a note, and notes are the one thing here we cannot recompute.

Skipped: note history, per-person notes, notes elsewhere in the UI.

## Not building

Export/share image, column reordering or pinning, weighted scoring, manual compare selection. YAGNI until the matrix proves insufficient.

## Touched files

- `db/migrations/0005_unit_notes.sql` (new)
- `apps/worker/src/index.ts`: 3 fields on /api/units, PUT note endpoint
- `apps/collector/src/dedupe.ts`: move notes on merge
- `packages/shared/src/index.ts`: UnitCard gains `bathrooms`, `liked_by`, `note`
- `apps/web/src/api.ts`: `fetchCompareUnits`, `putNote`
- `apps/web/src/Compare.tsx` (new)
- `apps/web/src/App.tsx`: view param + header button

## Verification

`pnpm -r typecheck`, `pnpm --filter web build`, migration applied via `pnpm --filter collector migrate` (also applies the pending 0004), manual smoke on dev worker.
