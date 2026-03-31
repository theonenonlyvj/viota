import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export type TokenPayload =
  | { sub: 'guest'; roomCode: string; playerIndex: number; playerName: string; guestSecret: string }
  | { sub: 'account'; accountId: number; email: string }

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]!).join('')
}

export function generateSecret(): string {
  return crypto.randomBytes(16).toString('hex')
}

export function signGuestToken(
  data: { roomCode: string; playerIndex: number; playerName: string; guestSecret: string },
  secret: string
): string {
  return jwt.sign({ sub: 'guest', ...data }, secret, { expiresIn: '2h' })
}

export function signAccountToken(
  data: { accountId: number; email: string },
  secret: string
): string {
  return jwt.sign({ sub: 'account', ...data }, secret, { expiresIn: '7d' })
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    return jwt.verify(token, secret) as TokenPayload
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}
