/**
 * dsh-workflow-lite — 一小段字、一枚图标、一小块内容换了的时候，新旧两份滚动交接（{@link SwapText} / {@link SwapIcon} / {@link SwapNode} / {@link SwapRoll}）。
 * {@link useLast} 记着上一次的值，{@link useTrend} 判断数字是涨是跌。只动 `transform` / `opacity`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/swapText
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import { switching, useSwapSwitch } from './swapScope.tsx'
import css from './swapText.module.css'
import { diffText, type TextPart } from './textDiff.ts'

/** 换字、换图标时旧的留多久（和 swapText.module.css 的 swapOut / iconOut 一致）。 */
export const SWAP_TEXT_MS = 160
const SWAP_ICON_MS = 240
/** 整行滚动换的时长（同 swapText.module.css 的 rollIn / rollOut）。 */
const SWAP_ROLL_MS = 220
/** 切换时旧字留多久：最晚一层晚 130ms 开始、退 90ms，再留点余量。 */
const SWITCH_HOLD_MS = 420

/** 记住上一个值：变了的那次渲染里把旧值、换了几次一起记下，过一会儿把旧值清掉。 */
export function useLast<V>(value: V, ms: number): { was: V | null; n: number } {
  const [state, setState] = useState<{ value: V; was: V | null; n: number }>({
    value,
    was: null,
    n: 0,
  })
  if (value !== state.value) setState({ value, was: state.value, n: state.n + 1 })
  const { was, n } = state
  useEffect(() => {
    if (was === null) return
    const id = setTimeout(() => setState((s) => (s.n === n ? { ...s, was: null } : s)), ms)
    return () => clearTimeout(id)
  }, [was, n, ms])
  return { was, n }
}

/** 数字这一次是变大还是变小（`SwapText` 的 `dir` 要用）。变了的那次渲染里就定下来，之后保持到下一次变化。 */
export function useTrend(value: number): 'up' | 'down' {
  const [state, setState] = useState<{ value: number; dir: 'up' | 'down' }>({ value, dir: 'up' })
  if (value !== state.value) setState({ value, dir: value < state.value ? 'down' : 'up' })
  return state.dir
}

/** 换字的现状：现在的字、上一份（还在退场时）、换了几次、这次怎么换。 */
interface Swapping {
  value: string
  was: string | null
  n: number
  /** 切换时滚着换（方向）；平时 `null`。 */
  roll: 'up' | 'down' | null
  /** 切换时只换变了的那几段；整段换是 `null`。 */
  parts: readonly TextPart[] | null
  /** 最近一次是第几次切换时换的（{@link useRowSlide} 认这次换了的字）；平常换的是 `null`。 */
  serial: number | null
}

/**
 * 原地换一段字（「保存中… → 已保存」「没有问题 → 3 个问题」、数字）：旧字往上让开淡掉，新字从下面浮上来。
 * 旧字画在 `::after` 里（`content: attr(data-was)`），不进 DOM 文本——读 `innerText` 的地方只看到新字。
 * 换字时元素不重挂，只改文字和几个属性（`data-fresh` 在 a / b 之间切，两段 CSS 动画换个名字从头放）：
 * 宿主页面的 `:has` 样式让视图里任何插拔都整页重算样式，状态字在打字、拖动时一直在换，重挂一次就卡一下；
 * 也不用 `animate()`——它当场要样式，会把同一次提交里别处的改动一起逼着算一遍。
 * `pop`：数字用，新数字带一点回弹。
 * `dir`：`down` = 反方向——新字从上面落下来、旧字往下沉（数字减小时用，配 {@link useTrend}）；缺省 = 往上走。
 * `reserve`：会换到的所有字。给了就按最长的那段占宽，换字时外面的按钮不变宽变窄（点一下就换字的按钮要给）。
 *
 * 在 {@link SwapScope} 里、列表换了一项时：整行滚着换（上下裁着，方向跟着列表），只滚变了的那几个字
 * （{@link diffText}），各区块按 `data-swap-tier` 错开。`quiet`：平时变了直接换、不动（每秒走的倒计时），只在切换时滚。
 * `lead`：后面跟着东西（铅笔、小签）——字变长时，新字随着它们滑开一点点露出来（{@link revealText}）。
 */
