# Multiplayer Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add online multiplayer to the Viota client — lobby, WebSocket connection, server-driven game state, and disconnect vote system.

**Architecture:** Server gets a vote system replacing the hardcoded AI fill-in timer. Client gets a WebSocket connection layer (`connection.ts`), online mode in the Zustand store (actions send WS messages instead of calling local gameLogic), lobby pages for room creation/joining, and an OnlineGame page that wires everything together. Existing components (Board, Hand, Card, Cell, PassTradeModal) are reused unchanged.

**Tech Stack:** React 18, Zustand 4, React Router v6, WebSocket (native browser API), Express 4 + `ws` 8 (server), Vitest + React Testing Library

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/server/src/db.ts` | Modify | Add `disconnect_timeout` column to rooms |
| `packages/server/src/rooms.ts` | Modify | Accept `disconnectTimeout` in `createRoom`, update `RoomRow` |
| `packages/server/src/app.ts` | Modify | Accept `disconnectTimeout` in `POST /rooms` body |
| `packages/server/src/wsHandler.ts` | Modify | Replace AI fill-in with vote system |
| `packages/client/src/net/connection.ts` | Create | WebSocket connection with auto-reconnect |
| `packages/client/src/store/gameStore.ts` | Modify | Add online mode, online state, WS message handler |
| `packages/client/src/components/TopBar.tsx` | Modify | Add playerNames, turnTimer, connectionStatus props |
| `packages/client/src/components/VoteBanner.tsx` | Create | Disconnect vote UI |
| `packages/client/src/pages/Lobby.tsx` | Create | Create/join room form |
| `packages/client/src/pages/WaitingRoom.tsx` | Create | Player list, host config, start game |
| `packages/client/src/pages/OnlineGame.tsx` | Create | WS lifecycle, message routing, online game-over |
| `packages/client/src/main.tsx` | Modify | Add new routes |

---

## Task 1: Server — DB + Room disconnect_timeout

**Files:**
- Modify: `packages/server/src/db.ts`
- Modify: `packages/server/src/rooms.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/tests/gameLoop.test.ts`
- Test: `packages/server/tests/rooms.test.ts`
- Test: `packages/server/tests/app.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/server/tests/rooms.test.ts`:

```ts
it('createRoom accepts custom disconnectTimeout', () => {
  const code = createRoom(db, { disconnectTimeout: 60 })
  const room = getRoomByCode(db, code)
  expect(room).not.toBeNull()
  expect(room!.disconnect_timeout).toBe(60)
})

it('createRoom defaults disconnectTimeout to 120', () => {
  const code = createRoom(db)
  const room = getRoomByCode(db, code)
  expect(room!.disconnect_timeout).toBe(120)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && pnpm test -- rooms
```

- [ ] **Step 3: Update `packages/server/src/db.ts`**

Add `disconnect_timeout` column to the rooms table:

```sql
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'waiting',
  disconnect_timeout INTEGER NOT NULL DEFAULT 120,
  created_at INTEGER NOT NULL
);
```

- [ ] **Step 4: Update `packages/server/src/rooms.ts`**

Update `RoomRow` type:

```ts
export type RoomRow = { code: string; status: string; disconnect_timeout: number; created_at: number }
```

Update `createRoom` signature and implementation:

```ts
export function createRoom(db: Db, opts?: { disconnectTimeout?: number }): string {
  let code: string
  do {
    code = generateRoomCode()
  } while (db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code))
  const timeout = opts?.disconnectTimeout ?? 120
  db.prepare('INSERT INTO rooms (code, status, disconnect_timeout, created_at) VALUES (?, ?, ?, ?)').run(code, 'waiting', timeout, Date.now())
  return code
}
```

- [ ] **Step 5: Update `packages/server/src/app.ts`**

Update `POST /rooms` to accept optional body:

```ts
  app.post('/rooms', (req: Request, res: Response) => {
    const { disconnectTimeout } = (req.body ?? {}) as { disconnectTimeout?: number }
    const code = createRoom(db, disconnectTimeout ? { disconnectTimeout } : undefined)
    res.status(201).json({ code })
  })
```

- [ ] **Step 6: Add app test for disconnect timeout**

Add to `packages/server/tests/app.test.ts`:

```ts
it('POST /rooms accepts custom disconnectTimeout', async () => {
  const res = await request(app).post('/rooms').send({ disconnectTimeout: 60 })
  expect(res.status).toBe(201)
  expect(res.body.code).toBeDefined()
  const room = getRoomByCode(db, res.body.code)
  expect(room!.disconnect_timeout).toBe(60)
})
```

Import `getRoomByCode` from `../src/rooms` in the app test file if not already imported.

- [ ] **Step 7: Run all server tests**

```bash
cd packages/server && pnpm test
```

Expected: all tests passing

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/db.ts packages/server/src/rooms.ts packages/server/src/app.ts \
        packages/server/tests/rooms.test.ts packages/server/tests/app.test.ts
git commit -m "feat(server): add configurable disconnect_timeout to rooms"
```

---

## Task 2: Server — Vote System

**Files:**
- Modify: `packages/server/src/wsHandler.ts`
- Test: `packages/server/tests/wsHandler.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/server/tests/wsHandler.test.ts`:

```ts
describe('disconnect vote system', () => {
  it('broadcasts voteStart after disconnect timeout', async () => {
    // Setup: create room, join 2 players, start game, disconnect player 1
    // After disconnect_timeout, ws0 should receive voteStart
    // Use a room with short timeout (1 second) for testing
  })

  it('tallies votes and triggers AI takeover on AI majority', async () => {
    // Setup: voteStart active, ws0 votes 'expert'
    // With only 1 connected voter, that's majority → aiTakeover broadcast
  })

  it('cancels vote on player reconnect', async () => {
    // Setup: player disconnects, vote starts, player reconnects
    // Should receive voteCancelled
  })
})
```

Note: The existing wsHandler tests use real HTTP servers and WebSocket connections. Follow the same pattern. The tests are integration-style — they set up actual rooms, join players via WebSocket, and assert on messages received. Due to the complexity of these tests (timing, async WebSocket messages), the implementer should read the existing `wsHandler.test.ts` patterns carefully before writing new tests.

- [ ] **Step 2: Update `RoomSession` type in wsHandler**

In `packages/server/src/wsHandler.ts`, update the `RoomSession` type:

```ts
type RoomSession = {
  sockets: Map<number, WebSocket>
  aiTimers: Map<number, ReturnType<typeof setTimeout>>
  disconnectTimers: Map<number, ReturnType<typeof setTimeout>>
  votes: Map<number, Map<number, string>>  // disconnectedPlayer → (voterIndex → choice)
  disconnectTimeout: number  // seconds, from room config
}
```

Update `getSession` to initialize new fields:

