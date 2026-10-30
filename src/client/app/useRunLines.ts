/**
 * dsh-workflow-lite — 展示卡按行读日志（`run/lines`）：第一次读末尾（或开头）几百行，之后文件每变一次只续读新追加的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRunLines
 */

import { useEffect, useRef, useState } from 'react'
import type { LineFilter } from '../../shared/types.ts'
import type { RunLinesResponse } from '../../shared/wire.ts'
import { appendWindow, filterKey, type LineWindow, windowOf } from '../model/logLines.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

export interface LinesTarget {
  node: string
  item: number
  sub?: string
  version?: number
}

export interface RunLines {
  /** 读到的窗口；换了目标、筛选，新的读回来之前还是上一份（不闪空）。 */
  win: LineWindow | null
  /** 这个文件不按行读（UTF-16、二进制）：`run/lines` 回的种类。 */
  kind: RunLinesResponse['kind'] | null
  error: string | null
}

/**
 * @param from - `end` 读末尾、跟着往下走；`start` 读开头（文件变了从头再读一遍：只读 `limit` 行，不贵）。
 * @param signal - 变了就续读（现在的文件拿修改时间；`null` 不读）。
 */
export function useRunLines(
  rpc: WorkflowLiteRpc,
  instance: string,
  target: LinesTarget | null,
  options: { from: 'end' | 'start'; limit: number; filter: LineFilter | undefined },
  signal: string | number | null,
): RunLines {
  const [state, setState] = useState<RunLines & { key: string }>({
    win: null,
    kind: null,
    error: null,
    key: '',
  })
  const key =
    target === null
      ? ''
      : [
          instance,
          target.node,
          target.item,
          target.sub ?? '',
          target.version ?? '',
          options.from,
          options.limit,
          filterKey(options.filter),
        ].join('\u0000')
  const latest = useRef(state)
  latest.current = state
  /** 正在读的那一次（后来的读回来了，先发的晚到就扔掉）。 */
  const ticket = useRef(0)

  useEffect(() => {
    if (target === null || signal === null) return
    const current = latest.current
    const follow =
      options.from === 'end' &&
      current.key === key &&
      current.win !== null &&
      current.kind === 'lines'
    const request = follow
      ? {
          mode: 'follow' as const,
          from: (current.win as LineWindow).end,
          tag: (current.win as LineWindow).tag,
          ...((current.win as LineWindow).owed > 0
            ? { owed: (current.win as LineWindow).owed }
            : {}),
        }
      : options.from === 'end'
        ? { mode: 'tail' as const }
        : { mode: 'head' as const, from: 0 }
    ticket.current += 1
    const mine = ticket.current
    rpc
      .call('run/lines', {
        id: instance,
        ...target,
        ...request,
        limit: options.limit,
        ...(options.filter === undefined ? {} : { filter: options.filter }),
      })
      .then((response) => {
        if (mine !== ticket.current) return
        const before = latest.current
        const win =
          response.kind !== 'lines'
            ? null
            : follow && before.key === key && before.win !== null
              ? appendWindow(before.win, response, options.limit * 2)
              : windowOf(response, request.mode)
        setState({ key, win, kind: response.kind, error: null })
      })
      .catch((reason: unknown) => {
        if (mine !== ticket.current) return
        setState((last) => ({ ...last, key, error: errorMessage(reason) }))
      })
    // `key` 就是 target / options 的身份；`signal` 是重读的信号。
  }, [rpc, key, signal])

  if (target === null) return { win: null, kind: null, error: null }
  return state.key === key || state.win !== null
    ? { win: state.win, kind: state.kind, error: state.key === key ? state.error : null }
    : { win: null, kind: null, error: null }
}
