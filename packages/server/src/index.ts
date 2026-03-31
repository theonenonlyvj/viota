import http from 'http'
import { createDb } from './db'
import { createApp } from './app'
import { setupWs } from './wsHandler'

const PORT = parseInt(process.env['PORT'] ?? '3000', 10)
const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production'
const DB_FILE = process.env['DB_FILE'] ?? 'viota.db'

const db = createDb(DB_FILE)
const app = createApp(db, JWT_SECRET)
const server = http.createServer(app)
setupWs(server, db, JWT_SECRET)

server.listen(PORT, () => {
  console.log(`viota server listening on port ${PORT}`)
})

process.on('SIGINT', () => {
  server.close(() => {
    db.close()
    process.exit(0)
  })
})
