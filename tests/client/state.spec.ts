import { describe, expect, it } from 'vitest'
import {
  type CanvasAction,
  type CanvasState,
  DUPLICATE_OFFSET,
  duplicateNode,
  edgeIdOf,
  HISTORY_LIMIT,
  hasEdge,
  hasNode,
  initialCanvasState,
  isTypingTarget,
  LAYOUT_COLUMN_W,
  LAYOUT_COLUMNS,
  LAYOUT_ORIGIN,
  LAYOUT_ROW_H,
  layoutAll,
  layoutMissing,
  needsSave,
  reduce,
  sortedNodeIds,
  uniqueNodeId,
  whenOf,
  withoutNode,
} from '../../src/client/core/state.ts'
import { decideSave, statusKey } from '../../src/client/core/sync.ts'
import type { ExecutionBatch, WorkflowDocument } from '../../src/shared/types.ts'

function sampleDocument(): WorkflowDocument {
  return {
    nodes: [
      {
        id: 'scan',
        type: 'wfNode',
        position: { x: 0, y: 0 },
        data: { prompt: '扫描', output: 'scan.json' },
      },
      {
        id: 'auth-review',
        type: 'wfNode',
        position: { x: 200, y: 0 },
        data: { label: '认证审查', prompt: '审查', output: 'findings.md' },
      },
      {
        id: 'report',
        type: 'wfNode',
        position: { x: 400, y: 0 },
        data: { prompt: '报告', output: false },
      },
    ],
    edges: [
      {
        id: 'scan->auth-review',
        source: 'scan',
        target: 'auth-review',
        sourceHandle: null,
        targetHandle: null,
      },
      {
        id: 'auth-review->report#pass',
        source: 'auth-review',
        target: 'report',
        sourceHandle: null,
        targetHandle: null,
        data: { when: 'pass' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

function loaded(): CanvasState {
  return reduce(initialCanvasState, {
    type: 'loaded',
    name: 'code-review',
    document: sampleDocument(),
    baseHash: 'h1',
    problems: [],
    warnings: [],
  })
}

/** 取文档。测试里 document 必须非空，取不到就直接炸，不要静默通过。 */
function docOf(state: CanvasState): WorkflowDocument {
  if (state.document === null) throw new Error('期望文档非空')
  return state.document
}

/** 某个节点的坐标（大小写不敏感）。 */
function positionOf(state: CanvasState, id: string): { x: number; y: number } | undefined {
  const key = id.toLowerCase()
  return docOf(state).nodes.find((node) => node.id.toLowerCase() === key)?.position
}

/** 图里全部节点 id。 */
function nodeIdsOf(state: CanvasState): string[] {
  return docOf(state).nodes.map((node) => node.id)
}

/** 复制节点，解不出就炸（不用非空断言）。 */
function mustDuplicate(document: WorkflowDocument, id: string) {
  const copied = duplicateNode(document, id)
  if (copied === null) throw new Error(`期望复制出节点：${id}`)
  return copied
}

describe('edgeIdOf / whenOf', () => {
  it('边 id 的构造式与 host 一致', () => {
    expect(edgeIdOf('scan', 'auth-review')).toBe('scan->auth-review')
    expect(edgeIdOf('auth-review', 'report', 'pass')).toBe('auth-review->report#pass')
    expect(edgeIdOf('a', 'b', '')).toBe('a->b')
  })
  it('空串 when 与缺省同义', () => {
    expect(
      whenOf({
        id: 'e',
        source: 'a',
        target: 'b',
        sourceHandle: null,
        targetHandle: null,
        data: { when: '' },
      }),
    ).toBeUndefined()
    expect(
      whenOf({
        id: 'e',
        source: 'a',
        target: 'b',
        sourceHandle: null,
        targetHandle: null,
        data: { when: 'pass' },
      }),
    ).toBe('pass')
  })
})

describe('文档变换', () => {
  it('删节点连带删掉以它为端点的边（否则会留下保存级的悬空 edge）', () => {
    const next = withoutNode(sampleDocument(), 'auth-review')
    expect(next.nodes.map((node) => node.id)).toEqual(['scan', 'report'])
    expect(next.edges).toEqual([])
  })

  it('uniqueNodeId 撞名加序号，绝不静默覆盖', () => {
    const document = sampleDocument()
    expect(uniqueNodeId(document, 'new')).toBe('new')
    expect(uniqueNodeId(document, 'scan')).toBe('scan-2')
    expect(uniqueNodeId(document, 'SCAN')).toBe('SCAN-2')
  })

  it('hasNode 大小写不敏感', () => {
    expect(hasNode(sampleDocument(), 'SCAN')).toBe(true)
    expect(hasNode(sampleDocument(), 'nope')).toBe(false)
  })

  it('sortedNodeIds 按 id 码位序', () => {
    expect(sortedNodeIds(sampleDocument())).toEqual(['auth-review', 'report', 'scan'])
  })
})

describe('reduce —— 加载与保存', () => {
  it('loaded 清脏、记基线、清选择', () => {
    const state = loaded()
    expect(state.dirty).toBe(false)
    expect(state.baseHash).toBe('h1')
    expect(state.selected).toBeNull()
    expect(needsSave(state)).toBe(false)
  })

  it('改节点 data → 脏；保存成功 → 清脏并换基线', () => {
    let state = loaded()
    state = reduce(state, { type: 'setNodeData', id: 'scan', data: { label: '扫描' } })
    expect(state.dirty).toBe(true)
    expect(state.status).toBe('dirty')
    expect(needsSave(state)).toBe(true)

    state = reduce(state, { type: 'saveStarted', seq: state.editSeq })
    expect(state.status).toBe('saving')
    expect(needsSave(state)).toBe(false) // 保存中不重入

    state = reduce(state, { type: 'saveSucceeded', baseHash: 'h2' })
    expect(state.dirty).toBe(false)
    expect(state.baseHash).toBe('h2')
    expect(state.status).toBe('saved')
  })

  it('保存期间又来改动 ⇒ 保存成功后**仍然是脏的**（否则回读会吃掉在途改动）', () => {
    let state = reduce(loaded(), { type: 'setNodeData', id: 'scan', data: { label: 'A' } })
    const seqAtStart = state.editSeq
    state = reduce(state, { type: 'saveStarted', seq: seqAtStart })
    // 保存在途时用户又改了一处。
    state = reduce(state, { type: 'setNodeData', id: 'report', data: { label: 'B' } })
    state = reduce(state, { type: 'saveSucceeded', baseHash: 'h2' })
    expect(state.dirty).toBe(true)
    expect(state.status).toBe('dirty')
    expect(state.editSeq).toBeGreaterThan(seqAtStart)
    expect(needsSave(state)).toBe(true)
  })

  it('editSeq 只在真的改了文档时才前进（空操作不推版本）', () => {
    const state = loaded()
    const noop = reduce(state, { type: 'setNodeData', id: 'scan', data: { label: undefined } })
    expect(noop.editSeq).toBe(state.editSeq)
    const moved = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    expect(moved.editSeq).toBe(state.editSeq + 1)
  })

  it('保存失败保留改动并写明错误', () => {
    let state = reduce(loaded(), { type: 'setNodeData', id: 'scan', data: { label: 'X' } })
    state = reduce(state, { type: 'saveFailed', message: '磁盘满了' })
    expect(state.dirty).toBe(true)
    expect(state.error).toBe('磁盘满了')
    expect(state.status).toBe('error')
    expect(needsSave(state)).toBe(true)
  })

  it('同一值重复设置不改引用（避免无谓的脏标记）', () => {
    const state = loaded()
    const same = reduce(state, { type: 'setNodeData', id: 'scan', data: { prompt: '扫描' } })
    expect(same).toBe(state)
    const sameMove = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 0, y: 0 } })
    expect(sameMove).toBe(state)
  })

  it('setNodeData 用 undefined 表示清掉这一项', () => {
    const state = reduce(loaded(), {
      type: 'setNodeData',
      id: 'auth-review',
      data: { label: undefined },
    })
    expect(
      state.document?.nodes.find((node) => node.id === 'auth-review')?.data.label,
    ).toBeUndefined()
  })

  it('坐标归一化到 2 位小数', () => {
    const state = reduce(loaded(), { type: 'moveNode', id: 'scan', position: { x: 12.3456, y: 1 } })
    expect(state.document?.nodes.find((node) => node.id === 'scan')?.position).toEqual({
      x: 12.35,
      y: 1,
    })
  })

  it('viewport 改动也算脏', () => {
    const state = reduce(loaded(), { type: 'setViewport', viewport: { x: 5, y: 6, zoom: 2 } })
    expect(state.dirty).toBe(true)
    expect(state.document?.viewport).toEqual({ x: 5, y: 6, zoom: 2 })
  })
})

describe('reduce —— 增删节点与连线', () => {
  it('addNode 撞名加序号并选中新节点', () => {
    const state = reduce(loaded(), {
      type: 'addNode',
      id: 'scan',
      data: { prompt: '再来一个' },
      position: { x: 10, y: 20 },
    })
    expect(state.document?.nodes.map((node) => node.id)).toContain('scan-2')
    expect(state.selected).toBe('scan-2')
  })

  it('connect 幂等：同 source+target+when 不重复加', () => {
    const once = reduce(loaded(), { type: 'connect', source: 'scan', target: 'report' })
    const twice = reduce(once, { type: 'connect', source: 'scan', target: 'report' })
    expect(twice).toBe(once)
  })

  it('connect 带 when 生成带 #when 的边 id', () => {
    const state = reduce(loaded(), {
      type: 'connect',
      source: 'scan',
      target: 'report',
      when: 'fail',
    })
    expect(state.document?.edges.map((edge) => edge.id)).toContain('scan->report#fail')
  })

  it('disconnect 删指定边；删不掉时引用不变', () => {
    const state = reduce(loaded(), { type: 'disconnect', source: 'scan', target: 'auth-review' })
    expect(state.document?.edges.map((edge) => edge.id)).not.toContain('scan->auth-review')
    const again = reduce(state, { type: 'disconnect', source: 'scan', target: 'auth-review' })
    expect(again).toBe(state)
  })

  it('deleteNode 清掉选中态并连带删边', () => {
    let state = reduce(loaded(), { type: 'select', node: 'auth-review' })
    state = reduce(state, { type: 'deleteNode', id: 'auth-review' })
    expect(state.selected).toBeNull()
    expect(state.document?.edges).toEqual([])
  })

  it('删不存在的节点不动引用', () => {
    const state = loaded()
    expect(reduce(state, { type: 'deleteNode', id: 'nope' })).toBe(state)
  })
})

describe('decideSave —— 什么时候落盘', () => {
  const dirty = (): CanvasState =>
    reduce(loaded(), { type: 'moveNode', id: 'scan', position: { x: 9, y: 9 } })

  it('干净的图不写', () => {
    expect(
      decideSave({ state: loaded(), reason: 'edit', debounceMs: 400, lastEditAt: 0, now: 1000 })
        .kind,
    ).toBe('none')
  })

  it('没打开图不写', () => {
    expect(
      decideSave({
        state: initialCanvasState,
        reason: 'edit',
        debounceMs: 400,
        lastEditAt: null,
        now: 0,
      }).kind,
    ).toBe('none')
  })

  it('保存中不重入', () => {
    const saving = reduce(dirty(), { type: 'saveStarted', seq: dirty().editSeq })
    expect(
      decideSave({ state: saving, reason: 'edit', debounceMs: 400, lastEditAt: 0, now: 1000 }).kind,
    ).toBe('none')
  })

  it('改动 → 排一个防抖写', () => {
    const decision = decideSave({
      state: dirty(),
      reason: 'edit',
      debounceMs: 400,
      lastEditAt: 100,
      now: 100,
    })
    expect(decision).toEqual({ kind: 'debounced', delayMs: 400 })
  })

  it('停稳但还没过窗口 → 排剩下的时间；过了窗口 → 立刻写', () => {
    expect(
      decideSave({ state: dirty(), reason: 'settled', debounceMs: 400, lastEditAt: 100, now: 300 }),
    ).toEqual({ kind: 'debounced', delayMs: 200 })
    expect(
      decideSave({ state: dirty(), reason: 'settled', debounceMs: 400, lastEditAt: 100, now: 600 })
        .kind,
    ).toBe('now')
  })

  it('离开画布 → 立刻写（不等防抖，否则改动会随组件一起没）', () => {
    expect(
      decideSave({ state: dirty(), reason: 'leaving', debounceMs: 400, lastEditAt: 100, now: 120 })
        .kind,
    ).toBe('now')
  })
})

describe('statusKey', () => {
  it('状态 → 词典键', () => {
    expect(statusKey(loaded())).toBe('status.idle')
    expect(statusKey(reduce(loaded(), { type: 'saveStarted', seq: 0 }))).toBe('status.saving')
    expect(statusKey(reduce(loaded(), { type: 'saveSucceeded', baseHash: 'h2' }))).toBe(
      'status.saved',
    )
    expect(statusKey(reduce(loaded(), { type: 'loadFailed', message: 'x' }))).toBe('status.error')
  })
})

describe('reduce —— 校验态与只读错误态', () => {
  it('loaded 把四级问题与警告存下来，并清掉只读态', () => {
    const problem = { level: 'compile', code: 'prompt_missing', message: '缺正文', node: 'scan' }
    const state = reduce(initialCanvasState, {
      type: 'loaded',
      name: 'g',
      document: sampleDocument(),
      baseHash: 'h1',
      problems: [problem] as never,
      warnings: [],
    })
    expect(state.problems).toHaveLength(1)
    expect(state.blocked).toBe(false)
  })

  it('loadFailed 进只读错误态：留着原文与问题、不写盘', () => {
    const state = reduce(loaded(), {
      type: 'loadFailed',
      message: 'JSON 解析失败',
      raw: '{ 坏',
      problems: [{ level: 'save', code: 'json_parse_failed', message: 'JSON 解析失败' }] as never,
    })
    expect(state.blocked).toBe(true)
    expect(state.raw).toBe('{ 坏')
    expect(state.document).toBeNull()
    expect(state.dirty).toBe(false)
    // 只读态下 decideSave 一律不写。
    expect(
      decideSave({
        state: { ...state, dirty: true, name: 'g' },
        reason: 'leaving',
        debounceMs: 400,
        lastEditAt: 0,
        now: 10_000,
      }).kind,
    ).toBe('none')
  })

  it('refreshed 换掉基线哈希与问题清单；只在没有在途改动时换文档', () => {
    const withDoc = reduce(loaded(), {
      type: 'refreshed',
      baseHash: 'h9',
      problems: [],
      warnings: [],
      document: sampleDocument(),
    })
    expect(withDoc.baseHash).toBe('h9')

    const keepLocal = reduce(loaded(), {
      type: 'refreshed',
      baseHash: 'h9',
      problems: [],
      warnings: [],
    })
    expect(keepLocal.document).toBe(loaded().document === null ? null : keepLocal.document)
    expect(keepLocal.baseHash).toBe('h9')
  })
})

describe('reduce —— 重排与改 when', () => {
  it('setPositions 一次改多颗；没有实际变化时引用不变', () => {
    const state = loaded()
    const moved = reduce(state, {
      type: 'setPositions',
      positions: { scan: { x: 10, y: 20 }, 'auth-review': { x: 30, y: 40 } },
    })
    expect(moved.dirty).toBe(true)
    const scan = moved.document?.nodes.find((node) => node.id === 'scan')
    expect(scan?.position).toEqual({ x: 10, y: 20 })

    const same = reduce(moved, {
      type: 'setPositions',
      positions: { scan: { x: 10, y: 20 }, 'auth-review': { x: 30, y: 40 } },
    })
    expect(same).toBe(moved)
  })

  it('setPositions 只认图里有的 id（不隐式造节点）', () => {
    const state = loaded()
    expect(reduce(state, { type: 'setPositions', positions: { nope: { x: 1, y: 1 } } })).toBe(state)
  })

  it('setEdgeWhen 换 when 就是换边 id（旧边没了、新边在）', () => {
    const base = reduce(loaded(), { type: 'connect', source: 'scan', target: 'report' })
    const state = reduce(base, {
      type: 'setEdgeWhen',
      source: 'scan',
      target: 'report',
      to: 'fail',
    })
    const ids = state.document?.edges.map((edge) => edge.id) ?? []
    expect(ids).toContain('scan->report#fail')
    expect(ids).not.toContain('scan->report')
  })

  it('setEdgeWhen 只删指定 when 的那条——无条件边与条件边互不影响', () => {
    let state = reduce(loaded(), { type: 'connect', source: 'scan', target: 'report' })
    state = reduce(state, { type: 'connect', source: 'scan', target: 'report', when: 'pass' })
    state = reduce(state, { type: 'setEdgeWhen', source: 'scan', target: 'report', to: 'fail' })
    const ids = state.document?.edges.map((edge) => edge.id) ?? []
    expect(ids).toContain('scan->report#pass')
    expect(ids).toContain('scan->report#fail')
    // 无条件那条已经被换成 #fail 了。
    expect(ids).not.toContain('scan->report')
  })

  it('setEdgeWhen 清空 when 得到无条件边；from === to 时不动', () => {
    const base = reduce(loaded(), { type: 'connect', source: 'scan', target: 'report', when: 'x' })
    const cleared = reduce(base, {
      type: 'setEdgeWhen',
      source: 'scan',
      target: 'report',
      from: 'x',
    })
    const ids = cleared.document?.edges.map((edge) => edge.id) ?? []
    expect(ids).toContain('scan->report')
    expect(ids).not.toContain('scan->report#x')
    expect(reduce(cleared, { type: 'setEdgeWhen', source: 'scan', target: 'report' })).toBe(cleared)
  })
})

describe('layoutAll / layoutMissing', () => {
  const batches = [{ nodes: ['scan'] }, { nodes: ['auth-review'] }, { nodes: ['report'] }] as never

  it('layoutMissing 只补 (0,0) 的占位节点', () => {
    const document = sampleDocument()
    const placed = layoutMissing(document, batches)
    // 样例里 scan 是 (0,0)，auth-review 是 (200,0)。
    expect(placed.has('scan')).toBe(true)
    expect(placed.has('auth-review')).toBe(false)
  })

  it('layoutAll 每颗都重算，且是幂等的（同图同版式）', () => {
    const document = sampleDocument()
    const first = layoutAll(document, batches)
    expect(first.size).toBe(document.nodes.length)
    const second = layoutAll(document, batches)
    expect([...second]).toEqual([...first])
  })

  it('同一排里：靠后的批次 x 更大', () => {
    const placed = layoutAll(sampleDocument(), batches)
    const scan = placed.get('scan')
    const report = placed.get('report')
    expect(scan).toBeDefined()
    expect(report).toBeDefined()
    expect((report?.x ?? 0) > (scan?.x ?? 0)).toBe(true)
  })

  /** 一条 n0 → n1 → … 的长链：每个节点各自一个批次（最坏情形）。 */
  function chainOf(count: number): {
    document: WorkflowDocument
    batches: ExecutionBatch[]
  } {
    const ids = Array.from({ length: count }, (_value, index) => `n${index}`)
    return {
      document: {
        nodes: ids.map((id) => ({
          id,
          type: 'wfNode',
          position: { x: 0, y: 0 },
          data: {},
        })),
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      batches: ids.map((id) => ({ nodes: [id] })),
    }
  }

  /*
   * 折行的回归：一条 24 长的链（24 个批次）不折行就是 24 列 1 行，
   * 单排跨度 23 * 260 = 5980 单位，任何画布都装不下。下面两条把"排满 LAYOUT_COLUMNS
   * 列就换行"钉住，改回单排就红。
   */
  it('排满 LAYOUT_COLUMNS 列后折到下一排', () => {
    const { document, batches: chain } = chainOf(LAYOUT_COLUMNS + 1)
    const placed = layoutAll(document, chain)
    expect(placed.get('n0')).toEqual(LAYOUT_ORIGIN)
    expect(placed.get(`n${LAYOUT_COLUMNS}`)).toEqual({
      x: LAYOUT_ORIGIN.x,
      y: LAYOUT_ORIGIN.y + LAYOUT_ROW_H,
    })
  })

  it('24 个批次的链不再是一整排', () => {
    const { document, batches: chain } = chainOf(24)
    const placed = layoutAll(document, chain)
    const xs = [...placed.values()].map((point) => point.x)
    const ys = [...placed.values()].map((point) => point.y)
    const width = Math.max(...xs) - Math.min(...xs)
    // 折行之后宽度被 LAYOUT_COLUMNS 列封顶，而高度一定不止一排。
    expect(width).toBe((LAYOUT_COLUMNS - 1) * LAYOUT_COLUMN_W)
    expect(new Set(ys).size).toBeGreaterThan(1)
  })

  it('空图不摆位', () => {
    expect(layoutAll({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, []).size).toBe(0)
  })
})

/* ─────────────────────────────────────────────────────────────
 * 撤销 / 重做
 *
 * 这一段的攻法：先按语义把"合并键"当成真正的状态来看，再专门打三处最容易写歪的地方：
 * 无键动作打断合并链、refreshed 不许清历史、空栈必须彻底 no-op。
 * ───────────────────────────────────────────────────────────── */

describe('撤销/重做 —— 合并语义', () => {
  it('同一个 moveNode 键连发多次，撤销栈只涨 1', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 10, y: 10 } })
    expect(state.past).toHaveLength(1)
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 20, y: 20 } })
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 30, y: 30 } })
    expect(state.past).toHaveLength(1)
    // 栈顶是"这次拖拽开始之前"的文档，所以撤销一步就回到原点。
    expect(positionOf(reduce(state, { type: 'undo' }), 'scan')).toEqual({ x: 0, y: 0 })
  })

  it('同一个 setNodeData 键连发多次，撤销栈只涨 1', () => {
    let state = loaded()
    for (const text of ['扫', '扫描', '扫描完成']) {
      state = reduce(state, { type: 'setNodeData', id: 'scan', data: { label: text } })
    }
    expect(state.past).toHaveLength(1)
    const undone = reduce(state, { type: 'undo' })
    expect(docOf(undone).nodes.find((node) => node.id === 'scan')?.data.label).toBeUndefined()
  })

  it('setPositions 自带 layout 键，连发只涨 1', () => {
    let state = loaded()
    state = reduce(state, { type: 'setPositions', positions: { scan: { x: 1, y: 1 } } })
    state = reduce(state, { type: 'setPositions', positions: { scan: { x: 2, y: 2 } } })
    state = reduce(state, { type: 'setPositions', positions: { scan: { x: 3, y: 3 } } })
    expect(state.past).toHaveLength(1)
  })

  it('同一个节点的 moveNode 与 setNodeData 是两个键，必须各占一条', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 5, y: 5 } })
    state = reduce(state, { type: 'setNodeData', id: 'scan', data: { label: 'A' } })
    expect(state.past).toHaveLength(2)
    expect(reduce(state, { type: 'undo' }).past).toHaveLength(1)
  })

  it('不同节点的同名动作互不合并', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'moveNode', id: 'report', position: { x: 2, y: 2 } })
    expect(state.past).toHaveLength(2)
  })

  it('无键动作每次都压，并把合并链打断：带键 → 无键 → 带键 = 3 条', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, {
      type: 'addNode',
      id: 'extra',
      data: { prompt: 'x' },
      position: { x: 50, y: 50 },
    })
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 2, y: 2 } })
    expect(state.past).toHaveLength(3)
    expect(state.historyKey).toBe('move:scan')
  })

  it('加/删节点、连线、断线、改 when 各自一条，谁也不合并', () => {
    let state = loaded()
    state = reduce(state, { type: 'connect', source: 'scan', target: 'report' })
    state = reduce(state, { type: 'disconnect', source: 'scan', target: 'auth-review' })
    state = reduce(state, {
      type: 'setEdgeWhen',
      source: 'auth-review',
      target: 'report',
      from: 'pass',
      to: 'fail',
    })
    state = reduce(state, {
      type: 'addNode',
      id: 'extra',
      data: { prompt: 'x' },
      position: { x: 1, y: 1 },
    })
    state = reduce(state, { type: 'deleteNode', id: 'extra' })
    expect(state.past).toHaveLength(5)
    expect(state.historyKey).toBeNull()
  })

  it('任何新改动都清空 future（分叉之后旧的重做路径走不通）', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'undo' })
    expect(state.future).toHaveLength(1)
    state = reduce(state, { type: 'moveNode', id: 'report', position: { x: 9, y: 9 } })
    expect(state.future).toEqual([])
    expect(reduce(state, { type: 'redo' })).toBe(state)
  })

  it('undo / redo 之后合并链被断开，新改动必压一条', () => {
    const state = reduce(loaded(), { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    const undone = reduce(state, { type: 'undo' })
    expect(undone.historyKey).toBeNull()
    const again = reduce(undone, { type: 'moveNode', id: 'scan', position: { x: 4, y: 4 } })
    expect(again.past).toHaveLength(1)
  })
})

