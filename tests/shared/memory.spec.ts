/**
 * 记忆（`src/shared/presets.ts`）：默认路径、换范围、开关、编译出来的写法。记忆是一个文件夹（一份 skill）。
 */

import { describe, expect, it } from 'vitest'
import { buildFullText, buildPlan, buildTaskTexts } from '../../src/shared/compile.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { makeEdgeId, readDocument, writeDocument } from '../../src/shared/model.ts'
import {
  addGlobalMemory,
  addStepMemory,
  defaultMemoryPrompt,
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
  it('一个文件夹，带着记忆卡 id；本工作区放在工作区里、按工作流分开，本工作流放在工作流目录里', () => {
    expect(memoryPath('workspace', 'demo', 'mem-review')).toBe(
      '.workflow-lite/memory/demo/mem-review',
    )
    expect(memoryPath('workflow', 'demo', 'mem-review')).toBe('{workflow}/memory/mem-review')
    expect(memoryData('workspace', 'demo', 'mem-review').items).toEqual([
      { kind: 'folder', value: '.workflow-lite/memory/demo/mem-review' },
    ])
  })

  it('换范围：默认路径跟着换（用现在的工作流名），用户改过的路径不动', () => {
    const data = memoryData('workspace', 'old-name', 'mem-review')
    const moved = rescopeMemory(data, 'workflow', 'demo', 'mem-review')
    expect(moved.items[0]?.value).toBe('{workflow}/memory/mem-review')
    expect(moved.preset).toEqual({ kind: 'memory', scope: 'workflow' })
    expect(rescopeMemory(moved, 'workspace', 'demo', 'mem-review').items[0]?.value).toBe(
      '.workflow-lite/memory/demo/mem-review',
    )
    // 旧写法 {assets}、带尾斜杠的默认路径也算默认路径。
    const legacy: ResourceData = {
      ...moved,
      items: [{ kind: 'folder', value: '{assets}/memory/mem-review/' }],
    }
    expect(rescopeMemory(legacy, 'workspace', 'demo', 'mem-review').items[0]?.value).toBe(
      '.workflow-lite/memory/demo/mem-review',
    )
    // 别的卡的默认路径（复制过来的）也算用户改过：不动。
    expect(rescopeMemory(data, 'workflow', 'demo', 'mem-other').items[0]?.value).toBe(
      '.workflow-lite/memory/old-name/mem-review',
    )

    const custom: ResourceData = { ...data, items: [{ kind: 'folder', value: 'notes/review' }] }
    const kept = rescopeMemory(custom, 'workflow', 'demo', 'mem-review')
    expect(kept.items[0]?.value).toBe('notes/review')
    expect(kept.preset?.scope).toBe('workflow')
  })
})

