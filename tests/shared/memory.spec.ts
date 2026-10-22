/**
 * 记忆（`src/shared/presets.ts`）：默认路径、换范围、开关、编译出来的写法。
 */

import { describe, expect, it } from 'vitest'
import { buildFullText, buildPlan, buildTaskTexts } from '../../src/shared/compile.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { makeEdgeId, readDocument, writeDocument } from '../../src/shared/model.ts'
import {
  addGlobalMemory,
  addStepMemory,
  dropOrphanMemories,
  GLOBAL_MEMORY_PROMPT,
  globalMemories,
  memoryData,
  memoryPath,
  presetRefusal,
  removeStepMemory,
  rescopeMemory,
  STEP_MEMORY_PROMPT,
  setPreset,
  stepMemories,
} from '../../src/shared/presets.ts'
import { setStepOutputs } from '../../src/shared/resources.ts'
import {
  NODE_TYPE,
  type PlanFacts,
  RESOURCE_TYPE,
  type ResourceData,
  type ResourceItem,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'

function step(id: string): WorkflowNode {
  return { id, type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: `做 ${id}` } }
}

function link(source: string, target: string, update = false): WorkflowEdge {
  return {
    id: makeEdgeId(source, target),
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(update ? { data: { update: true as const } } : {}),
  }
}

function doc(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowDocument {
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }
}

/** `scan → review` 两步，`review` 开着记忆；再加一张全局记忆。 */
function withMemories(settings?: WorkflowDocument['settings']): WorkflowDocument {
  let document = doc([step('scan'), step('review')], [link('scan', 'review')])
  const added = addStepMemory(document, 'review', 'workspace', 'demo', { x: 0, y: 0 })
  if (added === null) throw new Error('没开成')
  document = addGlobalMemory(added.document, 'workflow', 'demo', { x: 0, y: 0 }).document
  return settings === undefined ? document : { ...document, settings }
}

function facts(document: WorkflowDocument): PlanFacts {
  const payloadPaths = new Map(document.nodes.map((node) => [node.id, `C:/p/${node.id}.md`]))
  return { name: 'demo', document, payloadPaths }
}

describe('默认路径', () => {
  it('带着记忆卡 id；本工作区放在工作区里、按工作流分开，本工作流放在资料目录里', () => {
    expect(memoryPath('workspace', 'demo', 'mem-review')).toBe(
      '.workflow-lite/memory/demo/mem-review.md',
    )
    expect(memoryPath('workflow', 'demo', 'mem-review')).toBe('{assets}/memory/mem-review.md')
  })

  it('换范围：默认路径跟着换（用现在的工作流名），用户改过的路径不动', () => {
    const data = memoryData('workspace', 'old-name', 'mem-review')
    const moved = rescopeMemory(data, 'workflow', 'demo', 'mem-review')
    expect(moved.items[0]?.value).toBe('{assets}/memory/mem-review.md')
    expect(moved.preset).toEqual({ kind: 'memory', scope: 'workflow' })
    expect(rescopeMemory(moved, 'workspace', 'demo', 'mem-review').items[0]?.value).toBe(
      '.workflow-lite/memory/demo/mem-review.md',
    )
    // 别的卡的默认路径（复制过来的）也算用户改过：不动。
    expect(rescopeMemory(data, 'workflow', 'demo', 'mem-other').items[0]?.value).toBe(
      '.workflow-lite/memory/old-name/mem-review.md',
    )

    const custom: ResourceData = { ...data, items: [{ kind: 'file', value: 'notes/mine.md' }] }
    const kept = rescopeMemory(custom, 'workflow', 'demo', 'mem-review')
    expect(kept.items[0]?.value).toBe('notes/mine.md')
    expect(kept.preset?.scope).toBe('workflow')
  })
})

