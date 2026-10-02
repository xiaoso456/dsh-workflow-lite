/**
 * dsh-workflow-lite — 图 JSON 的读入规范化与 canonical 写出。
 *
 * 两条硬规则都在这里兑现：
 * 1. **白名单写出**：只写契约里的键，React Flow 的运行时字段（`measured` /
 *    `selected` / `dragging` / `width` / `height` / `computedPosition` …）与一切
 *    未知字段**一律丢弃**并报警告——它们每次渲染都在变，持久化就是永不停止的假 diff。
 * 2. **canonical writer**：2 空格缩进 / LF / 末尾恰好一个换行 / 固定键序 / 坐标归一化 /
 *    数组顺序永不重排。往返测试与"同图两次编译逐字节相同"的期望值都来自它。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/model
 */

import { isStepColor, isStepIcon } from './appearance.ts'
import { COORD_DECIMALS } from './limits.ts'
import { normalizeRoot, outputKey, WORKSPACE_ROOT } from './outputPaths.ts'
import {
  type EdgeData,
  EXECUTION_MODES,
  FILE_TYPE,
  type FileData,
  type FileNode,
  type Handoff,
  INPUT_KINDS,
  INPUT_TYPE,
  type InputAnswer,
  type InputData,
  type InputNode,
  NODE_TYPE,
  type NodeData,
  type OutputSpec,
  type StepNode,
  type ValidationProblem,
  type Viewport,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowSettings,
} from './types.ts'

/** node 的 data 键序。 */
const DATA_KEYS = ['label', 'description', 'icon', 'color', 'prompt', 'output'] as const
/** 输入节点的 data 键序。 */
const INPUT_KEYS = [
  'question',
  'kind',
  'options',
  'default',
  'placeholder',
  'hint',
  'required',
] as const
/** edge 的 data 键序。 */
const EDGE_DATA_KEYS = ['when', 'label', 'handoff', 'update'] as const

/** 坐标归一化：`round(v * 100) / 100`（2 位小数）。 */
export function normalizeCoord(value: number): number {
  const factor = 10 ** COORD_DECIMALS
  return Math.round(value * factor) / factor
}

/**
 * 大小写不敏感的 id 键——图内唯一性按它判定（`Scan` 与 `scan` 是同一个身份，
 * 因为它们会撞同一个载荷文件名）。
 */
export function idKey(id: string): string {
  return id.toLowerCase()
}

/** 边 id 的构造式：`<source>-><target>`，带 `when` 时追加 `#<when>`。构造上天然唯一。 */
export function makeEdgeId(source: string, target: string, when?: string): string {
  const base = `${source}->${target}`
  return when === undefined || when === '' ? base : `${base}#${when}`
}

/** 一个节点在计划里的规范标识：`label（id）`，`label` 缺省时只写 `id`。 */
export function displayName(id: string, label?: string): string {
  return label === undefined || label === '' ? id : `${label}（${id}）`
}

// ─────────────────────────────────────────────────────────────
// 读入
// ─────────────────────────────────────────────────────────────

export interface ParseOutcome {
  /** 结构可用时是规范化后的文档；保存级破损时是 `null`。 */
  document: WorkflowDocument | null
  problems: ValidationProblem[]
}

function problem(
  level: ValidationProblem['level'],
  code: ValidationProblem['code'],
  message: string,
  extra?: Pick<ValidationProblem, 'node' | 'edge'>,
): ValidationProblem {
  return { level, code, message, ...extra }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 有限数值——`NaN` / `Infinity` / 字符串都不算。 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readPoint(raw: unknown): { x: number; y: number } | null {
  if (!isPlainObject(raw)) return null
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return null
  return { x: normalizeCoord(raw.x), y: normalizeCoord(raw.y) }
}

function readViewport(raw: unknown): Viewport | null {
  if (!isPlainObject(raw)) return null
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.zoom)) return null
  if (raw.zoom <= 0) return null
  return {
    x: normalizeCoord(raw.x),
    y: normalizeCoord(raw.y),
    zoom: normalizeCoord(raw.zoom),
  }
}

