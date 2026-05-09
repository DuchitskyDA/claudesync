import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  validateCursorProject,
  validateCursorProjects,
} from '../../src/main/sync/cursor-validation'

let dir: string
let okPath: string
let okPath2: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'csync-cv-'))
  okPath = join(dir, 'app')
  okPath2 = join(dir, 'app2')
  mkdirSync(okPath)
  mkdirSync(okPath2)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('validateCursorProject (re-export)', () => {
  it('accepts valid project', () => {
    expect(validateCursorProject({ name: 'app', path: okPath }).ok).toBe(true)
  })

  it('rejects names with path separators', () => {
    expect(validateCursorProject({ name: 'a/b', path: okPath }).ok).toBe(false)
    expect(validateCursorProject({ name: 'a\\b', path: okPath }).ok).toBe(false)
  })
})

describe('validateCursorProjects', () => {
  it('accepts an empty list', () => {
    expect(validateCursorProjects([])).toEqual({ ok: true })
  })

  it('accepts unique projects', () => {
    expect(
      validateCursorProjects([
        { name: 'a', path: okPath },
        { name: 'b', path: okPath2 },
      ]),
    ).toEqual({ ok: true })
  })

  it('detects duplicate names at the second occurrence', () => {
    const r = validateCursorProjects([
      { name: 'x', path: okPath },
      { name: 'x', path: okPath2 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.index).toBe(1)
      expect(r.error.key).toBe('cursor.error.duplicateName')
    }
  })

  it('detects duplicate paths at the second occurrence', () => {
    const r = validateCursorProjects([
      { name: 'a', path: okPath },
      { name: 'b', path: okPath },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.index).toBe(1)
      expect(r.error.key).toBe('cursor.error.duplicatePath')
    }
  })

  it('surfaces per-project validation errors', () => {
    const r = validateCursorProjects([
      { name: 'ok', path: okPath },
      { name: 'bad/name', path: okPath2 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.index).toBe(1)
      expect(r.error.key).toBe('cursor.error.nameInvalid')
    }
  })
})
