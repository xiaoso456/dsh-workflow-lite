/**
 * dsh-workflow-lite — 顶栏左边的工作流名字与它的下拉：切换、改名、删除、新建。
 *
 * 改名和删除挂在列表的每一行上（见 {@link WorkflowRow}），哪张都能直接改，不用先切过去；
 * 底下只留跟「正开着的这张」有关的「从磁盘重新加载」和「新建」。
 *
 * 搜索框（和工作流中心同款的 {@link HubSearch}）只管搜，实例和工作流一起搜。视图选项和筛选小片挂在「工作流」那一段的标题上，
 * 只管工作流：分组、排序、筛选、行高和工作流中心是同一份选择（app/listView.ts、app/listDensity.ts），按标签筛只在这个下拉里、不记。
 * 行高两段都跟着变。搜到了、但被筛选藏起来的工作流，在那一段里写一行「筛选隐藏了 N 个」，旁边可以清除筛选。
 * 工作流按分组列出（{@link GroupHead}，可折叠，和工作流中心同款；一张打了几个标签就在几组里各出现一次），
 * 一行写什么和工作流中心的行一个规矩（见 switcherFace.tsx）。
 * 图标块和工作流中心同一套（chrome/KindMark.tsx）。
 * 有触发卡片开着的工作流，名字后面挂一个小闪电（{@link WorkflowTriggerMark}；开着几张、全部暂停、没看过的失败），打开下拉时重读。
 * 双击顶栏上的名字、或刚新建好时，名字就地变成输入框改正开着的这张。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/WorkflowSwitcher
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkflowEntry } from '../../../shared/types.ts'
import { useListDensity } from '../../app/listDensity.ts'
import { useListView } from '../../app/listView.ts'
import type { Runs } from '../../app/useRuns.ts'
import type { Workflow } from '../../app/useWorkflow.ts'
import type { WorkflowTriggerMarks } from '../../app/useWorkflowTriggerMarks.ts'
import type { T } from '../../i18n.ts'
import { groupId, type ListGroup } from '../../model/listView.ts'
import { claimRowKey, forgetRowKey, type RowKeys, rowKey } from '../../model/rowKeys.ts'
import {
  currentFirst,
  filterRuns,
  filterWorkflows,
  holdTimes,
  normalizeNeedle,
  RUNS_SHOWN,
  visibleRuns,
} from '../../model/switcherSearch.ts'
import { WORKFLOW_SWITCHER_VIEW } from '../../model/workflowList.ts'
import type { WorkflowTriggerMark as TriggerMark } from '../../model/workflowTriggerMarks.ts'
import shared from '../chrome/topbar.module.css'
import { deleteDesc, WorkflowRow } from '../chrome/WorkflowRow.tsx'
import { WorkflowTriggerMark } from '../chrome/WorkflowTriggerMark.tsx'
import { FilterChip, HubSearch } from '../hub/HubSearch.tsx'
import { GroupHead } from '../hub/list/GroupedList.tsx'
import { ViewMenu } from '../hub/list/ViewMenu.tsx'
import {
  arrangeWorkflows,
  filterLabel,
  toggleTag,
  type WorkflowGroupKey,
  workflowGroupFace,
  workflowSections,
} from '../hub/workflows/workflowView.tsx'
import { useConfirm } from '../kit/Confirm.tsx'
import { cx } from '../kit/cx.ts'
import { EditActions } from '../kit/EditActions.tsx'
import { Icon } from '../kit/Icon.tsx'
import { Popover } from '../kit/Popover.tsx'
import ui from '../kit/ui.module.css'
import { useLineExit } from '../motion/exits.tsx'
import { useResizeFlip } from '../motion/flip.ts'
import { SwapIcon, SwapText } from '../motion/swapText.tsx'
import { ListThumb } from '../motion/thumb.tsx'
import { RunMenuRow, runSearchTexts } from '../run/RunTopBar.tsx'
import run from '../run/run.module.css'
import { workflowFace } from './switcherFace.tsx'
import css from './workflowSwitcher.module.css'

export interface WorkflowSwitcherProps {
  t: T
  wf: Workflow
  /** 本会话的工作流实例（下拉里「本会话的实例」那一段）。 */
  runs: Runs
  /** 哪几张工作流有触发开着（名字后面的小闪电）。 */
  triggerMarks: WorkflowTriggerMarks
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
  /** 实例那一组展开到全部（默认只露最近几个）。 */
  const [runsExpanded, setRunsExpanded] = useState(false)
  /** 顶栏上的名字正在改（只改正开着的这张）。 */
  const [renaming, setRenaming] = useState(false)
  /** 下拉里正在改名的那一行（行的键：一张在几组里出现时只改点的那一行）。 */
  const [editing, setEditing] = useState<string | null>(null)
  /**
   * 改过名的行沿用旧名字当 React 的键（新名字 → 旧键）：行是同一个元素，改完原地换回文字、顺着新排位滑过去，
   * 不会被当成新挂上的一项重放「依次浮出」（那是名字一闪的来源）。
   */
  const rowKeys = useRef(new Map<string, string>())
  /** 删除确认卡指着哪一张、挂在哪一行（行的键）的删除按钮上；下拉不收。 */
  const [doomed, setDoomed] = useState<{ name: string; key: string } | null>(null)
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
    setSeenTimes(null)
    setQuery('')
    setRunsExpanded(false)
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

  /** 打开下拉那一刻各张的修改时间：开着时按它排（见 `holdTimes`），存盘、换图不让行在手底下挪。 */
  const [seenTimes, setSeenTimes] = useState<ReadonlyMap<string, number> | null>(null)
  const workflows = useMemo(
    () => holdTimes(catalog?.workflows ?? [], seenTimes),
    [catalog?.workflows, seenTimes],
  )
  const needle = normalizeNeedle(query)
  const searching = needle !== ''
  const [view, changeView] = useListView(WORKFLOW_SWITCHER_VIEW)
  /** 按标签筛（多选）：只在这个下拉里，不记。 */
  const [tagFilter, setTagFilter] = useState<string[]>([])
  /** 收起的分组。 */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const standard = useListDensity() === 'standard'
  const tagColors = catalog?.tagColors ?? {}
  const matched = useMemo(() => filterWorkflows(workflows, needle), [workflows, needle])
  const {
    catalog: tagUses,
    tags,
    arranged,
  } = useMemo(
    () => arrangeWorkflows(workflows, matched, view, tagFilter),
    [workflows, matched, view, tagFilter],
  )
  const rows = switchRows(arranged.groups, folded, rowKeys.current)
  const fold = (id: string): void => {
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  const now = Date.now()
  const viewFiltered = view.show !== 'all' || tags.length > 0
  /** 搜到了、但被筛选藏起来的工作流有几张（只在搜着的时候说）。 */
  const hiddenByFilter = searching ? matched.length - arranged.shown : 0
  const clearFilter = (): void => {
    changeView({ show: 'all' })
    setTagFilter([])
  }
  const matchedRuns = useMemo(
    () =>
      filterRuns(currentFirst(props.runs.list, props.runs.current), needle, (item) =>
        runSearchTexts(t, item),
      ),
    [props.runs.list, props.runs.current, needle, t],
  )
  const activeRun = props.run?.id ?? null
  const { shown: shownRuns, hidden: hiddenRuns } = visibleRuns(matchedRuns, {
    expanded: runsExpanded || searching,
    active: activeRun,
  })
  /** 实例多到要折叠；搜索时全部摊开，不折。 */
  const foldable = !searching && matchedRuns.length > RUNS_SHOWN + 1
  /** 本会话有实例：两组各带一个标题；一个实例都没有就只有工作流，不加标题。 */
  const grouped = props.runs.list.length > 0
  const flip = useResizeFlip()
  const thumbLayout = [
    current ?? '',
    activeRun ?? '',
    shownRuns.map((item) => item.id).join(','),
    rows.map((row) => row.key).join(','),
    standard ? 'standard' : 'compact',
  ].join('|')
  const doomedEntry = workflows.find((entry) => entry.name === doomed?.name)

  return (
    <Popover
      open={open}
      onClose={close}
      hold={editing !== null || remove.open}
      onLeave={() => {
        if (lingering && editing === null && !remove.open) close()
      }}
      label={t('wf.pick')}
      className={shared.menu}
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
              setSeenTimes(new Map(workflows.map((entry) => [entry.name, entry.updatedAt])))
              void wf.refreshCatalog()
              void props.runs.refresh()
              props.triggerMarks.refresh()
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
                <span className={shared.chev} data-glide="">
                  <Icon name="chevronDown" size={14} />
                </span>
              </>
            )}
          </button>
        )
      }
    >
      <HubSearch
        t={t}
        value={query}
        placeholder={t('wf.search')}
        testId="wl-search"
        autoFocus
        flush
        onChange={setQuery}
      />
      {/* 实例与工作流共用一个滚动区：直接子项是平铺的（选中底块、滑动、依次浮出都按直接子项算）。 */}
      <div className={cx(css.scroll, ui.scrollFade)}>
        <div
          ref={flip}
          className={cx(css.listBody, ui.stagger)}
          data-density={standard ? 'standard' : 'compact'}
          data-testid="wl-switch-list"
        >
          <ListThumb layout={thumbLayout} carry="switcher" />
          {grouped && shownRuns.length > 0 && (
            <p className={cx(ui.menuTitle, css.groupTitle)} data-testid="wl-run-head">
              {t('run.thisSession')}
              <span className={css.groupCount}>{matchedRuns.length}</span>
            </p>
          )}
          {shownRuns.map((item) => (
            <RunMenuRow
              key={item.id}
              t={t}
              item={item}
              active={item.id === activeRun}
              current={item.id === props.runs.current}
              needle={needle}
              standard={standard}
              onOpen={(event) => {
                choose(event)
                props.onOpenRun(item.id)
              }}
              onBind={() => void props.runs.bind(item.id)}
            />
          ))}
          {foldable && (
            <RunsMore
              t={t}
              hidden={hiddenRuns}
              expanded={runsExpanded}
              onToggle={() => setRunsExpanded(!runsExpanded)}
            />
          )}
          {workflows.length > 0 && (arranged.shown > 0 || viewFiltered) && (
            <div
              className={cx(ui.menuTitle, css.groupTitle, css.wfHead)}
              data-later={shownRuns.length > 0}
              data-testid="wl-wf-head"
            >
              {t('run.workflows')}
              <span className={css.groupCount}>{arranged.shown}</span>
              <span className={css.headTools}>
                {viewFiltered && (
                  <FilterChip
                    t={t}
                    filter={{
                      label: filterLabel(t, view.show, tags),
                      count: arranged.shown,
                      testId: 'wl-switch-showing',
                      onClear: clearFilter,
                    }}
                  />
                )}
                <ViewMenu
                  t={t}
                  beside
                  sections={workflowSections(t, view, arranged.counts, tagUses, tagColors, tags, {
                    onView: changeView,
                    onTag: (tag) => setTagFilter((list) => toggleTag(list, tag)),
                  })}
                  testId="wl-switch-view"
                />
              </span>
            </div>
          )}
          {hiddenByFilter > 0 && (
            <p className={css.hiddenNote} data-testid="wl-switch-hidden">
              {t('wf.filterHidden').replace('{n}', String(hiddenByFilter))}
              <button type="button" className={css.hiddenClear} onClick={clearFilter}>
                {t('hub.clearShow')}
              </button>
            </p>
          )}
          {arranged.shown === 0 &&
            hiddenByFilter === 0 &&
            shownRuns.length === 0 &&
            (workflows.length > 0 || grouped) && <p className={ui.menuEmpty}>{t('wf.none')}</p>}
          {rows.map((row) => {
            if (row.kind === 'head') {
              const id = groupId(row.group)
              return (
                <GroupHead
                  key={row.key}
                  id={id}
                  face={workflowGroupFace(t, row.group, tagColors)}
                  count={row.group.entries.length}
                  closed={row.closed}
                  pinned={false}
                  testId="wl-switch-group"
                  onFold={() => fold(id)}
                />
              )
            }
            const { entry } = row
            const face = workflowFace(t, entry, {
              sort: view.sort,
              standard,
              colors: tagColors,
              now,
            })
            return (
              <WorkflowRow
                key={row.key}
                t={t}
                entry={entry}
                active={row.first && entry.name === current}
                editing={editing === row.key}
                needle={needle}
                sub={face.sub}
                end={face.end}
                mark={triggerMark(t, props.triggerMarks.marks.get(entry.name))}
                busy={remove.open && doomed?.key === row.key}
                deleteRef={doomed?.key === row.key ? remove.anchorRef : undefined}
                onOpen={(event) => {
                  choose(event)
                  if (entry.name !== current) props.onOpenWorkflow(entry.name)
                }}
                onEdit={() => {
                  if (remove.open) remove.hide()
                  setEditing(row.key)
                }}
                onRename={async (value) => {
                  // 先记下再等：目录一更新这一行就要拿新名字渲染，那时键已经得是旧的。
                  const claimed = claimRowKey(
                    rowKeys.current,
                    workflows.map((w) => w.name),
                    entry.name,
                    value,
                  )
                  const ok = await wf.rename(entry.name, value)
                  if (!ok && claimed) forgetRowKey(rowKeys.current, value)
                  if (ok) setEditing(null)
                  return ok
                }}
                onCancelEdit={() => setEditing(null)}
                onDelete={() => {
                  if (remove.open && doomed?.key === row.key) {
                    remove.hide()
                    return
                  }
                  setDoomed({ name: entry.name, key: row.key })
                  remove.show()
                }}
              />
            )
          })}
        </div>
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