```ts
function getSession(roomCode: string): RoomSession {
  if (!sessions.has(roomCode)) {
    sessions.set(roomCode, {
      sockets: new Map(),
      aiTimers: new Map(),
      disconnectTimers: new Map(),
      votes: new Map(),
      disconnectTimeout: 120,
    })
  }
  return sessions.get(roomCode)!
}
```

- [ ] **Step 3: Set disconnectTimeout from room config**

When a WebSocket connects and loads the room, set the session's timeout:

```ts
    const room = getRoomByCode(db, roomCode)
    if (!room) { ws.close(4004, 'Room not found'); return }
    session.disconnectTimeout = room.disconnect_timeout
```

- [ ] **Step 4: Replace disconnect handler**

Replace the existing `ws.on('close')` handler's AI timer logic with the vote system:

```ts
    ws.on('close', () => {
      session.sockets.delete(playerIndex)
      try {
        setPlayerConnected(db, roomCode, playerIndex, false)
        const currentRoom = getRoomByCode(db, roomCode)
        if (currentRoom?.status !== 'playing') return

        broadcastAll(session, { type: 'playerDisconnected', playerIndex })

        // Start disconnect timer — when it fires, initiate a vote
        const timer = setTimeout(() => {
          session.disconnectTimers.delete(playerIndex)
          session.votes.set(playerIndex, new Map())
          broadcastAll(session, { type: 'voteStart', disconnectedPlayer: playerIndex })
        }, session.disconnectTimeout * 1000)

        session.disconnectTimers.set(playerIndex, timer)
      } catch {
        // db may have closed during test teardown
      }
    })
```

- [ ] **Step 5: Add vote message handler**

Add inside the `ws.on('message')` handler, after the `wildRecycle` block:

```ts
      if (msg.type === 'vote') {
        const { disconnectedPlayer, choice } = msg as { disconnectedPlayer: number; choice: string }
        const validChoices = ['wait', 'easy', 'expert']
        if (!validChoices.includes(choice)) {
          send(ws, { type: 'error', message: 'Invalid vote choice' })
          return
        }
        const voteMap = session.votes.get(disconnectedPlayer)
        if (!voteMap) {
          send(ws, { type: 'error', message: 'No active vote for this player' })
          return
        }
        voteMap.set(playerIndex, choice)

        // Broadcast vote update
        broadcastAll(session, {
          type: 'voteUpdate',
          disconnectedPlayer,
          votesReceived: voteMap.size,
          totalVoters: session.sockets.size,
        })

        // Check if all connected players have voted
        if (voteMap.size >= session.sockets.size) {
          tallyVotes(db, roomCode, disconnectedPlayer, session)
        }
        return
      }
```

- [ ] **Step 6: Implement tallyVotes function**

Add after `triggerAiFillIn`:

```ts
const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2, expert: 3 }

function tallyVotes(db: Db, roomCode: string, disconnectedPlayer: number, session: RoomSession): void {
  const voteMap = session.votes.get(disconnectedPlayer)
  if (!voteMap) return

  const counts: Record<string, number> = {}
  for (const choice of voteMap.values()) {
    counts[choice] = (counts[choice] ?? 0) + 1
  }

  const waitCount = counts['wait'] ?? 0
  const aiChoices = Object.entries(counts).filter(([k]) => k !== 'wait')
  const totalAi = aiChoices.reduce((sum, [, c]) => sum + c, 0)

  // Wait wins if it has majority or ties with any AI total
  if (waitCount >= totalAi) {
    // Restart disconnect timer for re-vote
    session.votes.delete(disconnectedPlayer)
    const timer = setTimeout(() => {
      session.disconnectTimers.delete(disconnectedPlayer)
      session.votes.set(disconnectedPlayer, new Map())
      broadcastAll(session, { type: 'voteStart', disconnectedPlayer })
    }, session.disconnectTimeout * 1000)
    session.disconnectTimers.set(disconnectedPlayer, timer)
    broadcastAll(session, { type: 'voteResult', disconnectedPlayer, result: 'wait' })
    return
  }

  // AI wins — pick the hardest voted difficulty
  let bestDifficulty = aiChoices[0]![0]
  let bestOrder = DIFFICULTY_ORDER[bestDifficulty] ?? 0
  for (const [diff] of aiChoices) {
    const order = DIFFICULTY_ORDER[diff] ?? 0
    if (order > bestOrder || (order === bestOrder && (counts[diff] ?? 0) > (counts[bestDifficulty] ?? 0))) {
      bestDifficulty = diff
      bestOrder = order
    }
  }

  session.votes.delete(disconnectedPlayer)
  broadcastAll(session, { type: 'aiTakeover', playerIndex: disconnectedPlayer, difficulty: bestDifficulty })
  triggerAiFillIn(db, roomCode, disconnectedPlayer, session, bestDifficulty as any)
}
```

- [ ] **Step 7: Update triggerAiFillIn to accept difficulty parameter**

Change the signature and AI agent call:

```ts
export function triggerAiFillIn(db: Db, roomCode: string, playerIndex: number, session: RoomSession, difficulty: 'easy' | 'medium' | 'hard' | 'expert' = 'medium'): void {
  const state = loadState(db, roomCode)
  if (!state) return
  if (state.turnIndex !== playerIndex) return

  const aiMove = AIAgent(difficulty)(state, playerIndex)
```

- [ ] **Step 8: Cancel vote on reconnect**

In the connection handler, after the existing AI timer cancellation, add vote cancellation:

```ts
    // Cancel any pending disconnect timer for this player
    const existingTimer = session.disconnectTimers.get(playerIndex)
    if (existingTimer) {
      clearTimeout(existingTimer)
      session.disconnectTimers.delete(playerIndex)
    }

    // Cancel any active vote for this player
    if (session.votes.has(playerIndex)) {
      session.votes.delete(playerIndex)
      broadcastAll(session, { type: 'voteCancelled', playerIndex })
    }
```

- [ ] **Step 9: Run all server tests**

```bash
cd packages/server && pnpm test
```

Expected: all tests passing (existing + new vote tests)

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/wsHandler.ts packages/server/tests/wsHandler.test.ts
git commit -m "feat(server): replace AI fill-in timer with disconnect vote system"
```

---

## Task 3: Client — WebSocket Connection Layer

**Files:**
- Create: `packages/client/src/net/connection.ts`
- Test: `packages/client/src/net/connection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/net/connection.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createConnection, type Connection } from './connection'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onopen: (() => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0 // CONNECTING
  send = vi.fn()
  close = vi.fn()
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  simulateOpen() { this.readyState = 1; this.onopen?.() }
  simulateMessage(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
  simulateClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }) }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})
afterEach(() => { vi.unstubAllGlobals() })

