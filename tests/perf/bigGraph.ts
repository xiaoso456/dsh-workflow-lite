/**
 * 性能场景用的大图：一份 25 张卡、33 条线的「研发流程」（16 个步骤、1 个提问、7 个产出资源、1 张文字展示卡，
 * 带通过 / 未通过的回环和读写线），复制 K 份首尾串起来。K = 4 约 100 张卡，K = 16 约 400 张卡。
 *
 * 位置全在原点：打开后点「整理」排版（浏览器场景），或用 `model/layout.ts` 的 `tidy` 排（Node 场景）。
 */

import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from '../../src/shared/types.ts'

const NAMES = [
  '调研',
  '拆解',
  '设计',
  '评审设计',
  '修改设计',
  '实现A',
  '实现B',
  '集成',
  '测试',
  '审查',
  '修复',
  '回归',
  '文档',
  '发布检查',
  '发布',
  '汇总',
]
const FLOW: [string, string, string?][] = [
  ['s0', 's1'],
  ['s1', 's2'],
  ['s2', 's3'],
  ['s3', 's5', 'pass'],
  ['s3', 's4', 'fail'],
  ['s4', 's3'],
  ['s5', 's7'],
  ['s6', 's7'],
  ['s3', 's6', 'pass'],
  ['s7', 's8'],
  ['s8', 's9'],
  ['s9', 's11', 'pass'],
  ['s9', 's10', 'fail'],
  ['s10', 's9'],
  ['s11', 's12'],
  ['s12', 's13'],
  ['s13', 's14'],
  ['s14', 's15'],
]
const IO: [string, string, string[]][] = [
  ['s0', 'r0', ['s1', 's2', 's9']],
  ['s2', 'r1', ['s3', 's5', 's6']],
  ['s1', 'r2', ['s5', 's6', 's7']],
  ['s8', 'r3', ['s9', 's11']],
  ['s9', 'r4', ['s10']],
  ['s12', 'r5', ['s15']],
  ['s13', 'r6', ['s14']],
]
const RESOURCES = ['需求', '设计稿', '接口', '测试报告', '审查意见', '变更日志', '发布清单']

/** K 份串起来的大图（工作流 JSON，位置未排）。 */
export function bigGraph(copies: number): WorkflowDocument {
  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []
  const at = { x: 0, y: 0 }
  for (let k = 0; k < copies; k += 1) {
    const p = (id: string): string => `${id}_${k}`
    const link = (s: string, t: string, when?: string): void => {
      edges.push({
        id: when === undefined ? `${p(s)}->${p(t)}` : `${p(s)}->${p(t)}#${when}`,
        source: p(s),
        target: p(t),
        sourceHandle: null,
        targetHandle: null,
        ...(when === undefined ? {} : { data: { when } }),
      })
    }
    for (const [i, label] of NAMES.entries()) {
      nodes.push({
        id: p(`s${i}`),
        type: 'wfNode',
        position: at,
        data: {
          label: `${label}${k}`,
          description: `${label}的说明文字`,
          prompt: `做${label}。`.repeat(8),
        },
      })
    }
    nodes.push({
      id: p('q0'),
      type: 'wfInput',
      position: at,
      data: { question: '要改哪个模块？', required: true },
    })
    for (const [i, label] of RESOURCES.entries()) {
      nodes.push({
        id: p(`r${i}`),
        type: 'wfResource',
        position: at,
        data: {
          label: `${label}${k}`,
          items: [{ kind: 'file', value: `docs/${k}-${i}.md`, note: `${label}备注` }],
        },
      })
    }
    nodes.push({
      id: p('r7'),
      type: 'wfResource',
      position: at,
      data: {
        label: `目标${k}`,
        items: [
          {
            kind: 'text',
            value: '## 目标\n\n- P99 < **200 ms**\n- 错误率 < 0.1%\n- 每轮只试一个方案',
          },
        ],
        view: { width: 280, height: 168 },
      },
    })
    link('q0', 's0')
    for (const [a, b, w] of FLOW) link(a, b, w)
    for (const [producer, r, readers] of IO) {
      link(producer, r)
      for (const reader of readers) link(r, reader)
    }
    link('r7', 's2')
    if (k > 0) {
      edges.push({
        id: `s15_${k - 1}->s0_${k}`,
        source: `s15_${k - 1}`,
        target: `s0_${k}`,
        sourceHandle: null,
        targetHandle: null,
      })
    }
  }
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, settings: { runState: true } }
}

/** 连线最多的步骤（拖它最费），取最中间那一份里的，免得贴着图的边。 */
export function busiestStep(doc: WorkflowDocument): string {
  const copies = doc.nodes.filter((node) => node.id.startsWith('s0_')).length
  const middle = `_${Math.floor(copies / 2)}`
  const degree = new Map<string, number>()
  for (const edge of doc.edges) {
    for (const id of [edge.source, edge.target]) degree.set(id, (degree.get(id) ?? 0) + 1)
  }
  return doc.nodes
    .filter((node) => node.type === 'wfNode' && node.id.endsWith(middle))
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0].id
}
