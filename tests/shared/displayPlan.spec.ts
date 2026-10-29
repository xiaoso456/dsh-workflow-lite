/**
 * 画布展示进计划：写它的步骤的任务描述里交代卡片看得到多少、怎么写才在卡片里和单独打开时都好看；
 * 读它的步骤、关了适配、自定义文字、导出成 skill（通用口径）都不提。另有工具 `display` 参数落成 `view` 的规则。
 */
import { describe, expect, it } from 'vitest'
import { buildFullText, buildTaskTexts, type SkillPlan } from '../../src/shared/compile.ts'
import {
  applyDisplay,
  type Display,
  displayBrief,
  displayOf,
  ratioText,
} from '../../src/shared/display.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { makeEdgeId } from '../../src/shared/model.ts'
import {
  NODE_TYPE,
  type PlanFacts,
  RESOURCE_TYPE,
  type ResourceData,
  type WorkflowDocument,
  type WorkflowEdge,
} from '../../src/shared/types.ts'

function edge(source: string, target: string): WorkflowEdge {
  return { id: makeEdgeId(source, target), source, target, sourceHandle: null, targetHandle: null }
}

/** 出看板 → 写报告：出看板写 dashboard.html（开着展示），写报告读它。 */
function doc(data: ResourceData): WorkflowDocument {
  return {
    nodes: [
      { id: 'board', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: '出看板。' } },
      { id: 'report', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: '写报告。' } },
      { id: 'res-board', type: RESOURCE_TYPE, position: { x: 0, y: 0 }, data },
    ],
    edges: [edge('board', 'report'), edge('board', 'res-board'), edge('res-board', 'report')],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

function facts(document: WorkflowDocument): PlanFacts {
  const payloadPaths = new Map(['board', 'report'].map((id) => [id, `C:\\p\\${id}.md`]))
  return { name: 'demo', document, payloadPaths }
}

function tasks(document: WorkflowDocument, skill?: SkillPlan): Map<string, string> {
  return buildTaskTexts(
    facts(document),
    analyzeGraph(document),
    skill === undefined ? {} : { skill },
  )
}

const html = (view: ResourceData['view']): ResourceData => ({
  items: [{ kind: 'file', value: 'dashboard.html' }],
  ...(view === undefined ? {} : { view }),
})

describe('任务描述里的画布展示', () => {
  it('网页：写它的步骤拿到排版宽度、首屏高度和网页的几条硬要求；读它的步骤没有', () => {
    const texts = tasks(doc(html({ width: 480, height: 300, zoom: 50 })))
    const board = texts.get('board') ?? ''
    expect(board).toContain('**画布展示**：')
    expect(board).toContain('视口约 960×600 px')
    expect(board).toContain('`workflow-board`')
    expect(board).toContain('data-board="card"')
    expect(board).toContain('--board-*')
    expect(board).toContain('完整版')
    expect(board).toContain('和画布上的步骤卡片一样大')
    expect(board).toContain('`.card-view` 上写 `style="--k: 2"`')
    // 放得下多少按画布像素估（480×300 是横着的卡：左右两栏）。
    expect(board).toContain(
      '主体约 248 px 高、分左右两栏，右栏约 209 px 宽，一栏放得下约 9 行指标行或 12 行列表',
    )
    expect(board).toContain('`data-drop`')
    expect(board).toContain('宽度自适应')
    expect(board).toContain('自包含')
    expect(board).toContain('localStorage')
    expect(board).toContain('CDN')
    expect(texts.get('report')).not.toContain('画布展示')
  })

  it('小卡、竖长卡：放得下多少换成单栏的说法', () => {
    const small = tasks(doc(html({ width: 208, height: 128 }))).get('board') ?? ''
    expect(small).toContain('这是小卡，只显示标题行和 `.main`')
    const tall = tasks(doc(html({ width: 224, height: 320 }))).get('board') ?? ''
    expect(tall).toContain('单栏，主组件和次要的上下排')
  })

  it('没开展示、关了适配：不提', () => {
    expect(tasks(doc(html(undefined))).get('board')).not.toContain('画布展示')
    expect(tasks(doc(html({ width: 480, height: 300, adapt: false }))).get('board')).not.toContain(
      '画布展示',
    )
  })

  it('导出成 skill（通用口径）没有画布：不提', () => {
    const skill: SkillPlan = { bundled: new Set(), needs: [], absolute: [] }
    const texts = tasks(doc(html({ width: 480, height: 300 })), skill)
    expect([...texts.values()].join('\n')).not.toContain('画布')
  })

  it('网页缺省按卡片原宽排版；图片要少画、字大线粗', () => {
    expect(tasks(doc(html({ width: 480, height: 300 }))).get('board')).toContain(
      '视口约 480×300 px',
    )
    const chart = tasks(
      doc({ items: [{ kind: 'file', value: 'latency.png' }], view: { width: 360, height: 240 } }),
    ).get('board')
    expect(chart).toContain('比如 720×480')
    expect(chart).toContain('一张图只讲一件事')
    expect(chart).toContain('文字不小于 20 px')
  })

  it('资源里不止一项：点明展示的是哪个文件', () => {
    const board = tasks(
      doc({
        items: [
          { kind: 'file', value: 'rounds.jsonl' },
          { kind: 'file', value: 'dashboard.html' },
        ],
        view: { item: 1, width: 480, height: 300 },
      }),
    ).get('board')
    expect(board).toMatch(/\*\*画布展示\*\*（`[^`]*dashboard\.html`）：/u)
  })

  it('整卷版：写它的资源下面挂一条画布展示', () => {
    const document = doc(html({ width: 480, height: 300 }))
    const full = buildFullText(facts(document), analyzeGraph(document))
    expect(full).toMatch(/- `res-board`：文件：`[^`]*dashboard\.html`\n {2}- \*\*画布展示\*\*：/u)
  })
})

