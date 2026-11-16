/**
 * dsh-workflow-lite — 触发卡片各项详细设置的对话框外壳：从点的那一行长出来，头部是触发方式的图标块、标题和卡片名，
 * 中间是表单（右边可以带一栏预览和说明，左边可以带一栏目录），底部「取消」「保存」。
 *
 * 带左栏的（「触发方式」）高度固定：左栏里换一种，对话框不跟着变高变矮，只有右边的内容在框里滚。
 * 头部标题和 ✕ 之间可以放一块（`head`）：「触发方式」在这里写它什么时候执行、现在怎样。
 *
 * 分几步填的（定时检查：触发时间 → 检查命令）：底栏左边放「上一步」（`footLead`），没到最后一步时主按钮换成「下一步」（`advance`）；
 * Ctrl+Enter 不管在哪一步，设置齐了就保存。
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
  /** 头部标题右边、✕ 左边的一块；没有就是空着。 */
  head?: React.ReactNode
  testId: string
  dirty: boolean
  /** 现在能不能保存（有写错的项时不能）。 */
  canSave: boolean
  onSave(): void
  onClose(): void
  /** 右边一栏：预览、说明。没有就只有表单一栏。 */
  aside?: React.ReactNode
  /** 左边一栏：目录（不跟着表单滚）。 */
  rail?: React.ReactNode
  /** 宽的（左右两栏）还是窄的（只有表单）。 */
  wide?: boolean
  /** 底栏左边（分步填时的「上一步」）。 */
  footLead?: React.ReactNode
  /** 还没到最后一步：主按钮写这个、点了往下走，不保存。 */
  advance?: { label: string; testId: string; onAdvance(): void }
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
      className={cx(
        css.sheet,
        props.wide === true && css.wide,
        props.rail !== undefined && css.railed,
      )}
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
        <header className={cx(overlay.sheetHead, props.rail !== undefined && css.headRuled)}>
          {props.mark}
          <div className={cx(overlay.sheetTitles, props.head !== undefined && css.titlesTight)}>
            <p className={overlay.sheetTitle}>{props.title}</p>
            <p className={overlay.sheetSub}>{props.sub}</p>
          </div>
          {props.head}
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
          {props.rail !== undefined && <div className={css.rail}>{props.rail}</div>}
          <div className={css.main}>{props.children}</div>
          {props.aside !== undefined && <aside className={css.aside}>{props.aside}</aside>}
        </div>

        <footer className={overlay.sheetFoot}>
          {props.footLead}
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
          {props.advance === undefined ? (
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
          ) : (
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.primary)}
              data-testid={props.advance.testId}
              onClick={props.advance.onAdvance}
            >
              {props.advance.label}
              <Icon name="chevronRight" size={14} />
            </button>
          )}
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