/** 下拉里工作流那一段的一项：分组标题，或一行工作流。 */
type SwitchRow =
  | {
      kind: 'head'
      key: string
      group: ListGroup<WorkflowEntry, WorkflowGroupKey>
      closed: boolean
    }
  | { kind: 'row'; key: string; entry: WorkflowEntry; first: boolean }

/**
 * 按分组摊平成一项一项（选中底块、行的滑动都按列表的直接子项算，不能一组包一块）：收起的组只留标题。
 * 行的键沿用改名前的（`keys`，见 model/rowKeys.ts）；同一张第二次出现时键前面带上组，
 * `first` 只给第一次出现的那一行（选中底块落在它上面）。
 */
function switchRows(
  groups: readonly ListGroup<WorkflowEntry, WorkflowGroupKey>[],
  folded: ReadonlySet<string>,
  keys: RowKeys,
): SwitchRow[] {
  const names = [...new Set(groups.flatMap((group) => group.entries.map((entry) => entry.name)))]
  const seen = new Set<string>()
  const rows: SwitchRow[] = []
  for (const group of groups) {
    const id = groupId(group)
    const closed = group.by !== 'none' && folded.has(id)
    if (group.by !== 'none') rows.push({ kind: 'head', key: `group\n${id}`, group, closed })
    if (closed) continue
    for (const entry of group.entries) {
      const first = !seen.has(entry.name)
      seen.add(entry.name)
      const own = rowKey(keys, names, names.indexOf(entry.name))
      rows.push({ kind: 'row', key: first ? own : `${id}\n${own}`, entry, first })
    }
  }
  return rows
}

