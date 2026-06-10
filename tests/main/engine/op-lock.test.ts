// tests/main/engine/op-lock.test.ts
import { describe, it, expect } from 'vitest'
import { withExclusiveLock, isLocked } from '../../../src/main/sync/engine/op-lock'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('op-lock', () => {
  it('serializes concurrent operations FIFO', async () => {
    const order: string[] = []
    const a = withExclusiveLock('a', async () => { await sleep(30); order.push('a') })
    const b = withExclusiveLock('b', async () => { order.push('b') })
    const c = withExclusiveLock('c', async () => { order.push('c') })
    await Promise.all([a, b, c])
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('isLocked is true while an operation runs or queues, false after', async () => {
    expect(isLocked()).toBe(false)
    const p = withExclusiveLock('x', async () => { await sleep(20) })
    expect(isLocked()).toBe(true)
    await p
    expect(isLocked()).toBe(false)
  })

  it('an error in one operation does not break the queue', async () => {
    await expect(withExclusiveLock('bad', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(withExclusiveLock('next', async () => 'ok' as const)).resolves.toBe('ok')
    expect(isLocked()).toBe(false)
  })

  it('returns the operation result', async () => {
    await expect(withExclusiveLock('r', async () => 42)).resolves.toBe(42)
  })
})
