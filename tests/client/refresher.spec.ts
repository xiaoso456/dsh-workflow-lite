/**
 * `src/client/app/refresher.ts`：刷新排成一条队，慢的旧请求盖不掉新的，路上有请求时的刷新并成一次。
 */

import { describe, expect, it } from 'vitest'
import { refresher } from '../../src/client/app/refresher.ts'

/** 手动放行的请求：`calls[i].resolve(v)` 让第 i 次读回来。 */
function backend<A, T>() {
  const calls: { arg: A; resolve(value: T): void; reject(reason: unknown): void }[] = []
  const fetch = (arg: A): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      calls.push({ arg, resolve, reject })
    })
  return { calls, fetch }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('refresher', () => {
  it('路上有请求时再要刷新：只排一次，参数合起来；结果按先后落下', async () => {
    const api = backend<boolean, string>()
    const applied: string[] = []
    const r = refresher({
      fetch: api.fetch,
      apply: (value) => applied.push(value),
      fail: () => undefined,
      merge: (a, b) => a || b,
    })
    void r.run(false)
    void r.run(true)
    void r.run(false)
    expect(api.calls).toHaveLength(1)
    api.calls[0]?.resolve('old')
    await tick()
    // 三次并成一次后来的，强制读（true）合进去了。
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]?.arg).toBe(true)
    api.calls[1]?.resolve('new')
    await tick()
    expect(applied).toEqual(['old', 'new'])
  })

  it('改完东西 await run()：兑现时拿到的是这之后发出的那次读的', async () => {
    const api = backend<undefined, number>()
    let shown = 0
    const r = refresher({ fetch: api.fetch, apply: (v) => (shown = v), fail: () => undefined })
    const first = r.run(undefined)
    // 这时后台改了东西，又要一次刷新。
    const after = r.run(undefined)
    let settled = false
    void after.then(() => (settled = true))
    api.calls[0]?.resolve(1)
    await first
    expect(shown).toBe(1)
    await tick()
    expect(settled).toBe(false)
    api.calls[1]?.resolve(2)
    await after
    expect(shown).toBe(2)
  })

  it('读失败交给 fail，队列接着走', async () => {
    const api = backend<undefined, number>()
    const errors: unknown[] = []
    const applied: number[] = []
    const r = refresher({
      fetch: api.fetch,
      apply: (v) => applied.push(v),
      fail: (e) => errors.push(e),
    })
    const first = r.run(undefined)
    const second = r.run(undefined)
    api.calls[0]?.reject(new Error('boom'))
    await first
    await tick()
    api.calls[1]?.resolve(7)
    await second
    expect(errors).toHaveLength(1)
    expect(applied).toEqual([7])
  })

  it('close 之后：路上的结果丢掉、排着的不再发；open 后照常', async () => {
    const api = backend<undefined, number>()
    const applied: number[] = []
    const r = refresher({ fetch: api.fetch, apply: (v) => applied.push(v), fail: () => undefined })
    const first = r.run(undefined)
    const queued = r.run(undefined)
    r.close()
    api.calls[0]?.resolve(1)
    await first
    await queued
    expect(applied).toEqual([])
    expect(api.calls).toHaveLength(1)
    await r.run(undefined)
    expect(api.calls).toHaveLength(1)
    r.open()
    const again = r.run(undefined)
    api.calls[1]?.resolve(2)
    await again
    expect(applied).toEqual([2])
  })
})
