/**
 * dsh-workflow-lite — 工作流中心：放所有**跨工作流、跨会话**的东西。
 *
 * 左边是菜单，右边是内容：
 * - **运行实例**：所有会话的实例，可以查看、移到本会话、删除记录（状态文件另外问要不要一起删）；
 * - **存储**：数据目录、实例数、派发缓存占用，清理派发缓存与已结束的实例。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubDialog
 */

import { useCallback, useEffect, useState } from 'react'
import type { InstanceSummary } from '../../shared/runState.ts'
import type { StorageStats } from '../../shared/wire.ts'
import type { Runs } from '../app/useRuns.ts'
import type { T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { Icon, type IconName } from './Icon.tsx'
import { cx, Modal, Segmented } from './primitives.tsx'
import { RunStatusBadge } from './RunTopBar.tsx'
import run from './run.module.css'
import ui from './ui.module.css'

type HubPage = 'runs' | 'storage'

const PAGES: readonly { id: HubPage; icon: IconName; label: 'hub.runs' | 'hub.storage' }[] = [
  { id: 'runs', icon: 'runs', label: 'hub.runs' },
  { id: 'storage', icon: 'storage', label: 'hub.storage' },
]

export function HubDialog(props: {
  t: T
  rpc: WorkflowLiteRpc
  session: string | undefined
  runs: Runs
  onOpenRun(id: string): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const [page, setPage] = useState<HubPage>('runs')
  return (
    <Modal label={t('hub.title')} onDismiss={props.onClose} className={run.hub} testId="wl-hub">
      <nav className={run.hubNav} aria-label={t('hub.title')}>
        <p className={run.hubTitle}>{t('hub.title')}</p>
        {PAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={ui.menuItem}
            data-active={page === item.id}
            aria-current={page === item.id ? 'page' : undefined}
            data-testid={`wl-hub-${item.id}`}
            onClick={() => setPage(item.id)}
          >
            <Icon name={item.icon} size={15} />
            <span className={ui.menuLabel}>{t(item.label)}</span>
          </button>
        ))}
      </nav>
      <div className={run.hubBody}>
        {page === 'runs' ? (
          <RunsPage {...props} />
        ) : (
          <StoragePage t={t} rpc={props.rpc} onChanged={() => void props.runs.refresh()} />
        )}
      </div>
    </Modal>
  )
}

