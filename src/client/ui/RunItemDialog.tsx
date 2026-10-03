/**
 * dsh-workflow-lite — 实例视图里点开资源的一项：文件夹、网址、自定义文字各自的详情框。
 *
 * 文件用 {@link FileViewer}（能读正文），Skill 用 {@link SkillPreview}（读 SKILL.md），都不在这里。
 * 三个框都是 {@link DocViewer} 的小号：标题行同样有复制、用其他程序打开（文件夹）、关闭，
 * 正文前同样是这一项的说明。
 * - 文件夹：里面有什么（目录在前，只列名字），可以复制路径、用其他程序打开或在文件管理器里显示；
 * - 网址：整条网址（点了在浏览器里开），底部一个「在浏览器中打开」；
 * - 自定义文字：整段排版显示，可以复制。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunItemDialog
 */

import { useEffect, useMemo, useState } from 'react'
import type { ResourceItem } from '../../shared/types.ts'
import type { HostListResponse } from '../../shared/wire.ts'
import type { Desktop } from '../app/desktop.ts'
import type { HostAccess } from '../app/host.ts'
import { type FileTarget, useRunFile } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName } from '../model/fileKind.ts'
import { shortTime } from '../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { DocViewer } from './DocViewer.tsx'
import { NoteLead } from './FileViewer.tsx'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import res from './resource.module.css'
import { itemName, KIND_ICON, KIND_LABEL } from './resourceUi.ts'
import css from './runres.module.css'
import ui from './ui.module.css'

function Badge(props: { kind: ResourceItem['kind'] }): React.JSX.Element {
  return (
    <span className={cx(res.kindIcon, css.icon)} data-kind={props.kind}>
      <Icon name={KIND_ICON[props.kind]} size={15} />
    </span>
  )
}

function lead(t: T, item: ResourceItem): React.ReactNode {
  const note = item.note?.trim() ?? ''
  return note === '' ? null : <NoteLead t={t} text={note} />
}

/** 文件夹：里面有什么。 */
export function FolderDialog(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  host: HostAccess
  node: string
  index: number
  item: ResourceItem
  desktop: Desktop | undefined
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const target = useMemo<FileTarget>(
    () => ({ node: props.node, item: props.index }),
    [props.node, props.index],
  )
  const { file, error } = useRunFile(props.rpc, props.instance, target)
  const [listing, setListing] = useState<HostListResponse | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const folder = file?.kind === 'folder' ? file.path : null

  useEffect(() => {
    if (folder === null) return
    let alive = true
    props.host
      .list(folder)
      .then((value) => {
        if (alive) setListing(value)
      })
      .catch((reason: unknown) => {
        if (alive) setFailure(errorMessage(reason))
      })
    return () => {
      alive = false
    }
  }, [folder, props.host])

  let body: React.ReactNode
  const problem = error ?? failure
  if (problem !== null) body = <p className={css.hint}>{problem}</p>
  else if (file === null || (folder !== null && listing === null)) {
    body = <p className={css.hint}>{t('file.loading')}</p>
  } else if (folder === null) body = <p className={css.hint}>{t('res.folderMissing')}</p>
  else if (listing?.entries.length === 0) body = <p className={css.hint}>{t('res.folderEmpty')}</p>
  else {
    body = (
      <>
        <ul className={css.entries} data-testid="wl-folder-entries">
          {listing?.entries.map((entry) => (
            <li key={entry.name} className={css.entry} data-dir={entry.dir}>
              <span className={css.entryIcon}>
                <Icon name={entry.dir ? 'folder' : 'file'} size={13} />
              </span>
              {entry.name}
            </li>
          ))}
        </ul>
        {listing?.truncated === true && <p className={css.hint}>{t('res.folderMore')}</p>}
      </>
    )
  }

  const display = file?.display ?? props.item.value
  return (
    <DocViewer
      t={t}
      name={fileBaseName(display) || itemName(props.item)}
      badge={<Badge kind="folder" />}
      meta={
        <>
          <code>{display}</code>
          {folder !== null && file !== null && ` · ${t('file.modified')} ${shortTime(file.mtime)}`}
        </>
      }
      body={{
        kind: 'node',
        node: (
          <div className={css.pane}>
            {lead(t, props.item)}
            {body}
          </div>
        ),
      }}
      copyPath={file?.path ?? null}
      openPath={folder}
      desktop={props.desktop}
      testId="wl-folder-viewer"
      className={css.small}
      onClose={props.onClose}
    />
  )
}

/** 网址：整条网址、说明，底部在浏览器中打开。 */
export function UrlDialog(props: {
  t: T
  item: ResourceItem
  desktop: Desktop | undefined
  onClose(): void
}): React.JSX.Element {
  const { t, item } = props
  const url = item.value.trim()
  return (
    <DocViewer
      t={t}
      name={itemName(item) || t(KIND_LABEL.url)}
      badge={<Badge kind="url" />}
      meta={t(KIND_LABEL.url)}
      body={{
        kind: 'node',
        node: (
          <div className={css.pane}>
            {lead(t, item)}
            <a className={css.link} href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </div>
        ),
      }}
      copyPath={url === '' ? null : url}
      copyLabel={t('res.copyUrl')}
      openPath={null}
      desktop={props.desktop}
      testId="wl-url-viewer"
      className={css.small}
      footer={
        <div className={css.footer}>
          <a
            className={cx(ui.btn, ui.primary)}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="wl-url-open"
          >
            <Icon name="external" size={14} />
            {t('res.openLink')}
          </a>
        </div>
      }
      onClose={props.onClose}
    />
  )
}

/** 自定义文字：整段排版显示。 */
export function TextDialog(props: {
  t: T
  item: ResourceItem
  desktop: Desktop | undefined
  onClose(): void
}): React.JSX.Element {
  const { t, item } = props
  const text = item.value.trim()
  return (
    <DocViewer
      t={t}
      name={itemName(item) || t(KIND_LABEL.text)}
      badge={<Badge kind="text" />}
      meta={t('res.textChars').replace('{n}', String([...text].length))}
      body={{ kind: 'text', text, markdown: true }}
      copyPath={text === '' ? null : text}
      copyLabel={t('res.copyText')}
      openPath={null}
      desktop={props.desktop}
      testId="wl-text-viewer"
      lead={lead(t, item)}
      onClose={props.onClose}
    />
  )
}
