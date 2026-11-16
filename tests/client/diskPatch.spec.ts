import { describe, expect, it } from 'vitest'
import { patchWorkflowOnDisk } from '../../src/client/app/diskPatch.ts'
import type { WorkflowLiteRpc } from '../../src/client/rpc.ts'
import type { ValidationProblem, WorkflowDocument } from '../../src/shared/types.ts'

const doc = { nodes: [], edges: [] } as unknown as WorkflowDocument

/** 只认 `graph/load` / `graph/save` 的假 RPC：记下写回去的东西。 */
function fakeRpc(problems: ValidationProblem[]) {
  const saved: unknown[] = []
  const rpc = {
    call: async (endpoint: string, args: unknown) => {
      if (endpoint === 'graph/load') return { document: doc, hash: 'h1', problems }
      if (endpoint === 'graph/save') {
        saved.push(args)
        return {}
      }
      throw new Error(`unexpected ${endpoint}`)
    },
  } as unknown as WorkflowLiteRpc
  return { rpc, saved }
}

const problem = (level: ValidationProblem['level'], message: string) =>
  ({ level, code: 'x', message }) as unknown as ValidationProblem

describe('patchWorkflowOnDisk', () => {
  it('图里只有警告、提示、编译问题时照样写回去，带着读到时的哈希', async () => {
    const { rpc, saved } = fakeRpc([
      problem('warning', '记忆没连'),
      problem('hint', '孤立节点'),
      problem('compile', '提示词是空的'),
    ])
    const changed = { ...doc, nodes: [] }
    expect(await patchWorkflowOnDisk(rpc, 'w', () => changed)).toBeNull()
    expect(saved).toEqual([{ name: 'w', document: changed, baseHash: 'h1' }])
  })

  it('有挡保存的问题时不写，回那一句', async () => {
    const { rpc, saved } = fakeRpc([
      problem('warning', '记忆没连'),
      problem('save', '文件格式不对'),
    ])
    expect(await patchWorkflowOnDisk(rpc, 'w', () => doc)).toBe('文件格式不对')
    expect(saved).toEqual([])
  })

  it('没什么可改的不写', async () => {
    const { rpc, saved } = fakeRpc([])
    expect(await patchWorkflowOnDisk(rpc, 'w', () => null)).toBeNull()
    expect(saved).toEqual([])
  })
})
