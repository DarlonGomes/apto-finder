# Open-source prep

2026-08-26. Make apto-finder clonable and runnable by any developer with plain Postgres, keep Neon and Cloudflare as the deployment story only, and get personal data out of the tree. Publish as a NEW public repo with fresh history at the end (decision: option A), so nothing here rewrites this repo's history.

## 1. Database driver

- Collector, migrations, dedupe, report scripts: `pg` (node-postgres) instead of `@neondatabase/serverless`. Same `Client` API; `pg` also connects to Neon over TCP, so one code path serves local and production.
- Worker: `src/db.ts` adapter with the shape the code already uses (tagged template + `.query`, both resolving to rows). Neon HTTP driver when the URL host ends in `neon.tech` (or `DB_DRIVER=neon`), `pg` over TCP otherwise (local Postgres under `wrangler dev`). One `pg` Client per request, closed after. Compatibility date bumped so `nodejs_compat` is on by default.
- `docker-compose.yml` with Postgres 16 only. `.env.example`, `apps/worker/.dev.vars.example` pointing at `postgres://apto:apto@localhost:5432/apto`.

## 2. Sweep config

`apto.config.json` at the repo root (gitignored), `apto.config.example.json` committed with the Rio values and used as the fallback when the real file is missing:

```json
{
  "city": "Rio de Janeiro",
  "state": "Rio de Janeiro",
  "neighborhoods": ["Tijuca", "..."],
  "quintoandar": { "bounds": { "north": 0, "south": 0, "east": 0, "west": 0 }, "extraNeighborhoods": ["Largo do Machado"] },
  "totalMinCents": 300000,
  "totalMaxCents": 600000,
  "totalMaxOverrides": { "Barra da Tijuca": 700000 },
  "minBedrooms": 2,
  "minBathrooms": 2,
  "minParking": 1,
  "rejectNoPets": true
}
```

`glue.ts` and `quintoandar.ts` take city/state/bounds as parameters. No setup UI: sweep criteria change roughly never after day one and the audience is developers. Rentals only; sales stay a non-goal.

## 3. Personal data out

- Display names derived from the email local part, optional `VITE_PEOPLE="email=Name,..."` build env for overrides.
- Digest recipients and sender become Worker secrets (`DIGEST_TO`, `DIGEST_FROM`); the `send_email` binding loses its allowlist (it can only reach verified destinations anyway). Cron is a no-op when the binding or secrets are missing.
- Emails, Access/zone/build-trigger ids, DB hosts move from STATUS.md to gitignored `docs/private/ops.md`.
- Station list stays a Rio file; README documents the Overpass queries to regenerate for another city. UI hides the transport line when the list is empty.

## 4. README, LICENSE, publish

README: the story (total monthly cost, content-hash dedup with zero downloads, curl vs TLS fingerprint, Workers + Postgres for near-zero cost), local quickstart, deploy guide (Neon, Workers Builds, Access, Email Routing), architecture diagram, screenshots (list, compare, map), scope notes (Rio-tested, rentals only). MIT. Sanitizer pass, then a fresh public repo.

## Verification

Each step: `pnpm -r typecheck`, web build, local end-to-end against docker Postgres (migrate, sweep, `wrangler dev`, API smoke), and the production path (collector migrate no-op against Neon with `pg`, deployed worker still serving). Merged to main after each step.