describe('换类型', () => {
  function resource(id: string, items: ResourceItem[]): WorkflowNode {
    return { id, type: RESOURCE_TYPE, position: { x: 0, y: 0 }, data: { label: '笔记', items } }
  }

  it('空卡换成记忆：补上默认路径（本工作区）；名字留着；写它的线改成更新', () => {
    const document = doc([step('a'), resource('notes', [])], [link('a', 'notes')])
    const next = setPreset(document, 'notes', 'memory', 'demo')
    if (next === null || 'refused' in next) throw new Error('没换成')
    expect(next.nodes[1]?.data).toEqual({
      label: '笔记',
      items: [{ kind: 'file', value: '.workflow-lite/memory/demo/notes.md' }],
      preset: { kind: 'memory', scope: 'workspace' },
    })
    expect(next.edges).toEqual([link('a', 'notes', true)])
    expect(stepMemories(next, 'a').map((node) => node.id)).toEqual(['notes'])
  })

  it('只有一个文件：那个文件就是记忆文件；内容不合（多项、不是文件）拒绝，图不动', () => {
    const one = doc([
      resource('notes', [{ kind: 'file', value: 'docs/lessons.md', note: '只记坑' }]),
    ])
    const next = setPreset(one, 'notes', 'memory', 'demo')
    if (next === null || 'refused' in next) throw new Error('没换成')
    expect(next.nodes[0]?.data).toEqual({
      label: '笔记',
      items: [{ kind: 'file', value: 'docs/lessons.md', note: '只记坑' }],
      preset: { kind: 'memory', scope: 'workspace' },
    })

    const two = doc([
      resource('notes', [
        { kind: 'file', value: 'a.md' },
        { kind: 'file', value: 'b.md' },
      ]),
    ])
    expect(setPreset(two, 'notes', 'memory', 'demo')).toEqual({ refused: 'memory_items' })
    const url = doc([resource('notes', [{ kind: 'url', value: 'https://x' }])])
    expect(setPreset(url, 'notes', 'memory', 'demo')).toEqual({ refused: 'memory_items' })
    expect(
      presetRefusal(url.nodes[0]?.data as ResourceData, 'memory', {
        id: 'notes',
        workflow: 'demo',
      }),
    ).toBe('memory_items')
  })

  it('换回普通资源：去掉标记，内容、说明、连线都留着；没变化是 null', () => {
    const document = withMemories()
    const plain = setPreset(document, 'mem-review', null, 'demo')
    if (plain === null || 'refused' in plain) throw new Error('没换成')
    const card = plain.nodes.find((node) => node.id === 'mem-review')
    expect(card?.data).toEqual({
      items: [{ kind: 'file', value: '.workflow-lite/memory/demo/mem-review.md' }],
    })
    expect(plain.edges).toEqual(document.edges)
    expect(setPreset(plain, 'mem-review', null, 'demo')).toBeNull()
    expect(setPreset(document, 'review', 'memory', 'demo')).toBeNull()
  })
})

describe('开关', () => {
  it('开：一张 mem-<步骤> 卡 + 一条「更新」线；再开一次不重复', () => {
    const base = doc([step('review')])
    const added = addStepMemory(base, 'review', 'workspace', 'demo', { x: 0, y: 0 })
    expect(added?.id).toBe('mem-review')
    expect(added?.document.edges).toEqual([link('review', 'mem-review', true)])
    expect(
      addStepMemory(added?.document as WorkflowDocument, 'review', 'workspace', 'demo', {
        x: 0,
        y: 0,
      }),
    ).toBeNull()
  })

  it('关：去掉线，记忆卡一并删掉（不留成全局记忆）；全局记忆不动', () => {
    const document = withMemories()
    const off = removeStepMemory(document, 'review')
    expect(off?.nodes.map((node) => node.id)).toEqual(['scan', 'review', 'mem-global'])
    expect(off === null ? [] : globalMemories(off).map((node) => node.id)).toEqual(['mem-global'])
    expect(removeStepMemory(document, 'scan')).toBeNull()
  })

  it('删步骤之后不剩线的记忆卡跟着删；本来就没线的全局记忆不动', () => {
    const before = withMemories()
    const after = {
      ...before,
      nodes: before.nodes.filter((node) => node.id !== 'review'),
      edges: before.edges.filter((edge) => edge.source !== 'review' && edge.target !== 'review'),
    }
    expect(dropOrphanMemories(before, after).nodes.map((node) => node.id)).toEqual([
      'scan',
      'mem-global',
    ])
  })

  it('改产出清单（工具的 write_node、模板展开）不碰写记忆的线；存成模板也不把记忆当产出', () => {
    const document = withMemories()
    setStepOutputs(document, 'review', [{ path: 'report.md' }])
    expect(stepMemories(document, 'review').map((node) => node.id)).toEqual(['mem-review'])
  })
})

