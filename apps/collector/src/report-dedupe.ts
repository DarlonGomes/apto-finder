// Read-only dedup dry run: prints the clusters the pipeline would merge,
// for the PRD 7.3 hand spot-check. Usage: node --env-file=../../.env --import tsx src/report-dedupe.ts
import { clusterUnits, score } from "./dedupe.js";
import { connect } from "./db.js";

const client = await connect();
const { rows } = await client.query(`
SELECT l.id, l.unit_id, l.source, l.raw->'listing'->>'sourceId' AS source_id,
  l.first_seen_at, l.lat, l.lng, l.bedrooms, l.area_m2, l.parking_spots,
  l.floor, l.street, l.total_monthly_cents AS total, l.neighborhood, l.advertiser, l.url,
  COALESCE((SELECT array_agg(DISTINCT h.mh) FROM (
      SELECT substring(m->>'url' FROM 'vr-listing/([0-9a-f]+)/') AS mh
      FROM jsonb_array_elements(l.raw->'medias') m WHERE m->>'type' = 'IMAGE'
    ) h WHERE h.mh IS NOT NULL), '{}') AS media_hashes
FROM listings l WHERE l.delisted_at IS NULL AND l.unit_id IS NOT NULL`);
await client.end();

const clusters = clusterUnits(rows as any[]);
console.log("clusters:", clusters.length);
for (const units of clusters) {
  const ms = (rows as any[]).filter((r) => units.includes(r.unit_id));
  console.log("---");
  for (const m of ms) {
    const others = ms.filter((x) => x !== m);
    const smax = Math.max(...others.map((o) => score(m, o)));
    console.log(
      ` ${m.source} ${m.neighborhood} | ${m.street} | R$${(m.total / 100).toFixed(0)} | ` +
        `${m.bedrooms}q ${m.area_m2}m2 vaga:${m.parking_spots} andar:${m.floor} | ` +
        `${m.advertiser} | score:${smax} | ${m.url}`,
    );
  }
}
