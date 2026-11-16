/**
 * dsh-workflow-lite — 「运行实例」页的「概览」，和「触发」页概览同样的排法：
 *
 * - 四格数：完成几步（共几步）、失败、跳过、耗时；
 * - 「进程」：一步一行、横轴是时间（建立 → 现在 / 结束），一段是一次执行（重跑两段，停下等用户是斜纹），
 *   段的起止是插件改状态时记下的时间（{@link runSpans}）；点一步到「画布」页签看它；
 * - 「现在」：目标、正在做 / 在等你 / 最后一步、下一步、说明，没有的行不出。
 *
 * 不记进度、状态文件读不出来时只写原因（和目标）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/OverviewTab
 */

import { findNode } from '../../../../shared/model.ts'
import type { RunCursor } from '../../../../shared/runCursor.ts'
import type { InstanceSummary, InstanceView, NodeStatus } from '../../../../shared/runState.ts'
import { useNow } from '../../../app/useNow.ts'
import type { T } from '../../../i18n.ts'
import { nodeTitle } from '../../../model/nodeName.ts'
import { runSpans, type SpanStatus, spanTicks } from '../../../model/runSpans.ts'
import { type StepLine, stepCounts } from '../../../model/runSteps.ts'
import { clockTime, durationText, shortTime } from '../../../model/time.ts'
import { RUN_TEXT } from '../../canvas/cards/cardParts.ts'
import { Icon } from '../../kit/Icon.tsx'
import { NextWhy } from '../../run/NextWhy.tsx'
import css from './overviewTab.module.css'
import { STEP_ICON } from './runFace.ts'
import { StateProblem } from './StateProblem.tsx'
import { StepBody, StepMeta } from './StepFacts.tsx'

/** 横轴的段按什么颜色档（`data-run-status`）：停下的是灰的。 */
const SPAN_TONE: Record<SpanStatus, NodeStatus> = {
  running: 'running',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  stopped: 'skipped',
}

/** 图例里依次写哪几种（这个实例里有的才写）。 */
const LEGEND: readonly SpanStatus[] = ['done', 'running', 'waiting', 'failed']

export function OverviewTab(props: {
  t: T
  item: InstanceSummary
  view: InstanceView
  steps: readonly StepLine[]
  cursor: RunCursor | null
  /** 到「画布」页签看这一步。 */
  onFocus(step: string): void
}): React.JSX.Element {
  const { t, item, view, steps } = props
  const goal = view.state?.goal ?? item.goal
  if (view.state === null) {
    return (
      <div className={css.overview} data-testid="wl-hub-run-overview">
        {item.stateProblem !== undefined ? (
          <StateProblem t={t} item={item} />
        ) : (
          <p className={css.quiet}>{t('hub.runUntracked')}</p>
        )}
        {goal !== undefined && goal !== '' && (
          <div className={css.pos}>
            <Row label={t('hub.runGoal')}>
              <span className={css.text}>{goal}</span>
            </Row>
          </div>
        )}
      </div>
    )
  }
  const counts = stepCounts(steps)
  return (
    <div className={css.overview} data-testid="wl-hub-run-overview">
      <Progress
        t={t}
        item={item}
        view={view}
        steps={steps}
        counts={counts}
        onFocus={props.onFocus}
      />
      <Now t={t} view={view} goal={goal} cursor={props.cursor} onFocus={props.onFocus} />
    </div>
  )
}

/** 四格数和「进程」：还在跑的实例横轴右端是现在，半分钟往前走一次。 */
function Progress(props: {
  t: T
  item: InstanceSummary
  view: InstanceView
  steps: readonly StepLine[]
  counts: Record<NodeStatus, number>
  onFocus(step: string): void
}): React.JSX.Element | null {
  const { t, view, steps, counts } = props
  const now = useNow(30_000)
  const state = view.state
  if (state === null) return null
  const spans = runSpans(state, props.item.createdAt, now)
  const span = Math.max(1, spans.end - spans.start)
  const pct = (at: number): string => `${String(((at - spans.start) / span) * 100)}%`
  const label = (at: number): string => (span >= 86_400_000 ? shortTime(at) : clockTime(at))
  const shown = new Set([...spans.steps.values()].flat().map((part) => part.status))

  return (
    <>
      <section className={css.stats}>
        <Stat
          label={t(RUN_TEXT.done)}
          tone="done"
          value={
            <>
              {counts.done}
              <small>/ {steps.length}</small>
            </>
          }
        />
        <Stat
          label={t(RUN_TEXT.failed)}
          tone="failed"
          value={counts.failed}
          zero={counts.failed === 0}
        />
        <Stat
          label={t(RUN_TEXT.skipped)}
          tone="skipped"
          value={counts.skipped}
          zero={counts.skipped === 0}
        />
        <Stat label={t('hub.runSpent')} value={durationText(t, spans.end - spans.start)} />
      </section>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>{t('hub.runProgress')}</span>
          <span className={css.sectionHint}>
            {t(spans.live ? 'hub.runProgressLive' : 'hub.runProgressDone')}
          </span>
          <span className={css.legend}>
            {LEGEND.filter((status) => shown.has(status)).map((status) => (
              <span key={status} data-run-status={SPAN_TONE[status]}>
                {t(RUN_TEXT[SPAN_TONE[status]])}
              </span>
            ))}
          </span>
        </div>
        <div className={css.gantt} data-testid="wl-hub-run-gantt">
          {steps.map((step) => {
            const parts = spans.steps.get(step.id) ?? []
            return [
              <button
                key={`name-${step.id}`}
                type="button"
                className={css.ganttName}
                data-run-status={step.status}
                data-tip={step.name}
                onClick={() => props.onFocus(step.id)}
              >
                <Icon name={STEP_ICON[step.status]} size={12} />
                <span className={css.ganttText}>{step.name}</span>
              </button>,
              <span key={`track-${step.id}`} className={css.track}>
                {parts.map((part) => (
                  <button
                    key={part.from}
                    type="button"
                    className={css.bar}
                    data-run-status={SPAN_TONE[part.status]}
                    data-live={part.open}
                    aria-label={step.name}
                    data-tip={[
                      step.name,
                      t(RUN_TEXT[SPAN_TONE[part.status]]),
                      `${clockTime(part.from)}–${part.open === true ? t('hub.runNow') : clockTime(part.to)}`,
                      ...(part.round !== undefined && part.round > 1
                        ? [t('run.round').replace('{n}', String(part.round))]
                        : []),
                    ].join(' · ')}
                    style={{
                      left: pct(part.from),
                      width: `calc(${pct(part.to)} - ${pct(part.from)})`,
                    }}
                    onClick={() => props.onFocus(step.id)}
                  />
                ))}
                {parts.length === 0 && (
                  <span className={css.empty}>
                    {t(step.status === 'skipped' ? 'run.status.skipped' : 'hub.runNotYet')}
                  </span>
                )}
              </span>,
            ]
          })}
          <span className={css.axis}>
            <span className={css.tick}>{label(spans.start)}</span>
            {spanTicks(spans.start, spans.end).map((at) => (
              <span key={at} className={css.tick} style={{ left: pct(at) }} data-mid="">
                {label(at)}
              </span>
            ))}
            <span className={css.tick} data-end="" data-now={spans.live || undefined}>
              {spans.live ? t('hub.runNow') : label(spans.end)}
            </span>
          </span>
        </div>
      </section>
    </>
  )
}

