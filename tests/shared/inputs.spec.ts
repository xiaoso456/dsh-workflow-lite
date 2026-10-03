/**
 * 输入节点（执行前问用户的问题）与步骤的图标、颜色：读入规范化、写出、校验、编译进计划。
 */

import { describe, expect, it } from 'vitest'
import {
  appearanceOf,
  pickAppearance,
  pickTemplateAppearance,
  presetAppearance,
} from '../../src/shared/appearance.ts'
import { buildFullText, buildPlan } from '../../src/shared/compile.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import {
  checkAnswers,
  effectiveAnswer,
  inputReaders,
  orderedInputs,
  stepInputs,
} from '../../src/shared/inputs.ts'
import {
  isInput,
  isStep,
  makeEdgeId,
  readDocument,
  readInputData,
  readNodeData,
  sameNodeContent,
  writeDocument,
} from '../../src/shared/model.ts'
import { edgeKind, nodeIndex } from '../../src/shared/resources.ts'
import {
  INPUT_TYPE,
  type InputData,
  NODE_TYPE,
  type PlanFacts,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'

function step(id: string, prompt = `做 ${id}`, x = 400, y = 100): WorkflowNode {
  return { id, type: NODE_TYPE, position: { x, y }, data: { prompt } }
}

function input(id: string, data: InputData, x = 80, y = 100): WorkflowNode {
  return { id, type: INPUT_TYPE, position: { x, y }, data }
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: makeEdgeId(source, target), source, target, sourceHandle: null, targetHandle: null }
}

function doc(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowDocument {
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }
}

/** 一张两步的图，三个问题：目录（一句话、必填、连 scan）、语言（单选、默认中文、连 fix 与 scan）、备注（多行、没连）。 */
function sample(): WorkflowDocument {
  return doc(
    [
      step('scan', '扫一遍', 400, 100),
      step('fix', '修掉', 700, 100),
      input(
        'dir',
        {
          question: '要扫描哪个目录？',
          required: true,
          placeholder: '比如 src/',
          hint: '只写一个目录',
        },
        80,
        40,
      ),
      input(
        'lang',
        {
          question: '报告用什么语言？',
          kind: 'choice',
          options: ['中文', 'English'],
          default: '中文',
        },
        80,
        160,
      ),
      input('note', { question: '还有什么要交代的？', kind: 'textarea' }, 80, 280),
    ],
    [edge('scan', 'fix'), edge('dir', 'scan'), edge('lang', 'scan'), edge('lang', 'fix')],
  )
}

function facts(document: WorkflowDocument, extra: Partial<PlanFacts> = {}): PlanFacts {
  return {
    name: 'demo',
    document,
    cwd: '/work',
    payloadPaths: new Map(
      document.nodes.filter(isStep).map((node) => [node.id, `/tasks/${node.id}.md`]),
    ),
    ...extra,
  }
}

describe('读入与写出', () => {
  it('规范化：选项去空去重、按题型取默认值、选择题不留占位、不认识的题型当一句话', () => {
    expect(
      readInputData({
        question: '选',
        kind: 'multi',
        options: [' A ', 'B', '', 'A', 3],
        default: 'B',
        placeholder: '不该留',
        hint: '  ',
        required: true,
      }),
    ).toEqual({
      question: '选',
      kind: 'multi',
      options: ['A', 'B'],
      default: ['B'],
      required: true,
    })
    expect(readInputData({ question: 'q', kind: 'slider', default: ['x'] })).toEqual({
      question: 'q',
      default: 'x',
    })
    expect(readInputData('乱写')).toEqual({ question: '' })
  })

  it('往返：输入节点按固定键序写出，读回来内容相同', () => {
    const original = sample()
    const text = writeDocument(original)
    const back = readDocument(text)
    expect(back.problems).toEqual([])
    expect(writeDocument(back.document as WorkflowDocument)).toBe(text)
    const lang = back.document?.nodes.find((node) => node.id === 'lang')
    expect(lang?.type).toBe(INPUT_TYPE)
    expect(Object.keys((lang as WorkflowNode).data)).toEqual([
      'question',
      'kind',
      'options',
      'default',
    ])
    expect(sameNodeContent(lang as WorkflowNode, original.nodes[3] as WorkflowNode)).toBe(true)
  })

  it('输入节点不是步骤：不进批次、不进载荷', () => {
    const analysis = analyzeGraph(sample())
    expect(analysis.nodeIds).toEqual(['fix', 'scan'])
    expect(
      sample()
        .nodes.filter(isInput)
        .map((node) => node.id),
    ).toEqual(['dir', 'lang', 'note'])
  })

  it('线的种类：输入 → 步骤是交回答；连进输入、输入连到文件都不成立', () => {
    const document = doc(
      [
        step('a'),
        input('q', { question: '问' }),
        {
          id: 'f',
          type: 'wfResource',
          position: { x: 0, y: 0 },
          data: { items: [{ kind: 'file', value: 'f.md' }] },
        },
      ],
      [edge('q', 'a'), edge('a', 'q'), edge('q', 'f')],
    )
    const nodes = nodeIndex(document)
    expect(document.edges.map((item) => edgeKind(nodes, item))).toEqual([
      'ask',
      'invalid',
      'invalid',
    ])
  })
})

