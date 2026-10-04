/**
 * dsh-workflow-lite — 往图里加东西、复制一个节点：模板编辑与实例视图共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/addStep
 */

import { isInput, isResource } from '../../shared/model.ts'
import { outputResource } from '../../shared/resources.ts'
import type { NodeData, Point, WorkflowDocument } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { type Edit, findNode } from '../model/editor.ts'
import {
  BLANK_ID,
  INPUT_ID,
  inputData,
  PRESETS,
  presetData,
  type StepSource,
} from '../model/library.ts'
import { freeFilePath } from '../ui/resourceUi.ts'

export interface AddContext {
  t: T
  doc: WorkflowDocument | null
  edit(edit: Edit): void
  /** 读「我的步骤」里的一个节点模板；读不到回 `null`。 */
  loadTemplate(name: string): Promise<NodeData | null>
}

/**
 * 按来源加一个节点：步骤（空白 / 内置 / 我的步骤）接在 `from` 后面；资源从步骤的「＋」加就是这一步写的产出文件；
 * 输入从步骤的「＋」加就是这一步要的输入。加完的节点接管选中。
 */
export async function addFromSource(
  ctx: AddContext,
  source: StepSource,
  position: Point,
  from?: string,
): Promise<void> {
  const { doc, edit, t } = ctx
  if (source.kind === 'resource') {
    // 加完选中它，好接着添加内容、改路径。
    if (doc === null) return
    const writer = from === undefined ? undefined : findNode(doc, from)
    const step =
      writer !== undefined && !isResource(writer) && !isInput(writer) ? writer : undefined
    edit(
      step === undefined
        ? { type: 'addResource', data: { items: [] }, position, select: true }
        : {
            type: 'addResource',
            data: outputResource({ path: freeFilePath(doc, `${step.id}.md`) }),
            writer: step.id,
            select: true,
          },
    )
    return
  }
  if (source.kind === 'input') {
    // 从步骤的「＋」加的放在它左边、连上；别处加的落在原地。加完选中它，好写问题。
    if (doc === null) return
    const reader = from === undefined ? undefined : findNode(doc, from)
    const step =
      reader !== undefined && !isResource(reader) && !isInput(reader) ? reader : undefined
    edit({
      type: 'addInput',
      id: INPUT_ID,
      data: inputData(t),
      ...(step === undefined ? { position } : { reader: step.id }),
    })
    return
  }
  let id: string
  let data: NodeData
  if (source.kind === 'blank') {
    id = BLANK_ID
    data = { prompt: '' }
  } else if (source.kind === 'preset') {
    const preset = PRESETS.find((candidate) => candidate.id === source.id)
    if (preset === undefined) return
    id = preset.id
    data = presetData(preset, t)
  } else {
    const loaded = await ctx.loadTemplate(source.name)
    if (loaded === null) return
    id = source.name
    data = loaded
  }
  edit({ type: 'addNode', id, data, position, ...(from === undefined ? {} : { from }) })
}

/** 就地添加菜单从哪儿来：步骤的「＋」、资源卡拖出来的线、输入，或空白处。 */
export function addOrigin(
  doc: WorkflowDocument | null,
  from: string | undefined,
): 'step' | 'resource' | 'input' | 'none' {
  if (doc === null || from === undefined) return 'none'
  const node = findNode(doc, from)
  if (node === undefined) return 'none'
  if (isInput(node)) return 'input'
  return isResource(node) ? 'resource' : 'step'
}

/** 复制一个节点的改动（落在原处右下方一点）；节点不在就是 `null`。 */
export function duplicateEdit(doc: WorkflowDocument | null, id: string): Edit | null {
  const node = doc === null ? undefined : findNode(doc, id)
  if (node === undefined) return null
  const position = { x: node.position.x + 32, y: node.position.y + 32 }
  if (isResource(node)) return { type: 'addResource', data: node.data, position, select: true }
  if (isInput(node)) return { type: 'addInput', id: node.id, data: node.data, position }
  return { type: 'addNode', id: node.id, data: { ...node.data }, position }
}
