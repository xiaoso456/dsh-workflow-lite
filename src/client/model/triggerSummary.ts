/**
 * dsh-workflow-lite — 触发卡片面板里各行摘要的字：「触发方式」卡片的第二行、过滤、保护（详细设置都在对话框里，面板上只留一句）。
 * 纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerSummary
 */

import { nextFire } from '../../shared/schedule.ts'
import { type FilterSettings, type LaunchSettings, sourceIssue } from '../../shared/trigger.ts'
import type { TriggerSource } from '../../shared/types.ts'
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

/** 「没跑完时跳过 · 每小时最多 12 次 · 连续 3 次失败停用」，关了补触发再加「不补错过的」。 */
export function guardSummary(t: T, launch: LaunchSettings): string {
  return [
    t(launch.overlap === 'parallel' ? 'trigger.sum.parallel' : 'trigger.sum.skip'),
    t('trigger.sum.perHour').replace('{n}', String(launch.maxPerHour)),
    t('trigger.sum.failures').replace('{n}', String(launch.maxFailures)),
    launch.catchUp ? '' : t('trigger.sum.noCatchUp'),
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
 * - 轮询：要跑的命令；监听：速览在显示程序打出的行时写命令，否则一句怎么触发；
 * - HTTP、接续：一句怎么触发；
 * - 没写命令、没选工作流：速览已经红着说了，这里说「补上才能打开」；别的写错（规则、间隔）在这里用红字说。
 */
export function whenDetail(
  t: T,
  source: TriggerSource,
  live: { next?: number | undefined; line?: string | undefined },
  now: Date,
): WhenDetail {
  const issue = sourceIssue(source)
  if (issue?.code === 'noCommand') return { text: t('trigger.detail.needCommand'), tone: 'plain' }
  if (issue?.code === 'noWorkflow') return { text: t('trigger.detail.needWorkflow'), tone: 'plain' }
  if (issue !== null) return { text: sourceIssueText(t, issue), tone: 'problem' }
  switch (source.kind) {
    case 'schedule': {
      const at =
        source.schedule.kind === 'every' && live.next !== undefined
          ? live.next
          : nextFire(source.schedule, now)?.getTime()
      return at === undefined
        ? { text: '', tone: 'plain' }
        : {
            text: t('trigger.preview').replace('{time}', momentText(t, at, now.getTime())),
            tone: 'plain',
          }
    }
    case 'poll':
      return { text: source.command, tone: 'code' }
    case 'listen':
      return live.line === undefined
        ? { text: t('trigger.detail.listen'), tone: 'plain' }
        : { text: source.command, tone: 'code' }
    case 'http':
      return { text: t('trigger.detail.http'), tone: 'plain' }
    case 'after':
      return { text: t('trigger.detail.after'), tone: 'plain' }
  }
}

/** 规则还差什么时「触发方式」卡头那个按钮写什么（没问题时是「编辑」）。 */
export function whenActionKey(source: TriggerSource): LocaleKey {
  const issue = sourceIssue(source)
  if (issue === null) return 'trigger.edit'
  if (issue.code === 'noCommand') return 'trigger.fix.command'
  if (issue.code === 'noWorkflow') return 'trigger.fix.workflow'
  return 'trigger.fix.rule'
}
