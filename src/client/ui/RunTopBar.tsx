/**
 * dsh-workflow-lite — 实例视图的顶栏：实例与工作流的下拉、总状态与进度、打开模板、复制状态文件路径、
 * 「在看什么」与右栏开关。
 * 状态小标与下拉里「本会话的实例」那一段，工作流中心与模板编辑的顶栏也用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunTopBar
 */

import { useState } from 'react'
import {
  type InstanceSummary,
  progressOf,
  type RunState,
  type RunStatus,
} from '../../shared/runState.ts'
import type { WorkflowEntry } from '../../shared/types.ts'
import type { Runs } from '../app/useRuns.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import { Icon } from './Icon.tsx'
import { copyText, cx, Popover } from './primitives.tsx'
import type { RunViewProps } from './RunView.tsx'
import run from './run.module.css'
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
      <span className={run.status} data-run-status="untracked" data-testid="wl-run-status">
        <span className={run.dot} />
        {t('run.untracked')}
      </span>
    )
  }
  if (props.problem !== undefined || props.status === undefined) {
    return (
      <span className={run.status} data-run-status="failed">
        <Icon name="alert" size={11} />
        {t(props.problem === 'missing' ? 'run.stateMissing' : 'run.stateInvalid')}
      </span>
    )
  }
  return (
    <span className={run.status} data-run-status={props.status} data-testid="wl-run-status">
      <span className={run.dot} />
      {t(RUN_STATUS_TEXT[props.status])}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// 顶栏
// ─────────────────────────────────────────────────────────────

export function RunTopBar(
  props: RunViewProps & {
    summary: InstanceSummary | undefined
    state: RunState | null
    /** 右栏开关右边「在看什么」的切换（顶栏最右）。 */
    nav: React.ReactNode
    onTogglePanel(): void
  },
): React.JSX.Element {
  const { t, summary, state } = props
  const [copied, setCopied] = useState(false)
  const progress = state === null ? null : progressOf(state)
  return (
    <div className={top.bar}>
      <div className={cx(ui.panel, top.pill)}>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.tip, ui.tipStart)}
          data-tip={t('hub.title')}
          aria-label={t('hub.title')}
          data-testid="wl-hub-open"
          onClick={props.onOpenHub}
        >
          <Icon name="hub" size={16} />
        </button>
        <span className={ui.divider} />
        <RunSwitcher
          t={t}
          runs={props.runs}
          activeId={props.id}
          workflows={props.workflows}
          onOpenRun={props.onOpenRun}
          onOpenTemplate={props.onOpenTemplate}
          onOpenHub={props.onOpenHub}
          trigger={(open) => (
            <span className={run.switch} data-open={open}>
              <span className={run.switchKind}>{t('run.kind')}</span>
              <span className={run.switchName}>{summary?.workflow ?? '…'}</span>
              <span className={run.switchTime}>{shortTime(summary?.createdAt)}</span>
              <Icon name="chevronDown" size={14} />
            </span>
          )}
        />
        {summary !== undefined && (
          <>
            <RunStatusBadge
              t={t}
              status={state?.status}
              problem={state === null ? summary.stateProblem : undefined}
              untracked={summary.statePath === undefined}
            />
            {progress !== null && (
              <span className={run.progress} data-testid="wl-run-progress">
                {progress.done}/{progress.total}
              </span>
            )}
          </>
        )}
      </div>
      <span className={ui.grow} />
      {summary !== undefined && (
        <div className={cx(ui.panel, top.pill, top.tools)}>
          <button
            type="button"
            className={cx(ui.btn, ui.small)}
            disabled={!props.workflows.some((entry) => entry.name === summary.workflow)}
            title={
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
              className={cx(ui.btn, ui.small, ui.tip, ui.tipEnd)}
              data-tip={summary.statePath}
              onClick={() =>
                void copyText(summary.statePath ?? '').then((ok) => {
                  setCopied(ok)
                  window.setTimeout(() => setCopied(false), 1400)
                })
              }
            >
              <Icon name={copied ? 'check' : 'copy'} size={14} />
              {copied ? t('common.copied') : t('run.copyPath')}
            </button>
          )}
          {!props.narrow && (
            <>
              <span className={ui.divider} />
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.tip, ui.tipEnd)}
                data-tip={t('run.panelToggle')}
                aria-label={t('run.panelToggle')}
                aria-pressed={props.panelOpen}
                data-on={props.panelOpen}
                data-testid="wl-run-panel-toggle"
                onClick={props.onTogglePanel}
              >
                <Icon name="panel" size={17} />
              </button>
              {props.nav}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 实例与工作流的下拉：本会话的实例（当前的那个带实心点）、工作流（打开模板）、全部实例与管理。
 * 模板编辑的顶栏也用它的实例那一段（见 {@link RunMenuSection}）。
 */
function RunSwitcher(props: {
  t: T
  runs: Runs
  activeId: string | null
  workflows: readonly WorkflowEntry[]
  onOpenRun(id: string): void
  onOpenTemplate(name: string): void
  onOpenHub(): void
  trigger(open: boolean): React.ReactNode
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t('run.pick')}
      className={top.menu}
      trigger={
        <button
          type="button"
          className={cx(top.switch, run.switchButton)}
          aria-expanded={open}
          data-testid="wl-run-switcher"
          onClick={() => {
            setOpen(!open)
            if (!open) void props.runs.refresh()
          }}
        >
          {props.trigger(open)}
        </button>
      }
    >
      <RunMenuSection
        t={t}
        runs={props.runs}
        activeId={props.activeId}
        onOpenRun={(id) => {
          setOpen(false)
          props.onOpenRun(id)
        }}
      />
      {props.runs.list.length > 0 && <div className={ui.menuSep} />}
      <p className={ui.menuTitle}>{t('run.workflows')}</p>
      <div className={top.list}>
        {props.workflows.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className={ui.menuItem}
            onClick={() => {
              setOpen(false)
              props.onOpenTemplate(entry.name)
            }}
          >
            <Icon name="folder" size={15} />
            <span className={ui.menuLabel}>{entry.name}</span>
          </button>
        ))}
      </div>
      <div className={ui.menuSep} />
      <button
        type="button"
        className={ui.menuItem}
        onClick={() => {
          setOpen(false)
          props.onOpenHub()
        }}
      >
        <Icon name="hub" size={15} />
        <span className={ui.menuLabel}>{t('run.manage')}</span>
      </button>
    </Popover>
  )
}

