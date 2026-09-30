/**
 * dsh-workflow-lite — 顶栏的两个浮层件：可搜索下拉（`Combobox`）与溢出菜单（`MenuButton`）。
 *
 * 为什么自己写而不用现成的：客户端的 `dsh-client-ui-primitives` 只导出 markdown 与设置表单，
 * 没有通用组件库；原生 `<select>` 又给不了这里要的三件事——**搜索**（图多起来之后要按名字找）、
 * **跟主题的样式**（原生下拉的弹层由操作系统画，暗色下是一块白板）、**悬浮说明**。
 *
 * 两者共用的机制（贴住触发器、点外关闭、滚动/改窗口重新贴）写在一个 `usePopover` 里：
 * 浮层用 `position: fixed` 留在触发器的 DOM 子树里，**不 portal**——`fixed` 盒的包含块是视口，
 * 祖先的 `overflow: auto` 裁不到它（顶栏就是横向滚动容器）；而 `--wl-*` 令牌只声明在画布根
 * 节点上，portal 出去就继承不到，只能再抄一份令牌（迟早跟那边漂开）。
 *
 * **测试锚点（冻结）**：`wl-graph-combobox`（容器）、`wl-graph-trigger`（触发器，`role=combobox`）、
 * `wl-graph-listbox`（列表，项上带 `data-value="<值>"`）、`wl-graph-filter`（筛选框）、
 * `wl-more-trigger` 与 `wl-more-menu`（溢出菜单）。验收脚本按这几个钩子驱动，改名会打断它们。
 *
 * @module @xiaoso/dsh-workflow-lite/client/components/Combobox
 */
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import css from './Combobox.module.css'
import type { Translate } from './Palette.tsx'
import { Tooltip } from './Tooltip.tsx'

/** 浮层与触发器之间的留白。 */
const GAP = 4
/** 距视口边缘的最小留白（夹紧用）。 */
const EDGE = 8

/** 浮层的视口坐标；`minWidth` 保证它不比触发器窄（下拉看起来才像"从这里展开"）。 */
interface PopoverState {
  left: number
  top: number
  minWidth: number
}

interface Rect {
  top: number
  bottom: number
  left: number
  width: number
  height: number
}

/**
 * 把浮层贴到触发器下方（下面放不下就翻到上方），并横向夹进视口。
 * @param anchor - 触发器的矩形。
 * @param box - 浮层自身的矩形（宽高都要量过：文案长度不定）。
 * @returns 视口坐标。
 */
function place(anchor: Rect, box: Rect): PopoverState {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const below = anchor.bottom + GAP
  const above = anchor.top - GAP - box.height
  const fitsBelow = below + box.height <= viewportH - EDGE
  const top = fitsBelow || above < EDGE ? below : above
  const width = Math.max(box.width, anchor.width)
  const left = Math.min(Math.max(EDGE, anchor.left), Math.max(EDGE, viewportW - EDGE - width))
  return {
    left: Math.round(left),
    top: Math.round(Math.max(EDGE, Math.min(top, viewportH - EDGE - box.height))),
    minWidth: Math.round(anchor.width),
  }
}

function samePosition(a: PopoverState | null, b: PopoverState): boolean {
  return a !== null && a.left === b.left && a.top === b.top && a.minWidth === b.minWidth
}

interface Popover {
  open: boolean
  position: PopoverState | null
  /** 开或关；`returnFocus` 为真时关掉后把焦点还给触发器。 */
  setOpen: (next: boolean, returnFocus?: boolean) => void
  /** 量一次浮层与触发器的真实尺寸，重新摆位（内容高度变了要重算翻转）。 */
  reposition: () => void
}

/**
 * 浮层的公共生命周期：开合状态、贴住触发器、点外关闭、滚动与改窗口尺寸时重新贴。
 *
 * 刻意**不**做成受控组件：调用方各有一份自己的附加状态（筛选词 / 展开的子菜单），
 * 但"开在哪、什么时候关"这件事两边一模一样，写两份迟早会漂。
 * @param triggerRef - 触发器元素。
 * @param popRef - 浮层元素（贴在触发器旁边、`position: fixed` 的那个盒子）。
 */