describe('撤销/重做 —— historyBreak', () => {
  it('historyBreak 之后同一个键会再压一条', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 2, y: 2 } })
    expect(state.past).toHaveLength(1)
    state = reduce(state, { type: 'historyBreak' })
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 3, y: 3 } })
    expect(state.past).toHaveLength(2)
    const back1 = reduce(state, { type: 'undo' })
    expect(positionOf(back1, 'scan')).toEqual({ x: 2, y: 2 })
    const back2 = reduce(back1, { type: 'undo' })
    expect(positionOf(back2, 'scan')).toEqual({ x: 0, y: 0 })
  })

  it('historyBreak 本身不压栈、不改文档、不置脏、不推 editSeq', () => {
    const before = reduce(loaded(), { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    const after = reduce(before, { type: 'historyBreak' })
    expect(after.document).toBe(before.document)
    expect(after.past).toBe(before.past)
    expect(after.future).toBe(before.future)
    expect(after.dirty).toBe(before.dirty)
    expect(after.status).toBe(before.status)
    expect(after.editSeq).toBe(before.editSeq)
    expect(after.historyKey).toBeNull()
  })

  it('本来就没有合并链时，historyBreak 同样什么都不动', () => {
    const state = loaded()
    const after = reduce(state, { type: 'historyBreak' })
    expect(after.document).toBe(state.document)
    expect(after.past).toBe(state.past)
    expect(after.dirty).toBe(state.dirty)
    expect(after.editSeq).toBe(state.editSeq)
    expect(after.historyKey).toBeNull()
  })
})

