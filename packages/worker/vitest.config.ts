import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
// (0.8.x exposes defineWorkersConfig at the /config subpath)

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
})
