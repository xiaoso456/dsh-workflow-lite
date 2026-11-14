/**
 * dsh-workflow-lite — 「触发方式」对话框顶上那一句话：这张卡片什么时候执行。纯计算，按界面语言。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerSay
 */

import { afterWhen, pollWhen } from '../../shared/trigger.ts'
import type { AfterWhen, PollWhen, TriggerSource } from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { ruleText } from './triggerText.ts'
import { cronPhrase } from './triggerUpcoming.ts'

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

/** 轮询间隔的短写法：「5 分钟」「30 秒」「2 小时」「1 天」。 */
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

/**
 * 命令里那个程序的短名字：第一个像脚本文件的词（`watch.mjs`），没有就是命令本身的名字（`git`）。
 * 引号、路径、`{workflow}` 这些去掉。
 */
export function programName(command: string): string {
  const words = command.trim().match(/"[^"]*"|'[^']*'|\S+/gu) ?? []
  const bare = words.map((word) => word.replace(/^["']|["']$/gu, ''))
  const script = bare.find((word) => /\.(m?js|cjs|ts|py|sh|ps1|bat|cmd|rb|pl)$/iu.test(word))
  const pick = script ?? bare[0] ?? ''
  return pick.split(/[\\/]/u).pop() ?? pick
}

const POLL_WHEN: Record<PollWhen, LocaleKey> = {
  success: 'trigger.say.pollSuccess',
  every: 'trigger.say.pollEvery',
  change: 'trigger.say.pollChange',
}

const AFTER_RESULT: Record<AfterWhen, LocaleKey> = {
  done: 'trigger.say.afterDone',
  failed: 'trigger.say.afterFailed',
  any: 'trigger.say.afterAny',
}

/** 这张卡片什么时候执行的一句话。 */
export function sourceSay(t: T, source: TriggerSource): string {
  switch (source.kind) {
    case 'schedule': {
      const { schedule } = source
      const rule =
        schedule.kind === 'cron'
          ? (cronPhrase(t, schedule.expression) ?? ruleText(t, schedule))
          : ruleText(t, schedule)
      return fillSay(t('trigger.say.schedule'), { rule })
    }
    case 'poll':
      return fillSay(t('trigger.say.poll'), {
        every: spanText(t, source.seconds),
        when: t(POLL_WHEN[pollWhen(source)]),
      })
    case 'listen': {
      const program = programName(source.command)
      if (program === '') return t('trigger.say.listenNone')
      return fillSay(t('trigger.say.listen'), { program })
    }
    case 'http':
      return fillSay(t('trigger.say.http'), { method: 'POST' })
    case 'after':
      if (source.workflow === '') return t('trigger.say.afterNone')
      return fillSay(t('trigger.say.after'), {
        name: source.workflow,
        result: t(AFTER_RESULT[afterWhen(source)]),
      })
  }
}
