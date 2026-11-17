/**
 * dsh-workflow-lite — 触发卡片上的字：触发源的一句话、下一次的时刻、状态。纯函数，不碰界面。
 *
 * 状态按 {@link SourceFace} 说：带检查命令的定时叫「检查中」、先说上一次检查的结果，别的按触发源。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerText
 */

import { type CronFieldName, dailyTimes, type ScheduleIssue } from '../../shared/schedule.ts'
import { afterWhen, type SourceIssue } from '../../shared/trigger.ts'
import type {
  AfterWhen,
  TriggerSchedule,
  TriggerSource,
  TriggerSourceKind,
} from '../../shared/types.ts'
import type { TriggerState, TriggerView } from '../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { shortTime } from './time.ts'

/**
 * 卡片上按什么样子说状态：带检查命令的定时是 `check`（检查中、上次检查的结果、下一次检查），别的就是触发源本身。
 * 类型名、图标、颜色仍按触发源（带不带检查都叫「定时」）。
 */
export type SourceFace = TriggerSourceKind | 'check'

export function sourceFace(source: TriggerSource): SourceFace {
  return source.kind === 'schedule' && source.check !== undefined ? 'check' : source.kind
}

const HAN = /\p{Script=Han}/u
const LATIN = /[A-Za-z0-9]/u

/** 两个字一个是汉字、一个是字母或数字。 */
const needsSpace = (left: string, right: string): boolean =>
  (HAN.test(left) && LATIN.test(right)) || (LATIN.test(left) && HAN.test(right))

/**
 * 把 `{name}` 换成值，没给值的占位原样留着（写错了看得出来）。
 * 换进去的值和两边的汉字、字母、数字挨着时补一个空格（「发 POST 请求」「18:00 执行」）。
 */
export function fillSay(template: string, values: Readonly<Record<string, string>>): string {
  let out = ''
  let from = 0
  for (const match of template.matchAll(/\{(\w+)\}/gu)) {
    const at = match.index ?? 0
    const end = at + match[0].length
    out += template.slice(from, at)
    const value = values[match[1] ?? '']
    if (value === undefined) out += match[0]
    else {
      out += needsSpace(out.slice(-1), value.slice(0, 1)) ? ` ${value}` : value
      if (needsSpace(value.slice(-1), template.slice(end, end + 1))) out += ' '
    }
    from = end
  }
  return out + template.slice(from)
}

const DAY_KEYS: readonly LocaleKey[] = [
  'trigger.day.1',
  'trigger.day.2',
  'trigger.day.3',
  'trigger.day.4',
  'trigger.day.5',
  'trigger.day.6',
  'trigger.day.7',
]

/** 星期几的字（ISO：1 = 周一 … 7 = 周日）。 */
export function weekdayText(t: T, day: number): string {
  return t(DAY_KEYS[day - 1] ?? 'trigger.day.1')
}

const CHIP_KEYS: readonly LocaleKey[] = [
  'trigger.dayChip.1',
  'trigger.dayChip.2',
  'trigger.dayChip.3',
  'trigger.dayChip.4',
  'trigger.dayChip.5',
  'trigger.dayChip.6',
  'trigger.dayChip.7',
]

/** 选星期的小圆钮上的字：一行排七个，英文用两个字母（规则摘要里仍用 {@link weekdayText}）。 */
export function weekdayChip(t: T, day: number): string {
  return t(CHIP_KEYS[day - 1] ?? 'trigger.dayChip.1')
}

/** 星期几的一组是不是正好这几天。 */
function sameDays(days: readonly number[], wanted: readonly number[]): boolean {
  return days.length === wanted.length && wanted.every((day) => days.includes(day))
}

/** 间隔的短写法：「5 分钟」「30 秒」「2 小时」「1 天」。 */
export function spanText(t: T, seconds: number): string {
  if (seconds > 0 && seconds % 86_400 === 0) {
    return t('trigger.say.days').replace('{n}', String(seconds / 86_400))
  }
  if (seconds > 0 && seconds % 3600 === 0) {
    return t('trigger.say.hours').replace('{n}', String(seconds / 3600))
  }
  if (seconds > 0 && seconds % 60 === 0) {
    return t('trigger.say.minutes').replace('{n}', String(seconds / 60))
  }
  return t('trigger.say.seconds').replace('{n}', String(seconds))
}