export function SwapText(props: {
  text: string
  pop?: boolean
  dir?: 'up' | 'down'
  reserve?: readonly string[]
  quiet?: boolean
  lead?: boolean
}): React.JSX.Element {
  const swap = useSwapSwitch()
  const [state, setState] = useState<Swapping>({
    value: props.text,
    was: null,
    n: 0,
    roll: null,
    parts: null,
    serial: null,
  })
  if (props.text !== state.value) {
    const roll = switching(swap)
    setState(
      props.quiet === true && !roll
        ? { value: props.text, was: null, n: state.n, roll: null, parts: null, serial: null }
        : {
            value: props.text,
            was: state.value,
            n: state.n + 1,
            roll: roll ? (props.dir ?? swap.dir) : null,
            parts: roll ? diffText(state.value, props.text) : null,
            serial: roll ? swap.serial : null,
          },
    )
  }
  const { was, n, roll, parts } = state
  const hold = roll === null ? SWAP_TEXT_MS : SWITCH_HOLD_MS
  useEffect(() => {
    if (was === null) return
    const id = setTimeout(() => setState((s) => (s.n === n ? { ...s, was: null } : s)), hold)
    return () => clearTimeout(id)
  }, [was, n, hold])
  // 上一次切换时跟着横滑、只淡入淡出的（{@link useRowSlide} 标的）：这次换字先回到平常的换法。
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (n > 0) ref.current?.removeAttribute('data-swap-fade')
  }, [n])
  const dir = roll ?? props.dir
  return (
    <span
      ref={ref}
      className={css.swapText}
      data-swap-text=""
      data-swap-lead={props.lead === true || undefined}
      data-scoped={swap !== null || undefined}
      data-was={parts === null ? (was ?? undefined) : undefined}
      data-fresh={n === 0 ? undefined : n % 2 === 1 ? 'a' : 'b'}
      data-pop={props.pop === true || undefined}
      data-dir={dir === 'down' ? 'down' : undefined}
      data-roll={roll === null ? undefined : ''}
      data-swap-serial={state.serial ?? undefined}
      data-parts={parts === null ? undefined : ''}
    >
      {props.reserve?.map((text) => (
        <span key={text} className={css.swapSizer} data-text={text} aria-hidden="true" />
      ))}
      <span className={css.swapNow} data-swap-now="">
        {parts === null
          ? props.text
          : parts.map((part, i) =>
              part.was === undefined ? (
                part.text
              ) : (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: 段只按位置对应，换字时整组重排
                  key={i}
                  className={css.swapPart}
                  data-was={was === null || part.was === '' ? undefined : part.was}
                >
                  <span className={css.partNow}>{part.text}</span>
                </span>
              ),
            )}
      </span>
    </span>
  )
}

/**
 * 列表换了一项时，下面整块内容（列表、输入框，没法逐字换的）跟着方向从下面（往上换时从上面）浮上来，按 `data-swap-tier` 错开。
 * 不重挂、不留旧的影子：换属性重放 CSS 动画。返回的几样属性摊到那一块上（`className` 用 cx 合进去）。
 * 只在切换的那一下给动画名（a / b 轮换，连着两次切换也从头放）；别的时候挂上的不放。
 */
export function useSwapBlock(): {
  className: string
  'data-swap-block'?: 'a' | 'b'
  'data-dir'?: 'down'
} {
  const fresh = useSwapFresh()
  return {
    className: css.swapBlock,
    ...(fresh === null ? {} : { 'data-swap-block': fresh.name }),
    ...(fresh?.dir === 'down' ? { 'data-dir': 'down' as const } : {}),
  }
}

/**
 * 正在切换时，这一次的动画名（a / b 轮换）和方向；不在切换是 `null`。
 * 自己写进场动画的块（进程图：一行行出来、条从左边长出来）挂上它，CSS 按它放。
 */