describe('撤销/重做 —— 栈上限与空栈', () => {
  it('past 上限 50，丢的是最旧的（撤销 50 次到达第 11 次改动之前）', () => {
    expect(HISTORY_LIMIT).toBe(50)
    let state = loaded()
    for (let index = 0; index < 60; index += 1) {
      state = reduce(state, {
        type: 'addNode',
        id: `n${index}`,
        data: { prompt: 'x' },
        position: { x: index, y: 0 },
      })
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT)
    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      state = reduce(state, { type: 'undo' })
    }
    // 第 11 次改动是加 n10，所以它之前的那一版里 n0..n9 在、n10 起不在。
    expect(nodeIdsOf(state)).toContain('n9')
    expect(nodeIdsOf(state)).not.toContain('n10')
    expect(nodeIdsOf(state)).not.toContain('n59')
    expect(state.past).toHaveLength(0)
    expect(state.future).toHaveLength(HISTORY_LIMIT)
    // 已经到底了，再撤销是 no-op。
    expect(reduce(state, { type: 'undo' })).toBe(state)
  })

  it('空栈的 undo / redo 是彻底的 no-op（同一引用）', () => {
    const state = loaded()
    const undone = reduce(state, { type: 'undo' })
    const redone = reduce(state, { type: 'redo' })
    expect(undone).toBe(state)
    expect(redone).toBe(state)
    expect(undone.editSeq).toBe(state.editSeq)
    expect(undone.dirty).toBe(state.dirty)
    expect(undone.status).toBe(state.status)
  })

  it('还没打开图时 undo / redo 也是 no-op', () => {
    expect(reduce(initialCanvasState, { type: 'undo' })).toBe(initialCanvasState)
    expect(reduce(initialCanvasState, { type: 'redo' })).toBe(initialCanvasState)
  })

  it('空栈 undo 不推 editSeq（否则会引发一次没必要的写盘）', () => {
    const clean = reduce(loaded(), { type: 'saveSucceeded', baseHash: 'h2' })
    expect(clean.dirty).toBe(false)
    const after = reduce(clean, { type: 'undo' })
    expect(after).toBe(clean)
    expect(after.editSeq).toBe(clean.editSeq)
    expect(after.dirty).toBe(false)
    expect(needsSave(after)).toBe(false)
  })

  it('undo 之后 redo 回得来，redo 之后还能再退', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 2, y: 2 } })
    const undone = reduce(state, { type: 'undo' })
    expect(positionOf(undone, 'scan')).toEqual({ x: 0, y: 0 })
    const redone = reduce(undone, { type: 'redo' })
    expect(positionOf(redone, 'scan')).toEqual({ x: 2, y: 2 })
    const undoneAgain = reduce(redone, { type: 'undo' })
    expect(positionOf(undoneAgain, 'scan')).toEqual({ x: 0, y: 0 })
    const redoneAgain = reduce(undoneAgain, { type: 'redo' })
    expect(positionOf(redoneAgain, 'scan')).toEqual({ x: 2, y: 2 })
  })

  it('undo / redo 把结果标脏并推 editSeq（否则撤销的结果不会落盘）', () => {
    let state = reduce(loaded(), { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'saveStarted', seq: state.editSeq })
    state = reduce(state, { type: 'saveSucceeded', baseHash: 'h2' })
    expect(state.dirty).toBe(false)
    const seqBefore = state.editSeq

    const undone = reduce(state, { type: 'undo' })
    expect(undone.dirty).toBe(true)
    expect(undone.status).toBe('dirty')
    expect(undone.editSeq).toBe(seqBefore + 1)

    const redone = reduce(undone, { type: 'redo' })
    expect(redone.dirty).toBe(true)
    expect(redone.status).toBe('dirty')
    expect(redone.editSeq).toBe(seqBefore + 2)
  })
})

