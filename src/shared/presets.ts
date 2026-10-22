/**
 * dsh-workflow-lite — 资源预设：资源卡上的一个类型标记，带一套内置写法和快捷配置。现在只有「记忆」。
 *
 * 预设不是新的节点类型：它还是资源节点（`wfResource`），只在 `data.preset` 上打个标记，
 * 编译器按标记换一套写法，画布与面板按标记给快捷入口和配置。所以文件查看、实例面板、导入导出都照资源走。
 * 任何一张资源卡都能在面板里换标记（{@link setPreset}）：每种预设在 {@link PRESET_SPECS} 里写明
 * 打上时怎么补内容、改连线，内容不合时拒绝，摘掉时怎么还原。以后的预设加在那张表里。
 *
 * 记忆（照 Hermes 的「skill 是流程性记忆」）：
 * - 一个文件夹，就是一份 skill：`SKILL.md` 写这一步（或整个工作流）怎么做得又快又对，
 *   `scripts/`、`templates/`、`references/` 放配套的东西。下次照着走，少走弯路。
 *   有步骤写它（步骤 → 记忆）= 那一步自己的记忆；一条线都没连 = 全局记忆（整个工作流的做法）；
 * - 相对路径一律相对工作区，不拼产出根目录（产出根目录默认每次执行一个，记忆要跨执行留下来）；
 * - 默认路径带着记忆卡的 id（同一个工作流里不会撞）：
 *   - 本工作区：`.workflow-lite/memory/<工作流>/<卡 id>/`，只在这个工作区、这个工作流里用；
 *   - 本工作流：`{workflow}/memory/<卡 id>/`，放在工作流自己的目录里，
 *     换个工作区执行也是同一份，跟着工作流改名、导出。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/presets
 */

