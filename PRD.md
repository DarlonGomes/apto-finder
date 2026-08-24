# PRD — Rio Rental Aggregator

**Status:** Draft v1
**Owner:** Darlon
**Type:** Personal tool (single user)

---

## 1. Problem

Finding an apartment to rent in Rio requires checking five or more portals, each with a different filter set, none of which filter on the number that actually matters: **total monthly cost**. Rent is the headline; condomínio in Rio swings between R$400 and R$2,500 and routinely doubles the real cost of a "cheap" listing. IPTU, seguro incêndio, and taxa de serviço add more.

Worse, the same physical apartment appears on three portals and under four different imobiliárias, often at different prices. There is no way to tell you've already seen and rejected a unit, and no way to know a listing has been sitting unrented for 90 days with two price cuts.

## 2. Goals

1. **One search across all sources**, filtered by total monthly cost.
2. **Deduplicate to the physical unit**, showing all offers for it and the cheapest.
3. **Triage state** — mark a unit as shortlisted, dismissed, or contacted, and never see dismissed units again.
4. **Price history** — surface how long a unit has been listed and whether the price has dropped.
5. **Usable on a phone**, one-handed, on mobile data, while standing outside a building.

## 3. Non-goals

- Multi-user accounts, sharing, or collaboration.
- Any city other than Rio de Janeiro.
- Sale listings. Rentals only.
- Real-time data. Hourly freshness is more than enough.
- Public availability. This is a private tool behind auth.
- Contacting brokers in-app. Deep-link out to the source listing.

## 4. Sources

Seven portals, but corporate consolidation means far fewer real backends.

| Source | Backend | Priority | Notes |
|---|---|---|---|
| VivaReal | Glue API | **P0** | Highest volume |
| ZAP Imóveis | Glue API (`x-domain` swap) | **P0** | Same call, different header |
| OLX Imóveis | Glue API / OLX API | P1 | Heavy overlap with above |
| QuintoAndar | Internal JSON search API | **P0** | Best data quality; already computes a total |
| Imovelweb | Legacy Navent stack | P2 | Moderate Rio inventory |
| Loft | — | P3 | Mostly sales, thin on Rio rentals |
| Chaves na Mão | — | P3 | Small inventory |

**v1 ships with VivaReal + ZAP + QuintoAndar.** That's roughly 85% of real Rio rental inventory. Everything else is additive.

---

## 5. Architecture

The system splits along one hard constraint.

```
  OFF-CLOUDFLARE                    CLOUDFLARE
  ┌──────────────────┐              ┌────────────────────────┐
  │  Collectors      │              │  Worker                │
  │  (cron, Node)    │─── writes ──▶│  ├── /api/*  (Hono)    │
  │                  │              │  └── static assets     │
  │  glue.ts         │              │        (React SPA)     │
  │  quintoandar.ts  │              └───────────┬────────────┘
  │  normalize.ts    │                          │
  │  dedupe.ts       │              ┌───────────▼────────────┐
  └────────┬─────────┘              │  Cloudflare Access     │
           │                        │  (email OTP, 1 user)   │
           │                        └────────────────────────┘
           └──── Neon Postgres ◀───────────────┘
                 (HTTP driver)
```

### 5.1 Why collectors are not on Cloudflare

Workers egress from Cloudflare's own datacenter IP ranges. The Glue API sits behind Cloudflare. Requests from Workers to Cloudflare-protected origins get challenged within a handful of calls, and Workers also have CPU-time limits and no persistent cookie jar. This is not a tuning problem; it's structural.

**Collector host, in order of preference:**

1. **An always-on machine at home** — residential Brazilian IP, which is exactly what these portals expect. A Raspberry Pi or an old laptop with a systemd timer. Free, most reliable.
2. **A small VPS in São Paulo** (Oracle free tier, Contabo, Hostinger BR) — datacenter IP, so expect more challenges, but latency to the origins is low.
3. **GitHub Actions cron** — free and zero-maintenance, but Azure datacenter IPs are the most likely to be blocked. Acceptable as a fallback only.

