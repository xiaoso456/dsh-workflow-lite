/**
 * dsh-workflow-lite — 时间的显示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/time
 */

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
