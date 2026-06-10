import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    passWithNoTests: true,
    setupFiles: ['./tests/setup.js'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      }
    }
  }
});
