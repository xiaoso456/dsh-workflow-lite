/**
 * dsh-workflow-lite — 顶栏：左边是"我在哪张工作流、存好了没有"，右边是撤销重做、整理、
 * 工作流设置、检查结果，以及「预览 / 执行」组。
 *
 * 低频的文件操作（新建、改名、删除、重新加载）都收在工作流名字的下拉里（{@link WorkflowSwitcher}），
 * 顶栏上常驻的只有高频动作。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/TopBar
 */

import type { Runs } from '../app/useRuns.ts'
import type { Workflow } from '../app/useWorkflow.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { isDirty } from '../model/editor.ts'
import { Icon } from './Icon.tsx'
import { Issues } from './Issues.tsx'
import { Launch, type LaunchProps } from './Launch.tsx'
import { cx } from './primitives.tsx'
import css from './topbar.module.css'
import ui from './ui.module.css'
import { WorkflowSwitcher } from './WorkflowSwitcher.tsx'

export interface TopBarProps {
  t: T
  wf: Workflow
  libraryOpen: boolean
  onToggleLibrary(): void
  onTidy(): void
  onLocate(nodeId: string): void
  onPreview(): void
  /** 「执行」那一半要的东西。 */
  launch: Pick<LaunchProps, 'blocked' | 'starting' | 'session' | 'rows' | 'canCreate' | 'onRun'>
  onSettings(): void
  /** 本会话的工作流实例（下拉里「本会话的实例」那一段）。 */
  runs: Runs
  onOpenRun(id: string): void
  onOpenHub(): void
}

type SaveTone = 'loading' | 'saving' | 'error' | 'dirty' | 'saved'

const STATUS_TEXT: Record<SaveTone, LocaleKey> = {
  loading: 'status.loading',
  saving: 'status.saving',
  error: 'status.error',
  dirty: 'status.dirty',
  saved: 'status.saved',
}

export function TopBar(props: TopBarProps): React.JSX.Element {
  const { t, wf } = props
  const { state } = wf
  const ready = state.phase === 'ready'

  const tone: SaveTone =
    state.phase === 'loading'
      ? 'loading'
      : state.saving
        ? 'saving'
        : state.saveError !== null
          ? 'error'
          : isDirty(state)
            ? 'dirty'
            : 'saved'

  return (
    <div className={css.bar}>
      <div className={cx(ui.panel, css.pill)}>
        <button
          type="button"
          className={cx(ui.btn, ui.icon)}
          data-tip={t('hub.title')}
          aria-label={t('hub.title')}
          data-testid="wl-hub-open"
          onClick={props.onOpenHub}
        >
          <Icon name="hub" size={16} />
        </button>
        {!ready && <span className={ui.divider} />}
        {ready && (
          <>
            <button
              type="button"
              className={cx(ui.btn, ui.icon)}
              data-tip={t('tool.library')}
              aria-label={t('tool.library')}
              aria-pressed={props.libraryOpen}
              data-testid="wl-toggle-library"
              data-on={props.libraryOpen}
              onClick={props.onToggleLibrary}
            >
              <Icon name="library" size={17} />
            </button>
            <span className={ui.divider} />
          </>
        )}
        <WorkflowSwitcher t={t} wf={wf} runs={props.runs} onOpenRun={props.onOpenRun} />
        {state.name !== null && state.phase !== 'broken' && (
          <button
            type="button"
            className={css.status}
            data-tone={tone}
            data-testid="wl-status"
            aria-live="polite"
            disabled={tone !== 'error'}
            data-tip={state.saveError ?? undefined}
            onClick={wf.retrySave}
          >
            <span className={css.dot} />
            <span>{t(STATUS_TEXT[tone])}</span>
            {tone === 'error' && <span className={css.retry}>· {t('common.retry')}</span>}
          </button>
        )}
      </div>

      <span className={ui.grow} />

      {ready && (
        <div className={cx(ui.panel, css.pill, css.tools)}>
          <button
            type="button"
            className={cx(ui.btn, ui.icon)}
            data-tip={`${t('tool.undo')}  Ctrl+Z`}
            aria-label={t('tool.undo')}
            data-testid="wl-undo"
            disabled={state.past.length === 0}
            onClick={wf.undo}
          >
            <Icon name="undo" size={16} />
          </button>
          <button
            type="button"
            className={cx(ui.btn, ui.icon)}
            data-tip={`${t('tool.redo')}  Ctrl+Shift+Z`}
            aria-label={t('tool.redo')}
            data-testid="wl-redo"
            disabled={state.future.length === 0}
            onClick={wf.redo}
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
            disabled={state.doc === null || state.doc.nodes.length === 0}
            onClick={props.onTidy}
          >
            <Icon name="tidy" size={16} />
          </button>
          <button
            type="button"
            className={cx(ui.btn, ui.icon, css.settings)}
            data-tip={t('tool.settings')}
            aria-label={t('tool.settings')}
            data-testid="wl-settings-open"
            // 改过设置（不是全缺省）时右上角挂一个小点：一眼看出这张图有自己的配置。
            data-configured={state.doc?.settings !== undefined}
            onClick={props.onSettings}
          >
            <Icon name="sliders" size={16} />
          </button>
          {/* 空图的"没有步骤"不必亮红：画布中间的空态已经在说这件事。 */}
          {state.doc !== null && state.doc.nodes.length > 0 && (
            <>
              <span className={ui.divider} />
              <Issues t={t} problems={state.problems} onLocate={props.onLocate} />
            </>
          )}
        </div>
      )}

      {ready && (
        <Launch
          t={t}
          empty={state.doc === null || state.doc.nodes.length === 0}
          blocked={props.launch.blocked}
          starting={props.launch.starting}
          session={props.launch.session}
          rows={props.launch.rows}
          canCreate={props.launch.canCreate}
          onPreview={props.onPreview}
          onRun={props.launch.onRun}
        />
      )}
    </div>
  )
}
