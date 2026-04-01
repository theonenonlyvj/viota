import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { URL } from 'url'
import type { Db } from './db'
import { verifyToken } from './auth'
import { getRoomByCode, getPlayers, setPlayerConnected, setRoomStatus } from './rooms'
import { saveState, loadState, buildClientView } from './gameState'
import { initGame, applyPlay, applyPass, applyWildRecycle } from './gameLoop'
import { AIAgent } from '@viota/engine'
import type { Placement, Card, RegularCard, Position } from '@viota/engine'

type RoomSession = {
  sockets: Map<number, WebSocket>   // playerIndex → socket
  aiTimers: Map<number, ReturnType<typeof setTimeout>>
  disconnectTimers: Map<number, ReturnType<typeof setTimeout>>
  votes: Map<number, Map<number, string>>  // disconnectedPlayer → (voterIndex → choice)
  disconnectTimeout: number
}

const sessions = new Map<string, RoomSession>()

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

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(session: RoomSession, msg: object, excludeIndex?: number): void {
  for (const [idx, ws] of session.sockets) {
    if (idx !== excludeIndex) send(ws, msg)
  }
}

function broadcastAll(session: RoomSession, msg: object): void {
  broadcast(session, msg)
}

export function setupWs(server: http.Server, db: Db, jwtSecret: string): void {
  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws, request) => {
    const rawUrl = request.url ?? '/'
    const url = new URL(rawUrl, 'http://localhost')
    const pathParts = url.pathname.split('/')
    // Expected: /rooms/:code → ['', 'rooms', 'CODE']
    const roomCode = pathParts[2]
    const token = url.searchParams.get('token')

    if (!roomCode || !token) {
      ws.close(4001, 'Missing room code or token')
      return
    }

    const payload = verifyToken(token, jwtSecret)
    if (!payload) {
      ws.close(4001, 'Invalid token')
      return
    }

    const room = getRoomByCode(db, roomCode)
    if (!room) {
      ws.close(4004, 'Room not found')
      return
    }

    let playerIndex: number
    if (payload.sub === 'guest') {
      if (payload.roomCode !== roomCode) {
        ws.close(4003, 'Token room mismatch')
        return
      }
      playerIndex = payload.playerIndex
    } else {
      // Account user: find their player slot in this room
      const players = getPlayers(db, roomCode)
      const found = players.find(p => p.account_id === payload.accountId)
      if (!found) {
        ws.close(4003, 'Not a member of this room')
        return
      }
      playerIndex = found.player_index
    }

    const session = getSession(roomCode)
    session.disconnectTimeout = room.disconnect_timeout

    // Cancel any pending AI timer for this player (they reconnected)
    const existing = session.aiTimers.get(playerIndex)
    if (existing) {
      clearTimeout(existing)
      session.aiTimers.delete(playerIndex)
    }

    // Cancel any pending disconnect timer and active vote for this player
    const existingDisconnectTimer = session.disconnectTimers.get(playerIndex)
    if (existingDisconnectTimer) {
      clearTimeout(existingDisconnectTimer)
      session.disconnectTimers.delete(playerIndex)
    }
    if (session.votes.has(playerIndex)) {
      session.votes.delete(playerIndex)
      broadcastAll(session, { type: 'voteCancelled', playerIndex })
    }

    session.sockets.set(playerIndex, ws)
    setPlayerConnected(db, roomCode, playerIndex, true)

    // Notify others of reconnection
    if (room.status === 'playing') {
      broadcast(session, { type: 'playerReconnected', playerIndex }, playerIndex)
    }

    // Send welcome with current game state (if playing)
    const currentState = loadState(db, roomCode)
    send(ws, {
      type: 'welcome',
      playerIndex,
      roomCode,
      view: currentState ? buildClientView(currentState, playerIndex) : null,
    })

    // Notify others that this player joined (if waiting)
    if (room.status === 'waiting') {
      const players = getPlayers(db, roomCode)
      const player = players.find(p => p.player_index === playerIndex)
      broadcast(session, { type: 'playerJoined', playerIndex, playerName: player?.name ?? '' }, playerIndex)
    }

    ws.on('message', (data) => {
      let msg: any
      try {
        msg = JSON.parse(data.toString())
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' })
        return
      }

      const currentRoom = getRoomByCode(db, roomCode)
      if (!currentRoom) return

      if (msg.type === 'startGame') {
        if (currentRoom.status !== 'waiting') {
          send(ws, { type: 'error', message: 'Game already started' })
          return
        }
        if (playerIndex !== 0) {
          send(ws, { type: 'error', message: 'Only the host can start the game' })
          return
        }
        const players = getPlayers(db, roomCode)
        if (players.length < 2) {
          send(ws, { type: 'error', message: 'Need at least 2 players to start' })
          return
        }
        const state = initGame(players.length)
        setRoomStatus(db, roomCode, 'playing')
        saveState(db, roomCode, state)
        // Send each player their own view
        for (const [idx, sock] of session.sockets) {
          send(sock, { type: 'gameStarted', view: buildClientView(state, idx) })
        }
        return
      }

      if (msg.type === 'play') {
        const state = loadState(db, roomCode)
        if (!state) { send(ws, { type: 'error', message: 'Game not started' }); return }
        const result = applyPlay(state, playerIndex, msg.placements as Placement[])
        if ('error' in result) {
          send(ws, { type: 'error', message: result.error })
          return
        }
        saveState(db, roomCode, result.newState)
        const action = { playerIndex, move: 'play', scoreResult: result.scoreResult }
        for (const [idx, sock] of session.sockets) {
          send(sock, { type: 'state', view: buildClientView(result.newState, idx), action })
        }
        if (result.gameOver) {
          const { finalScores, winnerIndex } = computeWinner(result.newState.scores)
          setRoomStatus(db, roomCode, 'finished')
          broadcastAll(session, { type: 'gameOver', finalScores, winnerIndex })
        }
        return
      }

      if (msg.type === 'pass') {
        const state = loadState(db, roomCode)
        if (!state) { send(ws, { type: 'error', message: 'Game not started' }); return }
        const result = applyPass(state, playerIndex, msg.trades as Card[], msg.tradeOrder as Card[])
        if ('error' in result) {
          send(ws, { type: 'error', message: result.error })
          return
        }
        saveState(db, roomCode, result.newState)
        const action = { playerIndex, move: 'pass' }
        for (const [idx, sock] of session.sockets) {
          send(sock, { type: 'state', view: buildClientView(result.newState, idx), action })
        }
        return
      }

      if (msg.type === 'wildRecycle') {
        const state = loadState(db, roomCode)
        if (!state) { send(ws, { type: 'error', message: 'Game not started' }); return }
        const result = applyWildRecycle(state, playerIndex, msg.wildPosition as Position, msg.replacement as RegularCard)
        if ('error' in result) {
          send(ws, { type: 'error', message: result.error })
          return
        }
        saveState(db, roomCode, result.newState)
        const action = { playerIndex, move: 'wildRecycle' }
        for (const [idx, sock] of session.sockets) {
          send(sock, { type: 'state', view: buildClientView(result.newState, idx), action })
        }
        return
      }

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
        broadcastAll(session, {
          type: 'voteUpdate',
          disconnectedPlayer,
          votesReceived: voteMap.size,
          totalVoters: session.sockets.size,
        })
        if (voteMap.size >= session.sockets.size) {
          tallyVotes(db, roomCode, disconnectedPlayer, session)
        }
        return
      }

      send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` })
    })

    ws.on('close', () => {
      session.sockets.delete(playerIndex)
      try {
        setPlayerConnected(db, roomCode, playerIndex, false)
        const currentRoom = getRoomByCode(db, roomCode)
        if (currentRoom?.status !== 'playing') return

        broadcastAll(session, { type: 'playerDisconnected', playerIndex })

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
  })
}

function computeWinner(scores: number[]): { finalScores: number[]; winnerIndex: number } {
  const winnerIndex = scores.reduce((best, s, i) => (s > scores[best]! ? i : best), 0)
  return { finalScores: scores, winnerIndex }
}

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

  if (waitCount >= totalAi) {
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

export function triggerAiFillIn(db: Db, roomCode: string, playerIndex: number, session: RoomSession, difficulty: 'easy' | 'medium' | 'hard' | 'expert' = 'medium'): void {
  const state = loadState(db, roomCode)
  if (!state) return
  if (state.turnIndex !== playerIndex) return // turn moved on already

  const aiMove = AIAgent(difficulty)(state, playerIndex)

  let result: ReturnType<typeof applyPlay> | ReturnType<typeof applyPass>
  if (aiMove.type === 'play') {
    result = applyPlay(state, playerIndex, aiMove.placements)
  } else {
    result = applyPass(state, playerIndex, aiMove.trades, aiMove.tradeOrder)
  }

  if ('error' in result) return // shouldn't happen with a valid AI move

  saveState(db, roomCode, result.newState)
  const action = { playerIndex, move: aiMove.type, isAi: true }
  for (const [idx, sock] of session.sockets) {
    send(sock, { type: 'state', view: buildClientView(result.newState, idx), action })
  }

  if ('gameOver' in result && result.gameOver) {
    const { finalScores, winnerIndex } = computeWinner(result.newState.scores)
    setRoomStatus(db, roomCode, 'finished')
    broadcastAll(session, { type: 'gameOver', finalScores, winnerIndex })
  }
}