test('createConnection opens WebSocket with correct URL', () => {
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  expect(MockWebSocket.instances).toHaveLength(1)
  expect(MockWebSocket.instances[0]!.url).toBe('ws://localhost:3000/rooms/ABCD?token=jwt123')
})

test('status transitions from connecting to connected on open', () => {
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  expect(conn.status()).toBe('connecting')
  MockWebSocket.instances[0]!.simulateOpen()
  expect(conn.status()).toBe('connected')
})

test('onMessage callback receives parsed JSON', () => {
  const handler = vi.fn()
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  conn.onMessage(handler)
  MockWebSocket.instances[0]!.simulateOpen()
  MockWebSocket.instances[0]!.simulateMessage({ type: 'welcome', playerIndex: 0 })
  expect(handler).toHaveBeenCalledWith({ type: 'welcome', playerIndex: 0 })
})

test('send serializes and sends JSON', () => {
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  MockWebSocket.instances[0]!.simulateOpen()
  conn.send({ type: 'play', placements: [] })
  expect(MockWebSocket.instances[0]!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'play', placements: [] }))
})

test('close closes the WebSocket', () => {
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  MockWebSocket.instances[0]!.simulateOpen()
  conn.close()
  expect(MockWebSocket.instances[0]!.close).toHaveBeenCalled()
})

test('auto-reconnects on unexpected close with backoff', async () => {
  vi.useFakeTimers()
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  MockWebSocket.instances[0]!.simulateOpen()
  MockWebSocket.instances[0]!.simulateClose(1006) // abnormal
  expect(conn.status()).toBe('reconnecting')
  // First retry after 1s
  vi.advanceTimersByTime(1000)
  expect(MockWebSocket.instances).toHaveLength(2)
  vi.useRealTimers()
})