The collector needs nothing from Cloudflare. It talks to Neon over HTTP and exits.

### 5.2 Storage

**Neon Postgres.** Reasons: `jsonb` for raw payloads, arrays for photo hashes, generated columns for total cost, PostGIS if geo queries get serious, and the HTTP serverless driver works cleanly from Workers without connection pooling headaches.

Compute behaves as near-fixed overhead rather than per-query cost, so the hourly collector waking the database is the main driver — budget for it as effectively always-on rather than as scale-to-zero.

**Alternative considered: D1.** Cloudflare-native, free, no cold-start. Rejected for v1 because it's SQLite — no arrays, no real JSONB, no geo functions — which makes the dedup pipeline meaningfully harder. Revisit if Neon costs become annoying.

---

## 6. Data model

```sql
CREATE TABLE units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- resolved best guess across all listings in the cluster
  neighborhood    text NOT NULL,
  street          text,
  lat             double precision,
  lng             double precision,
  bedrooms        smallint,
  area_m2         smallint,
  parking_spots   smallint,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE listings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id               uuid REFERENCES units(id),

  source                text NOT NULL,       -- vivareal | zap | olx | quintoandar
  source_listing_id     text NOT NULL,
  url                   text NOT NULL,

  -- money: always monthly, always BRL cents, always integers
  rent_cents            integer NOT NULL,
  condo_cents           integer,
  iptu_monthly_cents    integer,
  insurance_cents       integer,
  service_fee_cents     integer,
  total_monthly_cents   integer GENERATED ALWAYS AS (
    rent_cents
    + COALESCE(condo_cents, 0)
    + COALESCE(iptu_monthly_cents, 0)
    + COALESCE(insurance_cents, 0)
    + COALESCE(service_fee_cents, 0)
  ) STORED,
  cost_confidence       text NOT NULL,       -- complete | partial

  bedrooms              smallint,
  suites                smallint,
  bathrooms             smallint,
  parking_spots         smallint,
  area_m2               smallint,
  floor                 smallint,

  neighborhood          text,
  street                text,
  lat                   double precision,
  lng                   double precision,
  geohash               text,

  accepts_pets          boolean,             -- NULL = unknown, and that matters
  pets_evidence         text,                -- 'amenity' | 'description' | NULL
  furnished             text,                -- none | partial | full

  photo_hashes          bigint[],
  advertiser            text,

  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  delisted_at           timestamptz,
  raw                   jsonb NOT NULL,

  UNIQUE (source, source_listing_id)
);

CREATE TABLE price_history (
  listing_id            uuid REFERENCES listings(id),
  observed_at           timestamptz NOT NULL DEFAULT now(),
  total_monthly_cents   integer NOT NULL,
  PRIMARY KEY (listing_id, observed_at)
);

CREATE TABLE unit_status (
  unit_id     uuid PRIMARY KEY REFERENCES units(id),
  status      text NOT NULL,     -- shortlisted | dismissed | contacted | visited
  note        text,
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX ON listings (total_monthly_cents) WHERE delisted_at IS NULL;
CREATE INDEX ON listings (neighborhood, bedrooms) WHERE delisted_at IS NULL;
CREATE INDEX ON listings (geohash);
CREATE INDEX ON listings (unit_id);
```

### Design decisions worth defending

**Money is integer cents, never floats.** Non-negotiable.

**`cost_confidence` is a first-class field.** A listing missing `condo_cents` is not cheap — it is unknown. It must never sort above a fully-specified listing at the same price. The UI distinguishes them visually and the default sort demotes `partial`.

**`accepts_pets` is nullable, not boolean-default-false.** Pet policy is usually free text. Treating unknown as "no" hides most of the market. `pets_evidence` records how we know, so the UI can show a confident badge versus a hedged one.

