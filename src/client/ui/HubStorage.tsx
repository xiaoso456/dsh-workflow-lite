/**
 * dsh-workflow-lite — 工作流中心「存储」页：数据目录在哪、里面各样东西占多少，能清的两样（已结束的实例、
 * 旧版本遗留文件）就地清。
 *
 * - 打开时统计一次，之后只在清理时重算——不跟着外面的重绘重拉（外面重绘很频繁，跟着拉会让按钮一直闪）。
 * - 清理已结束的实例要再点一次确认；旧版本遗留文件没人用，点一下就删，删完这一行就不显示了。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubStorage
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { StorageStats } from '../../shared/wire.ts'
import type { T } from '../i18n.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import hub from './hub.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { copyText, cx } from './primitives.tsx'
import ui from './ui.module.css'

type Action = 'stats' | 'clearDispatch' | 'clearFinished'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function HubStorage(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 清掉了实例记录：让外面的实例列表跟上。 */
  onChanged(): void
}): React.JSX.Element {
  const { t } = props
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [busy, setBusy] = useState<Action | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirmFinished, setConfirmFinished] = useState(false)
  const [copied, setCopied] = useState(false)

  const outer = useRef(props)
  outer.current = props
  const act = useCallback(async (action: Action): Promise<void> => {
    const { rpc, t: tr, onChanged } = outer.current
    setBusy(action)
    try {
      const result = await rpc.call('run/storage', { action })
      setStats(result)
      if (result.cleared !== undefined) {
        const key = action === 'clearFinished' ? 'hub.clearedFinished' : 'hub.clearedLegacy'
        setNotice({ tone: 'ok', text: tr(key).replace('{n}', String(result.cleared)) })
        if (action === 'clearFinished') onChanged()
      }
    } catch (caught) {
      setNotice({ tone: 'error', text: errorMessage(caught) })
    } finally {
      setBusy(null)
    }
  }, [])
  useEffect(() => {
    void act('stats')
  }, [act])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (stats === null) {
    return (
      <div className={hub.page}>
        {notice !== null ? (
          <Notice notice={notice} />
        ) : (
          <div className={hub.loading}>
            <span className={hub.spinner} />
            {t('hub.loading')}
          </div>
        )}
      </div>
    )
  }

  const count = (n: number): string => t('hub.count').replace('{n}', String(n))
  return (
    <div className={hub.page} data-testid="wl-hub-stats">
      {notice !== null && <Notice notice={notice} />}

      <section className={hub.section}>
        <h3 className={hub.sectionTitle}>{t('hub.dataDir')}</h3>
        <div className={hub.box}>
          <div className={hub.item}>
            <ItemIcon name="folder" tone="accent" />
            <div className={hub.itemText}>
              <code className={hub.path} data-testid="wl-hub-data-dir">
                {stats.dataDir}
              </code>
              <span className={hub.itemDesc}>{t('hub.dataDirDesc')}</span>
            </div>
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.soft)}
              onClick={() => void copyText(stats.dataDir).then((ok) => setCopied(ok))}
            >
              <Icon name={copied ? 'check' : 'copy'} size={14} />
              {copied ? t('common.copied') : t('hub.copyPath')}
            </button>
          </div>
        </div>
      </section>

      <section className={hub.section}>
        <h3 className={hub.sectionTitle}>{t('hub.usage')}</h3>
        <div className={hub.box}>
          <Item
            icon="library"
            title={t('hub.workflows')}
            value={`${count(stats.workflows)} · ${formatBytes(stats.workflowBytes)}`}
          />
          <Item
            icon="bookmark"
            title={t('hub.templates')}
            value={`${count(stats.templates)} · ${formatBytes(stats.templateBytes)}`}
          />
          <Item
            icon="runs"
            title={t('hub.instances')}
            value={[
              count(stats.instances),
              ...(stats.finished > 0
                ? [t('hub.finished').replace('{n}', String(stats.finished))]
                : []),
              formatBytes(stats.instanceBytes),
            ].join(' · ')}
            desc={t('hub.instancesDesc')}
            testId="wl-hub-instances"
          >
            {confirmFinished && stats.finished > 0 ? (
              <>
                <button
                  type="button"
                  className={cx(ui.btn, ui.small)}
                  onClick={() => setConfirmFinished(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className={cx(ui.btn, ui.small, ui.dangerSolid)}
                  disabled={busy !== null}
                  data-testid="wl-hub-clear-finished-confirm"
                  onClick={() => {
                    setConfirmFinished(false)
                    void act('clearFinished')
                  }}
                >
                  {t('hub.clearFinishedConfirm').replace('{n}', String(stats.finished))}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.soft)}
                disabled={busy !== null || stats.finished === 0}
                data-tip={t('hub.clearFinishedHint')}
                data-testid="wl-hub-clear-finished"
                onClick={() => setConfirmFinished(true)}
              >
                {t('hub.clearFinished')}
              </button>
            )}
          </Item>
          {stats.dispatchFiles > 0 && (
            <Item
              icon="file"
              tone="warn"
              title={t('hub.legacy')}
              value={`${t('hub.files').replace('{n}', String(stats.dispatchFiles))} · ${formatBytes(stats.dispatchBytes)}`}
              desc={t('hub.legacyDesc')}
              testId="wl-hub-legacy"
            >
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.soft)}
                disabled={busy !== null}
                data-testid="wl-hub-clear-dispatch"
                onClick={() => void act('clearDispatch')}
              >
                <Icon name="trash" size={14} />
                {t('hub.clearLegacy')}
              </button>
            </Item>
          )}
        </div>
      </section>
    </div>
  )
}

function ItemIcon(props: { name: IconName; tone?: 'accent' | 'warn' }): React.JSX.Element {
  return (
    <span className={hub.itemIcon} data-tone={props.tone}>
      <Icon name={props.name} size={16} />
    </span>
  )
}

function Item(props: {
  icon: IconName
  tone?: 'accent' | 'warn'
  title: string
  value: string
  desc?: string
  testId?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={hub.item} data-testid={props.testId}>
      <ItemIcon name={props.icon} {...(props.tone === undefined ? {} : { tone: props.tone })} />
      <div className={hub.itemText}>
        <span className={hub.itemTitle}>
          {props.title}
          <span className={hub.itemValue}>{props.value}</span>
        </span>
        {props.desc !== undefined && <span className={hub.itemDesc}>{props.desc}</span>}
      </div>
      <div className={hub.itemEnd}>{props.children}</div>
    </div>
  )
}

function Notice(props: { notice: { tone: 'ok' | 'error'; text: string } }): React.JSX.Element {
  return (
    <div className={cx(hub.notice, ui.rise)} data-tone={props.notice.tone} role="status">
      <Icon name={props.notice.tone === 'ok' ? 'check' : 'alert'} size={14} />
      {props.notice.text}
    </div>
  )
}
