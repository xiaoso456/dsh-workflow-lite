/**
 * dsh-workflow-lite — 工作流中心「记忆」页：左边记忆库里的每一条，右边选中那条的名称、描述、在用的工作流和版本。
 *
 * 和「工作流」页同一个两栏样子，左栏只是列表，操作都在右栏。记忆在编辑页里加（给步骤开记忆、
 * 加工作流记忆时选已有的或新建），这一页管已有的：改名称（点标题或标题后的铅笔）和描述、看文件、
 * 存版本 / 切版本、删掉（标题栏末尾，确认卡说清有几个工作流在用、几个版本一起删）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/HubMemories
 */

import { useEffect, useState } from 'react'
import type { StepColor } from '../../../shared/appearance.ts'
import { type MemoryEntry, memoryTitle } from '../../../shared/memoryLib.ts'
import { idKey } from '../../../shared/model.ts'
import type { Desktop } from '../../app/desktop.ts'
import { useListView } from '../../app/listView.ts'
import { type MemoryStore, useMemories } from '../../app/memories.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { formatBytes } from '../../model/fileKind.ts'
import { arrangeList, groupId, type ListGroup } from '../../model/listView.ts'
import {
  MEMORY_GROUPS,
  MEMORY_LIST,
  MEMORY_SHOWS,
  MEMORY_SORTS,
  MEMORY_VIEW,
  type MemoryGroupBy,
  type MemoryListView,
  type MemoryShow,
  type MemorySortBy,
  NO_WORKFLOW,
} from '../../model/memoryList.ts'
import { matchesWords, searchWords } from '../../model/search.ts'
import { pastTime, shortTime } from '../../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../../rpc.ts'
import { FolderDialog } from '../files/FolderDialog.tsx'
import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import { Skeleton } from '../kit/Skeleton.tsx'
import { TextArea } from '../kit/TextArea.tsx'
import { TintChip } from '../kit/TintChip.tsx'
import ui from '../kit/ui.module.css'
import ins from '../panel/panel.module.css'
import { memoryTypeText } from '../resources/ResourcePresets.tsx'
import { MemoryVersionList } from '../versions/VersionList.tsx'
import { DeleteButton } from './DeleteButton.tsx'
import { HubSearch } from './HubSearch.tsx'
import hub from './hub.module.css'
import css from './hubMemories.module.css'
import { GroupedList, type GroupFace, ShowingBar } from './list/GroupedList.tsx'
import { HubRow, rowMark } from './list/HubRow.tsx'
import { keepShown } from './list/keepShown.ts'
import { type MenuSection, ViewMenu } from './list/ViewMenu.tsx'
import { TitleEdit } from './TitleEdit.tsx'

