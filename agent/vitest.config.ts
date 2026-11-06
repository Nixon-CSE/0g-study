import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 10000,
    // Embedding retries back off 1 s, 2 s in production; tests that simulate an outage shouldn't wait.
    env: { ZEROG_EMBED_RETRY_BASE_MS: '1' } }
});
