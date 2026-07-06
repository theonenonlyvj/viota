# Deploying viota online (Cloudflare, $0 tier)

A short, ordered checklist to run against **your** Cloudflare account. The
architecture: one **Durable Object per game** (the warm, single-writer engine)
behind a **Worker** HTTP API, a **D1** analytics/lobby archive, and the React
**client** on **Cloudflare Pages**. Client and Worker live on **different
origins** (`*.pages.dev` vs `*.workers.dev`) — CORS + `CLIENT_ORIGIN` handle that.

All `wrangler` commands run from **`packages/worker/`** (where `wrangler.toml`
lives) unless noted. Everything below is real; nothing here has been run for you.

---

## 0. Prerequisites (once)

```bash
npm i -g wrangler         # Cloudflare CLI (v4)
wrangler login            # opens a browser to authorize your Cloudflare account
node -v                   # need Node 18+; this repo uses pnpm workspaces
```

## 1. Create the D1 database and wire its id

```bash
cd packages/worker
wrangler d1 create viota
```

Copy the `database_id` it prints and **replace the placeholder** in
`packages/worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "viota"
database_id = "PASTE-THE-REAL-ID-HERE"   # was "local-dev-placeholder"
```

## 2. Apply the D1 schema

```bash
# from packages/worker/
wrangler d1 migrations apply viota --remote      # runs migrations/0001_init.sql
# — or the one-shot equivalent —
# wrangler d1 execute viota --remote --file=schema/d1.sql
```

## 3. Set the JWT secret (required — the Worker refuses to boot without it)

`JWT_SECRET` must be **32+ bytes** and not a known dev default, or every request
fail-closes with 503.

```bash
# from packages/worker/  — generates a strong secret and stores it (no echo):
openssl rand -base64 32 | wrangler secret put JWT_SECRET
# (or run `wrangler secret put JWT_SECRET` and paste a 32+ byte random when prompted)
```

## 4. Deploy the Worker → note its URL

```bash
# from packages/worker/
wrangler deploy
```

Note the printed URL, e.g. **`https://viota-worker.<your-subdomain>.workers.dev`**.
Call this `<WORKER_URL>`.

## 5. Build the client against `<WORKER_URL>` and deploy to Pages → note its URL

The client bakes the API origin in at **build time** from `VITE_SERVER_URL`.

```bash
# from the repo root
VITE_SERVER_URL=<WORKER_URL> pnpm --filter @viota/client build
wrangler pages deploy packages/client/dist --project-name viota
```

Note the **production** Pages URL, e.g. **`https://viota.pages.dev`**. Call this
`<PAGES_URL>`. (Pages also prints a per-deploy preview URL; use the canonical
production one you'll actually share.)

## 6. Pin CORS: set the Worker's `CLIENT_ORIGIN` to `<PAGES_URL>`

Until this is set, CORS falls back to `*` (works, but unpinned). Set it to the
**exact** Pages origin (scheme + host, **no trailing slash**):

```bash
# from packages/worker/
echo -n "<PAGES_URL>" | wrangler secret put CLIENT_ORIGIN     # e.g. https://viota.pages.dev
```

No Worker redeploy is needed — a secret update takes effect on the next request.
(If you later put the site on a custom domain, update `CLIENT_ORIGIN` to match.)

## 7. Smoke test (the real thing, on two devices)

1. Open `<PAGES_URL>` on **two phones** (or two browsers / an incognito window).
2. Phone A (the **host**): enter a display name → **Create room** (multiplayer,
   2 players). Pick an **AI-takeover** patience (30s / 1 min default / 2 min /
   5 min / "Wait for me") — this is how long a *disconnected* on-turn seat waits
   before a medium AI covers it. Note the 6-character room **code**.
3. Phone B: enter a name → **Join by code** → type A's code.
4. **Only the host (Phone A) sees Start** — Phone B shows "Waiting for host to
   start…". Phone A: **Start** (if any seat is still open, it confirms the seat
   will be AI-filled first). Both phones should see the dealt board, each with
   only its own hand.
5. Play a few moves back and forth — moves should land on both phones within a
   second (WebSocket nudge; HTTP is the source of truth).
6. Optional never-stall check: background Phone B **on its turn** — after the
   host's chosen patience (default ~1 min; "Wait for me" = never) its seat is
   covered by a medium AI and play continues. A *connected* player is never
   auto-covered. Foreground Phone B and it reclaims its seat (a **veto** on the
   tab lets it undo the AI's last turn).
7. Optional pause/resume check: fully close Phone B's tab mid-game, reopen
   `<PAGES_URL>`, same name → the home screen lists the game under **"Your saved
   games"**; tap it to drop straight back onto the live board. Games persist
   server-side (waiting rooms ~2h, in-progress ~7 days).

If step 5 shows CORS errors in the browser console, re-check that `CLIENT_ORIGIN`
(step 6, prior section) **exactly** equals the origin in the address bar.

---

## Cost & behavior notes ($0 at friends-game scale)

- **SQLite-backed Durable Objects are on the Workers Free plan** (this Worker
  uses `new_sqlite_classes`, not the paid KV-backed class).
- **~100,000 requests/day free** across Workers. Each move is a couple of small
  requests; a handful of friends is nowhere near the cap. On exhaustion, moves
  429/503 and the client's IndexedDB outbox holds + retries — the game **pauses**,
  never forfeits.
- **D1 free tier** easily covers the append-only move archive at this scale.
- **Warm-DO latency:** the first request to an idle game **cold-starts** its
  Durable Object (single-digit to low-tens of ms) — the DO then stays **warm**
  for the session, so subsequent moves are fast. A lost DO alarm is caught within
  ~60s by the cron sweep (`crons = ["* * * * *"]`).
- **CPU limits** only lower AI *quality* (medium cover is cheap; there is an O(1)
  pass floor that can't be CPU-killed). `$5/mo` Workers Paid is the named opt-in
  if AI strength ever matters more than `$0`.

## Redeploying / updating later

- **Worker code:** `cd packages/worker && wrangler deploy`.
- **Client:** rebuild with the same `VITE_SERVER_URL=<WORKER_URL>` and
  `wrangler pages deploy packages/client/dist --project-name viota`.
- **Schema change:** add `migrations/0002_*.sql` and
  `wrangler d1 migrations apply viota --remote`.
- **Rotate the JWT secret:** `wrangler secret put JWT_SECRET` (invalidates live
  tokens; players silently re-auth via their device credential).
