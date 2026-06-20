import { describe, it, expect } from 'vitest'
import { isResolverStateFresh } from '../../src/main/sync/engine/resolver'
import type { ResolverState } from '@shared/sync-types'

function state(headSha: string, theirsSha: string): ResolverState {
  return { files: [], baseSha: 'base', headSha, theirsSha }
}

describe('isResolverStateFresh', () => {
  it('is fresh when both HEAD and origin/main match', () => {
    expect(isResolverStateFresh(state('h1', 't1'), 'h1', 't1')).toBe(true)
  })

  it('is stale when HEAD moved', () => {
    expect(isResolverStateFresh(state('h1', 't1'), 'h2', 't1')).toBe(false)
  })

  it('is stale when origin/main moved', () => {
    expect(isResolverStateFresh(state('h1', 't1'), 'h1', 't2')).toBe(false)
  })
})
