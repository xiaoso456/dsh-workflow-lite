/**
 * dsh-workflow-lite — 产出文件的查看框。
 *
 * 能看的：小文本（原样）、Markdown（默认排版）、HTML（默认在沙箱里渲染），后两种可切源码。
 * 大文件、二进制、还没生成的只说明原因，
 * 并留着「用其他程序打开」。框子本身是 {@link DocViewer}。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FileViewer
 */

import type { Desktop } from '../app/desktop.ts'
import { type FileTarget, useRunFile } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName, formatBytes } from '../model/fileKind.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { type DocBody, DocViewer } from './DocViewer.tsx'
import { FileTag } from './FileTag.tsx'
import css from './runres.module.css'

/** 正文前的「说明」一块（文件夹、网址这两种小详情框用；大的查看框收在「说明」开关里）。 */
export function NoteLead(props: { t: T; text: string }): React.JSX.Element {
  return (
    <p className={css.lead} data-testid="wl-item-note">
      <span className={css.leadLabel}>{props.t('res.note')}</span>
      {props.text}
    </p>
  )
}

export function FileViewer(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: FileTarget
  /** 文件还没读回来时标题先用它。 */
  title: string
  desktop: Desktop | undefined
  /** 这一项的说明（产出文件就是它的生成要求）：收在标题行的「说明」开关里。 */
  note?: string | undefined
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const { file, error, loading } = useRunFile(props.rpc, props.instance, props.target)
  const name = file === null ? props.title : fileBaseName(file.display)
  const note = props.note?.trim() ?? ''

  let body: DocBody
  if (error !== null) body = { kind: 'state', icon: 'alert', text: error }
  else if (file === null || loading) body = { kind: 'loading' }
  else if (file.kind === 'missing') body = { kind: 'state', icon: 'clock', text: t('file.missing') }
  else if (file.kind === 'folder')
    body = { kind: 'state', icon: 'folder', text: t('res.kind.folder') }
  else if (file.kind === 'binary') body = { kind: 'state', icon: 'file', text: t('file.binary') }
  else if (file.kind === 'tooLarge') {
    body = {
      kind: 'state',
      icon: 'file',
      text: t('file.tooLarge')
        .replace('{size}', formatBytes(file.size))
        .replace('{limit}', formatBytes(file.limit)),
    }
  } else {
    const format = file.kind === 'markdown' || file.kind === 'html' ? file.kind : 'plain'
    body = { kind: 'text', text: file.text ?? '', format }
  }

  return (
    <DocViewer
      t={t}
      name={name}
      badge={<FileTag path={file?.display ?? props.title} large />}
      meta={
        <>
          <code>{file?.display ?? props.title}</code>
          {file?.exists === true &&
            ` · ${formatBytes(file.size)} · ${t('file.modified')} ${shortTime(file.mtime)}`}
        </>
      }
      body={body}
      copyPath={file?.path ?? null}
      openPath={file?.exists === true ? file.path : null}
      desktop={props.desktop}
      testId="wl-file-viewer"
      note={note}
      onClose={props.onClose}
    />
  )
}