export function useSwapFresh(): { name: 'a' | 'b'; dir: 'up' | 'down' } | null {
  const swap = useSwapSwitch()
  if (!switching(swap)) return null
  return { name: swap.serial % 2 === 1 ? 'a' : 'b', dir: swap.dir }
}

/**
 * 字变长、后面的东西正从原处滑开时，新字跟着露出来（不和还没让开的东西叠在一起）：
 * 外层往左挪 `by` 再回来、里层反着挪——字本身不动，外层的裁切右边缘正好跟着后面的东西走。
 * 只动 `translate`（不碰两层自己换字用的 `transform`）；`text` 是 {@link SwapText} 的根。
 */
export function revealText(text: HTMLElement, by: number, timing: KeyframeAnimationOptions): void {
  const now = text.querySelector<HTMLElement>(':scope > [data-swap-now]')
  const shift = (el: HTMLElement, from: number, pseudoElement?: string): void => {
    el.animate([{ translate: `${from}px 0` }, { translate: '0 0' }], {
      ...timing,
      fill: 'backwards',
      pseudoElement,
    })
  }
  shift(text, -by)
  if (now !== null) shift(now, by)
  shift(text, by, '::after')
}

/**
 * 原地换图标（复制 → ✓、对 ↔ 警告、太阳 ↔ 月亮）：两枚叠在同一格，新的从小放大淡入，旧的缩小淡出。
 * ✓ 一律用「成功」的绿色（复制路径、从磁盘重新加载等「已完成」的反馈都走这里），退场的那枚也一样。
 */
export function SwapIcon(props: { name: IconName; size?: number }): React.JSX.Element {
  const { was, n } = useLast(props.name, SWAP_ICON_MS)
  return (
    <span className={css.swapIcon}>
      {was !== null && (
        <span key={`out-${n}`} className={css.iconOut} data-ok={was === 'check' || undefined}>
          <Icon name={was} size={props.size} />
        </span>
      )}
      <span
        key={`in-${n}`}
        className={n > 0 ? css.iconIn : undefined}
        data-ok={props.name === 'check' || undefined}
      >
        <Icon name={props.name} size={props.size} />
      </span>
    </span>
  )
}

/**
 * 原地换一小块东西（文件的类型签这种有底色、有字的小件）：两份叠在同一格，新的从略小淡入，旧的略缩淡出。
 * `id` 变了才换（同一个 `id` 不动），`render` 按 `id` 画出那一块。
 */
export function SwapNode(props: {
  id: string
  render(id: string): React.ReactNode
}): React.JSX.Element {
  const { was, n } = useLast(props.id, SWAP_ICON_MS)
  return (
    <span className={css.swapIcon}>
      {was !== null && (
        <span key={`out-${n}`} className={css.nodeOut}>
          {props.render(was)}
        </span>
      )}
      <span key={`in-${n}`} className={n > 0 ? css.nodeIn : undefined}>
        {props.render(props.id)}
      </span>
    </span>
  )
}

/**
 * 整行换一行（下拉框里选中的那一项：名字 + 旁边的附注）：旧的一整行往上滚出去，新的一行从下面滚进来，上下裁着——
 * 两行从不叠在一起，不像 {@link SwapText} 那样中间几帧两份字叠成残影；名字和附注当一块换，附注不会被宽窄不同的名字先推一下。
 * `id` 变了才换，`render` 按 `id` 画出那一行。外面给 `className` 定排版（每一行都按它排）。
 */
export function SwapRoll(props: {
  id: string
  render(id: string): React.ReactNode
  className?: string
}): React.JSX.Element {
  const { was, n } = useLast(props.id, SWAP_ROLL_MS)
  return (
    <span className={css.roll}>
      {was !== null && (
        <span
          key={`out-${n}`}
          className={cx(css.rollLine, css.rollOut, props.className)}
          aria-hidden="true"
        >
          {props.render(was)}
        </span>
      )}
      <span key={`in-${n}`} className={cx(css.rollLine, n > 0 && css.rollIn, props.className)}>
        {props.render(props.id)}
      </span>
    </span>
  )
}
