# Project status

Rio rental aggregator for two users (Darlon + Amanda). Full spec: [PRD.md](../PRD.md). This file is the session pick-up point: read it, then continue from "Next up".

Last updated: 2026-08-25.

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
| 3 | QuintoAndar adapter | DONE. 63 listings on first sweep. API facts below. |
| 4 | Dedup pipeline | DONE (no photo downloads needed, see below). First run merged 8 clusters, all hand-checked true positives. Cards show one outbound link per source on deduped units. |
| 5 | API on Workers | DONE (all endpoints, keyset cursor on total_asc/newest only). |
| 6 | SPA v1 | DONE (list, cost bar + legend, filter sheet/modal, swipe triage, PWA). Status v2: append-only `status_events` (liked / visit_booked / proposal_made / dismissed) with actor from the `Cf-Access-Authenticated-User-Email` header; current status = latest event, undo deletes it. visit_booked carries `visit_at`, proposal_made carries `amount_cents` + optional `note` (inline forms on the card). Old `unit_status` table: migration `0004_drop_unit_status.sql` applied (confirmed 2026-08-25, migrate run skipped it as already done). |
| 7 | Detail + price history | DONE. Full-screen overlay on a `?unit=` URL param (back button closes, link shareable): photo carousel (scroll-snap, all offers' photos deduped by CDN path), cost table, per-listing price sparkline (inline SVG), every offer with outbound link. Opens from the card thumbnail or address line. |
| 9 | Compare view (not in PRD) | DONE (2026-08-25). `?view=compare` overlay (⚖️ header button): all liked/visit_booked/proposal_made units as a matrix, attributes as rows, sticky label column, best-value cells in green. Spec: docs/superpowers/specs/2026-08-25-compare-view-design.md. New: `unit_notes` table (migration 0005, APPLIED), one shared note per unit, `PUT /api/units/:id/note` (empty note deletes), textarea saves on blur. `/api/units` gained `bathrooms`, `liked_by` (all actors who ever liked), `note`. Dedupe folds loser notes into the canonical unit before deleting losers. Notes are also editable on the detail screen (`NoteField`, exported from Compare.tsx; `/api/units/:id` returns `note`). |
| 10 | Liked units that change or disappear | DONE (2026-08-25). `/api/units` keeps liked/visit_booked/proposal_made units visible after every listing delists (cheapest CTE falls back to the cheapest delisted listing, `delisted_at` set on the unit, `listing_count` 0); everything else still needs an active listing. `last_change` (most recent price move of the cheapest listing, from price_history lag) is returned for all units. Card flags "saiu do ar em DD/MM" and, on liked+ units, "↓ R$ X em DD/MM" when the move is under 7 days old; Compare header shows "saiu do ar". `first_seen`/days_listed now span delisted siblings too. |
| 8 | Daily digest | PARKED (2026-08-25, deliberate). While the hunt is active the app covers it. If it goes passive, build the narrow version: Worker cron emails ONLY when a liked/visit_booked unit drops price or delists (+ new-match count), via the `send_email` binding on the tiersfc.com zone (Email Routing, both household emails as verified destinations). No generic daily email: at current volume it would mostly say "nothing happened". |

Dedup (apps/collector/src/dedupe.ts, runs at the end of each sweep): PRD 7.3 weights, but the photo signal is Glue media content-hash overlap. resizedimgs URLs are content-addressed (`vr-listing/{md5}/`), so identical uploads share hashes and NO images are ever downloaded, and no perceptual hashing exists. Same source + same raw `sourceId` (Glue's own cross-advertiser unit id, verified reliable) is an instant match. QuintoAndar photographs its own units, so QA/Glue photo matches are impossible even with pHash; cross-source pairs top out at 0.5 and never merge. Clusters re-point `unit_id` to the earliest-seen member's unit (stable across re-runs), statuses move with it, orphaned seed units are deleted. Dry-run spot-check: `node --env-file=../../.env --import tsx src/report-dedupe.ts` (read-only). No unmerge action yet; threshold is conservative.

Delisting: DONE, at the end of each successful collector sweep (not the PRD's Worker cron, which could mass-delist while the collector is down). Listings in swept neighborhoods with `last_seen_at` older than 2h15m get `delisted_at`; reappearance clears it in the upsert. Skipped when a sweep saves nothing.

Also TODO: PRD's 5-min Workers Cache API on /api/units (skipped, TanStack caches client-side).

## Sweep criteria (apps/collector/src/index.ts)

2+ quartos, 2+ banheiros, 1+ vaga, total R$3.000-6.000 (Barra da Tijuca padded to 7.000, marked `ponytail:` validation-only), drops explicit no-pets and DAILY (temporada) listings. Neighborhoods (accents REQUIRED by the API): Tijuca, Grajaú, Vila Isabel, Andaraí, Barra da Tijuca, Botafogo, Gávea, Catete (stands in for Largo do Machado, which isn't in Glue's taxonomy), Flamengo, Humaitá, Lagoa. Override via `NEIGHBORHOODS` env.

QuintoAndar runs in the same sweep after Glue: one Rio-wide map-bounds fetch (its API has no neighborhood param), cheapest-first, stops paging past the largest cap; hits are matched to the neighborhood list accent-folded (its `neighbourhood` is free text: "Grajau", trailing spaces) and stored under our canonical spelling. "Largo do Machado" is in scope for QuintoAndar only.

Hourly sweep runs via systemd user timer `apto-sweep.timer` (SET UP AND ACTIVE since 2026-08-25). Units in `~/.config/systemd/user/`, `Persistent=true` catches up after sleep, lingering enabled, logs append to `~/apto-sweep.log`. Note it must run with cwd `apps/collector` (tsx does not resolve from the repo root). Check: `systemctl --user list-timers apto-sweep.timer`.

## Glue API facts (spike findings, verified)

- `https://glue-api.vivareal.com/v2/listings` with `x-domain: www.vivareal.com.br`. `includeFields` is REQUIRED (400 without).
- Node fetch gets a Cloudflare 403 (TLS fingerprint); curl with browser headers passes. Collector shells out to curl.
- Limits: `size` max 30, `from + size` max 1500. Filters `bedrooms`/`bathrooms`/`parkingSpaces` are exact-match lists ("2 or more" = `2,3,...,8`). `priceMax` filters rent only.
- Money: strings in whole reais. IPTU sometimes YEARLY (divide by 12 in normalize). `rentalInfo.period` DAILY = temporada, reject.
- Listing URL: `https://www.vivareal.com.br/imovel/id-{id}/`. Images: fill template with `action=crop`, `dimension=WxH`, `description=foto`; the CDN 403s foreign referrers, SPA sends no referrer (meta tag).
- One backend serves OLX+VIVAREAL+ZAP (`portals` field); we store source `vivareal`.

## QuintoAndar API facts (spike findings 2026-08-25, verified)

- `GET https://www.quintoandar.com.br/api/yellow-pages/v2/search`, plain browser UA via curl works. `return` (field list) is REQUIRED (400 without); unknown requested fields are silently dropped.
- Geo is `map[bounds_north/south/east/west]` only, no neighborhood/city param. `neighbourhood` in results is free text (spelling drift), `city` present.
- Filters: `min_bedrooms`, `min_bathrooms`, `parking_spaces` mean "N or more"; `house_type=Apartamento` exact; `business_context=RENT`. NO price filter (`cost_range` 500s). Extra params are rejected by name, which makes probing easy.
- `sorting[criteria]=total_cost&sorting[order]=asc` + `page_size` (100 ok) + `offset`; ES-shaped response (`hits.hits[]._source`, `hits.total.value`). Deep offsets fine (ES 10k window, far above our volume).
- Money in reais. `totalCost` is the bundled monthly total; `iptu` and `homeInsurance` itemized, `iptuPlusCondominium` is a lump (condo = lump - iptu); taxa de serviço is never itemized, it's the remainder to totalCost.
- Pets amenity: `PODE_TER_ANIMAIS_DE_ESTIMACAO`. Furnished: `isFurnished` boolean.
- Listing URL `https://www.quintoandar.com.br/imovel/{id}` (301s to slugged URL). Images `https://www.quintoandar.com.br/img/xlg/{imageList entry}`.

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
