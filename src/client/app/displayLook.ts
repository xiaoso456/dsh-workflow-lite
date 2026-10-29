/**
 * dsh-workflow-lite — 画布上的看板默认长什么样：展示卡，还是镂空贴在画布上。记在浏览器里。
 *
 * 和配色主题一样只是看起来的样子（见 `app/theme.ts`）：「设置 → 外观」里换，卡片自己的「外观」没选时跟着它。
 * 缺省镂空：看板透明、直接贴在画布上，后面垫一层四边渐隐的画布底色，画布的点在内容下面淡出去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/displayLook
 */

import { useSyncExternalStore } from 'react'
import { VIEW_LOOKS, type ViewLook } from '../../shared/types.ts'

const KEY = 'workflow-lite.displayLook'
export const DEFAULT_DISPLAY_LOOK: ViewLook = 'clear'

let current: ViewLook | null = null
const listeners = new Set<() => void>()

const isLook = (value: unknown): value is ViewLook => VIEW_LOOKS.some((look) => look === value)

/** 读记下的选择；没记过、记坏了、存储不可用都按默认。 */
export function readDisplayLook(): ViewLook {
  try {
    const raw = window.localStorage.getItem(KEY)
    return isLook(raw) ? raw : DEFAULT_DISPLAY_LOOK
  } catch {
    return DEFAULT_DISPLAY_LOOK
  }
}

export function getDisplayLook(): ViewLook {
  current ??= readDisplayLook()
  return current
}

/** 换一种；换回默认时把记录删掉。 */
export function setDisplayLook(next: ViewLook): void {
  if (next === getDisplayLook()) return
  current = next
  try {
    if (next === DEFAULT_DISPLAY_LOOK) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, next)
  } catch {
    // 存不下（隐私模式、配额满）：这次照样换，下次打开回到默认。
  }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== KEY && event.key !== null) return
    current = readDisplayLook()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useDisplayLook(): ViewLook {
  return useSyncExternalStore(subscribe, getDisplayLook, () => DEFAULT_DISPLAY_LOOK)
}

/** 测试用：丢掉缓存，下次从存储重新读。 */
export function resetDisplayLookCache(): void {
  current = null
}
