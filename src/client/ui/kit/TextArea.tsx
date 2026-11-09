/**
 * dsh-workflow-lite — 多行输入框：用起来和受控的 `<textarea value onChange>` 一样，打字时只改 `.value`，不动 DOM 子节点。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/TextArea
 */

import { forwardRef, useCallback, useLayoutEffect, useRef } from 'react'

type TextAreaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'defaultValue' | 'onChange'
> & {
  value: string
  onChange(event: React.ChangeEvent<HTMLTextAreaElement>): void
}

/**
 * React 的受控 textarea 每次值变了都会改写 `defaultValue`，等于换掉框里的文字子节点；
 * 宿主页面的 `:has` 样式让视图里任何子节点增删都整页重算样式（大图上一次几百毫秒），每敲一个字就卡一下。
 * 这里内容交给 DOM 自己管：不给 `value`，也不给 `defaultValue`（React 每次渲染都会把它写一遍），
 * 外面的值和框里不一样时才在画出来之前写 `.value`（挂载、取消、重置、换了编辑对象）。
 * 自己打的字不回写，光标、选区、撤销都不受影响；
 * `onChange` 里调用方把值改了（去换行、截断）或没收下这次输入时，和受控框一样改回外面的值。
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { value, onChange, ...rest },
  ref,
) {
  const own = useRef<HTMLTextAreaElement | null>(null)
  const latest = useRef(value)
  latest.current = value
  useLayoutEffect(() => {
    const el = own.current
    if (el !== null && el.value !== value) el.value = value
  }, [value])
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null): void => {
      own.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref !== null) ref.current = el
    },
    [ref],
  )
  return (
    <textarea
      {...rest}
      ref={setRef}
      onChange={(event) => {
        onChange(event)
        // 事件里的同步更新这时已经渲染完：外面的值仍和框里不同，说明这次输入没被原样收下。
        const el = event.currentTarget
        queueMicrotask(() => {
          if (el.value !== latest.current) el.value = latest.current
        })
      }}
    />
  )
})
