import { expect, it, vi } from 'vitest'
import { createHubRunReader } from '../../src/client/app/useHubRun.ts'
import { createWorkflowLiteRpc } from '../../src/client/rpc.ts'
import type { InstanceSummary, InstanceView } from '../../src/shared/runState.ts'

const item: InstanceSummary = {
  id: 'run-one',
  workflow: 'Example',
  mode: 'serial',
  planId: 'plan',
  createdAt: 1,
  current: false,
}
const view: InstanceView = {
  summary: item,
  document: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  state: null,
  issues: [],
  mtime: 0,
  files: {},
  answers: {},
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {}
  const promise = new Promise<Value>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

it('shares the cold read and only exposes detail after both calls settle', async () => {
  const fires = deferred<{ ok: true; value: { fires: [] } }>()
  const call = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, value: view })
    .mockReturnValueOnce(fires.promise)
  const reader = createHubRunReader(createWorkflowLiteRpc({ rpc: { call } }))
  const preload = reader.read(item)
  expect(reader.read(item)).toBe(preload)
  await Promise.resolve()
  expect(reader.peek(item).view).toBeNull()
  fires.resolve({ ok: true, value: { fires: [] } })
  const ready = await preload
  expect(reader.peek(item)).toBe(ready)
  expect(ready.view).toBe(view)
  expect(call).toHaveBeenCalledTimes(2)
  expect(reader.peek({ ...item, id: 'another' }).view).toBeNull()
})

it('keeps a newer detail when an older read finishes last', async () => {
  const older = deferred<{ ok: true; value: InstanceView }>()
  const updated = { ...item, updatedAt: '2026-11-18T08:00:00Z' }
  const newView = { ...view, summary: updated }
  const call = vi
    .fn()
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce({ ok: true, value: { fires: [] } })
    .mockResolvedValueOnce({ ok: true, value: newView })
    .mockResolvedValueOnce({ ok: true, value: { fires: [] } })
  const reader = createHubRunReader(createWorkflowLiteRpc({ rpc: { call } }))
  const stale = reader.read(item)
  await reader.read(updated)
  older.resolve({ ok: true, value: view })
  await stale
  expect(reader.peek(updated).view).toBe(newView)
})
