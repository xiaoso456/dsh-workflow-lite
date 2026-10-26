/**
 * 记忆（`src/shared/presets.ts`）：引用记忆库里的一条、开关、换类型、存盘、编译出来的写法。
 * 记忆是记忆库里的一个文件夹（一份 skill），卡上只记引用哪一条（`{memory}/<id>`）。
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
  memoryItemsOk,
  memoryMisplaced,
  memoryRefs,
  presetRefusal,
  rebindMemory,
  removeStepMemory,
  renameMemoryRefs,
  STEP_MEMORY_PROMPT,
  setPreset,
  stepMemories,
  suggestMemoryId,
} from '../../src/shared/presets.ts'
import { bindDirs, setStepOutputs } from '../../src/shared/resources.ts'
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
  const added = addStepMemory(document, 'review', STEP_REF, { x: 0, y: 0 })
  if (added === null) throw new Error('没开成')
  document = addGlobalMemory(added.document, FLOW_REF, { x: 0, y: 0 }).document
  return settings === undefined ? document : { ...document, settings }
}

const STEP_REF = { memory: 'demo-review', type: 'step' } as const
const FLOW_REF = { memory: 'demo', type: 'workflow' } as const
/** 主机编译时 `{memory}` 绑到的记忆库目录。 */
const LIB = 'C:/data/memories'

function facts(document: WorkflowDocument): PlanFacts {
  const bound = bindDirs(document, { memory: LIB })
  const payloadPaths = new Map(bound.nodes.map((node) => [node.id, `C:/p/${node.id}.md`]))
  return { name: 'demo', document: bound, payloadPaths }
}

describe('引用记忆库', () => {
  it('卡上一项：库里那条的文件夹 `{memory}/<id>`；说明留在这一处', () => {
    expect(memoryData(STEP_REF).items).toEqual([{ kind: 'folder', value: '{memory}/demo-review' }])
    expect(memoryData(STEP_REF).preset).toEqual({
      kind: 'memory',
      memory: 'demo-review',
      type: 'step',
    })
    expect(memoryData(FLOW_REF, '只记约定').items[0]?.note).toBe('只记约定')
    expect(memoryItemsOk(memoryData(STEP_REF))).toBe(true)
    expect(memoryItemsOk({ ...memoryData(STEP_REF), items: [] })).toBe(false)
    expect(memoryItemsOk(memoryData({ memory: '../x', type: 'step' }))).toBe(false)
  })

  it('建议的 id：工作流记忆用工作流名，步骤记忆再接上步骤 id', () => {
    expect(suggestMemoryId('workflow', 'demo')).toBe('demo')
    expect(suggestMemoryId('step', 'demo', 'review')).toBe('demo-review')
  })

  it('换一条：说明、名字、颜色留着，引用和类型换掉', () => {
    const data: ResourceData = { ...memoryData(STEP_REF, '只记坑'), label: '审查', color: 'teal' }
    expect(rebindMemory(data, FLOW_REF)).toEqual({
      label: '审查',
      color: 'teal',
      items: [{ kind: 'folder', value: '{memory}/demo', note: '只记坑' }],
      preset: { kind: 'memory', memory: 'demo', type: 'workflow' },
    })
  })

  it('图里引用的记忆：按出现顺序、大小写不同算一条；改 id 只动对上的那几张', () => {
    const document = withMemories()
    expect(memoryRefs(document)).toEqual(['demo-review', 'demo'])
    const renamed = renameMemoryRefs(document, new Map([['demo', 'demo-2']]))
    expect(memoryRefs(renamed)).toEqual(['demo-review', 'demo-2'])
    expect(renameMemoryRefs(document, new Map())).toBe(document)
  })

  it('类型和位置对不上只是提示：步骤记忆没有步骤写、工作流记忆连在步骤上', () => {
    const document = withMemories()
    const card = (id: string) => {
      const node = document.nodes.find((candidate) => candidate.id === id)
      if (node === undefined || node.type !== RESOURCE_TYPE) throw new Error('没有卡')
      return node
    }
    expect(memoryMisplaced(document, card('mem-review'))).toBe(false)
    expect(memoryMisplaced(document, card('mem-global'))).toBe(false)
    const moved = { ...document, edges: [...document.edges, link('scan', 'mem-global', true)] }
    expect(memoryMisplaced(moved, card('mem-global'))).toBe(true)
    const report = validateDocument(moved, { workflowName: 'demo', maxNodes: 100 })
    expect(report.warning.some((problem) => problem.code === 'memory_misplaced')).toBe(true)
  })

  it('库里没有引用的那条：给了 hasMemory 才查，查不到是提示', () => {
    const document = withMemories()
    const codes = (hasMemory?: (id: string) => boolean) =>
      validateDocument(document, {
        workflowName: 'demo',
        maxNodes: 100,
        ...(hasMemory === undefined ? {} : { hasMemory }),
      }).warning.map((problem) => problem.code)
    expect(codes()).not.toContain('memory_missing')
    expect(codes(() => true)).not.toContain('memory_missing')
    expect(codes((id) => id !== 'demo')).toContain('memory_missing')
  })

  it('不在终点的步骤开着记忆：不提示「写了没人读」（记忆是这一步自己读写的）', () => {
    const base = doc([step('scan'), step('review')], [link('scan', 'review')])
    const added = addStepMemory(base, 'scan', STEP_REF, { x: 0, y: 0 })
    if (added === null) throw new Error('没开成')
    const report = validateDocument(added.document, { workflowName: 'demo', maxNodes: 100 })
    expect(report.hint.map((problem) => problem.code)).not.toContain('resource_unread')
  })
})