**`raw` is retained forever.** Undocumented APIs change their contract without notice. Reparsing from stored JSON beats recrawling.

**Never hard-delete.** Set `delisted_at`. A unit disappearing is signal.

---

## 7. Ingestion pipeline

Runs hourly. Four stages, each independently re-runnable.

### 7.1 Collect

The pagination cap is the defining constraint. Every portal limits deep pagination to roughly 2,000 results. A query for "Rio de Janeiro, aluguel, apartamento" returns far more, so you silently only ever see the first slice.

**Partition strategy:**

```
for each neighborhood in RIO_NEIGHBORHOODS:
    for each price_band in [0-2k, 2-3k, 3-4k, 4-6k, 6-10k, 10k+]:
        fetch partition
        if totalCount >= CAP:
            split price_band in half, recurse
```

Log any partition that still exceeds the cap after splitting — that's a coverage gap you need to know about.

Rate limit: 1 request per 1.5s, sequential, single connection. There is no reason to go fast. A full Rio sweep at this rate is roughly 20–40 minutes, which is fine for an hourly job.

### 7.2 Normalize

Per-source adapters producing a single shape:

- Reconcile the Glue `pricingInfos[]` array — it carries rental, condomínio, and IPTU as parallel entries, with IPTU arriving sometimes annual and sometimes monthly. Divide annual by 12 at this stage, never later.
- QuintoAndar's displayed total already bundles seguro incêndio and taxa de serviço. Decompose it so the fields mean the same thing across sources.
- Extract pet policy: check structured amenities first, fall back to regex over title and description, set `pets_evidence` accordingly.
- Compute perceptual hashes for the first 5 photos.

### 7.3 Deduplicate

Two-phase, run after each collection.

**Block** — candidates share a 6-character geohash prefix (~1km), the same `bedrooms`, and `area_m2` within ±3.

**Score** within each block:

| Signal | Weight | Notes |
|---|---|---|
| Photo pHash Hamming distance ≤ 8 | 0.5 | Strongest signal by far — brokers upload identical image sets to every portal |
| `total_monthly_cents` within 5% | 0.2 | |
| Same `parking_spots` | 0.1 | |
| Same `floor` | 0.1 | |
| Street name fuzzy match | 0.1 | Many listings deliberately fuzz the address |

Score ≥ 0.7 clusters into the same `unit_id`.

**Group, never delete.** The UI shows "Same apartment — 4 listings, cheapest R$3,200/mo." Seeing one unit offered at four prices by four agencies is genuinely useful.

### 7.4 Diff

Append to `price_history` when total changes. Set `delisted_at` when a listing disappears from two consecutive sweeps (one absence may be a transient error).

---

## 8. API

Hono on Workers. Neon HTTP driver. All responses JSON.

### `GET /api/units`

The one endpoint that matters.

| Param | Type | Default | Notes |
|---|---|---|---|
| `total_max` | int (cents) | — | Filters on the cheapest listing in the cluster |
| `total_min` | int (cents) | — | |
| `bedrooms_min` | int | 1 | |
| `parking_min` | int | 0 | |
| `area_min` | int | — | m² |
| `pets` | enum | `unknown_ok` | `required` \| `unknown_ok` \| `any` |
| `neighborhoods` | csv | all | |
| `furnished` | csv | all | |
| `cost_confidence` | enum | `any` | `complete` restricts to fully-priced listings |
| `status` | csv | excludes `dismissed` | |
| `sort` | enum | `total_asc` | `total_asc` \| `price_per_m2` \| `newest` \| `biggest_drop` |
| `cursor` | string | — | Keyset pagination, not offset |
| `limit` | int | 30 | Max 100 |

Response:

