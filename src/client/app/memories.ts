/**
 * dsh-workflow-lite — 前端这边的记忆库：一份列表，画布卡片、属性面板、「记忆」页、「版本」框共用。
 *
 * 一个 RPC 连接一份（{@link memoryStore}）；谁先要谁去读，读着的时候别人再要就等同一趟。
 * 建、改、删之后就地换掉那一行，再在后台重读一遍（在用的工作流、大小这些主机算的东西跟着对上）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/memories
 */

import { useEffect, useSyncExternalStore } from 'react'
import type { MemoryEntry } from '../../shared/memoryLib.ts'
import { idKey } from '../../shared/model.ts'
import type { MemoryType } from '../../shared/types.ts'
import type { MemoryCreateRequest, MemoryUpdateRequest } from '../../shared/wire.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import type { BrowseSource } from './useBrowse.ts'

export interface MemorySnapshot {
  /** 还没读回来是 `null`。 */
  entries: readonly MemoryEntry[] | null
  error: string | null
}

export interface MemoryStore {
  snapshot(): MemorySnapshot
  subscribe(listener: () => void): () => void
  /** 重读一遍（读着的时候再叫就等同一趟）。 */
  refresh(): Promise<void>
  create(request: MemoryCreateRequest): Promise<MemoryEntry>
  update(request: MemoryUpdateRequest): Promise<MemoryEntry>
  remove(id: string): Promise<void>
  /** 浏览一条记忆的文件夹；给 `version` 看的是那个版本的拷贝。 */
  source(id: string, version?: number): BrowseSource
}

const stores = new WeakMap<WorkflowLiteRpc, MemoryStore>()

/** 这个 RPC 连接上的记忆库（一个连接一份）。 */
export function memoryStore(rpc: WorkflowLiteRpc): MemoryStore {
  let store = stores.get(rpc)
  if (store === undefined) {
    store = createMemoryStore(rpc)
    stores.set(rpc, store)
  }
  return store
}

function createMemoryStore(rpc: WorkflowLiteRpc): MemoryStore {
  let state: MemorySnapshot = { entries: null, error: null }
  let pending: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const set = (next: MemorySnapshot): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const replace = (entry: MemoryEntry): void => {
    const others = (state.entries ?? []).filter((row) => idKey(row.id) !== idKey(entry.id))
    set({ entries: [...others, entry], error: null })
  }
  const refresh = (): Promise<void> => {
    if (pending !== null) return pending
    pending = rpc
      .call('memory/list', {})
      .then((result) => set({ entries: result.memories, error: null }))
      .catch((reason: unknown) =>
        set({ ...state, error: reason instanceof Error ? reason.message : String(reason) }),
      )
      .finally(() => {
        pending = null
      })
    return pending
  }
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    create: async (request) => {
      const { memory } = await rpc.call('memory/create', request)
      replace(memory)
      void refresh()
      return memory
    },
    update: async (request) => {
      const { memory } = await rpc.call('memory/update', request)
      replace(memory)
      return memory
    },
    remove: async (id) => {
      await rpc.call('memory/delete', { id })
      set({
        entries: (state.entries ?? []).filter((row) => idKey(row.id) !== idKey(id)),
        error: null,
      })
    },
    source: (id, version) => {
      const at = (sub: string) => ({
        id,
        ...(version === undefined ? {} : { version }),
        ...(sub === '' ? {} : { sub }),
      })
      return {
        key: `memory:${id}:${version ?? ''}`,
        dir: (sub) => rpc.call('memory/dir', at(sub)),
        file: (sub) => rpc.call('memory/file', at(sub)),
        image: (sub, src) =>
          rpc.call('memory/image', { ...at(sub), ...(src === undefined ? {} : { src }) }),
      }
    },
  }
}

/** 订阅记忆库；第一次用时去读一遍。 */
export function useMemories(store: MemoryStore): MemorySnapshot {
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  useEffect(() => {
    if (store.snapshot().entries === null) void store.refresh()
  }, [store])
  return snapshot
}

/** 按 id 找一条（大小写不同算同一条）。 */
export function findMemory(
  entries: readonly MemoryEntry[] | null,
  id: string,
): MemoryEntry | undefined {
  return entries?.find((entry) => idKey(entry.id) === idKey(id))
}

/** 同类型的，按名称排（「加记忆」菜单里列的）。 */
export function memoriesOfType(
  entries: readonly MemoryEntry[] | null,
  type: MemoryType,
): MemoryEntry[] {
  return (entries ?? []).filter((entry) => entry.type === type && entry.invalid !== true)
}
