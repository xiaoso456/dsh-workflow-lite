/**
 * dsh-workflow-lite — 选了哪套配色主题：亮色一套、暗色一套，记在浏览器里。
 *
 * 只是看起来的样子，不改工作流、也不用存进 profile：和视口、步骤库开关一样记在 localStorage。
 * 同一个页面里几处一起订阅（视图根节点、设置页），换了马上都跟着变；别的标签页改了也跟着变。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/theme
 */

import { useSyncExternalStore } from 'react'
import {
  type DarkThemeId,
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  isDarkTheme,
  isLightTheme,
  type LightThemeId,
  type ThemeMode,
} from '../model/themes.ts'

export interface ThemeChoice {
  light: LightThemeId
  dark: DarkThemeId
}

const KEY = 'workflow-lite.theme'
const DEFAULT: ThemeChoice = { light: DEFAULT_LIGHT, dark: DEFAULT_DARK }

let current: ThemeChoice | null = null
const listeners = new Set<() => void>()

/** 读记下的选择；没记过、记坏了、存储不可用都按默认（坏掉的那一半单独按默认）。 */
export function readThemeChoice(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return DEFAULT
    const value = JSON.parse(raw) as { light?: unknown; dark?: unknown } | null
    return {
      light: isLightTheme(value?.light) ? value.light : DEFAULT_LIGHT,
      dark: isDarkTheme(value?.dark) ? value.dark : DEFAULT_DARK,
    }
  } catch {
    return DEFAULT
  }
}

export function getThemeChoice(): ThemeChoice {
  current ??= readThemeChoice()
  return current
}

/** 换一套（只换给出的那一半）。两套都是默认时把记录删掉。 */
export function setThemeChoice(next: Partial<ThemeChoice>): void {
  const merged = { ...getThemeChoice(), ...next }
  if (merged.light === current?.light && merged.dark === current?.dark) return
  current = merged
  try {
    if (merged.light === DEFAULT_LIGHT && merged.dark === DEFAULT_DARK) {
      window.localStorage.removeItem(KEY)
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(merged))
    }
  } catch {
    // 存不下（隐私模式、配额满）：这次照样换，下次打开回到默认。
  }
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== KEY && event.key !== null) return
    current = readThemeChoice()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, getThemeChoice, () => DEFAULT)
}

/** 测试用：丢掉缓存，下次从存储重新读。 */
export function resetThemeCache(): void {
  current = null
}

/**
 * 此刻是亮还是暗：宿主把 `color-scheme` 写在 `<html>` 上；写的是 `light dark`（跟系统）时看系统设置。
 * 只用来在设置页标「正在用」，配色本身由 CSS 的 `light-dark()` 自己挑。
 */
export function currentScheme(): ThemeMode {
  if (typeof document === 'undefined') return 'light'
  const scheme = getComputedStyle(document.documentElement).colorScheme
  const light = scheme.includes('light')
  const dark = scheme.includes('dark')
  if (dark && !light) return 'dark'
  if (light && !dark) return 'light'
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light'
}

function subscribeScheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true })
  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
  media?.addEventListener('change', listener)
  return () => {
    observer.disconnect()
    media?.removeEventListener('change', listener)
  }
}

export function useColorScheme(): ThemeMode {
  return useSyncExternalStore(subscribeScheme, currentScheme, () => 'light')
}
