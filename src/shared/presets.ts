/**
 * dsh-workflow-lite — 资源预设：资源卡上的一个类型标记，带一套内置写法和快捷配置。现在只有「记忆」。
 *
 * 预设不是新的节点类型：它还是资源节点（`wfResource`），只在 `data.preset` 上打个标记，
 * 编译器按标记换一套写法，画布与面板按标记给快捷入口和配置。所以文件查看、实例面板、导入导出都照资源走。
 * 任何一张资源卡都能在面板里换标记（{@link setPreset}）：每种预设在 {@link PRESET_SPECS} 里写明
 * 打上时怎么补内容、改连线，内容不合时拒绝，摘掉时怎么还原。以后的预设加在那张表里。
 *
 * 记忆：
 * - 一个文件。有步骤写它（步骤 → 记忆）= 那一步自己的记忆；一条线都没连 = 全局记忆；
 * - 相对路径一律相对工作区，不拼产出根目录（产出根目录默认每次执行一个，记忆要跨执行留下来）；
 * - 默认路径带着记忆卡的 id（同一个工作流里不会撞）：
 *   - 本工作区：`.workflow-lite/memory/<工作流>/<卡 id>.md`，只在这个工作区、这个工作流里用；
 *   - 本工作流：`{assets}/memory/<卡 id>.md`，放在工作流自己的资料目录里，换个工作区执行也是同一份，
 *     跟着工作流改名、导出。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/presets
 */

