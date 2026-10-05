/**
 * dsh-workflow-lite — 二次确认：点了删除 / 放弃这类收不回的按钮，在按钮旁边浮出一张小卡问一句。
 *
 * 不在原地换出「取消 / 确认」：那样同一行的东西会被挤开，用户正要点的地方跟着挪。
 * 小卡浮在视图根上（摆位、收起规则同 {@link useFloat}），按钮原地不动、旁边的东西也不动：
 *
 * - 触发器在视图右半边就右边对齐，免得卡片离按钮太远；下面放不下翻到上方；
 * - 再点一下触发器、点别处、滚动、Esc 都等于取消；焦点先落在「取消」上，关掉后回到触发器
 *   （确认后若触发器在对话框里，交给对话框——触发器多半跟着被删的东西一起没了）；
 * - 卡片里的按键不往外冒（不会删到画布上选中的步骤）。
 *
 * 用法：`const confirm = useConfirm<HTMLButtonElement>()`，触发器挂 `ref={confirm.anchorRef}`、
 * `onClick={confirm.toggle}`，再在旁边放 `{confirm.render({...})}`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Confirm
 */

import { useEffect } from 'react'
import type { T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import { cx, useFloat } from './primitives.tsx'
import ui from './ui.module.css'

const CONFIRM_W = 288
/** 离触发器远一点：触发器常在一条带内边距的栏里，卡片别压到栏的边。 */
const CONFIRM_GAP = 12

export interface ConfirmOptions {
  t: T
  /** 问的那句话：「删除这个实例？」 */
  title: string
  /** 补一句后果（可选）。 */
  desc?: string
  /** 标题下面额外的东西（比如「连同状态文件」勾选框）。 */
  children?: React.ReactNode
  /** 确认按钮上的字：「删除」「放弃」。 */
  confirmText: string
  /** 确认按钮的 `data-testid`；整张卡是 `${testId}-pop`。 */
  testId?: string
  disabled?: boolean
  /** 确认按钮是红的（删除、放弃）；`false` = 主色（切换这类收得回来的）。缺省红。 */
  danger?: boolean
  onConfirm(): void
}

export function useConfirm<A extends HTMLElement>(): {
  anchorRef: React.RefObject<A>
  open: boolean
  show(): void
  hide(): void
  toggle(): void
  render(options: ConfirmOptions): React.ReactNode
} {
  const float = useFloat<A>({
    openMs: 0,
    closeMs: 0,
    width: CONFIRM_W,
    align: 'auto',
    gap: CONFIRM_GAP,
  })
  const { state, setState, panelRef, anchorRef } = float
  const open = state !== 'off'

  // 打开时焦点落在「取消」上：键盘连按两下回车不会直接删掉。
  // 卡片第一帧还藏着量尺寸（藏着的元素拿不到焦点），等摆好那一帧再聚焦。
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('[data-confirm="cancel"]')
        ?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, panelRef])

  const hide = (): void => {
    setState('off')
    anchorRef.current?.focus({ preventScroll: true })
  }
  /**
   * 确认之后焦点放哪：触发器常常跟着被删的东西一起没了（列表里的一行、草稿栏），焦点会掉到页面上，
   * Esc、快捷键都不灵了。在对话框里就交给对话框，否则回到触发器。
   */
  const settle = (): void => {
    setState('off')
    const anchor = anchorRef.current
    const dialog = anchor?.closest<HTMLElement>('[role="dialog"][tabindex]')
    ;(dialog ?? anchor)?.focus({ preventScroll: true })
  }

  return {
    anchorRef,
    open,
    show: () => setState('pinned'),
    hide,
    toggle: () => (open ? hide() : setState('pinned')),
    render: (options) =>
      float.render({
        className: ui.confirmPop,
        role: 'alertdialog',
        label: options.title,
        testId: options.testId === undefined ? undefined : `${options.testId}-pop`,
        children: (
          // biome-ignore lint/a11y/noStaticElementInteractions: 只在这一层截住卡片里的按键
          <div
            className={ui.confirmBody}
            onKeyDown={(event) => {
              // Esc 留给外层收起；别的键不再往视图根冒。
              if (event.key !== 'Escape') event.stopPropagation()
            }}
          >
            <div className={ui.confirmHead}>
              <span
                className={ui.confirmIcon}
                data-tone={options.danger === false ? 'accent' : undefined}
              >
                <Icon name={options.danger === false ? 'info' : 'alert'} size={14} />
              </span>
              <span className={ui.confirmTitle}>{options.title}</span>
            </div>
            {options.desc !== undefined && <p className={ui.confirmDesc}>{options.desc}</p>}
            {options.children}
            <div className={ui.confirmActions}>
              <button
                type="button"
                className={cx(ui.btn, ui.small)}
                data-confirm="cancel"
                onClick={hide}
              >
                {options.t('common.cancel')}
              </button>
              <button
                type="button"
                className={cx(
                  ui.btn,
                  ui.small,
                  options.danger === false ? ui.primary : ui.dangerSolid,
                )}
                disabled={options.disabled}
                data-testid={options.testId}
                onClick={() => {
                  settle()
                  options.onConfirm()
                }}
              >
                {options.confirmText}
              </button>
            </div>
          </div>
        ),
      }),
  }
}
