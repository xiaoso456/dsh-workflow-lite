/**
 * dsh-workflow-lite — 产出文件的查看框。
 *
 * 能看的：小文本（原样）、Markdown（默认排版，可切源码）。大文件、二进制、还没生成的只说明原因，
 * 并留着「用其他程序打开」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FileViewer
 */

import { useState } from 'react'
import type { Desktop } from '../app/desktop.ts'
import { type FileTarget, useRunFile } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName, formatBytes } from '../model/fileKind.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { FileTag } from './FileTag.tsx'
import css from './files.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { OpenWith } from './OpenWith.tsx'
import { copyText, cx, Modal, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

type View = 'rendered' | 'source'

export function FileViewer(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: FileTarget
  /** 文件还没读回来时标题先用它。 */
  title: string
  desktop: Desktop | undefined
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const { file, error, loading } = useRunFile(props.rpc, props.instance, props.target)
  const [view, setView] = useState<View>('rendered')
  const [copied, setCopied] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const name = file === null ? props.title : fileBaseName(file.display)

  const state = (icon: IconName, text: string): React.JSX.Element => (
    <div className={css.viewerState} data-testid="wl-viewer-state">
      <span className={css.viewerStateIcon}>
        <Icon name={icon} size={20} />
      </span>
      <span>{text}</span>
    </div>
  )

  let body: React.ReactNode
  if (error !== null) body = state('alert', error)
  else if (file === null || loading) {
    body = (
      <div className={css.viewerState}>
        <span className={css.spinner} />
        {t('file.loading')}
      </div>
    )
  } else if (file.kind === 'missing') body = state('clock', t('file.missing'))
  else if (file.kind === 'binary') body = state('file', t('file.binary'))
  else if (file.kind === 'tooLarge') {
    body = state(
      'file',
      t('file.tooLarge')
        .replace('{size}', formatBytes(file.size))
        .replace('{limit}', formatBytes(file.limit)),
    )
  } else if ((file.text ?? '') === '') body = state('file', t('file.empty'))
  else if (file.kind === 'markdown' && view === 'rendered') {
    body = <Markdown text={file.text ?? ''} className={css.viewerDoc} />
  } else {
    body = <pre className={css.viewerSource}>{file.text}</pre>
  }

  return (
    <Modal label={name} onDismiss={props.onClose} className={css.viewer} testId="wl-file-viewer">
      <header className={css.viewerHead}>
        <FileTag path={file?.display ?? props.title} large />
        <div className={css.viewerTitle}>
          <span className={css.viewerName}>{name}</span>
          <span className={css.viewerMeta}>
            <code>{file?.display ?? props.title}</code>
            {file?.exists === true &&
              ` · ${formatBytes(file.size)} · ${t('file.modified')} ${shortTime(file.mtime)}`}
          </span>
        </div>
        {file?.kind === 'markdown' && (
          <div className={css.viewerViews}>
            <Segmented<View>
              label={t('file.rendered')}
              value={view}
              onChange={setView}
              options={[
                { value: 'rendered', label: t('file.rendered') },
                { value: 'source', label: t('file.source') },
              ]}
            />
          </div>
        )}
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
          data-tip={copied ? t('common.copied') : t('file.copyPath')}
          aria-label={t('file.copyPath')}
          disabled={file === null}
          onClick={() => {
            if (file === null) return
            void copyText(file.path).then((ok) => {
              if (!ok) return
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1400)
            })
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
        </button>
        <OpenWith
          t={t}
          desktop={props.desktop}
          path={file?.exists === true ? file.path : null}
          onError={setFailure}
        />
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={props.onClose}
        >
          <Icon name="x" size={16} />
        </button>
      </header>
      {failure !== null && <p className={css.previewNote}>{failure}</p>}
      <div className={cx(css.viewerBody, ui.fade)} key={view} data-testid="wl-viewer-body">
        {body}
      </div>
    </Modal>
  )
}
