/**
 * dsh-workflow-lite — 轮询「判定」旁边的示意：一排 6 次检查，每次的结果（退出码或输出）、算什么、哪几次执行。
 * 规则看一眼就懂，下面再一句话补齐（背景信息、第一次怎样）。
 *
 * 两种判定都是 6 格，换判定只换字和属性，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/JudgeStrip
 */

import type { PollWhen } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { Icon } from '../../kit/Icon.tsx'
import { SwapText } from '../../motion/swapText.tsx'
import css from './judge.module.css'

/** 一次检查：框里写什么（`key` 是要翻译的）、下面写算什么、这次执不执行。 */
interface Check {
  value: string | { key: LocaleKey }
  caption: LocaleKey
  /** `fire`：这一次执行；`hold`：满足但不执行（一直成功）；`none`：不满足、只记下、跳过。 */
  mark: 'fire' | 'hold' | 'none'
}

export const JUDGE_EXAMPLES: Record<PollWhen, readonly Check[]> = {
  success: [
    { value: '1', caption: 'trigger.judge.failed', mark: 'none' },
    { value: '0', caption: 'trigger.judge.fire', mark: 'fire' },
    { value: '0', caption: 'trigger.judge.still', mark: 'hold' },
    { value: '2', caption: 'trigger.judge.failed', mark: 'none' },
    { value: '0', caption: 'trigger.judge.fire', mark: 'fire' },
    { value: '0', caption: 'trigger.judge.still', mark: 'hold' },
  ],
  change: [
    { value: 'A', caption: 'trigger.judge.first', mark: 'none' },
    { value: 'A', caption: 'trigger.judge.same', mark: 'none' },
    { value: 'B', caption: 'trigger.judge.fire', mark: 'fire' },
    { value: 'B', caption: 'trigger.judge.same', mark: 'none' },
    { value: { key: 'trigger.judge.error' }, caption: 'trigger.judge.skip', mark: 'none' },
    { value: 'C', caption: 'trigger.judge.fire', mark: 'fire' },
  ],
}

export function JudgeStrip(props: { t: T; when: PollWhen }): React.JSX.Element {
  const { t } = props
  return (
    <ol
      className={css.strip}
      aria-label={t('trigger.judge.example')}
      data-when={props.when}
      data-testid="wl-trigger-judge"
    >
      {JUDGE_EXAMPLES[props.when].map((check, index) => (
        // 6 格位置固定，换判定只换字。
        // biome-ignore lint/suspicious/noArrayIndexKey: 格子没有别的标识
        <li key={index} className={css.check} data-mark={check.mark}>
          <span className={css.bolt} aria-hidden="true">
            <Icon name="bolt" size={11} />
          </span>
          <span className={css.value}>
            <SwapText text={typeof check.value === 'string' ? check.value : t(check.value.key)} />
          </span>
          <span className={css.caption}>
            <SwapText text={t(check.caption)} />
          </span>
        </li>
      ))}
    </ol>
  )
}
