/**
 * dsh-workflow-lite — 看一份文档的模态框（产出文件、SKILL.md 共用）。
 *
 * 标题行：图标、名字、一行元信息，右边「预览 / 源码」（Markdown、HTML 才有）、复制路径、
 * 用其他程序打开（含在文件管理器中显示）、关闭。正文：Markdown 默认排版，HTML 默认在沙箱框里渲染
 * （能跑脚本，但是独立的源：碰不到画布、拿不到登录态），其余原样；读不了的只说明原因。
 * 有说明（`note`）时标题行多一个「说明」开关，点开从右边滑出一栏，不占正文的地方。
 * 调用方可以在正文前插一段（`lead`），在底部放操作条（`footer`）。
 * 给了 `edit` 就多一个「编辑」：整块文字在这里改（提示词、摘要这类大段文字都在弹窗里改）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DocViewer
 */

import { useEffect, useRef, useState } from 'react'
import type { Desktop } from '../app/desktop.ts'
import type { T } from '../i18n.ts'
import { brokenImagesOf } from '../model/htmlPreview.ts'
import { useBoardFrame } from './boardFrame.ts'
import css from './files.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { type ImageSource, Markdown } from './Markdown.tsx'
import { SwapIcon } from './motion.tsx'
import { NoteDrawer, NoteToggle } from './NoteDrawer.tsx'
import { OpenWith } from './OpenWith.tsx'
import { copyText, cx, Modal } from './primitives.tsx'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'

/** 读取中的骨架：标题一行、正文几行，宽窄错开像一段字。 */
const SKELETON = ['42%', '92%', '86%', '95%', '64%', '0', '88%', '78%', '52%']

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

/** 复制按钮：点一下复制 `text`，图标换成对勾停一会儿。`text` 为 `null` 时禁用。 */
export function CopyButton(props: {
  t: T
  text: string | null
  /** 悬停提示与无障碍名（缺省「复制路径」）。 */
  label?: string | undefined
}): React.JSX.Element {
  const { t, text } = props
  const [copied, setCopied] = useState(false)
  const label = props.label ?? t('file.copyPath')
  return (
    <button
      type="button"
      className={cx(ui.btn, ui.icon, ui.small)}
      data-tip={copied ? t('common.copied') : label}
      aria-label={label}
      disabled={text === null}
      onClick={() => {
        if (text === null) return
        void copyText(text).then((ok) => {
          if (!ok) return
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        })
      }}
    >
      <SwapIcon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  )
}

/** 正文是哪种格式：Markdown、HTML 有「预览 / 源码」两个视图，其余原样。 */
export function docFormat(body: DocBody): 'plain' | 'markdown' | 'html' {
  return body.kind === 'text' ? body.format : 'plain'
}

/** 沙箱框里渲染一份 HTML（看板按完整版、带画布主题），并收框里报来的「加载失败的图片数」。 */
function HtmlFrame(props: {
  name: string
  text: string
  onBroken: ((count: number) => void) | undefined
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const report = useRef(props.onBroken)
  report.current = props.onBroken
  const { text } = props
  const board = useBoardFrame(frame, text, 'full')
  // 依赖 text：换了页面内容就是一个新的框，旧的失败数作废（清理时回 0）。
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      // 只认自己这个框发的（页面是独立的源，origin 是 null，认不了 origin，认窗口）。
      if (event.source === null || event.source !== frame.current?.contentWindow) return
      const count = brokenImagesOf(event.data)
      if (count !== null) report.current?.(count)
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      report.current?.(0)
    }
  }, [text])
  return (
    <iframe
      ref={frame}
      className={css.viewerFrame}
      title={props.name}
      srcDoc={board.srcDoc}
      onLoad={board.onLoad}
      // 只给脚本：没有 allow-same-origin，页面是个独立的源，读不到画布的存储与登录态，也跳不走顶层。
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      data-testid="wl-viewer-frame"
    />
  )
}

