/**
 * dsh-workflow-lite — 定时规则给人看的两样：本机时区怎么说，以及一条 cron 换成人话是哪句。
 * 纯计算，给「触发方式」对话框里的一句话、接下来 7 天和 cron 输入框下面用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerUpcoming
 */

import { cronAsSimple } from '../../shared/schedule.ts'
import type { T } from '../i18n.ts'
import { rulePhrase } from './triggerText.ts'

/** 本机时区的写法：`UTC+8`、`UTC-3:30`、`UTC`。 */
export function zoneText(now: number): string {
  // getTimezoneOffset 是「UTC 减本地」的分钟数，东八区是 -480。
  const minutes = -new Date(now).getTimezoneOffset()
  if (minutes === 0) return 'UTC'
  const size = Math.abs(minutes)
  const rest = size % 60
  return `UTC${minutes > 0 ? '+' : '-'}${String(Math.floor(size / 60))}${
    rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`
  }`
}

/** 一条 cron 换成句子里的说法（「工作日 09:00」「每 15 分钟」，见 {@link rulePhrase}）；说不成的是 `null`。 */
export function cronPhrase(t: T, expression: string): string | null {
  const simple = cronAsSimple(expression)
  return simple === null ? null : rulePhrase(t, simple)
}