describe('卡片里看得到多少', () => {
  const base: Display = {
    item: 0,
    kind: 'html',
    width: 480,
    height: 300,
    zoom: 50,
    fit: 'contain',
    adapt: true,
  }

  it('网页按「宽 ÷ 缩放」排版；图片报比例（原大时报看得到的像素）；文字报大约几行', () => {
    expect(displayBrief(base)).toEqual({
      kind: 'html',
      layoutWidth: 960,
      firstScreen: 600,
      fontScale: 2,
      room: { columns: 2, small: false, width: 209, height: 248, stats: 9, list: 12, bars: 11 },
    })
    expect(displayBrief({ ...base, kind: 'image', width: 360, height: 240, zoom: 100 })).toEqual({
      kind: 'image',
      ratio: '3:2',
      fit: 'contain',
      width: 360,
      height: 240,
    })
    expect(
      displayBrief({ ...base, kind: 'image', width: 360, height: 240, zoom: 50, fit: 'actual' }),
    ).toMatchObject({ visible: { width: 720, height: 480 } })
    expect(displayBrief({ ...base, kind: 'markdown', height: 260, zoom: 100 })).toEqual({
      kind: 'markdown',
      lines: 12,
    })
  })

  it('比例靠近常见的就说常见的，否则报两位小数', () => {
    expect(ratioText(480, 300)).toBe('16:10')
    expect(ratioText(560, 372)).toBe('3:2')
    expect(ratioText(240, 400)).toBe('1:1.67')
    expect(ratioText(1000, 300)).toBe('3.33:1')
  })
})

describe('工具的 display 落成 view', () => {
  const items = [
    { kind: 'file' as const, value: 'rounds.jsonl' },
    { kind: 'file' as const, value: 'dashboard.html' },
  ]

  it('没开过：按展示项的种类从中档起；只有一项能展示时不记 item', () => {
    expect(applyDisplay({ items: [{ kind: 'file', value: 'a.html' }] }, {})).toEqual({
      view: { width: 320, height: 176 },
    })
    expect(applyDisplay({ items }, { item: 1, size: 'l' })).toEqual({
      view: { item: 1, width: 448, height: 256 },
    })
  })

  it('开过：在原设置上改；换了种类又没给尺寸，回到新种类的中档；show:false 关掉', () => {
    const data: ResourceData = { items, view: { item: 1, width: 600, height: 400, zoom: 75 } }
    expect(applyDisplay(data, { adapt: false })).toEqual({
      view: { item: 1, width: 600, height: 400, zoom: 75, adapt: false },
    })
    expect(applyDisplay(data, { item: 0 })).toEqual({
      view: { item: 0, width: 320, height: 192 },
    })
    expect(applyDisplay(data, { show: false })).toEqual({ view: undefined })
    const huge = applyDisplay(data, { width: 99999 })
    expect('view' in huge && displayOf({ ...data, view: huge.view })?.width).toBe(1600)
  })

  it('没有能展示的项、item 指错、记忆卡：回一句错', () => {
    expect(applyDisplay({ items: [{ kind: 'url', value: 'https://x.dev' }] }, {})).toHaveProperty(
      'error',
    )
    expect(applyDisplay({ items }, { item: 5 })).toHaveProperty('error')
    expect(
      applyDisplay(
        { items: [], preset: { kind: 'memory', memory: 'm', type: 'step' } },
        { size: 'm' },
      ),
    ).toHaveProperty('error')
  })
})
