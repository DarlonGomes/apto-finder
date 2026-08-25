# Project status

Rio rental aggregator for two users (Darlon + Amanda). Full spec: [PRD.md](../PRD.md). This file is the session pick-up point: read it, then continue from "Next up".

Last updated: 2026-08-24.

## Live

- App: https://apto-finder.gomesdarlon.workers.dev (SPA + API, one Worker)
- Auth: Cloudflare Access, one-time PIN. Policy "household" allows gomesdarlon@icloud.com and gomesamanda.stn@gmail.com. App id `eaa9413d-25a0-4a75-b2d4-3cd6cc238176`, policy id `8b16ea16-0d24-447f-84b6-c79b078c9eb3`, session 730h.
- DB: Neon Postgres (sa-east-1). Worker secret is named `DATABASE_URL_POOLED` (code accepts `DATABASE_URL` too). An `ACCESS_KEY` secret exists on the worker but nothing uses it yet (reserved for the collector cache-purge webhook).

## Deploy flow

Work on `dev`, merge to `main`, Cloudflare Workers Builds deploys automatically.
Build trigger (fixed by hand via API, id `fcf82d6d-7390-4974-87a9-174821cc2e32`):
root `/`, build `pnpm install --frozen-lockfile && pnpm --filter web build`, deploy `pnpm --filter worker exec wrangler deploy`, branch `main` only. Node 22 via `.nvmrc`.

## Milestones (PRD section 11)

| # | Deliverable | State |
|---|---|---|
| 0 | Glue API spike | DONE. Findings below. |
| 1 | Schema + Glue collector | DONE. 219 listings live. |
| 2 | Full Rio partitioned sweep | SKIPPED for now: fixed neighborhood list instead, all partitions far under the cap. |
| 3 | QuintoAndar adapter | TODO |
| 4 | Dedup pipeline | TODO. Until then each listing seeds its own unit (unit id = listing id). Glue's `sourceId` already clusters same-backend duplicates: use it before photo hashing. |
| 5 | API on Workers | DONE (all endpoints, keyset cursor on total_asc/newest only). |
| 6 | SPA v1 | DONE (list, cost bar + legend, filter sheet/modal, swipe triage, PWA). Status v2: append-only `status_events` (liked / visit_booked / proposal_made / dismissed) with actor from the `Cf-Access-Authenticated-User-Email` header; current status = latest event, undo deletes it. Old `unit_status` table is orphaned, drop in a future migration after main deploys. |
| 7 | Detail + price history | TODO (API endpoint exists, no screen). |
| 8 | Daily digest | TODO |

Also TODO: delisting maintenance (set `delisted_at` after 2 absent sweeps) via Worker cron trigger; PRD's 5-min Workers Cache API on /api/units (skipped, TanStack caches client-side).

## Sweep criteria (apps/collector/src/index.ts)

2+ quartos, 2+ banheiros, 1+ vaga, total R$3.000-6.000 (Barra da Tijuca padded to 7.000, marked `ponytail:` validation-only), drops explicit no-pets and DAILY (temporada) listings. Neighborhoods (accents REQUIRED by the API): Tijuca, Grajaú, Vila Isabel, Andaraí, Barra da Tijuca, Botafogo, Gávea, Catete (stands in for Largo do Machado, which isn't in Glue's taxonomy), Flamengo, Humaitá, Lagoa. Override via `NEIGHBORHOODS` env.

Hourly cron (user's machine, must be set manually):
`0 * * * * cd ~/Projects/apto-finder && ~/.nvm/versions/node/v22.18.0/bin/node --env-file=.env --import tsx apps/collector/src/index.ts >> ~/apto-sweep.log 2>&1`

## Glue API facts (spike findings, verified)

- `https://glue-api.vivareal.com/v2/listings` with `x-domain: www.vivareal.com.br`. `includeFields` is REQUIRED (400 without).
- Node fetch gets a Cloudflare 403 (TLS fingerprint); curl with browser headers passes. Collector shells out to curl.
- Limits: `size` max 30, `from + size` max 1500. Filters `bedrooms`/`bathrooms`/`parkingSpaces` are exact-match lists ("2 or more" = `2,3,...,8`). `priceMax` filters rent only.
- Money: strings in whole reais. IPTU sometimes YEARLY (divide by 12 in normalize). `rentalInfo.period` DAILY = temporada, reject.
- Listing URL: `https://www.vivareal.com.br/imovel/id-{id}/`. Images: fill template with `action=crop`, `dimension=WxH`, `description=foto`; the CDN 403s foreign referrers, SPA sends no referrer (meta tag).
- One backend serves OLX+VIVAREAL+ZAP (`portals` field); we store source `vivareal`.

## Environment gotchas

- pnpm ONLY (npm corrupts the workspace). pnpm 10 blocks postinstall: allowlist in root package.json `onlyBuiltDependencies`.
- Default shell node is v20; everything needs v22: prefix `PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"`.
- rtk aliases grep/cat/head; NEVER redirect their output to files (writes decorated text). Use node or Read/Write tools.
- `.env` at root: `DATABASE_URL_POOLED` + `DATABASE_URL_UNPOOLED` (no plain `DATABASE_URL`). `apps/worker/.dev.vars` has `DATABASE_URL=` for wrangler dev.
- Collector scripts load env via `node --env-file=../../.env`.

## Commands

- `pnpm --filter collector sweep | migrate | test | spike:glue`
- `pnpm dev:worker` (API+built SPA on :8787), `pnpm dev:web` (:5173, proxies /api)
- `pnpm -r typecheck`, `pnpm --filter web build`
- DB one-offs: `node --env-file=.env -e '...'` with `@neondatabase/serverless` from apps/collector/node_modules.
