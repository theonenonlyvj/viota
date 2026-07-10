/**
 * Admin step-up token verification for `/admin/merge`. Deliberately a
 * SEPARATE secret (`ADMIN_JWT_SECRET`) and audience (`vgames-admin`) from the
 * player-facing `JWT_SECRET`/`vgames-web` tokens — a compromised/leaked player
 * token (or a bug that widens what `JWT_SECRET` signs) can never authorize an
 * admin merge. There is no player-facing endpoint that mints an admin token;
 * it is minted out-of-band (Vijay, manually) and never touches D1.
 */
import { jwtVerify } from 'jose'

const ADMIN_AUD = 'vgames-admin'

export type AdminEnv = { ADMIN_JWT_SECRET?: string }

/** @returns the admin token's subject on success, or `null` on ANY failure
 *  (missing/invalid Bearer token, wrong secret/audience/alg, or
 *  `ADMIN_JWT_SECRET` unset — fail-closed, same as a bad token). */
export async function verifyAdminToken(request: Request, env: AdminEnv): Promise<{ sub: string } | null> {
  if (!env.ADMIN_JWT_SECRET) return null

  const h = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  if (!m) return null

  try {
    const { payload } = await jwtVerify(m[1]!.trim(), new TextEncoder().encode(env.ADMIN_JWT_SECRET), {
      algorithms: ['HS256'],
      audience: ADMIN_AUD,
    })
    const sub = payload.sub
    if (typeof sub !== 'string' || sub.length === 0) return null
    return { sub }
  } catch {
    return null
  }
}