describe('撤销/重做 —— 选中态', () => {
  it('撤销/重做不动 selected（那个节点还在文档里）', () => {
    let state = reduce(loaded(), { type: 'select', node: 'scan' })
    state = reduce(state, { type: 'moveNode', id: 'report', position: { x: 5, y: 5 } })
    state = reduce(state, { type: 'undo' })
    expect(state.selected).toBe('scan')
    state = reduce(state, { type: 'redo' })
    expect(state.selected).toBe('scan')
  })

  it('撤销到"这个节点还不存在"的那一版时，selected 置 null', () => {
    const state = reduce(loaded(), {
      type: 'addNode',
      id: 'extra',
      data: { prompt: 'x' },
      position: { x: 1, y: 1 },
    })
    expect(state.selected).toBe('extra')
    const undone = reduce(state, { type: 'undo' })
    expect(hasNode(docOf(undone), 'extra')).toBe(false)
    expect(undone.selected).toBeNull()
  })

  it('重做到"这个节点已经没了"的那一版时，selected 也置 null', () => {
    let state = reduce(loaded(), { type: 'select', node: 'report' })
    state = reduce(state, { type: 'deleteNode', id: 'report' })
    expect(state.selected).toBeNull()
    const undone = reduce(state, { type: 'undo' })
    expect(undone.selected).toBeNull()
    // 撤销之后 report 又在了，这时选中它，再重做就该掉。
    state = reduce(undone, { type: 'select', node: 'report' })
    expect(hasNode(docOf(state), 'report')).toBe(true)
    const redone = reduce(state, { type: 'redo' })
    expect(hasNode(docOf(redone), 'report')).toBe(false)
    expect(redone.selected).toBeNull()
  })
})

