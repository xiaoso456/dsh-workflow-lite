/**
 * dsh-workflow-lite — 查看框里的「说明」：标题行一个开关，点开从右边滑出一栏，盖在正文上面。
 *
 * 说明（产出文件的生成要求、步骤的描述）常常很长，放在正文上面会一直占着一大块，HTML 页面还会被挤出
 * 两层滚动条；收在开关里，要看时再拉出来，正文不跟着重排。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/NoteDrawer
 */

import { useEffect, useRef } from 'react'
import type { T } from '../i18n.ts'
import css from './files.module.css'
import { Icon } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

/** 标题行里的开关。 */
export function NoteToggle(props: { t: T; open: boolean; onToggle(): void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(ui.btn, ui.small, ui.soft, css.noteToggle)}
      aria-expanded={props.open}
      data-on={props.open}
      data-testid="wl-viewer-note-toggle"
      onClick={props.onToggle}
    >
      <Icon name="note" size={14} />
      {props.t('res.note')}
    </button>
  )
}

/** 滑出来的那一栏；Esc 先收起它，再按一次才关查看框。 */
export function NoteDrawer(props: { t: T; text: string; onClose(): void }): React.JSX.Element {
  const { t } = props
  const ref = useRef<HTMLElement>(null)
  // 拉出来就把焦点放在这一栏上（不亮焦点框），Esc 才会先到这里。
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    // 只在这一层消化 Esc，免得连查看框一起关掉
    <aside
      ref={ref}
      className={css.noteDrawer}
      aria-label={t('res.note')}
      tabIndex={-1}
      data-testid="wl-viewer-note"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        event.preventDefault()
        props.onClose()
      }}
    >
      <div className={css.noteDrawerHead}>
        <span className={css.noteDrawerTitle}>{t('res.note')}</span>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={props.onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <Markdown text={props.text} className={css.noteDrawerBody} />
    </aside>
  )
}