import { MEMORY_SKILL_FILE } from './limits.ts'
import { idKey, isResource, isStep, makeEdgeId } from './model.ts'
import { isWorkflowPath, workflowPath, workflowRelative } from './pathVars.ts'
import type {
  MemoryPreset,
  MemoryScope,
  Point,
  ResourceData,
  ResourceItem,
  ResourceNode,
  ResourcePresetKind,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from './types.ts'
import { DEFAULT_MEMORY_SCOPE, RESOURCE_TYPE } from './types.ts'

/** 本工作区范围的记忆放在工作区的这个目录下（再分工作流）。 */
export const MEMORY_DIR = '.workflow-lite/memory'

/** 本工作流范围的记忆放在工作流目录的这个子目录下。 */
const WORKFLOW_MEMORY_DIR = 'memory'

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

/** 默认路径（一个文件夹）：本工作区放在工作区里（分工作流），本工作流放在工作流目录里。`id` 是记忆卡的 id。 */
export function memoryPath(scope: MemoryScope, workflow: string, id: string): string {
  return scope === 'workflow'
    ? workflowPath(`${WORKFLOW_MEMORY_DIR}/${id}`)
    : `${MEMORY_DIR}/${workflow}/${id}`
}

/** 记忆的内容合不合规矩：一个文件夹（skill 目录）。 */
export function memoryItemsOk(items: readonly ResourceItem[]): boolean {
  return items.length === 1 && items[0]?.kind === 'folder'
}

/**
 * 记忆的说明：怎么读、什么时候改、`SKILL.md` 和配套文件怎么写。存在那一项自己的说明里，用户能改；
 * 空着就用默认的——默认的措辞以后改进了，没改过的记忆跟着变。说明编译时紧跟在目录路径后面，
 * 所以只说「这个目录」「里面的 SKILL.md」，不需要占位。
 *
 * 默认说明照 Hermes 的 skill 写法（`skill_manage` 的说明、后台复盘与 `/learn` 的写作规矩）：
 * - skill 是流程性记忆：写「这类任务怎么做最快最对」——步骤按先后、带确切命令和分支判断，教训挂在受影响的那一步；
 * - 主动沉淀：第一次跑通一套值得重复的做法就写；绕过死路、被纠正、照着做发现错了缺了，当场就地改；顺利且没新东西才不动；
 * - 写教训不写日志：规则 + 一句为什么，不写编号、日期、对话原话，同一个教训只留一条，错了改那句话不追加「更正」；
 * - 用户对结果样子的要求（格式、详略、语气）也写进 skill，不只是记一笔偏好；
 * - 不记环境问题、否定结论、临时错误、没走通的尝试，也不复述本来就会读到的提示词、AGENTS.md；
 * - 先读再改，只改要改的几句；体积照 `/learn`：简单的约 100 行，复杂的 200 行以内，细节挪进 references/。
 * Hermes 没有条数上限，这里也不设。
 *
 * 出处：Hermes Agent（Nous Research，MIT 许可，https://github.com/NousResearch/hermes-agent）的
 * `tools/skill_manager_tool.py`、`agent/background_review.py`。这里是中文的转述与取舍，不是原文翻译。
 */
const SHAPE_LINES = [
  `- ${MEMORY_SKILL_FILE} 的样子：开头 frontmatter（\`name\` 用这个目录的名字；\`description\` 一句话，先写什么时候用、再写做什么，只看开头五十来个字也要能懂）；正文依次是「## 适用情况」「## 步骤」（按先后编号，写确切的命令、调用和分支判断，教训挂在受它影响的那一步上）「## 坑」（每条一个规则，后面一句为什么）「## 验证」（怎么确认做对了）。常用的放前面，少见的放后面；简单的 100 行左右，复杂的 200 行以内，放不下的细节挪进 references/。`,
  `- 配套文件：scripts/ 放能直接跑的（只放跑通过的；路径、名字从参数读，不写死这一次的值；开头注释写用途和用法），templates/ 放复制了再改的，references/ 放偶尔才用得上的细节（按主题命名，先扩写已有的，不按次新建）。新放一样就在 ${MEMORY_SKILL_FILE} 里加一行指向它，用不上了连同那一行一起删。`,
  '- 写教训，不写日志：规则离开这一次的事也要成立，不写这一次特有的文件名、编号、日期、对话原话；同一个教训只留一条，先找有没有说过，说过就改那一条；写错了就地改那句话，不在后面补「更正」。',
  '- 不记：缺命令、没装包这类环境问题（要记就记修法）；「某个工具不能用」这类否定结论；重试就好了的临时错误；没找到可行办法时的那些尝试；步骤提示词、AGENTS.md 这类本来就会读到的内容（不复述，只写做法和坑）。',
  '- 改之前先读当前内容，只改要改的那几句，不整份重写。',
  '- 改完看一眼全文：超过 200 行或成了一条条的流水账，就合并重复的、删掉过时的、把细节挪进 references/。',
]

export const STEP_MEMORY_PROMPT = [
  `- 这个目录是这一步的做法，一份 skill：${MEMORY_SKILL_FILE} 写怎么把这一步做得又快又对，scripts/、templates/、references/ 放配套的东西。`,
  `- 开始前先读里面的 ${MEMORY_SKILL_FILE}（还不存在就是还没有做法），照「步骤」做，现成的脚本、模板直接用，不重写；和眼前的情况冲突时以实际为准，做完把那一句改对。`,
  '- 做完看要不要改：第一次跑通了一套不简单、值得重复的做法；绕过死路找到了能走通的路；被用户纠正了做法，或对结果的样子（格式、详略、语气）提了要求；照着做却发现步骤错了、缺了或命令过时了——这几种都要改。只有顺利照着做完、确实没有新东西时才不动它，「不动」不是默认。',
  ...SHAPE_LINES,
].join('\n')

export const GLOBAL_MEMORY_PROMPT = [
  `- 这个目录是整个工作流的做法，一份 skill：${MEMORY_SKILL_FILE} 写跨步骤都成立的东西——项目约定、环境事实、步骤之间怎么衔接、反复出现的坑；只和某一步有关的留给那一步自己的记忆。scripts/、templates/ 放各步骤都用得上的。`,
  '- 什么时候改：整个工作流第一次跑通，摸清了步骤之间怎么衔接；某一步绕过死路或被纠正（包括用户对结果样子的要求），而这个教训换个步骤也成立；照着做却发现写错了、缺了或过时了。只有顺利跑完、各步骤确实没报新经验时才不动它。',
  ...SHAPE_LINES,
].join('\n')

/** 记忆的默认说明：全局记忆一份，步骤的记忆一份。 */
export function defaultMemoryPrompt(global: boolean): string {
  return global ? GLOBAL_MEMORY_PROMPT : STEP_MEMORY_PROMPT
}

/** 记忆实际用的说明：写了就是它，空着就是默认的。 */
export function memoryPrompt(data: ResourceData, global: boolean): string {
  const note = data.items[0]?.note?.trim() ?? ''
  return note === '' ? defaultMemoryPrompt(global) : note
}

/**
 * 新记忆的 `data`：一个文件夹项（skill 目录），不起名字——计划里叫它 `mem-<步骤>`、标题写「记忆」，
 * 卡片上按界面语言写「记忆 / 全局记忆」。`id` 是记忆卡的 id（默认路径里要用）。
 */
export function memoryData(scope: MemoryScope, workflow: string, id: string): ResourceData {
  return {
    items: [{ kind: 'folder', value: memoryPath(scope, workflow, id) }],
    preset: { kind: 'memory', scope },
  }
}

/**
 * 两种范围的默认路径（{@link memoryPath}），捕获卡片 id。
 * 本工作流那条对的是工作流目录里的相对部分（{@link workflowRelative}）。
 */
const WORKSPACE_PATH = /^\.workflow-lite\/memory\/[^/]+\/([^/]+)$/u
const WORKFLOW_PATH = /^memory\/([^/]+)$/u

/** 这一项是不是这张记忆卡的默认路径（哪种范围、哪个工作流名都算；要是文件夹）。 */
function isDefaultPath(item: ResourceItem, id: string): boolean {
  if (item.kind !== 'folder') return false
  const found = isWorkflowPath(item.value)
    ? WORKFLOW_PATH.exec(workflowRelative(item.value).replace(/\/+$/u, ''))
    : WORKSPACE_PATH.exec(
        item.value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/\/+$/u, ''),
      )
  return found !== null && idKey(found[1] as string) === idKey(id)
}

/** 记忆还在默认路径上（没被改过）：换范围会跟着换。 */
export function onDefaultPath(data: ResourceData, id: string): boolean {
  return data.items.length === 1 && data.items.every((item) => isDefaultPath(item, id))
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
    index === 0 && isDefaultPath(item, id)
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
 * （不删就成了全局记忆）。记忆目录本身不动。没有可关的就是 `null`。
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
    // 记忆是一个文件夹（skill 目录）：空卡补上默认路径；原来就是一个文件夹就照用；别的内容拒绝。
    attach(data, ctx) {
      if (data.items.length === 0) {
        return { ...data, ...memoryData(DEFAULT_MEMORY_SCOPE, ctx.workflow, ctx.id) }
      }
      if (!memoryItemsOk(data.items)) return { refused: 'memory_items' }
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