/**
 * 边选中态（`selectedEdge`）。
 *
 * 它与 `selected`（节点）是**互斥**的一对：同时只能有一个非空。右栏据此在三态里选一个
 * 渲染（节点属性 / 边编辑区 / 整图概览），任何一处漏清都会让右栏同时渲染两块。
 */
describe('选中态 —— 节点与边互斥', () => {
  it('loaded / closed 时两个选中态都是空的', () => {
    expect(loaded().selectedEdge).toBeNull()
    expect(reduce(loaded(), { type: 'closed' }).selectedEdge).toBeNull()
  })

  it('只给 node 的 select 会清掉边选中（老口径不变，只是多清一个）', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'scan->auth-review' })
    expect(state.selected).toBeNull()
    expect(state.selectedEdge).toBe('scan->auth-review')
    state = reduce(state, { type: 'select', node: 'scan' })
    expect(state.selected).toBe('scan')
    expect(state.selectedEdge).toBeNull()
  })

  it('选边清掉节点选中；什么都不给就是两个都清', () => {
    let state = reduce(loaded(), { type: 'select', node: 'scan' })
    state = reduce(state, { type: 'select', edge: 'auth-review->report#pass' })
    expect(state.selected).toBeNull()
    expect(state.selectedEdge).toBe('auth-review->report#pass')
    state = reduce(state, { type: 'select' })
    expect(state.selected).toBeNull()
    expect(state.selectedEdge).toBeNull()
  })

  it('同时给非空 node 与 edge 时以边为准（不许出现两者同时非空的状态）', () => {
    const state = reduce(loaded(), { type: 'select', node: 'scan', edge: 'scan->auth-review' })
    expect(state.selected).toBeNull()
    expect(state.selectedEdge).toBe('scan->auth-review')
  })

  it('给 edge: null 与一个 node 时按节点算（null 不是"选边"）', () => {
    const state = reduce(loaded(), { type: 'select', node: 'scan', edge: null })
    expect(state.selected).toBe('scan')
    expect(state.selectedEdge).toBeNull()
  })

  it('addNode 抢走选中态：选中的边一并放掉', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'scan->auth-review' })
    state = reduce(state, {
      type: 'addNode',
      id: 'extra',
      data: { prompt: 'x' },
      position: { x: 10, y: 10 },
    })
    expect(state.selected).toBe('extra')
    expect(state.selectedEdge).toBeNull()
  })

  it('删节点带走它那条边时，边选中一起清掉', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'scan->auth-review' })
    state = reduce(state, { type: 'deleteNode', id: 'auth-review' })
    expect(state.selectedEdge).toBeNull()
  })

  it('删别的节点不动边选中', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'scan->auth-review' })
    state = reduce(state, { type: 'deleteNode', id: 'report' })
    expect(state.selectedEdge).toBe('scan->auth-review')
  })

  it('改 when 等于换了边 id：选中的那条要跟着搬到新 id 上', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'auth-review->report#pass' })
    state = reduce(state, {
      type: 'setEdgeWhen',
      source: 'auth-review',
      target: 'report',
      from: 'pass',
      to: 'fail',
    })
    expect(state.document?.edges.map((edge) => edge.id)).toContain('auth-review->report#fail')
    // 不搬的话，用户点一下「fail」，右栏的边编辑区会当场消失。
    expect(state.selectedEdge).toBe('auth-review->report#fail')
  })

  it('改的不是选中那条时，选中态原样不动', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'scan->auth-review' })
    state = reduce(state, {
      type: 'setEdgeWhen',
      source: 'auth-review',
      target: 'report',
      from: 'pass',
      to: 'fail',
    })
    expect(state.selectedEdge).toBe('scan->auth-review')
  })

  it('无条件边改成有条件的，id 也跟着换（from 缺省）', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'scan->auth-review' })
    state = reduce(state, {
      type: 'setEdgeWhen',
      source: 'scan',
      target: 'auth-review',
      to: 'fail',
    })
    expect(state.document?.edges.map((edge) => edge.id)).toContain('scan->auth-review#fail')
    expect(state.selectedEdge).toBe('scan->auth-review#fail')
  })

  it('disconnect 掉选中的那条边就清掉选中；断开别的边不动它', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'scan->auth-review' })
    state = reduce(state, {
      type: 'disconnect',
      source: 'auth-review',
      target: 'report',
      when: 'pass',
    })
    expect(state.selectedEdge).toBe('scan->auth-review')
    state = reduce(state, { type: 'disconnect', source: 'scan', target: 'auth-review' })
    expect(state.selectedEdge).toBeNull()
  })

  it('undo 到"这条边还没建"的那一版时，边选中被清掉', () => {
    let state = reduce(loaded(), {
      type: 'connect',
      source: 'scan',
      target: 'report',
      when: 'fail',
    })
    state = reduce(state, { type: 'select', edge: 'scan->report#fail' })
    const undone = reduce(state, { type: 'undo' })
    expect(undone.document?.edges.map((edge) => edge.id)).not.toContain('scan->report#fail')
    expect(undone.selectedEdge).toBeNull()
  })

  it('选中的边还在文档里时，撤销不动它', () => {
    let state = reduce(loaded(), { type: 'select', edge: 'scan->auth-review' })
    state = reduce(state, { type: 'moveNode', id: 'report', position: { x: 7, y: 7 } })
    const undone = reduce(state, { type: 'undo' })
    expect(undone.selectedEdge).toBe('scan->auth-review')
  })

  it('readonly 错误态（loadFailed）清掉边选中：那份文档已经不存在了', () => {
    const state = reduce(reduce(loaded(), { type: 'select', edge: 'scan->auth-review' }), {
      type: 'loadFailed',
      message: '坏了',
    })
    expect(state.blocked).toBe(true)
    expect(state.selectedEdge).toBeNull()
  })

  it('hasEdge 认 id、不认大小写（when 是用户写的，不能被压平）', () => {
    const document = sampleDocument()
    expect(hasEdge(document, 'scan->auth-review')).toBe(true)
    expect(hasEdge(document, 'auth-review->report#pass')).toBe(true)
    expect(hasEdge(document, 'auth-review->report#Pass')).toBe(false)
    expect(hasEdge(document, 'nope->nope')).toBe(false)
    expect(hasEdge(document, null)).toBe(false)
  })
})