/** 定时规则的一句话：「每 30 秒」「每 30 分钟」「每天 09:00」「工作日 09:00」「每周一、五 09:00」「cron 0 9 * * *」。 */
export function ruleText(t: T, schedule: TriggerSchedule): string {
  return describeRule(t, schedule, LABEL)
}

/**
 * 定时规则放进一句话里的说法（「触发方式」对话框顶上那句）：中文和 {@link ruleText} 一样，
 * 英文小写开头、带介词（「every 5 min」「daily at 09:00」「on weekdays at 09:00」）。
 */
export function rulePhrase(t: T, schedule: TriggerSchedule): string {
  return describeRule(t, schedule, PHRASE)
}

/** 一种说法里各种规则用哪条文案。 */
interface RuleKeys {
  seconds: LocaleKey
  minutes: LocaleKey
  hours: LocaleKey
  days: LocaleKey
  daily: LocaleKey
  workdays: LocaleKey
  weekend: LocaleKey
  weekly: LocaleKey
  cron: LocaleKey
}

const LABEL: RuleKeys = {
  seconds: 'trigger.rule.seconds',
  minutes: 'trigger.rule.minutes',
  hours: 'trigger.rule.hours',
  days: 'trigger.rule.days',
  daily: 'trigger.rule.daily',
  workdays: 'trigger.rule.workdays',
  weekend: 'trigger.rule.weekend',
  weekly: 'trigger.rule.weekly',
  cron: 'trigger.rule.cron',
}

const PHRASE: RuleKeys = {
  seconds: 'trigger.phrase.seconds',
  minutes: 'trigger.phrase.minutes',
  hours: 'trigger.phrase.hours',
  days: 'trigger.phrase.days',
  daily: 'trigger.phrase.daily',
  workdays: 'trigger.phrase.workdays',
  weekend: 'trigger.phrase.weekend',
  weekly: 'trigger.phrase.weekly',
  cron: 'trigger.phrase.cron',
}

function describeRule(t: T, schedule: TriggerSchedule, keys: RuleKeys): string {
  if (schedule.kind === 'every') {
    const { seconds } = schedule
    if (seconds > 0 && seconds % 86_400 === 0) {
      return t(keys.days).replace('{n}', String(seconds / 86_400))
    }
    if (seconds > 0 && seconds % 3600 === 0) {
      return t(keys.hours).replace('{n}', String(seconds / 3600))
    }
    if (seconds > 0 && seconds % 60 === 0) {
      return t(keys.minutes).replace('{n}', String(seconds / 60))
    }
    return t(keys.seconds).replace('{n}', String(seconds))
  }
  if (schedule.kind === 'cron') {
    return t(keys.cron).replace('{expr}', schedule.expression.trim())
  }
  // 一天里几个时刻：挨个列出来。
  const time = dailyTimes(schedule).join(t('trigger.rule.sep'))
  if (schedule.weekdays === undefined) return t(keys.daily).replace('{time}', time)
  // 最常见的两组有自己的说法（卡片上放得下）。
  if (sameDays(schedule.weekdays, [1, 2, 3, 4, 5])) {
    return t(keys.workdays).replace('{time}', time)
  }
  if (sameDays(schedule.weekdays, [6, 7])) {
    return t(keys.weekend).replace('{time}', time)
  }
  const days = schedule.weekdays.map((day) => weekdayText(t, day)).join(t('trigger.rule.sep'))
  return t(keys.weekly).replace('{days}', days).replace('{time}', time)
}

const AFTER_TEXT: Record<AfterWhen, LocaleKey> = {
  done: 'trigger.rule.afterDone',
  failed: 'trigger.rule.afterFailed',
  any: 'trigger.rule.afterAny',
}

/** 触发源的一句话（卡片上的第二行）：定时说规则（带检查的说「…检查」），监听、HTTP 说是什么，接续说等谁。 */
export function sourceText(t: T, source: TriggerSource): string {
  if (source.kind === 'schedule') {
    const rule = ruleText(t, source.schedule)
    return source.check === undefined ? rule : fillSay(t('trigger.rule.check'), { rule })
  }
  if (source.kind === 'listen') return t('trigger.rule.listen')
  if (source.kind === 'http') return t('trigger.rule.http')
  if (source.kind === 'after') {
    if (source.workflow === '') return t('trigger.rule.afterNone')
    return t(AFTER_TEXT[afterWhen(source)]).replace('{name}', source.workflow)
  }
  return ''
}

