// Dedup pipeline (PRD 7.3, adapted to what the data actually offers):
// - Glue's `sourceId` is its own cross-portal/advertiser unit id; equal ids on
//   the same source are the same unit, full stop (verified in the corpus).
// - The photo signal is Glue media content-hash overlap: resizedimgs URLs are
//   content-addressed (`vr-listing/{md5}/`), so identical uploads share hashes
//   and no image ever needs downloading. QuintoAndar photographs its own
//   units, so a QA/Glue photo match is impossible even with perceptual
//   hashing; cross-source pairs top out at 0.5 and never merge, same as the
//   PRD's pHash design would have behaved.
// - Blocking is a direct O(n^2) scan with a coordinate window instead of
//   geohash prefixes. ponytail: fine to ~10k active listings, revisit after.
// Group, never delete: clusters re-point unit_id; listings are untouched.

import type { Client } from "./db.js";

export interface DedupeRow {
  id: string;
  unit_id: string;
  source: string;
  source_id: string | null; // Glue raw sourceId
  first_seen_at: string;
  lat: number | null;
  lng: number | null;
  bedrooms: number | null;
  area_m2: number | null;
  parking_spots: number | null;
  floor: number | null;
  street: string | null;
  total: number;
  media_hashes: string[];
}

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

/** "Rua Voluntários da Pátria" ~ "R. Voluntarios da Patria". */
export function streetMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const strip = (s: string) =>
    fold(s).replace(/^(rua|r\.|avenida|av\.?|estrada|estr\.?|travessa|tv\.?|praca|pca\.?)\s+/, "");
  const x = strip(a);
  const y = strip(b);
  if (x.length < 4 || y.length < 4) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** PRD 7.3 weights in integer tenths (floats drift). >= 7 clusters. */
export function score(a: DedupeRow, b: DedupeRow): number {
  if (a.source === b.source && a.source_id && a.source_id === b.source_id) return 10;
  // Block: ~1km window, same bedrooms, area within +-3.
  if (a.bedrooms == null || a.bedrooms !== b.bedrooms) return 0;
  if (a.area_m2 == null || b.area_m2 == null || Math.abs(a.area_m2 - b.area_m2) > 3) return 0;
  if (a.lat == null || b.lat == null || a.lng == null || b.lng == null) return 0;
  if (Math.abs(a.lat - b.lat) > 0.01 || Math.abs(a.lng - b.lng) > 0.01) return 0;

  let s = 0;
  // 2+ shared photos, not 1: agencies reuse a facade shot across units in the
  // same building.
  const bSet = new Set(b.media_hashes);
  const shared = a.media_hashes.filter((h) => bSet.has(h)).length;
  if (shared >= 2) s += 5;
  if (Math.abs(a.total - b.total) <= 0.05 * Math.min(a.total, b.total)) s += 2;
  if (a.parking_spots != null && a.parking_spots === b.parking_spots) s += 1;
  if (a.floor != null && a.floor === b.floor) s += 1;
  if (streetMatch(a.street, b.street)) s += 1;
  return s;
}

/** Union-find keyed by unit_id: clusters of units that are one physical unit. */
export function clusterUnits(rows: DedupeRow[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (x: string, y: string) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  for (const r of rows) if (!parent.has(r.unit_id)) parent.set(r.unit_id, r.unit_id);
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j]!;
      if (a.unit_id !== b.unit_id && score(a, b) >= 7) union(a.unit_id, b.unit_id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const u of new Set(rows.map((r) => r.unit_id))) {
    const root = find(u);
    groups.set(root, [...(groups.get(root) ?? []), u]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

const LOAD = `
SELECT l.id, l.unit_id, l.source, l.raw->'listing'->>'sourceId' AS source_id,
  l.first_seen_at, l.lat, l.lng, l.bedrooms, l.area_m2, l.parking_spots,
  l.floor, l.street, l.total_monthly_cents AS total,
  COALESCE((
    SELECT array_agg(DISTINCT h.mh) FROM (
      SELECT substring(m->>'url' FROM 'vr-listing/([0-9a-f]+)/') AS mh
      FROM jsonb_array_elements(l.raw->'medias') m
      WHERE m->>'type' = 'IMAGE'
    ) h WHERE h.mh IS NOT NULL
  ), '{}') AS media_hashes
FROM listings l
WHERE l.delisted_at IS NULL AND l.unit_id IS NOT NULL`;

/** Merge duplicate units. Canonical = the unit of the earliest-seen listing,
 *  so re-runs are stable and statuses stay put. Returns merged-cluster count. */
export async function dedupe(client: Client): Promise<number> {
  const { rows } = await client.query(LOAD);
  const clusters = clusterUnits(rows as DedupeRow[]);
  let repointed = 0;
  for (const units of clusters) {
    const members = (rows as DedupeRow[])
      .filter((r) => units.includes(r.unit_id))
      .sort((a, b) => a.first_seen_at < b.first_seen_at ? -1 : a.first_seen_at > b.first_seen_at ? 1 : a.id.localeCompare(b.id));
    const canon = members[0]!.unit_id;
    const losers = units.filter((u) => u !== canon);
    // Whole units move (delisted siblings included), statuses follow, and the
    // now-orphaned seed units go away.
    await client.query(`UPDATE status_events SET unit_id = $1 WHERE unit_id = ANY($2)`, [canon, losers]);
    // Notes are the one thing we can't recompute: fold loser notes into the
    // canonical unit (newline-joined); loser rows die with their units (cascade).
    await client.query(
      `INSERT INTO unit_notes (unit_id, note, actor, updated_at)
       SELECT $1, string_agg(note, E'\n' ORDER BY updated_at), max(actor), max(updated_at)
       FROM unit_notes WHERE unit_id = ANY($2)
       HAVING count(*) > 0
       ON CONFLICT (unit_id) DO UPDATE SET
         note = unit_notes.note || E'\n' || EXCLUDED.note,
         updated_at = greatest(unit_notes.updated_at, EXCLUDED.updated_at)`,
      [canon, losers],
    );
    await client.query(`UPDATE listings SET unit_id = $1 WHERE unit_id = ANY($2)`, [canon, losers]);
    await client.query(`DELETE FROM units WHERE id = ANY($1)`, [losers]);
    repointed += losers.length;
  }
  if (clusters.length > 0)
    console.log(`dedup: ${clusters.length} clusters, ${repointed} units merged away`);
  return clusters.length;
}
