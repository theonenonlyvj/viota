/**
 * The WebSocket NUDGE layer (spec §2). The socket is demoted to a one-way
 * "there's news at index N" hint — it carries NO authoritative state. On a nudge
 * whose index is ahead of ours we pull the truth via HTTP `sync`.
 *
 * Reconnect is INFINITE with backoff capped at 10s while the tab is visible
 * (the old `MAX_RETRIES=5` give-up is removed). If the socket will not open at
 * all (blocked), we degrade to 5s `sync` polling while foregrounded — higher
 * latency, never frozen. The token rides the first-frame `auth` message, never
 * the URL.
 */

export type ServerFrame =
  | { type: 'auth_ok'; seat: number }
  | { type: 'nudge'; moveIndex: number }
  | { type: 'ai_cover'; seat: number }
  | { type: 'veto'; seat: number; moveIndex: number }
  | { type: 'host_changed'; hostSeat: number }
  | { type: 'started'; moveIndex: number }
  | { type: string; [k: string]: unknown }

export type FrameDeps = {
  getLocalIndex: () => number
  sync: () => void
  onAuthOk?: (seat: number) => void
  onAiCover?: (seat: number) => void
  onVeto?: (seat: number, moveIndex: number) => void
  /** The lobby host role moved (host left the waiting room) — a joiner re-checks
   *  whether IT now sees Start. */
  onHostChanged?: (hostSeat: number) => void
  /** The host dealt the room — waiting joiners navigate into the game. */
  onStarted?: (moveIndex: number) => void
}

/**
 * Pure dispatch of one server frame. Exposed for direct testing:
 *  - `nudge` triggers a sync ONLY when its index is ahead of the local index;
 *  - `veto` always re-syncs (the board rolled back);
 *  - `ai_cover`/`auth_ok` fan out to their callbacks.
 */
export function handleServerFrame(frame: ServerFrame | null, deps: FrameDeps): void {
  if (!frame || typeof frame.type !== 'string') return
  switch (frame.type) {
    case 'auth_ok':
      deps.onAuthOk?.((frame as { seat: number }).seat)
      break
    case 'nudge': {
      const mi = (frame as { moveIndex: number }).moveIndex
      if (typeof mi === 'number' && mi > deps.getLocalIndex()) deps.sync()
      break
    }
    case 'ai_cover':
      deps.onAiCover?.((frame as { seat: number }).seat)
      break
    case 'host_changed':
      deps.onHostChanged?.((frame as { hostSeat: number }).hostSeat)
      break
    case 'started':
      deps.onStarted?.((frame as { moveIndex: number }).moveIndex)
      break
    case 'veto': {
      const f = frame as { seat: number; moveIndex: number }
      deps.onVeto?.(f.seat, f.moveIndex)
      deps.sync()
      break
    }
  }
}

export type NudgeChannel = {
  close: () => void
  /** Force an immediate reconnect attempt (e.g. from a foreground event). */
  reopen: () => void
}

export type NudgeOptions = FrameDeps & {
  getToken: () => string | null
  isVisible?: () => boolean
  onOpen?: () => void // fires after a successful auth handshake (a reconcile hook)
}

const MAX_BACKOFF_MS = 10_000
const POLL_MS = 5_000

/**
 * Open a live nudge channel to `GET /games/:id/socket`. Auto-reconnects with
 * infinite capped backoff while visible; falls back to 5s sync polling if the
 * socket cannot be established.
 */
export function createNudgeChannel(
  serverUrl: string,
  gameId: string,
  opts: NudgeOptions,
): NudgeChannel {
  const wsBase = serverUrl.replace(/^http/, 'ws')
  const url = `${wsBase}/games/${encodeURIComponent(gameId)}/socket`
  const isVisible = opts.isVisible ?? (() => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'))

  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  }

  function startPolling() {
    if (pollTimer || closed) return
    pollTimer = setInterval(() => {
      if (isVisible()) opts.sync()
    }, POLL_MS)
  }

  function scheduleReconnect() {
    if (closed) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, attempt))
    attempt++
    reconnectTimer = setTimeout(() => {
      if (closed) return
      // If the tab is hidden when the timer fires, do NOT give up — re-arm the
      // backoff so the reconnect chain survives being backgrounded (otherwise the
      // socket stays dead for the rest of the session and we degrade to the poll
      // forever). A foreground event also forces an immediate reconnect via reopen().
      if (isVisible()) connect()
      else scheduleReconnect()
    }, delay)
  }

  function connect() {
    if (closed) return
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      startPolling() // socket construction blocked → degrade to polling
      scheduleReconnect()
      return
    }
    ws = socket

    socket.onopen = () => {
      // Auth rides the FIRST FRAME, never the URL.
      const token = opts.getToken()
      if (token) socket.send(JSON.stringify({ type: 'auth', token }))
    }
    socket.onmessage = (e: MessageEvent) => {
      let frame: ServerFrame | null
      try {
        frame = JSON.parse(String(e.data)) as ServerFrame
      } catch {
        frame = null
      }
      if (frame && frame.type === 'auth_ok') {
        attempt = 0 // healthy socket — reset backoff
        stopPolling()
        opts.onOpen?.()
      }
      handleServerFrame(frame, opts)
    }
    socket.onerror = () => {
      // If it never opened, this is likely a blocked socket → start polling.
      startPolling()
    }
    socket.onclose = () => {
      ws = null
      if (closed) return
      startPolling() // keep truth flowing while the socket is down
      scheduleReconnect()
    }
  }

  connect()

  return {
    close() {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      stopPolling()
      try { ws?.close(1000) } catch { /* already gone */ }
      ws = null
    },
    reopen() {
      if (closed) return
      attempt = 0
      if (ws && ws.readyState === WebSocket.OPEN) return
      if (reconnectTimer) clearTimeout(reconnectTimer)
      connect()
    },
  }
}
