/**
 * dsh-workflow-lite — 一张触发卡片的触发记录与近况：读回来留一份，换卡片再换回来时先拿留下的显示，不先闪「还没有触发过」。
 *
 * - {@link useFires}：最近几次的记录（画布上的面板和工作流中心「触发」页共用）；
 * - {@link useActivity}：一段时间里每一小格各种结果几次（「触发」页概览的数和节律，触发得再勤也数得全）。
 *
 * 什么时候重读看 `signal`（最近一次触发的编号、它对上的实例、模型的判断）：和留下的那份一样就不再问。
 * 还没读到时是 `null`——界面上什么都不说，读到了再说有几条、或者一条都没有。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useFires
 */

import { useEffect, useRef, useState } from 'react'
import type { FireRecord, TriggerActivitySlot, TriggerEntry } from '../../shared/wire/trigger.ts'
import { rhythmSince } from '../model/triggerActivity.ts'
import { readCache } from './readCache.ts'
import type { TriggerHub } from './useTriggerHub.ts'

/** 留下的不过期（`signal` 自己带着），缓存里的信号用一个常量。 */
const KEPT = 'kept'
type Kept<V> = ReturnType<typeof keepReads<V>>

const fires = keepReads<FireRecord[]>()
const activity = keepReads<readonly TriggerActivitySlot[]>()
const EMPTY_ACTIVITY: readonly TriggerActivitySlot[] = []

function keepReads<V>() {
  const cache = readCache<{ signal: string; value: V }>({ entries: 64 })
  const pending = new Map<string, { signal: string; result: Promise<V> }>()
  const peek = (key: string): V | undefined => cache.get(key, KEPT)?.value
  const load = (key: string, signal: string, read: () => Promise<V>): Promise<V> => {
    const hit = cache.get(key, KEPT)
    if (hit?.signal === signal) return Promise.resolve(hit.value)
    const active = pending.get(key)
    if (active?.signal === signal) return active.result
    const result = read()
      .then((value) => {
        if (pending.get(key)?.result === result) cache.put(key, KEPT, { signal, value })
        return value
      })
      .finally(() => {
        if (pending.get(key)?.result === result) pending.delete(key)
      })
    pending.set(key, { signal, result })
    return result
  }
  return { peek, load }
}

/**
 * @param key - 哪一张卡片（工作流 + 卡片 id）。
 * @param signal - 记录变没变的记号；变了就重读。
 * @param read - 读一次（读不到回空列表）。
 */
export function useFires(
  key: string,
  signal: string,
  read: () => Promise<FireRecord[]>,
): FireRecord[] | null {
  return useKept(fires, key, signal, read)
}

function activityOf(entry: TriggerEntry): {
  key: string
  signal: string
  since: number
  empty: boolean
} {
  const { workflow, view } = entry
  const since = rhythmSince(Date.now())
  return {
    key: JSON.stringify([workflow, view.node]),
    signal: `${firesSignal(view.last, view.queued)}|${String(since)}`,
    since,
    empty: view.last === undefined || view.last.at < since,
  }
}

/** 概览切卡片前先读；已有缓存或确定没有近况时不用等。 */
export function primeActivity(
  entry: TriggerEntry,
  read: TriggerHub['activity'],
): Promise<readonly TriggerActivitySlot[]> | undefined {
  const { key, signal, since, empty } = activityOf(entry)
  if (empty || activity.peek(key) !== undefined) return undefined
  return activity.load(key, signal, () => read(entry.workflow, entry.view.node, since))
}

export function useActivity(
  entry: TriggerEntry,
  read: TriggerHub['activity'],
): readonly TriggerActivitySlot[] | null {
  const { key, signal, since, empty } = activityOf(entry)
  const slots = useKept(activity, key, empty ? null : signal, () =>
    read(entry.workflow, entry.view.node, since),
  )
  return empty ? EMPTY_ACTIVITY : slots
}

function useKept<V extends object>(
  cache: Kept<V>,
  key: string,
  signal: string | null,
  read: () => Promise<V>,
): V | null {
  const [state, setState] = useState<{ key: string; value: V | null }>(() => ({
    key,
    value: cache.peek(key) ?? null,
  }))
  const reader = useRef(read)
  reader.current = read

  useEffect(() => {
    if (signal === null) return
    let alive = true
    void cache.load(key, signal, reader.current).then((value) => {
      if (alive) setState((now) => (now.key === key && now.value === value ? now : { key, value }))
    })
    return () => {
      alive = false
    }
  }, [cache, key, signal])

  // 换了卡片、新的还没读到：先用留下的那份（没有就是 `null`），不拿上一张的冒充。
  return cache.peek(key) ?? (state.key === key ? state.value : null)
}

/** 最近一次触发的记号：编号、对上的实例、模型的判断，任一样变了记录就要重读。 */
export function firesSignal(
  last: { id?: string; outcome?: string; instance?: string; declined?: string } | undefined,
  queued?: number,
): string {
  return `${last?.id ?? ''}|${last?.outcome ?? ''}|${last?.instance ?? ''}|${last?.declined ?? ''}|${String(queued ?? 0)}`
}
