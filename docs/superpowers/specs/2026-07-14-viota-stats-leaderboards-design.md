# viota — Stats + Leaderboards (on VGames), with login adoption (Design Spec)

**Date:** 2026-07-14 · **Approved-in-principle by Vijay 2026-07-14 (this brainstorm).**
**Scope:** viota client + its Cloudflare worker/D1 (= the VGames D1). **Rules engine (`packages/engine`) untouched.**
No new database — everything lives in the shared VGames D1 built in P1.

## 1. Goal & locked decisions
Give viota players **personal stats** and a set of **small global leaderboards**, on the VGames D1. Because
meaningful stats need a stable identity, viota **adopts the (already-live) VGames login** in the same build.

Decisions from the brainstorm:
- **D1. Multiple small boards** side by side (not one ranking), so different play styles each get a board.
- **D2. All games count, tagged by trust.** Online games are server-authoritative (`source='online_authoritative'`);
  **local games are logged too** via a client-reported upload (`source='client_reported'`). Local-vs-AI and
  online-vs-AI are treated as one activity. The client-reported trust boundary is **accepted at friend-scale**
  (no cheating incentive), just **tagged** via `source` so it's separable later.
- **D3. Split by opponent: "vs Friends" (had ≥1 human opponent) vs "vs AI" (only AI opponents).** The ranked
  win-rate/streak boards are **vs Friends**; **vs AI** gets its own board. Flashy boards (best play / best game)
  span everything.
