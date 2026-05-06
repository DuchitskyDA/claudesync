# claudesync MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build claudesync — Electron desktop app with two buttons that run `git pull` + ОС-specific install script in a configured ai-config repo, streaming output to a log console.

**Architecture:** Three-process Electron (main + preload + renderer). Main hosts pure-Node modules (`runner.ts` for shell exec, `config.ts` for userData JSON, `ipc.ts` for handlers). Renderer is React + Tailwind. preload bridges typed `AppApi`. Logic in main is TDD'd via Vitest with mocked `child_process`; UI is exercised manually.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, Tailwind 3, Vitest, electron-builder, GitHub Actions.

---

## Pre-conditions

- Working directory: `C:\Users\DanyaLera\Documents\claudesync`
- Repo already initialized with one commit on `main` (the design spec).
- Node.js LTS (≥20) installed; `npm` in PATH.
- Git installed.

---

## File structure (final state after this plan)

```
claudesync/
├── .github/workflows/ci.yml              # Task 22
├── .github/workflows/release.yml         # Task 23
├── .gitignore                            # Task 1
├── .prettierrc                           # Task 1
├── .eslintrc.cjs                         # Task 1
├── LICENSE                               # Task 24
├── README.md                             # Task 24
├── docs/superpowers/specs/...            # already exists
├── docs/superpowers/plans/...            # this file
├── electron.vite.config.ts               # Task 1
├── electron-builder.yml                  # Task 21
├── index.html                            # Task 1
├── package.json                          # Task 1, updated through plan
├── tailwind.config.js                    # Task 2
├── postcss.config.js                     # Task 2
├── tsconfig.json                         # Task 1
├── tsconfig.node.json                    # Task 1
├── vitest.config.ts                      # Task 3
├── src/
│   ├── shared/
│   │   └── api.ts                        # Task 4
│   ├── main/
│   │   ├── index.ts                      # Task 1 stub, Task 11 final
│   │   ├── runner.ts                     # Task 5–7
│   │   ├── config.ts                     # Task 8–9
│   │   └── ipc.ts                        # Task 10–11
│   ├── preload/
│   │   └── index.ts                      # Task 10
│   └── renderer/
│       ├── main.tsx                      # Task 12
│       ├── App.tsx                       # Task 13–17
│       ├── styles.css                    # Task 2
│       ├── components/
│       │   ├── UpdateButton.tsx          # Task 14
│       │   ├── LogConsole.tsx            # Task 15
│       │   ├── Settings.tsx              # Task 16
│       │   └── Header.tsx                # Task 17
│       └── hooks/
│           └── useAppState.ts            # Task 13
└── tests/
    └── main/
        ├── runner.test.ts                # Task 5–7
        ├── config.test.ts                # Task 8–9
        └── ipc.test.ts                   # Task 11
```

---

## Phase 1 — Scaffold

### Task 1: Initialize Electron + Vite + TypeScript scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `electron.vite.config.ts`, `index.html`, `.gitignore`, `.prettierrc`, `.eslintrc.cjs`
- Create: `src/main/index.ts` (stub), `src/preload/index.ts` (empty), `src/renderer/main.tsx` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claudesync",
  "version": "0.1.0",
  "description": "Sync Claude Code configs across machines",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src tests --ext .ts,.tsx",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
    "dist": "electron-vite build && electron-builder",
    "dist:mac": "electron-vite build && electron-builder --mac",
    "dist:win": "electron-vite build && electron-builder --win",
    "dist:linux": "electron-vite build && electron-builder --linux"
  },
  "license": "MIT",
  "author": "Danila Dutsitsky <dotaunleav@gmail.com>",
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^32.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^2.3.0",
    "eslint": "^9.0.0",
    "prettier": "^3.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (renderer + shared)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@renderer/*": ["src/renderer/*"]
    }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*", "src/preload/**/*"]
}
```

- [ ] **Step 3: Create `tsconfig.node.json`** (main process)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/main/**/*", "src/shared/**/*", "tests/main/**/*", "electron.vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create `electron.vite.config.ts`**

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
  },
})
```

- [ ] **Step 5: Create `src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>claudesync</title>
  </head>
  <body class="bg-neutral-50 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/main/index.ts`** (minimal stub — opens window)

`"type": "module"` in package.json means ESM, so `__dirname` is unavailable — derive it from `import.meta.url`.

