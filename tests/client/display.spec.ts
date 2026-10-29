/**
 * 资源卡的画布展示：存盘形状（`view`）、哪些项能展示、尺寸怎么算、布局给它让位、改展示不通知模型。
 */
import { describe, expect, it } from 'vitest'
import {
  DISPLAY_HEAD,
  defaultView,
  displayableItems,
  displayCardSize,
  displayKindOf,
  displayOf,
  snapView,
  stepZoom,
} from '../../src/client/model/display.ts'
import {
  COL_STEP,
  cardSize,
  NODE_H,
  RES_DX,
  RES_W,
  resourceSpot,
  tidy,
} from '../../src/client/model/layout.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { affectsPlan, describeGraphChange, graphChanges } from '../../src/shared/graphDiff.ts'
import { canonicalResource, readResourceData, readView } from '../../src/shared/model.ts'
import type { ResourceData, ResourceNode, WorkflowDocument } from '../../src/shared/types.ts'

const file = (value: string) => ({ kind: 'file' as const, value })

describe('存盘形状', () => {
  it('宽高缺一个就当没开；越界夹回范围、取整；fit 的缺省 contain 不写盘', () => {
    expect(readView({ width: 300 })).toBeUndefined()
    expect(readView('x')).toBeUndefined()
    expect(readView({ width: 99999, height: 3.6, zoom: 1, fit: 'contain', item: -1 })).toEqual({
      width: 1600,
      height: 100,
      zoom: 25,
    })
    expect(readView({ width: 480, height: 300, zoom: 50, fit: 'cover', item: 2 })).toEqual({
      item: 2,
      width: 480,
      height: 300,
      zoom: 50,
      fit: 'cover',
    })
    expect(readView({ width: 480, height: 300, fit: 'nope' })).toEqual({ width: 480, height: 300 })
  })

  it('规范写法：view 排在最后，键序固定；读进来再写出去不变', () => {
    const data = readResourceData({
      view: { fit: 'actual', height: 240, width: 360, item: 0 },
      items: [file('shot.png')],
      label: '截图',
    })
    const canonical = canonicalResource(data)
    expect(Object.keys(canonical)).toEqual(['label', 'items', 'view'])
    expect(Object.keys(canonical.view ?? {})).toEqual(['item', 'width', 'height', 'fit'])
    expect(canonicalResource(readResourceData(canonical))).toEqual(canonical)
  })
})

describe('能展示什么', () => {
  it('图片、网页、Markdown、文本类文件和自定义文字；文件夹、网址、Skill、二进制不行', () => {
    expect(displayKindOf(file('a/shot.PNG'))).toBe('image')
    expect(displayKindOf(file('board.html'))).toBe('html')
    expect(displayKindOf(file('report.md'))).toBe('markdown')
    expect(displayKindOf({ kind: 'text', value: '# 说明' })).toBe('markdown')
    expect(displayKindOf(file('run.log'))).toBe('text')
    expect(displayKindOf(file('data.json'))).toBe('text')
    expect(displayKindOf(file('main.ts'))).toBe('text')
    expect(displayKindOf(file('a.zip'))).toBeNull()
    expect(displayKindOf(file(''))).toBeNull()
    expect(displayKindOf({ kind: 'folder', value: 'shots' })).toBeNull()
    expect(displayKindOf({ kind: 'url', value: 'https://x.dev' })).toBeNull()
    expect(displayKindOf({ kind: 'skill', value: 'impeccable' })).toBeNull()
    expect(
      displayableItems([{ kind: 'url', value: 'x' }, file('a.png'), file('b.zip'), file('c.md')]),
    ).toEqual([1, 3])
  })

  it('展示哪一项：指定的能展示就用它，否则回落到第一个能展示的；记忆卡、没有能展示的不展示', () => {
    const items = [{ kind: 'url' as const, value: 'x' }, file('a.png'), file('b.html')]
    const base: ResourceData = { items, view: { width: 360, height: 240 } }
    expect(displayOf(base)?.item).toBe(1)
    expect(displayOf({ ...base, view: { width: 480, height: 300, item: 2 } })).toEqual({
      item: 2,
      kind: 'html',
      width: 480,
      height: 300,
      zoom: 100,
      fit: 'contain',
      adapt: true,
    })
    expect(displayOf({ ...base, view: { width: 360, height: 240, item: 0 } })?.item).toBe(1)
    expect(displayOf({ items })).toBeNull()
    expect(displayOf({ items: [{ kind: 'url', value: 'x' }], view: base.view })).toBeNull()
    expect(
      displayOf({
        ...base,
        preset: { kind: 'memory', memory: 'm', type: 'step' },
      }),
    ).toBeNull()
  })
})

