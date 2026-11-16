/**
 * dsh-workflow-lite — 菜单（一列 `menuitemradio` 或 `menuitem`）的键盘：打开时焦点落在选中项上，上下键在项之间走（首尾相接）。
 * 下拉选择（Select）和别处带说明的单选菜单共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/useRadioMenu
 */

import { type RefObject, useEffect } from 'react'

const ITEM = '[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]'

/**
 * 返回挂在菜单（或连同菜单顶上的搜索框）外层的 `onKeyDown`：焦点在搜索框里时，下键进第一项、上键进最后一项。
 * @param focusPicked - 打开时把焦点放到选中项上；`false`（菜单带搜索框，焦点在框里）只把选中项滚进视野。
 */
export function useRadioMenu(
  open: boolean,
  list: RefObject<HTMLElement | null>,
  focusPicked = true,
): (event: React.KeyboardEvent) => void {
  useEffect(() => {
    if (!open) return
    const items = list.current?.querySelectorAll<HTMLElement>(ITEM)
    const picked = [...(items ?? [])].find((item) => item.getAttribute('aria-checked') === 'true')
    if (focusPicked) (picked ?? items?.[0])?.focus()
    else picked?.scrollIntoView({ block: 'nearest' })
  }, [open, list, focusPicked])

  return (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(list.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    if (at < 0) items[step > 0 ? 0 : items.length - 1]?.focus()
    else items[(at + step + items.length) % items.length]?.focus()
  }
}
