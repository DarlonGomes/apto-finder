import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";

type Bindings = {
  DATABASE_URL?: string;
  DATABASE_URL_POOLED?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const db = (c: { env: Bindings }) => neon((c.env.DATABASE_URL ?? c.env.DATABASE_URL_POOLED)!);

const fillThumb = (t: string | null | undefined, dim = "360x240"): string | null =>
  t
    ? t.replace("{description}", "foto").replace("{action}", "crop").replace("{width}x{height}", dim)
    : null;

app.get("/api/meta", async (c) => {
  const sql = db(c);
  const rows = await sql`
    SELECT
      count(*) FILTER (WHERE delisted_at IS NULL)::int AS active_listings,
      (SELECT count(*)::int FROM units) AS units,
      max(last_seen_at) AS last_sweep_at
    FROM listings
  `;
  return c.json(rows[0]);
});

// The one endpoint that matters (PRD 8).
app.get("/api/units", async (c) => {
  const q = c.req.query();
  const where: string[] = ["l.delisted_at IS NULL"];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("?", `$${params.length}`));
  };

  if (q.total_max) add("c.total_monthly_cents <= ?", Number(q.total_max));
  if (q.total_min) add("c.total_monthly_cents >= ?", Number(q.total_min));
  add("COALESCE(c.bedrooms, 0) >= ?", Number(q.bedrooms_min ?? 1));
  if (q.parking_min) add("COALESCE(c.parking_spots, 0) >= ?", Number(q.parking_min));
  if (q.area_min) add("c.area_m2 >= ?", Number(q.area_min));
  if (q.neighborhoods) add("u.neighborhood = ANY(?)", q.neighborhoods.split(","));
  if (q.furnished) add("c.furnished = ANY(?)", q.furnished.split(","));
  if (q.cost_confidence === "complete") where.push("c.cost_confidence = 'complete'");

  const pets = q.pets ?? "unknown_ok";
  if (pets === "required") where.push("c.accepts_pets IS TRUE");
  else if (pets === "unknown_ok") where.push("c.accepts_pets IS DISTINCT FROM FALSE");

  if (q.status) add("s.status = ANY(?)", q.status.split(","));
  else where.push("COALESCE(s.status, '') <> 'dismissed'");

  const sort = q.sort ?? "total_asc";
  const ORDERS: Record<string, string> = {
    total_asc: "c.total_monthly_cents ASC, u.id ASC",
    newest: "a.first_seen DESC, u.id ASC",
    price_per_m2: "c.total_monthly_cents::float / NULLIF(c.area_m2, 0) ASC NULLS LAST, u.id ASC",
    biggest_drop: "price_change_pct ASC NULLS LAST, u.id ASC",
  };
  if (!ORDERS[sort]) return c.json({ error: `unknown sort: ${sort}` }, 400);

  // Keyset pagination for the two hot sorts. price_per_m2/biggest_drop are
  // single-page for now. ponytail: cursors there when the dataset outgrows one page.
  if (q.cursor && (sort === "total_asc" || sort === "newest")) {
    try {
      const [v, id] = JSON.parse(atob(q.cursor));
      params.push(v, id);
      where.push(
        sort === "total_asc"
          ? `(c.total_monthly_cents, u.id::text) > ($${params.length - 1}, $${params.length})`
          : `(a.first_seen, u.id::text) < ($${params.length - 1}::timestamptz, $${params.length})`,
      );
    } catch {
      return c.json({ error: "bad cursor" }, 400);
    }
  }

  const limit = Math.min(Number(q.limit ?? 30), 100);
  params.push(limit);

  const sql = db(c);
  const rows: any[] = await sql.query(
    `
    WITH cheapest AS (
      SELECT DISTINCT ON (unit_id) *
      FROM listings WHERE delisted_at IS NULL AND unit_id IS NOT NULL
      ORDER BY unit_id, total_monthly_cents ASC
    ), agg AS (
      SELECT unit_id, count(*)::int AS listing_count,
             (max(total_monthly_cents) - min(total_monthly_cents))::int AS price_spread_cents,
             min(first_seen_at) AS first_seen
      FROM listings WHERE delisted_at IS NULL GROUP BY unit_id
    )
    SELECT u.id, u.neighborhood, u.street,
      c.bedrooms, c.area_m2, c.parking_spots, c.accepts_pets, c.pets_evidence,
      c.total_monthly_cents, c.rent_cents, c.condo_cents, c.iptu_monthly_cents,
      c.insurance_cents, c.service_fee_cents, c.cost_confidence, c.source, c.url,
      a.listing_count, a.price_spread_cents, a.first_seen,
      GREATEST(0, EXTRACT(day FROM now() - a.first_seen))::int AS days_listed,
      (SELECT round(100.0 * (c.total_monthly_cents - f.t) / f.t, 1)::float
       FROM (SELECT total_monthly_cents AS t FROM price_history
             WHERE listing_id = c.id ORDER BY observed_at ASC LIMIT 1) f
       WHERE f.t <> c.total_monthly_cents) AS price_change_pct,
      c.raw->'medias'->0->>'url' AS thumb_template,
      s.status, s.actor AS status_actor, s.visit_at AS status_visit_at,
      s.amount_cents AS status_amount_cents, s.note AS status_note,
      count(*) OVER ()::int AS total_matching
    FROM cheapest c
    JOIN listings l ON l.id = c.id
    JOIN units u ON u.id = c.unit_id
    JOIN agg a ON a.unit_id = c.unit_id
    LEFT JOIN LATERAL (
      SELECT status, actor, visit_at, amount_cents, note FROM status_events
      WHERE unit_id = u.id ORDER BY id DESC LIMIT 1
    ) s ON true
    WHERE ${where.join(" AND ")}
    ORDER BY ${ORDERS[sort]}
    LIMIT $${params.length}`,
    params,
  );

  const units = rows.map((r) => ({
    id: r.id,
    neighborhood: r.neighborhood,
    street: r.street,
    bedrooms: r.bedrooms,
    area_m2: r.area_m2,
    parking_spots: r.parking_spots,
    accepts_pets: r.accepts_pets,
    pets_evidence: r.pets_evidence,
    cheapest: {
      total_monthly_cents: r.total_monthly_cents,
      rent_cents: r.rent_cents,
      condo_cents: r.condo_cents,
      iptu_monthly_cents: r.iptu_monthly_cents,
      insurance_cents: r.insurance_cents,
      service_fee_cents: r.service_fee_cents,
      cost_confidence: r.cost_confidence,
      source: r.source,
      url: r.url,
    },
    listing_count: r.listing_count,
    price_spread_cents: r.price_spread_cents,
    days_listed: r.days_listed,
    price_change_pct: r.price_change_pct,
    thumbnail: fillThumb(r.thumb_template),
    status: r.status ?? null,
    status_actor: r.status_actor ?? null,
    status_visit_at: r.status_visit_at ?? null,
    status_amount_cents: r.status_amount_cents ?? null,
    status_note: r.status_note ?? null,
  }));

  const last = rows[rows.length - 1];
  const next_cursor =
    rows.length === limit && (sort === "total_asc" || sort === "newest")
      ? btoa(JSON.stringify([sort === "total_asc" ? last.total_monthly_cents : last.first_seen, last.id]))
      : null;

  return c.json({ units, next_cursor, total_matching: rows[0]?.total_matching ?? 0 });
});