export function HubMemories(props: {
  t: T
  rpc: WorkflowLiteRpc
  store: MemoryStore
  desktop: Desktop | undefined
  /** 点「在用的工作流」里的一张：打开它（对话框跟着关）。 */
  onOpen(name: string): void
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, store } = props
  const { entries, error } = useMemories(store)
  const [picked, setPicked] = useState<string | null>(null)
  /** 点的那一行在哪一组（一条记忆在几组里都有时，选中底块落在这一组）。 */
  const [pickedGroup, setPickedGroup] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [view, changeView] = useListView(MEMORY_VIEW)
  // 一进这一页重读一遍：在用的工作流、大小可能刚变。
  useEffect(() => {
    void store.refresh()
  }, [store])

  if (entries === null) {
    return error === null ? <Skeleton label={t('hub.loading')} /> : <Empty t={t} text={error} />
  }
  if (entries.length === 0)
    return <Empty t={t} text={t('hub.memEmpty')} hint={t('hub.memEmptyHint')} />

  const words = searchWords(query)
  const matched = entries.filter((entry) =>
    matchesWords(words, [
      memoryTitle(entry),
      entry.id,
      entry.description,
      memoryTypeText(t, entry.type),
      ...entry.usedBy,
    ]),
  )
  const arranged = arrangeList(matched, view, MEMORY_LIST)
  /** 左栏从上到下的顺序（一条在几组里出现只算第一次）：默认选中第一条、删掉后选它下一条。 */
  const ordered = [...new Set(arranged.groups.flatMap((group) => group.entries))]
  const selected =
    ordered.find((entry) => picked !== null && idKey(entry.id) === idKey(picked)) ?? ordered[0]
  // 换排法时右栏还看着原来那一项（没点过时它是第一项）。
  const onView = (change: Partial<MemoryListView>): void => {
    keepShown(picked, selected?.id, setPicked)
    changeView(change)
  }
  return (
    <div className={hub.wfPage}>
      <div className={hub.side}>
        <HubSearch
          t={t}
          value={query}
          placeholder={t('hub.memSearch')}
          testId="wl-hub-mem-search"
          onChange={setQuery}
        >
          <ViewMenu
            t={t}
            sections={memorySections(t, view, arranged.counts, onView)}
            filtered={view.show !== 'all'}
            testId="wl-hub-mem-view"
          />
        </HubSearch>
        {view.show !== 'all' && (
          <ShowingBar
            text={t('hub.showing')
              .replace('{label}', t(SHOW[view.show].label))
              .replace('{n}', String(arranged.shown))}
            clearLabel={t('hub.clearShow')}
            testId="wl-hub-mem-showing"
            onClear={() => onView({ show: 'all' })}
          />
        )}
        <MemoryList
          t={t}
          groups={arranged.groups}
          sort={view.sort}
          selected={selected?.id ?? ''}
          selectedGroup={pickedGroup}
          onPick={(id, group) => {
            setPicked(id)
            setPickedGroup(group)
          }}
        />
      </div>
      {selected === undefined ? (
        <div className={hub.empty}>
          <span className={hub.emptyIcon}>
            <Icon name="search" size={20} />
          </span>
          <p className={hub.emptyTitle}>{t('hub.memNoMatch')}</p>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            onClick={() => setQuery('')}
          >
            {t('hub.clearSearch')}
          </button>
        </div>
      ) : (
        <MemoryDetail
          key={selected.id}
          {...props}
          entry={selected}
          onRemove={async () => {
            // 删掉之后选中挪到它下面一条（最后一条就挪到上面）。
            const index = ordered.indexOf(selected)
            const next = ordered[index + 1] ?? ordered[index - 1]
            try {
              await store.remove(selected.id)
              setPicked(next?.id ?? null)
              props.onNotice(t('hub.memDeleted').replace('{name}', memoryTitle(selected)))
            } catch (caught) {
              props.onNotice(errorMessage(caught), 'error')
            }
          }}
        />
      )}
    </div>
  )
}

function Empty(props: { t: T; text: string; hint?: string }): React.JSX.Element {
  return (
    <div className={hub.empty}>
      <span className={hub.emptyIcon}>
        <Icon name="memory" size={20} />
      </span>
      <p className={hub.emptyTitle}>{props.text}</p>
      {props.hint !== undefined && <p className={hub.emptyText}>{props.hint}</p>}
    </div>
  )
}

/** 两种记忆的小块：工作流记忆（全局）蓝的、步骤记忆绿的，图标和分组标题上的一样。 */
const TYPE_CHIP: Record<MemoryEntry['type'], { color: StepColor; icon: IconName }> = {
  workflow: { color: 'blue', icon: 'hub' },
  step: { color: 'green', icon: 'rows' },
}

