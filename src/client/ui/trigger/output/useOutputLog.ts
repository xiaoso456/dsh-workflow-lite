/**
 * dsh-workflow-lite — 最近的输出的数据：摘要（一条一行）、哪几条展开着、展开的那几条的行。
 *
 * - 摘要挂上就读，卡片状态一变（`stamp`：又检查了一次、程序打出新的一行、重启了）、换筛选再读；没变就交回同一个对象；
 * - 展开的才读行：程序的一次运行只读最后 {@link RUN_TAIL} 行（点「显示全部」再读全），检查读全；
 *   一条的摘要变了（行数、合成次数、最近一行）才重读它，读回来之前照旧显示上一次的；
 * - 展开与否按条记（不按位置）：正在跑的那次缺省展开，其余缺省收起。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/output/useOutputLog
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  OutputEntry,
  OutputFilter,
  OutputLine,
  TriggerOutputResponse,
} from '../../../../shared/wire/trigger.ts'
import type { OutputAccess, OutputLines } from '../../../app/triggerOutput.ts'
import { shareSame } from '../../../model/samePlain.ts'

/** 程序的一次运行展开时缺省只显示最后几行。 */
export const RUN_TAIL = 50

export interface OutputLogModel {
  /** 还没读到是 `null`。 */
  data: TriggerOutputResponse | null
  isOpen(entry: OutputEntry): boolean
  toggle(entry: OutputEntry): void
  /** 眼下列出的每一条都展开着。 */
  allOpen: boolean
  setAll(open: boolean): void
  /** 一条读到的行；还没读过是 `undefined`。 */
  lines(id: number): OutputLines | undefined
  /** 这条只显示了最后几行（给了数），还是全部（`undefined`）。 */
  tailOf(entry: OutputEntry): number | undefined
  showAll(id: number): void
  /** 一条的全部行（复制用；已经读全了就不再读）。 */
  fullLines(entry: OutputEntry): Promise<readonly OutputLine[]>
  /** 眼下列出的每一条的全部行（「复制全部」用）。 */
  allLines(): Promise<ReadonlyMap<number, readonly OutputLine[]>>
  clear(): Promise<string | null>
}

/** 摘要里哪些变了就得重读这条的行。 */
function signatureOf(entry: OutputEntry, tail: number | undefined, stamp: string): string {
  return [
    entry.lines,
    entry.count ?? 1,
    entry.last ?? '',
    entry.preview,
    entry.verdict,
    tail ?? 'all',
    // 程序还在跑：连着重复的行只加次数，摘要不变，跟着卡片状态重读。
    entry.verdict === 'running' ? stamp : '',
  ].join('|')
}