describe('尺寸', () => {
  it('卡片 = 标题行 + 展示区；资源卡尺寸跟着展示走，最窄不小于普通资源卡', () => {
    expect(displayCardSize({ width: 360, height: 240 })).toEqual({
      w: 360,
      h: DISPLAY_HEAD + 240,
    })
    const node = (data: ResourceData): ResourceNode => ({
      id: 'r',
      type: 'wfResource',
      position: { x: 0, y: 0 },
      data,
    })
    expect(cardSize(node({ items: [file('a.png')], view: { width: 480, height: 300 } }))).toEqual({
      w: 480,
      h: DISPLAY_HEAD + 300,
    })
    expect(cardSize(node({ items: [file('a.png')], view: { width: 160, height: 100 } })).w).toBe(
      RES_W,
    )
  })

  it('拖出来的尺寸按 8 取整、夹进范围；缩放按档走，到头不动', () => {
    expect(snapView(363, 241)).toEqual({ width: 360, height: 240 })
    expect(snapView(20, 5000)).toEqual({ width: 160, height: 1200 })
    expect(stepZoom(50, 1)).toBe(67)
    expect(stepZoom(50, -1)).toBe(33)
    expect(stepZoom(55, -1)).toBe(50)
    expect(stepZoom(200, 1)).toBe(200)
    expect(stepZoom(25, -1)).toBe(25)
    expect(defaultView('html')).toEqual({ width: 320, height: 200 })
    expect(defaultView('image', 2)).toEqual({ item: 2, width: 320, height: 216 })
  })
})

function doc(view?: ResourceData['view']): WorkflowDocument {
  const step = (id: string) => ({
    id,
    type: 'wfNode' as const,
    position: { x: 0, y: 0 },
    data: { prompt: id },
  })
  const edge = (source: string, target: string) => ({
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
  })
  return {
    nodes: [
      step('a'),
      step('b'),
      {
        id: 'board',
        type: 'wfResource',
        position: { x: 0, y: 0 },
        data: { items: [file('board.html')], ...(view === undefined ? {} : { view }) },
      },
    ],
    edges: [edge('a', 'b'), edge('a', 'board')],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

describe('布局', () => {
  it('整理布局：展示卡比一列宽时把那一列撑开，下一列不压到它', async () => {
    const narrow = doc()
    const plain = await tidy(narrow, analyzeGraph(narrow))
    expect((plain.b?.x ?? 0) - (plain.a?.x ?? 0)).toBe(COL_STEP)

    const wide = doc({ width: 720, height: 450 })
    const placed = await tidy(wide, analyzeGraph(wide))
    const board = placed.board
    const b = placed.b
    if (board === undefined || b === undefined) throw new Error('not placed')
    expect(b.x).toBeGreaterThan(board.x + 720)
  })
})

describe('摆新加的资源卡', () => {
  it('按真实宽度找空位：普通卡放得下的地方，宽的展示卡会压到右边的卡，就往下挪', () => {
    const below = NODE_H + 22
    const placed: WorkflowDocument = {
      nodes: [
        { id: 'a', type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: 'a' } },
        {
          id: 'b',
          type: 'wfNode',
          position: { x: RES_DX + RES_W + 40, y: below },
          data: { prompt: 'b' },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    expect(resourceSpot(placed, { x: 0, y: 0 }).y).toBe(below)
    expect(resourceSpot(placed, { x: 0, y: 0 }, undefined, { w: 492, h: 344 }).y).toBeGreaterThan(
      below,
    )
  })
})

describe('改展示不通知模型', () => {
  it('只改了 view：算一处改动，但不进计划；说法是「画布展示」', () => {
    const before = doc({ width: 480, height: 300 })
    const after = doc({ width: 720, height: 450 })
    const changes = graphChanges(before, after)
    expect(changes).toEqual([
      { object: 'resource', kind: 'changed', id: 'board', fields: ['view'] },
    ])
    expect(affectsPlan(changes[0] as (typeof changes)[number])).toBe(false)
    expect(describeGraphChange(changes[0] as (typeof changes)[number], before, after)).toContain(
      '画布展示',
    )
  })
})