describe('撤销/重做 —— 历史与生命周期的关系', () => {
  it('refreshed 不清历史（它每几百毫秒就发一次，清了撤销就废了）', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'setNodeData', id: 'report', data: { label: 'R' } })
    state = reduce(state, { type: 'connect', source: 'scan', target: 'report' })
    expect(state.past).toHaveLength(3)

    const refreshed = reduce(state, {
      type: 'refreshed',
      baseHash: 'h2',
      problems: [],
      warnings: [],
    })
    expect(refreshed.baseHash).toBe('h2')
    expect(refreshed.past).toHaveLength(3)

    let back = refreshed
    for (let index = 0; index < 3; index += 1) back = reduce(back, { type: 'undo' })
    expect(back.past).toHaveLength(0)
    expect(back.future).toHaveLength(3)
    expect(docOf(back).edges.map((edge) => edge.id)).toEqual([
      'scan->auth-review',
      'auth-review->report#pass',
    ])
  })

  it('refreshed 带 document 也不清历史，合并链照旧', () => {
    const state = reduce(loaded(), { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    const refreshed = reduce(state, {
      type: 'refreshed',
      baseHash: 'h2',
      problems: [],
      warnings: [],
      document: sampleDocument(),
    })
    expect(refreshed.past).toHaveLength(1)
    expect(refreshed.historyKey).toBe('move:scan')
    const moved = reduce(refreshed, { type: 'moveNode', id: 'scan', position: { x: 2, y: 2 } })
    expect(moved.past).toHaveLength(1)
  })

  it('loaded / loadFailed / closed 清空 past / future / historyKey', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'undo' })
    expect(state.future).toHaveLength(1)

    const reloaded = reduce(state, {
      type: 'loaded',
      name: 'other',
      document: sampleDocument(),
      baseHash: 'h2',
      problems: [],
      warnings: [],
    })
    expect(reloaded.past).toEqual([])
    expect(reloaded.future).toEqual([])
    expect(reloaded.historyKey).toBeNull()

    const failed = reduce(state, { type: 'loadFailed', message: '炸了' })
    expect(failed.past).toEqual([])
    expect(failed.future).toEqual([])
    expect(failed.historyKey).toBeNull()

    const closed = reduce(state, { type: 'closed' })
    expect(closed.past).toEqual([])
    expect(closed.future).toEqual([])
    expect(closed.historyKey).toBeNull()
  })

  it('saveStarted / saveSucceeded / saveFailed 不清历史，也不进历史', () => {
    const before = reduce(loaded(), { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    const started = reduce(before, { type: 'saveStarted', seq: before.editSeq })
    expect(started.past).toBe(before.past)
    expect(started.past).toHaveLength(1)
    expect(started.editSeq).toBe(before.editSeq)

    const succeeded = reduce(started, { type: 'saveSucceeded', baseHash: 'h2' })
    expect(succeeded.past).toBe(before.past)
    expect(succeeded.historyKey).toBe('move:scan')

    const failed = reduce(before, { type: 'saveFailed', message: '磁盘满了' })
    expect(failed.past).toBe(before.past)
    expect(failed.historyKey).toBe('move:scan')
  })

  it('setViewport 不进历史，也不打断合并链', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'setViewport', viewport: { x: 5, y: 6, zoom: 2 } })
    expect(state.past).toHaveLength(1)
    expect(state.historyKey).toBe('move:scan')
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 2, y: 2 } })
    expect(state.past).toHaveLength(1)
    // 视口改动本身照样是脏的（它要落盘），只是不占撤销步。
    expect(state.dirty).toBe(true)
  })

  it('没有历史时，setViewport 也不压栈', () => {
    const state = loaded()
    const moved = reduce(state, { type: 'setViewport', viewport: { x: 1, y: 0, zoom: 1 } })
    expect(moved).not.toBe(state)
    expect(moved.past).toEqual([])
    expect(moved.editSeq).toBe(state.editSeq + 1)
  })
})

