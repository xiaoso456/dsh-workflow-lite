/**
 * dsh-workflow-lite — 实例时间线的一行：时间 | 字（「你」+ 步骤 + 事件 · 第几轮 · 判定 — 说明）。
 *
 * 画布实例视图的概览和工作流中心「运行实例」页的时间线共用。中心那边每行前面多一个按事件着色的圆点（`dot`），
 * 也用同一种行写别的事（又收到一次触发，见 {@link EventRow}）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/RunEvent
 */

import type { NodeStatus, RunLogEntry } from '../../../shared/runState.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { clockTime } from '../../model/time.ts'
import css from './runEvent.module.css'

const EVENT_TEXT: Record<RunLogEntry['event'], LocaleKey> = {
  start: 'run.event.start',
  done: 'run.event.done',
  failed: 'run.event.failed',
  waiting: 'run.event.waiting',
  skipped: 'run.event.skipped',
  resume: 'run.event.resume',
  transfer: 'run.event.transfer',
  edit: 'run.event.edit',
  next: 'run.event.next',
  note: 'run.event.note',
}

/** 圆点的颜色档（`data-run-status`）：开始、接着跑是执行中的蓝，别的照结果，改动、备注是灰的。 */
const EVENT_TONE: Record<RunLogEntry['event'], NodeStatus> = {
  start: 'running',
  resume: 'running',
  done: 'done',
  failed: 'failed',
  waiting: 'waiting',
  skipped: 'skipped',
  transfer: 'pending',
  edit: 'pending',
  next: 'pending',
  note: 'pending',
}

/** 流水里的时刻写成钟点；认不出的原样写。 */
function clockOf(at: string): string {
  const time = Date.parse(at)
  return Number.isNaN(time) ? at : clockTime(time)
}

/** 一行的壳：时间、（可选的）圆点或小图标、字；点一下做 `onClick`。 */
export function EventRow(props: {
  time: string
  /** 圆点的颜色档；不给就不画圆点。 */
  tone?: string | undefined
  /** 放在圆点那一列的小图标（代替圆点）。 */
  mark?: React.ReactNode
  onClick?(): void
  testId?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 时间线行点一下只是顺手定位，键盘入口在别处（步骤、状态控件）
    <li
      className={css.event}
      data-dot={props.tone !== undefined || props.mark !== undefined || undefined}
      data-run-status={props.tone}
      data-testid={props.testId}
      onClick={props.onClick}
    >
      <span className={css.time}>{props.time}</span>
      {props.mark !== undefined ? (
        <span className={css.mark} aria-hidden="true">
          {props.mark}
        </span>
      ) : (
        props.tone !== undefined && <span className={css.dot} aria-hidden="true" />
      )}
      <span className={css.text}>{props.children}</span>
    </li>
  )
}

export function RunEvent(props: {
  t: T
  entry: RunLogEntry
  labelOf(id: string): string
  /** 前面画按事件着色的圆点。 */
  dot?: boolean
  onSelect(id: string | null): void
}): React.JSX.Element {
  const { t, entry } = props
  return (
    <EventRow
      time={clockOf(entry.at)}
      tone={props.dot === true ? EVENT_TONE[entry.event] : undefined}
      testId="wl-run-event"
      onClick={() => props.onSelect(entry.node ?? null)}
    >
      {entry.by === 'user' && <span className={css.user}>{t('run.byUser')} </span>}
      {entry.node !== undefined && <b>{props.labelOf(entry.node)} </b>}
      {t(EVENT_TEXT[entry.event])}
      {entry.round !== undefined &&
        entry.round > 1 &&
        ` · ${t('run.round').replace('{n}', String(entry.round))}`}
      {entry.verdict !== undefined && ` · ${entry.verdict}`}
      {entry.detail !== undefined && ` — ${entry.detail}`}
    </EventRow>
  )
}

/** 一列行的外壳（`<ul>`）。 */
export function EventList(props: {
  className?: string
  testId?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <ul
      className={props.className === undefined ? css.list : `${css.list} ${props.className}`}
      data-testid={props.testId}
    >
      {props.children}
    </ul>
  )
}