function RunsPage(props: {
  t: T
  session: string | undefined
  runs: Runs
  onOpenRun(id: string): void
  onClose(): void
}): React.JSX.Element {
  const { t, runs } = props
  const [scope, setScope] = useState<'mine' | 'all'>('all')
  const [items, setItems] = useState<InstanceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [withState, setWithState] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setItems(await runs.all())
      setError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [runs])

  useEffect(() => {
    void load()
  }, [load])

  const shown = (items ?? []).filter(
    (item) => scope === 'all' || (props.session !== undefined && item.session === props.session),
  )
  return (
    <>
      <div className={run.hubHead}>
        <span className={run.hubHeadTitle}>{t('hub.runs')}</span>
        <Segmented<'mine' | 'all'>
          label={t('hub.scope')}
          value={scope}
          onChange={setScope}
          options={[
            { value: 'mine', label: t('hub.mine') },
            { value: 'all', label: t('hub.all') },
          ]}
        />
      </div>
      <div className={run.hubList} data-testid="wl-hub-list">
        {error !== null && <p className={run.hubEmpty}>{error}</p>}
        {items !== null && shown.length === 0 && <p className={run.hubEmpty}>{t('hub.noRuns')}</p>}
        {shown.map((item) => {
          const mine = props.session !== undefined && item.session === props.session
          return (
            <div key={item.id} className={run.hubRow} data-testid="wl-hub-row" data-id={item.id}>
              <div className={run.rowMain}>
                <span className={run.rowTitle}>
                  {item.workflow}
                  {item.current && <span className={run.current}> · {t('run.current')}</span>}
                </span>
                <span className={run.rowMeta}>
                  {shortTime(item.createdAt)}
                  {item.total !== undefined && ` · ${item.done}/${item.total}`}
                  {' · '}
                  {mine ? t('hub.thisSession') : t('hub.otherSession')}
                  {item.cwd !== undefined && ` · ${item.cwd}`}
                </span>
              </div>
              <RunStatusBadge
                t={t}
                status={item.status}
                problem={item.stateProblem}
                untracked={item.statePath === undefined}
              />
              <div className={run.hubActions}>
                <button
                  type="button"
                  className={cx(ui.btn, ui.small)}
                  data-testid="wl-hub-view"
                  onClick={() => {
                    props.onOpenRun(item.id)
                    props.onClose()
                  }}
                >
                  {t('hub.view')}
                </button>
                {!mine && props.session !== undefined && (
                  <button
                    type="button"
                    className={cx(ui.btn, ui.small)}
                    title={t('hub.moveHint')}
                    data-testid="wl-hub-move"
                    onClick={() => void runs.bind(item.id).then(() => load())}
                  >
                    {t('hub.move')}
                  </button>
                )}
                <button
                  type="button"
                  className={cx(ui.btn, ui.icon, ui.small)}
                  aria-label={t('common.delete')}
                  data-testid="wl-hub-delete"
                  onClick={() => {
                    setWithState(false)
                    setConfirm(item.id)
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {confirm === item.id && (
                <div className={cx(run.hubConfirm, ui.rise)}>
                  <span>{t('hub.deleteConfirm')}</span>
                  {item.statePath !== undefined && (
                    <label>
                      <input
                        type="checkbox"
                        checked={withState}
                        onChange={(event) => setWithState(event.currentTarget.checked)}
                      />
                      {t('hub.deleteState')}
                    </label>
                  )}
                  <span className={ui.grow} />
                  <button
                    type="button"
                    className={cx(ui.btn, ui.small)}
                    onClick={() => setConfirm(null)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className={cx(ui.btn, ui.small, ui.dangerSolid)}
                    data-testid="wl-hub-delete-confirm"
                    onClick={() => {
                      setConfirm(null)
                      void runs.remove(item.id, withState).then(() => load())
                    }}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StoragePage(props: { t: T; rpc: WorkflowLiteRpc; onChanged(): void }): React.JSX.Element {
  const { t, rpc } = props
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const act = useCallback(
    async (action: 'stats' | 'clearDispatch' | 'clearFinished'): Promise<void> => {
      setBusy(true)
      try {
        const result = await rpc.call('run/storage', { action })
        setStats(result)
        if (result.cleared !== undefined) {
          setNote(t('hub.cleared').replace('{n}', String(result.cleared)))
          props.onChanged()
        }
      } catch (caught) {
        setNote(errorMessage(caught))
      } finally {
        setBusy(false)
      }
    },
    [rpc, t, props.onChanged],
  )

  useEffect(() => {
    void act('stats')
  }, [act])

  return (
    <>
      <div className={run.hubHead}>
        <span className={run.hubHeadTitle}>{t('hub.storage')}</span>
        {note !== null && <span className={run.progress}>{note}</span>}
      </div>
      {stats !== null && (
        <dl className={run.stats} data-testid="wl-hub-stats">
          <dt>{t('hub.dataDir')}</dt>
          <dd style={{ gridColumn: '2 / 4' }}>
            <code>{stats.dataDir}</code>
          </dd>
          <dt>{t('hub.instances')}</dt>
          <dd>
            {stats.instances}
            {stats.finished > 0 && ` · ${t('hub.finished').replace('{n}', String(stats.finished))}`}
          </dd>
          <dd>
            <button
              type="button"
              className={cx(ui.btn, ui.small)}
              disabled={busy || stats.finished === 0}
              title={t('hub.clearFinishedHint')}
              data-testid="wl-hub-clear-finished"
              onClick={() => void act('clearFinished')}
            >
              {t('hub.clearFinished')}
            </button>
          </dd>
          <dt>{t('hub.dispatch')}</dt>
          <dd>
            {stats.dispatchFiles} · {formatBytes(stats.dispatchBytes)}
          </dd>
          <dd>
            <button
              type="button"
              className={cx(ui.btn, ui.small)}
              disabled={busy || stats.dispatchFiles === 0}
              title={t('hub.clearDispatchHint')}
              data-testid="wl-hub-clear-dispatch"
              onClick={() => void act('clearDispatch')}
            >
              {t('hub.clearDispatch')}
            </button>
          </dd>
        </dl>
      )}
    </>
  )
}
