/**
 * dsh-workflow-lite — 看一份文档的模态框（产出文件、SKILL.md 共用）。
 *
 * 标题行：图标、名字、一行元信息，右边「排版 / 源码」（Markdown 才有）、复制路径、
 * 用其他程序打开（含在文件管理器中显示）、关闭。正文：Markdown 默认排版，其余原样；
 * 读不了的只说明原因。调用方可以在正文前插一段（`lead`），在底部放操作条（`footer`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DocViewer
 */

import { useState } from 'react'
import type { Desktop } from '../app/desktop.ts'
import type { T } from '../i18n.ts'
import css from './files.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { OpenWith } from './OpenWith.tsx'
import { copyText, cx, Modal, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

/** 正文是什么：还在读、读不了（说明原因）、读到了一段文字。 */
export type DocBody =
  | { kind: 'loading' }
  | { kind: 'state'; icon: IconName; text: string }
  | { kind: 'text'; text: string; markdown: boolean }

type View = 'rendered' | 'source'

export function DocViewer(props: {
  t: T
  /** 标题（也是对话框的无障碍名）。 */
  name: string
  /** 标题左边的图标块。 */
  badge: React.ReactNode
  /** 标题下面的一行（路径、大小……）。 */
  meta: React.ReactNode
  body: DocBody
  /** 「复制路径」复制什么；`null` 时按钮禁用。 */
  copyPath: string | null
  /** 「用其他程序打开」打开什么；`null`（文件还不在、没有文件）时不出现。 */
  openPath: string | null
  desktop: Desktop | undefined
  testId: string
  lead?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  onClose(): void
}): React.JSX.Element {
  const { t, body } = props
  const [view, setView] = useState<View>('rendered')
  const [copied, setCopied] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const markdown = body.kind === 'text' && body.markdown

  const state = (icon: IconName, text: string): React.JSX.Element => (
    <div className={css.viewerState} data-testid="wl-viewer-state">
      <span className={css.viewerStateIcon}>
        <Icon name={icon} size={20} />
      </span>
      <span>{text}</span>
    </div>
  )

  let content: React.ReactNode
  if (body.kind === 'loading') {
    content = (
      <div className={css.viewerState}>
        <span className={css.spinner} />
        {t('file.loading')}
      </div>
    )
  } else if (body.kind === 'state') content = state(body.icon, body.text)
  else if (body.text === '') content = state('file', t('file.empty'))
  else if (markdown && view === 'rendered') {
    content = <Markdown text={body.text} className={css.viewerDoc} />
  } else content = <pre className={css.viewerSource}>{body.text}</pre>

  return (
    <Modal
      label={props.name}
      onDismiss={props.onClose}
      className={cx(css.viewer, props.className)}
      testId={props.testId}
    >
      <header className={css.viewerHead}>
        {props.badge}
        <div className={css.viewerTitle}>
          <span className={css.viewerName}>{props.name}</span>
          <span className={css.viewerMeta}>{props.meta}</span>
        </div>
        {markdown && (
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
          disabled={props.copyPath === null}
          onClick={() => {
            if (props.copyPath === null) return
            void copyText(props.copyPath).then((ok) => {
              if (!ok) return
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1400)
            })
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
        </button>
        <OpenWith t={t} desktop={props.desktop} path={props.openPath} onError={setFailure} />
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
        {props.lead}
        {content}
      </div>
      {props.footer}
    </Modal>
  )
}