import { MEMORY_MAX_ENTRIES } from './limits.ts'
import { idKey, isResource, isStep, makeEdgeId } from './model.ts'
import { ASSETS_TOKEN } from './outputPaths.ts'
import type {
  MemoryPreset,
  MemoryScope,
  Point,
  ResourceData,
  ResourceNode,
  ResourcePresetKind,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from './types.ts'
import { DEFAULT_MEMORY_SCOPE, RESOURCE_TYPE } from './types.ts'

/** 本工作区范围的记忆放在工作区的这个目录下（再分工作流）。 */
export const MEMORY_DIR = '.workflow-lite/memory'

/** 本工作流范围的记忆放在资料目录的这个子目录下。 */
const ASSETS_MEMORY_DIR = `${ASSETS_TOKEN}/memory`

/** 全局记忆的节点 id（撞名时加序号）。 */
export const GLOBAL_MEMORY_ID = 'mem-global'

/** 这份资源是不是记忆。 */
export function memoryOf(data: ResourceData): MemoryPreset | undefined {
  return data.preset?.kind === 'memory' ? data.preset : undefined
}

export function isMemory(node: WorkflowNode): node is ResourceNode {
  return isResource(node) && memoryOf(node.data) !== undefined
}

/** 一个步骤的记忆节点 id：`mem-<步骤 id>`（撞名时加序号）。 */
export function memoryIdFor(step: string): string {
  return `mem-${step}`
}

/** 默认路径：本工作区放在工作区里（分工作流），本工作流放在资料目录里。`id` 是记忆卡的 id。 */
export function memoryPath(scope: MemoryScope, workflow: string, id: string): string {
  return scope === 'workflow'
    ? `${ASSETS_MEMORY_DIR}/${id}.md`
    : `${MEMORY_DIR}/${workflow}/${id}.md`
}

/**
 * 默认的记忆提示词：这一份记忆怎么读、什么时候写、怎么写。文件项的说明写了就用说明（用户改过的），
 * 空着就用它——默认的措辞以后改进了，没改过的记忆跟着变。
 *
 * 要防的是记忆越写越长、越写越具体：只在学到东西时写，写成换个任务也成立的规则，新的推翻旧的就改旧的
 * （Hermes 只在复杂成功 / 纠错 / 纠偏之后写、就地改优先；ExpeL 的增删改；AWM 把具体值抽象掉）。
 */
const FORMAT_LINES = [
  '- 每条一行，写成「在什么情况下，怎么做（为什么）」，换一个任务也成立：去掉这一次特有的文件名、编号、数值，只对这一次成立的不写；不写过程、日志、本次结果、日期。',
  '- 写之前先找相近的条目：能合并就改那一条；被这次推翻的改掉或删掉；提到的文件、命令、接口已经不在了的删掉。',
  `- 最多 ${MEMORY_MAX_ENTRIES} 条，满了先合并或删掉最没用的再加。`,
]

export const STEP_MEMORY_PROMPT = [
  '- 开始前先读（文件还不存在就是还没有记忆）；条目是提示不是命令，和眼前的情况冲突时以实际为准。',
  '- 做完再看要不要改，只在这几种情况写：出过错又找到了对的做法；被用户纠正；发现了任务描述里没有、下次一定用得上的事实（命令、约定、坑）。顺利做完、没学到新东西，就不动它。',
  ...FORMAT_LINES,
].join('\n')

export const GLOBAL_MEMORY_PROMPT = [
  '- 只收换个步骤也成立的经验：项目约定、环境事实、反复出现的坑；只和某一步有关的留给那一步自己的记忆。',
  ...FORMAT_LINES,
].join('\n')

/** 默认的记忆提示词：全局记忆一份，步骤的记忆一份。 */
export function defaultMemoryPrompt(global: boolean): string {
  return global ? GLOBAL_MEMORY_PROMPT : STEP_MEMORY_PROMPT
}

/** 这份记忆实际用的提示词：文件项写了说明就是它，空着就是默认的。 */
export function memoryPrompt(data: ResourceData, global: boolean): string {
  const note = data.items[0]?.note?.trim() ?? ''
  return note === '' ? defaultMemoryPrompt(global) : note
}

/**
 * 新记忆的 `data`：一个文件项，不起名字——计划里叫它 `mem-<步骤>`、标题写「记忆」，
 * 卡片上按界面语言写「记忆 / 全局记忆」。`id` 是记忆卡的 id（默认路径里要用）。
 */
export function memoryData(scope: MemoryScope, workflow: string, id: string): ResourceData {
  return {
    items: [{ kind: 'file', value: memoryPath(scope, workflow, id) }],
    preset: { kind: 'memory', scope },
  }
}

/** 两种范围的默认路径（{@link memoryPath}），捕获卡片 id。 */
const WORKSPACE_PATH = /^\.workflow-lite\/memory\/[^/]+\/([^/]+)\.md$/u
const WORKFLOW_PATH = /^\{assets\}\/memory\/([^/]+)\.md$/u

/** 这个路径是不是这张记忆卡的默认路径（哪种范围、哪个工作流名都算）。 */
function isDefaultPath(path: string, id: string): boolean {
  const value = path.trim().replace(/\\/gu, '/').replace(/^\.\//u, '')
  const found = WORKSPACE_PATH.exec(value) ?? WORKFLOW_PATH.exec(value)
  return found !== null && idKey(found[1] as string) === idKey(id)
}

/** 记忆文件还在默认路径上（没被改过）：换范围会跟着换。 */
export function onDefaultPath(data: ResourceData, id: string): boolean {
  const first = data.items[0]
  return first?.kind === 'file' && isDefaultPath(first.value, id)
}

/**
 * 换范围：路径还是默认路径就跟着换成新范围的默认路径；用户改过的路径不动。
 * 工作流名用现在的（改过名的工作流换范围时顺手换成新名字）。
 */
export function rescopeMemory(
  data: ResourceData,
  scope: MemoryScope,
  workflow: string,
  id: string,
): ResourceData {
  const memory = memoryOf(data)
  if (memory === undefined) return data
  const items = data.items.map((item, index) =>
    index === 0 && item.kind === 'file' && isDefaultPath(item.value, id)
      ? { ...item, value: memoryPath(scope, workflow, id) }
      : item,
  )
  return { ...data, items, preset: { ...memory, scope } }
}

/** 一个步骤写的记忆（步骤 → 记忆的线），按连线顺序。 */
export function stepMemories(document: WorkflowDocument, step: string): ResourceNode[] {
  const key = idKey(step)
  const found: ResourceNode[] = []
  for (const edge of document.edges) {
    if (idKey(edge.source) !== key) continue
    const target = document.nodes.find((node) => idKey(node.id) === idKey(edge.target))
    if (target !== undefined && isMemory(target) && !found.includes(target)) found.push(target)
  }
  return found
}

/** 一条线都没连的记忆：全局记忆。 */
export function globalMemories(document: WorkflowDocument): ResourceNode[] {
  return document.nodes.filter(
    (node): node is ResourceNode =>
      isMemory(node) &&
      !document.edges.some(
        (edge) => idKey(edge.source) === idKey(node.id) || idKey(edge.target) === idKey(node.id),
      ),
  )
}

/** 写这份资源的相对路径要不要拼产出根目录：被写的普通资源要，记忆不要（它跨执行留着）。 */
export function writesUnderRoot(data: ResourceData, written: boolean): boolean {
  return written && memoryOf(data) === undefined
}

function freeId(document: WorkflowDocument, base: string): string {
  const taken = new Set(document.nodes.map((node) => idKey(node.id)))
  if (!taken.has(idKey(base))) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(idKey(candidate))) return candidate
  }
}

