/**
 * dsh-workflow-lite — 资源预设：资源卡上的一个类型标记，带一套内置写法和快捷配置。现在只有「记忆」。
 *
 * 预设不是新的节点类型：它还是资源节点（`wfResource`），只在 `data.preset` 上打个标记，
 * 编译器按标记换一套写法，画布与面板按标记给快捷入口和配置。所以文件查看、实例面板、导入导出都照资源走。
 * 任何一张资源卡都能在面板里换标记（{@link setPreset}）：每种预设在 {@link PRESET_SPECS} 里写明
 * 打上时怎么补内容、改连线，内容不合时拒绝，摘掉时怎么还原。以后的预设加在那张表里。
 *
 * 记忆（照 Hermes 的「skill 是流程性记忆」）：
 * - 记忆住在插件的记忆库里（`<dataDir>/memories/<id>/`，宿主 `host/store/memories.ts` 管），一条就是一份 skill：
 *   `SKILL.md` 写这一步（或整个工作流）怎么做得又快又对，`scripts/`、`templates/`、`references/` 放配套的东西；
 * - 记忆卡只存引用（{@link MemoryPreset}）和这一处的说明，那一项固定是 `{memory}/<id>`；
 *   名称、描述在库里，几个工作流、几个步骤可以引用同一条；
 * - 类型（工作流记忆 / 步骤记忆）建好就定，决定默认说明；步骤记忆连在步骤上（步骤 → 记忆），
 *   工作流记忆一条线都不连（每一步都读，主 agent 收尾时统一整理）。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/presets
 */