function usePopover(
  triggerRef: React.RefObject<HTMLElement | null>,
  popRef: React.RefObject<HTMLElement | null>,
): Popover {
  const [open, setOpenState] = useState(false)
  const [position, setPosition] = useState<PopoverState | null>(null)

  const reposition = useCallback((): void => {
    const trigger = triggerRef.current
    const pop = popRef.current
    if (trigger === null || pop === null) return
    const next = place(trigger.getBoundingClientRect(), pop.getBoundingClientRect())
    setPosition((current) => (samePosition(current, next) ? current : next))
  }, [popRef, triggerRef])

  const setOpen = useCallback(
    (next: boolean, returnFocus = false): void => {
      if (next) {
        /*
         * 开的那一帧就按触发器的位置摆好：先摆在它正下方，真实的宽高由
         * `useLayoutEffect` 在**同一帧**量完纠正（翻转与夹边都在那一次）。
         * 不这么做的话第一帧浮层会闪在 (0,0)。
         */
        const trigger = triggerRef.current
        if (trigger !== null) {
          const rect = trigger.getBoundingClientRect()
          setPosition({
            left: Math.max(EDGE, Math.round(rect.left)),
            top: Math.round(rect.bottom + GAP),
            minWidth: Math.round(rect.width),
          })
        }
      } else {
        setPosition(null)
        if (returnFocus) triggerRef.current?.focus()
      }
      setOpenState(next)
    },
    [triggerRef],
  )

  useLayoutEffect(() => {
    if (open) reposition()
  }, [open, reposition])

  useEffect(() => {
    if (!open) return
    /*
     * 点外用 **capture 的 `pointerdown`**：它在浏览器把焦点交给被点元素**之前**跑，
     * 于是"点外面"既能关掉浮层、又不会出现"焦点先跳到别处、浮层再关"的一帧错位。
     */
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) === true) return
      if (popRef.current?.contains(target) === true) return
      setOpen(false)
    }
    // 滚动/改尺寸会让 fixed 坐标失效：重新贴一次（下拉跟着触发器走，比"直接关掉"更稳）。
    const onViewportChange = (): void => reposition()
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [open, popRef, reposition, setOpen, triggerRef])

  return { open, position, setOpen, reposition }
}

export interface ComboboxOption {
  /** 选中时交回调用方的值（图名）。 */
  value: string
  /** 主文案（图名）。 */
  label: string
  /** 右侧的次要信息（节点数）。 */
  meta?: string
}

export interface ComboboxProps {
  t: Translate
  options: readonly ComboboxOption[]
  /** 当前值；命中不了任何选项时触发器就显示 `placeholder`。 */
  value: string
  placeholder: string
  onSelect: (value: string) => void
}

/**
 * 可搜索的单选下拉。
 *
 * 键盘：触发器上 `Enter`/`Space` 开合、`↑`/`↓` 直接展开；展开后焦点在筛选框里，
 * `↑`/`↓` 移动高亮、`Enter` 选中、`Esc` / `Tab` 关闭并把焦点还给触发器（从浮层里往后 Tab
 * 的顺序不连续，见 `onFilterKeyDown` 里 `Tab` 那一支的注释）。
 * 高亮走 `aria-activedescendant`（焦点始终留在筛选框里，边打字边选不用来回搬焦点）。
 * @param props - 选项、当前值、选中回调与词典。
 */
