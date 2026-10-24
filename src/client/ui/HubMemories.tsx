/**
 * dsh-workflow-lite — 工作流中心「记忆」页：左边记忆库里的每一条，右边选中那条的名称、描述、在用的工作流和版本。
 *
 * 和「工作流」页同一个两栏样子。记忆在编辑页里加（给步骤开记忆、加工作流记忆时选已有的或新建），
 * 这一页管已有的：改名称和描述、看文件、存版本 / 切版本、删掉。
 * 删除的确认卡挂在那一行的删除按钮上，说清有几个工作流在用、几个版本一起删。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubMemories
 */

import { useEffect, useRef, useState } from 'react'
import { type MemoryEntry, memoryTitle } from '../../shared/memoryLib.ts'
import { idKey } from '../../shared/model.ts'
import type { Desktop } from '../app/desktop.ts'
import { type MemoryStore, useMemories } from '../app/memories.ts'
import type { T } from '../i18n.ts'
import { formatBytes } from '../model/fileKind.ts'
import { shortTime } from '../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { useConfirm } from './Confirm.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import ins from './inspector.module.css'
import mem from './memory.module.css'
import { ListThumb, useFlip } from './motion.tsx'
import { cx } from './primitives.tsx'
import { memoryTypeText } from './ResourcePresets.tsx'
import { FolderDialog } from './RunItemDialog.tsx'
import { Skeleton } from './Skeleton.tsx'
import ui from './ui.module.css'
import { MemoryVersionList } from './VersionList.tsx'

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
  // 一进这一页重读一遍：在用的工作流、大小可能刚变。
  useEffect(() => {
    void store.refresh()
  }, [store])

  if (entries === null) {
    return error === null ? <Skeleton label={t('hub.loading')} /> : <Empty t={t} text={error} />
  }
  if (entries.length === 0)
    return <Empty t={t} text={t('hub.memEmpty')} hint={t('hub.memEmptyHint')} />

  const list = [...entries].sort((a, b) => b.updatedAt - a.updatedAt)
  const selected =
    list.find((entry) => picked !== null && idKey(entry.id) === idKey(picked)) ?? list[0]
  if (selected === undefined) return <div />
  return (
    <div className={hub.wfPage}>
      <div className={hub.side}>
        <MemoryList
          t={t}
          entries={list}
          selected={selected.id}
          onPick={setPicked}
          remove={async (entry) => {
            const index = list.indexOf(entry)
            const next = list[index + 1] ?? list[index - 1]
            try {
              await store.remove(entry.id)
              if (entry === selected) setPicked(next?.id ?? null)
              props.onNotice(t('hub.memDeleted').replace('{name}', memoryTitle(entry)))
            } catch (caught) {
              props.onNotice(errorMessage(caught), 'error')
            }
          }}
        />
      </div>
      <MemoryDetail key={selected.id} {...props} entry={selected} />
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

/** 第二行：类型 · 几个工作流在用 · 大小。 */
function memoryMeta(t: T, entry: MemoryEntry): string {
  if (entry.invalid === true) return t('hub.memInvalid')
  const used =
    entry.usedBy.length === 0
      ? t('mem.unused')
      : t('mem.usedBy').replace('{n}', String(entry.usedBy.length))
  return `${memoryTypeText(t, entry.type)} · ${used} · ${formatBytes(entry.bytes)}`
}

function MemoryList(props: {
  t: T
  entries: readonly MemoryEntry[]
  selected: string
  onPick(id: string): void
  remove(entry: MemoryEntry): Promise<void>
}): React.JSX.Element {
  const { t, entries } = props
  const [doomed, setDoomed] = useState<string | null>(null)
  const confirm = useConfirm<HTMLButtonElement>()
  const doomedEntry = entries.find((entry) => entry.id === doomed)
  const listRef = useRef<HTMLElement>(null)
  const layout = `${props.selected}|${entries.map((entry) => entry.id).join('\n')}`
  useFlip(listRef, layout, { enter: true })

  return (
    <nav ref={listRef} className={cx(hub.wfList, hub.sideList)} aria-label={t('hub.memories')}>
      <ListThumb layout={layout} />
      {entries.map((entry) => {
        const selected = entry.id === props.selected
        const busy = confirm.open && doomed === entry.id
        return (
          <div
            key={entry.id}
            className={hub.wfRow}
            data-busy={busy}
            data-flip={entry.id}
            data-selected={selected}
          >
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              className={hub.wfItem}
              data-testid="wl-hub-mem"
              data-value={entry.id}
              onClick={() => props.onPick(entry.id)}
            >
              <span className={hub.wfIcon}>
                <Icon name={entry.invalid === true ? 'alert' : 'memory'} size={15} />
              </span>
              <span className={hub.wfText}>
                <span className={hub.wfName}>{memoryTitle(entry)}</span>
                <span className={hub.wfMeta}>{memoryMeta(t, entry)}</span>
              </span>
            </button>
            <span className={hub.wfActions}>
              <button
                ref={doomed === entry.id ? confirm.anchorRef : undefined}
                type="button"
                className={hub.wfAction}
                data-danger="true"
                data-tip={t('common.delete')}
                aria-label={`${t('common.delete')} ${memoryTitle(entry)}`}
                aria-expanded={busy}
                data-testid={`wl-hub-mem-delete-${entry.id}`}
                onClick={() => {
                  if (busy) {
                    confirm.hide()
                    return
                  }
                  setDoomed(entry.id)
                  confirm.show()
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        )
      })}
      {doomedEntry !== undefined &&
        confirm.render({
          t,
          title: t('hub.memDeleteTitle').replace('{name}', memoryTitle(doomedEntry)),
          desc: deleteText(t, doomedEntry),
          confirmText: t('common.delete'),
          testId: 'wl-hub-mem-delete-confirm',
          onConfirm: () => void props.remove(doomedEntry),
        })}
    </nav>
  )
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
}): React.JSX.Element {
  const { t, entry, store } = props
  const [name, setName] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  const save = (patch: { name?: string; description?: string }): void => {
    void store.update({ id: entry.id, ...patch }).catch((caught: unknown) => {
      props.onNotice(errorMessage(caught), 'error')
    })
  }

  return (
    <div className={cx(hub.wfDetail, hub.pinned, hub.paneIn)} data-testid="wl-hub-mem-detail">
      <div className={hub.wfHead}>
        <div className={hub.wfHeadText}>
          <p className={hub.wfTitle}>{memoryTitle(entry)}</p>
          <p className={hub.wfSub}>
            {memoryTypeText(t, entry.type)} · <code>{entry.id}</code> ·{' '}
            {t('mem.files').replace('{n}', String(entry.files))} · {formatBytes(entry.bytes)} ·{' '}
            {shortTime(entry.updatedAt)}
          </p>
        </div>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.soft)}
          data-testid="wl-hub-mem-view"
          onClick={() => setViewing(true)}
        >
          <Icon name="folder" size={14} />
          {t('mem.view')}
        </button>
      </div>

      <div className={mem.hubFields}>
        <label className={ins.field}>
          <span className={ins.label}>
            <span>{t('mem.name')}</span>
          </span>
          <input
            className={ui.input}
            value={name ?? entry.name}
            placeholder={entry.id}
            maxLength={80}
            data-testid="wl-hub-mem-name"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            onBlur={() => {
              if (name !== null && name.trim() !== entry.name) save({ name: name.trim() })
              setName(null)
            }}
          />
        </label>
        <label className={ins.field}>
          <span className={ins.label}>
            <span>{t('ins.description')}</span>
          </span>
          <textarea
            className={cx(ui.textarea, mem.hubDesc)}
            value={description ?? entry.description}
            placeholder={t('mem.descPlaceholder')}
            maxLength={500}
            rows={2}
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
      </div>

      <div className={mem.usedRow} data-testid="wl-hub-mem-used">
        <span className={mem.usedLabel}>{t('hub.memUsedBy')}</span>
        {entry.usedBy.length === 0 ? (
          <span className={mem.usedNone}>{t('mem.unused')}</span>
        ) : (
          entry.usedBy.map((workflow) => (
            <button
              key={workflow}
              type="button"
              className={mem.usedChip}
              data-tip={t('hub.wfOpenTip')}
              data-testid="wl-hub-mem-workflow"
              onClick={() => props.onOpen(workflow)}
            >
              <Icon name="folder" size={12} />
              <span>{workflow}</span>
            </button>
          ))
        )}
      </div>

      {entry.invalid !== true && (
        <MemoryVersionList
          t={t}
          rpc={props.rpc}
          store={store}
          id={entry.id}
          desktop={props.desktop}
        />
      )}

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