describe('换类型', () => {
  function resource(id: string, items: ResourceItem[]): WorkflowNode {
    return { id, type: RESOURCE_TYPE, position: { x: 0, y: 0 }, data: { label: '笔记', items } }
  }

  it('空卡换成记忆：补上默认的文件夹（本工作区）；名字留着；写它的线改成更新', () => {
    const document = doc([step('a'), resource('notes', [])], [link('a', 'notes')])
    const next = setPreset(document, 'notes', 'memory', 'demo')
    if (next === null || 'refused' in next) throw new Error('没换成')
    expect(next.nodes[1]?.data).toEqual({
      label: '笔记',
      items: [{ kind: 'folder', value: '.workflow-lite/memory/demo/notes' }],
      preset: { kind: 'memory', scope: 'workspace' },
    })
    expect(next.edges).toEqual([link('a', 'notes', true)])
    expect(stepMemories(next, 'a').map((node) => node.id)).toEqual(['notes'])
  })

  it('只有一个文件夹：那个文件夹就是记忆目录；内容不合（多项、文件、网址）拒绝，图不动', () => {
    const one = doc([resource('notes', [{ kind: 'folder', value: 'docs/review', note: '只记坑' }])])
    const next = setPreset(one, 'notes', 'memory', 'demo')
    if (next === null || 'refused' in next) throw new Error('没换成')
    expect(next.nodes[0]?.data).toEqual({
      label: '笔记',
      items: [{ kind: 'folder', value: 'docs/review', note: '只记坑' }],
      preset: { kind: 'memory', scope: 'workspace' },
    })

    const two = doc([
      resource('notes', [
        { kind: 'folder', value: 'a' },
        { kind: 'folder', value: 'b' },
      ]),
    ])
    expect(setPreset(two, 'notes', 'memory', 'demo')).toEqual({ refused: 'memory_items' })
    const file = doc([resource('notes', [{ kind: 'file', value: 'lessons.md' }])])
    expect(setPreset(file, 'notes', 'memory', 'demo')).toEqual({ refused: 'memory_items' })
    const url = doc([resource('notes', [{ kind: 'url', value: 'https://x' }])])
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
      items: [{ kind: 'folder', value: '.workflow-lite/memory/demo/mem-review' }],
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
      items: [{ kind: 'folder', value: '.workflow-lite/memory/demo/mem-review' }],
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

  it('记忆只能放一个文件夹：多了、换成文件都挡编译', () => {
    const invalid = (items: ResourceItem[]): boolean => {
      const document = withMemories()
      const memory = document.nodes.find((node) => node.id === 'mem-review')
      if (memory === undefined || memory.type !== RESOURCE_TYPE) throw new Error('没有记忆卡')
      memory.data = { ...memory.data, items }
      const report = validateDocument(document, { workflowName: 'demo', maxNodes: 100 })
      return report.compile.some((problem) => problem.code === 'memory_invalid')
    }
    expect(invalid([{ kind: 'folder', value: 'notes/review' }])).toBe(false)
    expect(
      invalid([
        { kind: 'folder', value: 'notes/review' },
        { kind: 'url', value: 'x' },
      ]),
    ).toBe(true)
    expect(invalid([{ kind: 'file', value: 'notes/review.md' }])).toBe(true)
  })
})

describe('编译', () => {
  const dir = '.workflow-lite/memory/demo/mem-review'

  it('记忆路径相对工作区，不拼产出根目录', () => {
    const document = withMemories({ outputRoot: 'out' })
    const plan = buildPlan(facts(document), analyzeGraph(document)).plan
    expect(plan).toContain(`\`${dir}\``)
    expect(plan).not.toContain('out/.workflow-lite')
  })

  it('计划：写入列标「（记忆）」；约定只给定义；全局记忆的说明在「资源」里，步骤的只写位置', () => {
    const document = withMemories()
    const plan = buildPlan(facts(document), analyzeGraph(document)).plan
    expect(plan).toContain('mem-review（记忆）')
    expect(plan).toContain('**记忆**：跨多次执行沉淀下来的做法')
    expect(plan).toContain('**全局记忆**：每个步骤开始前都读它的 SKILL.md')
    expect(plan).not.toContain('**更新**：')
    const resources = plan.slice(plan.indexOf('## 资源'))
    expect(resources).toContain('`mem-global`（全局记忆，交给所有步骤）：')
    expect(resources).toContain('  - 记忆目录：`{workflow}/memory/mem-global`。说明：')
    expect(resources).toContain('> - 这个目录是整个工作流的做法')
    expect(resources).toContain(`- \`mem-review\`：记忆目录 \`${dir}\``)
    expect(resources).not.toContain('开始前先读')
  })

  it('任务描述：开着记忆的一步带着记忆目录的说明；全局记忆只给位置和「经验」那句', () => {
    const document = withMemories()
    const tasks = buildTaskTexts(facts(document), analyzeGraph(document))
    const review = tasks.get('review') ?? ''
    expect(review).toContain('### 记忆 `mem-review`')
    expect(review).toContain(`- 记忆目录：\`${dir}\`。说明：`)
    // 说明原样跟在目录路径后面，不需要占位。
    for (const line of lines(STEP_MEMORY_PROMPT)) expect(review).toContain(`> ${line}`)
    expect(review).toContain('### 全局记忆 `mem-global`')
    expect(review).toContain('- 记忆目录：`{workflow}/memory/mem-global`\n')
    expect(review).not.toContain('是整个工作流的做法')
    const scan = tasks.get('scan') ?? ''
    expect(scan).not.toContain('### 记忆 ')
    expect(scan).toContain('列在「经验」下')
    expect(scan).toContain('写明它现在在哪')
  })

  it('改过的说明原样进任务描述、替掉默认的', () => {
    const document = withMemories()
    const memory = document.nodes.find((node) => node.id === 'mem-review')
    if (memory === undefined || memory.type !== RESOURCE_TYPE) throw new Error('没有记忆卡')
    memory.data = {
      ...memory.data,
      items: [
        {
          ...(memory.data.items[0] as ResourceItem),
          note: '只记接口约定，写进 SKILL.md。',
        },
      ],
    }
    const review = buildTaskTexts(facts(document), analyzeGraph(document)).get('review') ?? ''
    expect(review).toContain(`- 记忆目录：\`${dir}\`。说明：只记接口约定，写进 SKILL.md。`)
    expect(review).not.toContain('开始前先读')
  })

  it('整卷版：约定指向「资源」，每份记忆的说明都写在那里', () => {
    const document = withMemories()
    const full = buildFullText(facts(document), analyzeGraph(document))
    expect(full).toContain('照「资源」里它的说明')
    expect(full).toContain(`- 记忆目录：\`${dir}\`。说明：`)
    expect(full).toContain('开始前先读里面的 SKILL.md')
    expect(full).toContain('> - 这个目录是整个工作流的做法')
  })

  it('默认说明照 skill 的写法：先读 SKILL.md、主动沉淀、四段结构；不设条数上限', () => {
    for (const global of [false, true]) {
      const prompt = defaultMemoryPrompt(global)
      expect(prompt).toContain('这个目录是')
      expect(prompt).not.toMatch(/\{[^}]*\}/u)
      expect(prompt).toContain('「## 步骤」')
      expect(prompt).toContain('写教训，不写日志')
      expect(prompt).not.toMatch(/最多 \d+ 条/u)
    }
    expect(STEP_MEMORY_PROMPT).toContain('开始前先读里面的 SKILL.md')
    expect(STEP_MEMORY_PROMPT).toContain('第一次跑通')
    expect(GLOBAL_MEMORY_PROMPT).toContain('跨步骤都成立的东西')
  })
})

function lines(text: string): string[] {
  return text.split(/\n/u)
}
