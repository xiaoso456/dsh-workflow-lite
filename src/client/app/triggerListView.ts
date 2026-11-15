/**
 * dsh-workflow-lite — 工作流中心「触发」页左栏「视图选项」的选择（分组、排序、只看哪些）：记在本机浏览器里，下次打开照旧。
 *
 * 和配色主题一样只是看的样子，不进工作流、不进 profile。记坏了、存不下都按默认。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/triggerListView
 */

import { useCallback, useState } from 'react'
import {
  DEFAULT_LIST_VIEW,
  TRIGGER_GROUPS,
  TRIGGER_SHOWS,
  TRIGGER_SORTS,
  type TriggerListView,
} from '../model/triggerList.ts'

const KEY = 'workflow-lite.hubTriggers'

function pick<V extends string>(list: readonly V[], value: unknown, fallback: V): V {
  return list.find((item) => item === value) ?? fallback
}

/** 读记下的选择；没记过、记坏了按默认（坏掉的那一项单独按默认）。 */
export function readListView(): TriggerListView {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_LIST_VIEW
    const value = JSON.parse(raw) as Partial<Record<keyof TriggerListView, unknown>> | null
    return {
      group: pick(TRIGGER_GROUPS, value?.group, DEFAULT_LIST_VIEW.group),
      sort: pick(TRIGGER_SORTS, value?.sort, DEFAULT_LIST_VIEW.sort),
      show: pick(TRIGGER_SHOWS, value?.show, DEFAULT_LIST_VIEW.show),
    }
  } catch {
    return DEFAULT_LIST_VIEW
  }
}

function saveListView(view: TriggerListView): void {
  try {
    const plain =
      view.group === DEFAULT_LIST_VIEW.group &&
      view.sort === DEFAULT_LIST_VIEW.sort &&
      view.show === DEFAULT_LIST_VIEW.show
    if (plain) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, JSON.stringify(view))
  } catch {
    // 存不下（隐私模式、配额满）：这次照样换，下次打开回到默认。
  }
}

/** 左栏的视图选项：改一项（只给改的那几样），立即生效并记下。 */
export function useTriggerListView(): [
  TriggerListView,
  (change: Partial<TriggerListView>) => void,
] {
  const [view, setView] = useState(readListView)
  const change = useCallback((next: Partial<TriggerListView>) => {
    setView((current) => {
      const merged = { ...current, ...next }
      saveListView(merged)
      return merged
    })
  }, [])
  return [view, change]
}