/** 一个时刻怎么说：今天、明天只说钟点，再远的带上月日。 */
export function momentText(t: T, at: number, now: number = Date.now()): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const today = new Date(now)
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const days = Math.floor((at - dayStart) / 86_400_000)
  if (days === 0) return t('trigger.today').replace('{time}', clock)
  if (days === 1) return t('trigger.tomorrow').replace('{time}', clock)
  return shortTime(at)
}

const STATE_TEXT: Record<TriggerState, LocaleKey> = {
  off: 'trigger.state.off',
  waiting: 'trigger.state.waiting',
  listening: 'trigger.state.listening',
  restarting: 'trigger.state.restarting',
  error: 'trigger.state.error',
  invalid: 'trigger.state.invalid',
  confirm: 'trigger.state.confirm',
  stopped: 'trigger.state.stopped',
  elsewhere: 'trigger.state.elsewhere',
  unavailable: 'trigger.state.unavailable',
  paused: 'trigger.state.paused',
}

const CRON_FIELD: Record<CronFieldName, LocaleKey> = {
  minute: 'trigger.cronField.minute',
  hour: 'trigger.cronField.hour',
  day: 'trigger.cronField.day',
  month: 'trigger.cronField.month',
  weekday: 'trigger.cronField.weekday',
}

/** 定时规则写得不对的一句话（按界面语言）。 */
export function scheduleIssueText(t: T, issue: ScheduleIssue): string {
  const fill = (key: LocaleKey, values: Record<string, string | number>): string =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      t(key),
    )
  switch (issue.code) {
    case 'every':
      return fill('trigger.issue.every', {
        min: spanText(t, issue.min),
        max: spanText(t, issue.max),
      })
    case 'time':
      return fill('trigger.issue.time', { time: issue.time })
    case 'cronEmpty':
      return t('trigger.issue.cronEmpty')
    case 'cronParts':
      return fill('trigger.issue.cronParts', { n: issue.count })
    case 'cronSyntax':
    case 'cronStep':
      return fill(
        issue.code === 'cronSyntax' ? 'trigger.issue.cronSyntax' : 'trigger.issue.cronStep',
        {
          field: t(CRON_FIELD[issue.field]),
          part: issue.part === '' ? t('trigger.issue.empty') : issue.part,
        },
      )
    case 'cronRange':
      return fill('trigger.issue.cronRange', {
        field: t(CRON_FIELD[issue.field]),
        part: issue.part,
        min: issue.min,
        max: issue.max,
      })
    case 'cronNever':
      return t('trigger.issue.cronNever')
  }
}

/** 触发源写得不对的一句话（按界面语言）。 */
export function sourceIssueText(t: T, issue: SourceIssue): string {
  switch (issue.code) {
    case 'schedule':
      return scheduleIssueText(t, issue.issue)
    case 'noWorkflow':
      return t('trigger.issue.noWorkflow')
    case 'noCommand':
      return t('trigger.issue.noCommand')
    case 'tooOften':
      return t('trigger.issue.tooOften')
  }
}

/** 状态后面跟的那半句；没有就是空串。 */
function stateDetail(
  t: T,
  view: TriggerView,
  face: SourceFace,
  now: number,
  next: boolean,
): string {
  const at = (key: LocaleKey, moment: number): string =>
    t(key).replace('{time}', momentText(t, moment, now))
  switch (view.state) {
    case 'waiting':
      // 定时检查：先说上一次检查的结果，还没检查过就说下一次。
      if (face === 'check' && view.checked !== undefined) {
        return at(view.checked.met ? 'trigger.checkedMet' : 'trigger.checkedUnmet', view.checked.at)
      }
      return view.next === undefined || !next ? '' : at('trigger.next', view.next)
    case 'elsewhere':
      return view.next === undefined || !next ? '' : at('trigger.next', view.next)
    case 'listening':
      return view.since === undefined ? '' : at('trigger.started', view.since)
    case 'restarting':
      return view.next === undefined ? '' : at('trigger.restartAt', view.next)
    case 'confirm':
      return t('trigger.confirmHint')
    default:
      return ''
  }
}

