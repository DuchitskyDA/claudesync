import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// tests/main/engine/** spin up real git repos and fetch/push over file://
// with an 8s fetchOrigin timeout (src/main/sync/engine/git-ops.ts). On
// Windows that timeout fires flakily when test files run in parallel under
// CPU contention, so the whole suite runs file-sequentially there (~4 min,
// reliably green). Mixed-pool routing (poolMatchGlobs threads+forks) was
// tried first and stalled whole runs on Windows — do not reintroduce it.
// CI (ubuntu) keeps the default parallel forks pool.
const sequentialOnWindows = process.platform === 'win32'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    ...(sequentialOnWindows && { fileParallelism: false }),
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
