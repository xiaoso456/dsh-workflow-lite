/**
 * dsh-workflow-lite — 工作流中心「运行实例」页：和「工作流」页同一种两栏——左边工作区，右边选中那个工作区的实例。
 *
 * - 左栏：顶上一条搜索，下面是有实例的工作区（本工作区在最前，其余按最近建实例的时间）；
 *   每项一行名字、一行「几个实例 · 几个进行中」，悬停看完整路径。
 * - 右栏：工作区名字和路径，下面是它的实例（{@link HubRunRow}）；所有行共用一套列，
 *   状态小标宽窄不一、有没有「移到本会话」，进度条和按钮都上下对齐。
 * - 搜索跨所有工作区：左栏只留有命中的工作区，右栏只列命中的实例；选中的那个被筛掉了就换到第一个。
 *
 * 打开时拉一次全部会话的实例；移动、删除之后再拉一次。不跟着外面的重绘重拉——会话列表一有动静
 * （别的会话在输出）外面就会重绘，跟着重拉会让列表一直闪。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubRuns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstanceSummary, RunStatus } from '../../shared/runState.ts'
import type { SessionRow } from '../app/sessions.ts'
import type { Runs } from '../app/useRuns.ts'
import type { T } from '../i18n.ts'
import { groupRuns, type HubGroup, pickGroup } from '../model/hubRuns.ts'
import { errorCode, errorMessage } from '../rpc.ts'
import { HubRunRow } from './HubRunRow.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

export function HubRuns(props: {
  t: T
  session: string | undefined
  sessionRows: readonly SessionRow[]
  sessionsReady: boolean
  runs: Runs
  onOpenRun(id: string): void
  onNotice(text: string, tone?: 'info' | 'error'): void
}): React.JSX.Element {
  const { t, session, sessionRows } = props
  const [items, setItems] = useState<InstanceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** 点过的工作区（键）；没点过 = 排在最前的那个。 */
  const [picked, setPicked] = useState<string | null>(null)

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
  const titleOf = useCallback(
    (id: string | undefined) => (id === undefined ? undefined : titles.get(id)),
    [titles],
  )
  const hereCwd =
    sessionRows.find((row) => row.id === session)?.cwd ??
    items?.find((item) => session !== undefined && item.session === session)?.cwd
  const groups = useMemo(
    () => groupRuns(items ?? [], { query, hereCwd, titleOf }),
    [items, query, hereCwd, titleOf],
  )
  const selected = pickGroup(groups, picked)
  // 会话列表到了（「本工作区」是哪个已经定下来）就把默认选中的那个记成点过的：
  // 之后列表刷新、分组换了次序（删了、移了、模型改了状态），右栏不会自己跳到别的工作区。
  const selectedKey = selected?.workspace.key
  useEffect(() => {
    if (picked === null && props.sessionsReady && selectedKey !== undefined) setPicked(selectedKey)
  }, [picked, props.sessionsReady, selectedKey])

  const sessionLabel = (id: string | undefined): { text: string; mine: boolean } => {
    if (id === undefined) return { text: t('hub.noSession'), mine: false }
    const title = titles.get(id)
    if (id === session) return { text: title ?? t('hub.thisSession'), mine: true }
    if (title !== undefined) return { text: title, mine: false }
    return { text: props.sessionsReady ? t('hub.sessionGone') : t('hub.otherSession'), mine: false }
  }

  if (error !== null) return <Empty icon="alert" title={error} />
  if (items === null) {
    return (
      <div className={hub.loading}>
        <span className={hub.spinner} />
        {t('hub.loading')}
      </div>
    )
  }
  if (items.length === 0) {
    return <Empty icon="runs" title={t('hub.noRunsTitle')} text={t('hub.noRuns')} />
  }

  return (
    <div className={hub.wfPage}>
      <div className={hub.side}>
        <label className={hub.search}>
          <Icon name="search" size={14} />
          <input
            className={hub.searchInput}
            value={query}
            placeholder={t('hub.search')}
            aria-label={t('hub.search')}
            data-testid="wl-hub-search"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query !== '' && (
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('hub.clearSearch')}
              onClick={() => setQuery('')}
            >
              <Icon name="x" size={13} />
            </button>
          )}
        </label>
        <nav className={cx(hub.wfList, hub.sideList)} aria-label={t('hub.workspaces')}>
          {groups.length === 0 ? (
            <p className={hub.sideEmpty}>{t('hub.noMatch')}</p>
          ) : (
            groups.map((group) => (
              <WorkspaceItem
                key={group.workspace.key}
                t={t}
                group={group}
                selected={group === selected}
                onPick={() => setPicked(group.workspace.key)}
              />
            ))
          )}
        </nav>
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
        <WorkspaceRuns
          t={t}
          group={selected}
          session={session}
          sessionLabel={sessionLabel}
          onView={props.onOpenRun}
          onMove={(id) => void runsRef.current.bind(id).then(() => load())}
          onDelete={(id, withState) =>
            void runsRef.current.remove(id, withState).then(() => load())
          }
          onSetStatus={(item, to, options) => void setStatus(item, to, options)}
        />
      )}
    </div>
  )
}

