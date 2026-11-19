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

import { useEffect, useState } from 'react'
import { findNode } from '../../../../shared/model.ts'
import type { RunCursor } from '../../../../shared/runCursor.ts'
import type { InstanceSummary, InstanceView, NodeStatus } from '../../../../shared/runState.ts'
import { useNow } from '../../../app/useNow.ts'
import type { T } from '../../../i18n.ts'
import { nodeTitle } from '../../../model/nodeName.ts'
import { runSpans, type SpanStatus, type StepSpan, spanTicks } from '../../../model/runSpans.ts'
import { type StepLine, stepCounts } from '../../../model/runSteps.ts'
import { clockTime, durationText, shortTime } from '../../../model/time.ts'
import { RUN_TEXT } from '../../canvas/cards/cardParts.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Presence } from '../../motion/exits.tsx'
import { SwapText } from '../../motion/swapText.tsx'
import { NextWhy } from '../../run/NextWhy.tsx'
import { useGanttSpot } from './ganttMotion.ts'
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
  // 图已经在了之后新冒出来的条、刻度才放进场（刚挂上时整张图一起出来，不一段段长）。
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  // 行数只增不减：少了的行留着位置放完收起（Presence 收完自己卸掉）。
  const [rows, setRows] = useState(steps.length)
  if (steps.length > rows) setRows(steps.length)
  const state = view.state
  if (state === null) return null
  const spans = runSpans(state, props.item.createdAt, now)
  const span = Math.max(1, spans.end - spans.start)
  /** 某个时刻在横轴上的位置（百分比）。 */
  const pct = (at: number): number => ((at - spans.start) / span) * 100
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
              <SwapText text={String(counts.done)} />
              <small>
                / <SwapText text={String(steps.length)} />
              </small>
            </>
          }
        />
        <Stat
          label={t(RUN_TEXT.failed)}
          tone="failed"
          value={<SwapText text={String(counts.failed)} />}
          zero={counts.failed === 0}
        />
        <Stat
          label={t(RUN_TEXT.skipped)}
          tone="skipped"
          value={<SwapText text={String(counts.skipped)} />}
          zero={counts.skipped === 0}
        />
        <Stat
          label={t('hub.runSpent')}
          value={<SwapText text={durationText(t, spans.end - spans.start)} quiet />}
        />
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
          {Array.from({ length: rows }, (_, index) => {
            const step = steps[index]
            return (
              // 按第几行认：换了实例、步骤名不一样也在原行里换字，多出来的行展开，少了的收起来。
              // biome-ignore lint/suspicious/noArrayIndexKey: 行按位置认，原地换内容
              <Presence key={index} show={step !== undefined}>
                {step !== undefined && (
                  <GanttRow
                    t={t}
                    step={step}
                    parts={spans.steps.get(step.id) ?? []}
                    pct={pct}
                    enter={ready}
                    onFocus={props.onFocus}
                  />
                )}
              </Presence>
            )
          })}
          <div className={css.ganttRow}>
            <span className={css.axis}>
              <span className={css.tick}>
                <SwapText text={label(spans.start)} />
              </span>
              {spanTicks(spans.start, spans.end).map((at, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 刻度按位置认，换了时刻滑过去
                <Tick key={index} left={pct(at)} enter={ready} text={label(at)} />
              ))}
              <span className={css.tick} data-end="" data-now={spans.live || undefined}>
                <SwapText text={spans.live ? t('hub.runNow') : label(spans.end)} />
              </span>
            </span>
          </div>
        </div>
      </section>
    </>
  )
}

/** 进程图的一行：步骤名，右边一次执行一段条（还没做、跳过的写一句）。 */
function GanttRow(props: {
  t: T
  step: StepLine
  parts: readonly StepSpan[]
  pct(at: number): number
  enter: boolean
  onFocus(step: string): void
}): React.JSX.Element {
  const { t, step, parts } = props
  return (
    <div className={css.ganttRow}>
      <button
        type="button"
        className={css.ganttName}
        data-run-status={step.status}
        data-tip={step.name}
        onClick={() => props.onFocus(step.id)}
      >
        <Icon name={STEP_ICON[step.status]} size={12} />
        <span className={css.ganttText}>
          <SwapText text={step.name} />
        </span>
      </button>
      <span className={css.track}>
        {parts.map((part, index) => (
          <GanttBar
            // biome-ignore lint/suspicious/noArrayIndexKey: 一行里的第几段按位置认，换了时间滑过去
            key={index}
            t={t}
            step={step}
            part={part}
            left={props.pct(part.from)}
            width={props.pct(part.to) - props.pct(part.from)}
            enter={props.enter}
            onFocus={props.onFocus}
          />
        ))}
        {parts.length === 0 && (
          <span className={css.empty}>
            <SwapText
              text={t(step.status === 'skipped' ? 'run.status.skipped' : 'hub.runNotYet')}
            />
          </span>
        )}
      </span>
    </div>
  )
}

/** 一段条：位置和宽度按时间比例；换了位置滑过去，新冒出来的从左端长出来（{@link useGanttSpot}）。 */
function GanttBar(props: {
  t: T
  step: StepLine
  part: StepSpan
  left: number
  width: number
  enter: boolean
  onFocus(step: string): void
}): React.JSX.Element {
  const { t, step, part } = props
  const motion = useGanttSpot({ left: props.left, width: props.width }, props.enter)
  return (
    <button
      type="button"
      className={css.bar}
      {...motion.attrs}
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
      style={motion.style}
      onClick={() => props.onFocus(step.id)}
    />
  )
}

/** 横轴中间的一个时刻：换了时刻滑过去、字滚着换。 */
function Tick(props: { left: number; enter: boolean; text: string }): React.JSX.Element {
  const motion = useGanttSpot({ left: props.left }, props.enter)
  return (
    <span className={css.tick} style={motion.style} data-mid="" {...motion.attrs}>
      <SwapText text={props.text} />
    </span>
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
