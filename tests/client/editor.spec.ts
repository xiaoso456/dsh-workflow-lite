import { describe, expect, it } from 'vitest'
import {
  type Action,
  type EditorState,
  initialState,
  isDirty,
  reduce,
} from '../../src/client/model/editor.ts'
import { isResource, isStep } from '../../src/shared/model.ts'
import type {
  NodeData,
  ResourceNode,
  StepNode,
  WorkflowDocument,
  WorkflowNode,
} from '../../src/shared/types.ts'

function node(id: string, data: NodeData = { prompt: `do ${id}` }, x = 100, y = 100): StepNode {
  return { id, type: 'wfNode', position: { x, y }, data }
}

function file(id: string, path: string, x = 300, y = 300): ResourceNode {
  return {
    id,
    type: 'wfResource',
    position: { x, y },
    data: { items: [{ kind: 'file', value: path }] },
  }
}

/** 步骤的 `data`（文件节点给 `undefined`）。 */
function stepData(item: WorkflowNode | undefined): NodeData | undefined {
  return item !== undefined && isStep(item) ? item.data : undefined
}

function edge(source: string, target: string, when?: string) {
  return {
    id: when === undefined ? `${source}->${target}` : `${source}->${target}#${when}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined ? {} : { data: { when } }),
  }
}

function doc(partial: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, ...partial }
}

function loaded(document: WorkflowDocument): EditorState {
  return reduce(initialState, {
    type: 'loaded',
    name: 'g',
    doc: document,
    baseHash: 'h0',
    problems: [],
  })
}

function run(state: EditorState, ...actions: Action[]): EditorState {
  return actions.reduce(reduce, state)
}

describe('载入', () => {
  it('载入后是干净的就绪态，历史为空', () => {
    const state = loaded(doc({ nodes: [node('a')] }))
    expect(state.phase).toBe('ready')
    expect(isDirty(state)).toBe(false)
    expect(state.past).toEqual([])
    expect(state.loadSeq).toBe(1)
  })

  it('读不了的文件进只读态，任何编辑都不生效', () => {
    const broken = reduce(initialState, {
      type: 'broken',
      name: 'g',
      message: 'bad',
      raw: '{',
      problems: [],
    })
    const after = reduce(broken, { type: 'addNode', id: 'a', data: {}, position: { x: 1, y: 1 } })
    expect(after).toBe(broken)
    expect(isDirty(after)).toBe(false)
  })
})

describe('加步骤', () => {
  it('撞名（大小写不敏感）就加序号，新步骤接管选中', () => {
    const state = run(loaded(doc({ nodes: [node('Scan')] })), {
      type: 'addNode',
      id: 'scan',
      data: { prompt: 'x' },
      position: { x: 10.123, y: 20.456 },
    })
    expect(state.doc?.nodes.map((n) => n.id)).toEqual(['Scan', 'scan-2'])
    expect(state.doc?.nodes[1]?.position).toEqual({ x: 10.12, y: 20.46 })
    expect(state.selection).toEqual({ kind: 'node', id: 'scan-2' })
    expect(isDirty(state)).toBe(true)
    expect(state.past).toHaveLength(1)
  })

  it('「添加下一步」顺手连一条线', () => {
    const state = run(loaded(doc({ nodes: [node('a')] })), {
      type: 'addNode',
      id: 'b',
      data: {},
      position: { x: 400, y: 100 },
      from: 'a',
    })
    expect(state.doc?.edges.map((e) => e.id)).toEqual(['a->b'])
  })

  it('一次加一小片图：撞名的步骤改名，边的两端跟着换', () => {
    const state = run(loaded(doc({ nodes: [node('plan')] })), {
      type: 'addGraph',
      nodes: [node('scan'), node('plan')],
      edges: [{ source: 'scan', target: 'plan', when: 'pass' }],
    })
    expect(state.doc?.nodes.map((n) => n.id)).toEqual(['plan', 'scan', 'plan-2'])
    expect(state.doc?.edges.map((e) => e.id)).toEqual(['scan->plan-2#pass'])
    expect(state.past).toHaveLength(1)
  })

  it('带设置的一小片图：设置并进已有的（同一条撤销步），不给就不动', () => {
    const start = loaded(doc({ settings: { mode: 'serial' } }))
    const state = run(start, {
      type: 'addGraph',
      settings: { runState: true },
      nodes: [node('scan')],
      edges: [],
    })
    expect(state.doc?.settings).toEqual({ mode: 'serial', runState: true })
    expect(state.past).toHaveLength(1)
    const undone = run(state, { type: 'undo' })
    expect(undone.doc?.settings).toEqual({ mode: 'serial' })
    const plain = run(start, { type: 'addGraph', nodes: [node('scan')], edges: [] })
    expect(plain.doc?.settings).toEqual({ mode: 'serial' })
  })
})

describe('删步骤', () => {
  it('连带删掉以它为端点的边，选中的边若被带走也清掉', () => {
    const start = loaded(
      doc({ nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b'), edge('b', 'c')] }),
    )
    const state = run(
      start,
      { type: 'select', selection: { kind: 'edge', id: 'a->b' } },
      { type: 'removeNode', id: 'B' },
    )
    expect(state.doc?.nodes.map((n) => n.id)).toEqual(['a', 'c'])
    expect(state.doc?.edges).toEqual([])
    expect(state.selection).toBeNull()
  })
})

describe('改步骤内容', () => {
  it('同一个合并键的连续输入并成一条撤销步；失焦封口后另起一条', () => {
    const start = loaded(doc({ nodes: [node('a', { prompt: '' })] }))
    const typed = run(
      start,
      { type: 'patchNode', id: 'a', patch: { prompt: 'h' }, merge: 'a:prompt' },
      { type: 'patchNode', id: 'a', patch: { prompt: 'he' }, merge: 'a:prompt' },
      { type: 'patchNode', id: 'a', patch: { prompt: 'hey' }, merge: 'a:prompt' },
    )
    expect(typed.past).toHaveLength(1)
    const sealed = run(
      typed,
      { type: 'seal' },
      {
        type: 'patchNode',
        id: 'a',
        patch: { prompt: 'hey!' },
        merge: 'a:prompt',
      },
    )
    expect(sealed.past).toHaveLength(2)
    expect(stepData(run(sealed, { type: 'undo' }, { type: 'undo' }).doc?.nodes[0])?.prompt).toBe('')
  })

  it('值为 undefined 的键表示清掉；没有实际变化就原样返回', () => {
    const start = loaded(doc({ nodes: [node('a', { prompt: 'p', output: 'o.md' })] }))
    const cleared = reduce(start, { type: 'patchNode', id: 'a', patch: { output: undefined } })
    expect(cleared.doc?.nodes[0]?.data).toEqual({ prompt: 'p' })
    expect(reduce(cleared, { type: 'patchNode', id: 'a', patch: { prompt: 'p' } })).toBe(cleared)
  })
})

describe('连线', () => {
  it('同一条线不重复加；加上的线接管选中', () => {
    const start = loaded(doc({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] }))
    expect(reduce(start, { type: 'connect', source: 'a', target: 'b' })).toBe(start)
    const state = reduce(start, { type: 'connect', source: 'a', target: 'b', when: 'fail' })
    expect(state.doc?.edges.map((e) => e.id)).toEqual(['a->b', 'a->b#fail'])
    expect(state.selection).toEqual({ kind: 'edge', id: 'a->b#fail' })
  })

  it('改条件等于换 id：选中跟着走，边上的备注保留', () => {
    const labelled = { ...edge('a', 'b'), data: { label: '备注' } }
    const start = run(loaded(doc({ nodes: [node('a'), node('b')], edges: [labelled] })), {
      type: 'select',
      selection: { kind: 'edge', id: 'a->b' },
    })
    const state = reduce(start, { type: 'setWhen', id: 'a->b', when: 'pass' })
    expect(state.doc?.edges).toEqual([
      {
        id: 'a->b#pass',
        source: 'a',
        target: 'b',
        sourceHandle: null,
        targetHandle: null,
        data: { when: 'pass', label: '备注' },
      },
    ])
    expect(state.selection).toEqual({ kind: 'edge', id: 'a->b#pass' })
    const back = reduce(state, { type: 'setWhen', id: 'a->b#pass', when: undefined })
    expect(back.doc?.edges[0]?.id).toBe('a->b')
  })

  it('目标 id 已被另一条线占着就不改（不造重复边）', () => {
    const start = loaded(
      doc({ nodes: [node('a'), node('b')], edges: [edge('a', 'b'), edge('a', 'b', 'fail')] }),
    )
    expect(reduce(start, { type: 'setWhen', id: 'a->b', when: 'fail' })).toBe(start)
  })
})

describe('不进撤销栈的改动', () => {
  it('自动补位照样要落盘，但不进历史', () => {
    const start = loaded(doc({ nodes: [node('a', {}, 0, 0)] }))
    const state = run(start, {
      type: 'moveNodes',
      positions: { a: { x: 80, y: 80 } },
      silent: true,
    })
    expect(isDirty(state)).toBe(true)
    expect(state.past).toEqual([])
  })
})

describe('撤销 / 重做', () => {
  it('撤销也要落盘（推进 rev），选中的东西没了就放掉', () => {
    const start = loaded(doc({ nodes: [node('a')] }))
    const added = reduce(start, { type: 'addNode', id: 'b', data: {}, position: { x: 1, y: 1 } })
    const undone = reduce(added, { type: 'undo' })
    expect(undone.doc?.nodes.map((n) => n.id)).toEqual(['a'])
    expect(undone.selection).toBeNull()
    expect(undone.rev).toBe(added.rev + 1)
    const redone = reduce(undone, { type: 'redo' })
    expect(redone.doc?.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(reduce(start, { type: 'undo' })).toBe(start)
  })

  it('新的改动清空重做栈', () => {
    const state = run(
      loaded(doc({ nodes: [node('a')] })),
      { type: 'addNode', id: 'b', data: {}, position: { x: 1, y: 1 } },
      { type: 'undo' },
      { type: 'addNode', id: 'c', data: {}, position: { x: 1, y: 1 } },
    )
    expect(state.future).toEqual([])
  })
})

describe('保存', () => {
  it('保存期间又来的改动仍然是脏的', () => {
    const edited = reduce(loaded(doc({ nodes: [node('a')] })), {
      type: 'patchNode',
      id: 'a',
      patch: { label: 'A' },
    })
    const saving = reduce(edited, { type: 'saveStarted', rev: edited.rev })
    const more = reduce(saving, { type: 'patchNode', id: 'a', patch: { label: 'AA' } })
    const done = reduce(more, { type: 'saveDone', baseHash: 'h1' })
    expect(done.baseHash).toBe('h1')
    expect(isDirty(done)).toBe(true)
    expect(isDirty(reduce(saving, { type: 'saveDone', baseHash: 'h1' }))).toBe(false)
  })

  it('外部改动同步进来：换文档、换基线、旧历史作废', () => {
    const edited = reduce(loaded(doc({ nodes: [node('a')] })), {
      type: 'patchNode',
      id: 'a',
      patch: { label: 'A' },
    })
    const synced = reduce(edited, {
      type: 'refreshed',
      problems: [],
      doc: doc({ nodes: [node('z')] }),
      baseHash: 'h9',
      external: true,
    })
    expect(synced.doc?.nodes.map((n) => n.id)).toEqual(['z'])
    expect(synced.baseHash).toBe('h9')
    expect(synced.past).toEqual([])
  })
})

describe('工作流设置', () => {
  it('setSettings 规范化后写进文档，算一条撤销步；全缺省等于清掉', () => {
    const state = run(loaded(doc()), {
      type: 'setSettings',
      settings: { outputRoot: 'out//run/', mode: 'serial' },
    })
    expect(state.doc?.settings).toEqual({ outputRoot: 'out/run', mode: 'serial' })
    expect(isDirty(state)).toBe(true)
    expect(run(state, { type: 'undo' }).doc?.settings).toBeUndefined()
    const cleared = run(state, { type: 'setSettings', settings: { outputRoot: ' ' } })
    expect(cleared.doc !== null && 'settings' in cleared.doc).toBe(false)
  })

  it('没变化的设置不算改动', () => {
    const start = loaded(doc({ settings: { mode: 'team' } }))
    expect(run(start, { type: 'setSettings', settings: { mode: 'team' } })).toBe(start)
  })
})

describe('交接（步骤 → 步骤）', () => {
  const nodes = [node('review'), node('fix')]

  it('附说明是一条撤销步；说明里连续打字并成一条；undefined 回到缺省，false = 只管先后', () => {
    const start = loaded(doc({ nodes, edges: [edge('review', 'fix')] }))
    const typed = run(
      start,
      { type: 'setHandoff', id: 'review->fix', handoff: { note: '修' }, merge: 'm' },
      { type: 'setHandoff', id: 'review->fix', handoff: { note: '修完' }, merge: 'm' },
    )
    expect(typed.doc?.edges[0]?.data).toEqual({ handoff: { note: '修完' } })
    expect(typed.past).toHaveLength(1)
    const reset = reduce(typed, { type: 'setHandoff', id: 'review->fix', handoff: undefined })
    expect(reset.doc?.edges[0]?.data).toBeUndefined()
    // 空白说明的规范写法就是缺省：没变。
    expect(reduce(reset, { type: 'setHandoff', id: 'review->fix', handoff: { note: '  ' } })).toBe(
      reset,
    )
    const none = reduce(reset, { type: 'setHandoff', id: 'review->fix', handoff: false })
    expect(none.doc?.edges[0]?.data).toEqual({ handoff: false })
  })

  it('改条件时交接跟着搬到新边上', () => {
    const noted = { ...edge('review', 'fix'), data: { handoff: { note: 'n' } } }
    const state = reduce(loaded(doc({ nodes, edges: [noted] })), {
      type: 'setWhen',
      id: 'review->fix',
      when: 'fail',
    })
    expect(state.doc?.edges[0]?.data).toEqual({ when: 'fail', handoff: { note: 'n' } })
  })
})

describe('资源节点', () => {
  it('加步骤时模板里的产出展开成挂在它右下方的新资源；路径被占了就加序号', () => {
    const start = loaded(doc({ nodes: [file('file-r', 'review.md')] }))
    const state = reduce(start, {
      type: 'addNode',
      id: 'review',
      data: { prompt: 'p', output: [{ path: 'review.md', rule: 'r' }, { path: 'notes.md' }] },
      position: { x: 100, y: 100 },
    })
    const added = state.doc?.nodes.filter(isResource).slice(1) ?? []
    expect(added.map((item) => item.data)).toEqual([
      { items: [{ kind: 'file', value: 'review-2.md', note: 'r' }] },
      { items: [{ kind: 'file', value: 'notes.md' }] },
    ])
    expect(added.every((item) => item.position.x > 100 && item.position.y > 100)).toBe(true)
    expect(stepData(state.doc?.nodes.find((item) => item.id === 'review'))?.output).toBeUndefined()
    expect(state.doc?.edges.map((item) => item.target)).toEqual(added.map((item) => item.id))
    expect(state.past).toHaveLength(1)
  })

  it('addResource：给了 writer 就连写入线、给了 reader 就连读取线；select 决定选中谁', () => {
    const start = loaded(doc({ nodes: [node('a'), node('b')] }))
    const state = reduce(start, {
      type: 'addResource',
      data: { items: [{ kind: 'file', value: 'x.md' }] },
      writer: 'a',
      reader: 'b',
    })
    const created = state.doc?.nodes.find(isResource)
    expect(created?.id).toBe('res-x')
    expect(state.doc?.edges.map((item) => item.id)).toEqual(['a->res-x', 'res-x->b'])
    expect(state.selection).toBeNull()
    const selected = reduce(start, { type: 'addResource', data: { items: [] }, select: true })
    expect(selected.selection).toEqual({ kind: 'node', id: 'res-resource' })
  })

  it('连线：资源已经有人写，再接上来的写入默认是更新；资源不能连资源；连着资源的线不带条件', () => {
    const start = loaded(
      doc({
        nodes: [node('a'), node('b'), file('f', 'f.md'), file('g', 'g.md')],
        edges: [edge('a', 'f')],
      }),
    )
    const state = reduce(start, { type: 'connect', source: 'b', target: 'f', when: 'fail' })
    expect(state.doc?.edges[1]).toMatchObject({ id: 'b->f', data: { update: true } })
    expect(reduce(start, { type: 'connect', source: 'f', target: 'g' })).toBe(start)
    const fresh = reduce(start, { type: 'connect', source: 'b', target: 'g' })
    expect(fresh.doc?.edges[1]?.data).toBeUndefined()
  })

  it('setUpdate 切写入方式；patchResource 改名字与内容（原样存、不当场规范化），连续打字并成一条', () => {
    const start = loaded(doc({ nodes: [node('a'), file('f', 'f.md')], edges: [edge('a', 'f')] }))
    const updated = reduce(start, { type: 'setUpdate', id: 'a->f', update: true })
    expect(updated.doc?.edges[0]?.data).toEqual({ update: true })
    expect(reduce(updated, { type: 'setUpdate', id: 'a->f', update: true })).toBe(updated)
    const back = reduce(updated, { type: 'setUpdate', id: 'a->f', update: false })
    expect(back.doc?.edges[0]?.data).toBeUndefined()

    const typed = run(
      start,
      { type: 'patchResource', id: 'f', patch: { label: '问' }, merge: 'f:label' },
      { type: 'patchResource', id: 'f', patch: { label: '问题 ' }, merge: 'f:label' },
    )
    expect(typed.doc?.nodes[1]?.data).toEqual({
      items: [{ kind: 'file', value: 'f.md' }],
      label: '问题 ',
    })
    expect(typed.past).toHaveLength(1)
    const items = reduce(typed, {
      type: 'patchResource',
      id: 'f',
      patch: { label: undefined, items: [{ kind: 'url', value: '' }] },
    })
    expect(items.doc?.nodes[1]?.data).toEqual({ items: [{ kind: 'url', value: '' }] })
    // 不是资源节点：patchResource 不动它。
    expect(reduce(start, { type: 'patchResource', id: 'a', patch: { label: 'x' } })).toBe(start)
  })

  it('删资源节点连带删掉连着它的线', () => {
    const start = loaded(
      doc({
        nodes: [node('a'), node('b'), file('f', 'f.md')],
        edges: [edge('a', 'b'), edge('a', 'f'), edge('f', 'b')],
      }),
    )
    const state = reduce(start, { type: 'removeNode', id: 'f' })
    expect(state.doc?.edges.map((item) => item.id)).toEqual(['a->b'])
  })
})

describe('输入节点与步骤的样子', () => {
  const ask = { question: '目标？' }

  it('加输入：给了读它的步骤就连上「输入 → 步骤」、放在它左边，并选中它', () => {
    const state = run(loaded(doc({ nodes: [node('scan', undefined, 500, 200)] })), {
      type: 'addInput',
      id: 'ask',
      data: ask,
      reader: 'scan',
    })
    const added = state.doc?.nodes.find((item) => item.id === 'ask')
    expect(added?.type).toBe('wfInput')
    expect((added?.position.x ?? 0) < 500).toBe(true)
    expect(state.doc?.edges.map((item) => item.id)).toEqual(['ask->scan'])
    expect(state.selection).toEqual({ kind: 'node', id: 'ask' })
  })

  it('连线：输入只连步骤、不带条件；不能连进输入', () => {
    const base = loaded(
      doc({
        nodes: [
          node('a'),
          { id: 'q', type: 'wfInput', position: { x: 0, y: 0 }, data: ask },
          file('f', 'f.md'),
        ],
      }),
    )
    const linked = run(base, { type: 'connect', source: 'q', target: 'a', when: 'pass' })
    expect(linked.doc?.edges).toEqual([edge('q', 'a')])
    expect(run(base, { type: 'connect', source: 'a', target: 'q' }).doc?.edges).toEqual([])
    expect(run(base, { type: 'connect', source: 'q', target: 'f' }).doc?.edges).toEqual([])
  })

  it('改输入：去掉值为 undefined 的键，打字时不吃尾部空格；连续打字合成一条撤销步', () => {
    const base = loaded(
      doc({ nodes: [{ id: 'q', type: 'wfInput', position: { x: 0, y: 0 }, data: ask }] }),
    )
    const typed = run(
      base,
      { type: 'patchInput', id: 'q', patch: { question: '目标 ' }, merge: 'q' },
      { type: 'patchInput', id: 'q', patch: { question: '目标 是' }, merge: 'q' },
      { type: 'patchInput', id: 'q', patch: { required: true } },
    )
    const data = typed.doc?.nodes[0]?.data
    expect(data).toEqual({ question: '目标 是', required: true })
    expect(typed.past).toHaveLength(2)
    const cleared = run(typed, { type: 'patchInput', id: 'q', patch: { required: undefined } })
    expect(cleared.doc?.nodes[0]?.data).toEqual({ question: '目标 是' })
  })

  it('加步骤：没带图标颜色的挑一个不和别人重样的，带了的照用', () => {
    let state = loaded(doc())
    for (const id of ['a', 'b', 'c']) {
      state = run(state, { type: 'addNode', id, data: { prompt: id }, position: { x: 0, y: 0 } })
    }
    const looks = state.doc?.nodes.map((item) => `${stepData(item)?.icon}/${stepData(item)?.color}`)
    expect(new Set(looks).size).toBe(3)
    const kept = run(state, {
      type: 'addNode',
      id: 'd',
      data: { prompt: 'd', icon: 'bug', color: 'pink' },
      position: { x: 0, y: 0 },
    })
    expect(stepData(kept.doc?.nodes[3])).toMatchObject({ icon: 'bug', color: 'pink' })
  })

  it('改样子：patchNode 的 undefined 清掉图标与颜色', () => {
    const base = loaded(doc({ nodes: [node('a', { prompt: 'p', icon: 'bug', color: 'teal' })] }))
    const cleared = run(base, {
      type: 'patchNode',
      id: 'a',
      patch: { icon: undefined, color: undefined },
    })
    expect(stepData(cleared.doc?.nodes[0])).toEqual({ prompt: 'p' })
  })
})
