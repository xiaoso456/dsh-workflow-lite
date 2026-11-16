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
  'common.span.d': '{n} 天',
  'common.yesterday': '昨天',
  'common.span.h': '{n} 小时',
  'common.span.m': '{n} 分',
  'common.span.s': '{n} 秒',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.delete': '删除',
  'common.retry': '重试',
  'common.search': '搜索',
  'common.noMatch': '没有匹配的',
  'common.decrease': '减少',
  'common.increase': '增加',
  'common.hour': '时',
  'common.minute': '分',
  'common.pickTime': '选时刻',
  'common.now': '现在',
  'error.generic': '操作失败',
  'error.viewCrashed': '工作流视图出错了',
  'error.viewCrashedBody': '已保存的工作流和实例不受影响；点「重试」重新打开这个视图。',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  'tab.label': 'Workflow',

  // ── 通用 ────────────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'common.span.d': '{n} d',
  'common.yesterday': 'Yesterday',
  'common.span.h': '{n} h',
  'common.span.m': '{n} min',
  'common.span.s': '{n} s',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.delete': 'Delete',
  'common.retry': 'Retry',
  'common.search': 'Search',
  'common.decrease': 'Decrease',
  'common.increase': 'Increase',
  'common.hour': 'Hour',
  'common.minute': 'Minute',
  'common.pickTime': 'Pick a time',
  'common.now': 'Now',
  'common.noMatch': 'No matches',
  'error.generic': 'Something went wrong',
  'error.viewCrashed': 'The workflow view ran into an error',
  'error.viewCrashedBody':
    'Saved workflows and instances are not affected. Click Retry to reopen this view.',
}
