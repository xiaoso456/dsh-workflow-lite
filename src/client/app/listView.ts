/**
 * dsh-workflow-lite — 工作流中心各页左栏「视图选项」的选择（分组、排序、只看哪些）：记在本机浏览器里，下次打开照旧。
 *
 * 和配色主题一样只是看的样子，不进工作流、不进 profile。每页一个键；记坏了、存不下都按默认（坏掉的那一项单独按默认）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/listView
 */

import { useCallback, useState } from 'react'
import type { StoredView } from '../model/listView.ts'

/** 读记下的选择。 */
export function readView<V extends Record<keyof V, string>>(stored: StoredView<V>): V {
  try {
    const raw = window.localStorage.getItem(stored.key)
    if (raw === null) return stored.defaults
    const value = JSON.parse(raw) as Record<string, unknown> | null
    const out = { ...stored.defaults }
    for (const name of Object.keys(stored.defaults) as (keyof V)[]) {
      const hit = stored.choices[name].find((item) => item === value?.[name as string])
      if (hit !== undefined) out[name] = hit
    }
    return out
  } catch {
    return stored.defaults
  }
}

function saveView<V extends Record<keyof V, string>>(stored: StoredView<V>, view: V): void {
  try {
    const plain = (Object.keys(stored.defaults) as (keyof V)[]).every(
      (name) => view[name] === stored.defaults[name],
    )
    if (plain) window.localStorage.removeItem(stored.key)
    else window.localStorage.setItem(stored.key, JSON.stringify(view))
  } catch {
    // 存不下（隐私模式、配额满）：这次照样换，下次打开回到默认。
  }
}

/** 左栏的视图选项：改一项（只给改的那几样），立即生效并记下。 */
export function useListView<V extends Record<keyof V, string>>(
  stored: StoredView<V>,
): [V, (change: Partial<V>) => void] {
  const [view, setView] = useState(() => readView(stored))
  const change = useCallback(
    (next: Partial<V>) => {
      setView((current) => {
        const merged = { ...current, ...next }
        saveView(stored, merged)
        return merged
      })
    },
    [stored],
  )
  return [view, change]
}