import { MEMORY_SKILL_FILE } from './limits.ts'
import { idKey, isResource, isStep, makeEdgeId } from './model.ts'
import { checkName } from './naming.ts'
import { memoryPath } from './pathVars.ts'
import type {
  MemoryPreset,
  MemoryType,
  Point,
  ResourceData,
  ResourceItem,
  ResourceNode,
  ResourcePresetKind,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from './types.ts'
import { RESOURCE_TYPE } from './types.ts'

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

/** 记忆卡引用库里的哪一条。 */
export interface MemoryRef {
  memory: string
  type: MemoryType
}

/** 新建记忆时建议的 id：工作流记忆用工作流名，步骤记忆用 `<工作流名>-<步骤 id>`（撞了由宿主加序号）。 */
export function suggestMemoryId(type: MemoryType, workflow: string, step?: string): string {
  return type === 'step' && step !== undefined ? `${workflow}-${step}` : workflow
}

/** 记忆的内容合不合规矩：引用的 id 是个合法名字，内容恰好一项、就是那条记忆的文件夹。 */
export function memoryItemsOk(data: ResourceData): boolean {
  const memory = memoryOf(data)
  if (memory === undefined || checkName(memory.memory) !== null) return false
  const [item] = data.items
  return (
    data.items.length === 1 && item?.kind === 'folder' && item.value === memoryPath(memory.memory)
  )
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
 * 「快速路径」是这里自己加的（Hermes 没有）：SKILL.md 开头放下次最省事的走法——一串能直接复制的命令或脚本调用，
 * 开头一条「取全」，把要查的一次查完；机械的数数、比对写成脚本；每条带「看到什么算对」，对不上就改走「步骤」。
 * 写回时回看这一轮哪里没能一步到位（分几次查、绕弯、自己心算），折进路径。目的是下次少调几次工具、少想几轮。
 *
 * 出处：Hermes Agent（Nous Research，MIT 许可，https://github.com/NousResearch/hermes-agent）的
 * `tools/skill_manager_tool.py`、`agent/background_review.py`。这里是中文的转述与取舍，不是原文翻译。
 */
const SHAPE_LINES = [
  `- ${MEMORY_SKILL_FILE} 的样子：开头 frontmatter（\`name\` 用这个目录的名字；\`description\` 一句话，先写什么时候用、再写做什么，只看开头五十来个字也要能懂）；正文依次是「## 适用情况」「## 快速路径」「## 步骤」（按先后编号，写确切的命令、调用和分支判断，教训挂在受它影响的那一步上）「## 坑」（每条一个规则，后面一句为什么）「## 验证」（怎么确认做对了）。常用的放前面，少见的放后面；简单的 100 行左右，复杂的 200 行以内，放不下的细节挪进 references/。`,
  `- 「## 快速路径」是下次最省事的走法：把这类任务从头到尾要做的事排成一串能直接复制的命令或脚本调用（参数写清），每条后面一句「看到什么算对」。目标是工具调用尽量少、中间不用停下来想：相邻的、不依赖前一条结果的查询合成一条（命令串起来，或一个脚本取全），一个步骤最好一两次调用做完——取全、落盘、检查。`,
  '- 一次查全：路径开头放一条「取全」的命令或脚本，把后面要用的事实（环境、状态、范围、数量、现有产出）一次取回，不让下次一项一项查；要判断的地方把标准写死（阈值、规则、选哪个），不留「视情况」。',
  '- 机械活进脚本：数字数、数条数、核行宽、核编号覆盖、核格式这类，每一类写成 scripts/ 里的一个检查脚本，路径里直接调它，一行结论加退出码说明过没过；不要只在「坑」里描述怎么量，描述省不了事，脚本才省。每次都从头写的大文件（页面、报告骨架），把不变的部分放进 templates/，路径里写「复制模板、只填内容」。',
  '- 回看这一轮再写路径：哪些调用是在摸索、重试、重复查同一类东西，哪些结果是自己算出来的，都折进路径（一条取全的命令、一个检查脚本）；和上一版路径对一下，没照着走的地方，是路径错了就改，是没读就不动。只写这一轮真跑通的；用法写在路径这一行里，下次不用读脚本源码。「坑」只留脚本管不了的；已经折进检查脚本或模板里的，就从「坑」里删掉，别两处都写。',
  `- 配套文件：scripts/ 放能直接跑的（只放跑通过的；路径、名字从参数读，不写死这一次的值；开头注释写用途和用法），templates/ 放复制了再改的，references/ 放偶尔才用得上的细节（按主题命名，先扩写已有的，不按次新建）。新放一样就在 ${MEMORY_SKILL_FILE} 里加一行指向它，用不上了连同那一行一起删。`,
  '- 写教训，不写日志：规则离开这一次的事也要成立，不写这一次特有的文件名、编号、日期、对话原话；同一个教训只留一条，先找有没有说过，说过就改那一条；写错了就地改那句话，不在后面补「更正」。',
  '- 不记：缺命令、没装包这类环境问题（要记就记修法）；「某个工具不能用」这类否定结论；重试就好了的临时错误；没找到可行办法时的那些尝试；步骤提示词、AGENTS.md 这类本来就会读到的内容（不复述，只写做法和坑）。',
  '- 改之前先读当前内容，只改要改的那几句，不整份重写。',
  '- 改完看一眼全文：超过 200 行或成了一条条的流水账，就合并重复的、删掉过时的、把细节挪进 references/。',
]

export const STEP_MEMORY_PROMPT = [
  `- 这个目录是这一步的做法，一份 skill：${MEMORY_SKILL_FILE} 写怎么把这一步做得又快又对，scripts/、templates/、references/ 放配套的东西。`,
  `- 开始前先读里面的 ${MEMORY_SKILL_FILE}（还不存在就是还没有做法）。有「快速路径」就优先照它执行：少想、少探索，路径里写了的取数、核对、检查不另起炉灶、不再重新验证一遍；能合成一次的调用合成一次，不要一条一调；数字用脚本算，不在推理里心算；现成的脚本、模板直接用，不重写，也不必先读脚本源码（用法写在路径里）。要判断的内容（写什么、怎么措辞）该想还得想，路径只管把取数、检查这些机械活一次做完。`,
  '- 只有某一条的结果和「算对」对不上，或和眼前的情况冲突，才停下来想、改走「步骤」，以实际为准，做完把那一句改对。',
  '- 做完看要不要改：第一次跑通了一套不简单、值得重复的做法；绕过死路找到了能走通的路；被用户纠正了做法，或对结果的样子（格式、详略、语气）提了要求；照着做却发现步骤错了、缺了或命令过时了；没能照快速路径一步到位——同一类东西分几次查、绕了弯、自己心算了数字——这几种都要改。只有照快速路径顺利做完、确实没有新东西时才不动它，「不动」不是默认。',
  ...SHAPE_LINES,
].join('\n')

export const GLOBAL_MEMORY_PROMPT = [
  `- 这个目录是整个工作流的做法，一份 skill：${MEMORY_SKILL_FILE} 写跨步骤都成立的东西——项目约定、环境事实、步骤之间怎么衔接、反复出现的坑；只和某一步有关的留给那一步自己的记忆。scripts/、templates/ 放各步骤都用得上的。`,
  '- 什么时候改：整个工作流第一次跑通，摸清了步骤之间怎么衔接；某一步绕过死路或被纠正（包括用户对结果样子的要求），而这个教训换个步骤也成立；照着做却发现写错了、缺了或过时了；各步骤报的「经验」里有没能一步到位的地方（分几次查、绕了弯、自己心算）。只有照快速路径顺利跑完、各步骤确实没报新经验时才不动它。',
  ...SHAPE_LINES,
].join('\n')

/** 记忆的默认说明：工作流记忆一份，步骤记忆一份。 */
export function defaultMemoryPrompt(type: MemoryType): string {
  return type === 'workflow' ? GLOBAL_MEMORY_PROMPT : STEP_MEMORY_PROMPT
}

/** 记忆实际用的说明：写了就是它，空着就按类型用默认的。 */
export function memoryPrompt(data: ResourceData): string {
  const note = data.items[0]?.note?.trim() ?? ''
  return note === '' ? defaultMemoryPrompt(memoryOf(data)?.type ?? 'step') : note
}

/**
 * 引用 `ref` 的记忆卡 `data`：一项，库里那条记忆的文件夹；不起名字（卡片上显示库里的名称）。
 * `note` 是这一处的说明（缺省按类型用默认的）。
 */
export function memoryData(ref: MemoryRef, note?: string): ResourceData {
  const item: ResourceItem = { kind: 'folder', value: memoryPath(ref.memory) }
  if (note !== undefined && note.trim() !== '') item.note = note
  return { items: [item], preset: { kind: 'memory', memory: ref.memory, type: ref.type } }
}

/** 换成引用另一条记忆：这一处的说明、名字、颜色留着。 */
export function rebindMemory(data: ResourceData, ref: MemoryRef): ResourceData {
  if (memoryOf(data) === undefined) return data
  return { ...data, ...memoryData(ref, data.items[0]?.note) }
}

/** 图里引用到的记忆 id（按出现顺序，大小写不同算同一条）。 */
export function memoryRefs(document: WorkflowDocument): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const node of document.nodes) {
    const memory = isResource(node) ? memoryOf(node.data) : undefined
    if (memory === undefined || memory.memory === '') continue
    const key = idKey(memory.memory)
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(memory.memory)
  }
  return ids
}