/** 实例那一组的尾巴：折叠时「显示全部 N 个」，展开后「收起」；箭头转个向（只动 transform）。 */
function RunsMore(props: {
  t: T
  hidden: number
  expanded: boolean
  onToggle(): void
}): React.JSX.Element {
  const { t } = props
  return (
    <button
      type="button"
      className={cx(ui.menuItem, css.more)}
      aria-expanded={props.expanded}
      data-testid="wl-run-more"
      onClick={props.onToggle}
    >
      <span>
        {props.expanded ? t('run.showLess') : t('run.showAll').replace('{n}', String(props.hidden))}
      </span>
      <span className={css.moreChev} data-opened={props.expanded}>
        <Icon name="chevronDown" size={13} />
      </span>
    </button>
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
  const lineRef = useLineExit()
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

  const cancel = (): void => {
    cancelled.current = true
    props.onDone()
  }

  return (
    <span className={cx(ui.editRow, css.renameField)}>
      <span ref={lineRef} className={ui.lineField}>
        <input
          ref={ref}
          className={cx(ui.lineInput, css.rename)}
          defaultValue={props.name}
          aria-label={props.t('wf.rename')}
          data-testid="wl-rename"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing)
              commit(event.currentTarget.value)
            if (event.key === 'Escape') {
              event.stopPropagation()
              cancel()
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
        />
      </span>
      <EditActions
        t={props.t}
        onConfirm={() => commit(ref.current?.value ?? '')}
        onCancel={cancel}
      />
    </span>
  )
}

/** 名字后面的小闪电；不用标是 `undefined`。 */
function triggerMark(t: T, mark: TriggerMark | undefined): React.ReactNode {
  return mark === undefined ? undefined : <WorkflowTriggerMark t={t} mark={mark} />
}
