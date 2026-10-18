/**
 * dsh-workflow-lite — 产出文件的查看框。
 *
 * 能看的：小文本（原样）、Markdown（默认预览，相对路径的图片按文档所在目录读）、HTML（默认在沙箱里渲染），
 * 后两种可切源码；图片整张显示、点一下放大。
 * 大文件、二进制、还没生成的只说明原因，
 * 并留着「用其他程序打开」。框子本身是 {@link DocViewer}。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FileViewer
 */

import type { RunFileResponse } from '../../shared/wire.ts'
import type { Desktop } from '../app/desktop.ts'
import { type FileTarget, useRunFile, useRunImages } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName, fileKindOf, formatBytes } from '../model/fileKind.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { type DocBody, DocViewer } from './DocViewer.tsx'
import { FileTag } from './FileTag.tsx'
import { ImagePreview } from './ImagePreview.tsx'
import css from './runres.module.css'

/** 正文前的「说明」一块（网址这种小详情框用；大的查看框收在「说明」开关里）。 */
export function NoteLead(props: { t: T; text: string }): React.JSX.Element {
  return (
    <p className={css.lead} data-testid="wl-item-note">
      <span className={css.leadLabel}>{props.t('res.note')}</span>
      {props.text}
    </p>
  )
}

/**
 * 读回来的文件怎么摆：读不了说原因、还没读到是骨架、是图片就交给 {@link ImagePreview}，其余按格式给正文。
 * 查看框和文件夹浏览（右边预览）共用。
 */
export function fileBody(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: FileTarget
  file: RunFileResponse | null
  error: string | null
  loading: boolean
}): DocBody {
  const { t, file } = props
  if (props.error !== null) return { kind: 'state', icon: 'alert', text: props.error }
  if (file === null || props.loading) return { kind: 'loading' }
  if (file.kind === 'missing') return { kind: 'state', icon: 'clock', text: t('file.missing') }
  if (file.kind === 'folder') return { kind: 'state', icon: 'folder', text: t('res.kind.folder') }
  if (fileKindOf(file.display) === 'image') {
    return {
      kind: 'node',
      node: (
        <ImagePreview
          t={t}
          rpc={props.rpc}
          instance={props.instance}
          target={props.target}
          name={fileBaseName(file.display)}
          path={file.display}
        />
      ),
    }
  }
  if (file.kind === 'binary') return { kind: 'state', icon: 'file', text: t('file.binary') }
  if (file.kind === 'tooLarge') {
    return {
      kind: 'state',
      icon: 'file',
      text: t('file.tooLarge')
        .replace('{size}', formatBytes(file.size))
        .replace('{limit}', formatBytes(file.limit)),
    }
  }
  const format = file.kind === 'markdown' || file.kind === 'html' ? file.kind : 'plain'
  return { kind: 'text', text: file.text ?? '', format }
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
  const image = useRunImages(props.rpc, props.instance, props.target)
  const name = file === null ? props.title : fileBaseName(file.display)
  const note = props.note?.trim() ?? ''
  const body = fileBody({
    t,
    rpc: props.rpc,
    instance: props.instance,
    target: props.target,
    file,
    error,
    loading,
  })

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
      image={image}
      onClose={props.onClose}
    />
  )
}