describe('换类型', () => {
  function resource(id: string, items: ResourceItem[]): WorkflowNode {
    return { id, type: RESOURCE_TYPE, position: { x: 0, y: 0 }, data: { label: '笔记', items } }
  }

  it('空卡换成记忆：引用选的那条；名字留着；写它的线改成更新', () => {
    const document = doc([step('a'), resource('notes', [])], [link('a', 'notes')])
    const next = setPreset(document, 'notes', 'memory', STEP_REF)
    if (next === null || 'refused' in next) throw new Error('没换成')
    expect(next.nodes[1]?.data).toEqual({
      label: '笔记',
      items: [{ kind: 'folder', value: '{memory}/demo-review' }],
      preset: { kind: 'memory', memory: 'demo-review', type: 'step' },
    })
    expect(next.edges).toEqual([link('a', 'notes', true)])
    expect(stepMemories(next, 'a').map((node) => node.id)).toEqual(['notes'])
  })

  it('有内容的卡换不了（不把外面的文件夹收进库里）；没选哪条也换不了，但类型清单里不因此置灰', () => {
    const one = doc([resource('notes', [{ kind: 'folder', value: 'docs/review' }])])
    expect(setPreset(one, 'notes', 'memory', STEP_REF)).toEqual({ refused: 'memory_items' })
    const url = doc([resource('notes', [{ kind: 'url', value: 'https://x' }])])
    expect(presetRefusal(url.nodes[0]?.data as ResourceData, 'memory', { id: 'notes' })).toBe(
      'memory_items',
    )
    const empty = doc([resource('notes', [])])
    expect(setPreset(empty, 'notes', 'memory')).toEqual({ refused: 'memory_ref' })
    expect(
      presetRefusal(empty.nodes[0]?.data as ResourceData, 'memory', { id: 'notes' }),
    ).toBeNull()
  })

  it('换回普通资源：去掉标记，内容、说明、连线都留着；没变化是 null', () => {
    const document = withMemories()
    const plain = setPreset(document, 'mem-review', null)
    if (plain === null || 'refused' in plain) throw new Error('没换成')
    const card = plain.nodes.find((node) => node.id === 'mem-review')
    expect(card?.data).toEqual({ items: [{ kind: 'folder', value: '{memory}/demo-review' }] })
    expect(plain.edges).toEqual(document.edges)
    expect(setPreset(plain, 'mem-review', null)).toBeNull()
    expect(setPreset(document, 'review', 'memory', STEP_REF)).toBeNull()
  })
})

