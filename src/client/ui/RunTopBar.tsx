/**
 * dsh-workflow-lite — 实例视图的顶栏：实例与工作流的下拉、总状态与进度；撤销重做、整理、检查结果
 * （和模板编辑的顶栏同一组）；打开模板、复制状态文件路径、「在看什么」与右栏开关。
 * 状态小标与下拉里「本会话的实例」那一段，工作流中心与模板编辑的顶栏也用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunTopBar
 */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  type InstanceSummary,
  progressOf,
  type RunState,
  type RunStatus,
} from '../../shared/runState.ts'
import type { ValidationProblem } from '../../shared/types.ts'
import type { RunHistory } from '../app/useRunHistory.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import { Highlight } from './Highlight.tsx'
import { HubRunStatus } from './HubRunStatus.tsx'
import { Icon } from './Icon.tsx'
import { Issues } from './Issues.tsx'
import { FadeMark, SwapIcon, SwapText } from './motion.tsx'
import { copyText, cx } from './primitives.tsx'
import type { RunViewProps } from './RunView.tsx'
import run from './run.module.css'
import type { TopSlots } from './TopBar.tsx'
import top from './topbar.module.css'
import ui from './ui.module.css'

export const RUN_STATUS_TEXT: Record<RunStatus, LocaleKey> = {
  pending: 'run.overall.pending',
  running: 'run.overall.running',
  waiting: 'run.overall.waiting',
  done: 'run.overall.done',
  failed: 'run.overall.failed',
  cancelled: 'run.overall.cancelled',
}

