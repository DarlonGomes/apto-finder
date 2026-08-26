// Minimal migration runner: applies db/migrations/*.sql in filename order,
// tracks applied files in _migrations. Run: pnpm --filter collector migrate
// ponytail: no down migrations, no checksums; add a tool if this ever hurts.

import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL ??
  process.env.DATABASE_URL_POOLED;
if (!url) {
  console.error("no DATABASE_URL(_UNPOOLED/_POOLED) set");
  process.exit(1);
}

const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  const { rows } = await client.query("SELECT name FROM _migrations");
  const done = new Set(rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) {
      console.log(`skip  ${f}`);
      continue;
    }
    const sql = await readFile(`${dir}${f}`, "utf8");
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [f]);
    console.log(`apply ${f}`);
  }
} finally {
  await client.end();
}