/** 标题行里的小警告：预览里有图片没加载出来时淡入，悬停说明原因和办法。 */
export function BrokenImagesHint(props: { t: T; count: number }): React.JSX.Element | null {
  if (props.count === 0) return null
  return (
    <span
      className={css.brokenHint}
      role="img"
      aria-label={props.t('file.brokenImages').replace('{n}', String(props.count))}
      data-tip={props.t('file.brokenImagesTip').replace('{n}', String(props.count))}
      data-testid="wl-broken-images"
    >
      <Icon name="alert" size={15} />
    </span>
  )
}

/**
 * 正文区里的那块内容：读取中的骨架、读不了的原因、预览 / 源码。
 * 查看框（{@link DocViewer}）和文件夹浏览（右边预览一份文件）共用。
 */
export function DocContent(props: {
  t: T
  body: DocBody
  /** 有两个视图的格式（Markdown、HTML）按它显示；别的格式不看它。 */
  view: 'rendered' | 'source'
  /** iframe 的标题。 */
  name: string
  image?: ImageSource | undefined
  /** HTML 预览里加载失败的图片数变了（换了视图、换了文件回 0）。 */
  onBroken?: ((count: number) => void) | undefined
}): React.JSX.Element {
  const { t, body, view } = props
  const format = docFormat(body)
  const state = (icon: IconName, text: string): React.JSX.Element => (
    <div className={css.viewerState} data-testid="wl-viewer-state">
      <span className={css.viewerStateIcon}>
        <Icon name={icon} size={20} />
      </span>
      <span>{text}</span>
    </div>
  )
  if (body.kind === 'loading') {
    // 骨架：几行灰条轻轻呼吸，读得快的（多半是本地文件）稍等才出来，不闪一下。
    return (
      <div className={css.skeleton} role="status" aria-label={t('file.loading')}>
        {SKELETON.map((width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 固定的几行占位，不增不减
          <span key={index} style={{ width }} />
        ))}
      </div>
    )
  }
  if (body.kind === 'state') return state(body.icon, body.text)
  if (body.kind === 'node') return <>{body.node}</>
  if (body.text === '') return state('file', t('file.empty'))
  if (format === 'markdown' && view === 'rendered') {
    return <Markdown t={t} text={body.text} className={css.viewerDoc} image={props.image} />
  }
  if (format === 'html' && view === 'rendered') {
    return <HtmlFrame name={props.name} text={body.text} onBroken={props.onBroken} />
  }
  return <pre className={css.viewerSource}>{body.text}</pre>
}

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
  /** Markdown 里相对路径的图片怎么读（文件查看框按文档所在目录读）；不给就只显示替代文字。 */
  image?: ImageSource
  onClose(): void
}): React.JSX.Element {
  const { t, body, edit } = props
  const [view, setView] = useState<View>(edit?.start === true ? 'edit' : 'rendered')
  const [failure, setFailure] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [broken, setBroken] = useState(0)
  const note = props.note?.trim() ?? ''
  const format = docFormat(body)
  // 有预览视图的格式：可以在「预览 / 源码」之间切。
  const formatted = format !== 'plain'

  const content: React.ReactNode =
    view === 'edit' && edit !== undefined && body.kind === 'text' ? (
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
    ) : (
      <DocContent
        t={t}
        body={body}
        view={view === 'source' ? 'source' : 'rendered'}
        name={props.name}
        image={props.image}
        onBroken={setBroken}
      />
    )

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
        <BrokenImagesHint t={t} count={broken} />
        {(formatted || edit !== undefined) && (
          <div className={css.viewerViews}>
            <Segmented<View>
              label={t('file.rendered')}
              value={view}
              onChange={setView}
              options={[
                ...(formatted
                  ? [
                      { value: 'rendered' as const, label: t('file.rendered') },
                      { value: 'source' as const, label: t('file.source') },
                    ]
                  : [{ value: 'rendered' as const, label: t('file.text') }]),
                ...(edit === undefined ? [] : [{ value: 'edit' as const, label: t('file.edit') }]),
              ]}
            />
          </div>
        )}
        <CopyButton t={t} text={props.copyPath} label={props.copyLabel} />
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
        <div
          className={cx(css.viewerBody, body.kind === 'loading' ? undefined : css.viewerReveal)}
          // 读完了换一块：内容淡入浮起，不和骨架硬切。
          key={`${view}:${body.kind === 'loading'}`}
          data-testid="wl-viewer-body"
        >
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