describe('撤销/重做 —— 内容正确性', () => {
  it('undo 回来的文档逐字段正确：删掉的节点与它的全部关联边都回来', () => {
    const original = sampleDocument()
    const state = reduce(loaded(), { type: 'deleteNode', id: 'auth-review' })
    expect(docOf(state).nodes.map((node) => node.id)).toEqual(['scan', 'report'])
    expect(docOf(state).edges).toEqual([])

    const undone = reduce(state, { type: 'undo' })
    expect(undone.document).toEqual(original)
    expect(docOf(undone).nodes.map((node) => node.id)).toEqual(['scan', 'auth-review', 'report'])
    expect(docOf(undone).edges.map((edge) => edge.id)).toEqual([
      'scan->auth-review',
      'auth-review->report#pass',
    ])
    expect(docOf(undone).viewport).toEqual(original.viewport)
    expect(docOf(undone).nodes.find((node) => node.id === 'auth-review')?.data).toEqual({
      label: '认证审查',
      prompt: '审查',
      output: 'findings.md',
    })
  })

  it('connect 进历史：撤销后新边消失', () => {
    const original = sampleDocument()
    const state = reduce(loaded(), {
      type: 'connect',
      source: 'scan',
      target: 'report',
      when: 'fail',
    })
    expect(docOf(state).edges.map((edge) => edge.id)).toContain('scan->report#fail')
    const undone = reduce(state, { type: 'undo' })
    expect(undone.document).toEqual(original)
    expect(docOf(undone).edges.map((edge) => edge.id)).not.toContain('scan->report#fail')
  })

  it('setEdgeWhen 进历史：撤销后 when 回旧值', () => {
    let state = reduce(loaded(), { type: 'connect', source: 'scan', target: 'report' })
    state = reduce(state, { type: 'setEdgeWhen', source: 'scan', target: 'report', to: 'fail' })
    expect(docOf(state).edges.map((edge) => edge.id)).toContain('scan->report#fail')

    const undone = reduce(state, { type: 'undo' })
    const ids = docOf(undone).edges.map((edge) => edge.id)
    expect(ids).toContain('scan->report')
    expect(ids).not.toContain('scan->report#fail')
    const edge = docOf(undone).edges.find((item) => item.id === 'scan->report')
    expect(edge).toBeDefined()
    expect(edge === undefined ? '缺' : whenOf(edge)).toBeUndefined()
  })

  it('真的改了才进历史：空转动作既不压栈也不推版本', () => {
    let state = loaded()
    // 归一化后坐标没变。
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 0.0001, y: 0 } })
    // 不存在的节点 / 没变化的 data / 不存在的边 / 不存在的节点。
    state = reduce(state, { type: 'moveNode', id: 'nope', position: { x: 3, y: 3 } })
    state = reduce(state, { type: 'setNodeData', id: 'scan', data: { prompt: '扫描' } })
    state = reduce(state, { type: 'disconnect', source: 'scan', target: 'report' })
    state = reduce(state, { type: 'deleteNode', id: 'nope' })
    state = reduce(state, { type: 'setPositions', positions: { nope: { x: 1, y: 1 } } })
    expect(state.past).toEqual([])
    expect(state.editSeq).toBe(0)
    expect(state.historyKey).toBeNull()
  })

  it('一路撤到底再一路重做回来，文档逐字段回到原样，历史长度也还原', () => {
    // 混着来：带键、无键、断链、视口、批量、删节点都走一遍。
    const sequence: CanvasAction[] = [
      { type: 'moveNode', id: 'scan', position: { x: 40, y: 10 } },
      { type: 'moveNode', id: 'scan', position: { x: 60, y: 30 } },
      { type: 'setNodeData', id: 'scan', data: { label: '扫描' } },
      { type: 'historyBreak' },
      { type: 'setNodeData', id: 'scan', data: { label: '扫描一' } },
      { type: 'connect', source: 'scan', target: 'report' },
      { type: 'setEdgeWhen', source: 'scan', target: 'report', to: 'ok' },
      { type: 'addNode', id: 'extra', data: { prompt: '新来的' }, position: { x: 10, y: 200 } },
      { type: 'setNodeData', id: 'extra', data: { output: false } },
      { type: 'setPositions', positions: { report: { x: 500, y: 300 } } },
      { type: 'deleteNode', id: 'auth-review' },
      { type: 'disconnect', source: 'scan', target: 'report' },
      { type: 'setViewport', viewport: { x: -20, y: -30, zoom: 1.4 } },
      { type: 'moveNode', id: 'report', position: { x: 505, y: 305 } },
      { type: 'addNode', id: 'extra', data: { prompt: '第二个 extra' }, position: { x: 1, y: 1 } },
      { type: 'historyBreak' },
      { type: 'setNodeData', id: 'scan', data: { prompt: '扫描正文' } },
    ]

    let state = loaded()
    for (const action of sequence) state = reduce(state, action)
    const snapshot = state.document
    const pastLength = state.past.length
    expect(pastLength).toBeGreaterThan(0)

    let floor = state
    let undoneCount = 0
    for (let index = 0; index < 200; index += 1) {
      const next = reduce(floor, { type: 'undo' })
      if (next === floor) break
      floor = next
      undoneCount += 1
    }
    // 每一次撤销恰好消化一条历史，不多不少。
    expect(undoneCount).toBe(pastLength)
    expect(undoneCount).toBeLessThan(200)
    expect(floor.past).toEqual([])
    expect(floor.document).not.toEqual(snapshot)

    let top = floor
    for (let index = 0; index < undoneCount; index += 1) {
      const next = reduce(top, { type: 'redo' })
      expect(next).not.toBe(top)
      top = next
    }
    expect(top.document).toEqual(snapshot)
    expect(top.past).toHaveLength(pastLength)
    expect(top.future).toEqual([])
    expect(reduce(top, { type: 'redo' })).toBe(top)
  })

  it('空转动作不打断合并链（否则同值移动会把一次拖拽拆成两条）', () => {
    let state = loaded()
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 1, y: 1 } })
    state = reduce(state, { type: 'moveNode', id: 'scan', position: { x: 2, y: 2 } })
    expect(state.past).toHaveLength(1)
  })

  it('setPositions 里认不出的 id 跳过，认得出的照改，还是一条历史', () => {
    const state = reduce(loaded(), {
      type: 'setPositions',
      positions: { nope: { x: 1, y: 1 }, scan: { x: 7, y: 7 } },
    })
    expect(positionOf(state, 'scan')).toEqual({ x: 7, y: 7 })
    expect(nodeIdsOf(state)).not.toContain('nope')
    expect(state.past).toHaveLength(1)
  })

  it('只改了视口时，撤销是 no-op（视口不占撤销步）', () => {
    const state = reduce(loaded(), { type: 'setViewport', viewport: { x: 9, y: 9, zoom: 2 } })
    expect(docOf(state).viewport).toEqual({ x: 9, y: 9, zoom: 2 })
    expect(reduce(state, { type: 'undo' })).toBe(state)
  })
})