```ts
import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 7: Create `src/preload/index.ts`** (empty for now)

```ts
// contextBridge wiring lands in Task 10
export {}
```

- [ ] **Step 8: Create `src/renderer/main.tsx`** (stub)

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'

function App() {
  return <div className="p-8">claudesync — scaffold OK</div>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 9: Create `.gitignore`**

```
node_modules
dist
out
*.log
.DS_Store
.vscode/*
!.vscode/extensions.json
.env
.env.*
!.env.example
release/
```

- [ ] **Step 10: Create `.prettierrc`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 11: Create `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { node: true, browser: true, es2022: true },
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  ignorePatterns: ['out', 'dist', 'release', 'node_modules'],
}
```

- [ ] **Step 12: Install dependencies**

Run: `npm install`
Expected: completes without errors (warnings about peer deps OK).

- [ ] **Step 13: Verify dev mode boots**

Run: `npm run dev`
Expected: Electron window opens with text "claudesync — scaffold OK". Close window with Ctrl+C in terminal.

- [ ] **Step 14: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No output (success).

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "scaffold: electron-vite + react + ts boots a window"
```

---

### Task 2: Tailwind CSS

**Files:**
- Create: `tailwind.config.js`, `postcss.config.js`, `src/renderer/styles.css`
- Modify: `src/renderer/main.tsx` (import styles)

- [ ] **Step 1: Install Tailwind**

Run: `npm install -D tailwindcss@^3.4.0 postcss@^8.4.0 autoprefixer@^10.4.0`
Expected: completes without errors.

- [ ] **Step 2: Create `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 3: Create `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 4: Create `src/renderer/styles.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Import styles in `src/renderer/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

function App() {
  return <div className="p-8 font-sans">claudesync — Tailwind OK</div>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 6: Verify dev**

Run: `npm run dev`
Expected: window shows text styled with Tailwind padding. Close.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "scaffold: add tailwindcss"
```

---

### Task 3: Vitest setup

**Files:**
- Create: `vitest.config.ts`, `tests/main/smoke.test.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
})
```

- [ ] **Step 2: Create smoke test `tests/main/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('vitest', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "scaffold: vitest with smoke test"
```

---

## Phase 2 — Shared types and runner (TDD)

### Task 4: Shared API types

**Files:**
- Create: `src/shared/api.ts`

- [ ] **Step 1: Create `src/shared/api.ts`**

```ts
export type LogLevel = 'info' | 'error' | 'success'
export type LogLine = { time: string; text: string; level: LogLevel }
export type Platform = 'macos' | 'windows'
export type RunResult = { ok: boolean; exitCode: number; error?: string }
export type AppConfig = { repoPath: string | null }
export type SetConfigResult = { ok: boolean; error?: string }

export interface AppApi {
  runUpdate(platform: Platform): Promise<RunResult>
  getConfig(): Promise<AppConfig>
  setConfig(c: AppConfig): Promise<SetConfigResult>
  pickRepoPath(): Promise<string | null>
  onLog(callback: (line: LogLine) => void): () => void
  getPlatform(): Promise<NodeJS.Platform>
}

declare global {
  interface Window {
    api: AppApi
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(shared): AppApi types"
```

---

### Task 5: `runner.ts` — happy path (TDD)

**Files:**
- Create: `src/main/runner.ts`, `tests/main/runner.test.ts`

- [ ] **Step 1: Write failing test for happy path**

Create `tests/main/runner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { runCommand } from '../../src/main/runner'
import type { LogLine } from '../../src/shared/api'

function fakeProc(stdoutChunks: string[], stderrChunks: string[], exitCode: number) {
  const proc = new EventEmitter() as any
  proc.stdout = Readable.from(stdoutChunks)
  proc.stderr = Readable.from(stderrChunks)
  setTimeout(() => proc.emit('exit', exitCode), 0)
  return proc
}

beforeEach(() => {
  spawnMock.mockReset()
})

describe('runCommand', () => {
  it('streams stdout lines as info and resolves with exit code 0', async () => {
    spawnMock.mockReturnValue(fakeProc(['hello\nworld\n'], [], 0))
    const lines: LogLine[] = []
    const result = await runCommand('echo', ['hi'], { cwd: '/tmp', onLine: (l) => lines.push(l) })
    expect(result.exitCode).toBe(0)
    expect(lines.map((l) => l.text)).toEqual(['hello', 'world'])
    expect(lines.every((l) => l.level === 'info')).toBe(true)
    expect(lines[0]!.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module ... runner`.

- [ ] **Step 3: Implement minimal `src/main/runner.ts`**

```ts
import { spawn } from 'node:child_process'
import type { LogLine } from '@shared/api'

export type RunOptions = {
  cwd: string
  onLine: (line: LogLine) => void
}

export type RunCommandResult = { exitCode: number }

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function streamToLines(
  stream: NodeJS.ReadableStream,
  level: 'info' | 'error',
  onLine: (line: LogLine) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let buf = ''
    stream.setEncoding?.('utf8')
    stream.on('data', (chunk: string) => {
      buf += chunk
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      for (const part of parts) {
        onLine({ time: nowHHMMSS(), text: part, level })
      }
    })
    stream.on('end', () => {
      if (buf.length > 0) onLine({ time: nowHHMMSS(), text: buf, level })
      resolve()
    })
  })
}

export function runCommand(
  cmd: string,
  args: string[],
  opts: RunOptions,
): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: opts.cwd, shell: false })
    const outDone = streamToLines(proc.stdout, 'info', opts.onLine)
    const errDone = streamToLines(proc.stderr, 'error', opts.onLine)
    proc.on('error', (err) => reject(err))
    proc.on('exit', async (code) => {
      await Promise.all([outDone, errDone])
      resolve({ exitCode: code ?? 1 })
    })
  })
}
```

- [ ] **Step 4: Run — should pass**

Run: `npm test`
Expected: 2 passed (smoke + runner happy path).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(main): runCommand streams stdout lines"
```

---

### Task 6: `runner.ts` — stderr, non-zero exit, ENOENT

**Files:**
- Modify: `tests/main/runner.test.ts`
- Modify: `src/main/runner.ts` (no changes expected — already supports these)

- [ ] **Step 1: Add failing tests**

Append to `tests/main/runner.test.ts`:

```ts
describe('runCommand stderr and exit codes', () => {
  it('streams stderr as error level', async () => {
    spawnMock.mockReturnValue(fakeProc([], ['oops\n'], 0))
    const lines: LogLine[] = []
    await runCommand('false', [], { cwd: '/tmp', onLine: (l) => lines.push(l) })
    expect(lines).toEqual([expect.objectContaining({ text: 'oops', level: 'error' })])
  })

  it('resolves with non-zero exit code', async () => {
    spawnMock.mockReturnValue(fakeProc([], ['bad\n'], 2))
    const lines: LogLine[] = []
    const r = await runCommand('false', [], { cwd: '/tmp', onLine: (l) => lines.push(l) })
    expect(r.exitCode).toBe(2)
  })

  it('rejects when spawn emits error (ENOENT)', async () => {
    const proc = new EventEmitter() as any
    proc.stdout = Readable.from([])
    proc.stderr = Readable.from([])
    setTimeout(() => proc.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })), 0)
    spawnMock.mockReturnValue(proc)
    await expect(runCommand('nope', [], { cwd: '/tmp', onLine: () => {} })).rejects.toThrow('ENOENT')
  })

  it('flushes trailing partial line without newline', async () => {
    spawnMock.mockReturnValue(fakeProc(['no-trailing-newline'], [], 0))
    const lines: LogLine[] = []
    await runCommand('x', [], { cwd: '/tmp', onLine: (l) => lines.push(l) })
    expect(lines.map((l) => l.text)).toEqual(['no-trailing-newline'])
  })
})
```

- [ ] **Step 2: Run — should pass without changes (impl already supports)**

Run: `npm test`
Expected: 5 passed.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(main): runCommand stderr, exit codes, ENOENT, partial line"
```

---

### Task 7: `runner.ts` — concurrency lock helper

**Files:**
- Modify: `src/main/runner.ts`
- Modify: `tests/main/runner.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/main/runner.test.ts`:

```ts
import { withRunLock } from '../../src/main/runner'

describe('withRunLock', () => {
  it('rejects parallel call with Already running error', async () => {
    let release!: () => void
    const inFlight = new Promise<void>((r) => (release = r))
    const first = withRunLock(async () => {
      await inFlight
      return 'ok' as const
    })
    await expect(withRunLock(async () => 'second' as const)).rejects.toThrow('Already running')
    release()
    await expect(first).resolves.toBe('ok')
  })

  it('releases lock after success', async () => {
    await withRunLock(async () => undefined)
    await expect(withRunLock(async () => 'next' as const)).resolves.toBe('next')
  })

  it('releases lock after failure', async () => {
    await expect(withRunLock(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(withRunLock(async () => 'after' as const)).resolves.toBe('after')
  })
})
```

- [ ] **Step 2: Run — should fail**

Run: `npm test`
Expected: FAIL — `withRunLock` not exported.

- [ ] **Step 3: Add implementation to `src/main/runner.ts`**

Append:

```ts
let running = false

export async function withRunLock<T>(task: () => Promise<T>): Promise<T> {
  if (running) throw new Error('Already running')
  running = true
  try {
    return await task()
  } finally {
    running = false
  }
}
```

- [ ] **Step 4: Run — should pass**

Run: `npm test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(main): withRunLock for concurrency control"
```

---

## Phase 3 — Config

### Task 8: `config.ts` — read/write JSON

**Files:**
- Create: `src/main/config.ts`, `tests/main/config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/main/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfig, writeConfig } from '../../src/main/config'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudesync-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readConfig', () => {
  it('returns {repoPath: null} when file does not exist', () => {
    expect(readConfig(join(dir, 'config.json'))).toEqual({ repoPath: null })
  })

  it('returns {repoPath: null} on invalid JSON', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, '{not json')
    expect(readConfig(f)).toEqual({ repoPath: null })
  })

  it('reads valid config', () => {
    const f = join(dir, 'config.json')
    writeFileSync(f, JSON.stringify({ repoPath: '/some/path' }))
    expect(readConfig(f)).toEqual({ repoPath: '/some/path' })
  })
})

describe('writeConfig', () => {
  it('writes JSON atomically (round-trip)', () => {
    const f = join(dir, 'config.json')
    writeConfig(f, { repoPath: '/abc' })
    expect(existsSync(f)).toBe(true)
    expect(readConfig(f)).toEqual({ repoPath: '/abc' })
  })
})
```

- [ ] **Step 2: Run — should fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/main/config.ts`**

```ts
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import type { AppConfig } from '@shared/api'

export function readConfig(filePath: string): AppConfig {
  if (!existsSync(filePath)) return { repoPath: null }
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return { repoPath: typeof parsed.repoPath === 'string' ? parsed.repoPath : null }
  } catch {
    return { repoPath: null }
  }
}

export function writeConfig(filePath: string, cfg: AppConfig): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  renameSync(tmp, filePath)
}
```

- [ ] **Step 4: Run — should pass**

Run: `npm test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(main): config read/write with atomic write"
```

---

### Task 9: `config.ts` — validate repoPath

**Files:**
- Modify: `src/main/config.ts`, `tests/main/config.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/main/config.test.ts`:

```ts
import { mkdirSync } from 'node:fs'
import { validateRepoPath } from '../../src/main/config'

describe('validateRepoPath', () => {
  it('rejects non-existent path', () => {
    const r = validateRepoPath(join(dir, 'nope'))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not found|does not exist/i)
  })

  it('rejects path that is not a git repo', () => {
    const repo = join(dir, 'not-git')
    mkdirSync(repo)
    const r = validateRepoPath(repo)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/git repository/i)
  })

  it('rejects git repo without install scripts', () => {
    const repo = join(dir, 'git-only')
    mkdirSync(repo)
    mkdirSync(join(repo, '.git'))
    const r = validateRepoPath(repo)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/install\.sh|install\.ps1/i)
  })

  it('accepts git repo with install.sh', () => {
    const repo = join(dir, 'ok-mac')
    mkdirSync(repo)
    mkdirSync(join(repo, '.git'))
    writeFileSync(join(repo, 'install.sh'), '#!/usr/bin/env bash\n')
    expect(validateRepoPath(repo)).toEqual({ ok: true })
  })

  it('accepts git repo with install.ps1', () => {
    const repo = join(dir, 'ok-win')
    mkdirSync(repo)
    mkdirSync(join(repo, '.git'))
    writeFileSync(join(repo, 'install.ps1'), '# ps')
    expect(validateRepoPath(repo)).toEqual({ ok: true })
  })

  it('accepts .git as a file (worktree/submodule case)', () => {
    const repo = join(dir, 'worktree')
    mkdirSync(repo)
    writeFileSync(join(repo, '.git'), 'gitdir: ../main/.git/worktrees/foo')
    writeFileSync(join(repo, 'install.sh'), '#!/usr/bin/env bash\n')
    expect(validateRepoPath(repo)).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run — should fail**

Run: `npm test`
Expected: FAIL — `validateRepoPath` not exported.

- [ ] **Step 3: Add to `src/main/config.ts`**

Append:

```ts
import { statSync } from 'node:fs'
import { join } from 'node:path'

export type ValidationResult = { ok: true } | { ok: false; error: string }

export function validateRepoPath(p: string): ValidationResult {
  if (!existsSync(p)) return { ok: false, error: `Path not found: ${p}` }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(p)
  } catch (e) {
    return { ok: false, error: `Cannot stat path: ${(e as Error).message}` }
  }
  if (!st.isDirectory()) return { ok: false, error: `Not a directory: ${p}` }
  if (!existsSync(join(p, '.git'))) {
    return { ok: false, error: 'Folder is not a git repository (no .git inside)' }
  }
  if (!existsSync(join(p, 'install.sh')) && !existsSync(join(p, 'install.ps1'))) {
    return {
      ok: false,
      error: 'Repo has neither install.sh nor install.ps1 in root',
    }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run — should pass**

Run: `npm test`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(main): validateRepoPath checks .git and install scripts"
```

---

## Phase 4 — IPC

### Task 10: preload contextBridge

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, LogLine, AppConfig, Platform, RunResult, SetConfigResult } from '@shared/api'

const api: AppApi = {
  runUpdate: (platform: Platform): Promise<RunResult> =>
    ipcRenderer.invoke('run-update', platform),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke('get-config'),
  setConfig: (c: AppConfig): Promise<SetConfigResult> => ipcRenderer.invoke('set-config', c),
  pickRepoPath: (): Promise<string | null> => ipcRenderer.invoke('pick-repo-path'),
  onLog: (callback: (line: LogLine) => void): (() => void) => {
    const listener = (_: unknown, line: LogLine) => callback(line)
    ipcRenderer.on('log', listener)
    return () => ipcRenderer.off('log', listener)
  },
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('get-platform'),
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(preload): expose AppApi via contextBridge"
```

---

### Task 11: IPC handlers + main `index.ts` integration

**Files:**
- Create: `src/main/ipc.ts`, `tests/main/ipc.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write failing test for `runUpdateHandler`**

Create `tests/main/ipc.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runCommandMock = vi.fn()
const validateMock = vi.fn()
const readConfigMock = vi.fn()
const existsSyncMock = vi.fn()

vi.mock('../../src/main/runner', async () => {
  const actual = await vi.importActual<any>('../../src/main/runner')
  return { ...actual, runCommand: runCommandMock }
})
vi.mock('../../src/main/config', () => ({
  readConfig: readConfigMock,
  validateRepoPath: validateMock,
}))
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<any>('node:fs')
  return { ...actual, existsSync: existsSyncMock }
})

import { runUpdateHandler } from '../../src/main/ipc'

beforeEach(() => {
  runCommandMock.mockReset()
  validateMock.mockReset()
  readConfigMock.mockReset()
  existsSyncMock.mockReset()
})

describe('runUpdateHandler', () => {
  it('rejects when current OS does not match requested platform', async () => {
    const r = await runUpdateHandler('macos', { currentPlatform: 'win32', configPath: '/x', emit: () => {} })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/platform/i)
  })

  it('rejects when repoPath is not configured', async () => {
    readConfigMock.mockReturnValue({ repoPath: null })
    const r = await runUpdateHandler('windows', { currentPlatform: 'win32', configPath: '/x', emit: () => {} })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/repo path/i)
  })

  it('rejects when repoPath fails validation', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: false, error: 'broken' })
    const r = await runUpdateHandler('windows', { currentPlatform: 'win32', configPath: '/x', emit: () => {} })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('broken')
  })

  it('rejects when install script missing for platform', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: true })
    existsSyncMock.mockReturnValue(false)
    const r = await runUpdateHandler('windows', { currentPlatform: 'win32', configPath: '/x', emit: () => {} })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/install\.ps1 not found/i)
  })

  it('runs git pull then install on success', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: true })
    existsSyncMock.mockReturnValue(true)
    runCommandMock.mockResolvedValueOnce({ exitCode: 0 }).mockResolvedValueOnce({ exitCode: 0 })
    const r = await runUpdateHandler('macos', { currentPlatform: 'darwin', configPath: '/x', emit: () => {} })
    expect(r).toEqual({ ok: true, exitCode: 0 })
    expect(runCommandMock).toHaveBeenCalledTimes(2)
    expect(runCommandMock.mock.calls[0]![0]).toBe('git')
    expect(runCommandMock.mock.calls[1]![0]).toBe('bash')
  })

  it('aborts and returns failure if git pull fails', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: true })
    existsSyncMock.mockReturnValue(true)
    runCommandMock.mockResolvedValueOnce({ exitCode: 1 })
    const r = await runUpdateHandler('macos', { currentPlatform: 'darwin', configPath: '/x', emit: () => {} })
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBe(1)
    expect(runCommandMock).toHaveBeenCalledTimes(1)
  })

  it('uses powershell on windows', async () => {
    readConfigMock.mockReturnValue({ repoPath: '/repo' })
    validateMock.mockReturnValue({ ok: true })
    existsSyncMock.mockReturnValue(true)
    runCommandMock.mockResolvedValue({ exitCode: 0 })
    await runUpdateHandler('windows', { currentPlatform: 'win32', configPath: '/x', emit: () => {} })
    expect(runCommandMock.mock.calls[1]![0]).toBe('powershell')
    expect(runCommandMock.mock.calls[1]![1]).toEqual(['-ExecutionPolicy', 'Bypass', '-File', expect.stringContaining('install.ps1')])
  })
})
```

- [ ] **Step 2: Run — should fail**

Run: `npm test`
Expected: FAIL — `runUpdateHandler` not found.

- [ ] **Step 3: Create `src/main/ipc.ts`**

```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import type { LogLine, Platform, RunResult, AppConfig, SetConfigResult } from '@shared/api'
import { runCommand, withRunLock } from './runner'
import { readConfig, writeConfig, validateRepoPath } from './config'

export type RunUpdateDeps = {
  currentPlatform: NodeJS.Platform
  configPath: string
  emit: (line: LogLine) => void
}

function nowHHMMSS(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function platformMatches(target: Platform, current: NodeJS.Platform): boolean {
  return (target === 'macos' && current === 'darwin') || (target === 'windows' && current === 'win32')
}

export async function runUpdateHandler(target: Platform, deps: RunUpdateDeps): Promise<RunResult> {
  if (!platformMatches(target, deps.currentPlatform)) {
    return { ok: false, exitCode: -1, error: `Platform mismatch: button ${target}, OS ${deps.currentPlatform}` }
  }
  const cfg = readConfig(deps.configPath)
  if (!cfg.repoPath) {
    return { ok: false, exitCode: -1, error: 'Repo path not configured. Open Settings and choose a folder.' }
  }
  const v = validateRepoPath(cfg.repoPath)
  if (!v.ok) {
    return { ok: false, exitCode: -1, error: v.error }
  }
  const scriptName = target === 'macos' ? 'install.sh' : 'install.ps1'
  const scriptPath = join(cfg.repoPath, scriptName)
  if (!existsSync(scriptPath)) {
    return { ok: false, exitCode: -1, error: `${scriptName} not found at ${cfg.repoPath}` }
  }
  return withRunLock(async () => {
    deps.emit({ time: nowHHMMSS(), text: '$ git pull', level: 'info' })
    const pull = await runCommand('git', ['pull'], { cwd: cfg.repoPath!, onLine: deps.emit })
    if (pull.exitCode !== 0) {
      deps.emit({ time: nowHHMMSS(), text: `✗ git pull failed (exit ${pull.exitCode})`, level: 'error' })
      return { ok: false, exitCode: pull.exitCode }
    }
    deps.emit({ time: nowHHMMSS(), text: `$ ${scriptName}`, level: 'info' })
    const inst =
      target === 'macos'
        ? await runCommand('bash', [scriptPath], { cwd: cfg.repoPath!, onLine: deps.emit })
        : await runCommand(
            'powershell',
            ['-ExecutionPolicy', 'Bypass', '-File', scriptPath],
            { cwd: cfg.repoPath!, onLine: deps.emit },
          )
    if (inst.exitCode !== 0) {
      deps.emit({ time: nowHHMMSS(), text: `✗ install failed (exit ${inst.exitCode})`, level: 'error' })
      return { ok: false, exitCode: inst.exitCode }
    }
    deps.emit({ time: nowHHMMSS(), text: '✓ DONE (exit 0)', level: 'success' })
    return { ok: true, exitCode: 0 }
  }).catch((e: Error) => ({ ok: false, exitCode: -1, error: e.message }))
}

export function registerIpc(window: BrowserWindow): void {
  const configPath = join(app.getPath('userData'), 'config.json')
  const emit = (line: LogLine) => {
    if (!window.isDestroyed()) window.webContents.send('log', line)
  }

  ipcMain.handle('run-update', (_e, platform: Platform) =>
    runUpdateHandler(platform, { currentPlatform: process.platform, configPath, emit }),
  )

  ipcMain.handle('get-config', (): AppConfig => readConfig(configPath))

  ipcMain.handle('set-config', (_e, cfg: AppConfig): SetConfigResult => {
    if (!cfg.repoPath) return { ok: false, error: 'Empty repo path' }
    const v = validateRepoPath(cfg.repoPath)
    if (!v.ok) return { ok: false, error: v.error }
    writeConfig(configPath, cfg)
    return { ok: true }
  })

  ipcMain.handle('pick-repo-path', async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0] ?? null
  })

  ipcMain.handle('get-platform', (): NodeJS.Platform => process.platform)
}
```

- [ ] **Step 4: Run — should pass**

Run: `npm test`
Expected: all passed.

- [ ] **Step 5: Wire IPC into `src/main/index.ts`**

Replace contents:

```ts
import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { registerIpc } from './ipc'

const __dirname = dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 520,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerIpc(win)
  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 6: Verify build and dev launch**

Run: `npm run build`
Expected: success.

Run: `npm run dev`
Expected: window opens, no errors in DevTools console.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(main): IPC handlers and runUpdate orchestration"
```

---

## Phase 5 — Renderer UI

### Task 12: Renderer entry uses `App.tsx`

**Files:**
- Modify: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx` (skeleton)

- [ ] **Step 1: Replace `src/renderer/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 2: Create `src/renderer/App.tsx`** (skeleton)

```tsx
import React from 'react'

export function App() {
  return <div className="p-8">claudesync</div>
}
```

- [ ] **Step 3: Verify dev**

Run: `npm run dev`
Expected: window shows "claudesync", DevTools no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(renderer): App entry point"
```

---

### Task 13: `useAppState` hook (state + IPC subscription)

**Files:**
- Create: `src/renderer/hooks/useAppState.ts`

- [ ] **Step 1: Create `src/renderer/hooks/useAppState.ts`**

```ts
import { useEffect, useReducer } from 'react'
import type { LogLine, RunResult, Platform } from '@shared/api'

export type AppState = {
  repoPath: string | null
  platform: NodeJS.Platform | null
  isRunning: boolean
  log: LogLine[]
  settingsOpen: boolean
}

type Action =
  | { type: 'set-config'; repoPath: string | null }
  | { type: 'set-platform'; platform: NodeJS.Platform }
  | { type: 'run-start' }
  | { type: 'run-end' }
  | { type: 'append-log'; line: LogLine }
  | { type: 'clear-log' }
  | { type: 'open-settings' }
  | { type: 'close-settings' }

const initial: AppState = {
  repoPath: null,
  platform: null,
  isRunning: false,
  log: [],
  settingsOpen: false,
}

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'set-config':
      return { ...s, repoPath: a.repoPath }
    case 'set-platform':
      return { ...s, platform: a.platform }
    case 'run-start':
      return { ...s, isRunning: true, log: [] }
    case 'run-end':
      return { ...s, isRunning: false }
    case 'append-log':
      return { ...s, log: [...s.log, a.line] }
    case 'clear-log':
      return { ...s, log: [] }
    case 'open-settings':
      return { ...s, settingsOpen: true }
    case 'close-settings':
      return { ...s, settingsOpen: false }
  }
}

export function useAppState() {
  const [state, dispatch] = useReducer(reducer, initial)

  useEffect(() => {
    void window.api.getPlatform().then((p) => dispatch({ type: 'set-platform', platform: p }))
    void window.api.getConfig().then((c) => {
      dispatch({ type: 'set-config', repoPath: c.repoPath })
      if (!c.repoPath) dispatch({ type: 'open-settings' })
    })
    const unsub = window.api.onLog((line) => dispatch({ type: 'append-log', line }))
    return () => unsub()
  }, [])

  const runUpdate = async (platform: Platform): Promise<RunResult> => {
    dispatch({ type: 'run-start' })
    try {
      const r = await window.api.runUpdate(platform)
      if (!r.ok && r.error) {
        dispatch({ type: 'append-log', line: { time: now(), text: r.error, level: 'error' } })
      }
      return r
    } finally {
      dispatch({ type: 'run-end' })
    }
  }

  return {
    state,
    runUpdate,
    clearLog: () => dispatch({ type: 'clear-log' }),
    openSettings: () => dispatch({ type: 'open-settings' }),
    closeSettings: () => dispatch({ type: 'close-settings' }),
    setRepoPath: (p: string | null) => dispatch({ type: 'set-config', repoPath: p }),
  }
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(renderer): useAppState hook with IPC bindings"
```

---

### Task 14: `UpdateButton` component

**Files:**
- Create: `src/renderer/components/UpdateButton.tsx`

- [ ] **Step 1: Create `src/renderer/components/UpdateButton.tsx`**

```tsx
import React from 'react'
import type { Platform } from '@shared/api'

type Props = {
  platform: Platform
  currentPlatform: NodeJS.Platform | null
  isRunning: boolean
  hasRepoPath: boolean
  onClick: () => void
}

const labels: Record<Platform, string> = {
  macos: 'Обновить (macOS)',
  windows: 'Обновить (Windows)',
}

const matchOs: Record<Platform, NodeJS.Platform> = {
  macos: 'darwin',
  windows: 'win32',
}

export function UpdateButton({ platform, currentPlatform, isRunning, hasRepoPath, onClick }: Props) {
  const wrongOs = currentPlatform !== null && currentPlatform !== matchOs[platform]
  const disabled = isRunning || wrongOs || !hasRepoPath
  const reason = wrongOs
    ? `Available only on ${platform === 'macos' ? 'macOS' : 'Windows'}`
    : !hasRepoPath
      ? 'Set repo path first'
      : isRunning
        ? 'Already running'
        : ''

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={reason}
      className="rounded-md bg-blue-600 px-4 py-2 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 dark:disabled:bg-neutral-700"
    >
      {labels[platform]}
    </button>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(renderer): UpdateButton component"
```

---

### Task 15: `LogConsole` component

**Files:**
- Create: `src/renderer/components/LogConsole.tsx`

- [ ] **Step 1: Create `src/renderer/components/LogConsole.tsx`**

```tsx
import React, { useEffect, useRef } from 'react'
import type { LogLine } from '@shared/api'

type Props = {
  lines: LogLine[]
  onClear: () => void
}

const colorFor = (lvl: LogLine['level']): string =>
  lvl === 'error'
    ? 'text-red-500'
    : lvl === 'success'
      ? 'text-emerald-500'
      : 'text-neutral-700 dark:text-neutral-300'

export function LogConsole({ lines, onClear }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-700">
        <span>Log</span>
        <button
          onClick={onClear}
          className="rounded px-2 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          Clear
        </button>
      </div>
      <div
        ref={ref}
        className="flex-1 overflow-auto bg-neutral-100 p-2 font-mono text-xs leading-relaxed dark:bg-neutral-900"
      >
        {lines.length === 0 ? (
          <div className="text-neutral-400">No output yet.</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={colorFor(l.level)}>
              <span className="text-neutral-400">[{l.time}]</span> {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(renderer): LogConsole component"
```

---

### Task 16: `Settings` modal component

**Files:**
- Create: `src/renderer/components/Settings.tsx`

- [ ] **Step 1: Create `src/renderer/components/Settings.tsx`**

```tsx
import React, { useState } from 'react'

type Props = {
  open: boolean
  initialRepoPath: string | null
  onClose: () => void
  onSaved: (repoPath: string) => void
}

export function Settings({ open, initialRepoPath, onClose, onSaved }: Props) {
  const [path, setPath] = useState(initialRepoPath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const browse = async () => {
    const picked = await window.api.pickRepoPath()
    if (picked) {
      setPath(picked)
      setError(null)
    }
  }

  const save = async () => {
    setError(null)
    setBusy(true)
    try {
      const r = await window.api.setConfig({ repoPath: path })
      if (!r.ok) {
        setError(r.error ?? 'Unknown error')
        return
      }
      onSaved(path)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-5 shadow-lg dark:bg-neutral-800">
        <h2 className="mb-3 text-base font-semibold">Settings</h2>
        <label className="mb-1 block text-xs text-neutral-500">Path to ai-config repo</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/ai"
            className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
          />
          <button
            onClick={browse}
            type="button"
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-700"
          >
            Browse…
          </button>
        </div>
        {error && <div className="mt-2 text-sm text-red-500">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy || path.trim() === ''}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:bg-neutral-400"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(renderer): Settings modal"
```

---

### Task 17: `Header` and final `App.tsx` wiring

**Files:**
- Create: `src/renderer/components/Header.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create `src/renderer/components/Header.tsx`**

```tsx
import React from 'react'

type Props = {
  repoPath: string | null
  onOpenSettings: () => void
}

export function Header({ repoPath, onOpenSettings }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-700">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold">claudesync</h1>
        <button
          onClick={onOpenSettings}
          className="truncate rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          title={repoPath ?? 'Click to set'}
        >
          {repoPath ?? 'no repo configured'}
        </button>
      </div>
      <button
        onClick={onOpenSettings}
        aria-label="Settings"
        className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700"
      >
        ⚙
      </button>
    </header>
  )
}
```

- [ ] **Step 2: Replace `src/renderer/App.tsx`**

```tsx
import React from 'react'
import { useAppState } from './hooks/useAppState'
import { UpdateButton } from './components/UpdateButton'
import { LogConsole } from './components/LogConsole'
import { Settings } from './components/Settings'
import { Header } from './components/Header'

export function App() {
  const { state, runUpdate, clearLog, openSettings, closeSettings, setRepoPath } = useAppState()
  return (
    <div className="flex h-screen flex-col">
      <Header repoPath={state.repoPath} onOpenSettings={openSettings} />
      <div className="flex items-center gap-3 px-4 py-3">
        <UpdateButton
          platform="macos"
          currentPlatform={state.platform}
          isRunning={state.isRunning}
          hasRepoPath={state.repoPath !== null}
          onClick={() => runUpdate('macos')}
        />
        <UpdateButton
          platform="windows"
          currentPlatform={state.platform}
          isRunning={state.isRunning}
          hasRepoPath={state.repoPath !== null}
          onClick={() => runUpdate('windows')}
        />
      </div>
      <div className="flex-1 overflow-hidden border-t border-neutral-200 dark:border-neutral-700">
        <LogConsole lines={state.log} onClear={clearLog} />
      </div>
      <Settings
        open={state.settingsOpen}
        initialRepoPath={state.repoPath}
        onClose={closeSettings}
        onSaved={setRepoPath}
      />
    </div>
  )
}
```

- [ ] **Step 3: Verify dev**

Run: `npm run dev`
Expected:
- Window opens, shows header "claudesync" + repo chip ("no repo configured")
- Settings modal auto-opens (no repoPath)
- Click "Browse…", pick the ai repo folder, Save → modal closes, chip updates
- Click "Обновить (Windows)" (or macOS depending on platform) → log shows `$ git pull`, then output, then `✓ DONE` or `✗ FAILED`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(renderer): wire App with Header, buttons, log, settings"
```

---

## Phase 6 — Manual end-to-end + last-run.log

### Task 18: Persist last 200 log lines to disk

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Modify `emit` in `registerIpc`**

Find the existing `emit` definition in `registerIpc` and replace the function with a version that buffers and writes:

```ts
import { writeFileSync } from 'node:fs'
// ... existing imports ...

const logBuffer: LogLine[] = []
const LOG_LIMIT = 200
const logFile = join(app.getPath('userData'), 'last-run.log')

const emit = (line: LogLine) => {
  if (!window.isDestroyed()) window.webContents.send('log', line)
  logBuffer.push(line)
  if (logBuffer.length > LOG_LIMIT) logBuffer.shift()
  try {
    writeFileSync(
      logFile,
      logBuffer.map((l) => `[${l.time}] ${l.level.toUpperCase()} ${l.text}`).join('\n') + '\n',
    )
  } catch {
    // ignore disk errors
  }
}
```

(Replace the inline `const emit = ...` line in `registerIpc` with this block. Keep everything else.)

- [ ] **Step 2: Verify dev**

Run: `npm run dev`
Trigger any update (or platform-mismatch button to generate an error log).
Check that file exists: `~/Library/Application Support/claudesync/last-run.log` (mac) / `%APPDATA%\claudesync\last-run.log` (Win).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(main): persist last 200 log lines to userData/last-run.log"
```

---

## Phase 7 — Distribution

### Task 19: `electron-builder.yml`

**Files:**
- Create: `electron-builder.yml`
- Create: `build/` (empty placeholder for icons later)

- [ ] **Step 1: Create `electron-builder.yml`**

```yaml
appId: com.duchitskyda.claudesync
productName: claudesync
directories:
  output: release
files:
  - 'out/**/*'
  - 'package.json'