/** 实例的状态小标。 */
export function RunStatusBadge(props: {
  t: T
  status: RunStatus | undefined
  problem?: 'missing' | 'invalid' | undefined
  /** 这个实例不记运行状态（没有状态文件）。 */
  untracked?: boolean
}): React.JSX.Element {
  const { t } = props
  if (props.untracked === true) {
    return (
      <span
        className={run.status}
        data-glide=""
        data-run-status="untracked"
        data-testid="wl-run-status"
      >
        <span className={run.dot} />
        {t('run.untracked')}
      </span>
    )
  }
  if (props.problem !== undefined || props.status === undefined) {
    return (
      <span className={run.status} data-glide="" data-run-status="failed">
        <Icon name="alert" size={11} />
        {t(props.problem === 'missing' ? 'run.stateMissing' : 'run.stateInvalid')}
      </span>
    )
  }
  return (
    <span
      className={run.status}
      data-glide=""
      data-run-status={props.status}
      data-testid="wl-run-status"
    >
      <span className={run.dot} />
      <SwapText text={t(RUN_STATUS_TEXT[props.status])} />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// 顶栏
// ─────────────────────────────────────────────────────────────

/**
 * 实例视图顶栏里和模板编辑不同的那几块：不自己画顶栏，而是填进 `TopBar`（模板编辑与实例视图共用、不卸载）
 * 留出来的三个位置——下拉触发器里的内容、左边药丸里的状态与进度、右边的两组按钮。
 * 顶栏不换，名字下拉才能跨着两个视图保持打开。
 */
export function RunTopBar(
  props: RunViewProps & {
    summary: InstanceSummary | undefined
    state: RunState | null
    /** 顶栏上改整体状态：挑好就调用，和右栏「整体」那一排同一条路（改进草稿，底部草稿栏给反馈）。 */
    onSetStatus(to: RunStatus): void
    /** 右栏开关右边「在看什么」的切换（顶栏最右）。 */
    nav: React.ReactNode
    onTogglePanel(): void
    /** 图和状态排成一条的撤销 / 重做。 */
    history: RunHistory
    /** 这张图的检查结果（和模板同一套规则）；图还没读回来是 `null`。 */
    problems: readonly ValidationProblem[] | null
    onTidy(): void
    onLocate(nodeId: string): void
    slots: TopSlots
  },
): React.JSX.Element {
  const { t, summary, state, slots } = props
  const [copied, setCopied] = useState(false)
  const progress = state === null ? null : progressOf(state)
  return (
    <>
      {slots.trigger !== null &&
        createPortal(
          <>
            <span className={run.switchKind}>{t('run.kind')}</span>
            <span className={run.switchName}>{summary?.workflow ?? '…'}</span>
            <span className={run.switchTime}>{shortTime(summary?.createdAt)}</span>
            <span className={top.chev} data-glide="">
              <Icon name="chevronDown" size={14} />
            </span>
          </>,
          slots.trigger,
        )}
      {slots.left !== null &&
        summary !== undefined &&
        createPortal(
          <>
            {state !== null && summary.statePath !== undefined ? (
              <HubRunStatus
                t={t}
                status={state.status}
                confirm={false}
                onChange={(to) => props.onSetStatus(to)}
              />
            ) : (
              <RunStatusBadge
                t={t}
                status={state?.status}
                problem={state === null ? summary.stateProblem : undefined}
                untracked={summary.statePath === undefined}
              />
            )}
            {progress !== null && (
              <span className={run.progress} data-testid="wl-run-progress">
                <SwapText pop text={`${progress.done}/${progress.total}`} />
              </span>
            )}
          </>,
          slots.left,
        )}
      {slots.right !== null &&
        summary !== undefined &&
        createPortal(
          <>
            {props.problems !== null && (
              <div className={cx(ui.panel, top.pill, top.tools)} data-testid="wl-run-tools">
                <button
                  type="button"
                  className={cx(ui.btn, ui.icon)}
                  data-tip={`${t('tool.undo')}  Ctrl+Z`}
                  aria-label={t('tool.undo')}
                  data-testid="wl-undo"
                  disabled={!props.history.canUndo}
                  onClick={props.history.undo}
                >
                  <Icon name="undo" size={16} />
                </button>
                <button
                  type="button"
                  className={cx(ui.btn, ui.icon)}
                  data-tip={`${t('tool.redo')}  Ctrl+Shift+Z`}
                  aria-label={t('tool.redo')}
                  data-testid="wl-redo"
                  disabled={!props.history.canRedo}
                  onClick={props.history.redo}
                >
                  <Icon name="redo" size={16} />
                </button>
                <span className={ui.divider} />
                <button
                  type="button"
                  className={cx(ui.btn, ui.icon)}
                  data-tip={`${t('tool.tidy')}  L`}
                  aria-label={t('tool.tidy')}
                  data-testid="wl-tidy"
                  onClick={props.onTidy}
                >
                  <Icon name="tidy" size={16} />
                </button>
                <span className={ui.divider} />
                <Issues
                  t={t}
                  problems={props.problems}
                  noneBody="issues.noneBodyRun"
                  onLocate={props.onLocate}
                />
              </div>
            )}
            <div className={cx(ui.panel, top.pill, top.tools)}>
              <button
                type="button"
                className={cx(ui.btn, ui.small)}
                disabled={!props.workflows.some((entry) => entry.name === summary.workflow)}
                data-tip={
                  props.workflows.some((entry) => entry.name === summary.workflow)
                    ? undefined
                    : t('run.templateGone')
                }
                data-testid="wl-run-open-template"
                onClick={() => props.onOpenTemplate(summary.workflow)}
              >
                <Icon name="pencil" size={14} />
                {t('run.openTemplate')}
              </button>
              {summary.statePath !== undefined && (
                <button
                  type="button"
                  className={cx(ui.btn, ui.small)}
                  data-tip={summary.statePath}
                  onClick={() =>
                    void copyText(summary.statePath ?? '').then((ok) => {
                      setCopied(ok)
                      window.setTimeout(() => setCopied(false), 1400)
                    })
                  }
                >
                  <SwapIcon name={copied ? 'check' : 'copy'} size={14} />
                  <SwapText
                    text={copied ? t('common.copied') : t('run.copyPath')}
                    reserve={[t('common.copied'), t('run.copyPath')]}
                  />
                </button>
              )}
              {!props.narrow && (
                <>
                  <span className={ui.divider} />
                  <button
                    type="button"
                    className={cx(ui.btn, ui.icon, ui.fillOn)}
                    data-tip={t('run.panelToggle')}
                    aria-label={t('run.panelToggle')}
                    aria-pressed={props.panelOpen}
                    data-on={props.panelOpen}
                    data-testid="wl-run-panel-toggle"
                    onClick={props.onTogglePanel}
                  >
                    <FadeMark on={props.panelOpen}>
                      <Icon name="panel" size={17} />
                    </FadeMark>
                  </button>
                  {props.nav}
                </>
              )}
            </div>
          </>,
          slots.right,
        )}
    </>
  )
}

/**
 * 实例在下拉里的右端小字：创建时间、进度、状态（没有状态文件的写「未跟踪」）。
 * 同名的实例很常见，时间是认它们的主要依据，所以放在行里，不放悬停提示。
 */
function runMeta(t: T, item: InstanceSummary): string {
  return [
    shortTime(item.createdAt),
    item.total !== undefined ? `${item.done}/${item.total}` : '',
    item.status !== undefined ? t(RUN_STATUS_TEXT[item.status]) : '',
    item.statePath === undefined ? t('run.untracked') : '',
  ]
    .filter((part) => part !== '')
    .join(' · ')
}

/** 搜索实例时可以搜的几段字：工作流名、状态、进度、创建时间。 */
export function runSearchTexts(t: T, item: InstanceSummary): readonly string[] {
  return [item.workflow, runMeta(t, item)]
}

/**
 * 下拉里的一行实例：和工作流那一行同一个骨架（图标位放状态点、名字、右端小字；
 * 悬停时右端小字换成「设为当前」，同一个位置淡入淡出）。本会话的当前实例名字后面常驻一枚图钉。
 * 直接是列表的子项（选中底块、滑动、依次浮出都要求这样）。
 */
export function RunMenuRow(props: {
  t: T
  item: InstanceSummary
  /** 正在看的实例（选中）。 */
  active: boolean
  /** 本会话的当前实例。 */
  current: boolean
  /** 搜索词（已归一）。 */
  needle: string
  onOpen(event: React.MouseEvent): void
  onBind(): void
}): React.JSX.Element {
  const { t, item } = props
  return (
    <div className={top.row} data-selected={props.active}>
      <button
        type="button"
        className={cx(ui.menuItem, top.rowMain)}
        aria-current={props.active ? 'true' : undefined}
        data-testid="wl-run-item"
        data-id={item.id}
        onClick={props.onOpen}
      >
        <span
          className={run.rowDot}
          data-run-status={item.statePath === undefined ? 'untracked' : (item.status ?? 'failed')}
        >
          <span className={run.dot} style={{ opacity: props.current ? 1 : 0.45 }} />
        </span>
        <span className={run.rowName}>
          <Highlight text={item.workflow} needle={props.needle} />
        </span>
        {props.current && (
          <span className={run.currentTag} data-tip={t('run.current')} data-testid="wl-run-current">
            {t('hub.current')}
          </span>
        )}
        <span className={cx(ui.menuMeta, top.rowMeta, run.rowMeta)}>{runMeta(t, item)}</span>
      </button>
      {!props.current && (
        <span className={top.rowActions}>
          <button
            type="button"
            className={top.rowAction}
            data-tip={t('run.setCurrent')}
            aria-label={t('run.setCurrent')}
            data-testid="wl-run-bind"
            onClick={props.onBind}
          >
            <Icon name="pin" size={14} />
          </button>
        </span>
      )}
    </div>
  )
}
