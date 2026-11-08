/**
 * dsh-workflow-lite — 一小段字、一枚图标、一小块内容换了的时候，新旧两份滚动交接（{@link SwapText} / {@link SwapIcon} / {@link SwapNode}）。
 * {@link useLast} 记着上一次的值，{@link useTrend} 判断数字是涨是跌。只动 `transform` / `opacity`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/swapText
 */

import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'

/** 换字、换图标时旧的留多久（和 ui.module.css 的 swapOut / iconOut 一致）。 */
const SWAP_TEXT_MS = 160
const SWAP_ICON_MS = 240

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

/**
 * 原地换一段字（「保存中… → 已保存」「没有问题 → 3 个问题」、数字）：旧字往上让开淡掉，新字从下面浮上来。
 * 旧字画在 `::after` 里（`content: attr(data-was)`），不进 DOM 文本——读 `innerText` 的地方只看到新字。
 * `pop`：数字用，新数字带一点回弹。
 * `dir`：`down` = 反方向——新字从上面落下来、旧字往下沉（数字减小时用，配 {@link useTrend}）；缺省 = 往上走。
 * `reserve`：会换到的所有字。给了就按最长的那段占宽，换字时外面的按钮不变宽变窄（点一下就换字的按钮要给）。
 */
export function SwapText(props: {
  text: string
  pop?: boolean
  dir?: 'up' | 'down'
  reserve?: readonly string[]
}): React.JSX.Element {
  const { was, n } = useLast(props.text, SWAP_TEXT_MS)
  return (
    <span
      // 每换一次重新挂：两段动画都从头放。
      key={n}
      className={ui.swapText}
      data-was={was ?? undefined}
      data-fresh={n > 0 || undefined}
      data-pop={props.pop === true || undefined}
      data-dir={props.dir === 'down' ? 'down' : undefined}
    >
      {props.reserve?.map((text) => (
        <span key={text} className={ui.swapSizer} data-text={text} aria-hidden="true" />
      ))}
      <span className={ui.swapNow}>{props.text}</span>
    </span>
  )
}

/**
 * 原地换图标（复制 → ✓、对 ↔ 警告、太阳 ↔ 月亮）：两枚叠在同一格，新的从小放大淡入，旧的缩小淡出。
 * ✓ 一律用「成功」的绿色（复制路径、从磁盘重新加载等「已完成」的反馈都走这里），退场的那枚也一样。
 */
export function SwapIcon(props: { name: IconName; size?: number }): React.JSX.Element {
  const { was, n } = useLast(props.name, SWAP_ICON_MS)
  return (
    <span className={ui.swapIcon}>
      {was !== null && (
        <span key={`out-${n}`} className={ui.iconOut} data-ok={was === 'check' || undefined}>
          <Icon name={was} size={props.size} />
        </span>
      )}
      <span
        key={`in-${n}`}
        className={n > 0 ? ui.iconIn : undefined}
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
    <span className={ui.swapIcon}>
      {was !== null && (
        <span key={`out-${n}`} className={ui.nodeOut}>
          {props.render(was)}
        </span>
      )}
      <span key={`in-${n}`} className={n > 0 ? ui.nodeIn : undefined}>
        {props.render(props.id)}
      </span>
    </span>
  )
}
