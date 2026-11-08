/**
 * dsh-workflow-lite — 输入卡：执行前问用户的一个问题，右边的点拖到步骤上就是把回答交给它。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/InputCard
 */

import { Handle, type NodeProps, Position } from '@xyflow/react'
import { memo } from 'react'
import { Icon } from '../../kit/Icon.tsx'
import { cx } from '../../kit/primitives.tsx'
import css from '../canvas.module.css'
import type { InputFlowNode } from '../types.ts'

/** 输入卡左侧签上的图标：按交互方式。 */
const INPUT_ICON = {
  text: 'inputText',
  textarea: 'inputArea',
  choice: 'inputChoice',
  multi: 'inputMulti',
} as const

/**
 * 输入卡：执行前问用户的一个问题。左边一条墨色的签印着交互方式，右边的点拖到步骤上 = 把回答交给它。
 * 没有入口——输入不从任何地方来，是用户填的。
 */
export const InputCard = memo(function InputCard(
  props: NodeProps<InputFlowNode>,
): React.JSX.Element {
  const { data, selected } = props
  const empty = data.question === ''
  return (
    <div
      className={cx(css.inputCard, selected && css.cardSelected)}
      data-tone={data.tone}
      data-dim={data.dim}
      data-testid="wl-input"
      data-tip={data.note === '' ? undefined : data.note}
    >
      <span className={css.inputTab} aria-hidden="true">
        <Icon name={INPUT_ICON[data.kind]} size={14} />
      </span>
      <span className={css.fileText}>
        <span className={cx(css.inputQuestion, empty && css.inputEmpty)}>
          {empty ? data.emptyText : data.question}
        </span>
        <span className={css.fileRule}>{data.meta}</span>
      </span>
      {data.tone !== 'ok' && (
        <span className={css.cardFlag} data-tone={data.tone}>
          <Icon name="alert" size={12} />
        </span>
      )}
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={cx(css.handle, css.handleOut, css.handleRead, css.handleAsk)}
        data-tip={data.connectText}
      />
    </div>
  )
})