/**
 * 卡片、面板上的那一行状态：「等待中 · 下一次 明天 09:00」「检查中 · 上次 10:02 未满足」。
 * 还没读到状态时按关着算。
 * @param options.next - 说不说「下一次」（缺省说；面板里定时规则下面已经写着下一次，就不再说）。
 */
export function stateText(
  t: T,
  view: TriggerView | undefined,
  face: SourceFace = 'schedule',
  now: number = Date.now(),
  options: { next?: boolean } = {},
): string {
  if (view === undefined) return t(STATE_TEXT.off)
  // 定时检查开着时叫「检查中」，别的都叫「等待中」。
  const label =
    view.state === 'waiting' && face === 'check'
      ? t('trigger.state.checking')
      : t(STATE_TEXT[view.state])
  const detail = stateDetail(t, view, face, now, options.next !== false)
  return detail === '' ? label : `${label} · ${detail}`
}

const BADGE_TEXT: Record<TriggerState, LocaleKey> = {
  off: 'trigger.badge.off',
  waiting: 'trigger.badge.waiting',
  listening: 'trigger.badge.listening',
  restarting: 'trigger.badge.restarting',
  error: 'trigger.badge.error',
  invalid: 'trigger.badge.invalid',
  confirm: 'trigger.badge.confirm',
  stopped: 'trigger.badge.stopped',
  elsewhere: 'trigger.badge.elsewhere',
  unavailable: 'trigger.badge.unavailable',
  paused: 'trigger.badge.paused',
}

/**
 * 画布卡片标题右边的状态小标：两三个字（「已停用」「等待中」「别处负责」）。
 * 还没读到状态时按关着算；定时检查开着时叫「检查中」。
 */
export function stateBadge(
  t: T,
  view: TriggerView | undefined,
  face: SourceFace = 'schedule',
): string {
  if (view === undefined) return t(BADGE_TEXT.off)
  if (view.state === 'waiting' && face === 'check') return t('trigger.badge.checking')
  return t(BADGE_TEXT[view.state])
}

/**
 * 画布卡片底行跟在「主动 / 被动」后面的那半句：下一次什么时候、上次检查的结果、出了什么错；没有就是空串。
 * （状态本身在标题右边的小标上，这里不重复。）
 */
export function stateNote(
  t: T,
  view: TriggerView | undefined,
  face: SourceFace = 'schedule',
  now: number = Date.now(),
): string {
  if (view === undefined) return ''
  const detail = stateDetail(t, view, face, now, true)
  if (detail !== '') return detail
  // 小标缩短了的几种，底行补全说法。
  if (view.state === 'elsewhere' || view.state === 'unavailable' || view.state === 'paused') {
    return t(STATE_TEXT[view.state])
  }
  return view.problem ?? ''
}

/**
 * 状态的颜色分组（卡片的状态小标、「触发」页的圆点共用）：
 * - `off` 关着（灰）；
 * - `armed` 开着、等时间或等别的工作流（强调色）：定时、接续的等待中；
 * - `live` 正在盯着外面（绿，圆点一呼一吸）：监听、HTTP 的接收中，定时检查的检查中；
 * - `other` 开着但不归这里管（石板灰）：由另一个 DSH 负责；
 * - `warn` 停着等人处理（琥珀）：待确认、已全部暂停、重启中、这里无法触发；
 * - `bad` 出了问题（红）：出错、设置不对、已自动停用。
 */
export type TriggerTone = 'off' | 'armed' | 'live' | 'other' | 'warn' | 'bad'

export function stateTone(state: TriggerState, face: SourceFace): TriggerTone {
  switch (state) {
    case 'off':
      return 'off'
    case 'waiting':
      return face === 'check' ? 'live' : 'armed'
    case 'listening':
      return 'live'
    case 'elsewhere':
      return 'other'
    case 'confirm':
    case 'paused':
    case 'restarting':
    case 'unavailable':
      return 'warn'
    case 'error':
    case 'invalid':
    case 'stopped':
      return 'bad'
  }
}
