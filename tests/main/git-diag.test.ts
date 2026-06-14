import { describe, it, expect } from 'vitest'
import { gitDiagArgs, isGitDiagCmd } from '../../src/main/git-diag'

describe('git-diag', () => {
  it('maps each cmd to read-only args', () => {
    expect(gitDiagArgs('status')).toEqual(['status'])
    expect(gitDiagArgs('log')).toEqual(['log', '--oneline', '-10'])
    expect(gitDiagArgs('show')).toEqual(['show', 'HEAD', '--stat'])
    expect(gitDiagArgs('remote')).toEqual(['remote', '-v'])
  })

  it('rejects unknown / unsafe commands', () => {
    expect(isGitDiagCmd('status')).toBe(true)
    expect(isGitDiagCmd('push')).toBe(false)
    expect(isGitDiagCmd('')).toBe(false)
    expect(isGitDiagCmd(123)).toBe(false)
    expect(isGitDiagCmd(null)).toBe(false)
  })
})