describe('存盘', () => {
  it('preset 写进文件、读回来一样；认不出的范围按本工作区', () => {
    const document = withMemories()
    const parsed = readDocument(writeDocument(document))
    expect(parsed.document?.nodes.find((node) => node.id === 'mem-review')?.data).toEqual({
      items: [{ kind: 'file', value: '.workflow-lite/memory/demo/mem-review.md' }],
      preset: { kind: 'memory', scope: 'workspace' },
    })
    const odd = readDocument(
      JSON.stringify({
        nodes: [
          {
            id: 'm',
            type: RESOURCE_TYPE,
            position: { x: 0, y: 0 },
            data: { items: [], preset: { kind: 'memory', scope: '???' } },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    )
    const data = odd.document?.nodes[0]?.data as ResourceData
    expect(data.preset).toEqual({ kind: 'memory', scope: 'workspace' })
  })

  it('资源卡的颜色写进文件、读回来一样；不在色板里的当没写', () => {
    const card = (color: string): WorkflowDocument =>
      doc([
        {
          id: 'notes',
          type: RESOURCE_TYPE,
          position: { x: 0, y: 0 },
          data: { color, items: [{ kind: 'file', value: 'a.md' }] },
        },
      ])
    const kept = readDocument(writeDocument(card('teal'))).document?.nodes[0]?.data as ResourceData
    expect(kept.color).toBe('teal')
    const odd = readDocument(JSON.stringify(card('rainbow'))).document?.nodes[0]
      ?.data as ResourceData
    expect(odd.color).toBeUndefined()
  })

  it('记忆只能放一个文件：多了、少了、放的不是文件都挡编译', () => {
    const document = withMemories()
    const memory = document.nodes.find((node) => node.id === 'mem-review')
    if (memory === undefined || memory.type !== RESOURCE_TYPE) throw new Error('没有记忆卡')
    memory.data = { ...memory.data, items: [...memory.data.items, { kind: 'url', value: 'x' }] }
    const report = validateDocument(document, { workflowName: 'demo', maxNodes: 100 })
    expect(report.compile.some((problem) => problem.code === 'memory_invalid')).toBe(true)
  })
})

describe('编译', () => {
  it('记忆路径相对工作区，不拼产出根目录', () => {
    const document = withMemories({ outputRoot: 'out' })
    const plan = buildPlan(facts(document), analyzeGraph(document)).plan
    expect(plan).toContain('`.workflow-lite/memory/demo/mem-review.md`')
    expect(plan).not.toContain('out/.workflow-lite')
  })

  it('计划：写入列标「（记忆）」；约定只给定义，不出「更新」那条；全局记忆的提示词在「资源」里', () => {
    const document = withMemories()
    const plan = buildPlan(facts(document), analyzeGraph(document)).plan
    expect(plan).toContain('mem-review（记忆）')
    expect(plan).toContain('**记忆**：跨多次执行攒下来的经验')
    expect(plan).toContain('**全局记忆**：每个步骤开始前都读')
    expect(plan).not.toContain('**更新**：')
    const resources = plan.slice(plan.indexOf('## 资源'))
    expect(resources).toContain(
      '`mem-global`（全局记忆，交给所有步骤）：文件：`{assets}/memory/mem-global.md`。记忆提示词：',
    )
    for (const line of lines(GLOBAL_MEMORY_PROMPT)) expect(resources).toContain(`> ${line}`)
    // 步骤自己的记忆在派发版的总览里只写位置，提示词在任务描述里。
    expect(resources).not.toContain(firstLine(STEP_MEMORY_PROMPT))
  })

  it('任务描述：开着记忆的一步带着它的记忆提示词；全局记忆只给位置和「经验」那句', () => {
    const document = withMemories()
    const tasks = buildTaskTexts(facts(document), analyzeGraph(document))
    const review = tasks.get('review') ?? ''
    expect(review).toContain('### 记忆 `mem-review`')
    expect(review).toContain('记忆提示词：')
    for (const line of lines(STEP_MEMORY_PROMPT)) expect(review).toContain(`> ${line}`)
    expect(review).toContain('### 全局记忆 `mem-global`')
    expect(review).not.toContain(firstLine(GLOBAL_MEMORY_PROMPT))
    const scan = tasks.get('scan') ?? ''
    expect(scan).not.toContain('### 记忆 ')
    expect(scan).toContain('列在「经验」下')
  })

  it('改过的记忆提示词原样进任务描述，替掉默认的', () => {
    const document = withMemories()
    const memory = document.nodes.find((node) => node.id === 'mem-review')
    if (memory === undefined || memory.type !== RESOURCE_TYPE) throw new Error('没有记忆卡')
    memory.data = {
      ...memory.data,
      items: [{ ...(memory.data.items[0] as ResourceItem), note: '只记接口约定。' }],
    }
    const review = buildTaskTexts(facts(document), analyzeGraph(document)).get('review') ?? ''
    expect(review).toContain('记忆提示词：只记接口约定。')
    expect(review).not.toContain(firstLine(STEP_MEMORY_PROMPT))
  })

  it('整卷版：约定指向「资源」，每份记忆的提示词都写在那里', () => {
    const document = withMemories()
    const full = buildFullText(facts(document), analyzeGraph(document))
    expect(full).toContain('照「资源」里它的「记忆提示词」')
    expect(full).toContain(`> ${firstLine(STEP_MEMORY_PROMPT)}`)
    expect(full).toContain(`> ${firstLine(GLOBAL_MEMORY_PROMPT)}`)
  })
})

function lines(text: string): string[] {
  return text.split(/\n/u)
}

function firstLine(text: string): string {
  return lines(text)[0] ?? ''
}
