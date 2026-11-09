/**
 * dsh-workflow-lite — 实例画布上的运行装饰：每个步骤此刻的状态、走过的线、文件在不在，
 * 以及点卡片上状态小标时弹出改状态菜单的位置。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/runView/buildRunDecor
 */

import type { RunCursor } from '../../../../shared/runCursor.ts'
import { type RunState, takenEdges } from '../../../../shared/runState.ts'
import type { WorkflowDocument } from '../../../../shared/types.ts'
import type { Run } from '../../../app/useRuns.ts'
import type { T } from '../../../i18n.ts'
import type { RunDecor, RunNodeDecor } from '../../canvas/Canvas.tsx'
import type { RunMark } from '../../canvas/types.ts'
import { GAP, MENU_W } from './geometry.ts'

export interface RunDecorInput {
  doc: WorkflowDocument
  shown: RunState | null
  cursor: RunCursor | null
  /** 草稿里改过的步骤。 */
  edited: ReadonlySet<string>
  /** `current.view?.files`。 */
  files: RunDecor['files'] | undefined
  /** `current.flash`。 */
  flash: Run['flash']
  insetRight: number
  fresh(nodeId: string): boolean
  /** 打开改状态小菜单（实例视图里 `menu` 的 setter）。 */
  setMenu(menu: { id: string; x: number; y: number; step: 'status' | 'verdict' }): void
  t: T
}

export function buildRunDecor({
  doc,
  shown,
  cursor,
  edited,
  files,
  flash,
  insetRight,
  fresh,
  setMenu,
  t,
}: RunDecorInput): RunDecor {
  const onStatus = (nodeId: string, anchor: Element): void => {
    if (fresh(nodeId)) {
      flash('ok', t('run.freshStep'))
      return
    }
    const root = anchor.closest('[data-testid="wl-root"]')
    if (root === null) return
    const box = root.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    // 菜单贴着小标弹出，但不伸到右栏底下。
    const limit = box.width - insetRight - MENU_W - GAP
    setMenu({
      id: nodeId,
      x: Math.max(GAP, Math.min(rect.left - box.left, limit)),
      y: rect.bottom - box.top + 6,
      step: 'status',
    })
  }
  if (shown === null) {
    return {
      nodes: {},
      taken: new Set(doc.edges.map((edge) => edge.id)),
      files: {},
      onStatus,
    }
  }
  const marks = new Map<string, RunMark>()
  for (const step of cursor?.next ?? []) marks.set(step.node, 'next')
  for (const step of cursor?.last ?? []) marks.set(step.node, 'last')
  const nodes: Record<string, RunNodeDecor> = {}
  for (const [nodeId, node] of Object.entries(shown.nodes)) {
    nodes[nodeId] = {
      status: node.status,
      round: node.round ?? 0,
      edited: edited.has(nodeId),
      mark: marks.get(nodeId),
    }
  }
  return {
    nodes,
    taken: takenEdges(doc, shown),
    files: files ?? {},
    onStatus,
  }
}
