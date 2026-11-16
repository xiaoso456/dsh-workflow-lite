/**
 * dsh-workflow-lite — 「运行实例」页右栏上面固定的一块（换页签不动），和「触发」页那块同样的排法：
 *
 * - 头部：状态图标块、工作流名（本会话当前的实例带「当前」），下面一行来源 · 工作区 · 会话；
 *   右边状态小标（能点，挑一个新状态、二次确认后直接改）、「查看」、删除。「移到本会话」在「信息」页签里。
 * - 状态条：状态 | 停在第几步、几步完成，下面一条一步一段的进度（颜色就是那一步的状态）| 建立、最近更新。
 *   不记进度、状态文件读不出来时中间那格写原因。
 *
 * 都从每一步的状态和实例的时间算，不靠模型多写什么。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/RunHead
 */

import type { InstanceSummary, RunStatus } from '../../../../shared/runState.ts'
import type { T } from '../../../i18n.ts'
import { originText } from '../../../model/originText.ts'
import type { StepLine } from '../../../model/runSteps.ts'
import { shortTime } from '../../../model/time.ts'
import { RUN_TEXT } from '../../canvas/cards/cardParts.ts'
import { HubRunStatus } from '../../chrome/HubRunStatus.tsx'
import { RunStatusBadge } from '../../chrome/RunStatusBadge.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { SwapText } from '../../motion/swapText.tsx'
import hub from '../hub.module.css'
import { RunDelete } from './RunDelete.tsx'
import { ORIGIN_ICON, runIcon, runStatusText, runTone } from './runFace.ts'
import css from './runHead.module.css'

export function RunHead(props: {
  t: T
  item: InstanceSummary
  workspace: { name: string; path: string | undefined }
  session: { text: string; mine: boolean }
  /** 每一步（按执行的先后）；还没读到是 `null`。 */
  steps: readonly StepLine[] | null
  /** 停在哪一步。 */
  at: string | undefined
  onView(): void
  onDelete(withState: boolean): void
  onSetStatus(to: RunStatus, options: { notify: boolean; note: string }): void
}): React.JSX.Element {
  const { t, item } = props
  const tone = runTone(item)
  const tracked = item.statePath !== undefined && item.stateProblem === undefined
  const origin = item.origin
  return (
    <div className={css.fixed}>
      <div className={css.head}>
        <span className={cx(ui.kind, css.mark)} data-run-status={tone}>
          <Icon name={runIcon(item)} size={18} />
        </span>
        <div className={css.titles}>
          <p className={css.title}>
            <span className={css.titleName} data-testid="wl-hub-run-title">
              {item.workflow}
            </span>
            {item.current && (
              <span className={hub.tag} data-tip={t('run.current')}>
                {t('hub.current')}
              </span>
            )}
          </p>
          <p className={css.sub}>
            {origin !== undefined && (
              <span className={css.subPart} data-testid="wl-hub-origin">
                <Icon name={ORIGIN_ICON[origin.channel]} size={12} />
                <span className={css.subText}>{originText(t, origin)}</span>
              </span>
            )}
            <span className={css.subPart} data-tip={props.workspace.path}>
              <Icon name="folder" size={12} />
              <span className={css.subText}>
                {props.workspace.path === undefined ? t('hub.noWorkspace') : props.workspace.name}
              </span>
            </span>
            <span className={css.subPart} data-tip={props.session.text}>
              <Icon name="chat" size={12} />
              <span className={css.subText}>{props.session.text}</span>
              {props.session.mine && (
                <span className={hub.tag} data-tone="plain">
                  {t('hub.thisSession')}
                </span>
              )}
            </span>
          </p>
        </div>
        <div className={css.actions}>
          {tracked && item.status !== undefined ? (
            <HubRunStatus t={t} status={item.status} onChange={props.onSetStatus} />
          ) : (
            <RunStatusBadge
              t={t}
              status={item.status}
              problem={item.stateProblem}
              untracked={item.statePath === undefined}
            />
          )}
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.primary)}
            data-testid="wl-hub-detail-view"
            onClick={props.onView}
          >
            <Icon name="eye" size={14} />
            {t('hub.view')}
          </button>
          <RunDelete
            t={t}
            item={item}
            className={cx(ui.btn, ui.icon, ui.small, ui.danger)}
            testId="wl-hub-detail-delete"
            onDelete={props.onDelete}
          />
        </div>
      </div>

      <div className={css.status} data-run-status={tone} data-testid="wl-hub-run-strip">
        <span className={css.state}>
          <span className={css.stateDot} data-live={tone === 'running' || undefined} />
          <SwapText text={runStatusText(t, item)} />
        </span>
        <span className={css.sep} />
        <Where t={t} item={item} steps={props.steps} at={props.at} />
        <span className={css.sep} />
        <span className={css.when}>
          <span>
            {t('hub.runCreated')} <b>{shortTime(item.createdAt)}</b>
          </span>
          {item.updatedAt !== undefined && (
            <span>
              {t('hub.runUpdatedShort')} <b>{shortTime(Date.parse(item.updatedAt))}</b>
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

/** 状态条中间那格：停在第几步 + 一步一段的进度；不记进度、状态文件读不出来时写一句原因。 */
function Where(props: {
  t: T
  item: InstanceSummary
  steps: readonly StepLine[] | null
  at: string | undefined
}): React.JSX.Element {
  const { t, item, steps } = props
  if (item.statePath === undefined || item.stateProblem !== undefined) {
    return (
      <span className={css.where}>
        <span className={css.whereQuiet}>
          {item.statePath === undefined
            ? t('hub.runUntrackedWhere')
            : item.stateProblem === 'missing'
              ? t('hub.runMissingShort')
              : t('hub.runInvalidShort')}
        </span>
      </span>
    )
  }
  const index = steps?.findIndex((step) => step.id === props.at) ?? -1
  const current = index < 0 ? undefined : steps?.[index]
  const done = steps?.filter((step) => step.status === 'done').length ?? item.done ?? 0
  const total = steps?.length ?? item.total ?? 0
  const finished = item.status === 'done'
  return (
    <span className={css.where}>
      <span className={css.whereLine}>
        {finished || current === undefined ? (
          <span className={css.whereMain}>
            {t(finished ? 'hub.runAllDone' : 'hub.runNotStarted')}
          </span>
        ) : (
          <span className={css.whereMain}>
            {t('hub.runStepOf')
              .replace('{n}', String(index + 1))
              .replace('{total}', String(total))}
            <span className={css.whereName}> · {current.name}</span>
          </span>
        )}
        <span className={css.whereAside}>{t('hub.runDoneCount').replace('{n}', String(done))}</span>
      </span>
      <span className={css.segbar} aria-hidden="true">
        {(steps ?? []).map((step) => (
          <span
            key={step.id}
            className={css.seg}
            data-run-status={step.status}
            data-tip={`${step.name} · ${t(RUN_TEXT[step.status])}`}
          />
        ))}
      </span>
    </span>
  )
}
