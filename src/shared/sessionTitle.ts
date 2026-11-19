/**
 * dsh-workflow-lite — 插件新建的会话叫什么：「工作流名 · 怎么来的 · 时间」，如「日报汇总 · 工作日夜巡 · 11-19 02:30」。
 *
 * 工作流名放最前（侧栏里按工作流找），时间写到分钟（同一张卡多次触发也分得开）。
 * 前两段太长就截断加省略号，时间总是完整的。插件经 DSH 改的标题算用户自己改的，DSH 之后不会再自动改它。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/sessionTitle
 */

/** 工作流名、来源各自最多几个字。 */
export const TITLE_PART_MAX = 16

function clip(text: string): string {
  const chars = [...text.trim()]
  return chars.length <= TITLE_PART_MAX
    ? chars.join('')
    : `${chars.slice(0, TITLE_PART_MAX - 1).join('')}…`
}

/** 本地时间的「月-日 时:分」。 */
function stamp(at: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`
}

/**
 * 新建会话的标题。
 * @param workflow - 工作流名。
 * @param via - 怎么来的：触发卡片的名字（没起名时是触发方式的简述），手动执行时是「手动」。
 * @param at - 发起的时刻。
 */
export function sessionTitle(workflow: string, via: string, at: Date): string {
  return `${clip(workflow)} · ${clip(via)} · ${stamp(at)}`
}
