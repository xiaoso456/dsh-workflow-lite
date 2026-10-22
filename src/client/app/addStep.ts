/**
 * dsh-workflow-lite — 往图里加东西、复制一个节点：模板编辑与实例视图共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/addStep
 */

import { isInput, isResource } from '../../shared/model.ts'
import { stepMemories } from '../../shared/presets.ts'
import { outputResource } from '../../shared/resources.ts'
import {
  DEFAULT_MEMORY_SCOPE,
  type NodeData,
  type Point,
  type WorkflowDocument,
} from '../../shared/types.ts'
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
import { copyTitle, takenLabels } from '../model/nodeName.ts'
import { freeFilePath } from '../ui/resourceUi.ts'

export interface AddContext {
  t: T
  doc: WorkflowDocument | null
  edit(edit: Edit): void
  /** 读「我的步骤」里的一个节点模板；读不到回 `null`。 */
  loadTemplate(name: string): Promise<NodeData | null>
  /** 工作流名：记忆的默认路径里要用它；没有（实例视图）就加不了记忆。 */
  workflow?: string | null
}

/**
 * 开 / 关一个步骤的记忆：开着就关（记忆目录不动），关着就开一张默认范围（本工作区）的记忆卡。
 * 步骤不在、没有工作流名时是 `null`。
 */
export function memoryToggleEdit(
  doc: WorkflowDocument | null,
  workflow: string | null | undefined,
  step: string,
): Edit | null {
  const node = doc === null ? undefined : findNode(doc, step)
  if (doc === null || node === undefined || isResource(node) || isInput(node)) return null
  if (stepMemories(doc, node.id).length > 0)
    return { type: 'setStepMemory', step: node.id, on: false }
  if (workflow === null || workflow === undefined) return null
  return {
    type: 'setStepMemory',
    step: node.id,
    on: true,
    scope: DEFAULT_MEMORY_SCOPE,
    workflow,
  }
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
  if (source.kind === 'memory') {
    // 从步骤的「＋」加 = 给这一步开记忆；别处加 = 一张全局记忆卡，落在原地、选中它。
    if (doc === null || ctx.workflow === null || ctx.workflow === undefined) return
    const owner = from === undefined ? undefined : findNode(doc, from)
    if (owner !== undefined && !isResource(owner) && !isInput(owner)) {
      const toggle = memoryToggleEdit(doc, ctx.workflow, owner.id)
      if (toggle !== null && toggle.type === 'setStepMemory' && toggle.on) edit(toggle)
      return
    }
    edit({ type: 'addGlobalMemory', scope: DEFAULT_MEMORY_SCOPE, workflow: ctx.workflow, position })
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

/**
 * 复制一个节点的改动（落在原处右下方一点）；节点不在就是 `null`。
 * 给了 `suffix`（「副本」），写了名字的步骤与资源在名字后面接上它，免得两张卡一模一样分不出谁是新的。
 * 输入节点的名字是发给模型的问题，原样复制。
 */
export function duplicateEdit(
  doc: WorkflowDocument | null,
  id: string,
  suffix?: string,
): Edit | null {
  const node = doc === null ? undefined : findNode(doc, id)
  if (doc === null || node === undefined) return null
  const position = { x: node.position.x + 32, y: node.position.y + 32 }
  const renamed = <D extends { label?: string }>(data: D): D => {
    const label = data.label?.trim()
    if (suffix === undefined || label === undefined || label === '') return data
    return { ...data, label: copyTitle(label, suffix, takenLabels(doc)) }
  }
  if (isResource(node)) {
    return { type: 'addResource', data: renamed(node.data), position, select: true }
  }
  if (isInput(node)) return { type: 'addInput', id: node.id, data: node.data, position }
  return { type: 'addNode', id: node.id, data: renamed({ ...node.data }), position }
}
