/**
 * dsh-workflow-lite — 每张图上次看到哪（视口）记在浏览器里，不写进图文件。
 *
 * 视口是看图的人自己的状态：拖动、缩放只是浏览，不该让图变成「待保存」，
 * 更不该因为一次平移就整图写盘、和模型正在做的改动撞车。图文件里的 `viewport` 只读不写，
 * 浏览器里没记过（第一次打开、换了浏览器）时拿它兜底。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/viewport
 */

import type { Viewport } from '../../shared/types.ts'

const PREFIX = 'workflow-lite.viewport.'

/** 这张图上次的视口；没记过、记坏了或存储不可用就是 `null`。 */
export function recallViewport(workflow: string): Viewport | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + workflow)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { x, y, zoom } = value as Record<string, unknown>
    if (![x, y, zoom].every((part) => typeof part === 'number' && Number.isFinite(part)))
      return null
    return { x: x as number, y: y as number, zoom: zoom as number }
  } catch {
    // 隐私模式 / 被策略禁掉：记不住视角不该让画布打不开。
    return null
  }
}

/** 记下这张图的视口（尽力而为）。 */
export function rememberViewport(workflow: string, viewport: Viewport): void {
  try {
    const { x, y, zoom } = viewport
    window.localStorage.setItem(PREFIX + workflow, JSON.stringify({ x, y, zoom }))
  } catch {
    // 同上。
  }
}
