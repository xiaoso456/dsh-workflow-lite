/**
 * dsh-workflow-lite — 拖线连接的规则：从哪个连接点拖出来、能落到哪些连接点上、连上会是什么线。
 *
 * 连接点各有分工（「左右走流程，上下走文件」）：
 * - 步骤左 `in`：入口——接上游步骤（流程）或文件卡（读取）；
 * - 步骤右 `out`：出口——只连下一个步骤（流程）；
 * - 步骤底 `file`：出口——只连文件卡（写入）；
 * - 文件左 `in`：入口——只接步骤的写点（写入）；
 * - 文件右 `out`：出口——只连步骤（读取）；
 * - 输入右 `out`：出口——只连步骤（把回答交给它，落点和读文件一样）。输入没有入口。
 * 步骤上还有几个备用点（上边的写点 `fileUp`、上下边的读点 `read` / `readTop`），挂哪个由画布按位置挑。
 *
 * 画布据此在拖线时只露出能连的连接点，并在松手前预告这条线的含义。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/connect
 */

import { nodeIndex } from '../../shared/files.ts'
import { idKey, isFile, isInput, isStep, makeEdgeId } from '../../shared/model.ts'
import type { WorkflowDocument, WorkflowNode } from '../../shared/types.ts'
import { alreadyWritten, findEdge } from './editor.ts'

/**
 * 正在拖的是哪种线（按起点）：
 * `flow` 步骤右 → 找步骤；`write` 步骤底/上的写点 → 找文件；`read` 文件右 → 找步骤；
 * `back` 从步骤左边倒着拖 → 找步骤右 / 文件右；`writeBack` 从文件左边倒着拖 → 找步骤的写点；
 * `readBack` 从步骤的读点倒着拖 → 找文件或输入；`ask` 输入右 → 找步骤。
 */
export type DragKind = 'flow' | 'write' | 'read' | 'ask' | 'back' | 'writeBack' | 'readBack'

/** 拖线起点是哪种卡。 */
export type CardKind = 'step' | 'file' | 'input'

export function dragKindOf(from: CardKind, handleId: string | null | undefined): DragKind | null {
  if (from === 'input') return handleId === 'out' ? 'ask' : null
  if (from === 'file') {
    if (handleId === 'out') return 'read'
    if (handleId === 'in') return 'writeBack'
    return null
  }
  if (handleId === 'out') return 'flow'
  if (handleId === 'file' || handleId === 'fileUp') return 'write'
  if (handleId === 'in') return 'back'
  if (handleId === 'read' || handleId === 'readTop') return 'readBack'
  return null
}

const STEP_WRITE = new Set(['file', 'fileUp'])
const STEP_READ = new Set(['in', 'read', 'readTop'])
const FILE_IN = new Set(['in'])
const FILE_OUT = new Set(['out'])

/** React Flow 交过来的连接（已按 source → target 摆正）。 */
export interface HandleLink {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

/** 这条拖出来的线能不能连：不连自己、文件不连文件，且两头的连接点分工要对得上。 */
export function linkAllowed(doc: WorkflowDocument, link: HandleLink): boolean {
  if (idKey(link.source) === idKey(link.target)) return false
  const index = nodeIndex(doc)
  const source = index.get(idKey(link.source))
  const target = index.get(idKey(link.target))
  if (source === undefined || target === undefined) return false
  const from = link.sourceHandle ?? ''
  const to = link.targetHandle ?? ''
  if (isInput(target)) return false
  if (isInput(source)) return FILE_OUT.has(from) && isStep(target) && STEP_READ.has(to)
  if (isFile(source)) return FILE_OUT.has(from) && !isFile(target) && STEP_READ.has(to)
  if (STEP_WRITE.has(from)) return isFile(target) && FILE_IN.has(to)
  return from === 'out' && isStep(target) && to === 'in'
}

/** 连上之后会是什么线：流程 / 产出 / 更新 / 读取 / 交回答；`exists` = 已经连着了，松手什么也不会变。 */
export interface LinkPreview {
  kind: 'flow' | 'produce' | 'update' | 'read' | 'ask'
  source: WorkflowNode
  target: WorkflowNode
  exists: boolean
}

export function previewLink(doc: WorkflowDocument, link: HandleLink): LinkPreview | null {
  if (!linkAllowed(doc, link)) return null
  const index = nodeIndex(doc)
  const source = index.get(idKey(link.source)) as WorkflowNode
  const target = index.get(idKey(link.target)) as WorkflowNode
  const exists = findEdge(doc, makeEdgeId(source.id, target.id)) !== undefined
  if (isInput(source)) return { kind: 'ask', source, target, exists }
  if (isFile(source)) return { kind: 'read', source, target, exists }
  if (isFile(target)) {
    // 与编辑器的 `connect` 同一条规则：别人已经在写这份文件，再接上来默认是在原文件上更新。
    const update = alreadyWritten(doc, target.id, source.id)
    return { kind: update ? 'update' : 'produce', source, target, exists }
  }
  return { kind: 'flow', source, target, exists }
}
