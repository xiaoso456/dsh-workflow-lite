/**
 * dsh-workflow-lite — 通用文案：标签页名、通用按钮、通用错误。
 *
 * 各功能都会用到的几句，放在这里；只属于某个功能的文案去对应的文件。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n/common
 */

/** 中文（默认）。 */
export const zh = {
  'tab.label': '工作流',

  // ── 通用 ────────────────────────────────────────────────────
  'common.cancel': '取消',
  'common.confirm': '确认',
  'common.close': '关闭',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.delete': '删除',
  'common.retry': '重试',
  'error.generic': '操作失败',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  'tab.label': 'Workflow',

  // ── 通用 ────────────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.delete': 'Delete',
  'common.retry': 'Retry',
  'error.generic': 'Something went wrong',
}