/** 左栏一项：文件夹图标、名字（本工作区带小标）、「几个实例 · 几个进行中」；悬停名字看完整路径。 */
function WorkspaceItem(props: {
  t: T
  group: HubGroup
  selected: boolean
  onPick(): void
}): React.JSX.Element {
  const { t, group } = props
  const { workspace } = group
  return (
    <button
      type="button"
      aria-current={props.selected ? 'true' : undefined}
      className={hub.wfItem}
      data-testid="wl-hub-ws"
      data-path={workspace.path}
      onClick={props.onPick}
    >
      <span className={hub.wfIcon}>
        <Icon name="folder" size={15} />
      </span>
      <span className={hub.wfText}>
        <span className={hub.wsName}>
          {/* 完整路径挂在名字上：提示贴着名字、和它左边对齐着往右展开，不是整项下面、也不越出左栏。 */}
          <span
            className={hub.wfName}
            data-tip={workspace.path}
            data-tip-align="start"
            data-testid="wl-hub-ws-name"
          >
            {workspace.path === undefined ? t('hub.noWorkspace') : workspace.name}
          </span>
          {workspace.here && <span className={hub.tag}>{t('hub.here')}</span>}
        </span>
        <span className={hub.wfMeta}>
          {t('hub.runCount').replace('{n}', String(workspace.count))}
          {group.active > 0 && (
            <>
              {' · '}
              <span className={hub.wsActive}>
                {t('hub.active').replace('{n}', String(group.active))}
              </span>
            </>
          )}
        </span>
      </span>
    </button>
  )
}

/** 右栏：工作区名字和路径，下面是它的实例。 */
function WorkspaceRuns(props: {
  t: T
  group: HubGroup
  session: string | undefined
  sessionLabel(id: string | undefined): { text: string; mine: boolean }
  onView(id: string): void
  onMove(id: string): void
  onDelete(id: string, withState: boolean): void
  onSetStatus(
    item: InstanceSummary,
    to: RunStatus,
    options: { notify: boolean; note: string },
  ): void
}): React.JSX.Element {
  const { t, group, session } = props
  const { workspace } = group
  const canMove = (item: InstanceSummary): boolean =>
    session !== undefined && item.session !== session
  // 有能移的行，才给「移到本会话」留位置。
  const moveSlot = group.items.some(canMove)
  return (
    <div className={hub.wfDetail} data-testid="wl-hub-runs-of" data-path={workspace.path}>
      <div className={hub.wfHead}>
        <div className={hub.wfHeadText}>
          <p className={cx(hub.wfTitle, hub.wsTitle)}>
            <span className={hub.wfName}>
              {workspace.path === undefined ? t('hub.noWorkspace') : workspace.name}
            </span>
            {workspace.here && <span className={hub.tag}>{t('hub.here')}</span>}
          </p>
          {workspace.path !== undefined && (
            <p className={cx(hub.wfSub, hub.wsPath)} data-tip={workspace.path}>
              {workspace.path}
            </p>
          )}
        </div>
      </div>
      <div className={cx(hub.box, hub.runBox)} data-testid="wl-hub-list">
        {group.items.map((item) => (
          <HubRunRow
            key={item.id}
            t={t}
            item={item}
            session={props.sessionLabel(item.session)}
            canMove={canMove(item)}
            moveSlot={moveSlot}
            onView={() => props.onView(item.id)}
            onMove={() => props.onMove(item.id)}
            onDelete={(withState) => props.onDelete(item.id, withState)}
            onSetStatus={(to, options) => props.onSetStatus(item, to, options)}
          />
        ))}
      </div>
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
