/**
 * dsh-workflow-lite — 「运行实例」页右栏里一步的情况：谁做的、几点开始、用了多久、第几轮（{@link StepMeta}），
 * 下面失败原因、摘要、判定和产出（{@link StepBody}）。「概览」的「现在」和「画布」页签下面那张卡共用。
 *
 * 这些都是模型写的、有就写，没有不占位；时间是插件改状态时记的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/StepFacts
 */

import type { NodeRunState } from '../../../../shared/runState.ts'
import type { T } from '../../../i18n.ts'
import { clockTime, durationText } from '../../../model/time.ts'
import { Icon } from '../../kit/Icon.tsx'
import css from './step.module.css'

const timeOf = (value: string | undefined): number | undefined => {
  const time = value === undefined ? Number.NaN : Date.parse(value)
  return Number.isNaN(time) ? undefined : time
}

/** 一行灰字：谁做的、几点开始（做完了再写用了多久）、第几轮（第二轮起才写）；什么都没有返回 `null`。 */
export function StepMeta(props: {
  t: T
  node: NodeRunState | undefined
}): React.JSX.Element | null {
  const { t, node } = props
  if (node === undefined) return null
  const start = timeOf(node.startedAt)
  const end = timeOf(node.finishedAt)
  const parts: React.ReactNode[] = []
  if (node.by !== undefined) {
    parts.push(
      <span key="by" className={css.metaPart}>
        <Icon name="user" size={12} />
        {node.by}
      </span>,
    )
  }
  if (start !== undefined) {
    parts.push(
      <span key="at" className={css.metaPart}>
        <Icon name="clock" size={12} />
        {t('hub.runStepFrom').replace('{time}', clockTime(start))}
        {end !== undefined && end >= start && ` · ${durationText(t, end - start)}`}
      </span>,
    )
  }
  if (node.round !== undefined && node.round > 1) {
    parts.push(
      <span key="round" className={css.metaPart}>
        <Icon name="loop" size={12} />
        {t('run.round').replace('{n}', String(node.round))}
      </span>,
    )
  }
  return parts.length === 0 ? null : <span className={css.meta}>{parts}</span>
}

/** 这一步写了失败原因、摘要、判定或产出里的哪一样（{@link StepBody} 有东西可画）。 */
export function hasStepBody(node: NodeRunState | undefined): boolean {
  return (
    node !== undefined &&
    (node.error !== undefined ||
      node.summary !== undefined ||
      node.verdict !== undefined ||
      (node.outputs ?? []).length > 0)
  )
}

/** 失败原因、摘要、判定和产出；都没有返回 `null`。 */
export function StepBody(props: {
  t: T
  node: NodeRunState | undefined
}): React.JSX.Element | null {
  const { t, node } = props
  if (node === undefined || !hasStepBody(node)) return null
  const outputs = node.outputs ?? []
  const chips = node.verdict !== undefined || outputs.length > 0
  return (
    <div className={css.body}>
      {node.error !== undefined && (
        <p className={css.error} data-testid="wl-hub-step-error">
          {node.error}
        </p>
      )}
      {node.summary !== undefined && <p className={css.summary}>{node.summary}</p>}
      {chips && (
        <span className={css.chips}>
          {node.verdict !== undefined && (
            <span className={css.verdict}>
              {t('run.verdict')} · {node.verdict}
            </span>
          )}
          {outputs.map((path) => (
            <span key={path} className={css.file} data-tip={path}>
              <Icon name="file" size={12} />
              <span className={css.fileText}>{path}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
