/**
 * dsh-workflow-lite — 工作流中心各页左栏顶上的搜索框（运行实例、工作流、记忆共用）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubSearch
 */

import type { T } from '../i18n.ts'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

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
      />
      {value !== '' && (
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.fade)}
          aria-label={t('hub.clearSearch')}
          onClick={() => props.onChange('')}
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </label>
  )
  if (props.children === undefined) return box
  return (
    <div className={hub.searchRow}>
      {box}
      {props.children}
    </div>
  )
}
