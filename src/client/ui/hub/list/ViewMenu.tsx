/**
 * dsh-workflow-lite — 工作流中心各页左栏搜索框右边的「视图选项」：一张菜单分几段（分组方式、排序方式、筛选……），
 * 每页给自己的几段（{@link MenuSection}）。
 *
 * 点一项即生效，菜单留着（可以接着换别的一段）；Esc、点外面收起。单选段是 `menuitemradio`，多选段（按标签筛）
 * 是 `menuitemcheckbox`。有筛选生效时按钮右上角一个蓝点。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/list/ViewMenu
 */

import { useRef, useState } from 'react'
import type { StepColor } from '../../../../shared/appearance.ts'
import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import { Popover } from '../../kit/Popover.tsx'
import ui from '../../kit/ui.module.css'
import { useRadioMenu } from '../../kit/useRadioMenu.ts'
import css from './viewMenu.module.css'

export interface MenuChoice {
  value: string
  label: string
  icon: IconName
  /** 图标的颜色（按标签筛：标签的颜色）；缺省灰的。 */
  tint?: StepColor
  /** 写在项后面的数（筛选每项有几个）。 */
  count?: number
}

export interface MenuSection {
  /** 段的名字（也是测试锚点的一截：`<testId>-<id>-<value>`）。 */
  id: string
  title: string
  choices: readonly MenuChoice[]
  /** 哪几项是选着的。 */
  checked(value: string): boolean
  /** 多选（勾上 / 去掉）；缺省单选。 */
  multi?: boolean
  onPick(value: string): void
}

export function ViewMenu(props: {
  t: T
  sections: readonly MenuSection[]
  /** 有筛选生效（按钮上挂蓝点）。 */
  filtered: boolean
  testId: string
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const onKeyDown = useRadioMenu(open, list)
  const close = (): void => {
    setOpen(false)
    button.current?.focus({ preventScroll: true })
  }
  return (
    <Popover
      open={open}
      align="start"
      onClose={close}
      label={t('hub.viewOptions')}
      className={css.menu}
      trigger={
        <button
          ref={button}
          type="button"
          className={css.button}
          aria-label={t('hub.viewOptions')}
          aria-haspopup="menu"
          aria-expanded={open}
          data-tip={open ? undefined : t('hub.viewOptions')}
          data-filtered={props.filtered || undefined}
          data-testid={props.testId}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Icon name="sliders" size={15} />
        </button>
      }
    >
      <div
        ref={list}
        role="menu"
        aria-label={t('hub.viewOptions')}
        className={css.body}
        onKeyDown={onKeyDown}
      >
        {props.sections.map((section, index) => (
          <div key={section.id} role="group" aria-label={section.title}>
            {index > 0 && <div className={ui.menuSep} />}
            <p className={ui.menuTitle}>{section.title}</p>
            {section.choices.map((choice) => {
              const shared = {
                className: cx(ui.menuItem, css.item),
                'data-active': section.checked(choice.value),
                'data-testid': `${props.testId}-${section.id}-${choice.value}`,
                style:
                  choice.tint === undefined
                    ? undefined
                    : ({ '--wl-choice': `var(--wl-c-${choice.tint})` } as React.CSSProperties),
                onClick: () => section.onPick(choice.value),
              }
              const face = (
                <>
                  <Icon name={choice.icon} size={14} />
                  <span className={ui.menuLabel}>{choice.label}</span>
                  {choice.count !== undefined && <span className={css.count}>{choice.count}</span>}
                  <span className={css.check} aria-hidden="true">
                    <Icon name="check" size={13} />
                  </span>
                </>
              )
              return section.multi === true ? (
                <button
                  key={choice.value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={section.checked(choice.value)}
                  {...shared}
                >
                  {face}
                </button>
              ) : (
                <button
                  key={choice.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={section.checked(choice.value)}
                  {...shared}
                >
                  {face}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </Popover>
  )
}
