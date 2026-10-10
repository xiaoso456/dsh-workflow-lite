/**
 * dsh-workflow-lite — 工作流中心里的一个实例：工作流名、会话标题、建立时间、目标；进度、总状态；
 * 查看、移到本会话、删除（文字按钮在前、图标按钮成组在后；确认卡浮在删除按钮旁边，问要不要连状态文件一起删；行不挪位）。
 * 整体状态的小标能点：挑一个新状态、二次确认后直接改（{@link HubRunStatus}）。
 * 状态文件读不出来时，小标能点：行下面展开原因（找不到的路径，或哪几处写得不对）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubRunRow
 */

import { useState } from 'react'
import type { InstanceSummary, RunStatus } from '../../shared/runState.ts'
import type { T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import { useConfirm } from './Confirm.tsx'
import { HubRunStatus } from './HubRunStatus.tsx'
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
  /** 页上有别的行能移：这一行不能移时也给「移到本会话」留出位置，各行的删除对齐。 */
  moveSlot: boolean
  onView(): void
  onMove(): void
  onDelete(withState: boolean): void
  /** 改整体状态（已经过二次确认）。 */
  onSetStatus(to: RunStatus, options: { notify: boolean; note: string }): void
}): React.JSX.Element {
  const { t, item } = props
  const [withState, setWithState] = useState(false)
  const [why, setWhy] = useState(false)
  const remove = useConfirm<HTMLButtonElement>()
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
      <div className={hub.progress} data-run-status={status} data-testid="wl-hub-progress">
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
      {item.stateProblem === undefined &&
      item.statePath !== undefined &&
      item.status !== undefined ? (
        <HubRunStatus t={t} status={item.status} onChange={props.onSetStatus} />
      ) : (
        <div className={hub.state}>
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
        </div>
      )}
      {/*
        文字按钮在前、图标按钮成一组在后。「移到本会话」不是每行都有：没有它的行留一个空位，
        删除还在原位（整页都没有能移的行时不留）。
      */}
      <div className={hub.actions}>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.soft)}
          data-testid="wl-hub-view"
          onClick={props.onView}
        >
          {t('hub.view')}
        </button>
        {props.canMove ? (
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small, hub.quiet)}
            aria-label={t('hub.move')}
            data-tip={`${t('hub.move')}\n${t('hub.moveHint')}`}
            data-testid="wl-hub-move"
            onClick={props.onMove}
          >
            <Icon name="moveIn" size={14} />
          </button>
        ) : (
          props.moveSlot && <span className={hub.iconSlot} aria-hidden="true" />
        )}
        <button
          ref={remove.anchorRef}
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.danger, hub.quiet)}
          aria-label={t('common.delete')}
          data-tip={remove.open ? undefined : t('common.delete')}
          aria-expanded={remove.open}
          data-testid="wl-hub-delete"
          onClick={() => {
            setWithState(false)
            remove.toggle()
          }}
        >
          <Icon name="trash" size={14} />
        </button>
        {remove.render({
          t,
          title: t('hub.deleteConfirm'),
          confirmText: t('common.delete'),
          testId: 'wl-hub-delete-confirm',
          onConfirm: () => props.onDelete(withState),
          children: item.statePath !== undefined && (
            <label>
              <input
                type="checkbox"
                checked={withState}
                data-testid="wl-hub-delete-state"
                onChange={(event) => setWithState(event.currentTarget.checked)}
              />
              {t('hub.deleteState')}
            </label>
          ),
        })}
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
    </div>
  )
}