export function useOutputLog(input: {
  access: OutputAccess
  node: string
  stamp: string
  filter: OutputFilter
}): OutputLogModel {
  const { access, node, stamp, filter } = input
  const [data, setData] = useState<TriggerOutputResponse | null>(null)
  const [reload, setReload] = useState(0)
  const [overrides, setOverrides] = useState<ReadonlyMap<number, boolean>>(new Map())
  const [full, setFull] = useState<ReadonlySet<number>>(new Set())
  const [cache, setCache] = useState<ReadonlyMap<number, { sig: string; value: OutputLines }>>(
    new Map(),
  )

  // 正在读的行：每条读的是哪一份（同一份不重复发）。
  const pending = useRef(new Map<number, string>())

  // 换卡片：展开、读到的行都从头来。
  const nodeRef = useRef(node)
  if (nodeRef.current !== node) {
    nodeRef.current = node
    pending.current.clear()
    setOverrides(new Map())
    setFull(new Set())
    setCache(new Map())
    setData(null)
  }

  useEffect(() => {
    let alive = true
    void stamp
    void reload
    void access.list(node, filter).then((result) => {
      if (alive && result !== null) setData((previous) => shareSame(previous, result))
    })
    return () => {
      alive = false
    }
  }, [access, node, filter, stamp, reload])

  const isOpen = useCallback(
    (entry: OutputEntry): boolean => overrides.get(entry.id) ?? entry.verdict === 'running',
    [overrides],
  )
  const tailOf = useCallback(
    (entry: OutputEntry): number | undefined =>
      entry.kind === 'run' && !full.has(entry.id) ? RUN_TAIL : undefined,
    [full],
  )

  // 展开着、摘要变了的重读（按要不要只读最后几行分两批）。正在读的同一份不重复发；读回来时已经换了卡片就不要。
  const stampRef = useRef(stamp)
  stampRef.current = stamp
  useEffect(() => {
    if (data === null) return
    const groups = new Map<number | undefined, { entry: OutputEntry; sig: string }[]>()
    for (const entry of data.entries) {
      if (!isOpen(entry)) continue
      const tail = tailOf(entry)
      const sig = signatureOf(entry, tail, stampRef.current)
      if (cache.get(entry.id)?.sig === sig || pending.current.get(entry.id) === sig) continue
      pending.current.set(entry.id, sig)
      groups.set(tail, [...(groups.get(tail) ?? []), { entry, sig }])
    }
    const asked = node
    for (const [tail, wanted] of groups) {
      void access
        .lines(
          asked,
          wanted.map((item) => item.entry.id),
          tail,
        )
        .then((result) => {
          for (const item of wanted) {
            if (pending.current.get(item.entry.id) === item.sig)
              pending.current.delete(item.entry.id)
          }
          if (result === null || nodeRef.current !== asked) return
          setCache((previous) => {
            const next = new Map(previous)
            for (const value of result) {
              const item = wanted.find((candidate) => candidate.entry.id === value.id)
              if (item !== undefined) next.set(value.id, { sig: item.sig, value })
            }
            return next
          })
        })
    }
  }, [data, cache, isOpen, tailOf, access, node])

  // 列表里已经没有的条：丢掉它们读到的行和展开记号。
  useEffect(() => {
    if (data === null || filter !== 'all') return
    const alive = new Set(data.entries.map((entry) => entry.id))
    setCache((previous) => {
      const kept = [...previous].filter(([id]) => alive.has(id))
      return kept.length === previous.size ? previous : new Map(kept)
    })
  }, [data, filter])

  const toggle = useCallback(
    (entry: OutputEntry) =>
      setOverrides((previous) => new Map(previous).set(entry.id, !isOpen(entry))),
    [isOpen],
  )

  const entries = data?.entries
  const allOpen = useMemo(
    () => entries !== undefined && entries.length > 0 && entries.every(isOpen),
    [entries, isOpen],
  )
  const setAll = useCallback(
    (open: boolean) =>
      setOverrides((previous) => {
        const next = new Map(previous)
        for (const entry of entries ?? []) next.set(entry.id, open)
        return next
      }),
    [entries],
  )

  const lines = useCallback((id: number) => cache.get(id)?.value, [cache])
  const showAll = useCallback((id: number) => setFull((previous) => new Set(previous).add(id)), [])

  const fullLines = useCallback(
    async (entry: OutputEntry): Promise<readonly OutputLine[]> => {
      const have = cache.get(entry.id)?.value
      if (have !== undefined && have.lines.length >= have.total) return have.lines
      const result = await access.lines(node, [entry.id])
      return result?.[0]?.lines ?? have?.lines ?? []
    },
    [cache, access, node],
  )

  const allLines = useCallback(async (): Promise<ReadonlyMap<number, readonly OutputLine[]>> => {
    const ids = (entries ?? []).map((entry) => entry.id)
    const result = await access.lines(node, ids)
    return new Map((result ?? []).map((value) => [value.id, value.lines]))
  }, [entries, access, node])

  const clear = useCallback(async (): Promise<string | null> => {
    const problem = await access.clear(node)
    if (problem === null) {
      setOverrides(new Map())
      setFull(new Set())
      setCache(new Map())
      setReload((n) => n + 1)
    }
    return problem
  }, [access, node])

  return {
    data,
    isOpen,
    toggle,
    allOpen,
    setAll,
    lines,
    tailOf,
    showAll,
    fullLines,
    allLines,
    clear,
  }
}