/**
 * 从原始对象里挑出 `data` 的已知键（图里的节点与节点模板共用这一份）。
 * 产出数组里认不出的元素（不是对象、没有字符串 `path`）直接略过。
 */
export function readNodeData(raw: unknown): NodeData {
  if (!isPlainObject(raw)) return {}
  const data: NodeData = {}
  if (typeof raw.label === 'string') data.label = raw.label
  if (typeof raw.description === 'string') data.description = raw.description
  // 图标与颜色只认图标库与色板里的名字；不认识的当没写（回落按 id 猜）。
  if (isStepIcon(raw.icon)) data.icon = raw.icon
  if (isStepColor(raw.color)) data.color = raw.color
  if (typeof raw.prompt === 'string') data.prompt = raw.prompt
  if (typeof raw.output === 'string') data.output = raw.output
  else if (raw.output === false) data.output = false
  else if (Array.isArray(raw.output)) {
    const specs: OutputSpec[] = []
    for (const item of raw.output) {
      if (!isPlainObject(item) || typeof item.path !== 'string') continue
      specs.push(
        typeof item.rule === 'string' ? { path: item.path, rule: item.rule } : { path: item.path },
      )
    }
    const output = canonicalOutput(specs)
    if (output !== undefined) data.output = output
  }
  return data
}

/**
 * 产出的规范写法：空数组 = 未声明；只有一个产出且没有规则 = 写成字符串（老写法，文件保持不变）；
 * 规则是空白的当没写。其余原样（数组顺序永不重排）。
 */
export function canonicalOutput(output: NodeData['output']): NodeData['output'] {
  if (!Array.isArray(output)) return output
  const specs = output.map((spec) =>
    spec.rule === undefined || spec.rule.trim() === '' ? { path: spec.path } : { ...spec },
  )
  if (specs.length === 0) return undefined
  const [only] = specs
  if (specs.length === 1 && only !== undefined && only.rule === undefined) return only.path
  return specs
}

/** 把任意写法的产出摊成一张清单（`false` 与未声明都是空清单）。 */
export function outputSpecs(output: NodeData['output']): OutputSpec[] {
  if (typeof output === 'string') return output === '' ? [] : [{ path: output }]
  if (Array.isArray(output)) return output.map((spec) => ({ ...spec }))
  return []
}

/** 两份 `data` 内容是否相同（产出按规范写法比，数组逐项比）。 */
export function sameNodeData(a: NodeData, b: NodeData): boolean {
  return (
    a.label === b.label &&
    a.description === b.description &&
    a.icon === b.icon &&
    a.color === b.color &&
    a.prompt === b.prompt &&
    JSON.stringify(canonicalOutput(a.output) ?? null) ===
      JSON.stringify(canonicalOutput(b.output) ?? null)
  )
}

/** 深拷一份输入节点的 `data`（选项与多选默认值不和原件共用）。 */
export function cloneInputData(data: InputData): InputData {
  const copy: InputData = { ...data }
  if (data.options !== undefined) copy.options = [...data.options]
  if (Array.isArray(data.default)) copy.default = [...data.default]
  return copy
}

/** 深拷一份 `data`（产出数组不和原件共用）。 */
export function cloneNodeData(data: NodeData): NodeData {
  const copy: NodeData = { ...data }
  if (Array.isArray(data.output)) copy.output = data.output.map((spec) => ({ ...spec }))
  return copy
}

/**
 * 从原始对象里挑出工作流设置的已知键。根目录存规范化后的写法；认不出的执行方式当缺省（`auto`）。
 * 全是缺省值时返回 `undefined`（文件里不写这个键）。
 */