/** 下拉里「本会话的实例」那一段。没有实例就什么都不画。 */
export function RunMenuSection(props: {
  t: T
  runs: Runs
  activeId: string | null
  onOpenRun(id: string): void
}): React.JSX.Element | null {
  const { t, runs } = props
  if (runs.list.length === 0) return null
  return (
    <>
      <p className={ui.menuTitle}>{t('run.thisSession')}</p>
      <div className={top.list} data-testid="wl-run-list">
        {runs.list.map((item) => (
          <div key={item.id} className={run.row}>
            <button
              type="button"
              className={cx(ui.menuItem, run.item)}
              data-active={item.id === props.activeId}
              data-testid="wl-run-item"
              data-id={item.id}
              style={{ gridColumn: '1 / 3' }}
              onClick={() => props.onOpenRun(item.id)}
            >
              <span
                data-run-status={
                  item.statePath === undefined ? 'untracked' : (item.status ?? 'failed')
                }
              >
                <span
                  className={run.dot}
                  style={{ opacity: item.id === runs.current ? 1 : 0.45 }}
                />
              </span>
              <span className={run.rowMain}>
                <span className={run.rowTitle}>{item.workflow}</span>
                <span className={run.rowMeta}>
                  {shortTime(item.createdAt)}
                  {item.total !== undefined && ` · ${item.done}/${item.total}`}
                  {item.status !== undefined && ` · ${t(RUN_STATUS_TEXT[item.status])}`}
                  {item.statePath === undefined && ` · ${t('run.untracked')}`}
                </span>
              </span>
            </button>
            {item.id === runs.current ? (
              <span
                className={run.current}
                role="img"
                title={t('run.current')}
                aria-label={t('run.current')}
                data-testid="wl-run-current"
              >
                <Icon name="pin" size={14} />
              </span>
            ) : (
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd, run.bind)}
                data-tip={t('run.setCurrent')}
                aria-label={t('run.setCurrent')}
                data-testid="wl-run-bind"
                onClick={() => void runs.bind(item.id)}
              >
                <Icon name="pin" size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
