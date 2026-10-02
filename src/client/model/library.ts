/**
 * dsh-workflow-lite — 步骤库的内容，与「库 → 画布」的拖放载荷。
 *
 * 内置步骤是**起点不是规范**：开箱即用的提示词骨架，插进图里之后随便改。没有它们，
 * 一张新图只能从空白提示词写起。文案全部走 locale 词典（键名在这里，正文在 `i18n.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/library
 */

import { presetAppearance } from '../../shared/appearance.ts'
import type { Handoff, InputData, InputKind, NodeData, WorkflowNode } from '../../shared/types.ts'
import { FILE_TYPE, NODE_TYPE } from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { COL_STEP } from './layout.ts'

export interface StepPreset {
  /** 建议的节点 id（撞名由 `uniqueNodeId` 加序号）。 */
  id: string
  labelKey: LocaleKey
  descKey: LocaleKey
  promptKey: LocaleKey
  /** 产出契约；`false` = 显式声明不产出文件。 */
  output?: string | false
  /** 产出文件的生成规则（进计划的「产出要求」）。 */
  ruleKey?: LocaleKey
}

/** 呈现顺序 = 一条常见主线的顺序。 */
export const PRESETS: readonly StepPreset[] = [
  {
    id: 'scan',
    labelKey: 'preset.scan.label',
    descKey: 'preset.scan.desc',
    promptKey: 'preset.scan.prompt',
    ruleKey: 'preset.scan.rule',
    output: 'scan-notes.md',
  },
  {
    id: 'plan',
    labelKey: 'preset.plan.label',
    descKey: 'preset.plan.desc',
    promptKey: 'preset.plan.prompt',
    ruleKey: 'preset.plan.rule',
    output: 'plan.md',
  },
  {
    id: 'implement',
    labelKey: 'preset.implement.label',
    descKey: 'preset.implement.desc',
    promptKey: 'preset.implement.prompt',
    ruleKey: 'preset.implement.rule',
    output: 'changes.md',
  },
  {
    id: 'review',
    labelKey: 'preset.review.label',
    descKey: 'preset.review.desc',
    promptKey: 'preset.review.prompt',
    ruleKey: 'preset.review.rule',
    output: 'review.md',
  },
  {
    id: 'fix',
    labelKey: 'preset.fix.label',
    descKey: 'preset.fix.desc',
    promptKey: 'preset.fix.prompt',
    ruleKey: 'preset.fix.rule',
    output: 'fix-notes.md',
  },
  {
    id: 'report',
    labelKey: 'preset.report.label',
    descKey: 'preset.report.desc',
    promptKey: 'preset.report.prompt',
    output: false,
  },
]

/**
 * 右侧面板正在看步骤库里的哪一项（与画布上的选中互斥）。
 * `new` = 正在新建一个「我的步骤」，`seed` 是预填的内容（复制内置步骤时带过来）。
 */
export type LibraryFocus =
  | { kind: 'preset'; id: string }
  | { kind: 'template'; name: string }
  | { kind: 'new'; seed: NodeData; name: string }

/** 空白步骤的建议 id。 */
export const BLANK_ID = 'step'

/** 输入节点的建议 id。 */
export const INPUT_ID = 'ask'

/**
 * 输入的四种交互（呈现顺序）与文案。步骤库里只有一个「用户输入」，拖到画布上默认是一句话，
 * 在属性面板里切换交互方式。
 */
export const INPUT_KIND_OPTIONS: readonly { kind: InputKind; labelKey: LocaleKey }[] = [
  { kind: 'text', labelKey: 'input.kind.text' },
  { kind: 'textarea', labelKey: 'input.kind.textarea' },
  { kind: 'choice', labelKey: 'input.kind.choice' },
  { kind: 'multi', labelKey: 'input.kind.multi' },
]

/** 交互方式的显示名。 */
export function inputKindLabel(kind: InputKind): LocaleKey {
  return INPUT_KIND_OPTIONS.find((option) => option.kind === kind)?.labelKey ?? 'input.kind.text'
}

