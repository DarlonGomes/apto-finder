# apto-finder

Rio rental aggregator. Private single-user tool. Full spec in [PRD.md](PRD.md).

## Layout

```
apps/web        React + Vite + Tailwind SPA
apps/worker     Hono on Cloudflare Workers, serves /api/* and the SPA build
apps/collector  Node cron job, runs OFF Cloudflare (see PRD 5.1), writes to Neon
packages/shared Types shared by all three
db/migrations   Plain SQL, applied with psql
```

## Setup

```sh
pnpm install
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
echo 'DATABASE_URL=...' > apps/worker/.dev.vars
```

## Dev

```sh
pnpm dev:worker   # API on :8787
pnpm dev:web      # SPA on :5173, proxies /api to :8787
DATABASE_URL=... pnpm dev:collector
```

## Deploy

```sh
pnpm deploy       # builds SPA, deploys Worker with assets
```

One Worker serves everything on Cloudflare. The collector deploys separately (systemd timer on an always-on machine, or VPS cron).
