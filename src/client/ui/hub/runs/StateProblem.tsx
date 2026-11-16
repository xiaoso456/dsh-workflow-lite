/**
 * dsh-workflow-lite — 状态文件读不出来的原因：找不到的路径，或哪几处写得不对（「运行实例」页概览里）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/StateProblem
 */

import type { InstanceSummary } from '../../../../shared/runState.ts'
import type { T } from '../../../i18n.ts'
import css from './overviewTab.module.css'

export function StateProblem(props: { t: T; item: InstanceSummary }): React.JSX.Element {
  const { t, item } = props
  return (
    <div className={css.reason} data-testid="wl-hub-reason">
      {item.stateProblem === 'missing' ? (
        <>
          <span>{t('hub.missingAt')}</span>
          <code className={css.reasonPath}>{item.statePath}</code>
        </>
      ) : (
        <>
          <span>{t('hub.invalidHead')}</span>
          <ul className={css.reasonList}>
            {(item.stateIssues ?? []).map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                {issue.path !== '' && <code>{issue.path}</code>}
                {issue.message}
              </li>
            ))}
          </ul>
          <span className={css.reasonMore}>{t('hub.invalidMore')}</span>
        </>
      )}
    </div>
  )
}
