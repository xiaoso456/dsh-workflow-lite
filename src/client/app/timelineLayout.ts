/**
 * dsh-workflow-lite — 工作流中心「触发」页时间线的样子（清单 / 时间轴）：记在本机浏览器里，换卡片、下次打开都照旧。
 *
 * 只是看的样子，不进工作流、不进 profile；记坏了、存不下按清单。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/timelineLayout
 */

import { useCallback, useState } from 'react'

export type TimelineLayout = 'list' | 'rail'
export const TIMELINE_LAYOUTS: readonly TimelineLayout[] = ['list', 'rail']

const KEY = 'workflow-lite.hubTimeline'

function read(): TimelineLayout {
  try {
    return window.localStorage.getItem(KEY) === 'rail' ? 'rail' : 'list'
  } catch {
    return 'list'
  }
}

export function useTimelineLayout(): [TimelineLayout, (layout: TimelineLayout) => void] {
  const [layout, setLayout] = useState(read)
  const change = useCallback((next: TimelineLayout) => {
    setLayout(next)
    try {
      if (next === 'list') window.localStorage.removeItem(KEY)
      else window.localStorage.setItem(KEY, next)
    } catch {
      // 存不下：这次照样换，下次打开回到清单。
    }
  }, [])
  return [layout, change]
}
