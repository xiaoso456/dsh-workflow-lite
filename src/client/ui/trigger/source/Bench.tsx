/**
 * dsh-workflow-lite — 「触发方式」对话框右边下半的「工作台」：五种方式同一个外形，放「按这些设置会怎样 / 动手试一试」。
 * 顶上一条（图标 + 名字，中间可以放页签，右边是动作），中间是内容（多了在框里滚），底下一行写现在的情况或说明。
 *
 * 占满设置行下面剩下的高度：换一种方式，框的位置、大小不变，只换里面的东西。
 *
 * 顶栏右边的按钮靠右排：哪一个的字换了（选了模板、换了 shell），它贴着右边展开收起（{@link BenchFace}），
 * 左边被挤动的按钮一起滑过去（useRowSlide），不跳。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/Bench
 */

import { useCallback } from 'react'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import { useGlide, useRowSlide } from '../../motion/exits.tsx'
import { FadeText } from '../../motion/marks.tsx'
import { SwapText } from '../../motion/swapText.tsx'
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
  /** 中间不滚：内容铺满、自己按剩下的高度伸缩（接下来 7 天），框最矮到内容压到最紧时的高度。 */
  fill?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const row = useRowSlide()
  return (
    <section className={css.bench} data-fill={props.fill === true} data-testid={props.testId}>
      <header className={css.head}>
        <span className={css.title}>
          <Icon name={props.icon} size={13} />
          {props.title}
        </span>
        {props.middle}
        <span ref={row} className={css.tools}>
          {props.tools}
        </span>
      </header>
      <div className={css.body} data-split={props.split === true} data-fill={props.fill === true}>
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

/**
 * 顶栏里字会换的下拉按钮（「从模板开始」→ 模板名、shell 名）的里子：底面、图标、字、下拉箭头。
 * 按钮要带 {@link benchMenu}（边框、底色不画在按钮上，画在底面上）。字一换，按钮贴着右边、
 * 底面横向展开收起，图标滑到新位置（useGlide，不等：是点了才换的）；字原地换。
 */
export function BenchFace(props: { icon?: IconName; text: string }): React.JSX.Element {
  const glide = useGlide(0, 'right')
  // 底面挂上时把按钮交给 useGlide：按钮由调用方画（Popover 的触发按钮、ShellButton），这里拿不到它的 ref。
  const attach = useCallback(
    (surface: HTMLSpanElement | null) => glide(surface?.parentElement ?? null),
    [glide],
  )
  return (
    <>
      <span ref={attach} className={css.surface} data-glide-surface="" aria-hidden="true" />
      {props.icon !== undefined && (
        <span className={css.faceIcon} data-glide="">
          <Icon name={props.icon} size={12} />
        </span>
      )}
      <span className={css.faceText} data-glide="">
        <SwapText text={props.text} />
      </span>
      <Icon name="chevronDown" size={12} />
    </>
  )
}

/** 工作台顶上一条里的按钮：细边小按钮；`primary` 用触发方式的颜色（试运行、发测试请求）。 */
export const benchButton = css.button
export const benchPrimary = css.primary
/** 里子是 {@link BenchFace} 的按钮（和 {@link benchButton} 一起给）。 */
export const benchMenu = css.menuButton
/** 顶上一条右边的灰字。 */
export const benchAside = css.aside