export function readSettings(raw: unknown): WorkflowSettings | undefined {
  if (!isPlainObject(raw)) return undefined
  const settings: WorkflowSettings = {}
  // 空串 = 没配（用默认根目录）；`.` = 明确写在工作区根，原样留着。
  if (typeof raw.outputRoot === 'string' && raw.outputRoot.trim() !== '') {
    settings.outputRoot = normalizeRoot(raw.outputRoot) ?? WORKSPACE_ROOT
  }
  const mode = EXECUTION_MODES.find((candidate) => candidate === raw.mode)
  if (mode !== undefined && mode !== 'auto') settings.mode = mode
  if (raw.runState === true) settings.runState = true
  return Object.keys(settings).length > 0 ? settings : undefined
}

/** 冲突清单里代表「工作流设置」的那一项（设置没有 id，用这个固定键）。 */
export const SETTINGS_CONFLICT_ID = 'settings'

/** 两份设置是否相同（缺省与缺省相等）。 */
export function sameSettings(
  a: WorkflowSettings | undefined,
  b: WorkflowSettings | undefined,
): boolean {
  return (
    a?.outputRoot === b?.outputRoot &&
    (a?.mode ?? 'auto') === (b?.mode ?? 'auto') &&
    a?.runState === b?.runState
  )
}

/** 交接：`false` 原样；对象只认字符串 `note`（空白说明 = 缺省）；其余值当没写（= 交执行结果）。 */
export function readHandoff(raw: unknown): Handoff | false | undefined {
  if (raw === false) return false
  if (!isPlainObject(raw) || typeof raw.note !== 'string') return undefined
  return canonicalHandoff({ note: raw.note })
}

/** 交接的规范写法：空白说明 = 缺省（交执行结果、不附说明）。 */
export function canonicalHandoff(
  handoff: Handoff | false | undefined,
): Handoff | false | undefined {
  if (handoff === undefined || handoff === false) return handoff
  return handoff.note.trim() === '' ? undefined : { note: handoff.note }
}

/** 两份交接是否相同（按规范写法比；缺省与缺省相等）。 */
export function sameHandoff(
  a: Handoff | false | undefined,
  b: Handoff | false | undefined,
): boolean {
  return JSON.stringify(canonicalHandoff(a) ?? null) === JSON.stringify(canonicalHandoff(b) ?? null)
}

/** 两条边的 `data` 内容是否相同（条件、标签、交接、写入方式）。 */
export function sameEdgeData(a: EdgeData | undefined, b: EdgeData | undefined): boolean {
  return (
    a?.when === b?.when &&
    a?.label === b?.label &&
    a?.update === b?.update &&
    sameHandoff(a?.handoff, b?.handoff)
  )
}

/** 深拷一份边的 `data`。 */
function cloneEdgeData(data: EdgeData): EdgeData {
  const copy: EdgeData = { ...data }
  if (data.handoff !== undefined && data.handoff !== false) copy.handoff = { ...data.handoff }
  return copy
}

/** 从原始对象里挑出边 `data` 的已知键。 */
function readEdgeData(raw: unknown): EdgeData | undefined {
  if (!isPlainObject(raw)) return undefined
  const data: EdgeData = {}
  if (typeof raw.when === 'string') data.when = raw.when
  if (typeof raw.label === 'string') data.label = raw.label
  const handoff = readHandoff(raw.handoff)
  if (handoff !== undefined) data.handoff = handoff
  if (raw.update === true) data.update = true
  return Object.keys(data).length > 0 ? data : undefined
}

// ─────────────────────────────────────────────────────────────
// 文件节点
// ─────────────────────────────────────────────────────────────

export function isStep(node: WorkflowNode): node is StepNode {
  return node.type !== FILE_TYPE && node.type !== INPUT_TYPE
}

export function isInput(node: WorkflowNode): node is InputNode {
  return node.type === INPUT_TYPE
}

export function isFile(node: WorkflowNode): node is FileNode {
  return node.type === FILE_TYPE
}

