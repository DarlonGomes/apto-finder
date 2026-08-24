import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";

type Bindings = {
  DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/meta", async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  const rows = await sql`
    SELECT
      count(*) FILTER (WHERE delisted_at IS NULL)::int AS active_listings,
      max(last_seen_at) AS last_sweep_at
    FROM listings
  `;
  return c.json(rows[0]);
});

// ponytail: stubs until milestone 5; shapes are in @apto/shared
app.get("/api/units", (c) => c.json({ error: "not implemented" }, 501));
app.get("/api/units/:id", (c) => c.json({ error: "not implemented" }, 501));
app.put("/api/units/:id/status", (c) => c.json({ error: "not implemented" }, 501));
app.get("/api/neighborhoods", (c) => c.json({ error: "not implemented" }, 501));

export default app;
