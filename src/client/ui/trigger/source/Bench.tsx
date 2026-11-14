/**
 * dsh-workflow-lite — 「触发方式」对话框右边下半的「工作台」：五种方式同一个外形，放「按这些设置会怎样 / 动手试一试」。
 * 顶上一条（图标 + 名字，中间可以放页签，右边是动作），中间是内容（多了在框里滚），底下一行写现在的情况或说明。
 *
 * 占满设置行下面剩下的高度：换一种方式，框的位置、大小不变，只换里面的东西。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/Bench
 */

import { Icon, type IconName } from '../../kit/Icon.tsx'
import { FadeText } from '../../motion/marks.tsx'
import { PickThumb } from '../../motion/thumb.tsx'
import css from './bench.module.css'

export function Bench(props: {
  icon: IconName
  title: React.ReactNode
  /** 名字后面的一段（页签）。 */
  middle?: React.ReactNode
  /** 右边的动作、灰字。 */
  tools?: React.ReactNode
  /** 底下一行；没有就不画这一行。 */
  foot?: React.ReactNode
  testId?: string
  /** 中间不整块滚：内容自己分好哪一段在框里滚（命令框不动、输出滚）。 */
  split?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={css.bench} data-testid={props.testId}>
      <header className={css.head}>
        <span className={css.title}>
          <Icon name={props.icon} size={13} />
          {props.title}
        </span>
        {props.middle}
        <span className={css.tools}>{props.tools}</span>
      </header>
      <div className={css.body} data-split={props.split === true}>
        {props.children}
      </div>
      {props.foot !== undefined && <footer className={css.foot}>{props.foot}</footer>}
    </section>
  )
}

/**
 * 工作台里的页签：选中那格下面的滑块滑过去，字色交叉淡过去。
 * `off` 的一页暂时没有内容：点不动，悬停说为什么（不用 `disabled`，不然悬停提示出不来）。
 */
export function BenchTabs<V extends string>(props: {
  label: string
  value: V
  options: readonly { value: V; label: string; off?: string; testId?: string }[]
  onChange(value: V): void
}): React.JSX.Element {
  return (
    <div className={css.tabList} role="tablist" aria-label={props.label}>
      <PickThumb layout={props.value} item='[aria-selected="true"]' className={css.tabThumb} />
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === props.value}
          aria-disabled={option.off === undefined ? undefined : true}
          className={css.tab}
          data-tip={option.off}
          data-testid={option.testId}
          onClick={() => {
            if (option.off === undefined) props.onChange(option.value)
          }}
        >
          <FadeText text={option.label} on={option.value === props.value} />
        </button>
      ))}
    </div>
  )
}

/** 工作台顶上一条里的按钮：细边小按钮；`primary` 用触发方式的颜色（试运行、发测试请求）。 */
export const benchButton = css.button
export const benchPrimary = css.primary
/** 顶上一条右边的灰字。 */
export const benchAside = css.aside