describe('duplicateNode', () => {
  it('偏移常量是右下 24px', () => {
    expect(DUPLICATE_OFFSET).toBe(24)
  })

  it('新 id 是 源id-2；已经有了 -2 就给 -3', () => {
    const document = sampleDocument()
    const first = mustDuplicate(document, 'scan')
    expect(first.id).toBe('scan-2')
    const withCopy: WorkflowDocument = {
      ...document,
      nodes: [
        ...document.nodes,
        { id: first.id, type: 'wfNode', position: first.position, data: first.data },
      ],
    }
    expect(mustDuplicate(withCopy, 'scan').id).toBe('scan-3')
  })

  it('大小写不敏感地找到源节点，但新 id 用源节点自己的写法', () => {
    const copied = mustDuplicate(sampleDocument(), 'SCAN')
    expect(copied.id).toBe('scan-2')
    expect(copied.data.prompt).toBe('扫描')
  })

  it('data 是拷贝：改副本不动源节点', () => {
    const document = sampleDocument()
    const source = document.nodes.find((node) => node.id === 'scan')
    if (source === undefined) throw new Error('样例里必须有 scan')
    const copied = mustDuplicate(document, 'scan')
    expect(copied.data).not.toBe(source.data)
    expect(copied.data).toEqual(source.data)

    copied.data.output = false
    copied.data.label = '改了副本'
    delete copied.data.prompt
    expect(source.data).toEqual({ prompt: '扫描', output: 'scan.json' })
    expect('label' in source.data).toBe(false)
  })

  it('data 是拷贝：连做两次复制，两个副本之间也互不影响', () => {
    const document = sampleDocument()
    const first = mustDuplicate(document, 'scan')
    const second = mustDuplicate(document, 'scan')
    expect(first.data).not.toBe(second.data)
    first.data.output = false
    expect(second.data.output).toBe('scan.json')
  })

  it('复制不修改传进去的那份文档', () => {
    const document = sampleDocument()
    mustDuplicate(document, 'auth-review')
    expect(document).toEqual(sampleDocument())
  })

  it('position = 源坐标 + 24，两个轴都偏移', () => {
    const document = sampleDocument()
    expect(mustDuplicate(document, 'scan').position).toEqual({ x: 24, y: 24 })
    expect(mustDuplicate(document, 'auth-review').position).toEqual({ x: 224, y: 24 })
  })

  it('不带边：加进文档后没有任何边连着它', () => {
    const document = sampleDocument()
    // auth-review 既有入边也有出边，是最容易被"顺手复制连接"的样本。
    const copied = mustDuplicate(document, 'auth-review')
    const state = reduce(loaded(), {
      type: 'addNode',
      id: copied.id,
      data: copied.data,
      position: copied.position,
    })
    const next = docOf(state)
    expect(next.nodes.map((node) => node.id)).toContain('auth-review-2')
    expect(next.edges.filter((edge) => edge.source === copied.id)).toEqual([])
    expect(next.edges.filter((edge) => edge.target === copied.id)).toEqual([])
    expect(next.edges).toHaveLength(document.edges.length)
  })

  it('找不到源 id 给 null', () => {
    expect(duplicateNode(sampleDocument(), 'nope')).toBeNull()
    expect(duplicateNode(sampleDocument(), '')).toBeNull()
  })

  it('label / prompt / output 三态原样带过来', () => {
    const document = sampleDocument()
    // prompt + output 字符串，没有 label。
    expect(mustDuplicate(document, 'scan').data).toEqual({ prompt: '扫描', output: 'scan.json' })
    // label + prompt + output 都在。
    expect(mustDuplicate(document, 'auth-review').data).toEqual({
      label: '认证审查',
      prompt: '审查',
      output: 'findings.md',
    })
    // output === false 是"显式声明不产出"，不许被当成缺省丢掉。
    const report = mustDuplicate(document, 'report')
    expect(report.data).toEqual({ prompt: '报告', output: false })
    expect(report.data.output).toBe(false)
  })

  it('复制出来的节点走 addNode 进去后选中态落在新节点上', () => {
    const copied = mustDuplicate(sampleDocument(), 'scan')
    const state = reduce(loaded(), {
      type: 'addNode',
      id: copied.id,
      data: copied.data,
      position: copied.position,
    })
    expect(state.selected).toBe('scan-2')
    expect(nodeIdsOf(state)).toContain('scan-2')
  })
})

describe('isTypingTarget', () => {
  it('INPUT / TEXTAREA / SELECT 都为真，大小写不敏感', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'input' })).toBe(true)
    expect(isTypingTarget({ tagName: 'Input' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'select' })).toBe(true)
  })

  it('isContentEditable === true 为真（标签不是输入控件也算）', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTypingTarget({ isContentEditable: true })).toBe(true)
  })

  it('其余一律为假', () => {
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false)
    expect(isTypingTarget({ tagName: 'div', isContentEditable: false })).toBe(false)
    // 注意是严格比较：字符串 'true' 不算。
    expect(isTypingTarget({ isContentEditable: 'true' })).toBe(false)
    expect(isTypingTarget({ tagName: 42 })).toBe(false)
    expect(isTypingTarget({})).toBe(false)
    expect(isTypingTarget([])).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(undefined)).toBe(false)
    expect(isTypingTarget(0)).toBe(false)
    expect(isTypingTarget(true)).toBe(false)
    expect(isTypingTarget('INPUT')).toBe(false)
    expect(isTypingTarget('')).toBe(false)
  })

  it('不依赖 DOM 构造函数（这个文件跑在 node 环境）', () => {
    expect(typeof globalThis.HTMLInputElement).toBe('undefined')
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
  })
})
