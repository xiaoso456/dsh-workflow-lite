/**
 * dsh-workflow-lite — 步骤卡：标题、提示词摘要、运行状态小标、记忆开关与各个连接点。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/StepCard
 */

import { Handle, type NodeProps, Position } from '@xyflow/react'
import { memo } from 'react'
import type { ResourceRole } from '../../../../shared/resources.ts'
import type { NodeStatus } from '../../../../shared/runState.ts'
import { type Spot, STEP_SPOTS } from '../../../model/route.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import { cx } from '../../kit/primitives.tsx'
import { StepMark } from '../../kit/StepMark.tsx'
import { FadeRing } from '../../motion/marks.tsx'
import { SwapIcon, SwapText } from '../../motion/swapText.tsx'
import css from '../canvas.module.css'
import type { StepData, StepFlowNode } from '../types.ts'

const ROLES = ['producer', 'updater', 'reader'] as const satisfies readonly ResourceRole[]

/** 运行状态的图标与文案。 */
const RUN_ICON: Record<NodeStatus, IconName> = {
  pending: 'clock',
  running: 'play',
  waiting: 'hourglass',
  done: 'check',
  failed: 'alert',
  skipped: 'skip',
}

/** 上下边上的连接点沿边摆在几成处：交给 CSS 变量，样式表据此定位（拖线时也要用它放回圆点）。 */
function spotVar(spot: Spot): React.CSSProperties {
  return { '--wl-at': spot.at } as React.CSSProperties
}

/** 卡片描边是哪一层：运行中 / 失败 / 等待优先，其次是悬停资源时的读写角色。 */
function ringOf(data: StepData): string | undefined {
  const status = data.run?.status
  if (status === 'running' || status === 'failed' || status === 'waiting') return status
  return data.role ?? undefined
}

export const StepCard = memo(function StepCard(props: NodeProps<StepFlowNode>): React.JSX.Element {
  const { data, id, selected } = props
  return (
    <div
      className={cx(css.card, selected && css.cardSelected)}
      data-tone={data.tone}
      data-dim={data.dim}
      data-role={data.role ?? undefined}
      data-run={data.run?.status}
      data-mark={data.run?.mark}
      data-testid="wl-step"
      data-tip={data.note === '' ? undefined : data.note}
    >
      {data.run !== null && (
        <button
          type="button"
          className={cx(css.runChip, 'nodrag')}
          data-status={data.run.status}
          data-edited={data.run.edited}
          data-testid="wl-run-chip"
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation()
            data.onRunStatus(id, event.currentTarget)
          }}
        >
          <SwapIcon name={RUN_ICON[data.run.status]} size={11} />
          <SwapText text={data.run.label} />
          {data.run.round > 1 && <span className={css.runRound}>{data.run.roundText}</span>}
        </button>
      )}
      {data.role === null && data.run?.mark !== undefined && (
        <span className={css.markTag} data-mark={data.run.mark} data-testid="wl-run-mark">
          <Icon name={data.run.mark === 'last' ? 'pin' : 'arrowRight'} size={11} />
          {data.run.markText}
        </span>
      )}
      {/* 卡片的描边（运行态 / 角色）和执行位置的外圈：换状态时旧的淡出、新的淡入，不是颜色瞬切。 */}
      <FadeRing ring={ringOf(data)} className={css.cardRing} />
      <FadeRing ring={data.run?.mark} className={css.markRing} />
      {data.role !== null && (
        <span className={css.roleTag} data-role={data.role} data-testid="wl-step-role">
          {ROLES.map((role) => (
            <span
              key={role}
              className={css.roleTone}
              data-role={role}
              data-on={role === data.role}
            />
          ))}
          <SwapText text={data.roleText} />
        </span>
      )}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        className={cx(css.handle, css.handleIn, css.hStepIn)}
      />
      <div className={css.cardHead}>
        <StepMark look={data.look} />
        <span className={css.cardTitle}>{data.title}</span>
        {data.tone !== 'ok' && (
          <span className={css.cardFlag} data-tone={data.tone}>
            <Icon name="alert" size={13} />
          </span>
        )}
        {/* 记忆开关：开着时一直亮着，关着时悬停卡片才露出来。点一下开 / 关（关掉不删文件）。 */}
        {data.onMemory !== null ? (
          <button
            type="button"
            className={cx(css.memToggle, 'nodrag')}
            data-on={data.memory}
            data-tip={data.memoryText}
            aria-label={data.memoryText}
            aria-pressed={data.memory}
            data-testid="wl-step-memory"
            onClick={(event) => {
              event.stopPropagation()
              data.onMemory?.(id, event.currentTarget)
            }}
          >
            <Icon name="memory" size={14} />
          </button>
        ) : (
          data.memory && (
            <span className={css.memToggle} data-on="true" aria-hidden="true">
              <Icon name="memory" size={14} />
            </span>
          )
        )}
      </div>
      {data.excerpt === '' ? (
        <p className={cx(css.cardBody, css.cardBodyEmpty)}>{data.noPromptText}</p>
      ) : (
        <p className={css.cardBody}>{data.excerpt}</p>
      )}
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={cx(css.handle, css.handleOut, css.handleSource)}
        data-tip={data.addText}
        onClick={(event) => data.onAdd(id, event.currentTarget)}
      />
      {/* 底边偏左的方点（文件树的树干）：拖到文件卡上 = 写它；拖到空白处 = 就地新建一个产出文件。
          其余读写点平时不露，有线挂上才显示（线挂在哪个点上见 model/route.ts）。 */}
      <Handle
        id="file"
        type="source"
        position={Position.Bottom}
        className={cx(css.handle, css.handleOut, css.handleFile, css.spotted)}
        style={spotVar(STEP_SPOTS.file)}
        data-used={data.used.includes('file')}
        data-tip={data.fileText}
      />
      <Handle
        id="fileUp"
        type="source"
        position={Position.Top}
        className={cx(css.handle, css.handleOut, css.handleFileUp, css.handleAux, css.spotted)}
        style={spotVar(STEP_SPOTS.fileUp)}
        data-used={data.used.includes('fileUp')}
      />
      <Handle
        id="read"
        type="target"
        position={Position.Bottom}
        className={cx(css.handle, css.handleIn, css.hRead, css.handleAux, css.spotted)}
        style={spotVar(STEP_SPOTS.read)}
        data-used={data.used.includes('read')}
      />
      <Handle
        id="readTop"
        type="target"
        position={Position.Top}
        className={cx(css.handle, css.handleIn, css.hReadTop, css.handleAux, css.spotted)}
        style={spotVar(STEP_SPOTS.readTop)}
        data-used={data.used.includes('readTop')}
      />
    </div>
  )
})