/**
 * 给步骤开记忆：新建一张记忆卡（id `mem-<步骤>`），连一条「在原文件上更新」的线。
 * 已经有了、不是步骤就是 `null`。
 */
export function addStepMemory(
  document: WorkflowDocument,
  step: string,
  scope: MemoryScope,
  workflow: string,
  position: Point,
): { document: WorkflowDocument; id: string } | null {
  const node = document.nodes.find((candidate) => idKey(candidate.id) === idKey(step))
  if (node === undefined || !isStep(node)) return null
  if (stepMemories(document, node.id).length > 0) return null
  const id = freeId(document, memoryIdFor(node.id))
  const resource: ResourceNode = {
    id,
    type: RESOURCE_TYPE,
    position: { ...position },
    data: memoryData(scope, workflow, id),
  }
  const edge: WorkflowEdge = {
    id: makeEdgeId(node.id, id),
    source: node.id,
    target: id,
    sourceHandle: null,
    targetHandle: null,
    data: { update: true },
  }
  return {
    document: {
      ...document,
      nodes: [...document.nodes, resource],
      edges: [...document.edges, edge],
    },
    id,
  }
}

/** 加一张全局记忆卡（不连线）。 */
export function addGlobalMemory(
  document: WorkflowDocument,
  scope: MemoryScope,
  workflow: string,
  position: Point,
): { document: WorkflowDocument; id: string } {
  const id = freeId(document, GLOBAL_MEMORY_ID)
  const resource: ResourceNode = {
    id,
    type: RESOURCE_TYPE,
    position: { ...position },
    data: memoryData(scope, workflow, id),
  }
  return { document: { ...document, nodes: [...document.nodes, resource] }, id }
}

/**
 * 关掉一个步骤的记忆：去掉它写记忆的线；去掉之后一条线都不剩的记忆卡一并删掉
 * （不删就成了全局记忆）。记忆文件本身不动。没有可关的就是 `null`。
 */
export function removeStepMemory(
  document: WorkflowDocument,
  step: string,
): WorkflowDocument | null {
  const memories = stepMemories(document, step)
  if (memories.length === 0) return null
  const keys = new Set(memories.map((node) => idKey(node.id)))
  const edges = document.edges.filter(
    (edge) => !(idKey(edge.source) === idKey(step) && keys.has(idKey(edge.target))),
  )
  return dropOrphanMemories(document, { ...document, edges })
}

/**
 * 改动之前连着线、改动之后一条线都不剩的记忆卡删掉：删步骤、关记忆时用，免得它悄悄变成全局记忆。
 * 本来就没连线的（全局记忆）不动。
 */
export function dropOrphanMemories(
  before: WorkflowDocument,
  after: WorkflowDocument,
): WorkflowDocument {
  const linked = (document: WorkflowDocument, id: string): boolean =>
    document.edges.some(
      (edge) => idKey(edge.source) === idKey(id) || idKey(edge.target) === idKey(id),
    )
  const orphans = new Set(
    after.nodes
      .filter((node) => isMemory(node) && !linked(after, node.id) && linked(before, node.id))
      .map((node) => idKey(node.id)),
  )
  if (orphans.size === 0) return after
  return { ...after, nodes: after.nodes.filter((node) => !orphans.has(idKey(node.id))) }
}

