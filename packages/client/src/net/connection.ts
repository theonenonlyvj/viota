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
    ws.onopen = () => { retryCount = 0; setStatus('connected') }
    ws.onmessage = (e) => {
      try { messageHandler?.(JSON.parse(e.data as string)) } catch {}
    }
    ws.onclose = (e) => {
      if (intentionalClose || e.code === 1000) { setStatus('disconnected'); return }
      if (retryCount < MAX_RETRIES) {
        setStatus('reconnecting')
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000)
        retryCount++
        retryTimer = setTimeout(connect, delay)
      } else {
        setStatus('disconnected')
      }
    }
    ws.onerror = () => {}
  }

  connect()

  return {
    send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)) },
    close() { intentionalClose = true; if (retryTimer) clearTimeout(retryTimer); ws.close() },
    onMessage(handler) { messageHandler = handler },
    onStatusChange(handler) { statusHandler = handler },
    status() { return currentStatus },
  }
}
