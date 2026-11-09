/**
 * dsh-workflow-lite — 画布上的增删改：加步骤（含记忆选择）、就地添加、复制、记忆开关、删、换选中。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useStepEdit
 */

import { useCallback } from 'react'
import type { Point } from '../../../../shared/types.ts'
import { addFromSource, duplicateEdit, memoryToggle } from '../../../app/addStep.ts'
import type { HostAccess } from '../../../app/host.ts'
import { useMemories } from '../../../app/memories.ts'
import { useMemoryPick } from '../../../app/useMemoryPick.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { T } from '../../../i18n.ts'
import { findNode, type Selection } from '../../../model/editor.ts'
import type { LibraryFocus, StepSource } from '../../../model/library.ts'
import { nodeTitle } from '../../../model/nodeName.ts'
import type { AddRequest } from '../../canvas/Canvas.tsx'

export interface StepEditInput {
  t: T
  host: HostAccess
  rootRef: React.RefObject<HTMLDivElement>
  wf: Workflow
  state: Workflow['state']
  focusCanvas(): void
  setFocusPrompt: React.Dispatch<React.SetStateAction<boolean>>
  setQuick: React.Dispatch<React.SetStateAction<(AddRequest & { at: Point }) | null>>
  setFocus: React.Dispatch<React.SetStateAction<LibraryFocus | null>>
}

export function useStepEdit({
  t,
  host,
  rootRef,
  wf,
  state,
  focusCanvas,
  setFocusPrompt,
  setQuick,
  setFocus,
}: StepEditInput) {
  /** 加记忆、换一条记忆：弹「选已有的 / 新建」。 */
  const memoryPick = useMemoryPick({
    t,
    store: host.memories,
    doc: state.doc,
    workflow: state.name,
    root: rootRef,
    edit: wf.edit,
    notify: wf.notify,
  })
  const memories = useMemories(host.memories)
  const openMemoryPick = memoryPick.open

  const addStep = useCallback(
    async (source: StepSource, position: Point, from?: string): Promise<void> => {
      const step = source.kind !== 'resource' && source.kind !== 'input' && source.kind !== 'memory'
      // 新步骤会接管选中；之后任何一次换选中都会把这个标记清掉。
      if (step) setFocusPrompt(source.kind === 'blank')
      await addFromSource(
        {
          t,
          doc: state.doc,
          edit: wf.edit,
          loadTemplate: wf.loadTemplate,
          workflow: state.name,
          pickMemory: (request) =>
            openMemoryPick(
              request.type === 'step'
                ? { kind: 'step', step: request.step }
                : { kind: 'workflow', position: request.position },
            ),
        },
        source,
        position,
        from,
      )
      if (step && source.kind !== 'blank') focusCanvas()
    },
    [t, wf, focusCanvas, state.doc, state.name, openMemoryPick],
  )

  const requestAdd = useCallback((request: AddRequest): void => {
    const root = rootRef.current
    if (root === null) return
    const rect = root.getBoundingClientRect()
    setQuick({
      ...request,
      at: { x: request.client.x - rect.left, y: request.client.y - rect.top },
    })
  }, [])

  const duplicate = useCallback(
    (id: string): void => {
      const original = state.doc === null ? undefined : findNode(state.doc, id)
      const edit = duplicateEdit(state.doc, id, t('node.copySuffix'))
      if (original === undefined || edit === null) return
      wf.edit(edit)
      wf.notify(t('node.copied').replace('{name}', nodeTitle(original)))
    },
    [state.doc, wf, t],
  )

  /** 步骤卡上的记忆开关：开着就关；关着就弹「选已有的 / 新建」，贴着开关。 */
  const toggleMemory = useCallback(
    (step: string, anchor: Element): void => {
      const toggle = memoryToggle(state.doc, state.name, step)
      if (toggle === null) return
      if ('off' in toggle) wf.edit(toggle.off)
      else openMemoryPick({ kind: 'step', step: toggle.pick.step }, anchor)
    },
    [state.doc, state.name, wf, openMemoryPick],
  )

  /** 删一个节点：删完点名告诉一声，并提示能撤销（画布上它会原地淡出）。 */
  const removeNode = useCallback(
    (id: string): void => {
      const node = state.doc === null ? undefined : findNode(state.doc, id)
      wf.edit({ type: 'removeNode', id })
      if (node !== undefined) wf.notify(t('node.removed').replace('{name}', nodeTitle(node)))
    },
    [state.doc, wf, t],
  )

  const removeSelection = useCallback((): void => {
    const selection = state.selection
    if (selection === null) return
    if (selection.kind === 'node') removeNode(selection.id)
    else wf.edit({ type: 'removeEdge', id: selection.id })
    // 删掉的东西带走了焦点：收回画布，紧接着的 Ctrl+Z 才有人接。
    focusCanvas()
  }, [state.selection, wf, focusCanvas, removeNode])

  const select = useCallback(
    (selection: Selection): void => {
      setFocusPrompt(false)
      setFocus(null)
      wf.select(selection)
    },
    [wf],
  )
  return {
    memoryPick,
    memories,
    openMemoryPick,
    addStep,
    requestAdd,
    duplicate,
    toggleMemory,
    removeNode,
    removeSelection,
    select,
  }
}
