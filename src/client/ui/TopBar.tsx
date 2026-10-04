/**
 * dsh-workflow-lite — 顶栏：左边是"我在哪张工作流、存好了没有"，右边是撤销重做、整理、
 * 工作流设置、检查结果，以及「预览 / 执行」组。
 *
 * 低频的文件操作（新建、改名、删除、重新加载）都收在工作流名字的下拉里，
 * 顶栏上常驻的只有高频动作。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/TopBar
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Runs } from '../app/useRuns.ts'
import type { Workflow } from '../app/useWorkflow.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { isDirty } from '../model/editor.ts'
import { Icon } from './Icon.tsx'
import { Issues } from './Issues.tsx'
import { Launch, type LaunchProps } from './Launch.tsx'
import { cx, Popover } from './primitives.tsx'
import { RunMenuSection } from './RunTopBar.tsx'
import css from './topbar.module.css'
import ui from './ui.module.css'

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
          className={cx(ui.btn, ui.icon, ui.tip, ui.tipStart)}
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
              className={cx(ui.btn, ui.icon, ui.tip)}
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
        <Switcher {...props} />
        {state.name !== null && state.phase !== 'broken' && (
          <button
            type="button"
            className={css.status}
            data-tone={tone}
            data-testid="wl-status"
            aria-live="polite"
            disabled={tone !== 'error'}
            title={state.saveError ?? undefined}
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
            className={cx(ui.btn, ui.icon, ui.tip)}
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
            className={cx(ui.btn, ui.icon, ui.tip)}
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
            className={cx(ui.btn, ui.icon, ui.tip)}
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
            className={cx(ui.btn, ui.icon, ui.tip, css.settings)}
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

// ─────────────────────────────────────────────────────────────
// 工作流切换
// ─────────────────────────────────────────────────────────────

function Switcher(props: TopBarProps): React.JSX.Element {
  const { t, wf } = props
  const { state, catalog } = wf
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)

  // 刚建好的工作流：直接进入改名，名字全选，敲字即覆盖。
  useEffect(() => {
    if (wf.fresh === null || wf.fresh !== state.name) return
    wf.clearFresh()
    setRenaming(true)
  }, [wf.fresh, state.name, wf.clearFresh])

  const renameCancelled = useRef(false)
  useEffect(() => {
    if (!renaming) return
    renameCancelled.current = false
    renameRef.current?.select()
  }, [renaming])

  const close = (): void => {
    setOpen(false)
    setQuery('')
    setConfirmDelete(false)
  }

  const workflows = catalog?.workflows ?? []
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const sorted = [...workflows].sort((a, b) => b.updatedAt - a.updatedAt)
    return needle === ''
      ? sorted
      : sorted.filter((entry) => entry.name.toLowerCase().includes(needle))
  }, [workflows, query])

  if (renaming && state.name !== null) {
    const commit = (value: string): void => {
      // Esc 之后输入框被卸掉时可能还会补一个 blur：那一下不算提交。
      if (renameCancelled.current) return
      void wf.rename(value).then((ok) => {
        if (ok) setRenaming(false)
        else renameRef.current?.focus()
      })
    }
    return (
      <input
        ref={renameRef}
        className={css.rename}
        defaultValue={state.name}
        aria-label={t('wf.rename')}
        title={t('wf.renameHint')}
        data-testid="wl-rename"
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget.value)
          if (event.key === 'Escape') {
            event.stopPropagation()
            renameCancelled.current = true
            setRenaming(false)
          }
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
      />
    )
  }

  return (
    <Popover
      open={open}
      onClose={close}
      label={t('wf.pick')}
      className={css.menu}
      trigger={
        <button
          type="button"
          className={css.switch}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="wl-switcher"
          onClick={() => {
            if (open) {
              close()
              return
            }
            setOpen(true)
            void wf.refreshCatalog()
            void props.runs.refresh()
          }}
          onDoubleClick={() => {
            if (state.name === null) return
            close()
            setRenaming(true)
          }}
        >
          <span className={css.name}>{state.name ?? t('wf.pick')}</span>
          <Icon name="chevronDown" size={14} />
        </button>
      }
    >
      <RunMenuSection
        t={t}
        runs={props.runs}
        activeId={null}
        onOpenRun={(id) => {
          close()
          props.onOpenRun(id)
        }}
      />
      {props.runs.list.length > 0 && (
        <>
          <div className={ui.menuSep} />
          <p className={ui.menuTitle}>{t('run.workflows')}</p>
        </>
      )}
      {workflows.length > 6 && (
        <div className={css.search}>
          <Icon name="search" size={14} />
          <input
            className={css.searchInput}
            value={query}
            placeholder={t('wf.search')}
            aria-label={t('wf.search')}
            data-testid="wl-search"
            // biome-ignore lint/a11y/noAutofocus: 打开下拉就是为了找一张
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      )}
      <div className={css.list} role="listbox" aria-label={t('wf.pick')}>
        {filtered.length === 0 && workflows.length > 0 && (
          <p className={css.emptyLine}>{t('wf.none')}</p>
        )}
        {filtered.map((entry) => (
          <button
            key={entry.name}
            type="button"
            role="option"
            aria-selected={entry.name === state.name}
            className={ui.menuItem}
            data-active={entry.name === state.name}
            data-value={entry.name}
            onClick={() => {
              close()
              if (entry.name !== state.name) void wf.open(entry.name)
            }}
          >
            <Icon name={entry.invalid === true ? 'alert' : 'folder'} size={15} />
            <span className={ui.menuLabel}>{entry.name}</span>
            <span className={ui.menuMeta}>
              {entry.invalid === true ? t('wf.broken') : `${entry.nodeCount} ${t('wf.steps')}`}
            </span>
          </button>
        ))}
      </div>

      {state.name !== null && (
        <>
          <div className={ui.menuSep} />
          {confirmDelete ? (
            <div className={cx(css.confirm, ui.rise)}>
              <span className={css.confirmText}>{t('wf.deleteConfirm')}</span>
              <button
                type="button"
                className={cx(ui.btn, ui.small)}
                onClick={() => setConfirmDelete(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.dangerSolid)}
                data-testid="wl-delete-confirm"
                onClick={() => {
                  const name = state.name
                  close()
                  if (name !== null) void wf.remove(name)
                }}
              >
                {t('common.delete')}
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className={ui.menuItem}
                disabled={state.phase === 'broken'}
                onClick={() => {
                  close()
                  setRenaming(true)
                }}
              >
                <Icon name="pencil" size={15} />
                <span className={ui.menuLabel}>{t('wf.rename')}</span>
              </button>
              <button
                type="button"
                className={ui.menuItem}
                onClick={() => {
                  close()
                  wf.reload()
                }}
              >
                <Icon name="reload" size={15} />
                <span className={ui.menuLabel}>{t('wf.reload')}</span>
              </button>
              <button
                type="button"
                className={ui.menuItem}
                data-danger="true"
                data-testid="wl-delete"
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" size={15} />
                <span className={ui.menuLabel}>{t('wf.delete')}</span>
              </button>
            </>
          )}
        </>
      )}

      <div className={ui.menuSep} />
      <button
        type="button"
        className={ui.menuItem}
        data-testid="wl-new"
        onClick={() => {
          close()
          void wf.create()
        }}
      >
        <Icon name="plus" size={15} />
        <span className={ui.menuLabel}>{t('wf.new')}</span>
      </button>
    </Popover>
  )
}
