/**
 * dsh-workflow-lite — 每张触发卡片的失败看到了哪一条：记在本机浏览器里。
 *
 * 红点只提醒还没看过的失败（工作流中心「时间线」页签上、画布卡片的状态小标上是同一个）：
 * 打开过这张卡片的时间线、或在画布卡片的小卡里点「知道了」，那之前的失败就算看过了，红点消掉，
 * 之后再有失败才又亮。按「工作流/节点」记看到的最新一条的时刻；只记最近看过的若干张，记坏了、存不下当没看过。
 * 一页里只有一份：哪儿记了一笔，别处的红点跟着变。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/fireSeen
 */

import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'workflow-lite.hubFiresSeen'

/** 最多记几张卡片（多了丢掉最久没看的）。 */
const KEEP = 300

type Seen = Record<string, number>

function read(): Seen {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((pair): pair is [string, number] => typeof pair[1] === 'number'),
    )
  } catch {
    return {}
  }
}

function save(seen: Seen): void {
  try {
    const kept = Object.entries(seen)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP)
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // 存不下：这次照样消掉，下次打开当没看过。
  }
}

/** 这一页里的那一份（第一次用时从浏览器读），和等着它变的。 */
let shared: Seen | null = null
const listeners = new Set<() => void>()

function current(): Seen {
  shared ??= read()
  return shared
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 按哪一项记（和存过的一致：工作流名、换行、节点）。 */
const keyOf = (workflow: string, node: string): string => `${workflow}
${node}`

/** 记下「这张卡片看到了 `at` 这一条」；比已记的旧就不动。 */
export function markFireSeen(workflow: string, node: string, at: number): void {
  const key = keyOf(workflow, node)
  const seen = current()
  if ((seen[key] ?? 0) >= at) return
  shared = { ...seen, [key]: at }
  save(shared)
  for (const listener of listeners) listener()
}

/** 这张卡片看到哪儿了（没看过是 0），和「看到了这一条」。 */
export function useFireSeen(workflow: string, node: string): [number, (at: number) => void] {
  const key = keyOf(workflow, node)
  const seen = useSyncExternalStore(subscribe, () => current()[key] ?? 0)
  const mark = useCallback((at: number) => markFireSeen(workflow, node, at), [workflow, node])
  return [seen, mark]
}

/** 所有卡片看到哪儿了（一页一份；按 {@link seenOf} 查）：要同时看很多张时用，哪张记了一笔都会换一份。 */
export type FiresSeen = Readonly<Record<string, number>>

export function useFiresSeen(): FiresSeen {
  return useSyncExternalStore(subscribe, current)
}

/** 在 {@link useFiresSeen} 那一份里查这张卡片看到哪儿了（没看过是 0）。 */
export function seenOf(seen: FiresSeen, workflow: string, node: string): number {
  return seen[keyOf(workflow, node)] ?? 0
}

/** 有没有还没看过的失败：最近一次失败比看到的那一条新。 */
export function hasUnseenFailure(lastFailure: number | undefined, seen: number): boolean {
  return lastFailure !== undefined && lastFailure > seen
}
