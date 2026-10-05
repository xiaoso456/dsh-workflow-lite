/**
 * dsh-workflow-lite — 工作流中心里的一个实例：工作流名、会话标题、建立时间、目标；进度、总状态；
 * 查看、移到本会话、删除（删除在行下面展开确认，问要不要连状态文件一起删）。
 * 状态文件读不出来时，小标能点：行下面展开原因（找不到的路径，或哪几处写得不对）。
 *
 * 行里不放浮层：列表自己滚动，浮层会被裁掉。图标按钮的说明用原生 `title`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubRunRow
 */

import { useState } from 'react'
import type { InstanceSummary } from '../../shared/runState.ts'
import type { T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import { RunStatusBadge } from './RunTopBar.tsx'
import ui from './ui.module.css'

export function HubRunRow(props: {
  t: T
  item: InstanceSummary
  /** 会话怎么称呼（标题；找不到时是"会话已不在"之类）、是不是本会话。 */
  session: { text: string; mine: boolean }
  canMove: boolean
  confirming: boolean
  onView(): void
  onMove(): void
  onAskDelete(): void
  onCancelDelete(): void
  onDelete(withState: boolean): void
}): React.JSX.Element {
  const { t, item } = props
  const [withState, setWithState] = useState(false)
  const [why, setWhy] = useState(false)
  const status = item.statePath === undefined ? 'untracked' : (item.status ?? 'pending')
  const ratio =
    item.total !== undefined && item.total > 0 ? (item.done ?? 0) / item.total : undefined
  return (
    <div className={hub.row} data-testid="wl-hub-row" data-id={item.id}>
      <div className={hub.main}>
        <div className={hub.titleLine}>
          <span className={hub.name}>{item.workflow}</span>
          {item.current && (
            <span className={hub.tag} data-tip={t('run.current')}>
              {t('hub.current')}
            </span>
          )}
        </div>
        <div className={hub.meta}>
          <span className={cx(hub.metaItem, hub.session)} data-tip={props.session.text}>
            <Icon name="chat" size={12} />
            <span className={hub.sessionName}>{props.session.text}</span>
            {props.session.mine && (
              <span className={hub.tag} data-tone="plain">
                {t('hub.thisSession')}
              </span>
            )}
          </span>
          <span className={cx(hub.metaItem, hub.time)}>
            <Icon name="clock" size={12} />
            {shortTime(item.createdAt)}
          </span>
          {item.goal !== undefined && item.goal !== '' && (
            <span className={cx(hub.metaItem, hub.goal)} data-tip={item.goal}>
              <Icon name="flag" size={12} />
              <span>{item.goal}</span>
            </span>
          )}
        </div>
      </div>
      <div className={hub.progress} data-run-status={status}>
        {ratio !== undefined && (
          <>
            <span className={hub.progressText}>
              {item.done}/{item.total}
            </span>
            <span className={hub.progressBar}>
              <span
                className={hub.progressFill}
                style={{ transform: `scaleX(${Math.min(1, ratio)})` }}
              />
            </span>
          </>
        )}
      </div>
      {item.stateProblem === undefined ? (
        <RunStatusBadge t={t} status={item.status} untracked={item.statePath === undefined} />
      ) : (
        <button
          type="button"
          className={hub.why}
          aria-expanded={why}
          data-tip={t('hub.why')}
          data-testid="wl-hub-why"
          onClick={() => setWhy((open) => !open)}
        >
          <RunStatusBadge t={t} status={undefined} problem={item.stateProblem} />
          <Icon name={why ? 'chevronUp' : 'chevronDown'} size={12} />
        </button>
      )}
      <div className={hub.actions}>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.soft)}
          data-testid="wl-hub-view"
          onClick={props.onView}
        >
          {t('hub.view')}
        </button>
        {props.canMove && (
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small, hub.quiet)}
            aria-label={t('hub.move')}
            data-tip={`${t('hub.move')}\n${t('hub.moveHint')}`}
            data-testid="wl-hub-move"
            onClick={props.onMove}
          >
            <Icon name="pin" size={14} />
          </button>
        )}
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.danger, hub.quiet)}
          aria-label={t('common.delete')}
          data-tip={t('common.delete')}
          aria-expanded={props.confirming}
          data-testid="wl-hub-delete"
          onClick={() => {
            setWithState(false)
            props.onAskDelete()
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      {why && item.stateProblem !== undefined && (
        <div className={cx(hub.reason, ui.rise)} data-testid="wl-hub-reason">
          {item.stateProblem === 'missing' ? (
            <>
              <span>{t('hub.missingAt')}</span>
              <code className={hub.reasonPath}>{item.statePath}</code>
            </>
          ) : (
            <>
              <span>{t('hub.invalidHead')}</span>
              <ul className={hub.reasonList}>
                {(item.stateIssues ?? []).map((issue) => (
                  <li key={`${issue.path}:${issue.message}`}>
                    {issue.path !== '' && <code>{issue.path}</code>}
                    {issue.message}
                  </li>
                ))}
              </ul>
              <span className={hub.reasonMore}>{t('hub.invalidMore')}</span>
            </>
          )}
        </div>
      )}
      {props.confirming && (
        <div className={cx(hub.confirm, ui.rise)}>
          <span>{t('hub.deleteConfirm')}</span>
          {item.statePath !== undefined && (
            <label>
              <input
                type="checkbox"
                checked={withState}
                onChange={(event) => setWithState(event.currentTarget.checked)}
              />
              {t('hub.deleteState')}
            </label>
          )}
          <span className={ui.grow} />
          <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onCancelDelete}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.dangerSolid)}
            data-testid="wl-hub-delete-confirm"
            onClick={() => props.onDelete(withState)}
          >
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  )
}
