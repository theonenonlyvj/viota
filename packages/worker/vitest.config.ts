import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
// (0.8.x exposes defineWorkersConfig at the /config subpath)

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        // Tests need a VALID 32+ byte secret so the request-time guard passes.
        // This overrides the deliberately-invalid wrangler [vars] placeholder.
        miniflare: {
          bindings: {
            JWT_SECRET: 'test-jwt-secret-0123456789-abcdefghijklmnop',
          },
        },
      },
    },
  },
})
