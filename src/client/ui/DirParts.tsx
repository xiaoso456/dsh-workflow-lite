/**
 * dsh-workflow-lite — 看目录的几块共用部件：选择文件 / 文件夹的对话框（{@link HostPicker}）
 * 和实例里的文件夹浏览（{@link FolderBrowser}）长得一样、动得一样，就是因为用的是这几块。
 *
 * - {@link PathBar}：路径栏。一级一个单元，长出一级就从前一级背后展开、缩短就收回去（{@link useTrail}）；
 *   可以把整条换成别的（选择框里的「输入路径」）、右边挂一个按钮；
 * - {@link FilterBar}：筛选框 + 「隐藏项」开关，框里右侧可以放一小段说明（数量）；
 * - {@link UpRow}：列表第一行的「上一级」，右边淡淡写出上一级是哪儿。
 *
 * 样式在 `picker.module.css`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DirParts
 */

import { Icon } from './Icon.tsx'
import { FadeText } from './motion.tsx'
import css from './picker.module.css'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

/** 路径栏里的一级。`onGo` 缺省就只是个字（折起来的「…」）。 */
export interface Crumb {
  key: string
  label: string
  onGo?: () => void
}

export function PathBar(props: {
  label: string
  crumbs: readonly Crumb[]
  /** 挂 {@link useTrail} 返回的回调 ref，要滚动面包屑的也从这里拿到元素。 */
  navRef?: (node: HTMLElement | null) => void
  /** 有它就替换整条面包屑（选择框里敲路径的输入框）。 */
  editor?: React.ReactNode
  /** 右边的按钮。 */
  action?: React.ReactNode
  /** 不画框：路径直接写在面板上（文件夹浏览用）。 */
  plain?: boolean
  style?: React.CSSProperties
  testId?: string
}): React.JSX.Element {
  return (
    <div
      className={css.bar}
      style={props.style}
      data-plain={props.plain === true ? 'true' : undefined}
      data-testid={props.testId}
    >
      {props.editor ?? (
        <nav className={css.crumbs} ref={props.navRef} aria-label={props.label}>
          {/* 一级一个单元（分隔箭头 + 名字）：长出一级就从前一级背后展开，缩短就收回前一级背后（见 useTrail）；前面的盖在后面的上面。 */}
          {props.crumbs.map((crumb, index, all) => (
            <span
              key={crumb.key}
              className={css.crumbUnit}
              style={{ zIndex: all.length - index + 1 }}
            >
              {index > 0 && (
                <span className={css.crumbSep} aria-hidden="true">
                  <Icon name="chevronRight" size={12} />
                </span>
              )}
              {crumb.onGo === undefined ? (
                <span className={css.crumb} data-static="true">
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  className={css.crumb}
                  aria-current={index === all.length - 1 ? 'location' : undefined}
                  onClick={crumb.onGo}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}
      {props.action}
    </div>
  )
}

export function FilterBar(props: {
  value: string
  placeholder: string
  onChange(value: string): void
  hiddenLabel: string
  hidden: boolean
  onHidden(): void
  inputRef?: React.Ref<HTMLInputElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  /** 框里右边的一小段字（几项）。 */
  trailing?: React.ReactNode
  /** 不描边：淡底的搜索框、无框的开关（文件夹浏览用）。 */
  plain?: boolean
  style?: React.CSSProperties
  testId?: string
}): React.JSX.Element {
  return (
    <div
      className={css.tools}
      style={props.style}
      data-plain={props.plain === true ? 'true' : undefined}
    >
      <span className={css.filterBox}>
        <Icon name="search" size={13} />
        <input
          ref={props.inputRef}
          className={css.filter}
          value={props.value}
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          spellCheck={false}
          data-testid={props.testId}
          onKeyDown={props.onKeyDown}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
        {props.trailing}
      </span>
      <button
        type="button"
        className={cx(css.hiddenToggle, ui.fillOn)}
        aria-pressed={props.hidden}
        data-on={props.hidden}
        onClick={props.onHidden}
      >
        <FadeText text={props.hiddenLabel} on={props.hidden} />
      </button>
    </div>
  )
}

export function UpRow(props: {
  label: string
  /** 右边淡淡写出上一级是哪儿。 */
  meta: string
  tip: string
  testId?: string
  tabIndex?: number
  onClick(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cx(css.row, css.upRow)}
      data-testid={props.testId}
      data-tip={props.tip}
      tabIndex={props.tabIndex}
      onClick={props.onClick}
    >
      <span className={cx(css.entryIcon, css.upIcon)}>
        <Icon name="arrowRight" size={14} />
      </span>
      <span className={css.upName}>{props.label}</span>
      <span className={css.rowMeta}>{props.meta}</span>
    </button>
  )
}