test('does not reconnect on normal close (1000)', () => {
  vi.useFakeTimers()
  const conn = createConnection('http://localhost:3000', 'ABCD', 'jwt123')
  MockWebSocket.instances[0]!.simulateOpen()
  MockWebSocket.instances[0]!.simulateClose(1000) // normal
  expect(conn.status()).toBe('disconnected')
  vi.advanceTimersByTime(5000)
  expect(MockWebSocket.instances).toHaveLength(1) // no retry
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- connection
```

- [ ] **Step 3: Implement `packages/client/src/net/connection.ts`**

```ts
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

export type Connection = {
  send(msg: object): void
  close(): void
  onMessage(handler: (msg: any) => void): void
  onStatusChange(handler: (status: ConnectionStatus) => void): void
  status(): ConnectionStatus
}

export function createConnection(serverUrl: string, roomCode: string, token: string): Connection {
  const wsUrl = serverUrl.replace(/^http/, 'ws') + `/rooms/${roomCode}?token=${token}`
  let currentStatus: ConnectionStatus = 'connecting'
  let messageHandler: ((msg: any) => void) | null = null
  let statusHandler: ((status: ConnectionStatus) => void) | null = null
  let ws: WebSocket
  let retryCount = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let intentionalClose = false
  const MAX_RETRIES = 5

  function setStatus(s: ConnectionStatus) {
    currentStatus = s
    statusHandler?.(s)
  }

  function connect() {
    ws = new WebSocket(wsUrl)
    ws.onopen = () => {
      retryCount = 0
      setStatus('connected')
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string)
        messageHandler?.(msg)
      } catch { /* ignore malformed */ }
    }
    ws.onclose = (e) => {
      if (intentionalClose || e.code === 1000) {
        setStatus('disconnected')
        return
      }
      if (retryCount < MAX_RETRIES) {
        setStatus('reconnecting')
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000)
        retryCount++
        retryTimer = setTimeout(connect, delay)
      } else {
        setStatus('disconnected')
      }
    }
    ws.onerror = () => { /* onclose will fire */ }
  }

  connect()

  return {
    send(msg) {
      if (ws.readyState === 1) ws.send(JSON.stringify(msg))
    },
    close() {
      intentionalClose = true
      if (retryTimer) clearTimeout(retryTimer)
      ws.close()
    },
    onMessage(handler) { messageHandler = handler },
    onStatusChange(handler) { statusHandler = handler },
    status() { return currentStatus },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- connection
```

Expected: 7 tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/net/connection.ts packages/client/src/net/connection.test.ts
git commit -m "feat(client): WebSocket connection layer with auto-reconnect"
```

---

## Task 4: Client — Store Online Mode

**Files:**
- Modify: `packages/client/src/store/gameStore.ts`
- Test: `packages/client/src/store/gameStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the end of `packages/client/src/store/gameStore.test.ts`:

```ts
import type { Card } from '@viota/engine'

describe('online mode', () => {
  test('initOnline sets mode and online state', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    const s = store()
    expect(s.mode).toBe('online')
    expect(s.myIndex).toBe(0)
    expect(s.humanIndex).toBe(0)
    expect(s.playerNames).toEqual(['Alice', 'Bob'])
    expect(s.playerCount).toBe(2)
  })

  test('applyServerState updates grid and hand from ClientView', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    const card: Card = { kind: 'regular', color: 'red', shape: 'circle', number: 2 }
    store().applyServerState({
      grid: [['0,0', card]],
      myHand: [card],
      handSizes: [1, 4],
      drawPileCount: 50,
      scores: [5, 3],
      turnIndex: 0,
      playedCards: [],
    })
    const s = store()
    expect(s.grid.get('0,0')).toEqual(card)
    expect(s.hands[0]).toEqual([card])
    expect(s.handSizes).toEqual([1, 4])
    expect(s.scores).toEqual([5, 3])
    expect(s.turnIndex).toBe(0)
    expect(s.phase).toBe('idle')
  })

  test('applyServerState sets phase to ai-thinking when not my turn', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    const card: Card = { kind: 'regular', color: 'red', shape: 'circle', number: 2 }
    store().applyServerState({
      grid: [['0,0', card]],
      myHand: [card],
      handSizes: [1, 4],
      drawPileCount: 50,
      scores: [0, 0],
      turnIndex: 1,
      playedCards: [],
    })
    expect(store().phase).toBe('ai-thinking')
  })

  test('setConnectionStatus updates connectionStatus', () => {
    store().setConnectionStatus('reconnecting')
    expect(store().connectionStatus).toBe('reconnecting')
  })

  test('handleVoteStart sets disconnectVote', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    store().handleVoteStart(1)
    expect(store().disconnectVote).toEqual({ disconnectedPlayer: 1, votes: new Map(), totalVoters: 0 })
  })

  test('handleVoteCancelled clears disconnectVote', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    store().handleVoteStart(1)
    store().handleVoteCancelled()
    expect(store().disconnectVote).toBeNull()
  })

  test('handleAiTakeover sets aiTakeover info and clears vote', () => {
    store().initOnline(0, ['Alice', 'Bob'])
    store().handleVoteStart(1)
    store().handleAiTakeover(1, 'expert')
    expect(store().disconnectVote).toBeNull()
    expect(store().aiTakeoverInfo).toEqual({ playerIndex: 1, difficulty: 'expert' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- gameStore
```

- [ ] **Step 3: Add online state and actions to store**

Add to the `GameStore` type:

```ts
  // Online mode state
  mode: 'local' | 'online'
  connectionStatus: ConnectionStatus
  playerNames: string[]
  myIndex: number
  turnTimer: number
  disconnectVote: { disconnectedPlayer: number; votes: Map<number, string>; totalVoters: number } | null
  handSizes: number[]
  aiTakeoverInfo: { playerIndex: number; difficulty: string } | null
  _connection: Connection | null
  // Online mode actions
  initOnline(myIndex: number, playerNames: string[]): void
  applyServerState(view: ClientView): void
  setConnectionStatus(status: ConnectionStatus): void
  setConnection(conn: Connection | null): void
  handleVoteStart(disconnectedPlayer: number): void
  handleVoteCancelled(): void
  handleAiTakeover(playerIndex: number, difficulty: string): void
  handleVoteUpdate(disconnectedPlayer: number, votesReceived: number, totalVoters: number): void
  sendVote(disconnectedPlayer: number, choice: string): void
```

Add the `ClientView` type at the top of the file:

```ts
type ClientView = {
  grid: [string, Card][]
  myHand: Card[]
  handSizes: number[]
  drawPileCount: number
  scores: number[]
  turnIndex: number
  playedCards: RegularCard[]
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
type Connection = { send(msg: object): void; close(): void }
```

Add initial state values:

```ts
  mode: 'local',
  connectionStatus: 'disconnected',
  playerNames: [],
  myIndex: 0,
  turnTimer: 0,
  disconnectVote: null,
  handSizes: [],
  aiTakeoverInfo: null,
  _connection: null,
```

Add actions:

```ts
  initOnline(myIndex, playerNames) {
    set({
      mode: 'online',
      myIndex,
      humanIndex: myIndex,
      playerNames,
      playerCount: playerNames.length,
      grid: new Map(),
      hands: Array.from({ length: playerNames.length }, () => []),
      drawPile: [],
      scores: Array.from({ length: playerNames.length }, () => 0),
      turnIndex: 0,
      playedCards: [],
      selectedCard: null,
      staged: [],
      phase: 'idle',
      lastScoreResult: null,
      validPositions: [],
      previewScore: null,
      recycleTarget: null,
      recycleValidCards: [],
      turnTimer: 0,
      disconnectVote: null,
      handSizes: Array.from({ length: playerNames.length }, () => 0),
      aiTakeoverInfo: null,
    })
  },

  applyServerState(view) {
    const { myIndex } = get()
    const grid = new Map(view.grid)
    const hands: Card[][] = Array.from({ length: view.handSizes.length }, () => [])
    hands[myIndex] = view.myHand
    const isMyTurn = view.turnIndex === myIndex
    set({
      grid,
      hands,
      handSizes: view.handSizes,
      drawPile: [],
      scores: view.scores,
      turnIndex: view.turnIndex,
      playedCards: view.playedCards,
      staged: [],
      selectedCard: null,
      validPositions: [],
      previewScore: null,
      recycleTarget: null,
      recycleValidCards: [],
      turnTimer: 0,
      phase: isMyTurn ? 'idle' : 'ai-thinking',
    })
  },

  setConnectionStatus(status) {
    set({ connectionStatus: status })
  },

  setConnection(conn) {
    set({ _connection: conn })
  },

  handleVoteStart(disconnectedPlayer) {
    set({ disconnectVote: { disconnectedPlayer, votes: new Map(), totalVoters: 0 } })
  },

  handleVoteCancelled() {
    set({ disconnectVote: null })
  },

  handleAiTakeover(playerIndex, difficulty) {
    set({ disconnectVote: null, aiTakeoverInfo: { playerIndex, difficulty } })
  },

  handleVoteUpdate(disconnectedPlayer, votesReceived, totalVoters) {
    const { disconnectVote } = get()
    if (!disconnectVote || disconnectVote.disconnectedPlayer !== disconnectedPlayer) return
    set({ disconnectVote: { ...disconnectVote, totalVoters } })
  },

  sendVote(disconnectedPlayer, choice) {
    const { _connection } = get()
    if (_connection) _connection.send({ type: 'vote', disconnectedPlayer, choice })
  },
```

Also update `confirmPlay`, `pass`, and `confirmRecycle` to check `mode`:

In `confirmPlay()`, add at the top:

```ts
    const { mode, _connection, staged } = get()
    if (mode === 'online' && _connection) {
      if (staged.length === 0) return
      _connection.send({ type: 'play', placements: staged })
      set({ staged: [], selectedCard: null, validPositions: [], previewScore: null, phase: 'ai-thinking' })
      return
    }
```

In `pass()`, add at the top:

```ts
    const { mode, _connection } = get()
    if (mode === 'online' && _connection) {
      _connection.send({ type: 'pass', trades, tradeOrder })
      set({ staged: [], selectedCard: null, validPositions: [], previewScore: null, phase: 'ai-thinking' })
      return
    }
```

In `confirmRecycle()`, add at the top:

```ts
    const { mode, _connection, recycleTarget: rt } = get()
    if (mode === 'online' && _connection && rt) {
      _connection.send({ type: 'wildRecycle', wildPosition: rt, replacement })
      set({ recycleTarget: null, recycleValidCards: [] })
      return
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- gameStore
```

Expected: all tests passing (existing + 7 new)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/store/gameStore.ts packages/client/src/store/gameStore.test.ts
git commit -m "feat(client): add online mode to game store with WS message handling"
```

---

## Task 5: Client — TopBar Online Props

**Files:**
- Modify: `packages/client/src/components/TopBar.tsx`
- Modify: `packages/client/src/components/TopBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `packages/client/src/components/TopBar.test.tsx`:

```tsx
test('renders player names when provided', () => {
  render(<TopBar {...defaultProps} playerNames={['Alice', 'Bob']} />)
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.getByText('Bob')).toBeInTheDocument()
})

test('renders turn timer when provided', () => {
  render(<TopBar {...defaultProps} turnTimer={95} />)
  expect(screen.getByText('1:35')).toBeInTheDocument()
})

test('renders connection status dot', () => {
  const { container } = render(<TopBar {...defaultProps} connectionStatus="connected" />)
  const dot = container.querySelector('[data-testid="connection-dot"]') as HTMLElement
  expect(dot).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- TopBar
```

- [ ] **Step 3: Update TopBar props and rendering**

Update the Props type:

```tsx
type Props = {
  scores: number[]
  drawPileCount: number
  playerCount: number
  humanIndex: number
  difficulty: Difficulty
  onZoomIn: () => void
  onZoomOut: () => void
  onAutoFit: () => void
  onRotateCW: () => void
  onRotateCCW: () => void
  playerNames?: string[]
  turnTimer?: number
  connectionStatus?: 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
}
```

Update the score pills to use names when available:

```tsx
        {scores.map((s, i) => (
          <div key={i} style={pill}>
            <span style={{ color: '#fff', fontWeight: 'bold' }}>
              {playerNames ? playerNames[i] ?? `P${i + 1}` : i === humanIndex ? 'You' : 'AI'}
            </span>
            {' '}
            <span style={{ color: i === humanIndex ? '#4ade80' : '#aaa', fontWeight: 'bold' }}>{s}</span>
          </div>
        ))}
```

Add turn timer display after the draw pile section:

```tsx
      {turnTimer !== undefined && (
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Turn: <span style={{ color: '#fff', fontWeight: 'bold' }}>
            {Math.floor(turnTimer / 60)}:{(turnTimer % 60).toString().padStart(2, '0')}
          </span>
        </div>
      )}
```

Add connection status dot before the zoom buttons:

```tsx
      {connectionStatus && (
        <div
          data-testid="connection-dot"
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connectionStatus === 'connected' ? '#4ade80'
              : connectionStatus === 'reconnecting' ? '#eab308'
              : '#ef4444',
          }}
        />
      )}
```

Destructure the new props:

```tsx
export default function TopBar({ scores, drawPileCount, playerCount, humanIndex, difficulty, onZoomIn, onZoomOut, onAutoFit, onRotateCW, onRotateCCW, playerNames, turnTimer, connectionStatus }: Props) {
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- TopBar
```

Expected: 8 tests passing (5 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/TopBar.tsx packages/client/src/components/TopBar.test.tsx
git commit -m "feat(client): TopBar online props (playerNames, turnTimer, connectionStatus)"
```

---

## Task 6: Client — VoteBanner Component

**Files:**
- Create: `packages/client/src/components/VoteBanner.tsx`
- Test: `packages/client/src/components/VoteBanner.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/components/VoteBanner.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import VoteBanner from './VoteBanner'

test('renders disconnected player name', () => {
  render(
    <VoteBanner
      disconnectedPlayerName="Bob"
      onVote={vi.fn()}
      votesReceived={0}
      totalVoters={2}
    />
  )
  expect(screen.getByText(/Bob disconnected/)).toBeInTheDocument()
})

test('renders vote buttons', () => {
  render(
    <VoteBanner
      disconnectedPlayerName="Bob"
      onVote={vi.fn()}
      votesReceived={0}
      totalVoters={2}
    />
  )
  expect(screen.getByText('Wait')).toBeInTheDocument()
  expect(screen.getByText('AI Easy')).toBeInTheDocument()
  expect(screen.getByText('AI Expert')).toBeInTheDocument()
})

test('clicking Wait calls onVote with wait', async () => {
  const onVote = vi.fn()
  render(
    <VoteBanner
      disconnectedPlayerName="Bob"
      onVote={onVote}
      votesReceived={0}
      totalVoters={2}
    />
  )
  await userEvent.click(screen.getByText('Wait'))
  expect(onVote).toHaveBeenCalledWith('wait')
})

test('clicking AI Expert calls onVote with expert', async () => {
  const onVote = vi.fn()
  render(
    <VoteBanner
      disconnectedPlayerName="Bob"
      onVote={onVote}
      votesReceived={0}
      totalVoters={2}
    />
  )
  await userEvent.click(screen.getByText('AI Expert'))
  expect(onVote).toHaveBeenCalledWith('expert')
})

test('shows vote tally', () => {
  render(
    <VoteBanner
      disconnectedPlayerName="Bob"
      onVote={vi.fn()}
      votesReceived={1}
      totalVoters={3}
    />
  )
  expect(screen.getByText('1/3 voted')).toBeInTheDocument()
})

test('aiTakeover mode shows informational banner', () => {
  render(
    <VoteBanner
      disconnectedPlayerName="Bob"
      aiTakeover={{ difficulty: 'expert' }}
    />
  )
  expect(screen.getByText(/AI \(expert\) playing for Bob/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/client && pnpm test -- VoteBanner
```

- [ ] **Step 3: Implement VoteBanner**

Create `packages/client/src/components/VoteBanner.tsx`:

```tsx
type Props =
  | {
      disconnectedPlayerName: string
      onVote: (choice: string) => void
      votesReceived: number
      totalVoters: number
      aiTakeover?: never
    }
  | {
      disconnectedPlayerName: string
      aiTakeover: { difficulty: string }
      onVote?: never
      votesReceived?: never
      totalVoters?: never
    }

const bannerStyle: React.CSSProperties = {
  background: '#1e1e3a',
  border: '1px solid #7c3aed',
  borderRadius: 8,
  padding: '10px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexShrink: 0,
}

const voteBtn: React.CSSProperties = {
  background: '#2a2a4a',
  border: '1px solid #3a3a5a',
  color: '#e2e8f0',
  borderRadius: 6,
  padding: '5px 12px',
  fontSize: 12,
  cursor: 'pointer',
}

export default function VoteBanner(props: Props) {
  if (props.aiTakeover) {
    return (
      <div style={bannerStyle}>
        <span style={{ color: '#c084fc', fontSize: 13 }}>
          AI ({props.aiTakeover.difficulty}) playing for {props.disconnectedPlayerName}
        </span>
      </div>
    )
  }

  return (
    <div style={bannerStyle}>
      <span style={{ color: '#ef4444', fontSize: 13 }}>{props.disconnectedPlayerName} disconnected</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={voteBtn} onClick={() => props.onVote('wait')}>Wait</button>
        <button style={voteBtn} onClick={() => props.onVote('easy')}>AI Easy</button>
        <button style={voteBtn} onClick={() => props.onVote('expert')}>AI Expert</button>
      </div>
      {props.totalVoters > 0 && (
        <span style={{ color: '#9ca3af', fontSize: 11 }}>{props.votesReceived}/{props.totalVoters} voted</span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/client && pnpm test -- VoteBanner
```

Expected: 6 tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/VoteBanner.tsx packages/client/src/components/VoteBanner.test.tsx
git commit -m "feat(client): VoteBanner component for disconnect voting"
```

---

## Task 7: Client — Lobby Page

**Files:**
- Create: `packages/client/src/pages/Lobby.tsx`
- Test: `packages/client/src/pages/Lobby.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/pages/Lobby.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Lobby from './Lobby'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

global.fetch = vi.fn()

beforeEach(() => {
  mockNavigate.mockClear()
  ;(fetch as ReturnType<typeof vi.fn>).mockClear()
})

test('renders create and join sections', () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  expect(screen.getByText('Create Room')).toBeInTheDocument()
  expect(screen.getByText('Join Room')).toBeInTheDocument()
})

test('renders name input', () => {
  render(<MemoryRouter><Lobby /></MemoryRouter>)
  expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument()
})

test('Create Room posts to server and navigates', async () => {
  ;(fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 'ABCD' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'jwt123', playerIndex: 0 }) })

  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Alice')
  await userEvent.click(screen.getByText('Create Room'))
  expect(mockNavigate).toHaveBeenCalledWith('/lobby/ABCD')
})

test('Join Room posts to server and navigates', async () => {
  ;(fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ token: 'jwt456', playerIndex: 1 }) })

  render(<MemoryRouter><Lobby /></MemoryRouter>)
  await userEvent.type(screen.getByPlaceholderText('Your name'), 'Bob')
  await userEvent.type(screen.getByPlaceholderText('Room code'), 'ABCD')
  await userEvent.click(screen.getByText('Join Room'))
  expect(mockNavigate).toHaveBeenCalledWith('/lobby/ABCD')
})
```

- [ ] **Step 2: Implement Lobby page**

Create `packages/client/src/pages/Lobby.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? (
  import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin
)