describe('谁拿到回答', () => {
  it('按画布上从上到下的顺序；连了谁交给谁，没连交给整个工作流', () => {
    const document = sample()
    expect(orderedInputs(document).map((node) => node.id)).toEqual(['dir', 'lang', 'note'])
    expect(inputReaders(document, 'lang')).toEqual(['fix', 'scan'])
    expect(inputReaders(document, 'note')).toEqual([])
    expect(stepInputs(document, 'scan').map((node) => node.id)).toEqual(['dir', 'lang'])
  })

  it('核对回答：补上默认值、挑出不在选项里的与漏填的必填题', () => {
    const document = sample()
    const ok = checkAnswers(document, { dir: 'src/' })
    expect(ok.errors).toEqual([])
    expect(ok.missing).toEqual([])
    expect(ok.answers).toEqual({ dir: 'src/', lang: '中文' })

    const bad = checkAnswers(document, { lang: '法语', ghost: 'x' })
    expect(bad.errors).toHaveLength(2)
    expect(bad.missing.map((node) => node.id)).toEqual(['dir'])
  })

  it('默认值不在选项里时当没有默认值', () => {
    const node = input('c', { question: 'q', kind: 'choice', options: ['A'], default: 'Z' })
    expect(effectiveAnswer(node as never, {})).toBeUndefined()
  })
})

describe('校验', () => {
  it('问题空、选择题没有选项是编译级；默认值不在选项里是警告；输入的线带条件是保存级', () => {
    const document = doc(
      [
        step('a'),
        input('empty', { question: '  ' }),
        input('noopt', { question: '选', kind: 'choice' }),
        input('baddef', { question: '选', kind: 'choice', options: ['A'], default: 'B' }),
      ],
      [{ ...edge('empty', 'a'), data: { when: 'pass' } }],
    )
    const report = validateDocument(document, { workflowName: 'w', maxNodes: 50 })
    expect(report.compile.map((problem) => problem.code).sort()).toEqual([
      'input_options_empty',
      'input_question_empty',
    ])
    expect(report.warning.map((problem) => problem.code)).toContain('input_default_invalid')
    expect(report.save.map((problem) => problem.code)).toContain('resource_edge_invalid')
  })

  it('连进输入节点是保存级', () => {
    const document = doc([step('a'), input('q', { question: '问' })], [edge('a', 'q')])
    const report = validateDocument(document, { workflowName: 'w', maxNodes: 50 })
    expect(report.save.some((problem) => problem.message.includes('输入'))).toBe(true)
  })

  it('问题里有换行是保存级', () => {
    const document = doc([step('a'), input('q', { question: '第一行\n第二行' })])
    const report = validateDocument(document, { workflowName: 'w', maxNodes: 50 })
    expect(report.save.map((problem) => problem.code)).toContain('input_invalid')
  })
})

