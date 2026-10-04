/**
 * dsh-workflow-lite — 看一份文档的模态框（产出文件、SKILL.md 共用）。
 *
 * 标题行：图标、名字、一行元信息，右边「排版 / 源码」（Markdown、HTML 才有）、复制路径、
 * 用其他程序打开（含在文件管理器中显示）、关闭。正文：Markdown 默认排版，HTML 默认在沙箱框里渲染
 * （能跑脚本，但是独立的源：碰不到画布、拿不到登录态），其余原样；读不了的只说明原因。
 * 有说明（`note`）时标题行多一个「说明」开关，点开从右边滑出一栏，不占正文的地方。
 * 调用方可以在正文前插一段（`lead`），在底部放操作条（`footer`）。
 * 给了 `edit` 就多一个「编辑」：整块文字在这里改（提示词、摘要这类大段文字都在弹窗里改）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DocViewer
 */

import { useState } from 'react'
import type { Desktop } from '../app/desktop.ts'
import type { T } from '../i18n.ts'
import { withPreviewStyle } from '../model/htmlPreview.ts'
import css from './files.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { NoteDrawer, NoteToggle } from './NoteDrawer.tsx'
import { OpenWith } from './OpenWith.tsx'
import { copyText, cx, Modal, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

/** 弹窗里能改的那段文字怎么交出去。 */
export interface DocEdit {
  onChange(text: string): void
  placeholder?: string
  maxLength?: number
  testId?: string
  /** 一打开就在「编辑」。 */
  start?: boolean
}

/** 正文是什么：还在读、读不了（说明原因）、读到了一段文字。 */
export type DocBody =
  | { kind: 'loading' }
  | { kind: 'state'; icon: IconName; text: string }
  | { kind: 'text'; text: string; format: 'plain' | 'markdown' | 'html' }
  /** 调用方自己画的正文（文件夹里有什么、网址的说明）。 */
  | { kind: 'node'; node: React.ReactNode }

type View = 'rendered' | 'source' | 'edit'

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
  /** 复制按钮的说明（缺省「复制路径」：网址、自定义文字复制的不是路径）。 */
  copyLabel?: string
  /** 「用其他程序打开」打开什么；`null`（文件还不在、没有文件）时不出现。 */
  openPath: string | null
  desktop: Desktop | undefined
  testId: string
  lead?: React.ReactNode
  /** 这一项的说明（产出文件的生成要求、步骤的描述）：收在标题行的「说明」开关里。 */
  note?: string
  footer?: React.ReactNode
  className?: string
  /** 能改：正文就是这段文字，「编辑」里改了直接交出去。 */
  edit?: DocEdit
  onClose(): void
}): React.JSX.Element {
  const { t, body, edit } = props
  const [view, setView] = useState<View>(edit?.start === true ? 'edit' : 'rendered')
  const [copied, setCopied] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const note = props.note?.trim() ?? ''
  const format = body.kind === 'text' ? body.format : 'plain'
  // 有排版视图的格式：可以在「排版 / 源码」之间切。
  const formatted = format !== 'plain'

  const state = (icon: IconName, text: string): React.JSX.Element => (
    <div className={css.viewerState} data-testid="wl-viewer-state">
      <span className={css.viewerStateIcon}>
        <Icon name={icon} size={20} />
      </span>
      <span>{text}</span>
    </div>
  )

  let content: React.ReactNode
  if (view === 'edit' && edit !== undefined && body.kind === 'text') {
    content = (
      <textarea
        className={cx(ui.textarea, css.viewerEdit)}
        value={body.text}
        placeholder={edit.placeholder}
        aria-label={props.name}
        maxLength={edit.maxLength}
        spellCheck={false}
        data-testid={edit.testId}
        // biome-ignore lint/a11y/noAutofocus: 切到「编辑」就是要打字
        autoFocus
        onChange={(event) => edit.onChange(event.currentTarget.value)}
      />
    )
  } else if (body.kind === 'loading') {
    content = (
      <div className={css.viewerState}>
        <span className={css.spinner} />
        {t('file.loading')}
      </div>
    )
  } else if (body.kind === 'state') content = state(body.icon, body.text)
  else if (body.kind === 'node') content = body.node
  else if (body.text === '') content = state('file', t('file.empty'))
  else if (format === 'markdown' && view === 'rendered') {
    content = <Markdown text={body.text} className={css.viewerDoc} />
  } else if (format === 'html' && view === 'rendered') {
    content = (
      <iframe
        className={css.viewerFrame}
        title={props.name}
        srcDoc={withPreviewStyle(body.text)}
        // 只给脚本：没有 allow-same-origin，页面是个独立的源，读不到画布的存储与登录态，也跳不走顶层。
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        data-testid="wl-viewer-frame"
      />
    )
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
        {note !== '' && (
          <NoteToggle t={t} open={noteOpen} onToggle={() => setNoteOpen((open) => !open)} />
        )}
        {(formatted || edit !== undefined) && (
          <div className={css.viewerViews}>
            <Segmented<View>
              label={t('file.rendered')}
              value={view}
              onChange={setView}
              options={[
                ...(formatted
                  ? [
                      {
                        value: 'rendered' as const,
                        label: t(format === 'html' ? 'file.page' : 'file.rendered'),
                      },
                      { value: 'source' as const, label: t('file.source') },
                    ]
                  : [{ value: 'rendered' as const, label: t('file.text') }]),
                ...(edit === undefined ? [] : [{ value: 'edit' as const, label: t('file.edit') }]),
              ]}
            />
          </div>
        )}
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
          data-tip={copied ? t('common.copied') : (props.copyLabel ?? t('file.copyPath'))}
          aria-label={props.copyLabel ?? t('file.copyPath')}
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
      <div className={css.viewerMain}>
        <div className={cx(css.viewerBody, ui.fade)} key={view} data-testid="wl-viewer-body">
          {props.lead}
          {content}
        </div>
        {noteOpen && note !== '' && (
          <NoteDrawer t={t} text={note} onClose={() => setNoteOpen(false)} />
        )}
      </div>
      {props.footer}
    </Modal>
  )
}
