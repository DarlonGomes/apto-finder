import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { buildDigest } from "./digest";

type Bindings = {
  DATABASE_URL?: string;
  DATABASE_URL_POOLED?: string;
  EMAIL?: SendEmail;
  DIGEST_TO?: string; // comma-separated verified destination addresses
  DIGEST_FROM?: string;
  APP_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const db = (c: { env: Bindings }) => neon((c.env.DATABASE_URL ?? c.env.DATABASE_URL_POOLED)!);

const fillThumb = (t: string | null | undefined, dim = "360x240"): string | null =>
  t
    ? t.replace("{description}", "foto").replace("{action}", "crop").replace("{width}x{height}", dim)
    : null;

// QuintoAndar raw has an imageList of bare filenames; med ~20KB, xlg for detail.
const qaImg = (f: string, size = "med") => `https://www.quintoandar.com.br/img/${size}/${f}`;

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
  // Liked+ units stay visible after every listing delists (disappearing is signal);
  // anything else must have an active listing.
  const where: string[] = [
    "(l.delisted_at IS NULL OR s.status IN ('liked','visit_booked','proposal_made'))",
  ];
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
  if (q.sources) {
    // Match our source column (quintoandar) or the Glue portals array (OLX/ZAP/VIVAREAL share one backend)
    const list = q.sources.split(",");
    params.push(list, list.map((s) => s.toUpperCase()));
    where.push(
      `(c.source = ANY($${params.length - 1}) OR c.raw->'listing'->'portals' ?| $${params.length})`,
    );
  }
  if (q.furnished) add("c.furnished = ANY(?)", q.furnished.split(","));
  if (q.cost_confidence === "complete") where.push("c.cost_confidence = 'complete'");

  const pets = q.pets ?? "unknown_ok";
  if (pets === "required") where.push("c.accepts_pets IS TRUE");
  else if (pets === "unknown_ok") where.push("c.accepts_pets IS DISTINCT FROM FALSE");

  // "both" is virtual: liked by both household members and not since dismissed
  if (q.status === "both")
    where.push("array_length(lb.liked_by, 1) >= 2 AND s.status <> 'dismissed'");
  else if (q.status) add("s.status = ANY(?)", q.status.split(","));
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
      -- cheapest active listing; falls back to the cheapest delisted one when
      -- the whole unit is off the market (then c/l.delisted_at is set)
      SELECT DISTINCT ON (unit_id) *
      FROM listings WHERE unit_id IS NOT NULL
      ORDER BY unit_id, (delisted_at IS NOT NULL), total_monthly_cents ASC
    ), agg AS (
      SELECT unit_id,
             count(*) FILTER (WHERE delisted_at IS NULL)::int AS listing_count,
             (max(total_monthly_cents) FILTER (WHERE delisted_at IS NULL)
              - min(total_monthly_cents) FILTER (WHERE delisted_at IS NULL))::int AS price_spread_cents,
             min(first_seen_at) AS first_seen,
             jsonb_agg(jsonb_build_object(
               'source', source, 'url', url, 'total_monthly_cents', total_monthly_cents
             ) ORDER BY total_monthly_cents) FILTER (WHERE delisted_at IS NULL) AS links
      FROM listings GROUP BY unit_id
    )
    SELECT u.id, u.neighborhood, u.street,
      c.bedrooms, c.bathrooms, c.area_m2, c.parking_spots, c.accepts_pets, c.pets_evidence,
      c.lat, c.lng,
      c.total_monthly_cents, c.rent_cents, c.condo_cents, c.iptu_monthly_cents,
      c.insurance_cents, c.service_fee_cents, c.cost_confidence, c.source, c.url,
      a.listing_count, a.price_spread_cents, a.first_seen,
      GREATEST(0, EXTRACT(day FROM now() - a.first_seen))::int AS days_listed,
      (SELECT round(100.0 * (c.total_monthly_cents - f.t) / f.t, 1)::float
       FROM (SELECT total_monthly_cents AS t FROM price_history
             WHERE listing_id = c.id ORDER BY observed_at ASC LIMIT 1) f
       WHERE f.t <> c.total_monthly_cents) AS price_change_pct,
      c.raw->'medias'->0->>'url' AS thumb_template,
      c.raw->'imageList'->>0 AS qa_image,
      a.links,
      s.status, s.actor AS status_actor, s.visit_at AS status_visit_at,
      s.amount_cents AS status_amount_cents, s.note AS status_note,
      lb.liked_by, n.note AS unit_note,
      l.delisted_at,
      (SELECT jsonb_build_object('at', ph.observed_at, 'from_cents', ph.prev)
       FROM (SELECT observed_at, total_monthly_cents,
                    lag(total_monthly_cents) OVER (ORDER BY observed_at) AS prev
             FROM price_history WHERE listing_id = c.id) ph
       WHERE ph.prev IS NOT NULL AND ph.prev <> ph.total_monthly_cents
       ORDER BY ph.observed_at DESC LIMIT 1) AS last_change,
      count(*) OVER ()::int AS total_matching
    FROM cheapest c
    JOIN listings l ON l.id = c.id
    JOIN units u ON u.id = c.unit_id
    JOIN agg a ON a.unit_id = c.unit_id
    LEFT JOIN LATERAL (
      SELECT status, actor, visit_at, amount_cents, note FROM status_events
      WHERE unit_id = u.id ORDER BY id DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT actor) AS liked_by FROM status_events
      WHERE unit_id = u.id AND status = 'liked' AND actor IS NOT NULL
    ) lb ON true
    LEFT JOIN unit_notes n ON n.unit_id = u.id
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
    bathrooms: r.bathrooms,
    area_m2: r.area_m2,
    lat: r.lat,
    lng: r.lng,
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
    links: r.links ?? [],
    price_spread_cents: r.price_spread_cents ?? 0,
    days_listed: r.days_listed,
    price_change_pct: r.price_change_pct,
    thumbnail: r.qa_image ? qaImg(r.qa_image) : fillThumb(r.thumb_template),
    status: r.status ?? null,
    status_actor: r.status_actor ?? null,
    status_visit_at: r.status_visit_at ?? null,
    status_amount_cents: r.status_amount_cents ?? null,
    status_note: r.status_note ?? null,
    liked_by: r.liked_by ?? [],
    note: r.unit_note ?? null,
    delisted_at: r.delisted_at ?? null,
    last_change: r.last_change ?? null,
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
      s.amount_cents AS status_amount_cents, s.note AS status_note, n.note
    FROM units u
    LEFT JOIN LATERAL (
      SELECT status, actor, visit_at, amount_cents, note FROM status_events
      WHERE unit_id = u.id ORDER BY id DESC LIMIT 1
    ) s ON true
    LEFT JOIN unit_notes n ON n.unit_id = u.id
    WHERE u.id = ${id}`;
  if (!unit) return c.json({ error: "not found" }, 404);

  const listings = await sql`
    SELECT id, source, source_listing_id, url, rent_cents, condo_cents,
      iptu_monthly_cents, insurance_cents, service_fee_cents, total_monthly_cents,
      cost_confidence, bedrooms, suites, bathrooms, parking_spots, area_m2, floor,
      accepts_pets, pets_evidence, furnished, advertiser, lat, lng,
      first_seen_at, last_seen_at, delisted_at,
      raw->'medias' AS medias, raw->'imageList' AS image_list
    FROM listings WHERE unit_id = ${id} ORDER BY total_monthly_cents ASC`;

  const history = await sql`
    SELECT ph.listing_id, ph.observed_at, ph.total_monthly_cents
    FROM price_history ph JOIN listings l ON l.id = ph.listing_id
    WHERE l.unit_id = ${id} ORDER BY ph.observed_at ASC`;

  return c.json({
    ...unit,
    listings: listings.map((l: any) => ({
      ...l,
      photos: l.image_list
        ? l.image_list.slice(0, 20).map((f: string) => qaImg(f, "xlg"))
        : (l.medias ?? [])
            .filter((m: any) => m?.type === "IMAGE")
            .slice(0, 20)
            .map((m: any) => fillThumb(m.url, "1024x683")),
      medias: undefined,
      image_list: undefined,
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

// One shared free-text note per unit (compare view). Empty note deletes the row.
app.put("/api/units/:id/note", async (c) => {
  const sql = db(c);
  const id = c.req.param("id");
  const actor = c.req.header("cf-access-authenticated-user-email") ?? null;
  const body = await c.req.json<{ note?: unknown }>();
  if (typeof body.note !== "string") return c.json({ error: "note required" }, 400);
  if (body.note.trim() === "") {
    await sql`DELETE FROM unit_notes WHERE unit_id = ${id}`;
  } else {
    await sql`INSERT INTO unit_notes (unit_id, note, actor, updated_at)
      VALUES (${id}, ${body.note}, ${actor}, now())
      ON CONFLICT (unit_id) DO UPDATE
      SET note = EXCLUDED.note, actor = EXCLUDED.actor, updated_at = now()`;
  }
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

// Digest: GET /api/digest previews the email (or "nada mudou"); ?send=1 sends it now.
// The daily cron below calls the same thing.
async function runDigest(env: Bindings, send: boolean, hours = 25, test = false): Promise<string> {
  const sql = neon((env.DATABASE_URL ?? env.DATABASE_URL_POOLED)!);
  let mail = await buildDigest(sql, env.APP_URL ?? "https://apto-finder.gomesdarlon.workers.dev", hours);
  // ?test=1: prove delivery works even when nothing changed
  if (!mail && test)
    mail = {
      subject: "apto-finder: teste de envio",
      text: `Nada mudou nos favoritos nas últimas ${hours}h, mas o envio funciona.\n${env.APP_URL ?? ""}\n`,
    };
  if (!mail) return "nada mudou nos favoritos";
  let report = "";
  if (send) {
    if (!env.EMAIL || !env.DIGEST_TO || !env.DIGEST_FROM) throw new Error("email binding/vars missing");
    // One send per recipient: an unverified destination must not block the other.
    const to = env.DIGEST_TO.split(",").map((t) => t.trim());
    const results = await Promise.allSettled(
      to.map((t) =>
        env.EMAIL!.send({
          from: { name: "apto-finder", email: env.DIGEST_FROM! },
          to: t,
          subject: mail.subject,
          text: mail.text,
        }),
      ),
    );
    report =
      results
        .map((r, i) => `${to[i]}: ${r.status === "fulfilled" ? "enviado" : String(r.reason)}`)
        .join("\n") + "\n\n";
  }
  return `${report}${mail.subject}\n\n${mail.text}`;
}

app.get("/api/digest", async (c) => {
  // ?hours= widens the preview window (max 30 days); handy for "what changed this week"
  const hours = Math.min(Number(c.req.query("hours") ?? 25) || 25, 24 * 30);
  const out = await runDigest(c.env, c.req.query("send") === "1", hours, c.req.query("test") === "1");
  return c.text(out);
});

export default {
  fetch: app.fetch,
  scheduled: (_ctrl: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(runDigest(env, true).then((r) => console.log("digest:", r.split("\n")[0])));
  },
};
