/**
 * dsh-workflow-lite — 步骤库的内容，与「库 → 画布」的拖放载荷。
 *
 * 内置步骤是**起点不是规范**：开箱即用的提示词骨架，插进图里之后随便改。没有它们，
 * 一张新图只能从空白提示词写起。文案全部走 locale 词典（键名在这里，正文在 `i18n.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/library
 */

import type { NodeData, WorkflowNode } from '../../shared/types.ts'
import { NODE_TYPE } from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { COL_STEP, ROW_STEP } from './layout.ts'

/** 步骤的"种类"——只决定图标与色调，不进文档。 */
export type StepKind = 'scan' | 'plan' | 'implement' | 'review' | 'fix' | 'report' | 'blank'

export interface StepPreset {
  /** 建议的节点 id（撞名由 `uniqueNodeId` 加序号）。 */
  id: string
  kind: StepKind
  labelKey: LocaleKey
  descKey: LocaleKey
  promptKey: LocaleKey
  /** 产出契约；`false` = 显式声明不产出文件。 */
  output?: string | false
}

/** 呈现顺序 = 一条常见主线的顺序。 */
export const PRESETS: readonly StepPreset[] = [
  {
    id: 'scan',
    kind: 'scan',
    labelKey: 'preset.scan.label',
    descKey: 'preset.scan.desc',
    promptKey: 'preset.scan.prompt',
    output: 'scan-notes.md',
  },
  {
    id: 'plan',
    kind: 'plan',
    labelKey: 'preset.plan.label',
    descKey: 'preset.plan.desc',
    promptKey: 'preset.plan.prompt',
    output: 'plan.md',
  },
  {
    id: 'implement',
    kind: 'implement',
    labelKey: 'preset.implement.label',
    descKey: 'preset.implement.desc',
    promptKey: 'preset.implement.prompt',
    output: 'changes.md',
  },
  {
    id: 'review',
    kind: 'review',
    labelKey: 'preset.review.label',
    descKey: 'preset.review.desc',
    promptKey: 'preset.review.prompt',
    output: 'review.md',
  },
  {
    id: 'fix',
    kind: 'fix',
    labelKey: 'preset.fix.label',
    descKey: 'preset.fix.desc',
    promptKey: 'preset.fix.prompt',
    output: 'fix-notes.md',
  },
  {
    id: 'report',
    kind: 'report',
    labelKey: 'preset.report.label',
    descKey: 'preset.report.desc',
    promptKey: 'preset.report.prompt',
    output: false,
  },
]

/** 空白步骤的建议 id。 */
export const BLANK_ID = 'step'

/** 内置步骤实例化成节点的 `data`。 */
export function presetData(preset: StepPreset, t: T): NodeData {
  return {
    label: t(preset.labelKey),
    prompt: t(preset.promptKey),
    ...(preset.output === undefined ? {} : { output: preset.output }),
  }
}

/**
 * 从节点 id 猜它的种类：`review`、`review-2` 都算 `review`。
 *
 * 文档里不存"种类"（一个节点就是 label / prompt / output），图标只是个认路的记号，
 * 猜不中就是通用图标，不影响任何行为。
 */
export function kindOf(id: string): StepKind {
  const base = id.toLowerCase().replace(/-\d+$/u, '')
  return PRESETS.find((preset) => preset.id === base)?.kind ?? 'blank'
}

/**
 * 示例流程：侦察 → 拆解 → 实现 → 审查，通过去汇总，未通过去修复再回到审查。
 * 一次把顺序、分支、循环三种形态都摆出来，比任何说明文字都快。
 */
export function starterGraph(t: T): {
  nodes: WorkflowNode[]
  edges: { source: string; target: string; when?: string }[]
} {
  const at: Record<string, [number, number]> = {
    scan: [0, 0],
    plan: [1, 0],
    implement: [2, 0],
    review: [3, 0],
    report: [4, 0],
    // 修复放在汇总下面：未通过的线往右下走，修完的回线沿两行之间的走廊回到审查。
    fix: [4, 1],
  }
  const nodes = PRESETS.map((preset) => {
    const [column, row] = at[preset.id] ?? [0, 0]
    return {
      id: preset.id,
      type: NODE_TYPE,
      position: { x: 80 + column * COL_STEP, y: 120 + row * (ROW_STEP + 64) },
      data: presetData(preset, t),
    }
  })
  return {
    nodes,
    edges: [
      { source: 'scan', target: 'plan' },
      { source: 'plan', target: 'implement' },
      { source: 'implement', target: 'review' },
      { source: 'review', target: 'report', when: 'pass' },
      { source: 'review', target: 'fix', when: 'fail' },
      { source: 'fix', target: 'review' },
    ],
  }
}

// ─────────────────────────────────────────────────────────────
// 拖放载荷
// ─────────────────────────────────────────────────────────────

/** 自定义 MIME，免得跟别处的拖放撞车。 */
export const DND_MIME = 'application/x-workflow-lite-step'

/** 从库里拿出来的东西：空白步骤、内置步骤，或磁盘上的节点模板。 */
export type StepSource =
  | { kind: 'blank' }
  | { kind: 'preset'; id: string }
  | { kind: 'template'; name: string }

export function encodeStepSource(source: StepSource): string {
  return JSON.stringify(source)
}

/**
 * 解码。`dataTransfer` 里可能是别的应用拖进来的任意内容，那不是错误而是"不归我们管"：
 * 任何不认识的输入一律返回 `null`，**永不抛异常**。
 *
 * 用 `Map` 查键而不是直接读属性：`JSON.parse('{"__proto__":{"kind":"blank"}}')` 得到的对象
 * 会顺着原型链读出一个它自己并没有的 `kind`；`Map.get` 只认自有键。
 */
export function decodeStepSource(raw: string | null | undefined): StepSource | null {
  if (typeof raw !== 'string' || raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const fields = new Map(Object.entries(parsed))
  const text = (key: string): string | null => {
    const value = fields.get(key)
    return typeof value === 'string' && value !== '' ? value : null
  }
  switch (fields.get('kind')) {
    case 'blank':
      return { kind: 'blank' }
    case 'preset': {
      const id = text('id')
      return id === null ? null : { kind: 'preset', id }
    }
    case 'template': {
      const name = text('name')
      return name === null ? null : { kind: 'template', name }
    }
    default:
      return null
  }
}
