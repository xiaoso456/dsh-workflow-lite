/**
 * dsh-workflow-lite — 工作流中心「工作流」页：左边全部工作流，右边选中那张的标签和版本（{@link VersionList}）。
 *
 * 哪张都能直接看、存、切版本，打标签、改名（点标题或标题后的铅笔）、删除（标题栏末尾，确认卡浮在按钮旁）
 * 也都在右栏，不用先在编辑页打开它；要编辑就点「打开」。左栏只是列表（{@link WorkflowList}）。
 *
 * 左栏按视图选项分组（默认按标签，一个标签都还没有时不分组）、排序、筛选，另可按标签筛（多选）。
 * 标签是本机的整理用法（存在主机的 tags.json，见 shared/tags.ts）：打上、去掉、改名、删除、换颜色都立即生效，
 * 先改界面上的、再存，存不下就按主机重读一遍并提示。
 * 正在编辑的那张：动手前先把编辑页的改动写下去，切换之后编辑页按磁盘重新加载。
 *
 * 导入导出也在这一页：右栏换成导出（{@link HubExport}，标题栏「导出」）或导入（{@link HubImport}，
 * 左栏顶上「导入」，也可以直接把包拖到这一页上）。做完回到版本，顶上一句结果。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/HubWorkflows
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeName } from '../../../../shared/naming.ts'
import { normalizeTags, sameTag, type TagColor } from '../../../../shared/tags.ts'
import type { WorkflowEntry } from '../../../../shared/types.ts'
import { useListView } from '../../../app/listView.ts'
import { primeVersions } from '../../../app/useVersions.ts'
import { whenPrimed } from '../../../app/whenPrimed.ts'
import type { T } from '../../../i18n.ts'
import { claimRowKey, forgetRowKey, type RowKeys } from '../../../model/rowKeys.ts'
import { matchesWords, searchWords } from '../../../model/search.ts'
import { shortTime } from '../../../model/time.ts'
import { WORKFLOW_VIEW, type WorkflowListView } from '../../../model/workflowList.ts'
import { errorMessage, type WorkflowLiteRpc } from '../../../rpc.ts'
import { deleteDesc } from '../../chrome/WorkflowRow.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Skeleton } from '../../kit/Skeleton.tsx'
import ui from '../../kit/ui.module.css'
import { useRowSlide } from '../../motion/exits.tsx'
import { useResizeFlip } from '../../motion/flip.ts'
import { markSwap } from '../../motion/swap.tsx'
import { SwapScope } from '../../motion/swapScope.tsx'
import { SwapText } from '../../motion/swapText.tsx'
import { VersionList } from '../../versions/VersionList.tsx'
import { DeleteButton } from '../DeleteButton.tsx'
import { HubExport, type PackScope } from '../HubExport.tsx'
import { HubImport } from '../HubImport.tsx'
import { HubSearch } from '../HubSearch.tsx'
import hub from '../hub.module.css'
import { keepShown } from '../list/keepShown.ts'
import { ViewMenu } from '../list/ViewMenu.tsx'
import { Callout } from '../PackRow.tsx'
import css from '../pack.module.css'
import { TitleEdit } from '../TitleEdit.tsx'
import { useFileDrop } from '../useFileDrop.ts'
import type { TagColors } from './TagMark.tsx'
import { TagRow } from './Tags.tsx'
import { WorkflowList } from './WorkflowList.tsx'
import { arrangeWorkflows, filterLabel, toggleTag, workflowSections } from './workflowView.tsx'

/** 右栏现在是什么：版本（缺省）、导出选中那张、导入。 */
type Pane = 'versions' | 'export' | 'import'

