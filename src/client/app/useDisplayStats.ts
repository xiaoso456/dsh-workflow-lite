/**
 * dsh-workflow-lite — 画布上展示着的资源项：隔一会儿问一次它们在不在、什么时候改的。
 *
 * 实例视图问这个实例（`run/stat`）；模板视图问「上次执行」——这个工作流最近哪个实例真的生成了它
 * （`run/latest`），模板卡片上就显示那一份，没有就是草图。实例视图从不看别的实例。
 * 只问开着展示的那几项，只 stat 不读内容；修改时间变了，展示卡才去重读内容。页面藏起来时不问。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useDisplayStats
 */

import { useEffect, useState } from 'react'
import { idKey, isResource } from '../../shared/model.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import { RUN_STAT_MAX, type RunLatestOutput } from '../../shared/wire.ts'
import { displayOf } from '../model/display.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { RUN_POLL_MS } from './useRuns.ts'

export interface DisplayStat {
  exists: boolean
  size: number
  mtime: number
  /** 存下了几版（循环迭代时每一轮的样子）；模板视图的「上次执行」不看各版，是 0。 */
  versions: number
  /** 各版每变一次加一：变了再去读各版。 */
  revision: number
}

/** 一项的身份串（资源 id 不分大小写）。 */
export function displayKey(node: string, item: number): string {
  return `${idKey(node)}#${item}`
}

/** 图里开着展示、展示的是文件或文件夹的那几项（`value` 是路径原文）。 */
export function displayTargets(
  doc: WorkflowDocument | null,
): { node: string; item: number; value: string }[] {
  if (doc === null) return []
  return doc.nodes.flatMap((node) => {
    if (!isResource(node)) return []
    const display = displayOf(node.data)
    const item = display === null ? undefined : node.data.items[display.item]
    if (display === null || (item?.kind !== 'file' && item?.kind !== 'folder')) return []
    return [{ node: node.id, item: display.item, value: item.value }]
  })
}

/**
 * 隔一会儿调一次 `ask`；页面藏起来时不调，回到前台立刻调一次。
 * `ask` 拿到 `alive`：停掉之后（换了实例、换了一批项）还在路上的回包不要了。
 * @returns 停掉。
 */
function startPoll(ask: (alive: () => boolean) => void, interval: number): () => void {
  let alive = true
  const poll = (): void => {
    if (document.visibilityState !== 'hidden') ask(() => alive)
  }
  poll()
  const timer = window.setInterval(poll, interval)
  document.addEventListener('visibilitychange', poll)
  return () => {
    alive = false
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', poll)
  }
}

/** 没变就留着原来那份：展示卡不跟着重渲染。 */
function same<V>(previous: V, next: V): V {
  return JSON.stringify(next) === JSON.stringify(previous) ? previous : next
}

/**
 * 实例视图：这个实例里每一项此刻的样子。
 * @returns 按 {@link displayKey}；还没问到的不在表里。
 */
export function useDisplayStats(
  rpc: WorkflowLiteRpc,
  instance: string,
  doc: WorkflowDocument | null,
): Readonly<Record<string, DisplayStat>> {
  const targets = displayTargets(doc).slice(0, RUN_STAT_MAX)
  // `signature` 就是 targets 的身份：targets 每次渲染都是新数组，不拿它当依赖。
  const signature = JSON.stringify(targets.map(({ node, item }) => ({ node, item })))
  const [stats, setStats] = useState<Record<string, DisplayStat>>({})

  useEffect(() => {
    const asked = JSON.parse(signature) as { node: string; item: number }[]
    if (asked.length === 0) return
    return startPoll((alive) => {
      rpc
        .call('run/stat', { id: instance, targets: asked })
        .then(({ stats: got }) => {
          if (!alive()) return
          const next: Record<string, DisplayStat> = {}
          asked.forEach((target, index) => {
            const stat = got[index]
            if (stat !== undefined) next[displayKey(target.node, target.item)] = stat
          })
          setStats((previous) => same(previous, next))
        })
        .catch(() => {})
    }, RUN_POLL_MS)
  }, [rpc, instance, signature])

  return stats
}

/** 模板视图问得慢一些：那边多半没有在跑的实例。 */
const LATEST_POLL_MS = RUN_POLL_MS * 3

/**
 * 模板视图：每一项「上次执行」生成的那一份（哪个实例、那边的第几项、修改时间）。
 * @returns 按模板里的 {@link displayKey}；哪个实例都没生成的不在表里。
 */
export function useLatestOutputs(
  rpc: WorkflowLiteRpc,
  workflow: string | null,
  doc: WorkflowDocument | null,
): Readonly<Record<string, RunLatestOutput>> {
  const targets = displayTargets(doc).slice(0, RUN_STAT_MAX)
  const signature = JSON.stringify(targets)
  const [latest, setLatest] = useState<{
    workflow: string | null
    outputs: Record<string, RunLatestOutput>
  }>({ workflow, outputs: {} })

  useEffect(() => {
    const asked = JSON.parse(signature) as { node: string; item: number; value: string }[]
    if (workflow === null || asked.length === 0) return
    return startPoll((alive) => {
      rpc
        .call('run/latest', {
          workflow,
          targets: asked.map(({ node, value }) => ({ node, value })),
        })
        .then(({ latest: got }) => {
          if (!alive()) return
          const outputs: Record<string, RunLatestOutput> = {}
          asked.forEach((target, index) => {
            const found = got[index]
            if (found !== null && found !== undefined) {
              outputs[displayKey(target.node, target.item)] = found
            }
          })
          setLatest((previous) => same(previous, { workflow, outputs }))
        })
        .catch(() => {})
    }, LATEST_POLL_MS)
  }, [rpc, workflow, signature])

  // 换了工作流：上一张图的结果不算（新的回来之前先当没有）。
  return latest.workflow === workflow ? latest.outputs : NONE
}

const NONE: Readonly<Record<string, RunLatestOutput>> = Object.freeze({})
