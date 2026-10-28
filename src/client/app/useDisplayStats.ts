/**
 * dsh-workflow-lite — 画布上展示着的资源项：隔一会儿问一次它们在不在、什么时候改的（`run/stat`）。
 *
 * 只问开着展示的那几项，只 stat 不读内容；修改时间变了，展示卡才去重读内容。页面藏起来时不问。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useDisplayStats
 */

import { useEffect, useMemo, useState } from 'react'
import { idKey, isResource } from '../../shared/model.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import { RUN_STAT_MAX } from '../../shared/wire.ts'
import { displayOf } from '../model/display.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { RUN_POLL_MS } from './useRuns.ts'

export interface DisplayStat {
  exists: boolean
  size: number
  mtime: number
}

/** 一项的身份串（资源 id 不分大小写）。 */
export function displayKey(node: string, item: number): string {
  return `${idKey(node)}#${item}`
}

/** 图里开着展示、展示的是文件的那几项。 */
export function displayTargets(doc: WorkflowDocument | null): { node: string; item: number }[] {
  if (doc === null) return []
  return doc.nodes.flatMap((node) => {
    if (!isResource(node)) return []
    const display = displayOf(node.data)
    if (display === null || node.data.items[display.item]?.kind !== 'file') return []
    return [{ node: node.id, item: display.item }]
  })
}

/**
 * @returns 每一项（{@link displayKey}）此刻的样子；还没问到的不在表里。
 */
export function useDisplayStats(
  rpc: WorkflowLiteRpc,
  instance: string,
  doc: WorkflowDocument | null,
): Readonly<Record<string, DisplayStat>> {
  const targets = displayTargets(doc).slice(0, RUN_STAT_MAX)
  const signature = JSON.stringify(targets)
  const [stats, setStats] = useState<Record<string, DisplayStat>>({})

  // `signature` 就是 targets 的身份：targets 每次渲染都是新数组，不拿它当依赖。
  useEffect(() => {
    const asked = JSON.parse(signature) as { node: string; item: number }[]
    if (asked.length === 0) return
    let alive = true
    const poll = (): void => {
      if (document.visibilityState === 'hidden') return
      rpc
        .call('run/stat', { id: instance, targets: asked })
        .then(({ stats: got }) => {
          if (!alive) return
          setStats((previous) => {
            const next: Record<string, DisplayStat> = {}
            asked.forEach((target, index) => {
              const stat = got[index]
              if (stat !== undefined) next[displayKey(target.node, target.item)] = stat
            })
            // 没变就留着原来那份：展示卡不跟着重渲染。
            return JSON.stringify(next) === JSON.stringify(previous) ? previous : next
          })
        })
        .catch(() => {})
    }
    poll()
    const timer = window.setInterval(poll, RUN_POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [rpc, instance, signature])

  return useMemo(() => stats, [stats])
}
