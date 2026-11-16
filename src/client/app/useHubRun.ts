/**
 * dsh-workflow-lite — 「运行实例」页右栏要读的两样：实例本身（图快照、状态、来源，`run/load`），
 * 和记到它上面的触发（建出它的那次、接着它做的几次，`trigger/of-instance`）。
 *
 * 状态、进度、更新时间变了（`stamp`）再读一次；列表刷新时摘要换了新对象但内容没变，不读。
 * 换了实例时先拿上次读到的那份（{@link seen}）顶着、再读新的：回到看过的实例不先空一下；没看过的是空的，
 * 不把上一个实例的东西显示在新实例下面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useHubRun
 */

import { useEffect, useState } from 'react'
import type { InstanceSummary, InstanceView } from '../../shared/runState.ts'
import type { FireRecord } from '../../shared/wire/trigger.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'

export interface HubRun {
  /** 还没读到是 `null`。 */
  view: InstanceView | null
  /** 记到这个实例上的触发，从早到晚；还没读到是空的。 */
  fires: readonly FireRecord[]
}

/** 看过的实例最后读到的样子（最近的 {@link SEEN_MAX} 个）。 */
const seen = new Map<string, HubRun>()
const SEEN_MAX = 40

function remember(id: string, run: HubRun): void {
  seen.delete(id)
  seen.set(id, run)
  if (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value as string)
}

const EMPTY: HubRun = { view: null, fires: [] }

export function useHubRun(rpc: WorkflowLiteRpc, item: InstanceSummary): HubRun {
  const [read, setRead] = useState<{ id: string } & HubRun>(() => ({
    id: item.id,
    ...(seen.get(item.id) ?? EMPTY),
  }))
  const stamp = `${item.id}|${item.status}|${item.done}|${item.updatedAt}`
  useEffect(() => {
    let live = true
    const id = item.id
    void rpc
      .call('run/load', { id })
      .then((result) => {
        if (!live || 'unchanged' in result) return
        setRead((old) => {
          const next = {
            id,
            view: result,
            fires: old.id === id ? old.fires : (seen.get(id)?.fires ?? []),
          }
          remember(id, next)
          return next
        })
      })
      .catch(() => {})
    void rpc
      .call('trigger/of-instance', { instance: id })
      .then((result) => {
        if (!live) return
        setRead((old) => {
          const next = {
            id,
            view: old.id === id ? old.view : (seen.get(id)?.view ?? null),
            fires: result.fires,
          }
          remember(id, next)
          return next
        })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [rpc, item.id, stamp])
  return read.id === item.id ? read : (seen.get(item.id) ?? EMPTY)
}
