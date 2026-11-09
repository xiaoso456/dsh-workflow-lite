/**
 * dsh-workflow-lite — 输入框的「草稿 + 停手才生效」：打字先存草稿，停一阵生效，回车立刻生效，Esc 撤回这次输入。
 *
 * 筛选框（FilterField）和名字筛选框（MatchField）共用；怎么把文字变成设置值、写不写回，由各自的 `apply` 决定。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/files/useDelayedCommit
 */

import { useEffect, useRef, useState } from 'react'

/** 接到 `<input>` 上的四个属性。 */
export interface DelayedInputProps {
  value: string
  onChange(event: React.ChangeEvent<HTMLInputElement>): void
  onBlur(): void
  onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void
}

/** {@link useDelayedCommit} 的返回。 */
export interface DelayedCommit {
  /** 框里现在显示的字：有草稿用草稿，否则用已生效的。 */
  text: string
  /** 放弃等着的计时器、丢掉草稿（`apply` 里写回设置前先调）。 */
  settle(): void
  /**
   * 接到输入框上：打字存草稿并重新计时，停手 `delay` 毫秒后调 `apply(草稿)`；
   * 失焦、回车也调 `apply`（回车用框里的字，失焦只在有草稿时）；Esc 在有草稿时撤回并拦住冒泡。
   */
  bind(apply: (text: string) => void): DelayedInputProps
}

/**
 * 输入框的草稿与计时。`committed` 是已生效的文字（没有就传空串），`delay` 是停手多久生效（毫秒）。
 * 卸载时清掉还没到点的计时器。
 */
export function useDelayedCommit(committed: string, delay: number): DelayedCommit {
  const [draft, setDraft] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const text = draft ?? committed
  const cancel = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const settle = (): void => {
    cancel()
    setDraft(null)
  }
  useEffect(() => cancel, [])
  return {
    text,
    settle,
    bind: (apply) => ({
      value: text,
      onChange: (event) => {
        const next = event.currentTarget.value
        setDraft(next)
        cancel()
        timer.current = window.setTimeout(() => apply(next), delay)
      },
      onBlur: () => {
        if (draft !== null) apply(draft)
      },
      onKeyDown: (event) => {
        if (event.key === 'Enter') apply(text)
        if (event.key === 'Escape' && draft !== null) {
          // 只撤掉这次输入，不连带收起浮层。
          event.stopPropagation()
          settle()
        }
      },
    }),
  }
}
