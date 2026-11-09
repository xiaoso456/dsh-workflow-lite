/**
 * dsh-workflow-lite — 视图根上的快捷键：撤销重做、复制、删除、看全图、整理；输入框里一律让开。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/handleKeyDown
 */

import type { Workflow } from '../../../app/useWorkflow.ts'
import type { Selection } from '../../../model/editor.ts'

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** 键盘事件是不是打在输入控件里（那里的 Ctrl+Z / Delete 属于文本）。 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return TYPING.has(target.tagName) || target.isContentEditable
}

export interface KeyDownContext {
  state: Workflow['state']
  runId: string | null
  /** 就地添加的菜单开着没有（Esc 先关它）。 */
  quick: unknown
  setQuick(value: null): void
  select(selection: Selection): void
  wf: Workflow
  duplicate(id: string): void
  removeSelection(): void
  fitAll(): void
  relayout(): void
}

export function handleKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  {
    state,
    runId,
    quick,
    setQuick,
    select,
    wf,
    duplicate,
    removeSelection,
    fitAll,
    relayout,
  }: KeyDownContext,
): void {
  if (state.phase !== 'ready' || runId !== null) return
  const typing = isTyping(event.target)
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (key === 'escape') {
    if (typing) return
    if (quick !== null) setQuick(null)
    else select(null)
    return
  }
  if (typing) return
  if (mod && (key === 'z' || key === 'y')) {
    event.preventDefault()
    if (key === 'y' || event.shiftKey) wf.redo()
    else wf.undo()
    return
  }
  if (mod && key === 'd') {
    event.preventDefault()
    if (state.selection?.kind === 'node') duplicate(state.selection.id)
    return
  }
  // 其余修饰键组合留给宿主（浏览器查找之类）。
  if (mod || event.altKey) return
  if (key === 'delete' || key === 'backspace') {
    if (state.selection === null) return
    event.preventDefault()
    removeSelection()
    return
  }
  if (key === 'f') {
    event.preventDefault()
    fitAll()
    return
  }
  if (key === 'l') {
    event.preventDefault()
    relayout()
  }
}
