# Pressure-test checklist — the 4 shipped online-MP fixes (2026-07-10, live)

All four are **live on `viota.pages.dev`**. These fixes are about multi-player/multi-device behavior, so
they need **real multi-client testing** (like the 3-player session that surfaced them) — a single browser
tab won't exercise them. Use **2–3 devices or browser profiles** (separate profiles = separate identities).

Mark each ✅/❌ and note anything weird; ❌ items come back to me.

---

## Fix #1 — AI-takeover no longer fires when you just switch screens
*Root cause was a server bug: the takeover clock was measured from your last heartbeat, and heartbeats stop
when the tab is backgrounded, so the window was often already expired when your turn arrived. Now it starts a
full patience window (default 60s) from when your turn actually begins.*

- [ ] 3-player game. When it's about to be **your** turn, **switch to another app / background the tab** for ~30–40s, then come back. Expect: the AI did **NOT** take your turn; you resume and play normally.
- [ ] Background the tab **for longer than the patience** (default 60s) on your turn. Expect: the AI **does** eventually cover you (liveness preserved — it shouldn't hang the game forever), and when you return you can **reclaim / veto** the AI's move.
- [ ] A player who is **actively looking at the game** (foreground, just thinking) is **never** replaced, no matter how long they take.
- [ ] Sanity: a player who truly **closes** the tab and doesn't come back → the AI covers them so the game continues.
- Note the *feel*: is 60s the right patience, or should it be longer (e.g. 90–120s) for a casual friends game? (It's host-configurable per room — 30s/60s/2m/5m/"wait for me" — tell me if the default should change.)

## Fix #2 — real player names at the top (no more "Open, Open" / "Player 3")
*The game now pulls the seat roster from the server, not a stale one-time snapshot.*

- [ ] **Host** a room, have friends join. Before AND after they join, check the top bar: it should show **real display names** for filled seats (not "Open" placeholders, not "Player 2/3").
- [ ] After the game **starts**, names still correct for the whole game (including the Game Over screen).
- [ ] **Resume path:** one player **closes their tab mid-game and comes back** (via Home "resume" or the link). Their top bar shows the **real** names of the others — not fabricated "Player N".
- [ ] 4-player game: all four names correct for everyone.

## Fix #3 — the invite link takes you back into an *active* game
*Previously, closing the tab lost your session and the link bounced you Home / said "room full". Now an owner
re-entering resolves back into the live game.*

- [ ] Mid-active-game, **fully close your tab**, then **click the invite link** again (fresh tab). Expect: you land **back in the live game** in your seat, not the waiting room, not an error.
- [ ] Same but via the **"Join a room" code field** on the Lobby (re-type the code). Expect: it resumes you into the game (this path used to crash — the review caught it; confirm it's smooth now).
- [ ] **Security:** a **non-owner** (someone not seated in that game) who clicks the link / enters the code of a **started** game is still **rejected** ("room is full or already started") — they can't observe or join.
- [ ] Resuming shows the correct board state (your hand, scores, whose turn).

## Fix #4 — it's clear whose turn it is
*The current player's pill is now highlighted.*

- [ ] In a 3–4 player game, the **current turn** player is visibly marked at the top, and the marker **moves** as turns rotate.
- [ ] When it's **your** turn, it's obvious (beyond just your buttons being enabled).
- [ ] Marker stays correct through passes/trades and after a resume.

---

## Setup tips
- Separate **browser profiles** (or incognito + normal + phone) each get their own device identity — good for simulating different players on one machine.
- To force turn-order scenarios quickly, a 2-player game is fastest for #1/#3/#4; use 3–4 players for #2 and the "someone backgrounds while others play" case in #1.
- If something's off, note: how many players, which browsers/devices, what you did, what you expected vs saw. That's enough for me to repro.

*(These four are viota game-UX; #5 "rotate should flip cards" is a separate board-interaction redesign, in brainstorm.)*
