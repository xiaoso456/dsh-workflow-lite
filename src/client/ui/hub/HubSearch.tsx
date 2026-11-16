/**
 * dsh-workflow-lite — 工作流中心各页左栏顶上的搜索框（运行实例、工作流、记忆、触发共用）。
 *
 * 一个 28 高的框装下：放大镜、输入框、清空、当前筛选（小片，点它取消）、视图选项按钮；导入这类动作放在框外
 * （`children`）。筛选不再单占一行蓝条，左栏顶上省出一行。
 *
 * 清空按钮一直挂着、一直占着位置，有字时才淡出来：打第一个字时不插元素（打字是热路径），输入框也不变窄、字不挪。
 * 有字时按 Esc 先清掉字，再按一次才关工作流中心。
 *
 * 框是 div 不是 label：视图菜单挂在框里（不走 portal），点菜单的空白处不能把焦点抢回输入框。
 * 只有放大镜加输入框那一截是 label，点它聚焦输入框。
 *
 * 外面包一层，和下面的列表（wf.sideList）在右边留同样宽的滚动条位置（`--wl-scrollbar`）：
 * 搜索框右边、右边的小按钮和列表里的行右边对齐。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/HubSearch
 */

import type { T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import hub from './hub.module.css'

/** 生效着的筛选：框里一个小片写筛法，悬停看「筛法 · 几个」，点它回到「全部」。 */
export interface SearchFilter {
  label: string
  count: number
  testId: string
  onClear(): void
}

/** 生效着的筛选的小片：写筛法，悬停看「筛法 · 几个」，点它回到「全部」。 */
export function FilterChip(props: { t: T; filter: SearchFilter }): React.JSX.Element {
  const { t, filter } = props
  return (
    <button
      type="button"
      className={cx(hub.filterChip, ui.fade)}
      aria-label={`${filter.label} · ${t('hub.clearShow')}`}
      data-tip={t('hub.showing')
        .replace('{label}', filter.label)
        .replace('{n}', String(filter.count))}
      data-testid={filter.testId}
      onClick={filter.onClear}
    >
      <span className={hub.filterLabel}>{filter.label}</span>
      <Icon name="x" size={10} />
    </button>
  )
}

export function HubSearch(props: {
  t: T
  value: string
  placeholder: string
  testId?: string
  /** 框里最右边的按钮（视图选项）。 */
  view?: React.ReactNode
  /** 生效着的筛选；没有就不挂小片。 */
  filter?: SearchFilter
  /** 框外右边同一行的小按钮（比如工作流页的「导入」）。 */
  children?: React.ReactNode
  /** 挂上就把焦点放进框里（下拉一打开就是为了找）。 */
  autoFocus?: boolean
  /** 放在菜单里：不留四周的空和滚动条的位置，和菜单里的行对齐。 */
  flush?: boolean
  onChange(value: string): void
}): React.JSX.Element {
  const { t, value, filter } = props
  const box = (
    <div className={hub.search}>
      <label className={hub.searchField}>
        <Icon name="search" size={13} />
        <input
          className={hub.searchInput}
          value={value}
          placeholder={props.placeholder}
          aria-label={props.placeholder}
          data-testid={props.testId ?? 'wl-hub-search'}
          // biome-ignore lint/a11y/noAutofocus: 只在下拉里给（打开下拉就是为了找）
          autoFocus={props.autoFocus}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            // 有搜索词时 Esc 先清掉它，不让它冒上去把工作流中心关了；没有就不拦。
            if (event.key !== 'Escape' || value === '' || event.nativeEvent.isComposing) return
            event.preventDefault()
            event.stopPropagation()
            props.onChange('')
          }}
        />
      </label>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, hub.searchClear)}
        data-on={value !== ''}
        aria-label={t('hub.clearSearch')}
        onClick={() => props.onChange('')}
      >
        <Icon name="x" size={12} />
      </button>
      {filter !== undefined && <FilterChip t={t} filter={filter} />}
      {props.view}
    </div>
  )
  return (
    <div className={hub.searchBar} data-flush={props.flush === true || undefined}>
      {props.children === undefined ? (
        box
      ) : (
        <div className={hub.searchRow}>
          {box}
          {props.children}
        </div>
      )}
    </div>
  )
}
