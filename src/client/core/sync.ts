/**
 * dsh-workflow-lite — 什么时候该落盘（**纯决策**，计时器由组件层注入）。
 *
 * 规则（设计文档 §6.5 / §7.3）：
 * - 改动 → 防抖 `saveDebounceMs`，**指针停稳后才写一次**（拖动过程中不写盘）。
 * - **离开画布（卸载 / 切走 / 失焦）→ 立即写**，不等防抖——否则未落盘的改动会随组件一起没。
 * - 保存中不重入；没有基线（没打开图）不写。
 *
 * @module @xiaoso/dsh-workflow-lite/client/core/sync
 */

import { type CanvasState, needsSave } from './state.ts'

/** 触发这次判断的时机。 */
export type SaveReason = 'edit' | 'settled' | 'leaving' | 'manual'

export type SaveDecision =
  /** 什么都不做。 */
  | { kind: 'none'; because: 'clean' | 'no-document' | 'saving' }
  /** 排一个 `delayMs` 后的防抖写；期间再来改动就重排。 */
  | { kind: 'debounced'; delayMs: number }
  /** 立刻写。 */
  | { kind: 'now' }

export interface SaveIntent {
  state: CanvasState
  reason: SaveReason
  /** 防抖窗口（`Config.saveDebounceMs`）。 */
  debounceMs: number
  /** 上一次改动的时间戳；没有改动过就是 null。 */
  lastEditAt: number | null
  /** 现在。 */
  now: number
}

/**
 * 该不该写、现在写还是等一等。
 *
 * `settled` 表示"指针停稳了"——拖动过程中的 `moveNode` 用 `edit` 传进来，
 * 那时只重排计时器；停稳后组件再发一次 `settled`。
 */
export function decideSave(intent: SaveIntent): SaveDecision {
  const { state, reason, debounceMs, lastEditAt, now } = intent
  if (state.document === null || state.name === null) {
    return { kind: 'none', because: 'no-document' }
  }
  if (state.status === 'saving') return { kind: 'none', because: 'saving' }
  if (!needsSave(state)) return { kind: 'none', because: 'clean' }

  switch (reason) {
    case 'leaving':
    case 'manual':
      return { kind: 'now' }
    case 'settled': {
      if (lastEditAt === null) return { kind: 'now' }
      const elapsed = now - lastEditAt
      return elapsed >= debounceMs
        ? { kind: 'now' }
        : { kind: 'debounced', delayMs: debounceMs - elapsed }
    }
    case 'edit':
      return { kind: 'debounced', delayMs: debounceMs }
    default: {
      const exhaustive: never = reason
      return { kind: 'none', because: exhaustive === undefined ? 'clean' : 'clean' }
    }
  }
}

/** 状态条要显示什么（纯映射，组件直接渲染）。 */
export function statusKey(
  state: CanvasState,
):
  | 'status.loading'
  | 'status.saving'
  | 'status.saved'
  | 'status.dirty'
  | 'status.error'
  | 'status.idle' {
  switch (state.status) {
    case 'loading':
      return 'status.loading'
    case 'saving':
      return 'status.saving'
    case 'saved':
      return 'status.saved'
    case 'dirty':
      return 'status.dirty'
    case 'error':
      return 'status.error'
    default:
      return 'status.idle'
  }
}
