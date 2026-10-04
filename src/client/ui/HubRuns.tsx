/**
 * dsh-workflow-lite — 工作流中心「运行实例」页：工具行（搜索、工作区、本会话 / 全部）+ 按工作区分组的列表。
 *
 * 打开时拉一次全部会话的实例；移动、删除之后再拉一次。不跟着外面的重绘重拉——会话列表一有动静
 * （别的会话在输出）外面就会重绘，跟着重拉会让列表一直闪。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubRuns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InstanceSummary } from '../../shared/runState.ts'
import type { SessionRow } from '../app/sessions.ts'
import type { Runs } from '../app/useRuns.ts'
import type { T } from '../i18n.ts'
import { groupRuns, type HubWorkspace, workspacesOf } from '../model/hubRuns.ts'
import { errorMessage } from '../rpc.ts'
import { HubRunRow } from './HubRunRow.tsx'
import { HubWorkspacePicker } from './HubWorkspacePicker.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { cx, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

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
  const [confirm, setConfirm] = useState<string | null>(null)

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
          groups.map((group) => (
            <section key={group.workspace.key} className={hub.group} data-testid="wl-hub-group">
              <GroupHead t={t} workspace={group.workspace} />
              <div className={hub.box}>
                {group.items.map((item) => (
                  <HubRunRow
                    key={item.id}
                    t={t}
                    item={item}
                    session={sessionLabel(item.session)}
                    canMove={session !== undefined && item.session !== session}
                    confirming={confirm === item.id}
                    onView={() => props.onOpenRun(item.id)}
                    onMove={() => void runsRef.current.bind(item.id).then(() => load())}
                    onAskDelete={() => setConfirm(item.id)}
                    onCancelDelete={() => setConfirm(null)}
                    onDelete={(withState) => {
                      setConfirm(null)
                      void runsRef.current.remove(item.id, withState).then(() => load())
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </>
  )
}

function GroupHead(props: { t: T; workspace: HubWorkspace }): React.JSX.Element {
  const { t, workspace } = props
  return (
    <div className={hub.groupHead}>
      <Icon name="folder" size={14} />
      <span className={hub.groupName}>
        {workspace.path === undefined ? t('hub.noWorkspace') : workspace.name}
      </span>
      {workspace.here && <span className={hub.tag}>{t('hub.here')}</span>}
      {workspace.path !== undefined && (
        <span className={hub.groupPath} title={workspace.path}>
          {workspace.path}
        </span>
      )}
      <span className={ui.grow} />
      <span className={hub.count}>{t('hub.count').replace('{n}', String(workspace.count))}</span>
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
