/**
 * dsh-workflow-lite — 一列版本：上面「说明 + 存为版本」，下面版本列表（新的在前）。
 *
 * 工作流的版本（{@link VersionList}）与记忆的版本（{@link MemoryVersionList}）同一个样子（{@link VersionShell}）。
 * 编辑页的「版本」对话框与工作流中心共用。存的、比的都是磁盘上那份
 * （编辑页正开着这张时先把改动写下去，见 {@link useVersions}）。
 * 现在的内容和某个版本一样时，存的按钮按住，旁边说「现在的内容就是 v3」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/VersionList
 */

import { useState } from 'react'
import type { MemoryVersionEntry } from '../../shared/memoryLib.ts'
import type { Desktop } from '../app/desktop.ts'
import type { MemoryStore } from '../app/memories.ts'
import { useMemoryVersions } from '../app/useMemoryVersions.ts'
import { useVersions, type VersionNotice } from '../app/useVersions.ts'
import type { T } from '../i18n.ts'
import { formatBytes } from '../model/fileKind.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { Icon } from './Icon.tsx'
import { Checkbox, useResizeFlip } from './motion.tsx'
import { cx } from './primitives.tsx'
import { FolderDialog } from './RunItemDialog.tsx'
import ui from './ui.module.css'
import { DiffView, type RowEntry, VersionRow } from './VersionRow.tsx'
import v from './versions.module.css'

/** 工作流的版本。`memories` 给了（这张引用的记忆条数）就在存的那一栏挂「连同记忆一起存」。 */
export function VersionList(props: {
  t: T
  rpc: WorkflowLiteRpc
  name: string
  before?: () => Promise<boolean>
  onRestored?: () => void
  onChanged?: () => void
  /** 这张引用了几条（库里有的）记忆；0 或不给就不挂勾选。 */
  memories?: number
  onMemoriesSaved?: () => void
}): React.JSX.Element {
  const { t } = props
  const versions = useVersions(props)
  const [withMemories, setWithMemories] = useState(true)
  const count = props.memories ?? 0
  return (
    <VersionShell
      t={t}
      list={versions.list}
      busy={versions.busy}
      notice={versions.notice}
      onSave={(note) => versions.save(note, count > 0 && withMemories)}
      // 「连同记忆」勾着时，工作流本身没变也能存（记忆可能变了）：主机那边同样的工作流照样记一版。
      saveAnyway={count > 0 && withMemories}
      extra={
        count > 0 && (
          <label className={v.withMem} data-tip={t('ver.withMemTip')}>
            <Checkbox
              checked={withMemories}
              data-testid="wl-ver-with-memories"
              onChange={(event) => setWithMemories(event.currentTarget.checked)}
            />
            <Icon name="memory" size={13} />
            {t('ver.withMem').replace('{n}', String(count))}
          </label>
        )
      }
      row={(entry, currentN) => (
        <VersionRow
          key={entry.n}
          t={t}
          entry={entry}
          versions={versions}
          currentN={currentN}
          meta={t('ver.steps').replace('{n}', String(entry.nodeCount))}
          detail={<DiffView t={t} entry={entry} versions={versions} />}
        />
      )}
    />
  )
}

/** 一条记忆的版本：点一行看那一版的文件。 */
export function MemoryVersionList(props: {
  t: T
  rpc: WorkflowLiteRpc
  store: MemoryStore
  id: string
  desktop: Desktop | undefined
}): React.JSX.Element {
  const { t, store } = props
  const versions = useMemoryVersions({ ...props, onChanged: () => void store.refresh() })
  const [viewing, setViewing] = useState<MemoryVersionEntry | null>(null)
  return (
    <>
      <VersionShell
        t={t}
        testId="wl-memver"
        list={versions.list}
        busy={versions.busy}
        notice={versions.notice}
        onSave={versions.save}
        empty={t('ver.memEmptyText')}
        row={(entry, currentN) => (
          <VersionRow
            key={entry.n}
            t={t}
            entry={entry}
            versions={versions}
            currentN={currentN}
            meta={`${t('mem.files').replace('{n}', String(entry.files))} · ${formatBytes(entry.bytes)}`}
            onView={() => setViewing(entry)}
            restoreNote={t('ver.memRestoreNote')}
            testPrefix="wl-memver"
          />
        )}
      />
      {viewing !== null && (
        <FolderDialog
          t={t}
          source={store.source(props.id, viewing.n)}
          item={{ kind: 'folder', value: `${props.id} · v${viewing.n}` }}
          desktop={props.desktop}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  )
}

/** 一列版本的样子：存的那一栏、状态、空白提示、版本行。 */
function VersionShell<E extends RowEntry>(props: {
  t: T
  /** 测试钩子前缀（缺省 `wl-ver`）。 */
  testId?: string
  list: E[] | null
  busy: boolean
  notice: VersionNotice | null
  onSave(note: string): Promise<boolean>
  /** 和某一版一样也让存（工作流连同记忆一起存时）。 */
  saveAnyway?: boolean
  /** 存的按钮左边挂的东西。 */
  extra?: React.ReactNode
  /** 空的时候下面那句（缺省说工作流的）。 */
  empty?: string
  row(entry: E, currentN: number | null): React.ReactNode
}): React.JSX.Element {
  const { t, list, notice } = props
  const id = props.testId ?? 'wl-ver'
  const [note, setNote] = useState('')
  const current = list?.find((entry) => entry.current) ?? null
  const blocked = list === null || props.busy || (current !== null && props.saveAnyway !== true)
  // 某一行展开、收起，存了新版、删了一版：下面的行滑到新位置，不是一下跳过去。
  const listRef = useResizeFlip()

  const save = (): void => {
    if (blocked) return
    void props.onSave(note).then((ok) => {
      if (ok) setNote('')
    })
  }

  return (
    <div className={v.root} data-testid={id === 'wl-ver' ? 'wl-versions' : id}>
      <div className={v.saveBar}>
        <input
          className={cx(ui.input, v.saveInput)}
          value={note}
          maxLength={500}
          placeholder={t('ver.notePlaceholder')}
          aria-label={t('ver.notePlaceholder')}
          data-testid={`${id}-note`}
          onChange={(event) => setNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
        />
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          disabled={blocked}
          data-testid={`${id}-save`}
          onClick={save}
        >
          <Icon name="bookmark" size={14} />
          {t('ver.save')}
        </button>
      </div>
      <div className={v.status}>
        {list !== null && (
          <span className={v.state} data-saved={current !== null} data-testid={`${id}-state`}>
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
            data-testid={`${id}-notice`}
          >
            <Icon name={notice.tone === 'ok' ? 'check' : 'alert'} size={13} />
            {notice.text}
          </span>
        )}
        {props.extra}
      </div>

      {list !== null && list.length === 0 && (
        <div className={v.empty}>
          <span className={v.emptyIcon}>
            <Icon name="history" size={20} />
          </span>
          <p className={v.emptyTitle}>{t('ver.empty')}</p>
          <p className={v.emptyText}>{props.empty ?? t('ver.emptyText')}</p>
        </div>
      )}
      {list !== null && list.length > 0 && (
        <div ref={listRef} className={v.list}>
          {list.map((entry) => props.row(entry, current?.n ?? null))}
        </div>
      )}
    </div>
  )
}
