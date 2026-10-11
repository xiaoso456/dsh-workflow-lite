/**
 * dsh-workflow-lite — 顶栏左边的工作流名字与它的下拉：切换、改名、删除、新建。
 *
 * 改名和删除挂在列表的每一行上（见 {@link WorkflowRow}），哪张都能直接改，不用先切过去；
 * 底下只留跟「正开着的这张」有关的「从磁盘重新加载」和「新建」。
 * 双击顶栏上的名字、或刚新建好时，名字就地变成输入框改正开着的这张。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/WorkflowSwitcher
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Runs } from '../app/useRuns.ts'
import type { Workflow } from '../app/useWorkflow.ts'
import type { T } from '../i18n.ts'
import { useConfirm } from './Confirm.tsx'
import { Icon } from './Icon.tsx'
import { ListThumb, SwapIcon, SwapText } from './motion.tsx'
import { cx, Popover } from './primitives.tsx'
import { RunMenuSection } from './RunTopBar.tsx'
import run from './run.module.css'
import css from './topbar.module.css'
import ui from './ui.module.css'
import { deleteDesc, WorkflowRow } from './WorkflowRow.tsx'

export interface WorkflowSwitcherProps {
  t: T
  wf: Workflow
  /** 本会话的工作流实例（下拉里「本会话的实例」那一段）。 */
  runs: Runs
  onOpenRun(id: string): void
  /** 打开一张工作流：模板编辑里切图，实例视图里先回到模板编辑再切。 */
  onOpenWorkflow(name: string): void
  /** 新建一张工作流（并进入编辑）。 */
  onNewWorkflow(): void
  /** 实例视图里「从磁盘重新加载」：重读这个实例（模板编辑里重读正开着的这张，用 `wf.reload`）。 */
  onReloadRun(): void
  /** 在实例视图里用：正在看的实例，与触发器里的内容；不给 = 模板编辑（触发器是工作流名字）。 */
  run?: { id: string; trigger(open: boolean): React.ReactNode }
}

