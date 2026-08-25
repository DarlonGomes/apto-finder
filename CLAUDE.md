# apto-finder

Rio rental aggregator (personal, 2 users). Spec in PRD.md.

**Start every session by reading `docs/STATUS.md`** — current state, deploy flow, verified Glue API facts, and environment gotchas live there.

Hard rules:
- pnpm only, never npm. Node 22 (`PATH="$HOME/.nvm/versions/node/v22.18.0/bin:$PATH"` — shell default is v20).
- Work on the `dev` branch; merging/pushing `main` auto-deploys via Cloudflare Workers Builds.
- Money is integer BRL cents everywhere. Never floats.
- Collector HTTP goes through curl, not fetch (Node's TLS fingerprint gets 403'd by the Glue API).