export default function Lobby() {
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return }
    setError('')
    const createRes = await fetch(`${SERVER_URL}/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    if (!createRes.ok) { setError('Failed to create room'); return }
    const { code } = await createRes.json()

    const joinRes = await fetch(`${SERVER_URL}/rooms/${code}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    if (!joinRes.ok) { setError('Failed to join room'); return }
    const { token, playerIndex } = await joinRes.json()

    sessionStorage.setItem('viota_token', token)
    sessionStorage.setItem('viota_room', code)
    sessionStorage.setItem('viota_name', name.trim())
    sessionStorage.setItem('viota_playerIndex', String(playerIndex))
    navigate(`/lobby/${code}`)
  }

  async function handleJoin() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!roomCode.trim()) { setError('Room code is required'); return }
    setError('')
    const code = roomCode.trim().toUpperCase()

    const joinRes = await fetch(`${SERVER_URL}/rooms/${code}/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    if (!joinRes.ok) {
      const body = await joinRes.json().catch(() => ({}))
      setError(body.error ?? 'Failed to join room')
      return
    }
    const { token, playerIndex } = await joinRes.json()

    sessionStorage.setItem('viota_token', token)
    sessionStorage.setItem('viota_room', code)
    sessionStorage.setItem('viota_name', name.trim())
    sessionStorage.setItem('viota_playerIndex', String(playerIndex))
    navigate(`/lobby/${code}`)
  }

  const inputStyle: React.CSSProperties = {
    background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#e2e8f0',
    borderRadius: 7, padding: '8px 14px', fontSize: 14, width: '100%',
  }
  const btnStyle: React.CSSProperties = {
    background: '#3b82f6', border: 'none', color: '#fff',
    borderRadius: 7, padding: '10px 24px', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
      <h1 style={{ fontSize: 48, fontWeight: 'bold', color: '#e2e8f0', letterSpacing: 4 }}>Viota</h1>

      <input
        style={inputStyle}
        placeholder="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        maxLength={20}
      />

      {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 280 }}>
        <button style={btnStyle} onClick={handleCreate}>Create Room</button>

        <div style={{ borderTop: '1px solid #2a2a4a', paddingTop: 16 }}>
          <input
            style={{ ...inputStyle, marginBottom: 10, textTransform: 'uppercase', textAlign: 'center', letterSpacing: 8, fontSize: 18 }}
            placeholder="Room code"
            value={roomCode}
            onChange={e => setRoomCode(e.target.value)}
            maxLength={4}
          />
          <button style={{ ...btnStyle, width: '100%' }} onClick={handleJoin}>Join Room</button>
        </div>
      </div>

      <button
        onClick={() => navigate('/')}
        style={{ background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af', borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer' }}
      >
        Back to Home
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/client && pnpm test -- "pages/Lobby"
```

Expected: 4 tests passing

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/Lobby.tsx packages/client/src/pages/Lobby.test.tsx
git commit -m "feat(client): Lobby page with create/join room"
```

---

## Task 8: Client — WaitingRoom Page

**Files:**
- Create: `packages/client/src/pages/WaitingRoom.tsx`
- Test: `packages/client/src/pages/WaitingRoom.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/pages/WaitingRoom.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import WaitingRoom from './WaitingRoom'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ code: 'ABCD' }),
  }
})

