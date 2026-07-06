import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
// (0.8.x exposes defineWorkersConfig at the /config subpath)

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // Durable Objects + WebSockets are NOT supported under per-file storage
        // isolation (Cloudflare vitest known-issues). SQLite-backed DOs also trip
        // the isolated-storage stack pop on the `-shm` WAL sidecar. Per CF's
        // guidance (`--max-workers=1 --no-isolate`), run all files in ONE worker
        // with shared storage. Tests use unique DO names / random gameIds so
        // shared storage never collides.
        singleWorker: true,
        isolatedStorage: false,
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
