/**
 * dsh-workflow-lite — 时间的显示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/time
 */

import type { LocaleKey, T } from '../i18n.ts'

const pad = (n: number): string => String(n).padStart(2, '0')

/** `14:30`。 */
export function clockTime(value: number): string {
  const date = new Date(value)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `2026-10-02 14:30:05`：详情里的完整时刻。 */
export function fullTime(value: number): string {
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clockTime(value)}:${pad(date.getSeconds())}`
}

/** `10-02 14:30`：列表、顶栏、文件信息里的时间。 */
export function shortTime(value: number | string | undefined): string {
  if (value === undefined) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 一段时长：一天以上「2 天 3 小时」，一小时以上「3 小时 12 分」，一分钟以上「2 分 10 秒」，再短「45 秒」。
 * 只写最大的两个单位，第二个是 0 时不写。
 */
export function durationText(t: T, ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const units: [number, LocaleKey][] = [
    [86_400, 'common.span.d'],
    [3600, 'common.span.h'],
    [60, 'common.span.m'],
    [1, 'common.span.s'],
  ]
  const at = units.findIndex(([size]) => seconds >= size)
  if (at < 0) return t('common.span.s').replace('{n}', '0')
  const [size, key] = units[at] as [number, LocaleKey]
  const head = t(key).replace('{n}', String(Math.floor(seconds / size)))
  const next = units[at + 1]
  if (next === undefined) return head
  const rest = Math.floor((seconds % size) / next[0])
  return rest === 0 ? head : `${head} ${t(next[1]).replace('{n}', String(rest))}`
}
