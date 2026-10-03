# viota frontend handoff

This document describes the current client architecture. Earlier redesign
plans under `docs/superpowers/` are historical records; verify their claims
against the code before using them as backlog.

## Client stack and routes

The client is a React 18, Vite 5, React Router 6, and Zustand application in
`packages/client/`. `src/main.tsx` defines these routes:

| Route | Surface |
|---|---|
| `/` | Landing, account access, and resumable games |
| `/lobby` | Create or join an online room |
| `/lobby/:code` | Resolve an invite and show the waiting room |
| `/practice` | Rules-driven practice puzzles |
| `/leaderboard` | Public leaderboards |
| `/stats` | Current account statistics |
| `/game/local` | Local game against the client-side AI |
| `/game/online` | Authoritative online game view |

Shared chrome and design tokens live in `src/theme.css` and `src/theme/`.
Reusable UI lives in `src/components/`; route composition lives in
`src/pages/`. The code already includes the aurora theme, shared buttons,
modals, pills, settings, how-to-play content, account UI, and resume UI.

## Correctness boundaries

- `packages/engine/` is the rules source of truth. The client submits intents;
  it does not reimplement legality or scoring.
- `src/components/Card.tsx` is a locked visual primitive. Build around it.
- Online state is HTTP-first. The nudge socket prompts sync but is not an
  authoritative transport.
- The online view may render `myHand`, public board cards, opponent hand counts,
  draw-pile count, scores, and turn state. It must not infer or expose opponent
  cards.
- `src/store/gameStore.ts` intentionally avoids optimistic online board
  mutation. Preserve pending, reconcile, reconnect, AI-cover/reclaim, and veto
  flows.
- Local and online modes share presentation components but have different state
  authority. Test both when changing shared UI.

## Relevant source areas

- `src/components/Board.tsx`, `Cell.tsx`, `Hand.tsx`, and `TopBar.tsx` render the
  game surface.
- `src/pages/Game.tsx` and `OnlineGame.tsx` compose local and online play.
- `src/net/` owns identity, HTTP, lobby, sync, outbox, IndexedDB, and WebSocket
  notification behavior.
- `src/rules/content.tsx` is the player-facing rules source.
- `src/practice/` contains practice puzzle definitions and validation.
- `src/hooks/useLocalResumableGame.ts` owns local-game resume discovery.

## Rules-facing UI constraints

- Pass/trade preserves player-selected bottom-of-deck order.
- Three consecutive all-pass rounds end the game by score.
- A wild starter is reshuffled and replaced.
- Ties remain ties unless an agreed follow-on rule is implemented separately.
- Multiple wild recycles may occur in one turn.
- AI takeover uses the room's configured patience; connected players are not
  auto-covered for thinking time.
- Only the host starts an online room, and at least two human seats are
  required.

The checked-in engine and `ref/` rule sources resolve any ambiguity.

## Develop and verify

Run from the repository root:

```bash
pnpm --filter @viota/client dev
pnpm --filter @viota/client test
pnpm --filter @viota/client build
```

Use `VITE_SERVER_URL=http://localhost:8787` when pairing the client with a local
worker. Omitting it uses the configured production fallback.

Client deployment is a direct Cloudflare Pages upload, not a Git-triggered
deployment. See the repository-root `DEPLOY.md` for the full command, Worker
ordering, and secret handling. Do not deploy from this handoff alone.

## Backlog pointers

- `FRONTEND-REDESIGN-BACKLOG.md` tracks UI follow-ups.
- `HOW-TO-PLAY-PRACTICE-HANDOFF.md` tracks deferred resign and practice options.
- `ONLINE-MP-BACKLOG.md` is a historical root-cause record for shipped online
  fixes.

Re-check every backlog claim against the current source and tests before
starting implementation.
