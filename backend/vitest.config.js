import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 30_000,
    hookTimeout: 300_000, // the in-memory replica set can take ~2 min to start on a busy machine
    fileParallelism: false,
  },
})
