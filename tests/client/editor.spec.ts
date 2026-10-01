import { describe, expect, it } from 'vitest'
import {
  type Action,
  type EditorState,
  initialState,
  isDirty,
  reduce,
} from '../../src/client/model/editor.ts'
import type { NodeData, WorkflowDocument } from '../../src/shared/types.ts'

function node(id: string, data: NodeData = { prompt: `do ${id}` }, x = 100, y = 100) {
  return { id, type: 'wfNode', position: { x, y }, data }
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
    expect(run(sealed, { type: 'undo' }, { type: 'undo' }).doc?.nodes[0]?.data.prompt).toBe('')
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
  it('视口与自动补位照样要落盘，但不进历史', () => {
    const start = loaded(doc({ nodes: [node('a', {}, 0, 0)] }))
    const state = run(
      start,
      { type: 'setViewport', viewport: { x: 5, y: 5, zoom: 0.8 } },
      { type: 'moveNodes', positions: { a: { x: 80, y: 80 } }, silent: true },
    )
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
