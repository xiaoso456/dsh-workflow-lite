/**
 * dsh-workflow-lite — 时间的显示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/time
 */

/** `10-02 14:30`：列表、顶栏、文件信息里的时间。 */
export function shortTime(value: number | string | undefined): string {
  if (value === undefined) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
