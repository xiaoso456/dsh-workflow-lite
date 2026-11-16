/**
 * dsh-workflow-lite — 工作流中心各页左栏搜索框右边的「视图选项」：一张菜单分几段（分组方式、排序方式、筛选……），
 * 每页给自己的几段（{@link MenuSection}）。
 *
 * 每段的选项排成一排小胶囊（放不下折行），选中的浅蓝底（不描边）；按标签筛的选中时是标签自己的颜色。一眼看到各段选了什么，
 * 菜单也矮。点一项即生效，菜单留着（可以接着换别的一段）；Esc、点外面收起。单选段是 `menuitemradio`，多选段（按标签筛）
 * 是 `menuitemcheckbox`；上下左右键在各项之间走。有筛选生效时按钮右上角一个蓝点。
 *
 * 菜单不走 portal：打开时量按钮下面还有多少地方（窗口、工作流中心的框，见 `roomAround`），菜单最高到那里，
 * 放不下的自己滚，最后几段不会被框切掉。
 *
 * 最后一段「行高」（标准 / 紧凑）各页都有、四页共用一个选择（{@link useListDensity}），这里自己加，不用页给。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/list/ViewMenu
 */

import { useRef, useState } from 'react'
import type { StepColor } from '../../../../shared/appearance.ts'
import {
  LIST_DENSITIES,
  type ListDensity,
  setListDensity,
  useListDensity,
} from '../../../app/listDensity.ts'
import type { T } from '../../../i18n.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import { Popover } from '../../kit/Popover.tsx'
import { roomAround } from '../../kit/Select.tsx'
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

/** 菜单最高多少（地方再大也不更高）、最矮多少。 */
const MENU_MAX = 560
const MENU_MIN = 160
/** 菜单本身占的高度（离按钮 8、上下内边距和边框）加上离框底留的一点。 */
const MENU_CHROME = 8 + 10 + 10

const DENSITY_ICON: Record<ListDensity, IconName> = { standard: 'unfold', compact: 'fold' }

/** 「行高」一段：四页共用。 */
function densitySection(t: T, density: ListDensity): MenuSection {
  return {
    id: 'density',
    title: t('hub.density'),
    choices: LIST_DENSITIES.map((value) => ({
      value,
      label: t(`hub.density.${value}`),
      icon: DENSITY_ICON[value],
    })),
    checked: (value) => value === density,
    onPick: (value) => {
      const hit = LIST_DENSITIES.find((one) => one === value)
      if (hit !== undefined) setListDensity(hit)
    },
  }
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
  /** 菜单最高多少（打开时按按钮下面的地方量）。 */
  const [room, setRoom] = useState(MENU_MAX)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  /**
   * 菜单开着时每个数字最宽到过几位：数字只往宽里占位、不缩回去。按标签筛会让上面「筛选」的数字变（14 → 4），
   * 胶囊一窄就可能折行方式变了、整段矮一行，手底下的标签跟着往上跳；占着位就不跳。下次打开重新量。
   */
  const digits = useRef(new Map<string, number>())
  const reserve = (key: string, count: number): string => {
    const width = Math.max(digits.current.get(key) ?? 0, String(count).length)
    digits.current.set(key, width)
    return `${String(width)}ch`
  }
  const onKeyDown = useRadioMenu(open, list, true, true)
  const density = useListDensity()
  const sections = [...props.sections, densitySection(t, density)]
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
          onClick={() => {
            if (open) return close()
            const below = button.current === null ? MENU_MAX : roomAround(button.current).below
            setRoom(Math.max(MENU_MIN, Math.min(MENU_MAX, below - MENU_CHROME)))
            digits.current.clear()
            setOpen(true)
          }}
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
        style={{ maxHeight: `${String(room)}px` }}
        onKeyDown={onKeyDown}
      >
        {sections.map((section) => (
          <div key={section.id} role="group" aria-label={section.title} className={css.section}>
            <p className={css.title}>{section.title}</p>
            <div className={css.pills}>
              {section.choices.map((choice) => {
                const on = section.checked(choice.value)
                const shared = {
                  className: css.pill,
                  'data-tinted': choice.tint === undefined ? undefined : 'true',
                  'data-testid': `${props.testId}-${section.id}-${choice.value}`,
                  style:
                    choice.tint === undefined
                      ? undefined
                      : ({ '--wl-choice': `var(--wl-c-${choice.tint})` } as React.CSSProperties),
                  onClick: () => section.onPick(choice.value),
                }
                const face = (
                  <>
                    <Icon name={choice.icon} size={13} />
                    <span className={css.label}>{choice.label}</span>
                    {choice.count !== undefined && (
                      <span
                        className={css.count}
                        style={{ minWidth: reserve(`${section.id}|${choice.value}`, choice.count) }}
                      >
                        {choice.count}
                      </span>
                    )}
                  </>
                )
                return section.multi === true ? (
                  <button
                    key={choice.value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    {...shared}
                  >
                    {face}
                  </button>
                ) : (
                  <button
                    key={choice.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    {...shared}
                  >
                    {face}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Popover>
  )
}