function TypeChip(props: {
  t: T
  type: MemoryEntry['type']
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const { t, type } = props
  const look = TYPE_CHIP[type]
  const short = props.size !== 'md'
  return (
    <TintChip
      color={look.color}
      icon={look.icon}
      size={props.size ?? 'sm'}
      label={
        short
          ? t(type === 'workflow' ? 'mem.tag.workflow' : 'mem.tag.step')
          : memoryTypeText(t, type)
      }
      tip={short ? memoryTypeText(t, type) : undefined}
    />
  )
}

/** 列表行的第二行：类型小块 + 用量（大小在右边详情的统计卡里，列表里不放）。 */
function MemoryMeta(props: { t: T; entry: MemoryEntry }): React.JSX.Element {
  const { t, entry } = props
  if (entry.invalid === true) return <span className={css.listMeta}>{t('hub.memInvalid')}</span>
  return (
    <span className={css.listMeta}>
      <TypeChip t={t} type={entry.type} />
      <span className={css.listUsed} data-unused={entry.usedBy.length === 0}>
        {entry.usedBy.length === 0
          ? t('mem.unused')
          : t('mem.usedBy').replace('{n}', String(entry.usedBy.length))}
      </span>
    </span>
  )
}

function MemoryList(props: {
  t: T
  groups: readonly ListGroup<MemoryEntry, MemoryGroupKey>[]
  /** 怎么排的：按修改时间排时紧凑的行尾写修改时间，别的写几个工作流在用。 */
  sort: MemorySortBy
  selected: string
  selectedGroup: string | undefined
  onPick(id: string, group: string): void
}): React.JSX.Element {
  const { t } = props
  const now = Date.now()
  return (
    <GroupedList
      label={t('hub.memories')}
      groups={props.groups}
      keyOf={(entry) => entry.id}
      selected={props.selected}
      selectedGroup={props.selectedGroup}
      face={(group) => memoryGroupFace(t, group)}
      empty={t('hub.memNoMatch')}
      testId="wl-hub-mem-group"
      row={(entry, at) => {
        const title = memoryTitle(entry)
        const used = entry.usedBy.length
        return (
          <HubRow
            flip={at.flip}
            selected={at.selected}
            current={at.selected || at.also}
            testId="wl-hub-mem"
            value={entry.id}
            off={used === 0}
            mark={
              <span
                className={cx(ui.kind, rowMark)}
                data-color={entry.invalid === true ? 'coral' : 'amber'}
              >
                <Icon name={entry.invalid === true ? 'alert' : 'memory'} size={15} />
              </span>
            }
            name={title}
            meta={<MemoryMeta t={t} entry={entry} />}
            end={
              entry.invalid === true
                ? t('hub.memInvalidShort')
                : props.sort === 'recent'
                  ? pastTime(t, entry.updatedAt, now)
                  : used === 0
                    ? t('mem.unused')
                    : t('hub.memUsedShort').replace('{n}', String(used))
            }
            // 起了名字的记忆悬停看编号（卡片上引用的是编号）。
            tip={title === entry.id ? title : [title, entry.id].join('\n')}
            tipAlways={title !== entry.id}
            onPick={() => props.onPick(entry.id, groupId(at.group))}
          />
        )
      }}
    />
  )
}

type MemoryGroupKey = Exclude<MemoryGroupBy, 'none'>

const GROUP: Record<MemoryGroupBy, { label: LocaleKey; icon: IconName }> = {
  type: { label: 'hub.memGroup.type', icon: 'memory' },
  use: { label: 'hub.memGroup.use', icon: 'activity' },
  workflow: { label: 'hub.memGroup.workflow', icon: 'hub' },
  none: { label: 'hub.group.none', icon: 'overview' },
}

const SORT: Record<MemorySortBy, { label: LocaleKey; icon: IconName }> = {
  recent: { label: 'hub.memSort.recent', icon: 'history' },
  name: { label: 'hub.sort.name', icon: 'font' },
  used: { label: 'hub.memSort.used', icon: 'hub' },
}

const SHOW: Record<MemoryShow, { label: LocaleKey; icon: IconName }> = {
  all: { label: 'hub.memShow.all', icon: 'overview' },
  used: { label: 'hub.memShow.used', icon: 'check' },
  unused: { label: 'hub.memShow.unused', icon: 'circle' },
}

function memorySections(
  t: T,
  view: MemoryListView,
  counts: Record<MemoryShow, number>,
  onView: (change: Partial<MemoryListView>) => void,
): MenuSection[] {
  return [
    {
      id: 'group',
      title: t('hub.groupBy'),
      choices: MEMORY_GROUPS.map((value) => ({
        value,
        label: t(GROUP[value].label),
        icon: GROUP[value].icon,
      })),
      checked: (value) => view.group === value,
      onPick: (value) => onView({ group: value as MemoryGroupBy }),
    },
    {
      id: 'sort',
      title: t('hub.sortBy'),
      choices: MEMORY_SORTS.map((value) => ({
        value,
        label: t(SORT[value].label),
        icon: SORT[value].icon,
      })),
      checked: (value) => view.sort === value,
      onPick: (value) => onView({ sort: value as MemorySortBy }),
    },
    {
      id: 'show',
      title: t('hub.showBy'),
      choices: MEMORY_SHOWS.map((value) => ({
        value,
        label: t(SHOW[value].label),
        icon: SHOW[value].icon,
        count: counts[value],
      })),
      checked: (value) => view.show === value,
      onPick: (value) => onView({ show: value as MemoryShow }),
    },
  ]
}

/** 分组标题：按类型是工作流记忆 / 步骤记忆，按使用是在用 / 未使用（未使用是灰的），按工作流是工作流名。 */
function memoryGroupFace(t: T, group: ListGroup<MemoryEntry, MemoryGroupKey>): GroupFace {
  if (group.by === 'type') {
    const type = group.key === 'workflow' ? 'workflow' : 'step'
    return {
      label: t(type === 'workflow' ? 'mem.type.workflow' : 'mem.type.step'),
      lead: <Icon name={type === 'workflow' ? 'hub' : 'rows'} size={15} />,
    }
  }
  if (group.by === 'use') {
    const inUse = group.key === 'used'
    return {
      label: t(inUse ? 'hub.memBucket.used' : 'hub.memBucket.unused'),
      lead: (
        <span className={css.groupLead} data-on={inUse}>
          <Icon name={inUse ? 'check' : 'circle'} size={15} />
        </span>
      ),
    }
  }
  if (group.by === 'workflow' && group.key === NO_WORKFLOW) {
    return { label: t('hub.memNoWorkflow'), lead: <Icon name="circle" size={15} /> }
  }
  return { label: group.key, lead: <Icon name="hub" size={15} /> }
}

/** 删除确认卡上那句：谁在用、几个版本一起删。 */
function deleteText(t: T, entry: MemoryEntry): string {
  const parts = [
    entry.usedBy.length > 0
      ? t('hub.memDeleteUsed').replace('{n}', String(entry.usedBy.length))
      : null,
    entry.versions > 0
      ? t('wf.deleteVersions').replace('{n}', String(entry.versions))
      : t('wf.deleteConfirm'),
  ]
  return parts.filter((part) => part !== null).join('')
}

function MemoryDetail(props: {
  t: T
  rpc: WorkflowLiteRpc
  store: MemoryStore
  desktop: Desktop | undefined
  entry: MemoryEntry
  onOpen(name: string): void
  onNotice(text: string, tone?: 'info' | 'error'): void
  onRemove(): Promise<void>
}): React.JSX.Element {
  const { t, entry, store } = props
  const [description, setDescription] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  /** 存下（回有没有存成，没成已经提示过）。 */
  const save = (patch: { name?: string; description?: string }): Promise<boolean> =>
    store.update({ id: entry.id, ...patch }).then(
      () => true,
      (caught: unknown) => {
        props.onNotice(errorMessage(caught), 'error')
        return false
      },
    )

  const stats: [string, string][] = [
    [t('mem.statFiles'), String(entry.files)],
    [t('mem.statSize'), formatBytes(entry.bytes)],
    [t('mem.statUpdated'), shortTime(entry.updatedAt)],
  ]

  return (
    <div className={cx(hub.wfDetail, hub.paneIn)} data-testid="wl-hub-mem-detail">
      <div className={css.hubHead}>
        <span className={css.hubIcon}>
          <Icon name="memory" size={18} />
        </span>
        <div className={css.hubHeadText}>
          {/* 名称是空的时候标题写 id；改名时输入框里是存着的名称（空的就空着，占位写 id）。 */}
          <TitleEdit
            t={t}
            value={entry.name}
            display={memoryTitle(entry)}
            placeholder={entry.id}
            maxLength={80}
            label={t('wf.rename')}
            testId="wl-hub-mem-name"
            onCommit={(name) => save({ name })}
          />
          <p className={cx(hub.wfSub, hub.facts)}>
            <TypeChip t={t} type={entry.type} size="md" />
            <code>{entry.id}</code>
          </p>
        </div>
        <div className={css.hubActions}>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            data-tip={t('mem.viewTip')}
            data-testid="wl-hub-mem-view"
            onClick={() => setViewing(true)}
          >
            <Icon name="eye" size={14} />
            {t('mem.view')}
          </button>
          <DeleteButton
            t={t}
            className={cx(ui.btn, ui.icon, ui.small, ui.danger)}
            label={`${t('common.delete')} ${memoryTitle(entry)}`}
            testId="wl-hub-mem-delete"
            confirmTestId="wl-hub-mem-delete-confirm"
            title={t('hub.memDeleteTitle').replace('{name}', memoryTitle(entry))}
            desc={deleteText(t, entry)}
            onConfirm={() => void props.onRemove()}
          />
        </div>
      </div>

      <div className={css.hubBody}>
        <div className={css.hubInfo}>
          <span className={css.secHead}>{t('hub.memInfo')}</span>
          <div className={hub.stats} data-testid="wl-hub-mem-stats">
            {stats.map(([label, value]) => (
              <div key={label} className={hub.stat}>
                <span className={hub.statLabel}>{label}</span>
                <span className={hub.statValue}>{value}</span>
              </div>
            ))}
          </div>

          <label className={css.sec}>
            <span className={css.secHead}>{t('ins.description')}</span>
            <TextArea
              className={cx(ui.textarea, css.hubDesc)}
              value={description ?? entry.description}
              placeholder={t('mem.descPlaceholder')}
              maxLength={500}
              rows={4}
              data-testid="wl-hub-mem-desc"
              onChange={(event) => setDescription(event.currentTarget.value)}
              onBlur={() => {
                if (description !== null && description !== entry.description) {
                  save({ description })
                }
                setDescription(null)
              }}
            />
          </label>

          <section className={css.sec} data-testid="wl-hub-mem-used">
            <span className={css.secHead}>
              {t('hub.memUsedBy')}
              {entry.usedBy.length > 0 && <span className={ins.count}>{entry.usedBy.length}</span>}
            </span>
            {entry.usedBy.length === 0 ? (
              <p className={css.usedNone}>{t('hub.memUnusedHint')}</p>
            ) : (
              <div className={css.usedRow}>
                {entry.usedBy.map((workflow) => (
                  <button
                    key={workflow}
                    type="button"
                    className={css.usedChip}
                    data-tip={t('hub.wfOpenTip')}
                    data-testid="wl-hub-mem-workflow"
                    onClick={() => props.onOpen(workflow)}
                  >
                    <Icon name="folder" size={12} />
                    <span>{workflow}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {entry.invalid !== true && (
          <section className={css.hubVers}>
            <span className={css.secHead}>
              {t('ver.title')}
              {entry.versions > 0 && <span className={ins.count}>{entry.versions}</span>}
            </span>
            <MemoryVersionList
              t={t}
              rpc={props.rpc}
              store={store}
              id={entry.id}
              desktop={props.desktop}
            />
          </section>
        )}
      </div>

      {viewing && (
        <FolderDialog
          t={t}
          source={store.source(entry.id)}
          item={{ kind: 'folder', value: entry.id }}
          desktop={props.desktop}
          missing={t('mem.viewEmpty')}
          onClose={() => setViewing(false)}
        />
      )}
    </div>
  )
}
