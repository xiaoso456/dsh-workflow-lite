/**
 * dsh-workflow-lite — 「触发方式」对话框顶上那一句话：这张卡片什么时候执行。纯计算，按界面语言。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerSay
 */

import { afterWhen } from '../../shared/trigger.ts'
import type { AfterWhen, CheckWhen, TriggerSource } from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { fillSay, rulePhrase } from './triggerText.ts'
import { cronPhrase } from './triggerUpcoming.ts'

const CHECK_WHEN: Record<CheckWhen, LocaleKey> = {
  success: 'trigger.say.checkSuccess',
  every: 'trigger.say.checkEvery',
  change: 'trigger.say.checkChange',
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
          ? (cronPhrase(t, schedule.expression) ?? rulePhrase(t, schedule))
          : rulePhrase(t, schedule)
      if (source.check === undefined) return fillSay(t('trigger.say.schedule'), { rule })
      return fillSay(t('trigger.say.check'), { rule, when: t(CHECK_WHEN[source.check.when]) })
    }
    // 不写命令（下面的工作台里就是命令，长了这里只剩一串省略号）。
    case 'listen':
      return t(source.command.trim() === '' ? 'trigger.say.listenNone' : 'trigger.say.listen')
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
