/**
 * dsh-workflow-lite — 「触发方式」对话框右边顶上的一块：小字写「主动 · 定时」，下面一句话说这张卡片什么时候执行
 * （规则、间隔、等哪个工作流这几处上触发方式的颜色），再下面一行是现在的情况（下一次、在不在跑、改了没保存）。
 *
 * 一直挂着：换方式、改设置时只换字。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/SourceSummary
 */

import type { TriggerSource } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { triggerMode } from '../../../model/triggerGlance.ts'
import { sourceSay } from '../../../model/triggerSay.ts'
import { Icon } from '../../kit/Icon.tsx'
import { SOURCE_KINDS } from './kinds.ts'
import css from './sourceStage.module.css'

export function SourceSummary(props: {
  t: T
  source: TriggerSource
  /** 写得不对的一句（定时规则不对等）：换掉那句话下面一行，标红。 */
  problem?: string | null | undefined
  /** 下面一行：现在的情况。 */
  children?: React.ReactNode
}): React.JSX.Element {
  const { t, source } = props
  const mode = triggerMode(source.kind)
  const kind = SOURCE_KINDS.find((item) => item.value === source.kind)
  const problem = props.problem ?? null
  return (
    <section
      className={css.summary}
      data-testid="wl-trigger-summary"
      data-problem={problem !== null}
    >
      <p className={css.eyebrow}>
        <Icon name={mode === 'active' ? 'arrowOut' : 'arrowIn'} size={11} />
        {t(mode === 'active' ? 'trigger.mode.active' : 'trigger.mode.passive')}
        <span aria-hidden="true">·</span>
        {kind === undefined ? '' : t(kind.label)}
      </p>
      <p className={css.say} data-testid="wl-trigger-rule-title">
        {sourceSay(t, source).map((segment, index) =>
          segment.token === true ? (
            // 一句话里的段落只按位置区分。
            // biome-ignore lint/suspicious/noArrayIndexKey: 段落没有别的标识，整句一起换
            <span key={index} className={css.token}>
              {segment.text}
            </span>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同上
            <span key={index}>{segment.text}</span>
          ),
        )}
      </p>
      <div className={css.meta} data-testid="wl-trigger-preview">
        {problem === null ? props.children : <span className={css.problem}>{problem}</span>}
      </div>
    </section>
  )
}
