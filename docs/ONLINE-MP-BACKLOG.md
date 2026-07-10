# viota — Online Multiplayer UX/Gameplay Backlog

**Filed 2026-07-10** from a real 3-player online session (Vijay + 2 friends). These are viota
online-multiplayer bugs, triaged against the code with root causes located.

> **Does the VGames P1 push fix any of these?** **NO — none of them.** P1 is the accounts/identity
> backend (VGames Identity + the vjaipur flip). It deliberately did not touch viota's game Durable
> Object presence/AI-takeover logic, the seat/name display, `/my-games` resume, or any board UI. The
> P1 push neither fixes nor worsens anything below. These need their own work, tracked here.

All five are present identically on `main` and `how-to-play` (i.e. live on whatever is deployed) unless noted.

---

## P1 — AI takes over too fast (even when someone just switches screens) ★ highest priority
**Genuine server bug, not a config knob.** `armDisconnectCoverIfAbsent` (`packages/worker/src/do/presence.ts:87-98`)
computes the AI-cover deadline as `seat.last_seen_at + patience`. `last_seen_at` is the seat's **last
heartbeat**, and the client stops heartbeating entirely while the tab is backgrounded
(`packages/client/src/pages/OnlineGame.tsx:88-90`, heartbeat `setInterval` gated on
`document.visibilityState==='visible'`). So when a backgrounded player's turn comes up, the deadline
`last_seen_at + 60_000` is often **already in the past** → `rearmAlarm` (`do/timers.ts:88-95`) sets a
past-due DO alarm → Cloudflare fires it immediately → `autoCover` (`presence.ts:141`) covers with **~0s** of
the nominal 60s patience. Constants: `PRESENCE_MS=45_000`, `DEFAULT_AI_TAKEOVER_MS=60_000` (`do/constants.ts:10,31`).
- **Config vs code:** code bug (raising the patience constant reduces frequency but doesn't fix "zero patience once your turn starts").
- **Severity:** High — actively disrupts live games; veto only undoes a *trailing* run of AI moves, so it's not always recoverable.
- **Fix (S/M):** base the on-turn cover deadline off **when the seat became current-and-absent** (≈`now` at that moment), not off stale `last_seen_at`. The current use of `last_seen_at` was intentional for the "went dark mid-own-turn" case (docstring) — so track "turn-started-at" separately from "last-heard-from" and use the former for the on-turn window. Consider keeping a low-rate background heartbeat too.
- **P1 push fixes it?** No (server presence logic; P1 didn't touch it).

## P2 — Wrong/stale player names at the top ("Player 1 and Player 3", or "vijay, open and open")
**Two bugs, same root: the active-game `ClientView` carries no player-name roster** (`do/view.ts:18-29` — only
`WaitingRoomView` has `seats[].displayName`). Names online come from a one-time `sessionStorage` snapshot.
- **(a) "vijay, open, open" (host):** `createOnlineRoom` seeds the roster as `[you, 'Open', 'Open', …]`
  (`net/lobby.ts:80-100`) and `WaitingRoom.tsx` polls the live named seats into React state but **never
  `saveSession`s** them, so the stale placeholder array rides into the game and renders for the whole match.
- **(b) "Player 1 / Player 3" (resumed view):** `ResumeStrip.resumeOnline` fabricates `Player ${i+1}` for every
  non-you seat (`components/ResumeStrip.tsx:30-33`) because `GET /my-games` only knows *your* seat, not others' names.
- **Config vs code:** code.
- **Severity:** Medium — cosmetic but persistent + confusing in a friends game.
- **Fix (M):** expose a live name roster in `ClientView` (or a small parallel endpoint / nudge-socket payload) so names refresh from the server; quick partial win = have `WaitingRoom.tsx` `saveSession` the live roster before navigating into the game.
- **P1 push fixes it?** No.

## P3 — Clicking the invite link doesn't take you back after you close the game
Two failures: (1) `/lobby/:code` (`WaitingRoom.tsx`) requires a live `sessionStorage` session, which is
**cleared on tab close**, so reopening the link silently bounces to Home (`net/session.ts:19-27`); the room
`:code` in the URL is never used to resolve you back in. (2) Even a fixed client can't rejoin an **active**
game: `handleJoin` (`game-do.ts:633-641`) checks `meta.status !== 'waiting'` → `409 not_waiting` **before** the
idempotent "you already own a seat here" shortcut, so there is no path back into a started game by code. The
intended resume path today is `GET /my-games` → the Home page "Resume" strip (documented in `DEPLOY.md` step 7),
not the link.
- **Config vs code:** code (client routing/session + worker `handleJoin` ordering, or a new rejoin-by-code path).
- **Severity:** Medium-High — no state is lost (Home resume works), but "the link is dead" is bad UX and the exact friction hit.
- **Fix (M):** client — resolve `/lobby/:code` via durable identity regardless of `sessionStorage` (try a resume before join-new-seat); worker — reorder `handleJoin` so an already-seated account in an *active* game returns into it (route to `/game/online`, not the waiting room).
- **Note:** a **local, unpushed, unmerged** WIP branch `join-by-link` (built off `main`, not on any remote) adds a join-by-code card for the *waiting-room* case only — it does **not** fix active-game resume and hits the `handleJoin` ordering bug above. Surface it so it isn't forgotten, but it doesn't close this on its own.
- **P1 push fixes it?** No.

## P4 — No clear "whose turn is it" indicator
`turnIndex` is used only to enable/disable your own buttons (`OnlineGame.tsx:128`) and to gate wild-recycle
(`Board.tsx:140`); nothing renders whose turn it is. `TopBar.tsx` already has an unused `turnTimer` pill
mechanism (`TopBar.tsx:43-49`) that `OnlineGame.tsx` never feeds. Score pills highlight only *your own* score.
- **Config vs code:** code (new UI).
- **Severity:** Medium (worse with 3-4 players).
- **Fix (S):** highlight the current-turn player's pill / pass `turnIndex` + `players[turnIndex]` into `TopBar`. Cheap win; good to ship alongside P2.
- **P1 push fixes it?** No.

## P5 — Board "rotate" is unintuitive (expected it to flip cards face-down)
The ↺/↻ buttons rotate the **entire board viewport** 90° (`Board.tsx:94-100`, a CSS transform for a
shared-screen "spin the table" use), not any card. Iota has no "flip a placed card face-down" rule
(`ref/iota_rules.txt`); the one real card-orientation interaction is **wild-card recycle** (click a placed wild
on your turn — `Board.tsx:144-145`, `Cell.tsx:19-20`), which has **no icon/label/affordance** and is
undiscoverable. So this is a mental-model mismatch, not broken logic.
- **Config vs code:** design change (needs a brainstorm, not a patch).
- **Severity:** Low-Medium.
- **Fix (M):** relabel/tooltip "rotate" as "spin board"; give wild-recycle a real affordance. Bundle into a board-interaction UX pass.
- **P1 push fixes it?** No.

---

## Priority
1. **P1** (AI-takeover server bug — live, disruptive, small fix) — do first.
2. **P2** (names — confusing every game; `saveSession` quick win + the `ClientView` roster real fix).
3. **P3** (link resume — needs client + worker `handleJoin` change; partial WIP exists on `join-by-link`).
4. **P4** (turn indicator — cheap; ship with P2).
5. **P5** (rotate/board UX — needs a brainstorm; lowest urgency).

*(These are viota game-UX items, entirely separate from the VGames P1 accounts program on the `vgames-p1` branches.)*
