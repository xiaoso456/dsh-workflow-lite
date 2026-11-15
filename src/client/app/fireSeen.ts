/**
 * dsh-workflow-lite — 工作流中心「触发」页每张卡片的时间线看到了哪一条：记在本机浏览器里。
 *
 * 「时间线」页签上的红点只提醒还没看过的失败：打开过这张卡片的时间线，那之前的失败就算看过了，红点消掉，
 * 之后再有失败才又亮。按「工作流/节点」记那次看到的最新一条的时刻；只记最近看过的若干张，记坏了、存不下当没看过。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/fireSeen
 */

import { useCallback, useState } from 'react'

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

/** 这张卡片看到哪儿了（没看过是 0），和「看到了这一条」。 */
export function useFireSeen(key: string): [number, (at: number) => void] {
  const [seen, setSeen] = useState(read)
  const mark = useCallback(
    (at: number) => {
      setSeen((current) => {
        if ((current[key] ?? 0) >= at) return current
        const next = { ...current, [key]: at }
        save(next)
        return next
      })
    },
    [key],
  )
  return [seen[key] ?? 0, mark]
}
