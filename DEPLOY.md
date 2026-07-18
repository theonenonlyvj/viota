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

`wrangler.toml` also has a SECOND `[[d1_databases]]` block, binding
`IDENTITY_DB`, with the SAME `database_id` (identity code/data split, Step 1
— two bindings, one DB, on purpose; see the block's own comment). Paste the
same real id there too — do not leave it on a stale/placeholder value.

## 2. Apply the D1 schema

```bash
# from packages/worker/
wrangler d1 migrations apply viota --remote      # runs 0001_init.sql + 0002_account_geo.sql
# — or the one-shot equivalent (full current schema in one file) —
# wrangler d1 execute viota --remote --file=schema/d1.sql
```

> **Migrations before code.** New Worker code may depend on new columns (e.g.
> `0002_account_geo` adds the `accounts.country/region/timezone` the signup
> INSERT writes). Always `wrangler d1 migrations apply` **before**
> `wrangler deploy` — deploying code first would make `/auth/quick` throw until
> the migration lands.

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
- **Schema change:** add `migrations/000N_*.sql` and
  `wrangler d1 migrations apply viota --remote` **before** `wrangler deploy`
  (code that reads a new column must not ship ahead of the column).
- **Rotate the JWT secret:** `wrangler secret put JWT_SECRET` (invalidates live
  tokens; players silently re-auth via their device credential). If the
  **VGames Identity service** is also deployed (next section), rotate JWT_SECRET
  on **BOTH** services together to the **same** value — they share one token
  audience, so a mismatch makes tokens minted by one fail on the other.

---

## VGames Identity service (`vgames-identity`)

A **second** Cloudflare Worker service, built from this same `packages/worker`
package, that serves **only** the VGames Identity surface — `/auth/quick`,
`/auth/set-credentials`, `/auth/login`, `/auth/introspect`,
`/admin/merge`, and `GET /health` (`{"service":"vgames-identity"}`). It has **no
Durable Object, no gameplay, no cron**; it reads/writes the accounts/devices
tables in the **same D1** as viota-worker. viota-worker keeps serving identity
too during the transition — both route through the one shared `routeIdentity`
(`src/identity/router.ts`), so they share **source**, not runtime. They are
two **separately deployed** services, so they drift by **deploy time**:
whichever was deployed most recently reflects the current code; the other
runs whatever was live at its last `wrangler deploy` until it gets one too.
(This actually happened 2026-07-16: `vgames-identity` picked up a
guest-name-reservation change that `viota-worker` didn't get until later.)

**`POST /claim` moved OFF the identity surface** (identity code/data split,
Step 2): it re-tags viota's OWN `game_players` (a game-domain op), so it now
lives in `src/index.ts`'s own routing on **viota-worker only** — `d1/claim.ts`
is no longer part of the shared `routeIdentity` router and is **not** served
by `vgames-identity`. The client still calls it on the game URL; no client
change. viota-worker also gained a second D1 binding, `IDENTITY_DB` (see
`wrangler.toml`), through which game code (stats routes, the merge
reconciler, `/claim`) reads identity data read-only — `vgames-identity`
itself is unaffected (its own `DB` binding already IS the identity data).

**Deploy-both rule:** any change touching `packages/worker/src/identity/`,
`src/d1/accounts.ts`, `src/d1/devices.ts`, `src/jwt.ts`, `src/cors.ts`, or
`src/auth.ts` must be deployed to **both** `viota-worker` and
`vgames-identity` in the same session — leaving one behind means they share a
JWT secret/audience (tokens still interchange) but diverge in behavior until
the laggard catches up. `src/d1/claim.ts` and `src/do/reconcile.ts` are
viota-worker-only now (not shared with `vgames-identity`) — see above.

Config: `packages/worker/wrangler.identity.toml` (entry `src/identity-entry.ts`,
same `[[d1_databases]]` block as `wrangler.toml`).

```bash
# from packages/worker/
wrangler deploy -c wrangler.identity.toml
```

**Secrets** (set per service — `-c wrangler.identity.toml`):

```bash
# from packages/worker/
openssl rand -base64 32 | wrangler secret put JWT_SECRET -c wrangler.identity.toml
echo -n "<PAGES_URL>"   | wrangler secret put CLIENT_ORIGIN -c wrangler.identity.toml   # optional; unset => CORS '*'
# ADMIN_JWT_SECRET only when an admin /merge is actually needed:
# wrangler secret put ADMIN_JWT_SECRET -c wrangler.identity.toml
```

- **`JWT_SECRET` MUST equal viota-worker's** so tokens are interchangeable across
  both services (a token minted by one must verify on the other). Unset, every
  request fail-closes with 503 (same guard as the main worker).
- **Rotating `JWT_SECRET` must be done on BOTH services together** to the same
  new value — players then silently re-auth via their device credential (same as
  a single-service rotation above). Rotating only one breaks token interchange.
- No D1 migration step is owned here — the schema lives with viota-worker; this
  service only reads/writes existing tables in the shared D1.
