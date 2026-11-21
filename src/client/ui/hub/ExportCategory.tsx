/**
 * dsh-workflow-lite — 导出清单里的一类：可展开的标题行（右端可带打包开关）+ 下面逐项的清单。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/ExportCategory
 */

import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { Presence } from '../motion/exits.tsx'
import css from './hubExport.module.css'
import pack from './pack.module.css'

/**
 * 点击标题或最右的箭头展开 / 收起清单，箭头左边的打包开关单独操作。
 * 这类一项都没有时也照样摆出来，写「无」，不能展开。
 */
export function ExportCategory(props: {
  icon: IconName
  title: string
  stats: string
  empty: boolean
  expanded: boolean
  onExpand(open: boolean): void
  /** 不给 = 这类没有可打包的说法（网址、自定义、资料目录），不放开关。 */
  switch?: { on: boolean; disabled: boolean; onChange(on: boolean): void }
  children: React.ReactNode
  testId: string
}): React.JSX.Element {
  const open = props.expanded && !props.empty
  const lit = props.switch === undefined ? !props.empty : props.switch.on
  return (
    <section className={pack.section} data-testid={props.testId}>
      <div className={css.catHead}>
        <button
          type="button"
          className={css.catToggle}
          aria-expanded={open}
          disabled={props.empty}
          data-testid={`${props.testId}-toggle`}
          onClick={() => props.onExpand(!props.expanded)}
        >
          <span className={css.catLabel}>
            <span className={css.catIcon} data-on={lit}>
              <Icon name={props.icon} size={14} />
            </span>
            <span className={css.catTitle}>{props.title}</span>
            <span className={css.catStats}>{props.stats}</span>
          </span>
          {!props.empty && (
            <span className={css.catChevron} data-opened={open} aria-hidden="true">
              <Icon name="chevronRight" size={14} />
            </span>
          )}
        </button>
        {props.switch !== undefined && (
          <button
            type="button"
            role="switch"
            aria-checked={props.switch.on}
            aria-label={props.title}
            className={cx(ui.switch, css.catSwitch)}
            disabled={props.switch.disabled}
            data-testid={`${props.testId}-switch`}
            onClick={() => props.switch?.onChange(!props.switch.on)}
          >
            <span className={ui.knob} />
          </button>
        )}
        <span className={css.catRule} aria-hidden="true" />
      </div>
      <Presence show={open}>
        <div className={pack.catBody}>{props.children}</div>
      </Presence>
    </section>
  )
}
