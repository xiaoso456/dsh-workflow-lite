/**
 * dsh-workflow-lite — 列表里换了一项、右栏版式不变只换内容时，里面各处换字的节奏（{@link SwapScope}）。
 *
 * 包在右栏外面，给 `id`（选中的那一项）和 `order`（它在列表里排第几）。`id` 一换就是一次切换：
 * - 方向：往列表下面换，新字从下面滚上来；往上面换，从上面落下来（{@link SwapText} 读它）；
 * - 错峰：各区块标 `data-swap-tier="0…5"`，CSS 换成 `--wl-swap-delay`，从上到下一层层晚一点开始；
 * - 跟着滑：会变长短的字后面的东西（{@link useRowSlide}）、小签的底色（MorphTag）在切换时等字先换、
 *   按同一条缓动滑过去，字变长时新字跟着露出来。
 * 切换之外（数据自己变了、每秒走的倒计时）照旧，不受它管。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/swapScope
 */

import { createContext, type ReactNode, useContext, useState } from 'react'

/** 一次切换：第几次、往哪个方向、什么时候（`performance.now()`）。 */
export interface SwapSwitch {
  serial: number
  dir: 'up' | 'down'
  at: number
}

/** 切换时的节奏（毫秒），和 swapText.module.css 的 roll 几段一致。 */
export const SWITCH = {
  /** 旧字退场。 */
  out: 90,
  /** 新字进场。 */
  in: 200,
  /** 新字在旧字退到六成时开始进。 */
  enterAt: 54,
  /** 后面跟着的东西滑多久。 */
  glide: 320,
} as const

/** 跟着滑的缓动：起步干脆、落位很软。 */
export const EASE_GLIDE = 'cubic-bezier(0.25, 0.8, 0.25, 1)'

/** 切换后多久之内变的都算这次切换（数据晚一点读到的也跟着同一个方向滚）。 */
const SWITCH_WINDOW_MS = 400

const SwapContext = createContext<SwapSwitch | null>(null)

export function SwapScope(props: { id: string; order: number; children: ReactNode }): ReactNode {
  const [state, setState] = useState(() => ({
    id: props.id,
    order: props.order,
    swap: { serial: 0, dir: 'up', at: Number.NEGATIVE_INFINITY } as SwapSwitch,
  }))
  if (props.id === state.id && props.order !== state.order) {
    // 同一项在列表里挪了位置（换了排法）：只记下新位置，下次切换按它定方向。
    setState({ ...state, order: props.order })
  } else if (props.id !== state.id) {
    setState({
      id: props.id,
      order: props.order,
      swap: {
        serial: state.swap.serial + 1,
        dir: props.order < state.order ? 'down' : 'up',
        at: performance.now(),
      },
    })
  }
  return <SwapContext.Provider value={state.swap}>{props.children}</SwapContext.Provider>
}

/** 外面最近一次切换（不在 {@link SwapScope} 里是 `null`；还没切换过是第 0 次、时间是负无穷）。 */
export function useSwapSwitch(): SwapSwitch | null {
  return useContext(SwapContext)
}

/** 这会儿是不是正在切换（切换后一小段时间之内）。 */
export function switching(swap: SwapSwitch | null): swap is SwapSwitch {
  return swap !== null && performance.now() - swap.at < SWITCH_WINDOW_MS
}

/** 每往下一层晚多少开始（毫秒），和 swapText.module.css 里各层的 `--wl-swap-delay` 一致。 */
export const TIER_STEP_MS = 26

/**
 * 这一块在第几层晚多少开始（最近的 `data-swap-tier` 换算，毫秒）。
 * 按属性算，不读 `--wl-swap-delay` 的计算值：切换时一排排挨个放动画，每读一次计算样式就逼整页样式重算一遍。
 */
export function swapDelay(el: Element): number {
  const tier = Number(el.closest<HTMLElement>('[data-swap-tier]')?.dataset.swapTier ?? 0)
  return Number.isFinite(tier) ? tier * TIER_STEP_MS : 0
}
