/**
 * dsh-workflow-lite — 一个工作流的版本：上面「说明 + 存为版本」，下面版本列表（新的在前）。
 *
 * 编辑页的「版本」对话框与工作流中心的「工作流」页共用。存的、比的都是磁盘上那份
 * （编辑页正开着这张时先把改动写下去，见 {@link useVersions}）。
 * 现在的内容和某个版本一样时，存的按钮按住，旁边说「现在的内容就是 v3」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/VersionList
 */

import { useState } from 'react'
import { useVersions } from '../app/useVersions.ts'
import type { T } from '../i18n.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'
import { VersionRow } from './VersionRow.tsx'
import v from './versions.module.css'

export function VersionList(props: {
  t: T
  rpc: WorkflowLiteRpc
  name: string
  before?: () => Promise<boolean>
  onRestored?: () => void
  onChanged?: () => void
}): React.JSX.Element {
  const { t } = props
  const versions = useVersions(props)
  const [note, setNote] = useState('')
  const { list, notice } = versions
  const current = list?.find((entry) => entry.current) ?? null
  const blocked = list === null || versions.busy || current !== null

  const save = (): void => {
    if (blocked) return
    void versions.save(note).then((ok) => {
      if (ok) setNote('')
    })
  }

  return (
    <div className={v.root} data-testid="wl-versions">
      <div className={v.saveBar}>
        <input
          className={cx(ui.input, v.saveInput)}
          value={note}
          maxLength={500}
          placeholder={t('ver.notePlaceholder')}
          aria-label={t('ver.notePlaceholder')}
          data-testid="wl-ver-note"
          onChange={(event) => setNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
        />
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          disabled={blocked}
          data-testid="wl-ver-save"
          onClick={save}
        >
          <Icon name="bookmark" size={14} />
          {t('ver.save')}
        </button>
      </div>
      <div className={v.status}>
        {list !== null && (
          <span className={v.state} data-saved={current !== null} data-testid="wl-ver-state">
            <span className={v.stateDot} />
            {current === null
              ? t('ver.unsaved')
              : t('ver.sameAs').replace('{n}', String(current.n))}
          </span>
        )}
        {notice !== null && (
          <span
            key={notice.seq}
            className={cx(v.notice, ui.fade)}
            data-tone={notice.tone}
            role="status"
            data-testid="wl-ver-notice"
          >
            <Icon name={notice.tone === 'ok' ? 'check' : 'alert'} size={13} />
            {notice.text}
          </span>
        )}
      </div>

      {list !== null && list.length === 0 && (
        <div className={v.empty}>
          <span className={v.emptyIcon}>
            <Icon name="history" size={20} />
          </span>
          <p className={v.emptyTitle}>{t('ver.empty')}</p>
          <p className={v.emptyText}>{t('ver.emptyText')}</p>
        </div>
      )}
      {list !== null && list.length > 0 && (
        <div className={v.list}>
          {list.map((entry) => (
            <VersionRow
              key={entry.n}
              t={t}
              entry={entry}
              versions={versions}
              currentN={current?.n ?? null}
            />
          ))}
        </div>
      )}
    </div>
  )
}
