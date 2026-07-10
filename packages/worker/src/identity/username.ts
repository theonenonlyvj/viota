/**
 * Username + password shape rules for VGames set-credentials/login.
 *
 * Username: lowercase `[a-z0-9_]`, 3..20 chars — chosen to be a valid slug on
 * every downstream surface (URLs, DOM ids) with no case-folding ambiguity.
 * Password: length-only gate (6..128); weak passwords are allowed, hashing is
 * the security boundary (see `pbkdf2.ts`), not a complexity policy.
 */

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export function validateUsername(u: string): boolean {
  return typeof u === 'string' && USERNAME_RE.test(u)
}

export function validatePassword(p: string): boolean {
  return typeof p === 'string' && p.length >= 6 && p.length <= 128
}

function hashStr(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return h
}

/**
 * Derive a USERNAME_RE-valid slug from a (possibly empty/non-Latin/emoji-only)
 * display name. `suffix` (e.g. a short id fragment) pads out names that are
 * too short or collapse to nothing once non-`[a-z0-9_]` characters are
 * stripped, so this ALWAYS returns a valid slug — never throws, never returns
 * an empty/short string.
 */
export function slugifyUsername(displayName: string, suffix = ''): string {
  let s = (displayName ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip diacritics/combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_') // any non-allowed run -> single underscore
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  const sfx = (suffix ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '')

  if (s.length < 3) s = (s + '_' + sfx).replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  if (s.length < 3) s = ('user_' + sfx).slice(0, 20)
  if (s.length < 3) s = 'user' + Math.abs(hashStr(displayName + suffix) % 1000)

  s = s.slice(0, 20).replace(/^_+|_+$/g, '')
  if (s.length < 3) s = (s + '000').slice(0, 20)

  return s
}