app.get("/api/units/:id", async (c) => {
  const sql = db(c);
  const id = c.req.param("id");
  const [unit] = await sql`
    SELECT u.*, s.status, s.actor AS status_actor, s.visit_at AS status_visit_at,
      s.amount_cents AS status_amount_cents, s.note AS status_note
    FROM units u
    LEFT JOIN LATERAL (
      SELECT status, actor, visit_at, amount_cents, note FROM status_events
      WHERE unit_id = u.id ORDER BY id DESC LIMIT 1
    ) s ON true
    WHERE u.id = ${id}`;
  if (!unit) return c.json({ error: "not found" }, 404);

  const listings = await sql`
    SELECT id, source, source_listing_id, url, rent_cents, condo_cents,
      iptu_monthly_cents, insurance_cents, service_fee_cents, total_monthly_cents,
      cost_confidence, bedrooms, suites, bathrooms, parking_spots, area_m2, floor,
      accepts_pets, pets_evidence, furnished, advertiser,
      first_seen_at, last_seen_at, delisted_at,
      raw->'medias' AS medias
    FROM listings WHERE unit_id = ${id} ORDER BY total_monthly_cents ASC`;

  const history = await sql`
    SELECT ph.listing_id, ph.observed_at, ph.total_monthly_cents
    FROM price_history ph JOIN listings l ON l.id = ph.listing_id
    WHERE l.unit_id = ${id} ORDER BY ph.observed_at ASC`;

  return c.json({
    ...unit,
    listings: listings.map((l: any) => ({
      ...l,
      photos: (l.medias ?? [])
        .filter((m: any) => m?.type === "IMAGE")
        .slice(0, 20)
        .map((m: any) => fillThumb(m.url, "1024x683")),
      medias: undefined,
    })),
    price_history: history,
  });
});

const STATUSES = ["liked", "visit_booked", "proposal_made", "dismissed"];

app.put("/api/units/:id/status", async (c) => {
  const sql = db(c);
  const id = c.req.param("id");
  const actor = c.req.header("cf-access-authenticated-user-email") ?? null;
  const body = await c.req.json<{
    status: string | null;
    visit_at?: string | null;
    amount_cents?: number | null;
    note?: string | null;
  }>();
  if (body.status === null) {
    // undo: drop the latest event; the previous one (if any) becomes current again
    await sql`DELETE FROM status_events
      WHERE id = (SELECT max(id) FROM status_events WHERE unit_id = ${id})`;
    return c.json({ ok: true });
  }
  if (!STATUSES.includes(body.status)) return c.json({ error: "bad status" }, 400);
  if (body.status === "visit_booked" && !Date.parse(body.visit_at ?? ""))
    return c.json({ error: "visit_at required" }, 400);
  if (
    body.status === "proposal_made" &&
    (!Number.isInteger(body.amount_cents) || (body.amount_cents as number) <= 0)
  )
    return c.json({ error: "amount_cents required" }, 400);
  await sql`INSERT INTO status_events (unit_id, status, actor, visit_at, amount_cents, note)
    VALUES (${id}, ${body.status}, ${actor}, ${body.visit_at ?? null},
            ${body.amount_cents ?? null}, ${body.note ?? null})`;
  return c.json({ ok: true });
});

app.get("/api/neighborhoods", async (c) => {
  const sql = db(c);
  const rows = await sql`
    SELECT u.neighborhood, count(DISTINCT u.id)::int AS units
    FROM units u JOIN listings l ON l.unit_id = u.id AND l.delisted_at IS NULL
    GROUP BY u.neighborhood ORDER BY units DESC`;
  return c.json(rows);
});

export default app;