export function HubWorkflows(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 编辑页正开着的那张。 */
  current: string | null
  /** 看 skill 时站在哪个会话、哪个工作区（导入导出盘点 skill 用）。 */
  scope: PackScope
  flush(): Promise<boolean>
  /** 一进来就是导出 `current` 那张（画布顶栏的「导出」），不是版本。 */
  startExport?: boolean
  /** 正开着的那张切了版本：编辑页按磁盘重新加载。 */
  onReload(): void
  onOpen(name: string): void
  /** 改名、删除：走编辑页同一套（正开着的那张跟着变）。回 `false` = 没成，已经提示过。 */
  rename(from: string, to: string): Promise<boolean>
  remove(name: string): Promise<boolean>
  /** 版本数变了：外面的工作流目录跟上。 */
  onChanged(): void
  /** 标签没存下这类事的提示。 */
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, rpc, current } = props
  const [workflows, setWorkflows] = useState<WorkflowEntry[] | null>(null)
  /** 挑过颜色的标签。 */
  const [tagColors, setTagColors] = useState<TagColors>({})
  /** 改过名的行沿用旧键（见 model/rowKeys.ts）。 */
  const rowKeys = useRef<RowKeys>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(current)
  /** 第几次点左栏：读版本时又点了别的，先前那次读完不再换过去。 */
  const pickRevision = useRef(0)
  /** 点的那一行在哪一组（一张在几个标签组里都有时，选中底块落在这一组）。 */
  const [pickedGroup, setPickedGroup] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [view, changeView] = useListView(WORKFLOW_VIEW)
  /** 按标签筛：挑了哪几个（只在这一次打开里记着）。 */
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [pane, setPane] = useState<Pane>(props.startExport === true ? 'export' : 'versions')
  /** 拖到页面上的包（交给导入页）。 */
  const [dropped, setDropped] = useState<File | null>(null)
  /** 导入导出做完的那句结果。 */
  const [notice, setNotice] = useState<string | null>(null)

  /** 重读目录；给了 `pick` 就同时选中它（改名后列表和选中一起换）。 */
  const load = useCallback(
    async (pick?: string): Promise<void> => {
      try {
        const list = await rpc.call('graph/list', {})
        setWorkflows([...list.workflows].sort((a, b) => b.updatedAt - a.updatedAt))
        setTagColors(list.tagColors)
        if (pick !== undefined) setPicked(pick)
      } catch (caught) {
        setError(errorMessage(caught))
        setWorkflows([])
      }
    },
    [rpc],
  )
  useEffect(() => {
    void load()
  }, [load])

  /** 先改界面上的，再存；存不下就提示、按主机重读。 */
  const patchTags = (change: (entry: WorkflowEntry) => string[] | null): void => {
    setWorkflows((list) =>
      list === null
        ? list
        : list.map((entry) => {
            const next = change(entry)
            if (next === null) return entry
            const { tags: _old, ...rest } = entry
            return next.length === 0 ? rest : { ...rest, tags: next }
          }),
    )
  }
  const failed = (caught: unknown): void => {
    props.onNotice(errorMessage(caught), 'error')
    void load()
  }
  const setTags = (name: string, next: string[]): void => {
    const tags = normalizeTags(next)
    patchTags((entry) => (entry.name === name ? tags : null))
    void rpc.call('graph/tags', { name, tags }).catch(failed)
  }
  const renameTag = async (from: string, to: string): Promise<boolean> => {
    try {
      const result = await rpc.call('graph/tagRename', { from, to })
      patchTags((entry) =>
        entry.tags?.some((tag) => sameTag(tag, from)) === true
          ? normalizeTags(entry.tags.map((tag) => (sameTag(tag, from) ? result.tag : tag)))
          : null,
      )
      setTagFilter((list) => list.map((tag) => (sameTag(tag, from) ? result.tag : tag)))
      // 颜色跟着改名的规矩在主机上（并进已有的标签时以那个的为准）：重读一遍。
      void load()
      return true
    } catch (caught) {
      failed(caught)
      return false
    }
  }
  const deleteTag = (tag: string): void => {
    patchTags((entry) =>
      entry.tags?.some((known) => sameTag(known, tag)) === true
        ? entry.tags.filter((known) => !sameTag(known, tag))
        : null,
    )
    setTagFilter((list) => list.filter((known) => !sameTag(known, tag)))
    setTagColors((colors) => withColor(colors, tag, null))
    void rpc.call('graph/tagDelete', { tag }).catch(failed)
  }
  const setTagColor = (tag: string, color: TagColor): void => {
    setTagColors((colors) => withColor(colors, tag, color))
    void rpc.call('graph/tagColor', { tag, color }).catch(failed)
  }
  const rename = async (from: string, to: string): Promise<boolean> => {
    const names = workflows?.map((entry) => entry.name) ?? []
    const claimed = claimRowKey(rowKeys.current, names, from, to)
    const ok = await props.rename(from, to)
    if (!ok) {
      if (claimed) forgetRowKey(rowKeys.current, to)
      return false
    }
    // 主机按同一套规矩收拾名字：选中的跟着换成新名字，和列表同一次换（不先落到别的一张上）。
    await load(normalizeName(to.trim()) || from)
    return true
  }

  const openImport = (file: File | null): void => {
    setNotice(null)
    setDropped(file)
    setPane('import')
  }

  // 把包拖到这一页上：直接进导入（宿主那层「拖动到此处即可添加」不弹，见 useFileDrop）。
  const dragging = useFileDrop(openImport)
  // 顶上的结果条收掉：条在原地淡出，下面的版本列表滑上来；新出现的从左边浮入。
  const detailRef = useResizeFlip({ exit: true, enter: true })
  // 换了一张：几样数字换了长短，后面那几样滑过去。
  const factRow = useRowSlide()

  if (workflows === null) {
    return <Skeleton label={t('hub.loading')} />
  }

  const importPane = (
    <HubImport
      t={t}
      rpc={rpc}
      scope={props.scope}
      file={dropped}
      over={dragging}
      taken={new Set(workflows.map((entry) => entry.name.toLowerCase()))}
      current={current}
      flush={props.flush}
      onBack={() => {
        setDropped(null)
        setPane('versions')
      }}
      onDone={(name, text, reload) => {
        setDropped(null)
        setPane('versions')
        setPicked(name)
        setNotice(text)
        if (reload) props.onReload()
        void load()
        props.onChanged()
      }}
    />
  )

  if (workflows.length === 0) {
    if (pane === 'import') {
      return (
        <div className={cx(hub.wfPage, dragging && css.dropping)} data-wl-file-drop="">
          <div className={hub.side} />
          {importPane}
        </div>
      )
    }
    return (
      <div className={cx(hub.empty, dragging && css.dropping)} data-wl-file-drop="">
        <span className={hub.emptyIcon}>
          <Icon name="folder" size={20} />
        </span>
        <p className={hub.emptyTitle}>{error ?? t('hub.wfEmpty')}</p>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.soft)}
          data-tip={t('pack.importTip')}
          data-testid="wl-hub-wf-import"
          onClick={() => openImport(null)}
        >
          <Icon name="upload" size={14} />
          {t('pack.import')}
        </button>
      </div>
    )
  }

  const words = searchWords(query)
  const {
    catalog,
    tags: filterTags,
    arranged,
  } = arrangeWorkflows(
    workflows,
    workflows.filter((entry) => matchesWords(words, [entry.name, ...(entry.tags ?? [])])),
    view,
    tagFilter,
  )
  /** 左栏从上到下的顺序（一张在几组里出现只算第一次）：默认选中第一张、删掉后选它下一张。 */
  const visible = [...new Set(arranged.groups.flatMap((group) => group.entries))]
  const selected = visible.find((entry) => entry.name === picked) ?? visible[0]
  // 换排法时右栏还看着原来那一项（没点过时它是第一项）。
  const onView = (change: Partial<WorkflowListView>): void => {
    keepShown(picked, selected?.name, setPicked)
    changeView(change)
  }
  const filtered = view.show !== 'all' || filterTags.length > 0
  // 画布上正开着的还没落盘（没在列表里）：不拿别的一张顶替去导出，停在版本。
  const shown = pane === 'export' && selected?.name !== picked ? 'versions' : pane
  /** 改过名的沿用旧键：右栏的键用它，改名不算换了一张（不重新入场、版本列表不清空）。 */
  const keyOf = (name: string): string => rowKeys.current.get(name) ?? name
  const detailKey = selected === undefined ? '' : keyOf(selected.name)
  // 正开着的那张改名时，编辑页先换成新名字、目录后到：按键比，中间那一下不当成别的一张。
  const editing = selected !== undefined && current !== null && keyOf(current) === detailKey
  return (
    <div className={cx(hub.wfPage, dragging && css.dropping)} data-wl-file-drop="">
      <div className={hub.side}>
        <HubSearch
          t={t}
          value={query}
          placeholder={t('hub.wfSearch')}
          testId="wl-hub-wf-search"
          onChange={setQuery}
          filter={
            filtered
              ? {
                  label: filterLabel(t, view.show, filterTags),
                  count: arranged.shown,
                  testId: 'wl-hub-wf-showing',
                  onClear: () => {
                    onView({ show: 'all' })
                    setTagFilter([])
                  },
                }
              : undefined
          }
          view={
            <ViewMenu
              t={t}
              sections={workflowSections(t, view, arranged.counts, catalog, tagColors, filterTags, {
                onView,
                onTag: (tag) => setTagFilter((list) => toggleTag(list, tag)),
              })}
              testId="wl-hub-wf-view"
            />
          }
        >
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-pressed={pane === 'import'}
            aria-label={t('pack.import')}
            data-tip={t('pack.importTip')}
            data-testid="wl-hub-wf-import"
            onClick={() => openImport(null)}
          >
            <Icon name="upload" size={15} />
          </button>
        </HubSearch>
        <WorkflowList
          t={t}
          groups={arranged.groups}
          sort={view.sort}
          names={visible.map((entry) => entry.name)}
          rowKeys={rowKeys.current}
          selected={selected?.name ?? ''}
          selectedGroup={pickedGroup}
          current={current}
          catalog={catalog}
          colors={tagColors}
          renameTag={renameTag}
          deleteTag={deleteTag}
          onPick={(name, group) => {
            // 先把那张的版本读好再换：右栏不先空一下（最多等一小会儿）。
            const revision = ++pickRevision.current
            const target = visible.find((entry) => entry.name === name)
            const reading =
              target === undefined || target === selected
                ? null
                : primeVersions(rpc, name, versionSignal(target))
            whenPrimed(reading, () => {
              if (revision !== pickRevision.current) return
              markSwap()
              setPicked(name)
              setPickedGroup(group)
              setNotice(null)
              setDropped(null)
              setPane('versions')
            })
          }}
        />
      </div>
      {shown === 'import' ? (
        importPane
      ) : selected === undefined ? (
        <div className={hub.empty}>
          <span className={hub.emptyIcon}>
            <Icon name="search" size={20} />
          </span>
          <p className={hub.emptyTitle}>{t('hub.wfNoMatch')}</p>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            onClick={() => setQuery('')}
          >
            {t('hub.clearSearch')}
          </button>
        </div>
      ) : shown === 'export' ? (
        <HubExport
          key={selected.name}
          t={t}
          rpc={rpc}
          name={selected.name}
          scope={props.scope}
          onBack={() => setPane('versions')}
          onDone={(text) => {
            setNotice(text)
            setPane('versions')
          }}
        />
      ) : (
        /* 标题、存版本那一栏钉在上面，版本多了只在版本框里滚（见 VersionList）。 */
        <SwapScope id={detailKey} order={visible.indexOf(selected)}>
          <div ref={detailRef} className={cx(hub.wfDetail, hub.pinned)}>
            {/* 和「触发」「记忆」页同一种头：图标块、名字后面跟标签、下面一行信息，操作靠右。 */}
            <div className={cx(hub.wfHead, hub.wfHeadTop)} data-swap-tier="0">
              <span
                className={cx(ui.kind, hub.headMark)}
                data-color={selected.invalid === true ? 'coral' : 'blue'}
              >
                <Icon name={selected.invalid === true ? 'alert' : 'hub'} size={18} />
              </span>
              <div className={hub.wfHeadText}>
                <div className={hub.nameLine}>
                  <TitleEdit
                    t={t}
                    value={selected.name}
                    label={t('wf.rename')}
                    testId="wl-hub-wf-title"
                    onCommit={(to) => rename(selected.name, to)}
                  />
                  {/* 画布上正开着的这张：铅笔后面「当前」，和左栏那行一样。 */}
                  {editing && (
                    <span
                      className={cx(hub.tag, hub.nameTag)}
                      data-tip={t('hub.wfEditing')}
                      data-testid="wl-hub-wf-current"
                    >
                      {t('hub.current')}
                    </span>
                  )}
                  <TagRow
                    t={t}
                    name={selected.name}
                    tags={selected.tags ?? []}
                    catalog={catalog}
                    colors={tagColors}
                    onChange={(next) => setTags(selected.name, next)}
                    onColor={setTagColor}
                  />
                </div>
                <p ref={factRow} className={cx(hub.wfSub, hub.facts)}>
                  <span className={hub.fact}>
                    <Icon name="rows" size={12} />
                    <SwapText
                      text={t('ver.steps').replace('{n}', String(selected.nodeCount))}
                      lead
                    />
                  </span>
                  {(selected.versions ?? 0) > 0 && (
                    <span className={hub.fact}>
                      <Icon name="history" size={12} />
                      <SwapText
                        text={t('ver.count').replace('{n}', String(selected.versions))}
                        lead
                      />
                    </span>
                  )}
                  <span className={hub.fact} data-tip={t('hub.wfUpdated')}>
                    <Icon name="clock" size={12} />
                    <SwapText text={shortTime(selected.updatedAt)} />
                  </span>
                </p>
              </div>
              <div className={hub.headActions}>
                <button
                  type="button"
                  className={cx(ui.btn, ui.icon, ui.small)}
                  aria-label={t('pack.export')}
                  data-tip={`${t('pack.export')} · ${t('pack.exportTip')}`}
                  data-testid="wl-hub-wf-export"
                  onClick={() => {
                    setNotice(null)
                    setPane('export')
                  }}
                >
                  <Icon name="download" size={14} />
                </button>
                <DeleteButton
                  t={t}
                  label={`${t('common.delete')} ${selected.name}`}
                  testId="wl-hub-wf-delete"
                  confirmTestId="wl-hub-wf-delete-confirm"
                  title={t('wf.deleteTitle').replace('{name}', selected.name)}
                  desc={deleteDesc(t, selected, editing)}
                  onConfirm={() => {
                    // 删掉之后选中挪到它下面一张（最后一张就挪到上面）。
                    const name = selected.name
                    const index = visible.indexOf(selected)
                    const next = visible[index + 1] ?? visible[index - 1]
                    void props.remove(name).then(async (ok) => {
                      if (ok) setPicked(next?.name ?? null)
                      await load()
                    })
                  }}
                />
                {/* 正开着的那张也留着：点了回到画布。 */}
                <button
                  type="button"
                  className={cx(ui.btn, ui.small, ui.soft)}
                  data-tip={t('hub.wfOpenTip')}
                  data-testid="wl-hub-wf-open"
                  onClick={() => props.onOpen(selected.name)}
                >
                  <Icon name="external" size={14} />
                  {t('hub.wfOpen')}
                </button>
              </div>
            </div>
            {notice !== null && (
              <Callout
                tone="ok"
                testId="wl-pack-notice"
                closeLabel={t('common.close')}
                onClose={() => setNotice(null)}
              >
                {notice}
              </Callout>
            )}
            <VersionList
              key={detailKey}
              t={t}
              rpc={rpc}
              name={selected.name}
              subject={detailKey}
              signal={versionSignal(selected)}
              {...(editing ? { before: props.flush } : {})}
              onRestored={() => {
                if (editing) props.onReload()
                void load()
              }}
              onChanged={() => {
                void load()
                props.onChanged()
              }}
            />
          </div>
        </SwapScope>
      )}
    </div>
  )
}

/** 颜色表里换掉这个标签的颜色（`null` = 去掉，回到按名字算的）。 */
function withColor(colors: TagColors, tag: string, color: TagColor | null): TagColors {
  const next = Object.fromEntries(Object.entries(colors).filter(([known]) => !sameTag(known, tag)))
  return color === null ? next : { ...next, [tag]: color }
}

/** 这张工作流的版本列表什么时候算「还是那一份」：修改时间、版本数都没变。 */
function versionSignal(entry: { updatedAt: number | string; versions?: number }): string {
  return `${entry.updatedAt}:${entry.versions ?? 0}`
}
