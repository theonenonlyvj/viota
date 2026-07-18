import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          JWT_SECRET: 'test-jwt-secret-0123456789-abcdefghijklmnop',
        },
        // Stub the IDENTITY_SVC service binding (wrangler.toml [[services]] ->
        // worker "vgames-identity", which doesn't exist in the local test
        // environment; without a stub the pool fails to boot). Proxy tests
        // exercise proxyToIdentity via their own env objects / fetch mocks and
        // never rely on this stub's response.
        serviceBindings: {
          // Echo stub for the grace-proxy tests: reflects method/path/body so
          // test/auth-proxy.test.ts can assert the proxy forwarded faithfully
          // through the REAL binding path. `x-stub-status` lets a test exercise
          // non-200 relay. Never used by prod code paths.
          async IDENTITY_SVC(request) {
            const url = new URL(request.url)
            const status = Number(request.headers.get('x-stub-status') ?? '200')
            const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text()
            return new Response(
              JSON.stringify({ via: 'identity_svc_stub', method: request.method, path: url.pathname, body }),
              { status, headers: { 'content-type': 'application/json' } },
            )
          },
        },
      },
    }),
  ],
  test: {
    // Keep one shared runtime: the suite uses unique DO names and relies on
    // shared D1 schema setup across identity test files.
    fileParallelism: false,
    isolate: false,
  },
})