- **D4. Just add logging now** — do NOT converge the two vs-AI code paths (that's backlog #2, "online vs AI
  done right", a follow-up). Both paths simply log.
- **D5. Online-only-vs-friends caveat:** viota has no local human-vs-human that's networked; "vs Friends" games
  are inherently online (multiplayer DO games with ≥1 other human), so those are already server-authoritative.
  Client-reported games are therefore all **vs AI** — which keeps the forgeable ones off the human leaderboard.

## 2. Boards (v1)
A **Leaderboard** page with two contexts + a shared high-scores strip:
- **vs Friends** (server-authoritative only): **Win rate** (min-games floor, e.g. 5) · **Total wins** · **Longest win streak**.
- **vs AI**: **Win rate vs AI** (optionally split by difficulty) · **Total AI wins**.
- **High scores** (all games): **Best single play** (highest-scoring move — Iota's multiplier plays) · **Best single game** (high score).
- A **"Your stats"** personal page: your vs-Friends + vs-AI win rates, games, best play/game, current+longest
  streak, splits (2p/3p/4p; win-rate vs each AI difficulty), total time played, "player since," AI-takeover rate.

Identity display: claimed players by **username**; unclaimed ghosts by **display_name** + a small "guest" marker.

## 3. Data model (VGames D1 — additive)
The P1 columns already exist (`game_players.result`, `stats`, `ai_move_count`, `total_moves`; `games.source`).
This feature **populates** them and adds one classification field.

- **`game_players.result`** — `'win' | 'loss' | 'draw'`, written at game-end from `games.winner_seat`.
- **`game_players.opponent_kind`** *(NEW column, additive)* — `'human' | 'ai'`: `'human'` iff any OTHER seat in
  that game was human-owned; else `'ai'`. Stored so boards filter cheaply without re-deriving per query.
- **`game_players.stats`** — compact per-seat JSON, written at game-end:
  `{ points, bestPlay, plays, passes, wildsPlayed, wildsRecycled, lots, longestLine, cardsPlayed, moves, durationMs }`.
  (`bestPlay` = max single-move score; `lots` = # plays that completed a full 4-line; from the move log +
  engine score result.)
- **`games.source`** — already `'online_authoritative' | 'client_reported'`; local uploads set the latter.
- **Leaderboard reads** = queries/views over `game_players` filtered by `game_type='iota'`, `status='completed'`,
  `owner_type='human'`, and `opponent_kind`. Fix the existing `v_leaderboard` views to key off `result`
  (now populated) — or keep them and add board-specific queries in the endpoint. Cross-game `v_leaderboard_all`
  stays for the eventual viota+vjaipur board (post-P4).

## 4. Shared stats derivation (one function, two callers)
A **pure `computeSeatStats(initialState, moves, seat) -> SeatStats`** function (new shared module, e.g.
`packages/engine`-adjacent or a `packages/shared` — must NOT modify the certified engine; wrap/read it).
- **Server (online):** the DO archive calls it at game-end from the seat's move log → writes `result`/`stats`/`opponent_kind`.
- **Client (local):** `/game/local` completion calls the SAME function on its in-memory move log → uploads the result.
Identical derivation both sides = consistent stats regardless of path.

## 5. Endpoints (viota worker)
- **`POST /games/report`** *(NEW)* — client-reported local game. Body: game meta (players: `{seat, accountId|ghostId, ownerType, displayName}`),
  per-seat `{result, finalScore, stats}`, `initialState`+`moves` (or the derived stats only — see §7). Auth: the
  reporter's JWT; `source='client_reported'`; validates shape + that the reporter owns a seat. Writes `games`
  (game_type='iota', mode='local') + `game_players` rows.
- **`GET /leaderboard?game=iota&board=<winrate-friends|wins-friends|streak-friends|winrate-ai|wins-ai|bestplay|bestgame>`** *(NEW)* — returns the ranked rows for a board (paged, with the requester's own rank).
- **`GET /me/stats`** *(NEW, Bearer)* — the requester's personal stats (all the "Your stats" fields).
- Existing `/auth/*` endpoints (set-credentials, login, quick, introspect) are reused for login adoption — no new auth code.

## 6. Login adoption (client — build FIRST, it's the foundation)
Ghost stays the frictionless default. Add a **Profile/Account** UI over the live P1 endpoints:
- **Claim your name:** username + password → `POST /auth/set-credentials` (upgrades the current ghost in place,
  same account, keeps all games). Username `^[a-z0-9_]{3,20}$`, password 6..128.
- **Log in (another device):** username + password + this browser's device credential → `POST /auth/login`
  (binds this browser + folds this session's ghost games via the server-side merge).
- Surface identity in the header (your username / guest name) + a "claim to save across devices" nudge.
- `net/identity.ts` already does ghost/quick + `/claim`; add the set-credentials + login calls + the UI.

## 7. Backfill (one-time)
A script/endpoint that walks existing **online** archived games (`games` + `moves`) and populates
`result`/`opponent_kind`/`stats` for their `game_players` rows via `computeSeatStats`, so **history counts from
day one** and boards aren't empty. Idempotent (only fills nulls). (Local games have no history to backfill —
they were never uploaded.)

**Open impl choice for §5 upload:** upload the full `initialState`+`moves` (server re-derives via the same
function → identical to online, enables future replay) vs upload just the client-derived `stats` (less data,
but trusts the client's numbers). Lean: **upload initialState+moves** for a single derivation pipeline; it's
friend-scale data volume. Decide at plan time.

## 8. Build order
1. **Login adoption** (client UI over live endpoints) — the identity foundation.
2. **`computeSeatStats` shared fn** + wire the **DO archive** to populate `result`/`opponent_kind`/`stats` at game-end (+ the `opponent_kind` migration).
3. **Backfill** existing online games.
4. **`POST /games/report`** + wire `/game/local` completion to upload.
5. **`GET /leaderboard` + `GET /me/stats`** endpoints (+ view fixes).
6. **Client UI:** Leaderboard page (the boards, vs-Friends/vs-AI/high-scores) + "Your stats" page, Neon-Night styled.

## 9. Invariants / non-goals
- **Never modify `packages/engine`.** Redaction preserved (stats are post-game aggregates; no live hand leak).
- Additive D1 only (`opponent_kind` ADD COLUMN + populate; no drops).
- **Non-goals (follow-ups):** converging the vs-AI modes (backlog #2); Elo/skill rating; cross-game leaderboard
  UI (data's ready via `v_leaderboard_all`, but wait for vjaipur's P4 migration); real-time/live leaderboard.
- Friend-scale; boards paged but small.

## 10. Open questions for the plan
- §7 upload shape (moves vs stats-only) — lean moves.
- Exact min-games floor for win-rate boards (start 5).
- Whether "vs AI" win-rate splits by difficulty in v1 or just aggregate.
- Header identity + claim-nudge placement (small design pass during the UI task).
