/**
 * dsh-workflow-lite — 版本列表的一行：「v3 · 说明 · 时间 · 步骤数 · 当前」。
 *
 * - 点这一行展开「切到这一版会有哪些变化」（和磁盘上现在的内容比）；
 * - 「切换 / 编辑说明 / 删除」平时藏着，悬停或键盘移进来时浮在右端（和 `WorkflowRow` 一个做法）；
 * - 切换、删除都要再确认一次，确认卡浮在按钮旁边；编辑说明就在这一行原地换成输入框。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/VersionRow
 */

import { useEffect, useRef, useState } from 'react'
import type { VersionEntry } from '../../shared/types.ts'
import type { VersionDiff, Versions } from '../app/useVersions.ts'
import type { T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import { useConfirm } from './Confirm.tsx'
import { Icon } from './Icon.tsx'
import { graphLine } from './RunDraftBar.tsx'
import v from './versions.module.css'

/** 展开后最多列几处变化，再多只说个数。 */
const MAX_LINES = 12

export function VersionRow(props: {
  t: T
  entry: VersionEntry
  versions: Versions
  /** 和现在内容一样的那个版本号（切换的确认卡据此说"切回来不丢"）。 */
  currentN: number | null
}): React.JSX.Element {
  const { t, entry, versions } = props
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const restore = useConfirm<HTMLButtonElement>()
  const remove = useConfirm<HTMLButtonElement>()
  const busy = restore.open || remove.open
  const testId = `wl-ver-${entry.n}`

  const note =
    entry.note !== ''
      ? entry.note
      : entry.autoBefore !== undefined
        ? t('ver.autoNote').replace('{n}', String(entry.autoBefore))
        : t('ver.noNote')
  const head = (
    <>
      <span className={v.badge} data-current={entry.current}>
        v{entry.n}
      </span>
      <span className={v.text}>
        {editing ? (
          <NoteInput
            t={t}
            value={entry.note}
            onCommit={async (value) => {
              const ok = value.trim() === entry.note || (await versions.setNote(entry.n, value))
              if (ok) setEditing(false)
              return ok
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <span className={v.note} data-empty={entry.note === ''}>
            {note}
          </span>
        )}
        <span className={v.meta}>
          <span className={v.time}>{shortTime(entry.createdAt)}</span>
          <span>
            {entry.invalid === true
              ? t('ver.invalid')
              : t('ver.steps').replace('{n}', String(entry.nodeCount))}
          </span>
          {entry.current && <span className={v.currentTag}>{t('ver.current')}</span>}
        </span>
      </span>
    </>
  )

  return (
    <div className={v.row} data-open={open} data-busy={busy} data-testid={testId}>
      {editing ? (
        <div className={v.main}>{head}</div>
      ) : (
        <button
          type="button"
          className={v.main}
          aria-expanded={open}
          data-testid={`${testId}-toggle`}
          onClick={() => setOpen((value) => !value)}
        >
          {head}
          <span className={v.chevron}>
            <Icon name="chevronDown" size={14} />
          </span>
        </button>
      )}
      {!editing && (
        <span className={v.actions}>
          <button
            ref={restore.anchorRef}
            type="button"
            className={v.action}
            data-tip={entry.current ? undefined : t('ver.restore')}
            aria-label={t('ver.restore')}
            aria-expanded={restore.open}
            disabled={entry.current || entry.invalid === true || versions.busy}
            data-testid={`${testId}-restore`}
            onClick={restore.toggle}
          >
            <Icon name="restore" size={14} />
          </button>
          <button
            type="button"
            className={v.action}
            data-tip={t('ver.editNote')}
            aria-label={t('ver.editNote')}
            disabled={entry.invalid === true}
            data-testid={`${testId}-note`}
            onClick={() => setEditing(true)}
          >
            <Icon name="pencil" size={14} />
          </button>
          <button
            ref={remove.anchorRef}
            type="button"
            className={v.action}
            data-danger="true"
            data-tip={t('ver.delete')}
            aria-label={t('ver.delete')}
            aria-expanded={remove.open}
            disabled={versions.busy}
            data-testid={`${testId}-delete`}
            onClick={remove.toggle}
          >
            <Icon name="trash" size={14} />
          </button>
        </span>
      )}
      {restore.render({
        t,
        title: t('ver.restoreTitle').replace('{n}', String(entry.n)),
        desc:
          props.currentN === null
            ? t('ver.restoreAuto')
            : t('ver.restoreSafe').replace('{n}', String(props.currentN)),
        confirmText: t('ver.restoreConfirm'),
        testId: `${testId}-restore-confirm`,
        disabled: versions.busy,
        danger: false,
        onConfirm: () => void versions.restore(entry.n),
      })}
      {remove.render({
        t,
        title: t('ver.deleteTitle').replace('{n}', String(entry.n)),
        desc: t('wf.deleteConfirm'),
        confirmText: t('common.delete'),
        testId: `${testId}-delete-confirm`,
        disabled: versions.busy,
        onConfirm: () => void versions.remove(entry.n),
      })}
      {open && !editing && <DiffView t={t} entry={entry} versions={versions} />}
    </div>
  )
}

/** 展开的那一块：切到这一版会有哪些变化。列表每次重读（存了、切了）都重新比一次。 */
function DiffView(props: { t: T; entry: VersionEntry; versions: Versions }): React.JSX.Element {
  const { t, entry, versions } = props
  const [diff, setDiff] = useState<VersionDiff | null | 'loading'>('loading')
  const { list, diff: load } = versions

  // list 变了（存了、切了）就重新比一次。
  useEffect(() => {
    if (entry.invalid === true) return
    let alive = true
    setDiff('loading')
    void load(entry.n).then((result) => {
      if (alive) setDiff(result)
    })
    return () => {
      alive = false
    }
  }, [entry.n, entry.invalid, list])

  if (entry.invalid === true) return <div className={v.diff}>{t('ver.invalid')}</div>
  if (diff === 'loading') return <div className={v.diff}>{t('ver.diffLoading')}</div>
  if (diff === null) return <div className={v.diff} />
  const total = diff.changes.length + (diff.settings ? 1 : 0)
  if (total === 0) {
    return (
      <div className={v.diff} data-testid={`wl-ver-${entry.n}-diff`}>
        {t('ver.diffNone')}
      </div>
    )
  }
  const shown = diff.changes.slice(0, MAX_LINES)
  return (
    <div className={v.diff} data-testid={`wl-ver-${entry.n}-diff`}>
      <p className={v.diffTitle}>{t('ver.diffTitle')}</p>
      <ul className={v.diffList}>
        {shown.map((change) => (
          <li
            key={`${change.object}:${change.kind}:${change.id}`}
            className={v.diffLine}
            data-kind={change.kind}
          >
            {graphLine(t, change, diff.base, diff.next)}
          </li>
        ))}
        {diff.settings && (
          <li className={v.diffLine} data-kind="changed">
            {t('ver.diffSettings')}
          </li>
        )}
      </ul>
      {diff.changes.length > MAX_LINES && (
        <p className={v.diffMore}>+{diff.changes.length - MAX_LINES}</p>
      )}
    </div>
  )
}

/** 原地改说明：回车或点开保存，Esc 取消。 */
function NoteInput(props: {
  t: T
  value: string
  onCommit(value: string): Promise<boolean>
  onCancel(): void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const settled = useRef(false)
  useEffect(() => {
    ref.current?.select()
  }, [])
  const commit = (value: string): void => {
    if (settled.current) return
    settled.current = true
    void props.onCommit(value).then((ok) => {
      if (ok) return
      settled.current = false
      ref.current?.focus()
    })
  }
  return (
    <input
      ref={ref}
      className={v.noteInput}
      defaultValue={props.value}
      maxLength={500}
      placeholder={props.t('ver.notePlaceholder')}
      aria-label={props.t('ver.editNote')}
      data-tip={props.t('ver.noteHint')}
      data-testid="wl-ver-note-input"
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(event.currentTarget.value)
        if (event.key === 'Escape') {
          event.stopPropagation()
          settled.current = true
          props.onCancel()
        }
      }}
      onBlur={(event) => commit(event.currentTarget.value)}
    />
  )
}
