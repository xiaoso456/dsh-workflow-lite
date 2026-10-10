/**
 * dsh-workflow-lite — 工作流中心「运行实例」页：工具行（搜索、工作区、本会话 / 全部）+ 按工作区分组的列表。
 *
 * 打开时拉一次全部会话的实例；移动、删除之后再拉一次。不跟着外面的重绘重拉——会话列表一有动静
 * （别的会话在输出）外面就会重绘，跟着重拉会让列表一直闪。
 *
 * 分组能折叠：没人动过时只展开本工作区（见 `groupOpenByDefault`）；手动展开 / 折叠记在浏览器里。
 * 筛选时搜到的组全展开，这时的开合只管这一次筛选，不记。
 * 所有行共用一套列（subgrid），状态小标宽窄不一、有没有「移到本会话」，进度条和按钮都对得齐。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubRuns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstanceSummary } from '../../shared/runState.ts'
import type { SessionRow } from '../app/sessions.ts'
import type { Runs } from '../app/useRuns.ts'
import type { T } from '../i18n.ts'
import { groupOpenByDefault, groupRuns, type HubWorkspace, workspacesOf } from '../model/hubRuns.ts'
import { errorMessage } from '../rpc.ts'
import { HubRunRow } from './HubRunRow.tsx'
import { HubWorkspacePicker } from './HubWorkspacePicker.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { cx, Segmented } from './primitives.tsx'
import run from './run.module.css'
import ui from './ui.module.css'

/** 手动开合过的组：工作区键 → 展开没有。 */
type Expanded = Record<string, boolean>

const EXPANDED_KEY = 'workflow-lite.hub.expanded'

function readExpanded(): Expanded {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(EXPANDED_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    )
  } catch {
    // 读不懂或读不了：按默认开合。开合是便利不是事实，不该为它让列表打不开。
    return {}
  }
}

function writeExpanded(expanded: Expanded): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded))
  } catch {
    // 偏好持久化是尽力而为。
  }
}

