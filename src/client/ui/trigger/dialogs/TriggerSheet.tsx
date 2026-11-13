/**
 * dsh-workflow-lite — 触发卡片各项详细设置的对话框外壳：从点的那一行长出来，头部是触发方式的图标块、标题和卡片名，
 * 中间左边是表单、右边一栏放预览和说明，底部「取消」「保存」。
 *
 * 里面改的都是草稿：点「保存」（或 Ctrl+Enter）才一次写进图（一次改动 = 一条撤销步）；
 * 有没保存的改动时，Esc、点遮罩不关（和「工作流设置」一样），要点「取消」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/TriggerSheet
 */

import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Modal } from '../../kit/Modal.tsx'
import overlay from '../../kit/overlay.module.css'
import ui from '../../kit/ui.module.css'
import css from './sheet.module.css'

export function TriggerSheet(props: {
  t: T
  title: string
  /** 卡片名（标题下面一行小字）。 */
  sub: string
  /** 头部左边的图标块。 */
  mark: React.ReactNode
  testId: string
  dirty: boolean
  /** 现在能不能保存（有写错的项时不能）。 */
  canSave: boolean
  onSave(): void
  onClose(): void
  /** 右边一栏：预览、说明。没有就只有表单一栏。 */
  aside?: React.ReactNode
  /** 宽的（左右两栏）还是窄的（只有表单）。 */
  wide?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = props
  const save = (): void => {
    if (props.canSave) props.onSave()
  }
  return (
    <Modal
      label={props.title}
      testId={props.testId}
      className={cx(css.sheet, props.wide === true && css.wide)}
      onDismiss={() => {
        if (!props.dirty) props.onClose()
      }}
    >
      <form
        className={overlay.sheetForm}
        // 对话框挂在视图根上，接不到面板上的短标签列宽：这里按语言再给一次（行内控件左边对齐）。
        style={{ '--wl-trigger-lead': t('trigger.leadWidth') } as React.CSSProperties}
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            save()
          }
        }}
      >
        <header className={overlay.sheetHead}>
          {props.mark}
          <div className={overlay.sheetTitles}>
            <p className={overlay.sheetTitle}>{props.title}</p>
            <p className={overlay.sheetSub}>{props.sub}</p>
          </div>
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t('common.close')}
            onClick={props.onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        <div className={css.body}>
          <div className={css.main}>{props.children}</div>
          {props.aside !== undefined && <aside className={css.aside}>{props.aside}</aside>}
        </div>

        <footer className={overlay.sheetFoot}>
          <span className={ui.grow} />
          <span className={overlay.sheetKeys}>{t('trigger.sheetKeys')}</span>
          <button
            type="button"
            className={cx(ui.btn, ui.small)}
            data-testid={`${props.testId}-cancel`}
            onClick={props.onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className={cx(ui.btn, ui.small, ui.primary)}
            disabled={!props.canSave}
            data-testid={`${props.testId}-save`}
            onClick={save}
          >
            <Icon name="check" size={14} />
            {t('trigger.sheetSave')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

/** 右栏里的一段：小标题 + 内容。 */
export function AsideBlock(props: {
  title: string
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  return (
    <section className={css.block} data-testid={props.testId}>
      <p className={css.blockTitle}>{props.title}</p>
      {props.children}
    </section>
  )
}