describe('编译进计划', () => {
  it('执行时：问题与回答写进「本次执行」，注明交给谁；占位与说明不进计划', () => {
    const document = sample()
    const { plan, problems } = buildPlan(
      facts(document, { answers: { dir: 'src/', note: '第一行\n\n第三行' } }),
      analyzeGraph(document),
    )
    expect(problems).toEqual([])
    const section = plan.slice(plan.indexOf('## 本次执行'))
    expect(section).toContain('**用户输入**')
    expect(section).toContain('- 问：要扫描哪个目录？（交给 `scan`）\n  答：src/')
    // 没回答的单选用默认值。
    expect(section).toContain('- 问：报告用什么语言？（交给 `fix`、`scan`）\n  答：中文')
    // 多行回答逐行引用；没连步骤的交给所有步骤。
    expect(section).toContain(
      '- 问：还有什么要交代的？（交给所有步骤）\n  答：\n  > 第一行\n  >\n  > 第三行',
    )
    expect(plan).not.toContain('比如 src/')
    expect(plan).not.toContain('只写一个目录')
  })

  it('预览（没给回答）：问题照写，回答处写「执行时由用户填写」，必填的不拦', () => {
    const document = sample()
    const { plan, problems } = buildPlan(facts(document), analyzeGraph(document))
    expect(problems).toEqual([])
    expect(plan).toContain('- 问：要扫描哪个目录？（交给 `scan`）\n  答：（执行时由用户填写）')
    expect(buildFullText(facts(document), analyzeGraph(document))).toContain('（执行时由用户填写）')
  })

  it('执行时必填的没有回答也没有默认值：编译级，带上问题与题型，好让模型去问', () => {
    const document = sample()
    const { plan, problems } = buildPlan(facts(document, { answers: {} }), analyzeGraph(document))
    expect(plan).toBe('')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ level: 'compile', code: 'input_missing', node: 'dir' })
    expect(problems[0]?.message).toContain('要扫描哪个目录？')
    expect(problems[0]?.message).toContain('必填')
  })

  it('可不填的没填：写「用户没有填写」', () => {
    const document = sample()
    const { plan } = buildPlan(facts(document, { answers: { dir: 'a' } }), analyzeGraph(document))
    expect(plan).toContain('- 问：还有什么要交代的？（交给所有步骤）\n  答：（用户没有填写）')
  })

  it('没有输入节点的图：计划里没有用户输入这一块', () => {
    const document = doc([step('a')])
    const { plan } = buildPlan(facts(document, { answers: {} }), analyzeGraph(document))
    expect(plan).not.toContain('用户输入')
  })
})

describe('步骤的图标与颜色', () => {
  it('读入只认图标库与色板里的名字', () => {
    expect(readNodeData({ prompt: 'p', icon: 'bug', color: 'teal' })).toEqual({
      prompt: 'p',
      icon: 'bug',
      color: 'teal',
    })
    expect(readNodeData({ prompt: 'p', icon: 'nope', color: '#fff' })).toEqual({ prompt: 'p' })
  })

  it('没存的按 id 猜：内置步骤的名字认得出，猜不中是通用的样子', () => {
    expect(appearanceOf('review-2', {})).toEqual({ icon: 'review', color: 'amber' })
    expect(appearanceOf('x', { color: 'pink' })).toEqual({ icon: 'blank', color: 'pink' })
  })

  it('新步骤挑图里用得最少的图标与颜色，尽量不重样；给了的照用', () => {
    const nodes: WorkflowNode[] = []
    const picked: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const look = pickAppearance(nodes)
      picked.push(`${look.icon}/${look.color}`)
      nodes.push({
        id: `s${index}`,
        type: NODE_TYPE,
        position: { x: 0, y: 0 },
        data: { icon: look.icon, color: look.color },
      })
    }
    expect(new Set(picked).size).toBe(4)
    expect(new Set(picked.map((item) => item.split('/')[1])).size).toBe(4)
    expect(pickAppearance(nodes, { icon: 'bug' }).icon).toBe('bug')
    // id 是内置步骤的名字：照内置步骤的样子。
    expect(pickAppearance(nodes, {}, 'scan')).toEqual({ icon: 'scan', color: 'blue' })
  })

  it('新建的我的步骤避开内置步骤和已有的我的步骤，接连新建也不重样', () => {
    const builtin = ['scan', 'plan', 'implement', 'review', 'fix', 'report'].map(presetAppearance)
    const templates: { name: string; icon?: string; color?: string }[] = [
      // 没存样子的老模板在库里是书签，不算占用。
      { name: 'legacy' },
    ]
    const picked: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const look = pickTemplateAppearance(templates)
      picked.push(`${look.icon}/${look.color}`)
      templates.push({ name: `my-step-${index}`, icon: look.icon, color: look.color })
      expect(builtin.map((other) => other.icon)).not.toContain(look.icon)
      expect(builtin.map((other) => other.color)).not.toContain(look.color)
    }
    expect(new Set(picked).size).toBe(3)
    expect(new Set(picked.map((item) => item.split('/')[1])).size).toBe(3)
  })
})