```jsonc
{
  "units": [{
    "id": "...",
    "neighborhood": "Botafogo",
    "street": "Rua Voluntários da Pátria",
    "bedrooms": 2, "area_m2": 68, "parking_spots": 1,
    "accepts_pets": true, "pets_evidence": "amenity",
    "cheapest": {
      "total_monthly_cents": 320000,
      "rent_cents": 240000,
      "condo_cents": 65000,
      "iptu_monthly_cents": 15000,
      "cost_confidence": "complete",
      "source": "vivareal",
      "url": "https://..."
    },
    "listing_count": 4,
    "price_spread_cents": 45000,   // cheapest vs dearest offer for the same unit
    "days_listed": 62,
    "price_change_pct": -8.5,
    "thumbnail": "https://...",
    "status": null
  }],
  "next_cursor": "...",
  "total_matching": 247
}
```

`price_spread_cents` and `days_listed` are negotiating leverage. They're the reason to build this rather than use QuintoAndar.

### Other endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/units/:id` | Full detail — all listings, price history series, all photos |
| `PUT /api/units/:id/status` | `{status, note}`. Idempotent. |
| `GET /api/neighborhoods` | List with live counts, for the filter sheet |
| `GET /api/meta` | Last successful sweep time, listing count, coverage gaps |

### Caching

`GET /api/units` responses go through the Workers Cache API keyed on the normalized query string, 5-minute TTL. Data only changes hourly, so this makes repeat filter tweaks instant. Purge on sweep completion via a webhook from the collector. Status mutations bypass cache entirely.

---

## 9. SPA

### 9.1 Principle

This is a **triage tool**, not a browsing experience. The job is to burn through 200 units and end with 8 worth visiting. Every design decision serves throughput.

Portals are optimized to keep you looking. This should be optimized to let you stop.

### 9.2 Design direction

The subject is money you'll pay every month for two years. The interface should feel like a spreadsheet that respects you, not a marketplace selling to you.

**Tokens**

```
--ink:        #14181C   /* near-black, cool */
--paper:      #FAFAF7   /* warm off-white */
--rule:       #E2E2DC   /* hairlines */
--muted:      #6B7280
--flag:       #B4472C   /* price drop / long-listed — used sparingly */
--good:       #2F6B4F   /* confirmed pet-friendly, complete pricing */
```

**Type**

- Numbers: a tabular-figure face. Prices are the content; they must align vertically down the card list so you can scan a column of totals without reading.
- Body/UI: one clean grotesque. System stack is fine — this loads on mobile data.
- No display face. There's no hero here.

**Signature element:** the **cost bar** on each card — a single horizontal rule split proportionally into rent / condomínio / IPTU / other, with the total as a tabular number above it. Two apartments at R$3,200 look identical on any portal; here you see instantly that one is R$2,900 rent + R$300 condo and the other is R$2,100 + R$1,100. That comparison is the entire product, so it gets the visual weight and everything else stays quiet. Where pricing is incomplete, the bar renders with a hatched unknown segment rather than pretending.

### 9.3 Screens

**Results (default)**

- Sticky header: result count, active-filter chips, sort control.
- Card list, virtualized. Each card: thumbnail, neighborhood + street, total as tabular figures, cost bar, then a metadata row (`2 quartos · 68m² · 1 vaga · aceita pet`).
- Flags only when true: `4 anúncios · menor preço`, `-8% em 30 dias`, `62 dias no ar`.
- Swipe left dismisses. Swipe right shortlists. Undo toast for 5 seconds. This is the primary interaction — it's why the tool exists.

**Filter sheet**

Bottom sheet, thumb-reachable. Total cost is a dual-handle slider at the top, largest control on screen. Everything else below it. Live result count on the apply button (`Ver 247 imóveis`) so you never apply a filter blind. Filters persist to localStorage and to the URL.

**Detail**

Photo carousel, full cost breakdown as a table, price history sparkline, then every listing for the unit with its price and an outbound link. No contact form — deep-link to the source.

**Map (secondary)**

