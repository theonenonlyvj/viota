import { expect, test } from 'vitest'
import { authUrl, serverUrl } from './config'

/**
 * Identity code/data split (A2/2a) — `authUrl()`. The `VITE_AUTH_URL`
 * override branch mirrors `serverUrl()`'s existing `VITE_SERVER_URL` one
 * (itself untested here, same reason): both read `import.meta.env` via a
 * DYNAMIC property lookup (not a literal `import.meta.env.X` member
 * expression), so Vite can't statically inline it and Vitest's `vi.stubEnv`
 * can't retroactively patch the already-materialized `import.meta.env`
 * snapshot either — there's nothing meaningful to assert against in this
 * harness short of a separate build-mode test project. The dev-fallback
 * branch below (the one actually reachable in every test run) is ALSO
 * exercised implicitly by every other net/ test that asserts an `/auth/*`
 * call lands on 'http://localhost:8787' (identity.test.ts, account.test.ts,
 * lobby.test.ts, online.test.ts, reportGame.test.ts).
 */

test('authUrl() falls back to serverUrl() in dev (no VITE_AUTH_URL set)', () => {
  expect(authUrl()).toBe(serverUrl())
  expect(authUrl()).toBe('http://localhost:8787')
})