export function Combobox(props: ComboboxProps): React.JSX.Element {
  const { t, options, value, placeholder, onSelect } = props
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const { open, position, setOpen, reposition } = usePopover(triggerRef, popRef)

  const current = options.find((option) => option.value === value) ?? null
  const needle = query.trim().toLowerCase()
  const filtered =
    needle === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(needle))
  // 选项会随 `graph/list` 刷新而变短：把高亮夹回范围内，不让它指到一个不存在的下标。
  const highlighted = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1)
  const activeOption = highlighted >= 0 ? filtered[highlighted] : undefined

  const optionId = (index: number): string => `${listboxId}-opt-${index}`

  /** 开：清掉上一次的筛选词，高亮落在当前选中项上（没有就落第一项）。 */
  const openList = useCallback((): void => {
    const index = options.findIndex((option) => option.value === value)
    setQuery('')
    setActive(index >= 0 ? index : 0)
    setOpen(true)
  }, [options, setOpen, value])

  /**
   * 选中。**同一个值不回调**：`open()` 会重新发一次 `graph/load`，
   * 而原生 `<select>` 的 `change` 也只在实际换值时才发——重选当前图不该变成一次重载。
   */
  const select = useCallback(
    (next: string): void => {
      setOpen(false, true)
      if (next !== value) onSelect(next)
    },
    [onSelect, setOpen, value],
  )

  // 展开后：量一次真实高度纠坐标，并把焦点交给筛选框（用户接下来就是想打字）。
  useLayoutEffect(() => {
    if (!open) return
    reposition()
    filterRef.current?.focus()
  }, [open, reposition, filtered.length])

  // 高亮项滚进视野：键盘连按 20 次 ↓ 时，高亮不能跑到列表外面去。
  useEffect(() => {
    if (!open) return
    const node = popRef.current?.querySelector('[role="option"][data-active]')
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' })
  }, [open, highlighted])

  const onFilterKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (filtered.length > 0) setActive((highlighted + 1) % filtered.length)
        return
      case 'ArrowUp':
        event.preventDefault()
        if (filtered.length > 0) setActive((highlighted - 1 + filtered.length) % filtered.length)
        return
      case 'Enter': {
        event.preventDefault()
        if (activeOption !== undefined) select(activeOption.value)
        return
      }
      case 'Escape':
        event.preventDefault()
        setOpen(false, true)
        return
      case 'Tab':
        /*
         * 只把浮层收掉、焦点还给触发器，**不**让浏览器自己走：浮层挂在触发器旁边（不是
         * body 末尾），从筛选框往后 Tab 的顺序是浮层里那些选项——它们 `tabIndex=-1` 不可 Tab，
         * 于是焦点会直接跳出这一页。归还焦点后用户再按一次 Tab，顺序才是连续的。
         */
        setOpen(false, true)
        return
      default:
        return
    }
  }

  const triggerText = current?.label ?? (value === '' ? placeholder : value)

  return (
    <div className={css.root} data-testid="wl-graph-combobox">
      <button
        type="button"
        className={css.trigger}
        data-testid="wl-graph-trigger"
        ref={triggerRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        onClick={() => {
          if (open) setOpen(false, true)
          else openList()
        }}
        onKeyDown={(event) => {
          // Enter / Space 交给按钮自己的 click（开合各一次），这里只管方向键。
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          if (!open) openList()
        }}
      >
        <span className={css.value}>{triggerText}</span>
        {current?.meta !== undefined && <span className={css.valueMeta}>{current.meta}</span>}
        <span className={css.chevron} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && position !== null && (
        <div
          className={css.popover}
          data-testid="wl-graph-popover"
          ref={popRef}
          style={{ left: position.left, top: position.top, minWidth: position.minWidth }}
        >
          <input
            className={css.filter}
            data-testid="wl-graph-filter"
            ref={filterRef}
            type="text"
            value={query}
            placeholder={t('picker.search')}
            aria-label={t('picker.search')}
            aria-controls={listboxId}
            aria-activedescendant={activeOption === undefined ? undefined : optionId(highlighted)}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onFilterKeyDown}
          />
          {filtered.length === 0 ? (
            // 空结果**不放**在 listbox 里：`role="listbox"` 的子元素只能是 option 或 group。
            <p className={css.noMatch}>{t('picker.noMatch')}</p>
          ) : (
            /*
             * 用 `<div>` 而不是 `<ul>/<li>`：`li` 的隐含角色是 `listitem`，
             * 再挂 `role="option"` 会同时踩到两条 a11y 规则（隐含角色冲突 + 不可聚焦），
             * 而 `div` 没有隐含角色这一层。列表语义由 `role="listbox"`/`option` 表达。
             */
            <div
              className={css.list}
              data-testid="wl-graph-listbox"
              id={listboxId}
              role="listbox"
              aria-label={t('picker.label')}
            >
              {filtered.map((option, index) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘路径整个由筛选框的 ↑↓/Enter 承担（高亮 = aria-activedescendant），选项自己不需要按键处理
                <div
                  key={option.value}
                  id={optionId(index)}
                  className={css.option}
                  role="option"
                  /*
                   * `-1` 而不是省略：ARIA 要求有交互角色的元素**可聚焦**（规则也这么查）。
                   * `-1` 只是"可被脚本/指针聚焦"，不进 Tab 序——Tab 序仍然是触发器 → 筛选框，
                   * 高亮走 `aria-activedescendant`（焦点始终留在筛选框里，边打字边选不搬焦点）。
                   */
                  tabIndex={-1}
                  data-value={option.value}
                  data-active={index === highlighted ? '' : undefined}
                  aria-selected={option.value === value}
                  onMouseEnter={() => setActive(index)}
                  // 只吃掉 pointerdown 的默认行为（别把焦点从筛选框拿走），click 照常派发。
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => select(option.value)}
                >
                  <span className={css.optionLabel}>{option.label}</span>
                  {option.meta !== undefined && (
                    <span className={css.optionMeta}>{option.meta}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export interface MenuSubItem {
  key: string
  label: string
  disabled?: boolean
  onSelect: () => void
}

/** 溢出菜单的一项：普通项、分隔线、或带一列子项的二级项。 */
export type MenuEntry =
  | {
      kind: 'item'
      key: string
      label: string
      disabled?: boolean
      /** 破坏性动作（删除）：标红。 */
      danger?: boolean
      onSelect: () => void
    }
  | { kind: 'separator'; key: string }
  | {
      kind: 'submenu'
      key: string
      label: string
      disabled?: boolean
      items: readonly MenuSubItem[]
    }

export interface MenuButtonProps {
  /** 触发器的 `aria-label` 与它的悬浮提示（同源，免得两处写不一样）。 */
  label: string
  entries: readonly MenuEntry[]
  /** 浮层的 `data-testid`。触发器默认挂 `wl-more-trigger`（既有锚点，不许改名）。 */
  testId: string
  /**
   * 触发器的 `data-testid`。默认 `wl-more-trigger`；**页面上有第二个溢出菜单时必须给**，
   * 否则两个触发器同名，选择器指哪一个都说不清。
   */
  triggerTestId?: string
}

/**
 * `⋯` 溢出菜单：把低频动作从顶栏收进一层。
 *
 * 菜单项是真的 `<button role="menuitem">`，焦点在它们之间走（`↑`/`↓` 搬焦点、`Enter` 是按钮
 * 自己的 click、`Esc` 收起并把焦点还给触发器）。二级项（模板列表）**就地展开**成一列
 * `role="group"`，不做浮在旁边的子菜单：窄窗下旁边没地方放，就地展开不用算坐标。
 * @param props - 菜单项、触发器说明与测试锚点。
 */
export function MenuButton(props: MenuButtonProps): React.JSX.Element {
  const { label, entries, testId } = props
  const triggerTestId = props.triggerTestId ?? 'wl-more-trigger'
  const [expanded, setExpanded] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const { open, position, setOpen, reposition } = usePopover(triggerRef, popRef)

  /** 在菜单内的可点项之间搬焦点（跳过 disabled 与分隔线）。 */
  const moveFocus = useCallback((delta: number): void => {
    const pop = popRef.current
    if (pop === null) return
    const items = [...pop.querySelectorAll('[role="menuitem"]:not([disabled])')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    if (items.length === 0) return
    const focused = document.activeElement
    const currentIndex =
      focused instanceof HTMLElement && items.includes(focused) ? items.indexOf(focused) : -1
    const next =
      currentIndex === -1
        ? delta > 0
          ? 0
          : items.length - 1
        : (currentIndex + delta + items.length) % items.length
    items[next]?.focus()
  }, [])

  // 打开时焦点落在第一项上（键盘用户直接就能走）。
  useLayoutEffect(() => {
    if (open) moveFocus(1)
  }, [open, moveFocus])

  /*
   * 展开/收起子项会改浮层高度，重新量一次（不然翻转判断与夹边用的是旧高度）。
   *
   * **只重新量、不搬焦点**：用户点的是"从工作流模板新建"那一项，展开之后焦点还在它身上，
   * 再往下按 ↓ 才进子项；把焦点抢到别的项上，等于点一下跳一格。
   */
  useLayoutEffect(() => {
    if (open) reposition()
  }, [open, expanded, reposition])

  useEffect(() => {
    // 收起时把子菜单状态一并复位：下次打开是干净的一层。
    if (!open) setExpanded(null)
  }, [open])

  const renderSubItems = (items: readonly MenuSubItem[]): React.JSX.Element[] =>
    items.map((item) => (
      <div className={css.menuRow} key={item.key}>
        <Tooltip label={item.label}>
          <button
            type="button"
            role="menuitem"
            className={css.menuItem}
            disabled={item.disabled === true}
            onClick={() => {
              setOpen(false, true)
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        </Tooltip>
      </div>
    ))

  /** 三种 `kind` 各一支；将来加了第四种，`never` 那行会直接编译不过。 */
  const renderEntry = (entry: MenuEntry): React.JSX.Element | null => {
    switch (entry.kind) {
      case 'item':
        return (
          <div className={css.menuRow} key={entry.key}>
            <Tooltip label={entry.label}>
              <button
                type="button"
                role="menuitem"
                className={
                  entry.danger === true ? `${css.menuItem} ${css.menuItemDanger}` : css.menuItem
                }
                disabled={entry.disabled === true}
                onClick={() => {
                  setOpen(false, true)
                  entry.onSelect()
                }}
              >
                {entry.label}
              </button>
            </Tooltip>
          </div>
        )
      case 'separator':
        return <div className={css.menuSeparator} key={entry.key} role="separator" />
      case 'submenu': {
        const isExpanded = expanded === entry.key
        return (
          <div className={css.menuBlock} key={entry.key}>
            <div className={css.menuRow}>
              <Tooltip label={entry.label}>
                <button
                  type="button"
                  role="menuitem"
                  className={css.menuItem}
                  /*
                   * 二级项是**就地展开**（下面那个 `role="group"`），不是弹一个子菜单，
                   * 所以这里是披露（`aria-expanded`）而不是 `aria-haspopup="menu"`——
                   * 后者会让读屏软件去找一个并不存在的 `role="menu"` 子面板。
                   */
                  aria-expanded={isExpanded}
                  disabled={entry.disabled === true}
                  onClick={() => setExpanded(isExpanded ? null : entry.key)}
                >
                  <span className={css.menuLabel}>{entry.label}</span>
                  <span className={css.menuCaret} aria-hidden="true">
                    {isExpanded ? '▾' : '▸'}
                  </span>
                </button>
              </Tooltip>
            </div>
            {isExpanded && (
              <div className={css.submenu} role="group" aria-label={entry.label}>
                {renderSubItems(entry.items)}
              </div>
            )}
          </div>
        )
      }
      default: {
        const exhaustive: never = entry
        void exhaustive
        return null
      }
    }
  }

  return (
    <div className={css.root}>
      <Tooltip label={label}>
        <button
          type="button"
          className={css.iconTrigger}
          data-testid={triggerTestId}
          ref={triggerRef}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </Tooltip>
      {open && position !== null && (
        <div
          className={css.popover}
          data-testid={testId}
          ref={popRef}
          role="menu"
          aria-label={label}
          style={{ left: position.left, top: position.top, minWidth: position.minWidth }}
          onKeyDown={(event) => {
            switch (event.key) {
              case 'ArrowDown':
                event.preventDefault()
                moveFocus(1)
                return
              case 'ArrowUp':
                event.preventDefault()
                moveFocus(-1)
                return
              case 'Escape':
                event.preventDefault()
                setOpen(false, true)
                return
              case 'Tab':
                // 不抢焦点的话，被卸载的菜单项会把焦点丢给 `<body>`（后续按键全落空）。
                setOpen(false, true)
                return
              default:
                return
            }
          }}
        >
          {entries.map(renderEntry)}
        </div>
      )}
    </div>
  )
}