Pins clustered by neighborhood, labeled with the median total. Tap to filter down to that area. Lazy-loaded; not on the critical path.

**Empty and error states**

- No results: name which filter is doing the damage. "No 2-bedroom under R$3,000 in Ipanema. 34 match under R$4,000."
- Stale data: a thin banner with the last sweep time. Never a spinner over old data — show the old data and say when it's from.

### 9.4 Technical

- **React + Vite + TypeScript.** Tailwind for styling.
- **TanStack Query** for fetching, with `keepPreviousData` so filter changes don't blank the list.
- **Optimistic status mutations** — swiping must feel instant regardless of network.
- **PWA manifest + service worker.** Installable to the home screen, last result set cached for offline viewing. This is what makes it feel like an app rather than a website.
- **URL is the state.** Filters serialize to query params so a search is shareable and back-button works.

Performance budget: under 150KB JS gzipped, first contentful paint under 1.5s on 4G. You will open this on a Rio street with two bars of signal.

---

## 10. Deployment

Single Worker serving both the API and the static assets.

```
wrangler.toml
├── [assets]           → SPA build output
├── [[routes]]         → /api/* handled by Worker, everything else static
└── [vars]/secrets     → DATABASE_URL
```

**Auth: Cloudflare Access** in front of the whole origin, email OTP, one allowed address. Free at this scale, no auth code to write, and it works on mobile. The tool is private by default.

**Collector → DB:** the collector writes directly to Neon. It never talks to the Worker except for a single cache-purge webhook on sweep completion, authenticated with a shared secret.

**Cron Triggers** on the Worker handle *maintenance* only — marking stale listings delisted, compacting price history. Not collection.

---

## 11. Milestones

| # | Deliverable | Done when |
|---|---|---|
| 0 | Glue API spike | Field shape known, pagination cap confirmed, pricing completeness measured |
| 1 | Schema + Glue collector | One neighborhood ingesting hourly with correct totals |
| 2 | Full Rio partitioned sweep | Every partition under the cap, coverage gaps logged |
| 3 | QuintoAndar adapter | Two sources normalized to one shape |
| 4 | Dedup pipeline | Cross-portal duplicates collapsing; spot-check 20 clusters by hand |
| 5 | API on Workers | `GET /api/units` behind Access, filters working |
| 6 | SPA v1 | Results list, filter sheet, swipe triage, installed on phone |
| 7 | Detail + history | Price sparkline, all offers per unit |
| 8 | Daily digest | New matches + price drops, pushed somewhere you actually read |

Milestone 6 is the point where the tool becomes useful. Everything after it is refinement.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Glue contract changes | `raw` jsonb retained; adapters isolated; shape-drift alert when field presence shifts >10% between sweeps |
| Collector IP blocked | Residential host first; exponential backoff; alert on sustained 403 rate |
| Dedup false positives merge distinct units | Threshold tuned conservatively — prefer showing duplicates over hiding a unit; manual unmerge action |
| Condomínio missing at high rates | `cost_confidence` surfaced in UI; if >50% partial, fall back to enriching from the detail page for shortlisted units only |
| Pagination gap silently loses inventory | Coverage gaps logged per sweep and shown in `/api/meta` |

## 13. Open questions

1. Is condomínio present often enough on Glue listings for total-cost filtering to be the default, or does it need per-listing detail fetches for anything shortlisted? **Milestone 0 answers this.**
2. Do ZAP and VivaReal share a listing ID for the same ad? If so, cross-portal dedup for those two is trivial and photo hashing is only needed for cross-*advertiser* duplicates.
3. Which neighborhoods are actually in scope? A tighter list makes the partitioning problem much smaller.
4. Where should the daily digest land — email, Telegram, WhatsApp?

---

## 14. Scope discipline

The failure mode for a project like this is building a portal. It is not a portal. It is a filter with memory.

If a feature doesn't help you reject a unit faster or spot a good one sooner, it doesn't go in.