describe('开关', () => {
  it('开：一张 mem-<步骤> 卡 + 一条「更新」线；再开一次不重复', () => {
    const base = doc([step('review')])
    const added = addStepMemory(base, 'review', STEP_REF, { x: 0, y: 0 })
    expect(added?.id).toBe('mem-review')
    expect(added?.document.edges).toEqual([link('review', 'mem-review', true)])
    expect(
      addStepMemory(added?.document as WorkflowDocument, 'review', STEP_REF, { x: 0, y: 0 }),
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
  it('preset 写进文件、读回来一样；认不出的类型按步骤记忆；内容按引用重新摆好', () => {
    const document = withMemories()
    const parsed = readDocument(writeDocument(document))
    expect(parsed.document?.nodes.find((node) => node.id === 'mem-review')?.data).toEqual({
      items: [{ kind: 'folder', value: '{memory}/demo-review' }],
      preset: { kind: 'memory', memory: 'demo-review', type: 'step' },
    })
    const odd = readDocument(
      JSON.stringify({
        nodes: [
          {
            id: 'm',
            type: RESOURCE_TYPE,
            position: { x: 0, y: 0 },
            data: {
              items: [{ kind: 'folder', value: 'somewhere/else', note: '只记坑' }],
              preset: { kind: 'memory', memory: ' notes ', type: '???' },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    )
    const data = odd.document?.nodes[0]?.data as ResourceData
    expect(data.preset).toEqual({ kind: 'memory', memory: 'notes', type: 'step' })
    expect(data.items).toEqual([{ kind: 'folder', value: '{memory}/notes', note: '只记坑' }])
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

  it('没引用库里的哪一条（id 空着或不合法）挡编译', () => {
    const invalid = (memory: string): boolean => {
      const document = withMemories()
      const card = document.nodes.find((node) => node.id === 'mem-review')
      if (card === undefined || card.type !== RESOURCE_TYPE) throw new Error('没有记忆卡')
      card.data = memoryData({ memory, type: 'step' })
      const report = validateDocument(document, { workflowName: 'demo', maxNodes: 100 })
      return report.compile.some((problem) => problem.code === 'memory_invalid')
    }
    expect(invalid('demo-review')).toBe(false)
    expect(invalid('')).toBe(true)
    expect(invalid('../x')).toBe(true)
  })
})

describe('编译', () => {
  const dir = `${LIB}/demo-review`
  const flow = `${LIB}/demo`

  it('记忆路径是记忆库里的绝对路径，不拼产出根目录', () => {
    const document = withMemories({ outputRoot: 'out' })
    const plan = buildPlan(facts(document), analyzeGraph(document)).plan
    expect(plan).toContain(`\`${dir}\``)
    expect(plan).not.toContain(`out/${LIB}`)
    expect(plan).not.toContain('{memory}')
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
    expect(resources).toContain(`  - 记忆目录：\`${flow}\`。说明：`)
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
    expect(review).toContain(`- 记忆目录：\`${flow}\`\n`)
    expect(review).not.toContain('是整个工作流的做法')
    const scan = tasks.get('scan') ?? ''
    expect(scan).not.toContain('### 记忆 ')
    expect(scan).toContain('列在「经验」下')
    expect(scan).toContain('写明它现在在哪')
    expect(scan).toContain('优先照它执行：少想、少探索')
    expect(scan).toContain('能合成一次的工具调用合成一次')
    expect(scan).toContain('没能照路径一步到位')
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

  it('「不要写进 dataDir」给记忆目录留了除外，不和记忆的说明打架；没有记忆的图不提', () => {
    const document = withMemories()
    const plan = buildPlan(facts(document), analyzeGraph(document)).plan
    expect(plan).toContain('不要写进 `dataDir`（记忆目录除外：它跨执行留着，照记忆的说明就地改）')
    const bare = doc([step('scan')])
    expect(buildPlan(facts(bare), analyzeGraph(bare)).plan).not.toContain('记忆目录除外')
  })

  it('记忆卡都删掉之后：计划、任务描述、整卷版里一句记忆都不提（开着运行状态也一样）', () => {
    const settings = { runState: true as const }
    const cleared = withMemories(settings)
    const ids = new Set(['mem-review', 'mem-global'])
    const document: WorkflowDocument = {
      ...cleared,
      nodes: cleared.nodes.filter((node) => !ids.has(node.id)),
      edges: cleared.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
    }
    const analysis = analyzeGraph(document)
    const texts = [
      buildPlan(facts(document), analysis, { runState: { instance: 'r1' } }).plan,
      buildFullText(facts(document), analysis),
      ...buildTaskTexts(facts(document), analysis).values(),
    ]
    for (const text of texts) {
      expect(text).not.toBe('')
      expect(text).not.toMatch(/记忆|memory/u)
    }
  })

  it('只有一种记忆时，约定里只提那一种', () => {
    const onlyStep = withMemories()
    const document: WorkflowDocument = {
      ...onlyStep,
      nodes: onlyStep.nodes.filter((node) => node.id !== 'mem-global'),
    }
    const plan = buildPlan(facts(document), analyzeGraph(document)).plan
    expect(plan).toContain('照它的说明：步骤自己的记忆附在它的任务描述里。')
    expect(plan).not.toContain('全局记忆')
  })

  it('全局记忆还不存在（第一次跑、导出时没带内容）：步骤跳过，编排者收尾时新建、改完再收尾', () => {
    const document = withMemories()
    const plan = buildPlan(facts(document), analyzeGraph(document)).plan
    expect(plan).toContain('都读它的 SKILL.md（还不存在就跳过）')
    expect(plan).toContain('（目录还不存在就新建），改完再收尾')
    const scan = buildTaskTexts(facts(document), analyzeGraph(document)).get('scan') ?? ''
    expect(scan).toContain('读它的 SKILL.md（还不存在就是还没有做法，跳过）')
  })

  it('导出成 skill：记忆写在 `{skill}/memory/…`，约定里「不要写进 skill 目录」留了除外', () => {
    const document = bindDirs(withMemories(), { memory: '{skill}/memory' })
    const payloadPaths = new Map(
      document.nodes.map((node) => [node.id, `{skill}/steps/${node.id}.md`]),
    )
    const skill = { bundled: new Set<string>(), needs: [], absolute: [] }
    const plan = buildPlan({ name: 'demo', document, payloadPaths }, analyzeGraph(document), {
      skill,
    }).plan
    expect(plan).toContain('附带的资料、skill 和记忆都写成 `{skill}/…`')
    expect(plan).toContain('不要写进 skill 目录（记忆目录除外')
    expect(plan).toContain('`{skill}/memory/demo-review`')
  })

  it('默认说明照 skill 的写法：先读 SKILL.md、主动沉淀、四段结构；不设条数上限', () => {
    for (const type of ['step', 'workflow'] as const) {
      const prompt = defaultMemoryPrompt(type)
      expect(prompt).toContain('这个目录是')
      expect(prompt).not.toMatch(/\{[^}]*\}/u)
      expect(prompt).toContain('「## 步骤」')
      expect(prompt).toContain('「## 快速路径」')
      expect(prompt).toContain('一次查全')
      expect(prompt).toContain('机械活进脚本')
      expect(prompt).toContain('复制模板、只填内容')
      expect(prompt).toContain('写教训，不写日志')
      expect(prompt).not.toMatch(/最多 \d+ 条/u)
    }
    expect(STEP_MEMORY_PROMPT).toContain('开始前先读里面的 SKILL.md')
    expect(STEP_MEMORY_PROMPT).toContain('优先照它执行：少想、少探索')
    expect(STEP_MEMORY_PROMPT).toContain('能合成一次的调用合成一次')
    expect(STEP_MEMORY_PROMPT).toContain('第一次跑通')
    expect(GLOBAL_MEMORY_PROMPT).toContain('跨步骤都成立的东西')
  })
})

function lines(text: string): string[] {
  return text.split(/\n/u)
}
