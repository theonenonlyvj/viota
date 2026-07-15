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
