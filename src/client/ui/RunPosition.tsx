/**
 * dsh-workflow-lite — 实例总览里的「执行位置」：正在执行、最后执行、下一步各是哪几步。
 *
 * 和画布卡片右上角的小标是同一份结论（`shared/runCursor.ts`，模型 `resume` 拿到的也是它）：
 * 循环里转到第几轮、从哪一步回来的，一眼能看出来。点一行到那一步。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunPosition
 */

import type { NextStep, RunCursor } from '../../shared/runCursor.ts'
import type { RunState } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { findNode } from '../model/editor.ts'
import { shortTime } from '../model/time.ts'
import { RUN_TEXT } from './Canvas.tsx'
import { Icon } from './Icon.tsx'
import { EndIcon } from './Inspector.tsx'
import ins from './inspector.module.css'
import row from './linkrow.module.css'
import { cx } from './primitives.tsx'
import { StatusChip } from './RunNodeState.tsx'
import { stepName } from './resourceUi.ts'
import run from './run.module.css'
import desc from './runres.module.css'

type Kind = 'running' | 'waiting' | 'last' | 'next'

export function RunPosition(props: {
  t: T
  snapshot: WorkflowDocument
  state: RunState
  cursor: RunCursor
  onSelect(id: string): void
}): React.JSX.Element {
  const { t, snapshot, state, cursor } = props
  const round = (n: number | undefined): string =>
    n === undefined ? '' : t('run.round').replace('{n}', String(n))
  const nameOf = (id: string): string => stepName(findNode(snapshot, id), id)

  const line = (kind: Kind, id: string, end: React.ReactNode, sub: React.ReactNode) => (
    <button
      key={`${kind}-${id}`}
      type="button"
      className={row.row}
      data-testid="wl-run-pos-row"
      data-kind={kind}
      data-id={id}
      onClick={() => props.onSelect(id)}
    >
      <span className={row.lead}>
        <EndIcon node={findNode(snapshot, id)} id={id} />
      </span>
      <span className={row.name}>
        <span className={row.nameText}>{nameOf(id)}</span>
      </span>
      <span className={row.end}>{end}</span>
      {sub !== null && <span className={cx(row.sub, desc.hint)}>{sub}</span>}
    </button>
  )

  const why = (step: NextStep): React.ReactNode => {
    if (step.reason === 'start') return t('run.nextStart')
    if (step.reason === 'reset') return t('run.nextReset')
    const from = nameOf(step.from ?? '')
    return step.loop === true ? (
      <>
        <Icon name="loop" size={12} />
        {t('run.nextLoop').replace('{step}', from)}
      </>
    ) : (
      t('run.nextFrom').replace('{step}', from)
    )
  }

  const groups: { kind: Kind; title: string; rows: React.JSX.Element[] }[] = [
    {
      kind: 'running',
      title: t(RUN_TEXT.running),
      rows: cursor.running.map((id) =>
        line('running', id, <StatusChip t={t} status="running" />, round(state.nodes[id]?.round)),
      ),
    },
    {
      kind: 'waiting',
      title: t(RUN_TEXT.waiting),
      rows: cursor.waiting.map((id) =>
        line('waiting', id, <StatusChip t={t} status="waiting" />, round(state.nodes[id]?.round)),
      ),
    },
    {
      kind: 'last',
      title: t('run.lastRun'),
      rows: cursor.last.map((step) =>
        line(
          'last',
          step.node,
          <StatusChip t={t} status={step.status} />,
          [
            round(step.round),
            step.verdict === undefined ? '' : `${t('run.verdict')} ${step.verdict}`,
            step.at === undefined ? '' : shortTime(step.at),
          ]
            .filter((part) => part !== '')
            .join(' · ') || null,
        ),
      ),
    },
    {
      kind: 'next',
      title: t('run.nextUp'),
      rows: cursor.next.map((step) =>
        line('next', step.node, <span className={desc.hint}>{round(step.round)}</span>, why(step)),
      ),
    },
  ]
  const shown = groups.filter((group) => group.rows.length > 0)
  const started = Object.values(state.nodes).some(
    (node) => (node.round ?? 0) >= 1 || node.status !== 'pending',
  )

  return (
    <section className={run.section} data-testid="wl-run-position">
      <p className={run.sectionTitle}>
        <span>{t('run.position')}</span>
      </p>
      {shown.length === 0 ? (
        <p className={ins.help}>{t(started ? 'run.positionEnd' : 'run.positionNone')}</p>
      ) : (
        shown.map((group) => (
          <div key={group.kind} className={ins.links} data-group={group.kind}>
            <p className={ins.linkGroup}>{group.title}</p>
            {group.rows}
          </div>
        ))
      )}
    </section>
  )
}
