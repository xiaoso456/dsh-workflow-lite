/**
 * dsh-workflow-lite — 「运行实例」页右栏：选中那个实例的全貌，改状态、查看、移到本会话、删除都在这里。
 *
 * - 头部：状态图标块、工作流名（本会话当前的实例带「当前」）、下面一行工作区 · 会话；右边是状态小标（能点，
 *   挑一个新状态、二次确认后直接改，见 {@link HubRunStatus}）、「查看」、移到本会话、删除。
 * - 左边一列：信息表（来源、工作区、会话、建立、更新、编号）和目标。
 * - 右边一列：进度条和每一步的状态（按执行的先后）；状态文件读不出来时这里写原因（找不到的路径，或哪几处写得不对）。
 *
 * 每一步的状态要读一次实例（`run/load`）：读到之前步骤那块是空的、读到后淡入；列表刷新、这个实例的状态变了再读一次。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/RunDetail
 */

import { useEffect, useState } from 'react'
import { analyzeGraph } from '../../../../shared/graph.ts'
import { isStep } from '../../../../shared/model.ts'
import type {
  InstanceSummary,
  InstanceView,
  NodeStatus,
  RunStatus,
} from '../../../../shared/runState.ts'
import type { T } from '../../../i18n.ts'
import { nodeTitle } from '../../../model/nodeName.ts'
import { originText } from '../../../model/originText.ts'
import { shortTime } from '../../../model/time.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { RUN_TEXT } from '../../canvas/cards/cardParts.ts'
import { HubRunStatus } from '../../chrome/HubRunStatus.tsx'
import { RunStatusBadge } from '../../chrome/RunStatusBadge.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { SwapText } from '../../motion/swapText.tsx'
import hub from '../hub.module.css'
import { RunDelete } from './RunDelete.tsx'
import { runIcon, runProgress, runTone } from './runFace.ts'
import css from './runs.module.css'

/** 一步：名字和状态。 */
interface StepLine {
  id: string
  name: string
  status: NodeStatus
}

/** 按执行的先后列出每一步和它的状态（状态文件里没有的步骤不列）。 */
function stepLines(view: InstanceView): StepLine[] | null {
  if (view.state === null) return null
  const nodes = new Map(view.document.nodes.filter(isStep).map((node) => [node.id, node]))
  const order = analyzeGraph(view.document).batches.flatMap((batch) => batch.nodes)
  const ids = [...new Set([...order, ...Object.keys(view.state.nodes)])]
  return ids.flatMap((id) => {
    const node = nodes.get(id)
    const run = view.state?.nodes[id]
    return node === undefined || run === undefined
      ? []
      : [{ id, name: nodeTitle(node), status: run.status }]
  })
}

