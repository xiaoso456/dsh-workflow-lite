/**
 * dsh-workflow-lite — 触发卡片的「速览」：卡片中间那一行，按触发源换样子，一眼看出怎么触发。
 *
 * - 定时：一周七天的小格（选中的上色）+ 几点；每隔多久、cron 各说一句；
 * - 轮询：每隔多久 + 什么时候算满足，底边一条进度到下一次检查；
 * - 监听：要跑的命令，跑起来之后换成它最近打出的一行；
 * - HTTP：`POST` + 地址（打开过开关才有）；
 * - 接续：等哪个工作流 → 什么结果。
 *
 * 这里只算图里写着的那部分（字已按语言取好）；本机现场（最近一行、地址、下一次检查）由卡片从现场读。
 * 纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerGlance
 */

import { afterWhen, pollWhen } from '../../shared/trigger.ts'
import type { AfterWhen, PollWhen, TriggerSource, TriggerSourceKind } from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { ruleText, weekdayChip } from './triggerText.ts'

/** 主动：插件按时间自己去做（定时、轮询）；被动：等外面的事发生（监听、HTTP、接续）。 */
export type TriggerMode = 'active' | 'passive'

export function triggerMode(kind: TriggerSourceKind): TriggerMode {
  return kind === 'schedule' || kind === 'poll' ? 'active' : 'passive'
}

/** 速览那一行画什么（`shape` 是样子，不是触发源：定时有三种样子）。 */
export type TriggerGlance =
  /** 每天、每周几：七个小格 + 钟点。 */
  | { shape: 'days'; days: { label: string; on: boolean }[]; time: string }
  /** 每隔多久（定时）。 */
  | { shape: 'every'; text: string }
  | { shape: 'cron'; expression: string }
  /** 轮询：每隔多久、什么时候算满足；`seconds` 给进度条算起点。 */
  | { shape: 'poll'; every: string; when: string; seconds: number }
  /** 监听：要跑的命令（跑起来之后卡片换成最近一行）。 */
  | { shape: 'listen'; command: string }
  /** HTTP：还没有地址时说的话（有了地址卡片自己换）。 */
  | { shape: 'http'; idle: string }
  | { shape: 'after'; workflow: string; when: string }
  /** 还没填好（没选工作流、没写命令）：只说缺什么。 */
  | { shape: 'empty'; text: string }

const POLL_WHEN: Record<PollWhen, LocaleKey> = {
  success: 'trigger.pollWhen.success',
  every: 'trigger.pollWhen.every',
  change: 'trigger.pollWhen.change',
}

const AFTER_WHEN: Record<AfterWhen, LocaleKey> = {
  done: 'trigger.afterWhen.done',
  failed: 'trigger.afterWhen.failed',
  any: 'trigger.afterWhen.any',
}

/** 每隔多少秒的短说法：「每 30 秒」「每 5 分钟」「每 2 小时」。 */
function everySeconds(t: T, seconds: number): string {
  if (seconds > 0 && seconds % 3600 === 0) {
    return t('trigger.rule.hours').replace('{n}', String(seconds / 3600))
  }
  if (seconds > 0 && seconds % 60 === 0) {
    return t('trigger.rule.minutes').replace('{n}', String(seconds / 60))
  }
  return t('trigger.glance.seconds').replace('{n}', String(seconds))
}

/** 卡片上的速览（只看图里写的）。 */
export function triggerGlance(t: T, source: TriggerSource): TriggerGlance {
  switch (source.kind) {
    case 'schedule': {
      const { schedule } = source
      if (schedule.kind === 'every') return { shape: 'every', text: ruleText(t, schedule) }
      if (schedule.kind === 'cron') return { shape: 'cron', expression: schedule.expression.trim() }
      const picked = schedule.weekdays
      const days = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        label: weekdayChip(t, day),
        on: picked === undefined || picked.includes(day),
      }))
      // 卡片上只放得下一个时刻：还有别的就写「+2」。
      const more = schedule.moreTimes?.length ?? 0
      return {
        shape: 'days',
        days,
        time: more === 0 ? schedule.time : `${schedule.time} +${String(more)}`,
      }
    }
    case 'poll':
      return {
        shape: 'poll',
        every: everySeconds(t, source.seconds),
        when: t(POLL_WHEN[pollWhen(source)]),
        seconds: source.seconds,
      }
    case 'listen': {
      const command = source.command.trim()
      if (command === '') return { shape: 'empty', text: t('trigger.issue.noCommand') }
      return { shape: 'listen', command }
    }
    case 'http':
      return { shape: 'http', idle: t('trigger.glance.httpIdle') }
    case 'after':
      if (source.workflow === '') return { shape: 'empty', text: t('trigger.rule.afterNone') }
      return { shape: 'after', workflow: source.workflow, when: t(AFTER_WHEN[afterWhen(source)]) }
  }
}

/** 地址在卡片上的短写法：去掉 `http://` 和主机，留端口和路径（`:3791/trigger/7f3a…`）。 */
/** 网址给人看的样子：地址里转义过的中文等解开；解不开就原样。 */
export function readableUrl(url: string): string {
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

export function endpointPath(url: string): string {
  const match = /^[a-z]+:\/\/[^/:]+(.*)$/iu.exec(url)
  return match?.[1] ?? url
}

/**
 * 轮询到下一次检查走了多少（0–1）以及还剩多少毫秒：下一次检查减去间隔就是这一段的起点。
 * 没有下一次（关着、出错）时 `null`。
 */
export function pollProgress(
  next: number | undefined,
  seconds: number,
  now: number,
): { from: number; left: number } | null {
  if (next === undefined || seconds <= 0) return null
  const span = seconds * 1000
  const left = Math.max(0, next - now)
  const from = Math.min(1, Math.max(0, 1 - left / span))
  return { from, left }
}