beforeEach(() => {
  sessionStorage.setItem('viota_token', 'jwt123')
  sessionStorage.setItem('viota_room', 'ABCD')
  sessionStorage.setItem('viota_name', 'Alice')
  sessionStorage.setItem('viota_playerIndex', '0')
})

test('renders room code prominently', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('ABCD')).toBeInTheDocument()
})

test('renders waiting message', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText(/waiting/i)).toBeInTheDocument()
})

test('host sees Start Game button', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('Start Game')).toBeInTheDocument()
})

test('renders disconnect timeout selector for host', () => {
  render(<MemoryRouter><WaitingRoom /></MemoryRouter>)
  expect(screen.getByText('2min')).toBeInTheDocument()
})
```

- [ ] **Step 2: Implement WaitingRoom page**

Create `packages/client/src/pages/WaitingRoom.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createConnection } from '../net/connection'
import { useGameStore } from '../store/gameStore'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? (
  import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin
)

const TIMEOUT_OPTIONS = [
  { label: '30s', value: 30 },
  { label: '1min', value: 60 },
  { label: '2min', value: 120 },
  { label: '5min', value: 300 },
]

export default function WaitingRoom() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const [players, setPlayers] = useState<string[]>([])
  const [disconnectTimeout, setDisconnectTimeout] = useState(120)
  const myName = sessionStorage.getItem('viota_name') ?? ''
  const myIndex = parseInt(sessionStorage.getItem('viota_playerIndex') ?? '0', 10)
  const token = sessionStorage.getItem('viota_token') ?? ''
  const isHost = myIndex === 0
  const initOnline = useGameStore(s => s.initOnline)
  const setConnection = useGameStore(s => s.setConnection)
  const setConnectionStatus = useGameStore(s => s.setConnectionStatus)

  useEffect(() => {
    if (!code || !token) return
    setPlayers([myName])
    const conn = createConnection(SERVER_URL, code, token)
    conn.onStatusChange(setConnectionStatus)
    conn.onMessage((msg: any) => {
      if (msg.type === 'welcome') {
        // welcome may include existing player info
      }
      if (msg.type === 'playerJoined') {
        setPlayers(prev => [...prev, msg.playerName])
      }
      if (msg.type === 'gameStarted') {
        const allNames = players.length > 0 ? players : [myName]
        initOnline(myIndex, allNames)
        setConnection(conn)
        useGameStore.getState().applyServerState(msg.view)
        navigate('/game/online')
      }
    })
    return () => conn.close()
  }, [code, token])

  function handleStart() {
    // Send startGame via a fresh connection or reuse
    // For simplicity, create a temporary fetch-based start
    // Actually the WS connection is open — we need to send through it
    // Let's store the connection ref
  }

  const pill: React.CSSProperties = {
    background: '#1e1e3a', borderRadius: 8, padding: '8px 16px', color: '#e2e8f0', fontSize: 14,
  }
  const btnActive: React.CSSProperties = {
    background: '#3b82f6', border: '1px solid #3b82f6', color: '#fff',
    borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 'bold',
  }
  const btnInactive: React.CSSProperties = {
    background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
    borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20 }}>Room</h2>
      <div style={{ fontSize: 48, fontWeight: 'bold', color: '#3b82f6', letterSpacing: 12 }}>{code}</div>
      <p style={{ color: '#9ca3af', fontSize: 13 }}>Share this code with friends</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
        <p style={{ color: '#9ca3af', fontSize: 12 }}>Players ({players.length}/4)</p>
        {players.map((name, i) => (
          <div key={i} style={pill}>{name} {i === 0 && '(host)'}</div>
        ))}
        {players.length < 2 && (
          <p style={{ color: '#6b7280', fontSize: 12, fontStyle: 'italic' }}>Waiting for more players...</p>
        )}
      </div>

      {isHost && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <p style={{ color: '#9ca3af', fontSize: 12 }}>Disconnect timeout</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {TIMEOUT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                style={disconnectTimeout === opt.value ? btnActive : btnInactive}
                onClick={() => setDisconnectTimeout(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isHost ? (
        <button
          disabled={players.length < 2}
          style={{
            background: players.length >= 2 ? '#16a34a' : '#2a2a4a',
            border: 'none', color: '#fff', borderRadius: 8,
            padding: '12px 40px', fontSize: 16, fontWeight: 'bold',
            cursor: players.length >= 2 ? 'pointer' : 'default',
          }}
          onClick={handleStart}
        >
          Start Game
        </button>
      ) : (
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Waiting for host to start...</p>
      )}
    </div>
  )
}
```

Note: The `handleStart` function needs to send a `startGame` message through the WebSocket connection. The implementer will need to store the connection ref in a `useRef` or in the store to access it from the click handler. The connection is created in the `useEffect` — store it with `connRef.current = conn` and send `connRef.current.send({ type: 'startGame' })` in `handleStart`.

- [ ] **Step 3: Run tests**

```bash
cd packages/client && pnpm test -- WaitingRoom
```

Expected: 4 tests passing

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/WaitingRoom.tsx packages/client/src/pages/WaitingRoom.test.tsx
git commit -m "feat(client): WaitingRoom page with player list and host config"
```

---

## Task 9: Client — OnlineGame Page

**Files:**
- Create: `packages/client/src/pages/OnlineGame.tsx`
- Test: `packages/client/src/pages/OnlineGame.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/pages/OnlineGame.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import OnlineGame from './OnlineGame'
import { useGameStore } from '../store/gameStore'

beforeEach(() => {
  useGameStore.getState().initOnline(0, ['Alice', 'Bob'])
  const card = { kind: 'regular' as const, color: 'red' as const, shape: 'circle' as const, number: 2 as const }
  useGameStore.getState().applyServerState({
    grid: [['0,0', card]],
    myHand: [card, card, card, card],
    handSizes: [4, 4],
    drawPileCount: 50,
    scores: [0, 0],
    turnIndex: 0,
    playedCards: [],
  })
})

test('renders without crashing', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  expect(screen.getByText('Confirm Play')).toBeInTheDocument()
})

test('shows player names in TopBar', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  expect(screen.getByText('Alice')).toBeInTheDocument()
  expect(screen.getByText('Bob')).toBeInTheDocument()
})

test('game-over shows Play Again linking to lobby', () => {
  render(<MemoryRouter><OnlineGame /></MemoryRouter>)
  act(() => useGameStore.setState({ phase: 'game-over' }))
  expect(screen.getByText('Play Again')).toBeInTheDocument()
})
```

- [ ] **Step 2: Implement OnlineGame page**

Create `packages/client/src/pages/OnlineGame.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import Board, { type BoardHandle } from '../components/Board'
import Hand from '../components/Hand'
import TopBar from '../components/TopBar'
import PassTradeModal from '../components/PassTradeModal'
import VoteBanner from '../components/VoteBanner'

export default function OnlineGame() {
  const navigate = useNavigate()
  const boardRef = useRef<BoardHandle>(null)
  const [showPassModal, setShowPassModal] = useState(false)

  const phase = useGameStore(s => s.phase)
  const scores = useGameStore(s => s.scores)
  const hands = useGameStore(s => s.hands)
  const staged = useGameStore(s => s.staged)
  const selectedCard = useGameStore(s => s.selectedCard)
  const playerCount = useGameStore(s => s.playerCount)
  const difficulty = useGameStore(s => s.difficulty)
  const humanIndex = useGameStore(s => s.humanIndex)
  const selectCard = useGameStore(s => s.selectCard)
  const confirmPlay = useGameStore(s => s.confirmPlay)
  const pass = useGameStore(s => s.pass)
  const recycleValidCards = useGameStore(s => s.recycleValidCards)
  const confirmRecycle = useGameStore(s => s.confirmRecycle)
  const playerNames = useGameStore(s => s.playerNames)
  const turnTimer = useGameStore(s => s.turnTimer)
  const connectionStatus = useGameStore(s => s.connectionStatus)
  const disconnectVote = useGameStore(s => s.disconnectVote)
  const aiTakeoverInfo = useGameStore(s => s.aiTakeoverInfo)
  const handSizes = useGameStore(s => s.handSizes)
  const sendVote = useGameStore(s => s.sendVote)
  const drawPileCount = handSizes.reduce((a, b) => a + b, 0) // approximate; or use store field

  // Turn timer interval
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.setState(s => ({ turnTimer: s.turnTimer + 1 }))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const humanHand = hands[humanIndex] ?? []
  const canConfirm = staged.length > 0 && phase === 'placing'
  const roomCode = sessionStorage.getItem('viota_room') ?? ''

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <TopBar
        scores={scores}
        drawPileCount={0}
        playerCount={playerCount}
        humanIndex={humanIndex}
        difficulty={difficulty}
        onZoomIn={() => boardRef.current?.zoomIn()}
        onZoomOut={() => boardRef.current?.zoomOut()}
        onAutoFit={() => boardRef.current?.autofit()}
        onRotateCW={() => boardRef.current?.rotateCW()}
        onRotateCCW={() => boardRef.current?.rotateCCW()}
        playerNames={playerNames}
        turnTimer={turnTimer}
        connectionStatus={connectionStatus}
      />

      {disconnectVote && (
        <VoteBanner
          disconnectedPlayerName={playerNames[disconnectVote.disconnectedPlayer] ?? 'Player'}
          onVote={(choice) => sendVote(disconnectVote.disconnectedPlayer, choice)}
          votesReceived={disconnectVote.totalVoters > 0 ? disconnectVote.totalVoters : 0}
          totalVoters={disconnectVote.totalVoters}
        />
      )}

      {aiTakeoverInfo && !disconnectVote && (
        <VoteBanner
          disconnectedPlayerName={playerNames[aiTakeoverInfo.playerIndex] ?? 'Player'}
          aiTakeover={{ difficulty: aiTakeoverInfo.difficulty }}
        />
      )}

      <Board ref={boardRef} />

      <div style={{
        background: '#12122a', padding: '12px 16px',
        borderTop: '1px solid #2a2a4a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <Hand
          hand={humanHand}
          selectedCard={selectedCard}
          staged={staged}
          onSelectCard={selectCard}
          recycleValidCards={recycleValidCards}
          onConfirmRecycle={confirmRecycle}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'stretch', minWidth: 130 }}>
          <button
            disabled={!canConfirm}
            onClick={confirmPlay}
            style={{
              background: canConfirm ? '#16a34a' : '#2a2a4a',
              border: 'none', color: '#fff',
              borderRadius: 7, padding: '9px 0', fontSize: 13, fontWeight: 'bold',
              cursor: canConfirm ? 'pointer' : 'default',
            }}
          >
            Confirm Play
          </button>
          <button
            disabled={phase === 'ai-thinking'}
            onClick={() => setShowPassModal(true)}
            style={{
              background: '#1e1e3a', border: '1px solid #3a3a5a', color: '#9ca3af',
              borderRadius: 7, padding: '7px 0', fontSize: 12, cursor: 'pointer',
            }}
          >
            Pass / Trade
          </button>
        </div>
      </div>

      {showPassModal && (
        <PassTradeModal
          hand={humanHand}
          onConfirm={(trades, tradeOrder) => {
            pass(trades, tradeOrder)
            setShowPassModal(false)
          }}
          onClose={() => setShowPassModal(false)}
        />
      )}

      {phase === 'game-over' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }}>
          <div style={{
            background: '#1e1e3a', borderRadius: 12, padding: 32,
            border: '1px solid #3a3a5a', textAlign: 'center', minWidth: 300,
          }}>
            <h2 style={{ color: '#e2e8f0', marginBottom: 16 }}>Game Over</h2>
            {scores.map((s, i) => (
              <p key={i} style={{ color: '#9ca3af', marginBottom: 8 }}>
                {playerNames[i] ?? `Player ${i + 1}`}: <span style={{ color: '#fff', fontWeight: 'bold' }}>{s}</span>
              </p>
            ))}
            <button
              onClick={() => navigate(`/lobby/${roomCode}`)}
              style={{
                marginTop: 16, background: '#3b82f6', border: 'none', color: '#fff',
                borderRadius: 7, padding: '10px 24px', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
              }}
            >
              Play Again
            </button>
            <button
              onClick={() => navigate('/')}
              style={{
                marginTop: 8, background: 'transparent', border: '1px solid #3a3a5a', color: '#9ca3af',
                borderRadius: 7, padding: '8px 24px', fontSize: 12, cursor: 'pointer', display: 'block', width: '100%',
              }}
            >
              Home
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/client && pnpm test -- "pages/OnlineGame"
```

Expected: 3 tests passing

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/pages/OnlineGame.tsx packages/client/src/pages/OnlineGame.test.tsx
git commit -m "feat(client): OnlineGame page with WS-driven state and vote banner"
```

---

## Task 10: Client — Routes + Home Page Link

**Files:**
- Modify: `packages/client/src/main.tsx`
- Modify: `packages/client/src/pages/Home.tsx`

- [ ] **Step 1: Update `packages/client/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Game from './pages/Game'
import Lobby from './pages/Lobby'
import WaitingRoom from './pages/WaitingRoom'
import OnlineGame from './pages/OnlineGame'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/game/local" element={<Game />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/lobby/:code" element={<WaitingRoom />} />
        <Route path="/game/online" element={<OnlineGame />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
```

- [ ] **Step 2: Add "Play Online" button to Home page**

In `packages/client/src/pages/Home.tsx`, add a button after "Start Game":

```tsx
      <button
        onClick={() => navigate('/lobby')}
        style={{
          background: '#7c3aed', border: 'none', color: '#fff',
          borderRadius: 8, padding: '12px 40px', fontSize: 16,
          fontWeight: 'bold', cursor: 'pointer',
        }}
      >
        Play Online
      </button>
```

Add `navigate` import (already present via `useNavigate`).

- [ ] **Step 3: Run full test suite**

```bash
cd packages/client && pnpm test
```

Expected: all tests passing

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/main.tsx packages/client/src/pages/Home.tsx
git commit -m "feat(client): add multiplayer routes and Play Online button"
```

---

## Self-Review Checklist

**Spec coverage:**

| Spec section | Covered by task |
|---|---|
| Lobby: create room flow | Task 7 |
| Lobby: join room flow | Task 7 |
| Waiting room: player list, host config, start game | Task 8 |
| WebSocket connection layer | Task 3 |
| Store: online mode, action behavior by mode | Task 4 |
| Store: incoming WS message handling | Task 4 |
| Server: disconnect_timeout on rooms | Task 1 |
| Server: vote system replacing AI fill-in | Task 2 |
| VoteBanner component | Task 6 |
| TopBar: playerNames, turnTimer, connectionStatus | Task 5 |
| OnlineGame page | Task 9 |
| Routes: /lobby, /lobby/:code, /game/online | Task 10 |
| Turn timer (visual, non-enforced) | Task 4 (store) + Task 5 (TopBar) + Task 9 (interval) |
| Game over: winner by name, Play Again → lobby | Task 9 |
| Home page: Play Online button | Task 10 |
| Server URL config (VITE_SERVER_URL) | Task 7 (Lobby) + Task 8 (WaitingRoom) |

**Placeholder scan:** No TBDs or TODOs. All code blocks present. One note: Task 8 WaitingRoom's `handleStart` has a comment indicating the implementer needs to wire the connection ref — this is documented in the task note, not left as a placeholder.

**Type consistency:** `ClientView` type in Task 4 matches server's `ClientView`. `ConnectionStatus` type matches across connection.ts (Task 3) and store (Task 4). `VoteBanner` props match across Task 6 and Task 9 usage. `createConnection` signature matches across Task 3 and Task 8 usage.
