# apto-finder

A rental aggregator for Rio de Janeiro that searches every major portal at once, filters on the number that actually matters (**total monthly cost**: rent + condomínio + IPTU + fees), collapses the same apartment listed by four agencies into one card, and remembers what you have already rejected. Built for a two-person apartment hunt; open-sourced because the moving parts (unofficial portal APIs, cross-portal dedup, near-zero hosting cost) are reusable.

> Portals are optimized to keep you looking. This is optimized to let you stop.

<!-- screenshots: docs/screenshots/list.png, compare.png, map.png -->

## What it does

- **One search across VivaReal, ZAP, OLX (one shared backend) and QuintoAndar**, hourly, filtered by total monthly cost. A listing with an unknown condomínio is flagged as *partial*, never treated as cheap.
- **Dedup to the physical unit.** Same apartment from several agencies becomes one card showing every offer and the cheapest. Photo matching uses the portal CDN's content-addressed URLs, so no image is ever downloaded.
- **Triage that sticks.** Swipe right to like, left to dismiss; dismissed units never come back. Liked units move through visit booked and proposal made, with who did what.
- **Price history and leverage.** Days on market, price drops, spread between agencies for the same unit.
- **Compare view.** Every shortlisted unit side by side, best value per row highlighted, shared notes.
- **Map** with every matching unit and the metro/BRT stations; nearest station distance on each card.
- **Digest.** A daily email only when a shortlisted unit dropped its price or left the market. Nothing changed, no email.
- **Phone first.** PWA, one-handed, works on two bars of signal outside the building.

The UI is in Portuguese (it is for renting in Brazil). Code and docs are in English.

## Architecture

```
  YOUR MACHINE / any box              CLOUDFLARE (or wrangler dev locally)
  ┌──────────────────────┐            ┌────────────────────────────┐
  │ Collector (Node, cron)│            │ Worker: Hono API + SPA     │
  │  glue.ts  quintoandar │─ writes ──▶│  /api/*  and static assets │
  │  normalize  dedupe    │            │  cron: digest email        │
  └──────────┬───────────┘            └──────────────┬─────────────┘
             │                                        │
             └────────────▶  Postgres  ◀──────────────┘
                     (local docker, or Neon in production)
```

- **The collector runs off Cloudflare on purpose.** The portal APIs sit behind bot protection that challenges datacenter IPs and rejects Node's TLS fingerprint outright, so requests go through `curl` from a residential IP. A Raspberry Pi or a laptop with a cron entry is the ideal host.
- **Postgres is the only shared state.** The Worker reads it, the collector writes it. Locally that is a container; in production it is Neon's free tier, reached through its HTTP driver from the Worker and plain TCP from the collector.
- **Money is integer BRL cents everywhere.** Never floats.

## Quickstart (local, 5 minutes)

Requirements: Node 22, pnpm, Docker (or any Postgres you already run).

```sh
pnpm install
docker compose up -d                          # Postgres 16 on :5432 (APTO_PG_PORT to change)
cp .env.example .env                          # DATABASE_URL for the collector
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm --filter collector migrate               # applies db/migrations/*.sql
pnpm --filter collector sweep                 # first collection, ~2-4 min for the default neighborhoods
pnpm dev:worker                               # API + built SPA on http://localhost:8787
```

For frontend work, `pnpm dev:web` runs Vite on :5173 with `/api` proxied to the worker. Run `pnpm --filter web build` before `pnpm dev:worker` if you want the worker to serve the SPA.

No auth locally: the app treats every request as an anonymous user. In production, Cloudflare Access supplies the user's email and the app uses it to record who liked what.

## Configuration: `apto.config.json`

Copy `apto.config.example.json` to `apto.config.json` (gitignored) and edit. Without the file, the example values are used.

| Key | Meaning |
|---|---|
| `city`, `state` | Passed to the Glue API as `addressCity` / `addressState`. |
| `neighborhoods` | Glue partitions. Spelling must match the portal's taxonomy, accents included (`Grajau` returns nothing, `Grajaú` works). |
| `quintoandar.bounds` | QuintoAndar has no neighborhood filter, only a map box. Use a generous box over the city; hits are matched to `neighborhoods` accent-insensitively. |
| `quintoandar.extraNeighborhoods` | Names QuintoAndar uses that Glue does not (Rio: Largo do Machado). |
| `totalMinCents`, `totalMaxCents` | Total monthly cost band. Listings above the max are dropped; below the min only when pricing is complete. |
| `totalMaxOverrides` | Per-neighborhood max, for pricier areas you still want to see. |
| `minBedrooms`, `minBathrooms`, `minParking` | "N or more". |
| `rejectNoPets` | Drop listings that explicitly refuse pets. Unknown is never treated as no. |

