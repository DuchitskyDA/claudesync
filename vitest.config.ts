import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// tests/main/engine/** spin up real git repos and shell out to git. Under
// parallel file execution, CPU contention exposes flaky git failures: on
// Windows the fetchOrigin/plumbing timeouts fire under load, and on every
// platform a git 'exit'-before-stdout-'close' race in runGit can yield empty
// output. Both vanish when files run sequentially, so the whole suite runs
// file-sequentially on all platforms (~2-4 min, reliably green) — including
// CI, which previously kept parallel and went flaky as the suite grew.
// Mixed-pool routing (poolMatchGlobs threads+forks) was tried and stalled
// whole runs on Windows — do not reintroduce it.

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
