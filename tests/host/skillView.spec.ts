/**
 * `src/host/skillView.ts`：以会话里那个 agent 的眼光看 skill（本地 skill 挂在 agent 预设底下）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SkillLister } from '../../src/host/hostFs.ts'
import { createSkillViewer } from '../../src/host/skillView.ts'

const lister = (label: string): SkillLister & { label: string } => ({
  label,
  list: async () => [],
  get: async () => undefined,
})

/** 只有 `get(name)` 的假上下文。 */
function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

describe('createSkillViewer', () => {
  const global = lister('global')
  const scoped = lister('preset')

  it('会话的 agent 在跑：用它预设里的 skill 服务、以它为作用域', async () => {
    const agent = { ctx: {} }
    const viewer = createSkillViewer(
      fakeCtx({
        agents: { get: (id: string) => (id === 's1' ? agent : undefined) },
        agentPresets: {
          serviceFor: (live: unknown, name: string) =>
            live === agent && name === 'skills' ? scoped : undefined,
          acquireScope: async () => {
            throw new Error('不该借默认预设')
          },
        },
      }),
      () => global,
    )
    const view = await viewer('s1')
    expect(view?.skills).toBe(scoped)
    expect(view?.scope).toBe(agent)
    expect(view?.release).toBeUndefined()
  })

  it('没在跑（或没给会话）：借默认预设的作用域读全局 registry，读完还回去', async () => {
    const key = { preset: 'default' }
    let disposed = 0
    const viewer = createSkillViewer(
      fakeCtx({
        agents: { get: () => undefined },
        agentPresets: {
          serviceFor: () => undefined,
          acquireScope: async (id?: string) => {
            expect(id).toBeUndefined()
            return {
              key,
              [Symbol.asyncDispose]: async () => {
                disposed += 1
              },
            }
          },
        },
      }),
      () => global,
    )
    for (const session of [undefined, 'cold']) {
      const view = await viewer(session)
      expect(view?.skills).toBe(global)
      expect(view?.scope).toBe(key)
      await view?.release?.()
    }
    expect(disposed).toBe(2)
  })

  it('没有预设服务、默认预设借不到：只看全局那一层；skill 服务不在就是 undefined', async () => {
    expect(await createSkillViewer(fakeCtx({}), () => global)(undefined)).toEqual({
      skills: global,
    })
    const failing = createSkillViewer(
      fakeCtx({
        agentPresets: {
          serviceFor: () => undefined,
          acquireScope: async () => {
            throw new Error('preset broken')
          },
        },
      }),
      () => global,
    )
    expect(await failing('x')).toEqual({ skills: global })
    expect(await createSkillViewer(fakeCtx({}), () => undefined)('x')).toBeUndefined()
    // 形状不对的 agentPresets 当没有。
    expect(
      await createSkillViewer(
        fakeCtx({ agentPresets: { acquireScope: 1 } }),
        () => global,
      )(undefined),
    ).toEqual({ skills: global })
  })
})
