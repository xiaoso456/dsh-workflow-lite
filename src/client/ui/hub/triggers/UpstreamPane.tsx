/**
 * dsh-workflow-lite — 「触发」页接续的「上游」：等的是哪个工作流（能直接打开它）、什么结果时接着执行，
 * 以及它最近几次执行——各是什么结果、按现在的设置会不会接着执行这一个（同「触发方式」对话框里接续那一页）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/UpstreamPane
 */

import { useEffect, useState } from 'react'
import { afterWhen } from '../../../../shared/trigger.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { type RunBrief, recentRuns } from '../../../app/workflowRuns.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { AFTER_VERDICT_TEXT, afterVerdict } from '../../../model/afterRuns.ts'
import { momentText } from '../../../model/triggerText.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { TriggerMark } from '../../trigger/TriggerMark.tsx'
import css from './live.module.css'

export function UpstreamPane(props: {
  t: T
  rpc: WorkflowLiteRpc
  entry: TriggerEntry
  onOpenWorkflow(name: string): void
  onOpenRun(id: string): void
}): React.JSX.Element | null {
  const { t, rpc, entry } = props
  const { source } = entry.data
  const [runsByWorkflow, setRunsByWorkflow] = useState<ReadonlyMap<string, readonly RunBrief[]>>()
  const upstream = entry.view.upstreamWorkflow
  const upstreamId = source.kind === 'after' ? source.workflow : undefined
  useEffect(() => {
    if (upstream === undefined || upstreamId === undefined) return
    let alive = true
    void recentRuns(rpc).then((all) => {
      if (alive) setRunsByWorkflow(all)
    })
    return () => {
      alive = false
    }
  }, [rpc, upstream, upstreamId])
  if (source.kind !== 'after') return null
  if (upstream === undefined) {
    return (
      <div className={css.empty}>
        <span className={css.emptyIcon}>
          <Icon name="after" size={20} />
        </span>
        <p className={css.emptyTitle}>
          {t(source.workflow === '' ? 'trigger.rule.afterNone' : 'trigger.afterMissing')}
        </p>
      </div>
    )
  }
  const when = afterWhen(source)
  const runs = runsByWorkflow === undefined ? null : (runsByWorkflow.get(source.workflow) ?? [])
  return (
    <div className={css.stack} data-testid="wl-hub-trg-upstream">
      <div className={css.upCard}>
        <TriggerMark kind="after" size={15} className={css.upMark} />
        <span className={css.upText}>
          <span className={css.upName}>{upstream}</span>
          <span className={css.upDesc}>
            {t('hub.trgUpDesc')
              .replace('{when}', t(`trigger.afterWhen.${when}` as LocaleKey))
              .replace('{self}', entry.workflow)}
          </span>
        </span>
        <button
          type="button"
          className={cx(ui.btn, ui.small)}
          data-testid="wl-hub-trg-up-open"
          onClick={() => props.onOpenWorkflow(upstream)}
        >
          <Icon name="external" size={12} />
          {t('hub.trgUpOpen').replace('{name}', upstream)}
        </button>
      </div>
      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>{t('trigger.afterRuns')}</span>
          <span className={css.aside}>{t('trigger.afterRunsAside')}</span>
        </div>
        {runs !== null && runs.length === 0 && (
          <p className={css.muted}>{t('trigger.afterNever')}</p>
        )}
        {runs !== null && runs.length > 0 && (
          <ul className={css.runs}>
            {runs.map((run) => {
              const verdict = afterVerdict(source, run)
              return (
                <li key={run.id} className={css.run} data-status={run.status}>
                  <button
                    type="button"
                    className={css.runMain}
                    data-tip={t('trigger.openRun')}
                    onClick={() => props.onOpenRun(run.id)}
                  >
                    <time className={css.runAt}>{momentText(t, run.at)}</time>
                    <span className={css.runStatus}>
                      {run.status === undefined ? '' : t(`run.status.${run.status}` as LocaleKey)}
                    </span>
                    <span className={css.runId}>{run.id}</span>
                    <span className={css.runVerdict} data-verdict={verdict}>
                      {verdict === 'fires' && <Icon name="bolt" size={11} />}
                      {t(AFTER_VERDICT_TEXT[verdict])}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
