import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { createSessionPort } from '../../src/host/triggers/sessions.ts'

/** 只有 `get` 的假 ctx：按名字取 DSH 的服务。 */
function fakeContext(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

describe('触发器发进会话的消息', () => {
  it('按用户消息发：DSH 的 create_goal 只认本轮有用户消息的回合', async () => {
    const got: UserMessage[] = []
    const ctx = fakeContext({
      workspaceRegistry: { create: async () => ({ id: 'w1' }) },
      sessionController: {
        create: async () => ({ sessionId: 's1' }),
        rename: async () => undefined,
        resolveAgent: async () => ({
          agent: { followup: (message: UserMessage) => got.push(message) },
        }),
      },
    })
    await createSessionPort(ctx).send('s1', '执行工作流')
    expect(got).toHaveLength(1)
    expect(got[0]?.source).toEqual({ kind: 'user' })
    expect(got[0]?.content).toEqual([{ type: 'text', text: '执行工作流' }])
  })
})
