/**
 * dsh-workflow-lite — 最近的输出怎么看（自动换行、显示错误输出）：定时检查、监听各记一份，存在本机浏览器里。
 *
 * 只是看的样子，不进工作流、不进 profile；记坏了、存不下按缺省（定时检查换行、监听不换行，错误输出都显示）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/outputView
 */

import { useCallback, useState } from 'react'

export type OutputKind = 'check' | 'listen'

export interface OutputView {
  wrap: boolean
  err: boolean
}

const KEY = 'workflow-lite.outputView'

/** 定时检查的输出短、多半要读全，换行；监听一行一行扫，不换行（超长的省略）。 */
export const OUTPUT_VIEW_DEFAULT: Readonly<Record<OutputKind, OutputView>> = {
  check: { wrap: true, err: true },
  listen: { wrap: false, err: true },
}

function readAll(): Partial<Record<OutputKind, Partial<OutputView>>> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}')
    return typeof raw === 'object' && raw !== null ? raw : {}
  } catch {
    return {}
  }
}

/** 一种卡片的看法：缺的项按缺省补。 */
export function readOutputView(kind: OutputKind): OutputView {
  const stored = readAll()[kind] ?? {}
  const fallback = OUTPUT_VIEW_DEFAULT[kind]
  return {
    wrap: typeof stored.wrap === 'boolean' ? stored.wrap : fallback.wrap,
    err: typeof stored.err === 'boolean' ? stored.err : fallback.err,
  }
}

export function useOutputView(
  kind: OutputKind,
): [OutputView, (change: Partial<OutputView>) => void] {
  const [views, setViews] = useState(() => ({
    check: readOutputView('check'),
    listen: readOutputView('listen'),
  }))
  const change = useCallback(
    (patch: Partial<OutputView>) => {
      setViews((previous) => {
        const next = { ...previous, [kind]: { ...previous[kind], ...patch } }
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next))
        } catch {
          // 存不下：这次照样换，下次打开按缺省。
        }
        return next
      })
    },
    [kind],
  )
  return [views[kind], change]
}