function Stat(props: {
  label: string
  value: React.ReactNode
  tone?: NodeStatus
  zero?: boolean
}): React.JSX.Element {
  return (
    <div className={css.stat} data-run-status={props.tone} data-zero={props.zero || undefined}>
      <span className={css.statValue}>{props.value}</span>
      <span className={css.statLabel}>{props.label}</span>
    </div>
  )
}

/** 「现在」：目标、停在哪（正在做 / 在等你 / 最后一步）、下一步、说明。 */
function Now(props: {
  t: T
  view: InstanceView
  goal: string | undefined
  cursor: RunCursor | null
  onFocus(step: string): void
}): React.JSX.Element {
  const { t, view, cursor } = props
  const state = view.state
  const nameOf = (id: string): string => {
    const node = findNode(view.document, id)
    return node === undefined ? id : nodeTitle(node)
  }
  const at: { id: string; label: string }[] = [
    ...(cursor?.running ?? []).map((id) => ({ id, label: t('hub.runDoing') })),
    ...(cursor?.waiting ?? []).map((id) => ({ id, label: t('hub.runWaitingOn') })),
  ]
  const last = cursor?.last.at(-1)
  if (at.length === 0 && last !== undefined) {
    at.push({
      id: last.node,
      label: t(last.status === 'failed' ? 'hub.runFailedAt' : 'hub.runLastStep'),
    })
  }
  const next = cursor?.next ?? []
  const focus = at[0]?.id ?? next[0]?.node
  return (
    <section className={css.section}>
      <div className={css.sectionHead}>
        <span className={css.sectionTitle}>{t('hub.runNowTitle')}</span>
        {focus !== undefined && (
          <button
            type="button"
            className={css.link}
            data-testid="wl-hub-run-see-map"
            onClick={() => props.onFocus(focus)}
          >
            <Icon name="hub" size={12} />
            {t('hub.runSeeOnMap')}
          </button>
        )}
      </div>
      <div className={css.pos} data-testid="wl-hub-run-now">
        {props.goal !== undefined && props.goal !== '' && (
          <Row label={t('hub.runGoal')}>
            <span className={css.text}>{props.goal}</span>
          </Row>
        )}
        {at.map(({ id, label }) => {
          const node = state?.nodes[id]
          const status = node?.status ?? 'pending'
          return (
            <Row key={id} label={label}>
              <span className={css.step} data-run-status={status}>
                <span className={css.stepName}>
                  <Icon name={STEP_ICON[status]} size={13} />
                  <b>{nameOf(id)}</b>
                  <span className={css.chip}>{t(RUN_TEXT[status])}</span>
                  <StepMeta t={t} node={node} />
                </span>
                <StepBody t={t} node={node} />
              </span>
            </Row>
          )
        })}
        {next.length > 0 && (
          <Row label={t('hub.runNext')}>
            <span className={css.nexts}>
              {next.map((step) => (
                <span key={step.node} className={css.next}>
                  {nameOf(step.node)}
                  <span className={css.why}>
                    <NextWhy t={t} step={step} nameOf={nameOf} />
                  </span>
                </span>
              ))}
            </span>
          </Row>
        )}
        {at.length === 0 && next.length === 0 && (
          <Row label={t('hub.runAt')}>
            <span className={css.quietText}>{t('run.positionEnd')}</span>
          </Row>
        )}
        {state?.note !== undefined && state.note !== '' && (
          <Row label={t('run.note')}>
            <span className={css.text}>{state.note}</span>
          </Row>
        )}
      </div>
    </section>
  )
}

function Row(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{props.label}</span>
      <div className={css.rowMain}>{props.children}</div>
    </div>
  )
}