asar: true
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
  category: public.app-category.developer-tools
win:
  target:
    - target: nsis
    - target: portable
linux:
  target:
    - AppImage
  category: Development
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 2: Create empty `build/` placeholder**

```bash
mkdir build
touch build/.gitkeep
```

- [ ] **Step 3: Build for current OS to verify config (smoke)**

Run (Windows): `npm run dist:win`
Run (macOS): `npm run dist:mac`
Run (Linux): `npm run dist:linux`

Expected: `release/` directory contains the installer/AppImage. May print warnings about missing icons — that's OK on MVP.

- [ ] **Step 4: Add `release/` to `.gitignore`** (already there from Task 1)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: electron-builder config for mac/win/linux"
```

---

### Task 20: GitHub Actions — CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "ci: typecheck + lint + test on every push"
```

---

### Task 21: GitHub Actions — release on tag

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ['v*.*.*']

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Build mac
        if: matrix.os == 'macos-latest'
        run: npx electron-builder --mac --publish never
      - name: Build win
        if: matrix.os == 'windows-latest'
        run: npx electron-builder --win --publish never
      - name: Build linux
        if: matrix.os == 'ubuntu-latest'
        run: npx electron-builder --linux --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: claudesync-${{ matrix.os }}
          path: |
            release/*.dmg
            release/*.exe
            release/*.AppImage
            release/*.zip

  publish:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
      - uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          generate_release_notes: true
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "ci: release workflow builds matrix and publishes GitHub Release"
```

---

### Task 22: README + LICENSE

**Files:**
- Create: `README.md`, `LICENSE`

- [ ] **Step 1: Create `LICENSE`** (MIT, year 2026, author Danila Dutsitsky)

```
MIT License

Copyright (c) 2026 Danila Dutsitsky

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create `README.md`**

```markdown
# claudesync

Desktop app to sync Claude Code configs (`~/.claude/`) across machines.

Two buttons — one for macOS, one for Windows — run `git pull` in your ai-config repo and then the matching install script. Output streams into a log console; errors are visible inline.

## Install

Download from [Releases](https://github.com/DuchitskyDA/claudesync/releases):

- **macOS:** `claudesync-<version>-arm64.dmg` or `-x64.dmg`. App is unsigned — right-click → Open the first time.
- **Windows:** `claudesync-Setup-<version>.exe` or portable `claudesync-<version>.exe`. SmartScreen may warn — More info → Run anyway.
- **Linux:** `claudesync-<version>.AppImage`. `chmod +x` and run.

## First run

1. Settings modal opens automatically. Click `Browse…` and pick the folder of your ai-config repo (the one with `install.sh` / `install.ps1`).
2. App validates the path: must be a directory with a `.git` and at least one of `install.sh` / `install.ps1`.
3. Click "Обновить" matching your OS — log streams progress.

## Develop

```bash
npm install
npm run dev          # Electron + Vite with HMR
npm test             # vitest
npm run typecheck
npm run lint
npm run dist         # build installers for current OS
```

## License

MIT
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: README and MIT LICENSE"
```

---

### Task 23: Push to GitHub and tag first release

**Files:** none (git operations)

- [ ] **Step 1: Create empty repo on GitHub** (manual, in browser)

Navigate to https://github.com/new, create `DuchitskyDA/claudesync`, public, no README/LICENSE/gitignore initialization.

- [ ] **Step 2: Add remote and push**

```bash
git -C C:/Users/DanyaLera/Documents/claudesync remote add origin git@github.com:DuchitskyDA/claudesync.git
git -C C:/Users/DanyaLera/Documents/claudesync push -u origin main
```

Expected: push succeeds. CI workflow runs on GitHub Actions tab.

- [ ] **Step 3: Wait for CI green**

Open https://github.com/DuchitskyDA/claudesync/actions → confirm `CI` job passes.

- [ ] **Step 4: Tag and push v0.1.0**

```bash
git -C C:/Users/DanyaLera/Documents/claudesync tag v0.1.0
git -C C:/Users/DanyaLera/Documents/claudesync push origin v0.1.0
```

Expected: `Release` workflow triggered, builds 3 OS, publishes Release.

- [ ] **Step 5: Verify Release**

Open https://github.com/DuchitskyDA/claudesync/releases → confirm `v0.1.0` has `.dmg`, `.exe`, `.AppImage` artifacts.

- [ ] **Step 6: Smoke-test downloaded artifact**

On the local Windows machine: download `claudesync-Setup-0.1.0.exe`, install, run, point Settings at `C:\Users\DanyaLera\Documents\_sync-tmp\ai`, click Update — expect green "✓ DONE".

---

## Manual E2E checklist (after Task 23)

| Scenario | Expected |
|---|---|
| First run, no config | Settings modal opens automatically |
| Pick valid ai-config repo, Save | Modal closes, chip shows path |
| Pick non-existent path | Inline error in Settings |
| Pick folder without `.git` | Inline error in Settings |
| Pick folder with `.git` but no install.* | Inline error in Settings |
| Click "Обновить (this OS)" with valid repo | Log streams `$ git pull`, output, `$ install.*`, output, `✓ DONE` |
| Disconnect internet, click Update | git pull fails, log shows red error, install NOT run, `✗ FAILED` |
| Click button of OTHER OS | Disabled, tooltip "Available only on …" |
| Double-click Update fast | Second click ignored (button disabled while running) |
| Open `userData/last-run.log` after a run | Contains last 200 log lines |

---

## Self-review (already performed)

- ✅ Spec coverage: every spec section maps to at least one task
- ✅ No placeholders — every step has the actual code or command
- ✅ Type names consistent across tasks (`AppApi`, `LogLine`, `RunResult`, `runCommand`, `runUpdateHandler`)
- ✅ Each step is bite-sized (≤5 minutes)
- ✅ Each implementation step is followed by run+verify+commit