export function RunDetail(props: {
  t: T
  rpc: WorkflowLiteRpc
  item: InstanceSummary
  /** 工作区叫什么、路径（没记下是 undefined）。 */
  workspace: { name: string; path: string | undefined; here: boolean }
  session: { text: string; mine: boolean }
  canMove: boolean
  onView(): void
  onMove(): void
  onDelete(withState: boolean): void
  onSetStatus(to: RunStatus, options: { notify: boolean; note: string }): void
}): React.JSX.Element {
  const { t, item, rpc } = props
  const [view, setView] = useState<InstanceView | null>(null)
  // 状态、进度、更新时间变了再读一次（列表刷新时 item 换了新对象，内容没变就不读）。
  const stamp = `${item.id}|${item.status}|${item.done}|${item.updatedAt}`
  useEffect(() => {
    let live = true
    void rpc
      .call('run/load', { id: item.id })
      .then((result) => {
        if (live && !('unchanged' in result)) setView(result)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [rpc, item.id, stamp])
  const steps = view === null ? undefined : stepLines(view)
  const progress = runProgress(item)
  const ratio =
    item.total !== undefined && item.total > 0 ? (item.done ?? 0) / item.total : undefined
  const tracked = item.statePath !== undefined && item.stateProblem === undefined
  const facts: [string, React.ReactNode, string?][] = [
    [
      t('hub.runOrigin'),
      item.origin === undefined ? t('hub.runOriginUnknown') : originText(t, item.origin),
    ],
    [
      t('hub.workspaces'),
      props.workspace.path === undefined ? t('hub.noWorkspace') : props.workspace.name,
      props.workspace.path,
    ],
    [t('hub.runSession'), props.session.text],
    [t('hub.runCreated'), shortTime(item.createdAt)],
    ...(item.updatedAt === undefined
      ? []
      : [[t('hub.runUpdated'), shortTime(Date.parse(item.updatedAt))] as [string, string]]),
    [t('hub.runId'), item.id],
  ]

  return (
    <div className={cx(hub.wfDetail, hub.paneIn)} data-testid="wl-hub-run-detail" data-id={item.id}>
      <div className={css.head}>
        <span className={cx(ui.kind, css.headMark)} data-run-status={runTone(item)}>
          <Icon name={runIcon(item)} size={18} />
        </span>
        <div className={css.headText}>
          <p className={css.title}>
            <span className={css.titleName}>{item.workflow}</span>
            {item.current && (
              <span className={hub.tag} data-tip={t('run.current')}>
                {t('hub.current')}
              </span>
            )}
          </p>
          <p className={css.sub}>
            <span className={css.subPart} data-tip={props.workspace.path}>
              <Icon name="folder" size={12} />
              {props.workspace.path === undefined ? t('hub.noWorkspace') : props.workspace.name}
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
        <div className={css.headActions}>
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
            className={cx(ui.btn, ui.small, ui.soft)}
            data-testid="wl-hub-detail-view"
            onClick={props.onView}
          >
            {t('hub.view')}
          </button>
          {props.canMove && (
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('hub.move')}
              data-tip={`${t('hub.move')}\n${t('hub.moveHint')}`}
              data-testid="wl-hub-move"
              onClick={props.onMove}
            >
              <Icon name="moveIn" size={14} />
            </button>
          )}
          <RunDelete
            t={t}
            item={item}
            className={cx(ui.btn, ui.icon, ui.small, ui.danger)}
            testId="wl-hub-detail-delete"
            onDelete={props.onDelete}
          />
        </div>
      </div>

      <div className={css.body}>
        <div className={css.col}>
          <section className={hub.section}>
            <p className={hub.sectionTitle}>{t('hub.runInfo')}</p>
            <div className={hub.stats}>
              {facts.map(([label, value, tip]) => (
                <div key={label} className={hub.stat}>
                  <span className={hub.statLabel}>{label}</span>
                  <span
                    className={hub.statValue}
                    data-tip={tip ?? (typeof value === 'string' ? value : undefined)}
                    data-testid={label === t('hub.runOrigin') ? 'wl-hub-origin' : undefined}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </section>
          {item.goal !== undefined && item.goal !== '' && (
            <section className={hub.section}>
              <p className={hub.sectionTitle}>{t('hub.runGoal')}</p>
              <p className={css.goal}>{item.goal}</p>
            </section>
          )}
        </div>

        <div className={css.col}>
          <section className={hub.section}>
            <p className={cx(hub.sectionTitle, css.progressHead)}>
              <span>{t('hub.runSteps')}</span>
              {progress !== undefined && (
                <span className={css.progressText}>
                  <SwapText pop text={t('hub.runDone').replace('{n}', progress)} />
                </span>
              )}
            </p>
            {ratio !== undefined && (
              <span
                className={css.progressBar}
                data-run-status={runTone(item)}
                data-testid="wl-hub-progress"
              >
                <span
                  className={css.progressFill}
                  style={{ transform: `scaleX(${Math.min(1, ratio)})` }}
                />
              </span>
            )}
            {item.stateProblem !== undefined ? (
              <StateProblem t={t} item={item} />
            ) : item.statePath === undefined ? (
              <p className={css.quiet}>{t('hub.runUntracked')}</p>
            ) : steps === undefined ? null : steps === null || steps.length === 0 ? (
              <p className={cx(css.quiet, ui.fade)}>{t('hub.runNoSteps')}</p>
            ) : (
              <ol className={cx(css.steps, ui.fade)} data-testid="wl-hub-steps">
                {steps.map((step) => (
                  <li key={step.id} className={css.step} data-run-status={step.status}>
                    <span className={css.dot} aria-hidden="true" />
                    <span className={css.stepName} data-tip={step.name}>
                      {step.name}
                    </span>
                    <span className={css.stepStatus}>{t(RUN_TEXT[step.status])}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/** 状态文件读不出来的原因：找不到的路径，或哪几处写得不对。 */
function StateProblem(props: { t: T; item: InstanceSummary }): React.JSX.Element {
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
