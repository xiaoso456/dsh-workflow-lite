/**
 * dsh-workflow-lite — 触发卡片面板里各行摘要的字：「触发方式」卡片的第二行、过滤、保护（详细设置都在对话框里，面板上只留一句）。
 * 纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerSummary
 */

import { nextFire } from '../../shared/schedule.ts'
import {
  type FilterSettings,
  type LaunchSettings,
  NO_LIMIT,
  sourceIssue,
} from '../../shared/trigger.ts'
import { isLoopbackHost } from '../../shared/triggerHttp.ts'
import type { TriggerSchedule, TriggerSource } from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { momentText, sourceIssueText } from './triggerText.ts'

const SEP = ' · '

/** 「合并 5 秒内的 · 10 分钟内去重 · 含「ERROR」才触发」；什么都不筛时「不过滤」。 */
export function filterSummary(t: T, filter: FilterSettings): string {
  const words = (list: readonly string[]): string => list.join(t('trigger.rule.sep'))
  const parts = [
    filter.merge > 0 ? t('trigger.sum.merge').replace('{n}', String(filter.merge)) : '',
    filter.dedupe > 0 ? t('trigger.sum.dedupe').replace('{n}', String(filter.dedupe)) : '',
    filter.include.length > 0
      ? t('trigger.sum.include').replace('{words}', words(filter.include))
      : '',
    filter.exclude.length > 0
      ? t('trigger.sum.exclude').replace('{words}', words(filter.exclude))
      : '',
  ].filter((part) => part !== '')
  return parts.length === 0 ? t('trigger.sum.noFilter') : parts.join(SEP)
}

/** 「上次执行未结束时跳过 · 每小时最多 60 次 · 连续 3 次失败停用」，关了补发再加「不补发错过的触发」。 */
export function guardSummary(t: T, launch: LaunchSettings): string {
  return [overlapSummary(t, launch), guardLimits(t, launch)].join(SEP)
}

/** 上次执行未结束时怎么办：「上次执行未结束时跳过」「…排队，最多 10 个」「允许同时运行」。 */
function overlapSummary(t: T, launch: LaunchSettings): string {
  switch (launch.overlap) {
    case 'skip':
      return t('trigger.sum.skip')
    case 'parallel':
      return t('trigger.sum.parallel')
    case 'queue':
      return launch.queueMax === NO_LIMIT
        ? t('trigger.sum.queueAny')
        : t('trigger.sum.queue').replace('{n}', String(launch.queueMax))
  }
}

const OVERLAP_BRIEF: Record<LaunchSettings['overlap'], LocaleKey> = {
  skip: 'trigger.brief.skip',
  queue: 'trigger.brief.queue',
  parallel: 'trigger.brief.parallel',
}

/** 保护里除了「上次执行未结束时怎么办」之外的几项：「每小时最多 60 次 · 连续 3 次失败停用」。 */
export function guardLimits(t: T, launch: LaunchSettings): string {
  return [
    launch.maxPerHour === NO_LIMIT
      ? t('trigger.sum.noPerHour')
      : t('trigger.sum.perHour').replace('{n}', String(launch.maxPerHour)),
    launch.maxFailures === NO_LIMIT
      ? t('trigger.sum.noFailures')
      : t('trigger.sum.failures').replace('{n}', String(launch.maxFailures)),
    launch.catchUp ? '' : t('trigger.sum.noCatchUp'),
  ]
    .filter((part) => part !== '')
    .join(SEP)
}

/** 面板一行里放得下的短写法：「运行中跳过 · 60 次/时 · 3 次失败停用」；完整说法见 {@link guardSummary}（悬停提示用）。 */
export function guardBrief(t: T, launch: LaunchSettings): string {
  return [
    t(OVERLAP_BRIEF[launch.overlap]),
    launch.maxPerHour === NO_LIMIT
      ? t('trigger.brief.noPerHour')
      : t('trigger.brief.perHour').replace('{n}', String(launch.maxPerHour)),
    launch.maxFailures === NO_LIMIT
      ? t('trigger.brief.noFailures')
      : t('trigger.brief.failures').replace('{n}', String(launch.maxFailures)),
    launch.catchUp ? '' : t('trigger.brief.noCatchUp'),
  ]
    .filter((part) => part !== '')
    .join(SEP)
}

/** 「触发方式」卡片速览下面那一行：`code` 用等宽字（命令），`problem` 是红字（规则写错了）。 */
export interface WhenDetail {
  text: string
  tone: 'plain' | 'code' | 'problem'
}

/**
 * 「触发方式」卡片速览下面那一行，补速览没说的：
 * - 定时：下一次什么时候（「每隔」开着时以宿主排的为准，`live.next`）；
 * - 定时检查：要跑的命令；监听：速览在显示程序打出的行时写命令，否则一句怎么触发；
 * - HTTP：有了地址之后写谁能访问（只有这台电脑 / 同一网络里的机器也行）；怎么触发在换方式的菜单里说过，不重复；
 * - 接续：速览已经说全了，不写；
 * - 没写命令、没选工作流：速览已经红着说了，这里说「补上才能打开」；别的写错（规则、间隔）在这里用红字说。
 */
export function whenDetail(
  t: T,
  source: TriggerSource,
  live: { next?: number | undefined; line?: string | undefined; url?: string | undefined },
  now: Date,
): WhenDetail {
  const issue = sourceIssue(source)
  if (issue?.code === 'noCommand') return { text: t('trigger.detail.needCommand'), tone: 'plain' }
  if (issue?.code === 'noWorkflow') return { text: t('trigger.detail.needWorkflow'), tone: 'plain' }
  if (issue !== null) return { text: sourceIssueText(t, issue), tone: 'problem' }
  switch (source.kind) {
    case 'schedule': {
      if (source.check !== undefined) return { text: source.check.command, tone: 'code' }
      const at = scheduleNext(source.schedule, live.next, now)
      return at === undefined
        ? { text: '', tone: 'plain' }
        : {
            text: t('trigger.preview').replace('{time}', momentText(t, at, now.getTime())),
            tone: 'plain',
          }
    }
    case 'listen':
      return live.line === undefined
        ? { text: t('trigger.detail.listen'), tone: 'plain' }
        : { text: source.command, tone: 'code' }
    case 'http':
      return { text: live.url === undefined ? '' : reachText(t, live.url), tone: 'plain' }
    case 'after':
      return { text: '', tone: 'plain' }
  }
}

/** 定时下一次在什么时候：「每隔」开着时以宿主排的为准（`live`），别的按规则从 `now` 往后算；排不出来是 `undefined`。 */
export function scheduleNext(
  schedule: TriggerSchedule,
  live: number | undefined,
  now: Date,
): number | undefined {
  return schedule.kind === 'every' && live !== undefined ? live : nextFire(schedule, now)?.getTime()
}

/** HTTP 触发的地址谁能访问。 */
function reachText(t: T, url: string): string {
  const host = URL.canParse(url) ? new URL(url).hostname : ''
  return t(isLoopbackHost(host) ? 'trigger.detail.httpLocal' : 'trigger.detail.httpLan')
}

/** 规则还差什么时「触发方式」卡头那个按钮写什么（没问题时是「编辑」）。 */
export function whenActionKey(source: TriggerSource): LocaleKey {
  const issue = sourceIssue(source)
  if (issue === null) return 'trigger.edit'
  if (issue.code === 'noCommand') return 'trigger.fix.command'
  if (issue.code === 'noWorkflow') return 'trigger.fix.workflow'
  return 'trigger.fix.rule'
}