/** 文件节点 `data` 的已知键；没有字符串 `path` 时给空串（校验层报保存级）。 */
export function readFileData(raw: unknown): FileData {
  if (!isPlainObject(raw)) return { path: '' }
  const data: FileData = { path: typeof raw.path === 'string' ? raw.path : '' }
  if (typeof raw.rule === 'string' && raw.rule.trim() !== '') data.rule = raw.rule
  return data
}

/** 一段文字：去掉首尾空白后为空就当没写。 */
function filled(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * 输入节点 `data` 的已知键，顺手规范化：选项去空、去重；不认识的交互方式当单行文字；
 * 默认值按交互方式取形（文字题 / 单选是一段文字，多选是若干选项）。没有字符串 `question` 时给空串（编译级）。
 */
export function readInputData(raw: unknown): InputData {
  if (!isPlainObject(raw)) return { question: '' }
  const kind = INPUT_KINDS.find((candidate) => candidate === raw.kind) ?? 'text'
  const data: InputData = { question: typeof raw.question === 'string' ? raw.question : '' }
  if (kind !== 'text') data.kind = kind
  const choice = kind === 'choice' || kind === 'multi'
  if (choice && Array.isArray(raw.options)) {
    const options: string[] = []
    for (const item of raw.options) {
      if (typeof item !== 'string') continue
      const option = item.trim()
      if (option !== '' && !options.includes(option)) options.push(option)
    }
    if (options.length > 0) data.options = options
  }
  const fallback = readAnswer(kind, raw.default)
  if (fallback !== undefined) data.default = fallback
  if (!choice) {
    const placeholder = filled(raw.placeholder)
    if (placeholder !== undefined) data.placeholder = placeholder
  }
  const hint = filled(raw.hint)
  if (hint !== undefined) data.hint = hint
  if (raw.required === true) data.required = true
  return data
}

/**
 * 一份回答按交互方式取形：文字题与单选是一段文字（空白 = 没回答），多选是去空、去重后的若干项
 * （一项都没有 = 没回答）。形状对不上（比如多选给了一段文字）时也尽量接住。
 */
export function readAnswer(
  kind: InputData['kind'] | 'text',
  raw: unknown,
): InputAnswer | undefined {
  if (kind === 'multi') {
    const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
    const picked: string[] = []
    for (const item of items) {
      if (typeof item !== 'string') continue
      const value = item.trim()
      if (value !== '' && !picked.includes(value)) picked.push(value)
    }
    return picked.length > 0 ? picked : undefined
  }
  const text = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw
  if (typeof text !== 'string' || text.trim() === '') return undefined
  return kind === 'choice' ? text.trim() : text
}

/** 输入节点 `data` 的规范写法（读入的规范化 + 固定键序），写盘与比较都用它。 */
export function canonicalInput(data: InputData): InputData {
  const normalized = readInputData(data)
  const out: Record<string, unknown> = {}
  for (const key of INPUT_KEYS) {
    const value = normalized[key]
    if (value !== undefined) out[key] = value
  }
  return out as unknown as InputData
}

/** 两个节点的内容是否相同（类型 + `data`；坐标不算）。 */
export function sameNodeContent(a: WorkflowNode, b: WorkflowNode): boolean {
  if (isInput(a) || isInput(b)) {
    return (
      isInput(a) &&
      isInput(b) &&
      JSON.stringify(canonicalInput(a.data)) === JSON.stringify(canonicalInput(b.data))
    )
  }
  if (isFile(a) || isFile(b)) {
    return (
      isFile(a) &&
      isFile(b) &&
      a.data.path === b.data.path &&
      (a.data.rule ?? '') === (b.data.rule ?? '')
    )
  }
  return sameNodeData(a.data, b.data)
}

/**
 * 从文件路径起一个文件节点 id：取文件名、换掉文件名里不许出现的字符，前面加 `file-`；
 * 撞名（大小写不敏感）就加 `-2`、`-3`…
 */
export function fileIdFor(path: string, taken: (id: string) => boolean): string {
  const name =
    path
      .split(/[\\/]/u)
      .filter((part) => part !== '' && part !== '.')
      .pop() ?? 'file'
  // 文件名里不许出现的字符（Windows 非法字符、空白、控制字符）换成 `-`。
  const safe = [...name]
    .map((ch) => (/[<>:"/\\|?*\s]/u.test(ch) || (ch.codePointAt(0) ?? 0) < 32 ? '-' : ch))
    .join('')
    .replace(/-+/gu, '-')
    .replace(/\.+$/u, '')
  const base = `file-${safe}`.slice(0, 60)
  if (!taken(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken(candidate)) return candidate
  }
}

/**
 * 老图迁移：步骤上的 `output` 展开成文件节点 + 「步骤 → 文件」的写入线（同一路径共用一个文件节点）。
 * 新文件节点的坐标是 `(0,0)`（"还没摆过"），由画布的布局补位。
 * @returns 迁移过的步骤 id（没有就是空数组）。
 */
export function migrateOutputs(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const migrated: string[] = []
  const taken = new Set(nodes.map((node) => idKey(node.id)))
  const byPath = new Map<string, FileNode>()
  for (const node of nodes) {
    if (isFile(node)) byPath.set(outputKey(node.data.path), node)
  }
  const edgeIds = new Set(edges.map((edge) => edge.id))
  for (const node of [...nodes]) {
    if (!isStep(node) || node.data.output === undefined) continue
    for (const spec of outputSpecs(node.data.output)) {
      let file = byPath.get(outputKey(spec.path))
      if (file === undefined) {
        const id = fileIdFor(spec.path, (candidate) => taken.has(idKey(candidate)))
        taken.add(idKey(id))
        file = {
          id,
          type: FILE_TYPE,
          position: { x: 0, y: 0 },
          data:
            spec.rule === undefined ? { path: spec.path } : { path: spec.path, rule: spec.rule },
        }
        nodes.push(file)
        byPath.set(outputKey(spec.path), file)
      } else if (file.data.rule === undefined && spec.rule !== undefined) {
        file.data = { ...file.data, rule: spec.rule }
      }
      const id = makeEdgeId(node.id, file.id)
      if (edgeIds.has(id)) continue
      edgeIds.add(id)
      edges.push({ id, source: node.id, target: file.id, sourceHandle: null, targetHandle: null })
    }
    const { output: _old, ...rest } = node.data
    node.data = rest
    migrated.push(node.id)
  }
  return migrated
}

/**
 * 把 `JSON.parse` 的结果规范化成我们的文档形状。
 *
 * 保存级破损（顶层不是对象 / `nodes` 或 `edges` 不是数组 / 元素不是对象 /
 * 缺 `id` / 缺 `source` / `target` / 坐标非法）→ `document: null` + 保存级问题。
 * 其余问题（未知字段、未知 `type`、`position` 缺失、悬空 edge…）在**保留文档**的前提下
 * 逐条报出，交给上层按级别处置。
 */
export function normalizeDocument(input: unknown): ParseOutcome {
  const problems: ValidationProblem[] = []

  if (!isPlainObject(input)) {
    return {
      document: null,
      problems: [problem('save', 'schema_invalid', '顶层不是一个 JSON 对象')],
    }
  }
  if (!Array.isArray(input.nodes)) {
    return {
      document: null,
      problems: [problem('save', 'schema_invalid', '顶层缺少 nodes 数组')],
    }
  }
  if (!Array.isArray(input.edges)) {
    return {
      document: null,
      problems: [problem('save', 'schema_invalid', '顶层缺少 edges 数组')],
    }
  }

  const nodes: WorkflowNode[] = []
  for (const [index, raw] of input.nodes.entries()) {
    if (!isPlainObject(raw)) {
      problems.push(problem('save', 'schema_invalid', `nodes[${index}] 不是一个对象`))
      continue
    }
    if (typeof raw.id !== 'string' || raw.id === '') {
      problems.push(problem('save', 'node_id_missing', `nodes[${index}] 缺少 id`))
      continue
    }
    const position = readPoint(raw.position)
    if (position === null) {
      problems.push(
        problem('hint', 'position_filled', `节点 ${raw.id} 没有合法坐标，将由布局补位`, {
          node: raw.id,
        }),
      )
    }
    if (raw.type === FILE_TYPE) {
      nodes.push({
        id: raw.id,
        type: FILE_TYPE,
        position: position ?? { x: 0, y: 0 },
        data: readFileData(raw.data),
      })
      continue
    }
    if (raw.type === INPUT_TYPE) {
      nodes.push({
        id: raw.id,
        type: INPUT_TYPE,
        position: position ?? { x: 0, y: 0 },
        data: readInputData(raw.data),
      })
      continue
    }
    if (typeof raw.type === 'string' && raw.type !== NODE_TYPE) {
      problems.push(
        problem(
          'warning',
          'unknown_node_type',
          `节点 ${raw.id} 的 type="${raw.type}" 未知，按 ${NODE_TYPE} 渲染`,
          {
            node: raw.id,
          },
        ),
      )
    }
    nodes.push({
      id: raw.id,
      type: NODE_TYPE,
      // 坐标缺失留 (0,0) 占位，由上层跑布局补位并回写。
      position: position ?? { x: 0, y: 0 },
      data: readNodeData(raw.data),
    })
  }

  const edges: WorkflowEdge[] = []
  for (const [index, raw] of input.edges.entries()) {
    if (!isPlainObject(raw)) {
      problems.push(problem('save', 'schema_invalid', `edges[${index}] 不是一个对象`))
      continue
    }
    if (typeof raw.source !== 'string' || typeof raw.target !== 'string') {
      problems.push(problem('save', 'edge_field_missing', `edges[${index}] 缺少 source 或 target`))
      continue
    }
    if (typeof raw.id !== 'string' || raw.id === '') {
      problems.push(
        problem('save', 'edge_field_missing', `edges[${index}] 缺少 id`, {
          edge: `${raw.source}->${raw.target}`,
        }),
      )
      continue
    }
    const data = readEdgeData(raw.data)
    edges.push({
      id: raw.id,
      source: raw.source,
      target: raw.target,
      sourceHandle: null,
      targetHandle: null,
      ...(data === undefined ? {} : { data }),
    })
  }

  const viewport = readViewport(input.viewport)
  if (viewport === null) {
    problems.push(
      problem('hint', 'position_filled', 'viewport 缺失或非法，已回落 {x:0,y:0,zoom:1}'),
    )
  }

  const migrated = migrateOutputs(nodes, edges)
  if (migrated.length > 0) {
    problems.push(
      problem(
        'hint',
        'legacy_structure',
        `步骤 ${migrated.join(' / ')} 上的产出已转成文件节点（保存时写成新结构）`,
      ),
    )
  }

  const settings = readSettings(input.settings)
  return {
    document: {
      nodes,
      edges,
      viewport: viewport ?? { x: 0, y: 0, zoom: 1 },
      ...(settings === undefined ? {} : { settings }),
    },
    problems,
  }
}

/** `JSON.parse` + {@link normalizeDocument}。解析失败就是保存级。 */
export function readDocument(text: string): ParseOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      document: null,
      problems: [
        problem(
          'save',
          'json_parse_failed',
          `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    }
  }
  return normalizeDocument(parsed)
}

// ─────────────────────────────────────────────────────────────
// 写出（canonical writer）
// ─────────────────────────────────────────────────────────────

/** 按固定键序挑键——凡是键序表之外的字段一律不写（白名单）。 */
function pickNode(node: WorkflowNode): Record<string, unknown> {
  const position = { x: normalizeCoord(node.position.x), y: normalizeCoord(node.position.y) }
  if (isInput(node)) {
    return { id: node.id, type: INPUT_TYPE, position, data: canonicalInput(node.data) }
  }
  if (isFile(node)) {
    const rule = node.data.rule
    return {
      id: node.id,
      type: FILE_TYPE,
      position,
      data: {
        path: node.data.path,
        ...(rule === undefined || rule.trim() === '' ? {} : { rule }),
      },
    }
  }
  const data: Record<string, unknown> = {}
  for (const key of DATA_KEYS) {
    const value = key === 'output' ? canonicalOutput(node.data.output) : node.data[key]
    if (value !== undefined) data[key] = value
  }
  return {
    id: node.id,
    type: NODE_TYPE,
    position,
    data,
  }
}

function pickEdge(edge: WorkflowEdge): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: null,
    targetHandle: null,
  }
  const data: Record<string, unknown> = {}
  for (const key of EDGE_DATA_KEYS) {
    const value = key === 'handoff' ? canonicalHandoff(edge.data?.handoff) : edge.data?.[key]
    if (value !== undefined) data[key] = value
  }
  if (Object.keys(data).length > 0) out.data = data
  return out
}

/**
 * Canonical 写出。**同一份文档两次写出必得逐字节相同的文本**，而不同文档的差异
 * 被限制在改动的那一个块里（2 空格缩进的每节点／每边一个多行块）。
 */
export function writeDocument(document: WorkflowDocument): string {
  const settings = readSettings(document.settings)
  const payload = {
    nodes: document.nodes.map(pickNode),
    edges: document.edges.map(pickEdge),
    viewport: {
      x: normalizeCoord(document.viewport.x),
      y: normalizeCoord(document.viewport.y),
      zoom: normalizeCoord(document.viewport.zoom),
    },
    // 设置排在最后、全缺省时不写：老文件逐字节不变。
    ...(settings === undefined
      ? {}
      : {
          settings: {
            ...(settings.outputRoot === undefined ? {} : { outputRoot: settings.outputRoot }),
            ...(settings.mode === undefined ? {} : { mode: settings.mode }),
            ...(settings.runState === undefined ? {} : { runState: settings.runState }),
          },
        }),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/** 深拷贝一份文档（工具做读-改-写时用，避免就地改调用方的对象）。 */
export function cloneDocument(document: WorkflowDocument): WorkflowDocument {
  return {
    nodes: document.nodes.map((node): WorkflowNode => {
      if (isInput(node)) {
        return { ...node, position: { ...node.position }, data: cloneInputData(node.data) }
      }
      return isFile(node)
        ? { ...node, position: { ...node.position }, data: { ...node.data } }
        : { ...node, position: { ...node.position }, data: cloneNodeData(node.data) }
    }),
    edges: document.edges.map((edge) => ({
      ...edge,
      ...(edge.data === undefined ? {} : { data: cloneEdgeData(edge.data) }),
    })),
    viewport: { ...document.viewport },
    ...(document.settings === undefined ? {} : { settings: { ...document.settings } }),
  }
}

/** 按 `id` 找节点。 */
export function findNode(document: WorkflowDocument, id: string): WorkflowNode | undefined {
  const key = idKey(id)
  return document.nodes.find((node) => idKey(node.id) === key)
}

/** 一个节点的入边（**含回边**）。 */
export function incomingEdges(document: WorkflowDocument, id: string): WorkflowEdge[] {
  const key = idKey(id)
  return document.edges.filter((edge) => idKey(edge.target) === key)
}

/** 一个节点的出边。 */
export function outgoingEdges(document: WorkflowDocument, id: string): WorkflowEdge[] {
  const key = idKey(id)
  return document.edges.filter((edge) => idKey(edge.source) === key)
}
