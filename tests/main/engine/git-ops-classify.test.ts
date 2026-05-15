// tests/main/engine/git-ops-classify.test.ts
import { describe, it, expect } from 'vitest'
import { classifyRemoteError } from '../../../src/main/sync/engine/git-ops'

describe('classifyRemoteError', () => {
  it('network errors', () => {
    expect(classifyRemoteError('Could not resolve host: github.com')).toBe('network')
    expect(classifyRemoteError('TLS handshake error')).toBe('network')
    expect(classifyRemoteError('Connection reset by peer')).toBe('network')
  })
  it('auth errors', () => {
    expect(classifyRemoteError('Authentication failed for https://...')).toBe('auth')
    expect(classifyRemoteError('403 Forbidden')).toBe('auth')
  })
  it('non-fast-forward', () => {
    expect(classifyRemoteError('! [rejected]        main -> main (non-fast-forward)')).toBe('non-ff')
  })
  it('other', () => {
    expect(classifyRemoteError('something weird')).toBe('other')
  })
})
