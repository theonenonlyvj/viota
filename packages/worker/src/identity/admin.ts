/**
 * Admin step-up token verification for `/admin/merge`. Deliberately a
 * SEPARATE secret (`ADMIN_JWT_SECRET`), issuer (`vgames`), and audience
 * (`vgames-admin`) from the player-facing `JWT_SECRET`/`vgames`/`vgames-web`
 * tokens — a compromised/leaked player token (or a bug that widens what
 * `JWT_SECRET` signs) can never authorize an admin merge. Pinning `issuer` in
 * addition to `audience` matches `jwt.ts`'s "iss+aud MANDATORY" philosophy
 * (checking only one of the two would still leave a same-secret,
 * wrong-context token able to slip through if that context ever shared an
 * audience). There is no player-facing endpoint that mints an admin token; it
 * is minted out-of-band (Vijay, manually — MUST set `iss:'vgames'` and
 * `aud:'vgames-admin'`) and never touches D1.
 */
import { jwtVerify } from 'jose'

const ADMIN_ISS = 'vgames'
const ADMIN_AUD = 'vgames-admin'

export type AdminEnv = { ADMIN_JWT_SECRET?: string }

/** @returns the admin token's subject on success, or `null` on ANY failure
 *  (missing/invalid Bearer token, wrong secret/issuer/audience/alg, or
 *  `ADMIN_JWT_SECRET` unset — fail-closed, same as a bad token). */
export async function verifyAdminToken(request: Request, env: AdminEnv): Promise<{ sub: string } | null> {
  if (!env.ADMIN_JWT_SECRET) return null

  const h = request.headers.get('authorization') || request.headers.get('Authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  if (!m) return null

  try {
    const { payload } = await jwtVerify(m[1]!.trim(), new TextEncoder().encode(env.ADMIN_JWT_SECRET), {
      algorithms: ['HS256'],
      issuer: ADMIN_ISS,
      audience: ADMIN_AUD,
    })
    const sub = payload.sub
    if (typeof sub !== 'string' || sub.length === 0) return null
    return { sub }
  } catch {
    return null
  }
}