export function HubRuns(props: {
  t: T
  session: string | undefined
  sessionRows: readonly SessionRow[]
  sessionsReady: boolean
  runs: Runs
  onOpenRun(id: string): void
}): React.JSX.Element {
  const { t, session, sessionRows } = props
  const [items, setItems] = useState<InstanceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [workspace, setWorkspace] = useState('all')
  const [scope, setScope] = useState<'mine' | 'all'>('all')

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
  const workspaces = useMemo(() => workspacesOf(items ?? [], hereCwd), [items, hereCwd])
  // 选中的工作区里的实例都删光了：退回全部。
  const picked = workspaces.some((item) => item.key === workspace) ? workspace : 'all'
  const groups = useMemo(
    () =>
      groupRuns(items ?? [], {
        workspace: picked,
        mine: scope === 'mine',
        query,
        session,
        hereCwd,
        titleOf,
      }),
    [items, picked, scope, query, session, hereCwd, titleOf],
  )
  const filtered = query.trim() !== '' || picked !== 'all' || scope === 'mine'

  const [saved, setSaved] = useState(readExpanded)
  useEffect(() => writeExpanded(saved), [saved])
  // 筛选时的开合只跟着这一次筛选：条件一变就回到全展开。
  const filterKey = JSON.stringify([query.trim(), picked, scope])
  const [searchOpen, setSearchOpen] = useState<{ filter: string; open: Expanded }>({
    filter: '',
    open: {},
  })
  const choices = filtered ? (searchOpen.filter === filterKey ? searchOpen.open : {}) : saved
  const isOpen = (workspace: HubWorkspace): boolean =>
    choices[workspace.key] ?? groupOpenByDefault(workspace, groups.length, filtered)
  // 用函数式更新：连着点几个组时，每一下都在上一下的结果上改。
  const toggle = (workspace: HubWorkspace): void => {
    const fallback = groupOpenByDefault(workspace, groups.length, filtered)
    const flip = (open: Expanded): Expanded => ({
      ...open,
      [workspace.key]: !(open[workspace.key] ?? fallback),
    })
    if (filtered) {
      setSearchOpen((prev) => ({
        filter: filterKey,
        open: flip(prev.filter === filterKey ? prev.open : {}),
      }))
      return
    }
    setSaved(flip)
  }

  const canMove = (item: InstanceSummary): boolean =>
    session !== undefined && item.session !== session
  // 展开着的行里有能移的，才给「移到本会话」留位置。
  const moveSlot = groups.some((group) => isOpen(group.workspace) && group.items.some(canMove))

  const sessionLabel = (id: string | undefined): { text: string; mine: boolean } => {
    if (id === undefined) return { text: t('hub.noSession'), mine: false }
    const title = titles.get(id)
    if (id === session) return { text: title ?? t('hub.thisSession'), mine: true }
    if (title !== undefined) return { text: title, mine: false }
    return { text: props.sessionsReady ? t('hub.sessionGone') : t('hub.otherSession'), mine: false }
  }

  return (
    <>
      <div className={hub.toolbar}>
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
        <HubWorkspacePicker
          t={t}
          workspaces={workspaces}
          total={items?.length ?? 0}
          value={picked}
          onChange={setWorkspace}
        />
        <div className={hub.scope}>
          <Segmented<'mine' | 'all'>
            label={t('hub.scope')}
            value={scope}
            onChange={setScope}
            testId="wl-hub-scope"
            options={[
              { value: 'mine', label: t('hub.mine') },
              { value: 'all', label: t('hub.all') },
            ]}
          />
        </div>
      </div>
      <div className={hub.scroll} data-testid="wl-hub-list">
        {error !== null ? (
          <Empty icon="alert" title={error} />
        ) : items === null ? (
          <div className={hub.loading}>
            <span className={hub.spinner} />
            {t('hub.loading')}
          </div>
        ) : items.length === 0 ? (
          <Empty icon="runs" title={t('hub.noRunsTitle')} text={t('hub.noRuns')} />
        ) : groups.length === 0 ? (
          <Empty icon="search" title={t('hub.noMatch')}>
            {filtered && (
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.soft)}
                onClick={() => {
                  setQuery('')
                  setWorkspace('all')
                  setScope('all')
                }}
              >
                {t('hub.resetFilter')}
              </button>
            )}
          </Empty>
        ) : (
          <div className={hub.runGrid}>
            {groups.map((group) => {
              const open = isOpen(group.workspace)
              return (
                <section
                  key={group.workspace.key}
                  className={hub.group}
                  data-testid="wl-hub-group"
                  data-path={group.workspace.path}
                >
                  <GroupHead
                    t={t}
                    workspace={group.workspace}
                    items={group.items}
                    open={open}
                    onToggle={() => toggle(group.workspace)}
                  />
                  {open && (
                    <div className={cx(hub.box, hub.runBox)}>
                      {group.items.map((item) => (
                        <HubRunRow
                          key={item.id}
                          t={t}
                          item={item}
                          session={sessionLabel(item.session)}
                          canMove={canMove(item)}
                          moveSlot={moveSlot}
                          onView={() => props.onOpenRun(item.id)}
                          onMove={() => void runsRef.current.bind(item.id).then(() => load())}
                          onDelete={(withState) => {
                            void runsRef.current.remove(item.id, withState).then(() => load())
                          }}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

/** 组头：整条能点，开合这一组；折起来时数一下还在跑的，免得进行中的实例藏在里面看不见。 */
function GroupHead(props: {
  t: T
  workspace: HubWorkspace
  items: readonly InstanceSummary[]
  open: boolean
  onToggle(): void
}): React.JSX.Element {
  const { t, workspace } = props
  const active = props.open
    ? 0
    : props.items.filter((item) => item.status === 'running' || item.status === 'waiting').length
  return (
    <button
      type="button"
      className={hub.groupHead}
      aria-expanded={props.open}
      aria-label={`${props.open ? t('hub.collapse') : t('hub.expand')} ${workspace.path ?? t('hub.noWorkspace')}`}
      data-testid="wl-hub-group-toggle"
      onClick={props.onToggle}
    >
      <span className={hub.chevron}>
        <Icon name="chevronRight" size={13} />
      </span>
      <Icon name="folder" size={14} />
      <span className={hub.groupName}>
        {workspace.path === undefined ? t('hub.noWorkspace') : workspace.name}
      </span>
      {workspace.here && <span className={hub.tag}>{t('hub.here')}</span>}
      {workspace.path !== undefined && (
        <span className={hub.groupPath} data-tip={workspace.path}>
          {workspace.path}
        </span>
      )}
      <span className={ui.grow} />
      {active > 0 && (
        <span className={run.status} data-run-status="running">
          <span className={run.dot} />
          {t('hub.active').replace('{n}', String(active))}
        </span>
      )}
      <span className={hub.count}>{t('hub.count').replace('{n}', String(workspace.count))}</span>
    </button>
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