export function WorkflowSwitcher(props: WorkflowSwitcherProps): React.JSX.Element {
  const { t, wf } = props
  const { state, catalog } = wf
  const inRun = props.run !== undefined
  /** 正开着的这张模板；在实例视图里没有「正开着的」。 */
  const current = inRun ? null : state.name
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** 顶栏上的名字正在改（只改正开着的这张）。 */
  const [renaming, setRenaming] = useState(false)
  /** 下拉里正在改名的那一行。 */
  const [editing, setEditing] = useState<string | null>(null)
  /** 删除确认卡指着哪一行；卡片挂在那一行的删除按钮上，下拉不收。 */
  const [doomed, setDoomed] = useState<string | null>(null)
  const remove = useConfirm<HTMLButtonElement>()
  /** 用鼠标点开了一张：下拉先不收，让人看到「已切过去」，鼠标移出去再收。 */
  const [lingering, setLingering] = useState(false)
  /** 刚点过「从磁盘重新加载」：图标换成对勾、字换成「已重新加载」，一会儿换回来（同实例顶栏的「复制路径」）。 */
  const [reloaded, setReloaded] = useState(false)
  const reloadedTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(reloadedTimer.current), [])

  // 刚建好的工作流：直接进入改名，名字全选，敲字即覆盖。
  useEffect(() => {
    if (inRun || wf.fresh === null || wf.fresh !== state.name) return
    wf.clearFresh()
    setRenaming(true)
  }, [inRun, wf.fresh, state.name, wf.clearFresh])

  const close = (): void => {
    setOpen(false)
    setQuery('')
    setEditing(null)
    setLingering(false)
  }

  /**
   * 点中一行：用鼠标点的，下拉先留着，让人看到已经切过去，鼠标移出再收；键盘、触屏立刻收起。
   * 模板编辑和实例视图共用同一个顶栏，切过去下拉也还在。
   */
  const choose = (event: React.MouseEvent): void => {
    if ((event.nativeEvent as PointerEvent).pointerType === 'mouse') setLingering(true)
    else close()
  }

  const workflows = catalog?.workflows ?? []
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const sorted = [...workflows].sort((a, b) => b.updatedAt - a.updatedAt)
    return needle === ''
      ? sorted
      : sorted.filter((entry) => entry.name.toLowerCase().includes(needle))
  }, [workflows, query])
  const doomedEntry = workflows.find((entry) => entry.name === doomed)

  return (
    <Popover
      open={open}
      onClose={close}
      hold={editing !== null || remove.open}
      onLeave={() => {
        if (lingering && editing === null && !remove.open) close()
      }}
      label={t('wf.pick')}
      className={css.menu}
      trigger={
        renaming && !inRun && state.name !== null ? (
          <NameInput
            t={t}
            name={state.name}
            onCommit={(value) => wf.rename(state.name ?? '', value)}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <button
            type="button"
            className={cx(css.switch, inRun && run.switchButton)}
            aria-expanded={open}
            aria-haspopup="dialog"
            data-testid={inRun ? 'wl-run-switcher' : 'wl-switcher'}
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
              if (inRun || state.name === null) return
              close()
              setRenaming(true)
            }}
          >
            {props.run !== undefined ? (
              props.run.trigger(open)
            ) : (
              <>
                <span className={css.name}>
                  <SwapText text={state.name ?? t('wf.pick')} />
                </span>
                <span className={css.chev} data-glide="">
                  <Icon name="chevronDown" size={14} />
                </span>
              </>
            )}
          </button>
        )
      }
    >
      <RunMenuSection
        t={t}
        runs={props.runs}
        activeId={props.run?.id ?? null}
        onOpenRun={(id, event) => {
          choose(event)
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
      <div className={cx(css.list, ui.stagger)}>
        <ListThumb layout={`${current ?? ''}|${filtered.map((entry) => entry.name).join('\n')}`} />
        {filtered.length === 0 && workflows.length > 0 && (
          <p className={css.emptyLine}>{t('wf.none')}</p>
        )}
        {filtered.map((entry) => (
          <WorkflowRow
            key={entry.name}
            t={t}
            entry={entry}
            active={entry.name === current}
            editing={editing === entry.name}
            busy={remove.open && doomed === entry.name}
            deleteRef={doomed === entry.name ? remove.anchorRef : undefined}
            onOpen={(event) => {
              choose(event)
              if (entry.name !== current) props.onOpenWorkflow(entry.name)
            }}
            onEdit={() => {
              if (remove.open) remove.hide()
              setEditing(entry.name)
            }}
            onRename={async (value) => {
              const ok = await wf.rename(entry.name, value)
              if (ok) setEditing(null)
              return ok
            }}
            onCancelEdit={() => setEditing(null)}
            onDelete={() => {
              if (remove.open && doomed === entry.name) {
                remove.hide()
                return
              }
              setDoomed(entry.name)
              remove.show()
            }}
          />
        ))}
      </div>
      {doomedEntry !== undefined &&
        remove.render({
          t,
          title: t('wf.deleteTitle').replace('{name}', doomedEntry.name),
          desc: deleteDesc(t, doomedEntry, doomedEntry.name === current),
          confirmText: t('common.delete'),
          testId: 'wl-delete-confirm',
          onConfirm: () => void wf.remove(doomedEntry.name),
        })}

      <div className={ui.menuSep} />
      {(inRun || state.name !== null) && (
        <button
          type="button"
          className={ui.menuItem}
          data-testid="wl-reload"
          onClick={(event) => {
            choose(event)
            if (inRun) props.onReloadRun()
            else wf.reload()
            setReloaded(true)
            window.clearTimeout(reloadedTimer.current)
            reloadedTimer.current = window.setTimeout(() => setReloaded(false), 1400)
          }}
        >
          <SwapIcon name={reloaded ? 'check' : 'reload'} size={15} />
          <span className={ui.menuLabel}>
            <SwapText
              text={reloaded ? t('wf.reloaded') : t('wf.reload')}
              reserve={[t('wf.reloaded'), t('wf.reload')]}
            />
          </span>
        </button>
      )}
      <button
        type="button"
        className={ui.menuItem}
        data-testid="wl-new"
        onClick={(event) => {
          choose(event)
          props.onNewWorkflow()
        }}
      >
        <Icon name="plus" size={15} />
        <span className={ui.menuLabel}>{t('wf.new')}</span>
      </button>
    </Popover>
  )
}

/** 顶栏上就地改正开着的这张的名字：回车或点开确认，Esc 取消。 */
function NameInput(props: {
  t: T
  name: string
  onCommit(value: string): Promise<boolean>
  onDone(): void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  /** Esc 之后输入框被卸掉时可能还会补一个 blur：那一下不算提交。 */
  const cancelled = useRef(false)

  useEffect(() => {
    ref.current?.select()
  }, [])

  const commit = (value: string): void => {
    if (cancelled.current) return
    void props.onCommit(value).then((ok) => {
      if (ok) props.onDone()
      else ref.current?.focus()
    })
  }

  return (
    <input
      ref={ref}
      className={css.rename}
      defaultValue={props.name}
      aria-label={props.t('wf.rename')}
      data-tip={props.t('wf.renameHint')}
      data-testid="wl-rename"
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(event.currentTarget.value)
        if (event.key === 'Escape') {
          event.stopPropagation()
          cancelled.current = true
          props.onDone()
        }
      }}
      onBlur={(event) => commit(event.currentTarget.value)}
    />
  )
}