/** 新输入节点的 `data`：一句话，带一个起手的问题（空问题挡编译）。 */
export function inputData(t: T): InputData {
  return { question: t('input.seed.text') }
}

/** 内置步骤实例化成节点的 `data`。 */
export function presetData(preset: StepPreset, t: T): NodeData {
  const look = presetAppearance(preset.id)
  return {
    label: t(preset.labelKey),
    description: t(preset.descKey),
    icon: look.icon,
    color: look.color,
    prompt: t(preset.promptKey),
    ...(preset.output === undefined
      ? {}
      : {
          output:
            typeof preset.output === 'string' && preset.ruleKey !== undefined
              ? [{ path: preset.output, rule: t(preset.ruleKey) }]
              : preset.output,
        }),
  }
}

/**
 * 示例流程：侦察 → 拆解 → 实现 → 审查，通过去汇总，未通过去修复再回到审查。
 * 一次把顺序、分支、循环、文件（含几步共用的审查报告）都摆出来，比任何说明文字都快：
 * 每一步的产出是挂在它右下方的文件卡；审查报告由修复在原文件上打钩，汇总读它的最终版。
 */
export function starterGraph(t: T): {
  nodes: WorkflowNode[]
  edges: {
    source: string
    target: string
    when?: string
    handoff?: Handoff | false
    update?: boolean
  }[]
} {
  const x = (column: number): number => 80 + column * COL_STEP
  const at: Record<string, [number, number]> = {
    scan: [x(0), 120],
    plan: [x(1), 120],
    implement: [x(2), 120],
    review: [x(3), 120],
    report: [x(4), 120],
    // 修复放在汇总下面、文件那一排再往下：未通过的线往下走，修完的回线回到审查。
    fix: [x(4), 520],
  }
  const nodes: WorkflowNode[] = []
  const edges: ReturnType<typeof starterGraph>['edges'] = []
  for (const preset of PRESETS) {
    const [px, py] = at[preset.id] ?? [0, 0]
    const { output: _template, ...data } = presetData(preset, t)
    nodes.push({ id: preset.id, type: NODE_TYPE, position: { x: px, y: py }, data })
    if (typeof preset.output !== 'string') continue
    const fileId = `file-${preset.output}`
    nodes.push({
      id: fileId,
      type: FILE_TYPE,
      position: { x: px + 40, y: py + 132 },
      data: {
        path: preset.output,
        ...(preset.ruleKey === undefined ? {} : { rule: t(preset.ruleKey) }),
      },
    })
    edges.push({ source: preset.id, target: fileId })
  }
  edges.push(
    { source: 'scan', target: 'plan' },
    { source: 'plan', target: 'implement' },
    { source: 'implement', target: 'review' },
    { source: 'review', target: 'report', when: 'pass' },
    { source: 'review', target: 'fix', when: 'fail', handoff: { note: t('starter.fixNote') } },
    { source: 'fix', target: 'review', handoff: { note: t('starter.recheckNote') } },
    // 读：每一步读上一步的产出；审查报告被修复就地更新，汇总读它的最终版。
    { source: 'file-scan-notes.md', target: 'plan' },
    { source: 'file-plan.md', target: 'implement' },
    { source: 'file-changes.md', target: 'review' },
    { source: 'fix', target: 'file-review.md', update: true },
    { source: 'file-review.md', target: 'report' },
    { source: 'file-fix-notes.md', target: 'review' },
  )
  return { nodes, edges }
}

// ─────────────────────────────────────────────────────────────
// 拖放载荷
// ─────────────────────────────────────────────────────────────

/** 自定义 MIME，免得跟别处的拖放撞车。 */
export const DND_MIME = 'application/x-workflow-lite-step'

/** 从库里拿出来的东西：空白步骤、内置步骤，或磁盘上的节点模板。 */
export type StepSource =
  | { kind: 'blank' }
  /** 一张文件卡（不是步骤，但同样从库里拖、从菜单里加）。 */
  | { kind: 'file' }
  /** 一个输入节点（执行前问用户的问题）。 */
  | { kind: 'input' }
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
    case 'file':
      return { kind: 'file' }
    case 'input':
      return { kind: 'input' }
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
