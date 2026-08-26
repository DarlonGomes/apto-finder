// One query shape for two drivers. Neon's HTTP driver in production (fast,
// no TCP handshake per request); node-postgres over TCP anywhere else, which
// is how `wrangler dev` talks to a local Postgres. Both expose the same
// surface the routes use: a tagged template and .query(text, params), each
// resolving to the rows.

import { neon } from "@neondatabase/serverless";
import pg from "pg";

export type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]>;
  query(text: string, params?: unknown[]): Promise<any[]>;
};

export function makeSql(url: string, driver = url.includes("neon.tech") ? "neon" : "pg"): Sql {
  if (driver === "neon") return neon(url) as unknown as Sql;
  // ponytail: a Client per call, closed after. Hyperdrive if this ever hurts.
  const run = async (text: string, params: unknown[] = []) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query(text, params)).rows;
    } finally {
      await client.end();
    }
  };
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    run(strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), ""), values)) as Sql;
  tag.query = run;
  return tag;
}
