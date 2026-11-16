/**
 * dsh-workflow-lite — 工作流中心「触发」页上「现在怎样」的几句话：状态条里状态后面那一段（下一次、还有多久），
 * 左栏每行状态后面的那半句、按时间排时紧凑行尾写的时刻。纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerNow
 */

import type { TriggerEntry } from '../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { durationText, pastTime } from './time.ts'
import { endpointPath, readableUrl } from './triggerGlance.ts'
import { nextOf, type TriggerSortBy } from './triggerList.ts'
import { momentText, sourceText } from './triggerText.ts'

/** 状态条里状态后面那一段：一句主话（时刻），一句淡的（还有多久、跑了多久、地址）。 */
export interface StatusWhen {
  main: string
  aside: string
}

/**
 * - 等下一次（定时、轮询）：「下一次 今天 18:00」「3 小时 12 分后」；
 * - 监听程序在跑：「09:12 启动」「已运行 5 小时 3 分」；HTTP 开着：「地址开着」和地址；
 * - 接续在等：等谁、什么结果；监听程序在重启：什么时候重启；
 * - 别的（关着、出了问题、全部暂停）：上一次触发是什么时候，还没触发过就这么说。
 */
export function statusWhen(t: T, entry: TriggerEntry, now: number): StatusWhen {
  const { view, data } = entry
  const kind = data.source.kind
  const ahead = (at: number): string => t('hub.trgIn').replace('{span}', durationText(t, at - now))
  const time = (key: LocaleKey, at: number): string =>
    t(key).replace('{time}', momentText(t, at, now))
  const waiting = view.state === 'waiting' || view.state === 'elsewhere'
  if (waiting && view.next !== undefined && (kind === 'schedule' || kind === 'poll')) {
    return {
      main: time(kind === 'poll' ? 'hub.trgNextCheck' : 'trigger.next', view.next),
      aside: ahead(view.next),
    }
  }
  if (view.state === 'listening' && kind === 'listen' && view.since !== undefined) {
    return {
      main: time('trigger.started', view.since),
      aside: t('hub.trgRunFor').replace('{span}', durationText(t, now - view.since)),
    }
  }
  if (view.state === 'listening' && kind === 'http') {
    const url = view.endpoint?.url
    return {
      main: t('hub.trgAddressOpen'),
      aside: url === undefined ? '' : readableUrl(endpointPath(url)),
    }
  }
  if (waiting && kind === 'after') return { main: sourceText(t, data.source), aside: '' }
  if (view.state === 'restarting' && view.next !== undefined) {
    return { main: time('trigger.restartAt', view.next), aside: ahead(view.next) }
  }
  const last = view.last
  if (last === undefined) return { main: t('trigger.historyEmpty'), aside: '' }
  return {
    main: t('hub.trgLast').replace('{time}', pastTime(t, last.at, now)),
    aside: t('hub.trgAgo').replace('{span}', durationText(t, now - last.at)),
  }
}

/**
 * 左栏一行状态后面的那半句：按工作流分组时写下一次（或监听从什么时候起、接续等谁），别的分法写在哪个工作流。
 * 没话说时是空串。
 */
export function rowNote(t: T, entry: TriggerEntry, byWorkflow: boolean, now: number): string {
  if (!byWorkflow) return entry.workflow
  const { view, data } = entry
  const kind = data.source.kind
  if ((view.state === 'waiting' || view.state === 'elsewhere') && view.next !== undefined) {
    return momentText(t, view.next, now)
  }
  if (view.state === 'listening' && kind === 'listen' && view.since !== undefined) {
    return t('trigger.started').replace('{time}', momentText(t, view.since, now))
  }
  if (view.state === 'waiting' && kind === 'after') return sourceText(t, data.source)
  return ''
}

/**
 * 按时间排时紧凑的行尾写的时刻（跟着排序走）：按最近触发排写上一次触发的时刻（没触发过就这么说），
 * 按下一次触发排写下一次的时刻。没有下一次（关着、被动等着）、按名称排是 `undefined`，行尾照常写状态。
 */
export function sortWhen(
  t: T,
  entry: TriggerEntry,
  sort: TriggerSortBy,
  now: number,
): string | undefined {
  if (sort === 'recent') {
    const last = entry.view.last
    return last === undefined ? t('hub.trgNeverFired') : pastTime(t, last.at, now)
  }
  if (sort === 'next') {
    const next = nextOf(entry)
    return next === undefined ? undefined : momentText(t, next, now)
  }
  return undefined
}
