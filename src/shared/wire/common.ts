/**
 * dsh-workflow-lite — 线格式：各组共用的线上形状（目前只有非阻塞信息 `WireWarning`）。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/common
 */

import type { ToolWarning } from '../types.ts'

// ─────────────────────────────────────────────────────────────
// 端点形状
// ─────────────────────────────────────────────────────────────

/**
 * 一条非阻塞信息（警告 / 提示）——就是工具侧的 `ToolWarning`，不另立一套，
 * 否则两边的 `code` 会各自漂移（一边是 `ValidationCode`，一边是裸 `string`）。
 */
export type WireWarning = ToolWarning
