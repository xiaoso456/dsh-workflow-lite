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

import { COORD_DECIMALS } from './limits.ts'
import {
  type EdgeData,
  NODE_TYPE,
  type NodeData,
  type OutputSpec,
  type ValidationProblem,
  type Viewport,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from './types.ts'

/** node 的 data 键序。 */
const DATA_KEYS = ['label', 'description', 'prompt', 'output'] as const
/** edge 的 data 键序。 */
const EDGE_DATA_KEYS = ['when', 'label'] as const

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
    a.prompt === b.prompt &&
    JSON.stringify(canonicalOutput(a.output) ?? null) ===
      JSON.stringify(canonicalOutput(b.output) ?? null)
  )
}

/** 深拷一份 `data`（产出数组不和原件共用）。 */
export function cloneNodeData(data: NodeData): NodeData {
  const copy: NodeData = { ...data }
  if (Array.isArray(data.output)) copy.output = data.output.map((spec) => ({ ...spec }))
  return copy
}

/** 从原始对象里挑出边 `data` 的已知键。 */
function readEdgeData(raw: unknown): EdgeData | undefined {
  if (!isPlainObject(raw)) return undefined
  const data: EdgeData = {}
  if (typeof raw.when === 'string') data.when = raw.when
  if (typeof raw.label === 'string') data.label = raw.label
  return Object.keys(data).length > 0 ? data : undefined
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

  return { document: { nodes, edges, viewport: viewport ?? { x: 0, y: 0, zoom: 1 } }, problems }
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
  const data: Record<string, unknown> = {}
  for (const key of DATA_KEYS) {
    const value = key === 'output' ? canonicalOutput(node.data.output) : node.data[key]
    if (value !== undefined) data[key] = value
  }
  return {
    id: node.id,
    type: NODE_TYPE,
    position: { x: normalizeCoord(node.position.x), y: normalizeCoord(node.position.y) },
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
    const value = edge.data?.[key]
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
  const payload = {
    nodes: document.nodes.map(pickNode),
    edges: document.edges.map(pickEdge),
    viewport: {
      x: normalizeCoord(document.viewport.x),
      y: normalizeCoord(document.viewport.y),
      zoom: normalizeCoord(document.viewport.zoom),
    },
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/** 深拷贝一份文档（工具做读-改-写时用，避免就地改调用方的对象）。 */
export function cloneDocument(document: WorkflowDocument): WorkflowDocument {
  return {
    nodes: document.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: cloneNodeData(node.data),
    })),
    edges: document.edges.map((edge) => ({
      ...edge,
      ...(edge.data === undefined ? {} : { data: { ...edge.data } }),
    })),
    viewport: { ...document.viewport },
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