Rentals only, apartments only. Sales are a different product (different cost model, different dedup signals) and are out of scope.

### Other cities

Everything Rio-specific is data, not code: the config above and `apps/web/src/stations.ts` (metro and BRT stations from OpenStreetMap). The sweep should work for any Brazilian city both portals cover; only Rio has been tested. To regenerate the station list for another city, query Overpass with a bounding box:

```
node["railway"="station"]["station"="subway"](S,W,N,E);                      // metro
nw["network"~"BRT",i]["public_transport"="station"](S,W,N,E);              // BRT
```

An empty `STATIONS` array simply hides the transport line everywhere.

## Scheduling the collector

Hourly is plenty. Any scheduler works; the process must run with `apps/collector` as the working directory.

```
# crontab
0 * * * * cd /path/to/apto-finder/apps/collector && PATH=$HOME/.nvm/versions/node/v22.18.0/bin:$PATH pnpm sweep >> ~/apto-sweep.log 2>&1
```

A systemd user timer with `Persistent=true` is nicer on a laptop that sleeps. Delisting happens at the end of each successful sweep: listings not seen for two consecutive sweeps get `delisted_at`, and reappearance clears it. Nothing is ever hard-deleted.

## Deploying (Cloudflare Workers + Neon)

1. **Database.** Create a Neon project, run `DATABASE_URL=<neon url> pnpm --filter collector migrate`. Point your collector's `.env` at it.
2. **Worker.** In `apps/worker`: `wrangler secret put DATABASE_URL`. Deploy with `pnpm --filter web build && pnpm --filter worker exec wrangler deploy`, or connect the repo to Workers Builds (build command `pnpm install --frozen-lockfile && pnpm --filter web build`, deploy command `pnpm --filter worker exec wrangler deploy`, root `/`, Node 22 via `.nvmrc`). Set `VITE_PEOPLE` as a build variable if you want display names instead of email local parts.
3. **Auth.** Put the Worker behind Cloudflare Access (Zero Trust, free for up to 50 users) with a one-time-PIN policy listing the emails that may use it. The app reads `Cf-Access-Authenticated-User-Email` to attribute likes, visits and notes.
4. **Digest (optional).** Enable Email Routing on a zone you own, verify the recipient addresses, then `wrangler secret put DIGEST_TO` (comma-separated), `DIGEST_FROM` (an address on that zone), `APP_URL`. The cron in `wrangler.jsonc` runs daily at 08:00 BRT and sends only when a shortlisted unit changed. Preview with `GET /api/digest` (`?hours=720` widens the window, `&send=1` sends, `&test=1` sends a test message when nothing changed). Remove the `send_email` block from `wrangler.jsonc` if you do not want any of this.

Running cost for two users: Workers free tier, Neon free tier, Access free, Email Routing free. The collector runs on hardware you already own.

## Design notes worth stealing

- **`cost_confidence` is a first-class column.** A listing missing condomínio is not cheap, it is unknown. It sorts below complete listings at the same price and renders with a hatched segment in the cost bar.
- **`accepts_pets` is nullable, with `pets_evidence`.** Most pet policies are free text. Treating unknown as "no" hides half the market.
- **`raw` JSON is kept forever.** Undocumented APIs change without notice; reparsing beats recrawling.
- **Dedup without downloading images.** VivaReal's CDN URLs are content-addressed (`vr-listing/{md5}/`), so identical uploads share hashes across agencies. Two shared photos plus geo, bedrooms, area, price and street similarity score a match; the threshold is conservative and units are grouped, never deleted.
- **Statuses are append-only events.** Current status is the latest event; undo deletes it. Cheap, auditable, and it tells you who liked what.
- **Fixed 25-hour digest window, no bookkeeping.** A duplicate line on a slow day beats a missed one.

## Repository layout

```
apps/web         React + Vite + Tailwind SPA (PWA)
apps/worker      Hono on Cloudflare Workers: /api/*, static assets, digest cron
apps/collector   Node: portal clients, normalization, dedup, migrations
packages/shared  Types shared by all three
db/migrations    Plain SQL, applied in order by the migrate script
docs/            STATUS.md (living state of the project), PRD.md (original spec), design specs
```

`pnpm -r typecheck`, `pnpm --filter collector test`, `pnpm --filter web build`.

## Caveats

- The portal APIs are unofficial and undocumented. They can change or block you. Be polite: the collector does one request every 1.5 seconds, sequentially.
- QuintoAndar photographs its own units, so a QuintoAndar listing and the same apartment on VivaReal never merge (no shared photos). You may see a unit twice across those sources.
- Tested only for Rio de Janeiro rentals.

## License

MIT