/** 把引用的记忆 id 按 `renames`（旧 id 的 `idKey` → 新 id）改掉；没有要改的原样返回。 */
export function renameMemoryRefs(
  document: WorkflowDocument,
  renames: ReadonlyMap<string, string>,
): WorkflowDocument {
  let changed = false
  const nodes = document.nodes.map((node) => {
    if (!isResource(node)) return node
    const memory = memoryOf(node.data)
    const next = memory === undefined ? undefined : renames.get(idKey(memory.memory))
    if (memory === undefined || next === undefined) return node
    changed = true
    return { ...node, data: rebindMemory(node.data, { memory: next, type: memory.type }) }
  })
  return changed ? { ...document, nodes } : document
}

/**
 * 记忆的类型和挂的位置对不上：步骤记忆没有步骤写它，或工作流记忆连在步骤上。
 * 照样能用（默认说明按类型），只给提示。
 */
export function memoryMisplaced(document: WorkflowDocument, node: ResourceNode): boolean {
  const memory = memoryOf(node.data)
  if (memory === undefined) return false
  const written = document.edges.some(
    (edge) =>
      idKey(edge.target) === idKey(node.id) &&
      document.nodes.some((source) => idKey(source.id) === idKey(edge.source) && isStep(source)),
  )
  return memory.type === 'step' ? !written : written
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
 * 给步骤开记忆：新建一张引用 `ref` 的记忆卡（id `mem-<步骤>`），连一条「在原文件上更新」的线。
 * 已经有了、不是步骤就是 `null`。
 */
export function addStepMemory(
  document: WorkflowDocument,
  step: string,
  ref: MemoryRef,
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
    data: memoryData(ref),
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

/** 加一张引用 `ref` 的工作流记忆卡（不连线）。 */
export function addGlobalMemory(
  document: WorkflowDocument,
  ref: MemoryRef,
  position: Point,
): { document: WorkflowDocument; id: string } {
  const id = freeId(document, GLOBAL_MEMORY_ID)
  const resource: ResourceNode = {
    id,
    type: RESOURCE_TYPE,
    position: { ...position },
    data: memoryData(ref),
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

/** 打不上标记的原因（界面按它给提示）：`memory_items` 卡上已经有内容了，`memory_ref` 没给要引用哪条记忆。 */
export type PresetRefusal = 'memory_items' | 'memory_ref'

/** 打标记时知道的事：卡片 id；打成记忆时引用库里的哪一条。 */
export interface PresetContext {
  id: string
  memory?: MemoryRef
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
    // 记忆引用库里的一条：只有空卡能打（不把外面的文件夹收进库里）。
    attach(data, ctx) {
      if (data.items.length > 0) return { refused: 'memory_items' }
      if (ctx.memory === undefined) return { refused: 'memory_ref' }
      return { ...data, ...memoryData(ctx.memory) }
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

/**
 * 这张卡能不能打上这种预设：能就是 `null`，不能就是原因。只看卡上的内容——还没选引用哪条记忆不算
 * （界面上选了类型再去挑一条）。
 */
export function presetRefusal(
  data: ResourceData,
  kind: ResourcePresetKind,
  ctx: PresetContext,
): PresetRefusal | null {
  if (data.preset?.kind === kind) return null
  const next = PRESET_SPECS[kind].attach(detached(data), ctx)
  return 'refused' in next && next.refused !== 'memory_ref' ? next.refused : null
}

/**
 * 换一张资源卡的标记：`null` 是换回普通资源。先摘掉旧的再打新的；写它的线按新预设改。
 * 打不上返回拒绝原因（图不动）；没变化、不是资源卡返回 `null`。
 */
export function setPreset(
  document: WorkflowDocument,
  id: string,
  kind: ResourcePresetKind | null,
  memory?: MemoryRef,
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
    const attached = spec.attach(bare, { id: node.id, ...(memory === undefined ? {} : { memory }) })
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
