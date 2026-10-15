/**
 * dsh-workflow-lite — 顶栏：左边是"我在哪张工作流、存好了没有"，右边是撤销重做、整理、
 * 工作流设置、检查结果，以及「预览 / 执行」组。
 *
 * 低频的文件操作（新建、改名、删除、重新加载）都收在工作流名字的下拉里（{@link WorkflowSwitcher}），
 * 顶栏上常驻的只有高频动作。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/TopBar
 */

import { useRef } from 'react'
import type { Runs } from '../app/useRuns.ts'
import type { Workflow } from '../app/useWorkflow.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { isDirty } from '../model/editor.ts'
import { Icon } from './Icon.tsx'
import { Issues } from './Issues.tsx'
import { Launch, type LaunchProps } from './Launch.tsx'
import { FadeMark, SwapText, useGlide } from './motion.tsx'
import { cx } from './primitives.tsx'
import run from './run.module.css'
import css from './topbar.module.css'
import ui from './ui.module.css'
import { WorkflowSwitcher } from './WorkflowSwitcher.tsx'

/** 实例视图往共用顶栏里填东西的三个位置（元素挂上才有值；见 `RunTopBar`）。 */
export interface TopSlots {
  /** 名字下拉触发器里的内容。 */
  trigger: HTMLElement | null
  /** 左边药丸里、名字后面：状态小标与进度。 */
  left: HTMLElement | null
  /** 右边的按钮组。 */
  right: HTMLElement | null
}

export const NO_SLOTS: TopSlots = { trigger: null, left: null, right: null }

export interface TopBarProps {
  /** 现在的内容还没存成版本（磁盘上的和任何一版都不一样，或还有没写下去的改动）：版本图标挂黄点。 */
  versionsPending: boolean
  /** 正在看的实例；`null` = 模板编辑。顶栏同一个、不卸载，只换里面的内容。 */
  runId: string | null
  /** 实例视图的三个位置的回调 ref。 */
  slotRefs: { [K in keyof TopSlots]: (el: HTMLElement | null) => void }
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
  /** 打开这张工作流的版本。 */
  onVersions(): void
  /** 去工作流中心导出这张工作流。 */
  onExport(): void
  /** 本会话的工作流实例（下拉里「本会话的实例」那一段）。 */
  runs: Runs
  onOpenRun(id: string): void
  onOpenHub(): void
  onOpenWorkflow(name: string): void
  onNewWorkflow(): void
  /** 实例视图里「从磁盘重新加载」。 */
  onReloadRun(): void
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
  const loading = state.phase === 'loading'
  // 切换工作流时「正在加载」那一小段：顶栏还是上一张的样子（只是压暗、不能点），
  // 不然图书馆按钮、右边两组按钮跟着一闪一现，名字被挤得左右晃。
  const last = useRef(state)
  if (!loading) last.current = state
  const ready = state.phase === 'ready' || (loading && last.current.phase === 'ready')
  const inRun = props.runId !== null
  const view = loading ? last.current : state
  const glide = useGlide()

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
      <div ref={glide} className={cx(css.pill, css.glide)}>
        <span className={css.surface} data-glide-surface="" aria-hidden="true" />
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
        {!(ready || inRun) && <span className={ui.divider} />}
        {(ready || inRun) && (
          <>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.fillOn)}
              data-tip={t('tool.library')}
              aria-label={t('tool.library')}
              aria-pressed={props.libraryOpen && !inRun}
              data-testid="wl-toggle-library"
              data-on={props.libraryOpen && !inRun}
              // 实例视图里没有步骤库：按钮留在原位、点不了，名字下拉的位置才不会跟着挪。
              disabled={inRun}
              onClick={props.onToggleLibrary}
            >
              <FadeMark on={props.libraryOpen && !inRun}>
                <Icon name="library" size={17} />
              </FadeMark>
            </button>
            <span className={ui.divider} />
          </>
        )}
        <WorkflowSwitcher
          t={t}
          wf={wf}
          runs={props.runs}
          onOpenRun={props.onOpenRun}
          onOpenWorkflow={props.onOpenWorkflow}
          onNewWorkflow={props.onNewWorkflow}
          onReloadRun={props.onReloadRun}
          {...(props.runId === null
            ? {}
            : {
                run: {
                  id: props.runId,
                  trigger: (open: boolean) => (
                    <span ref={props.slotRefs.trigger} className={run.switch} data-open={open} />
                  ),
                },
              })}
        />
        {inRun && <span ref={props.slotRefs.left} style={{ display: 'contents' }} />}
        {!inRun && state.name !== null && state.phase !== 'broken' && (
          <button
            type="button"
            data-glide=""
            className={css.status}
            data-tone={tone}
            data-testid="wl-status"
            aria-live="polite"
            disabled={tone !== 'error'}
            data-tip={state.saveError ?? undefined}
            onClick={wf.retrySave}
          >
            <span className={css.dot} />
            <SwapText text={t(STATUS_TEXT[tone])} />
            {tone === 'error' && <span className={css.retry}>· {t('common.retry')}</span>}
          </button>
        )}
      </div>

      <span className={ui.grow} />

      {inRun && <span ref={props.slotRefs.right} style={{ display: 'contents' }} />}

      {ready && !inRun && (
        <div
          className={css.right}
          data-busy={loading || undefined}
          {...(loading ? { inert: '' } : {})}
        >
          <div className={cx(ui.panel, css.pill, css.tools)}>
            <button
              type="button"
              className={cx(ui.btn, ui.icon)}
              data-tip={`${t('tool.undo')}  Ctrl+Z`}
              aria-label={t('tool.undo')}
              data-testid="wl-undo"
              disabled={view.past.length === 0}
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
              disabled={view.future.length === 0}
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
              disabled={view.doc === null || view.doc.nodes.length === 0}
              onClick={props.onTidy}
            >
              <Icon name="tidy" size={16} />
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, css.versions)}
              data-tip={
                props.versionsPending ? `${t('ver.title')} · ${t('ver.pending')}` : t('ver.title')
              }
              // 现在的内容还没存成版本时右上角挂一个黄点。
              data-pending={props.versionsPending}
              aria-label={t('ver.title')}
              data-testid="wl-versions-open"
              onClick={props.onVersions}
            >
              <Icon name="history" size={16} />
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.icon)}
              data-tip={t('pack.exportOpen')}
              aria-label={t('pack.exportOpen')}
              data-testid="wl-export-open"
              disabled={view.doc === null}
              onClick={props.onExport}
            >
              <Icon name="download" size={16} />
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.icon)}
              data-tip={t('tool.settings')}
              aria-label={t('tool.settings')}
              data-testid="wl-settings-open"
              onClick={props.onSettings}
            >
              <Icon name="sliders" size={16} />
            </button>
            {/* 空图的"没有步骤"不必亮红：画布中间的空态已经在说这件事。 */}
            {view.doc !== null && view.doc.nodes.length > 0 && (
              <>
                <span className={ui.divider} />
                <Issues t={t} problems={view.problems} onLocate={props.onLocate} />
              </>
            )}
          </div>

          <Launch
            t={t}
            empty={view.doc === null || view.doc.nodes.length === 0}
            blocked={props.launch.blocked}
            starting={props.launch.starting}
            session={props.launch.session}
            rows={props.launch.rows}
            canCreate={props.launch.canCreate}
            onPreview={props.onPreview}
            onRun={props.launch.onRun}
          />
        </div>
      )}
    </div>
  )
}
