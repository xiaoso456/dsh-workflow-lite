/**
 * dsh-workflow-lite — 工作流中心「运行实例」页：和「触发」「记忆」页同一种两栏——左边按选的方式分组列出全部实例，
 * 右边选中那个实例的全貌（{@link RunDetail}）。
 *
 * - 左栏：搜索 + 视图选项（按工作区 / 工作流 / 状态 / 会话分组，排序，只看进行中 / 失败），分组标题能折叠、钉在顶上
 *   （{@link GroupedList}）。每行悬停时浮出「查看」「删除」。
 * - 右栏：标题、操作和状态条，下面概览、画布、时间线、信息四个页签（{@link RunDetail}）；选中的页签换实例不变。
 * - 搜索跨所有实例；选中的那个被筛掉了就换到排在最前的那个。删掉选中的那个时选它下一个。
 *
 * 打开时拉一次全部会话的实例；移动、删除、改状态之后再拉一次。不跟着外面的重绘重拉——会话列表一有动静
 * （别的会话在输出）外面就会重绘，跟着重拉会让列表一直闪。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/HubRuns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstanceSummary, RunStatus } from '../../../../shared/runState.ts'
import { useListView } from '../../../app/listView.ts'
import type { SessionRow } from '../../../app/sessions.ts'
import type { Runs } from '../../../app/useRuns.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { matchesQuery, workspaceKey, workspacesOf } from '../../../model/hubRuns.ts'
import { arrangeList, type ListGroup } from '../../../model/listView.ts'
import {
  RUN_GROUPS,
  RUN_SHOWS,
  RUN_SORTS,
  RUN_VIEW,
  type RunBucket,
  type RunGroupBy,
  type RunListView,
  type RunShow,
  type RunSortBy,
  runListSpec,
  updatedOf,
} from '../../../model/runList.ts'
import { pastTime } from '../../../model/time.ts'
import { errorCode, errorMessage, type WorkflowLiteRpc } from '../../../rpc.ts'
import { cx } from '../../kit/cx.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import { Skeleton } from '../../kit/Skeleton.tsx'
import ui from '../../kit/ui.module.css'
import { HubSearch } from '../HubSearch.tsx'
import hub from '../hub.module.css'
import { GroupedList, type GroupFace, groupDot } from '../list/GroupedList.tsx'
import { keepShown } from '../list/keepShown.ts'
import { type MenuSection, ViewMenu } from '../list/ViewMenu.tsx'
import { RunDetail, type RunTab } from './RunDetail.tsx'
import { RunItem } from './RunItem.tsx'
import { BUCKET_FACE } from './runFace.ts'
import css from './runs.module.css'

type GroupKey = Exclude<RunGroupBy, 'none'>

const GROUP: Record<RunGroupBy, { label: LocaleKey; icon: IconName }> = {
  workspace: { label: 'hub.runGroup.workspace', icon: 'folder' },
  workflow: { label: 'hub.runGroup.workflow', icon: 'hub' },
  status: { label: 'hub.runGroup.status', icon: 'activity' },
  session: { label: 'hub.runGroup.session', icon: 'chat' },
  none: { label: 'hub.group.none', icon: 'overview' },
}

const SORT: Record<RunSortBy, { label: LocaleKey; icon: IconName }> = {
  created: { label: 'hub.runSort.created', icon: 'clock' },
  updated: { label: 'hub.runSort.updated', icon: 'history' },
  name: { label: 'hub.runSort.name', icon: 'font' },
}

const SHOW: Record<RunShow, { label: LocaleKey; icon: IconName }> = {
  all: { label: 'hub.runShow.all', icon: 'overview' },
  active: { label: 'hub.runShow.active', icon: 'play' },
  failed: { label: 'hub.runShow.failed', icon: 'alert' },
}

function menuSections(
  t: T,
  view: RunListView,
  counts: Record<RunShow, number>,
  onView: (change: Partial<RunListView>) => void,
): MenuSection[] {
  return [
    {
      id: 'group',
      title: t('hub.groupBy'),
      choices: RUN_GROUPS.map((value) => ({
        value,
        label: t(GROUP[value].label),
        icon: GROUP[value].icon,
      })),
      checked: (value) => view.group === value,
      onPick: (value) => onView({ group: value as RunGroupBy }),
    },
    {
      id: 'sort',
      title: t('hub.sortBy'),
      choices: RUN_SORTS.map((value) => ({
        value,
        label: t(SORT[value].label),
        icon: SORT[value].icon,
      })),
      checked: (value) => view.sort === value,
      onPick: (value) => onView({ sort: value as RunSortBy }),
    },
    {
      id: 'show',
      title: t('hub.showBy'),
      choices: RUN_SHOWS.map((value) => ({
        value,
        label: t(SHOW[value].label),
        icon: SHOW[value].icon,
        count: counts[value],
      })),
      checked: (value) => view.show === value,
      onPick: (value) => onView({ show: value as RunShow }),
    },
  ]
}

export function HubRuns(props: {
  t: T
  rpc: WorkflowLiteRpc
  session: string | undefined
  sessionRows: readonly SessionRow[]
  sessionsReady: boolean
  runs: Runs
  /** 打开实例；给了 `node` 就选中那一步。 */
  onOpenRun(id: string, node?: string): void
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, session, sessionRows } = props
  const [items, setItems] = useState<InstanceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, changeView] = useListView(RUN_VIEW)
  /** 点过的实例；没点过 = 排在最前的那个。 */
  const [picked, setPicked] = useState<string | null>(null)
  const [tab, setTab] = useState<RunTab>('overview')

  // `runs` 每次重绘都是新对象：放进 ref，免得 load 跟着变、effect 跟着重跑。
  const runsRef = useRef(props.runs)
  runsRef.current = props.runs
  const load = useCallback(async (): Promise<void> => {
    try {
      setItems(await runsRef.current.all())
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  /** 改整体状态：存下去、刷新列表、提示一句（通知没有、送到没有；冲突时说清楚已经刷新）。 */
  const setStatus = async (
    item: InstanceSummary,
    to: RunStatus,
    options: { notify: boolean; note: string },
  ): Promise<void> => {
    try {
      const result = await runsRef.current.setStatus(item.id, item.status, to, options)
      props.onNotice(
        !options.notify
          ? t('run.savedSilent')
          : result.notified
            ? t('run.savedNotified')
            : t('run.savedPending'),
      )
    } catch (caught) {
      props.onNotice(
        errorCode(caught) === 'conflict' ? t('hub.statusConflict') : errorMessage(caught),
        'error',
      )
    }
    await load()
  }

  const titles = useMemo(
    () => new Map(sessionRows.map((row) => [row.id, row.title])),
    [sessionRows],
  )
  const hereCwd =
    sessionRows.find((row) => row.id === session)?.cwd ??
    items?.find((item) => session !== undefined && item.session === session)?.cwd
  const workspaces = useMemo(
    () => new Map(workspacesOf(items ?? [], hereCwd).map((ws) => [ws.key, ws])),
    [items, hereCwd],
  )
  const spec = useMemo(
    () => runListSpec(items ?? [], { cwd: hereCwd, session }),
    [items, hereCwd, session],
  )
  const arranged = useMemo(() => {
    const matched = (items ?? []).filter((item) =>
      matchesQuery(item, item.session === undefined ? undefined : titles.get(item.session), query),
    )
    return arrangeList(matched, view, spec)
  }, [items, titles, query, view, spec])
  const ordered = arranged.groups.flatMap((group) => group.entries)
  const selected = ordered.find((item) => item.id === picked) ?? ordered[0]
  // 换排法时右栏还看着原来那一项（没点过时它是第一项）。
  const onView = (change: Partial<RunListView>): void => {
    keepShown(picked, selected?.id, setPicked)
    changeView(change)
  }
  // 会话列表到了（「本工作区」是哪个已经定下来）就把默认选中的那个记成点过的：
  // 之后列表刷新、换了次序（删了、移了、模型改了状态），右栏不会自己跳到别的实例。
  const selectedId = selected?.id
  useEffect(() => {
    if (picked === null && props.sessionsReady && selectedId !== undefined) setPicked(selectedId)
  }, [picked, props.sessionsReady, selectedId])

  /** 删掉一个：选中的是它就先换到下一个，删完重拉（没删成时它回来）。 */
  const remove = async (item: InstanceSummary, withState: boolean): Promise<void> => {
    if (item.id === selectedId) {
      const index = ordered.indexOf(item)
      setPicked((ordered[index + 1] ?? ordered[index - 1])?.id ?? null)
    }
    await runsRef.current.remove(item.id, withState)
    await load()
  }

  const sessionLabel = (id: string | undefined): { text: string; mine: boolean } => {
    if (id === undefined) return { text: t('hub.noSession'), mine: false }
    const title = titles.get(id)
    if (id === session) return { text: title ?? t('hub.thisSession'), mine: true }
    if (title !== undefined) return { text: title, mine: false }
    return { text: props.sessionsReady ? t('hub.sessionGone') : t('hub.otherSession'), mine: false }
  }
  const workspaceOf = (
    item: InstanceSummary,
  ): { name: string; path: string | undefined; here: boolean } => {
    const ws = workspaces.get(workspaceKey(item.cwd))
    return {
      name: ws?.name || t('hub.noWorkspace'),
      path: ws?.path ?? item.cwd,
      here: ws?.here ?? false,
    }
  }
  /** 行里状态后面那半句：按工作区分时写会话，别的分法写工作区；都带建立时间。 */
  /** 左栏一行状态后面只写建立时间：会话、工作区在右栏标题下面（左栏写不下，同名的实例靠时间分）。 */
  // 状态后面那半句写排序用的那个时间（按最近更新排就写更新时间）；紧凑时按时间排的行尾也写它。
  const now = Date.now()
  const noteOf = (item: InstanceSummary): string =>
    pastTime(t, view.sort === 'updated' ? updatedOf(item) : item.createdAt, now)

  const face = (group: ListGroup<InstanceSummary, GroupKey>): GroupFace => {
    if (group.by === 'workspace') {
      const ws = workspaces.get(group.key)
      return {
        label: ws === undefined || ws.path === undefined ? t('hub.noWorkspace') : ws.name,
        tip: ws?.path,
        badge: ws?.here === true ? <span className={hub.tag}>{t('hub.here')}</span> : undefined,
      }
    }
    if (group.by === 'status') {
      const bucket = BUCKET_FACE[group.key as RunBucket]
      return {
        label: t(bucket.label),
        mark: <span className={cx(groupDot, css.groupTone)} data-run-status={bucket.tone} />,
      }
    }
    if (group.by === 'session') {
      const label = sessionLabel(group.key === '' ? undefined : group.key)
      return {
        label: label.text,
        badge: label.mine ? (
          <span className={hub.tag} data-tone="plain">
            {t('hub.thisSession')}
          </span>
        ) : undefined,
      }
    }
    return { label: group.key }
  }

  if (error !== null) return <Empty icon="alert" title={error} />
  if (items === null) {
    return <Skeleton label={t('hub.loading')} />
  }
  if (items.length === 0) {
    return <Empty icon="runs" title={t('hub.noRunsTitle')} text={t('hub.noRuns')} />
  }

  return (
    <div className={hub.wfPage}>
      <div className={hub.side}>
        <HubSearch
          t={t}
          value={query}
          placeholder={t('hub.search')}
          onChange={setQuery}
          filter={
            view.show === 'all'
              ? undefined
              : {
                  label: t(SHOW[view.show].label),
                  count: arranged.shown,
                  testId: 'wl-hub-run-showing',
                  onClear: () => onView({ show: 'all' }),
                }
          }
          view={
            <ViewMenu
              t={t}
              sections={menuSections(t, view, arranged.counts, onView)}
              testId="wl-hub-run-view"
            />
          }
        />
        <GroupedList
          label={t('hub.runs')}
          groups={arranged.groups}
          keyOf={(item) => item.id}
          selected={selectedId ?? ''}
          face={face}
          empty={t('hub.noMatch')}
          testId="wl-hub-run-group"
          row={(item, at) => (
            <RunItem
              t={t}
              item={item}
              flip={at.flip}
              selected={at.selected}
              note={noteOf(item)}
              sortedByTime={view.sort !== 'name'}
              onPick={() => setPicked(item.id)}
            />
          )}
        />
      </div>
      {selected === undefined ? (
        <Empty icon="search" title={t('hub.noMatch')}>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            onClick={() => setQuery('')}
          >
            {t('hub.clearSearch')}
          </button>
        </Empty>
      ) : (
        <RunDetail
          t={t}
          rpc={props.rpc}
          item={selected}
          workspace={workspaceOf(selected)}
          session={sessionLabel(selected.session)}
          tab={tab}
          onTab={setTab}
          canMove={session !== undefined && selected.session !== session}
          onView={(node) => props.onOpenRun(selected.id, node)}
          onMove={() => void runsRef.current.bind(selected.id).then(load)}
          onDelete={(withState) => void remove(selected, withState)}
          onSetStatus={(to, options) => void setStatus(selected, to, options)}
        />
      )}
    </div>
  )
}

function Empty(props: {
  icon: 'alert' | 'runs' | 'search'
  title: string
  text?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={hub.empty}>
      <span className={hub.emptyIcon}>
        <Icon name={props.icon} size={20} />
      </span>
      <p className={hub.emptyTitle}>{props.title}</p>
      {props.text !== undefined && <p className={hub.emptyText}>{props.text}</p>}
      {props.children}
    </div>
  )
}
