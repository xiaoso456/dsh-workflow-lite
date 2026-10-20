/**
 * 编译口径（`src/shared/dialect.ts`）：插件里点名 DSH 的工具与插件动作；导出成 skill 时一个都不出现。
 *
 * 守门的是第一条：把所有工作流设置都打开（每种执行方式 × 每种复用 × 设定目标 × 记录运行状态），
 * 图里放上条件分支、循环、没打包的 skill、输入节点，用通用口径编译，计划和每份任务描述里都不能有
 * {@link DSH_ONLY_TERMS}。以后加设置、改措辞，漏了通用口径的那一套，这里会红。
 */

import { describe, expect, it } from 'vitest'
import { buildPlan, buildTaskTexts, type SkillPlan } from '../../src/shared/compile.ts'
import {
  DSH_DIALECT,
  DSH_ONLY_TERMS,
  PORTABLE_DIALECT,
  PORTABLE_STATE_FILE,
} from '../../src/shared/dialect.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { makeEdgeId } from '../../src/shared/model.ts'
import {
  type ExecutionMode,
  INPUT_TYPE,
  NODE_TYPE,
  type PlanFacts,
  RESOURCE_TYPE,
  type ReusePolicy,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../src/shared/types.ts'

function step(id: string, prompt: string): WorkflowNode {
  return { id, type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt } }
}

function edge(source: string, target: string, when?: string): WorkflowEdge {
  return {
    id: makeEdgeId(source, target, when),
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined ? {} : { data: { when } }),
  }
}

/** 扫描 → 审查 ⇄ 修复 → 报告；审查读一个没打包的 skill，扫描写一份产出，问一个问题交给扫描。 */
function sample(mode: ExecutionMode, reuse: ReusePolicy): WorkflowDocument {
  return {
    nodes: [
      step('scan', '扫描仓库。'),
      step('review', '审查。'),
      step('fix', '修复。'),
      step('report', '写报告。'),
      {
        id: 'res-scan',
        type: RESOURCE_TYPE,
        position: { x: 0, y: 0 },
        data: { items: [{ kind: 'file', value: 'scan.md', note: '列出疑点' }] },
      },
      {
        id: 'res-skill',
        type: RESOURCE_TYPE,
        position: { x: 0, y: 0 },
        data: { items: [{ kind: 'skill', value: 'code-review' }] },
      },
      {
        id: 'dir',
        type: INPUT_TYPE,
        position: { x: 0, y: 0 },
        data: { question: '扫哪个目录？', hint: '只写一个目录' },
      },
    ],
    edges: [
      edge('scan', 'review'),
      edge('review', 'fix', 'fail'),
      edge('fix', 'review'),
      edge('review', 'report', 'pass'),
      edge('scan', 'res-scan'),
      edge('res-scan', 'review'),
      edge('res-skill', 'review'),
      edge('dir', 'scan'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    // 「自动」与「设定目标」是缺省值，不写盘（缺省时设定目标是开着的）。
    settings: {
      ...(mode === 'auto' ? {} : { mode }),
      ...(reuse === 'auto' ? {} : { reuse }),
      runState: true,
    },
  }
}

function factsOf(document: WorkflowDocument): PlanFacts {
  const payloadPaths = new Map(
    ['scan', 'review', 'fix', 'report'].map((id) => [id, `{skill}/steps/${id}.md`]),
  )
  return { name: 'code-review', document, payloadPaths }
}

const SKILL: SkillPlan = { bundled: new Set(), needs: ['code-review'], absolute: [] }
const MODES: ExecutionMode[] = ['auto', 'serial', 'subagent', 'team']
const REUSES: ReusePolicy[] = ['auto', 'reuse', 'fresh']

function portable(mode: ExecutionMode, reuse: ReusePolicy): string[] {
  const document = sample(mode, reuse)
  const analysis = analyzeGraph(document)
  const { plan, problems } = buildPlan(factsOf(document), analysis, {
    skill: SKILL,
    runState: { instance: '{instance}' },
  })
  expect(problems).toEqual([])
  return [plan, ...buildTaskTexts(factsOf(document), analysis, { skill: SKILL }).values()]
}

describe('通用口径：导出成 skill 时不点名任何 DSH 工具、插件动作', () => {
  for (const mode of MODES) {
    for (const reuse of REUSES) {
      it(`执行方式 ${mode} × 复用 ${reuse}`, () => {
        for (const text of portable(mode, reuse)) {
          for (const term of DSH_ONLY_TERMS) expect(text).not.toContain(term)
        }
      })
    }
  }

  it('两套口径各自写全了所有设置（一句话不能两边共用 DSH 的工具名）', () => {
    for (const mode of MODES) {
      for (const term of DSH_ONLY_TERMS) expect(PORTABLE_DIALECT.mode[mode]).not.toContain(term)
    }
    expect(DSH_DIALECT.mode.team).toContain('spawn_teammate')
    expect(PORTABLE_DIALECT.mode.team).not.toBe(DSH_DIALECT.mode.team)
  })
})

describe('通用口径的运行状态：模型自己建、自己改工作区里的状态文件', () => {
  const [plan = ''] = portable('serial', 'auto')

  it('写明文件在哪、由谁改，并按图给出初始内容（每个步骤一项，都是 pending）', () => {
    expect(plan).toContain(`这次执行要把进度记在一份状态文件里：\`${PORTABLE_STATE_FILE}\``)
    expect(plan).toContain('**由你来记，直接编辑这份文件。**')
    expect(plan).toContain(
      [
        '```yaml',
        'workflow: code-review',
        'instance: "{instance}"',
        'status: pending',
        'updatedAt: ""',
        'note: ""',
        'nodes:',
        '  scan: { status: pending }',
        '  review: { status: pending }',
        '  fix: { status: pending }',
        '  report: { status: pending }',
        'log: []',
        '```',
      ].join('\n'),
    )
  })

  it('开始时先找上次没走完的；中断后按判定走分支，不按顺序找第一个没做完的', () => {
    expect(plan).toContain('先看 `.workflow-lite/runs/` 下有没有这个工作流没走完的状态文件')
    expect(plan).toContain('沿用那个编号和那份文件')
    expect(plan).toContain('不要按步骤顺序找第一个没做完的')
  })

  it('「开始之前」提醒建状态文件；`{instance}` 的约定里说明接着跑时沿用编号', () => {
    expect(plan).toContain('. 这次要记运行进度：按「运行状态」先找回或新建状态文件。')
    expect(plan).toContain('接着上次没走完的那次执行时，沿用那次的编号')
  })
})

describe('DSH 口径不变：插件里照旧点名工具', () => {
  it('计划里用 state 动作、create_goal、subagent 工具', () => {
    const document = sample('subagent', 'reuse')
    const { plan } = buildPlan(factsOf(document), analyzeGraph(document), {
      runState: { instance: '20261002-143012-a3f9' },
    })
    expect(plan).toContain('`workflow_lite` 的 `state` 动作')
    expect(plan).toContain('`create_goal`')
    expect(plan).toContain('（`subagent` 工具）')
    expect(plan).toContain('`send_message`')
    expect(plan).not.toContain(PORTABLE_STATE_FILE)
  })
})
