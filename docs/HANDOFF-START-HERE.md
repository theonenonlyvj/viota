# viota technical handoff

This is the viota-specific technical entry point. For shared VGames identity
architecture and operations, read the sibling platform repository's
`docs/handoff/START_HERE.md`.

## Repository shape

- `packages/engine/` contains the certified rules and AI engine. Treat it as
  locked unless a separately reviewed engine change is explicitly authorized.
- `packages/worker/` contains the Cloudflare Worker, one SQLite-backed Durable
  Object per online game, the D1 archive/statistics paths, and local JWT
  verification.
- `packages/client/` contains the React/Vite client for local play, online play,
  practice, leaderboards, account UI, and resume flows.
- `ref/` contains the rule references used to validate player-facing rules.

The online path is HTTP-first. WebSockets are a notification mechanism; HTTP
sync remains authoritative. The client receives its own hand, opponent hand
counts, and the public board. Do not weaken that redaction boundary or add
optimistic online board mutations.

## Identity boundary

The standalone identity service lives in the sibling platform repository at
`services/identity/`. The client targets that service for account operations;
viota-worker verifies compatible tokens locally and reads its `IDENTITY_DB`
binding under a read-only discipline enforced by tests. Token claim changes
therefore require coordinated consumer-contract tests.

`packages/worker/wrangler.toml` still defines an `IDENTITY_SVC` binding for the
legacy grace proxy. Treat the checked-in worker routes and tests as the source
of truth before changing or removing it.

## Invariants

- Do not edit `packages/engine/` or the locked card renderer
  `packages/client/src/components/Card.tsx` during ordinary UI or documentation
  work.
- Apply D1 migrations before deploying code that depends on them.
- Never commit secrets or plaintext passwords. Production secrets belong in
  Cloudflare's secret store, not `[vars]`.
- Keep local and online play working, including reconnect, resume,
  AI-cover/reclaim, veto, and pending/reconcile behavior.
- Keep identity writes in the identity service; viota's `IDENTITY_DB` access is
  read-only.

## Current documentation

- [`FRONTEND-REDESIGN-HANDOFF.md`](FRONTEND-REDESIGN-HANDOFF.md) describes the
  current client surface and UI constraints.
- [`HOW-TO-PLAY-PRACTICE-HANDOFF.md`](HOW-TO-PLAY-PRACTICE-HANDOFF.md) covers
  the shipped rules, settings, and practice slice plus deferred work.
- [`FRONTEND-REDESIGN-BACKLOG.md`](FRONTEND-REDESIGN-BACKLOG.md) is the UI
  backlog; validate every item against current code before treating it as open.
- [`ONLINE-MP-BACKLOG.md`](ONLINE-MP-BACKLOG.md) and
  [`PRESSURE-TEST-shipped-fixes.md`](PRESSURE-TEST-shipped-fixes.md) record
  historical multiplayer findings and the validation checklist for their fixes.
- [`../DEPLOY.md`](../DEPLOY.md) is the deployment guide.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` are historical design
  and implementation records, not current-state declarations.

## Verification

Run from the repository root:

```bash
pnpm test
pnpm build
```

For a narrower change, use the package-scoped commands documented in each
package's `package.json`, then run the full gates before release.
