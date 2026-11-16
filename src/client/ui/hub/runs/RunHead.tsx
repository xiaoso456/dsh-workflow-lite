/**
 * dsh-workflow-lite — 「运行实例」页右栏上面固定的一块（换页签不动），和「触发」页那块同样的排法：
 *
 * - 头部：状态图标块、工作流名（本会话当前的实例带「当前」），下面一行「来源 / 工作区 / 会话 + 值」（名字灰、值亮一档）；
 *   右边删除（灰图标）、「查看」（灰底带字），和别的页一样的一排。「移到本会话」在「信息」页签里。
 * - 状态条：状态 | 停在第几步、几步完成，下面一条一步一段的进度（颜色就是那一步的状态）| 建立、最近更新。
 *   记着运行状态时最左那格状态本身是按钮（「等待用户 ▾」）：挑一个新状态、二次确认后直接改；状态只在这里写一份。
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
import { RunKindMark, runTone } from '../../chrome/KindMark.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { SwapText } from '../../motion/swapText.tsx'
import hub from '../hub.module.css'
import { RunDelete } from './RunDelete.tsx'
import { runStatusText } from './runFace.ts'
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
  // 状态条最左那格：圆点 + 状态字（换状态时字换着进来）。能改状态时外面包一层按钮。
  const state = (
    <span className={css.stateFace}>
      <span className={css.stateDot} data-live={tone === 'running' || undefined} />
      <SwapText text={runStatusText(t, item)} />
    </span>
  )
  return (
    <div className={css.fixed}>
      <div className={css.head}>
        <RunKindMark item={item} size={18} className={css.mark} />
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
                <span className={css.subKey}>{t('hub.runOrigin')}</span>
                <span className={css.subText}>{originText(t, origin)}</span>
              </span>
            )}
            <span className={css.subPart} data-tip={props.workspace.path}>
              <span className={css.subKey}>{t('hub.runWorkspace')}</span>
              <span className={css.subText}>
                {props.workspace.path === undefined ? t('hub.noWorkspace') : props.workspace.name}
              </span>
            </span>
            <span className={css.subPart} data-tip={props.session.text}>
              <span className={css.subKey}>{t('hub.runSession')}</span>
              <span className={css.subText}>{props.session.text}</span>
              {props.session.mine && (
                <span className={hub.tag} data-tone="plain">
                  {t('hub.thisSession')}
                </span>
              )}
            </span>
          </p>
        </div>
        <div className={hub.headActions}>
          <RunDelete t={t} item={item} testId="wl-hub-detail-delete" onDelete={props.onDelete} />
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            data-testid="wl-hub-detail-view"
            onClick={props.onView}
          >
            <Icon name="eye" size={14} />
            {t('hub.view')}
          </button>
        </div>
      </div>

      <div className={css.status} data-run-status={tone} data-testid="wl-hub-run-strip">
        {tracked && item.status !== undefined ? (
          <HubRunStatus
            t={t}
            status={item.status}
            className={css.statePick}
            onChange={props.onSetStatus}
          >
            {state}
          </HubRunStatus>
        ) : (
          <span className={css.state}>{state}</span>
        )}
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