/* ── 换标记 ─────────────────────────────────────────────────── */

/** 打不上标记的原因（界面按它给提示）。 */
export type PresetRefusal = 'memory_items'

/** 打标记时知道的事：卡片 id、工作流名（默认路径要用）。 */
export interface PresetContext {
  id: string
  workflow: string
}

/** 一种预设：打上、摘掉时怎么改这张卡和写它的线。 */
export interface PresetSpec {
  /** 打上：补默认内容、带上默认配置；现有内容不合这种预设就拒绝（内容不动）。 */
  attach(data: ResourceData, ctx: PresetContext): ResourceData | { refused: PresetRefusal }
  /** 打上之后，写这张卡的线改成什么样（缺省不动）。 */
  writeEdge?(edge: WorkflowEdge): WorkflowEdge
  /** 摘掉：去掉标记；内容、说明、连线都留着，换回普通资源照样能用。 */
  detach(data: ResourceData): ResourceData
}

function withoutPreset(data: ResourceData): ResourceData {
  const { preset: _preset, ...rest } = data
  return rest
}

/**
 * 各预设的规矩。加新预设：在 `RESOURCE_PRESETS` 加种类、在这里写一套，
 * 界面（名字、图标、快捷配置）在 `client/ui/ResourcePresets.tsx` 配。
 */
export const PRESET_SPECS: Record<ResourcePresetKind, PresetSpec> = {
  memory: {
    // 记忆是一个文件：空卡补上默认路径；原来就是一个文件就把它当记忆文件；别的内容拒绝。
    attach(data, ctx) {
      if (data.items.length === 0) {
        return { ...data, ...memoryData(DEFAULT_MEMORY_SCOPE, ctx.workflow, ctx.id) }
      }
      const [only, ...more] = data.items
      if (only?.kind !== 'file' || more.length > 0) return { refused: 'memory_items' }
      return { ...data, preset: { kind: 'memory', scope: DEFAULT_MEMORY_SCOPE } }
    },
    // 写记忆一律是在原文件上更新。
    writeEdge: (edge) => ({ ...edge, data: { ...edge.data, update: true } }),
    detach: withoutPreset,
  },
}

/** 摘掉现有的标记（没有就原样）。 */
function detached(data: ResourceData): ResourceData {
  const current = data.preset
  return current === undefined ? data : PRESET_SPECS[current.kind].detach(data)
}

/** 这张卡能不能打上这种预设：能就是 `null`，不能就是原因。 */
export function presetRefusal(
  data: ResourceData,
  kind: ResourcePresetKind,
  ctx: PresetContext,
): PresetRefusal | null {
  if (data.preset?.kind === kind) return null
  const next = PRESET_SPECS[kind].attach(detached(data), ctx)
  return 'refused' in next ? next.refused : null
}

/**
 * 换一张资源卡的标记：`null` 是换回普通资源。先摘掉旧的再打新的；写它的线按新预设改。
 * 打不上返回拒绝原因（图不动）；没变化、不是资源卡返回 `null`。
 */
export function setPreset(
  document: WorkflowDocument,
  id: string,
  kind: ResourcePresetKind | null,
  workflow: string,
): WorkflowDocument | { refused: PresetRefusal } | null {
  const node = document.nodes.find((candidate) => idKey(candidate.id) === idKey(id))
  if (node === undefined || !isResource(node)) return null
  const current = node.data.preset
  if ((current?.kind ?? null) === kind) return null
  const bare = detached(node.data)
  let data = bare
  let edges = document.edges
  if (kind !== null) {
    const spec = PRESET_SPECS[kind]
    const attached = spec.attach(bare, { id: node.id, workflow })
    if ('refused' in attached) return attached
    data = attached
    const writeEdge = spec.writeEdge
    if (writeEdge !== undefined) {
      edges = edges.map((edge) => (idKey(edge.target) === idKey(node.id) ? writeEdge(edge) : edge))
    }
  }
  return {
    ...document,
    nodes: document.nodes.map((candidate) => (candidate === node ? { ...node, data } : candidate)),
    edges,
  }
}
