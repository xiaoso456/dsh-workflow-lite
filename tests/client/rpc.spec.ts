/**
 * 画布 RPC 调用器的**目标**单测——守的是那次 `invalid RPC target` 事故。
 *
 * `tests/shared/wire.spec.ts` 验的是常量本身合法；这里验的是**调用器真的把那一对传下去了**。
 * 两者缺一不可：常量对而调用点拼错（当初就是这样）只有这一条能抓到。
 *
 * @module tests/client/rpc.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { createWorkflowLiteRpc, requireRpcCarrier } from '../../src/client/core/rpc.ts'
import { WORKFLOW_LITE_ENDPOINTS } from '../../src/shared/wire.ts'

/** 造一个记录调用参数的假载波。 */
function recordingCarrier(value: unknown = { ok: true }) {
  const calls: { channel: string; endpoint: string; payload: unknown }[] = []
  const carrier = {
    rpc: {
      call: vi.fn((channel: string, endpoint: string, payload: unknown) => {
        calls.push({ channel, endpoint, payload })
        return Promise.resolve({ ok: true as const, value })
      }),
    },
  }
  return { carrier, calls }
}

describe('createWorkflowLiteRpc', () => {
  it('通道传 /api，端点名传 <命名空间>/<动作>', async () => {
    const { carrier, calls } = recordingCarrier()
    await createWorkflowLiteRpc(carrier).call('graph/list', {})
    expect(calls).toEqual([{ channel: '/api', endpoint: 'workflow-lite/graph/list', payload: {} }])
  })

  it.each(WORKFLOW_LITE_ENDPOINTS)('%s 的目标不重复带命名空间', async (endpoint) => {
    const { carrier, calls } = recordingCarrier()
    await createWorkflowLiteRpc(carrier).call(endpoint, {})
    const first = calls[0]
    expect(first?.channel).toBe('/api')
    expect(first?.endpoint).toBe(`workflow-lite/${endpoint}`)
    expect(first?.endpoint.startsWith('workflow-lite/workflow-lite')).toBe(false)
  })

  it('参数原样透传（不加工、不改键）', async () => {
    const { carrier, calls } = recordingCarrier()
    const args = { name: 'code-review', baseHash: 'abc123' }
    await createWorkflowLiteRpc(carrier).call('graph/save', args as never)
    expect(calls[0]?.payload).toBe(args)
  })

  it('载波失败 → 抛出，且 error.name 带 host 给的 code', async () => {
    const carrier = {
      rpc: {
        call: () =>
          Promise.resolve({
            ok: false as const,
            error: { code: 'conflict', message: '双方都改过', details: {} },
          }),
      },
    }
    const rpc = createWorkflowLiteRpc(carrier)
    await expect(rpc.call('graph/save', {} as never)).rejects.toMatchObject({
      name: 'conflict',
      message: '双方都改过',
    })
  })

  it('成功值不是对象 → 报畸形载荷（不把坏信封往后传）', async () => {
    const carrier = {
      rpc: { call: () => Promise.resolve({ ok: true as const, value: 'nope' }) },
    }
    await expect(createWorkflowLiteRpc(carrier).call('graph/list', {})).rejects.toThrow(
      /malformed payload/,
    )
  })
})

describe('requireRpcCarrier', () => {
  it('服务缺失 / 没有 rpc 面 / call 不是函数 → 注册时就炸', () => {
    expect(() => requireRpcCarrier(undefined)).toThrow(/connection service is unavailable/)
    expect(() => requireRpcCarrier({})).toThrow(/has no rpc face/)
    expect(() => requireRpcCarrier({ rpc: {} })).toThrow(/has no call\(\)/)
  })

  it('绑定 this：call 里的 this 必须还是 rpc 面', async () => {
    const calls: string[] = []
    const rpcFace = {
      tag: 'rpc-face',
      call(this: { tag: string }, channel: string, endpoint: string) {
        calls.push(`${this.tag}|${channel}|${endpoint}`)
        return Promise.resolve({ ok: true as const, value: {} })
      },
    }
    const carrier = requireRpcCarrier({ rpc: rpcFace })
    await carrier.rpc.call('/api', 'workflow-lite/graph/list', {})
    expect(calls).toEqual(['rpc-face|/api|workflow-lite/graph/list'])
  })
})
