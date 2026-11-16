/**
 * dsh-workflow-lite — 工作流中心各页左栏的行高：标准（图标块 + 两行字）或紧凑（一行：名字 + 行尾一格短字）。
 *
 * 四页共用一个选择（在哪页换，四页一起变），在「视图选项」里换；和配色主题一样只是看的样子，记在浏览器里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/listDensity
 */

import { useSyncExternalStore } from 'react'

export type ListDensity = 'standard' | 'compact'
export const LIST_DENSITIES: readonly ListDensity[] = ['standard', 'compact']

const KEY = 'workflow-lite.hubDensity'
const DEFAULT: ListDensity = 'standard'

let current: ListDensity | null = null
const listeners = new Set<() => void>()

/** 读记下的选择；没记过、记坏了、存储不可用都按标准。 */
function read(): ListDensity {
  try {
    const raw = window.localStorage.getItem(KEY)
    return LIST_DENSITIES.find((one) => one === raw) ?? DEFAULT
  } catch {
    return DEFAULT
  }
}

export function getListDensity(): ListDensity {
  current ??= read()
  return current
}

/** 换一种；换回标准时把记录删掉。 */
export function setListDensity(next: ListDensity): void {
  if (next === getListDensity()) return
  current = next
  try {
    if (next === DEFAULT) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, next)
  } catch {
    // 存不下（隐私模式、配额满）：这次照样换，下次打开回到标准。
  }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== KEY && event.key !== null) return
    current = read()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useListDensity(): ListDensity {
  return useSyncExternalStore(subscribe, getListDensity, () => DEFAULT)
}

/** 测试用：丢掉缓存，下次从存储重新读。 */
export function resetListDensityCache(): void {
  current = null
}
