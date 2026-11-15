/**
 * dsh-workflow-lite — 工作流中心各页左栏顶上的搜索框（运行实例、工作流、记忆、触发共用）。
 *
 * 清空按钮一直挂着、一直占着位置，有字时才淡出来：打第一个字时不插元素（打字是热路径），输入框也不变窄、字不挪。
 * 有字时按 Esc 先清掉字，再按一次才关工作流中心。
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

export function HubSearch(props: {
  t: T
  value: string
  placeholder: string
  testId?: string
  /** 搜索框右边同一行放的小按钮（比如工作流页的「导入」）。 */
  children?: React.ReactNode
  onChange(value: string): void
}): React.JSX.Element {
  const { t, value } = props
  const box = (
    <label className={hub.search}>
      <Icon name="search" size={14} />
      <input
        className={hub.searchInput}
        value={value}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        data-testid={props.testId ?? 'wl-hub-search'}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          // 有搜索词时 Esc 先清掉它，不让它冒上去把工作流中心关了；没有就不拦。
          if (event.key !== 'Escape' || value === '' || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          props.onChange('')
        }}
      />
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, hub.searchClear)}
        data-on={value !== ''}
        aria-label={t('hub.clearSearch')}
        onClick={() => props.onChange('')}
      >
        <Icon name="x" size={13} />
      </button>
    </label>
  )
  return (
    <div className={hub.searchBar}>
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
