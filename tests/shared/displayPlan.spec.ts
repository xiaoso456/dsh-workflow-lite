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
  displayKindOf,
  displayOf,
  galleryGrid,
  galleryLayout,
  galleryTracks,
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
    expect(board).toContain('视口约 480×300 px')
    expect(board).toContain('`workflow-board`')
    expect(board).toContain('data-board="card"')
    expect(board).toContain('--board-*')
    expect(board).toContain('完整版')
    expect(board).toContain('和画布上的步骤卡片一样大')
    // 缩放只把整页等比缩放，排版按「大小」：不用让模型把字乘回来。
    expect(board).not.toContain('--k')
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

  it('日志：卡片停在末尾，要一行一条、带时间和级别；筛了行的点明要对上哪段字', () => {
    const log = (view: ResourceData['view']) =>
      tasks(doc({ items: [{ kind: 'file', value: 'logs/train.log' }], view })).get('board') ?? ''
    const auto = log({ width: 320, height: 192 })
    expect(auto).toContain('在你写的时候停在末尾')
    expect(auto).toContain('一行写一条')
    expect(auto).toContain('INFO / WARN / ERROR')
    expect(auto).not.toContain('只露出开头')
    expect(log({ width: 320, height: 192, lines: { from: 'start' } })).toContain('只露出开头约')
    expect(log({ width: 320, height: 192, lines: { filter: { pattern: 'loss=' } } })).toContain(
      '只显示能对上 `loss=` 的行',
    )
    // 代码、配置还是「开头约几行」。
    const config = tasks(
      doc({ items: [{ kind: 'file', value: 'conf.yaml' }], view: { width: 320, height: 192 } }),
    ).get('board')
    expect(config).toContain('只露出开头约')
  })

  it('表格：排成表，表头短、列少、新行追加在末尾', () => {
    const table = tasks(
      doc({ items: [{ kind: 'file', value: 'metrics.csv' }], view: { width: 448, height: 256 } }),
    ).get('board')
    expect(table).toContain('排成表格（卡片约 448 px 宽')
    expect(table).toContain('第一行是表头')
    expect(table).toContain('新的行追加在末尾')
  })

  it('文件夹：图墙、文件列表都交代；只看某些名字时点明文件名照它起', () => {
    const folder = (view: ResourceData['view']) =>
      tasks(doc({ items: [{ kind: 'folder', value: 'shots/' }], view })).get('board') ?? ''
    const wall = folder({ width: 320, height: 216 })
    expect(wall).toContain('排成图墙')
    expect(folder({ width: 320, height: 216, gallery: { match: '*.png' } })).toContain(
      '名字对得上 `*.png`',
    )
    expect(folder({ width: 320, height: 216, gallery: { show: 'files' } })).toContain(
      '列出里面的文件',
    )
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
    hideTitle: false,
    lines: {},
    table: {},
    gallery: {},
  }

  it('网页按「大小」排版（缩放只整张等比缩放）；图片报比例（原大时报看得到的像素）；文字报大约几行', () => {
    expect(displayBrief(base)).toEqual({
      kind: 'html',
      layoutWidth: 480,
      firstScreen: 300,
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

  it('文件夹排成图墙：报一次露出几张、最新那张的大格多大', () => {
    expect(displayKindOf({ kind: 'folder', value: 'out/shots' })).toBe('gallery')
    expect(displayKindOf({ kind: 'folder', value: ' ' })).toBeNull()
    expect(
      displayOf({ items: [{ kind: 'folder', value: 'shots' }], view: { width: 320, height: 216 } }),
    ).toMatchObject({ kind: 'gallery', fit: 'cover' })
    expect(
      displayBrief({ ...base, kind: 'gallery', width: 320, height: 216, zoom: 100, fit: 'cover' }),
    ).toEqual({ kind: 'gallery', tiles: 9, hero: { width: 159, height: 143 }, fit: 'cover' })
    // 小卡两格并排，没有大格。
    expect(galleryGrid(208, 136)).toMatchObject({ columns: 2, rows: 1, hero: false, slots: 2 })
    expect(galleryGrid(448, 296)).toMatchObject({ columns: 5, rows: 3, hero: true, slots: 12 })
  })

  it('图少时按张数重排：小格接近 4:3，五张起最新的占大格，最后一行摊开占满', () => {
    expect(galleryLayout(448, 296, 1)).toMatchObject({ columns: 1, rows: 1, spans: [] })
    expect(galleryLayout(448, 296, 2)).toMatchObject({ columns: 2, rows: 1, spans: [] })
    // 三张：上面两张、下面一张占满一行。
    expect(galleryLayout(448, 296, 3)).toMatchObject({
      columns: 2,
      rows: 2,
      hero: false,
      spans: [2],
    })
    expect(galleryLayout(448, 296, 5)).toMatchObject({ hero: true })
    // 七张：大格 + 右边四张，最后一行两张各占两列。
    expect(galleryLayout(448, 296, 7)).toMatchObject({
      columns: 4,
      rows: 3,
      hero: true,
      spans: [2, 2],
    })
    // 够多了：照满格的排法（多出来的写在最后一格的「+N」里）。
    expect(galleryLayout(320, 216, 30)).toMatchObject({ hero: true, slots: 9, spans: [] })
    // 每种张数都排得下、不留空：格子数（含摊开的）正好铺满。
    for (const [w, h] of [
      [208, 136],
      [320, 216],
      [448, 296],
      [600, 200],
    ]) {
      for (let n = 1; n <= 30; n += 1) {
        const l = galleryLayout(w, h, n)
        const cells =
          Math.min(n, l.slots) + l.spans.reduce((a, b) => a + b - 1, 0) + (l.hero ? 3 : 0)
        expect(cells, `${w}×${h} ${n}`).toBe(l.columns * l.rows)
      }
    }
  })

  it('图墙的设置：固定几列几行、不放大、大图 + 胶片、最新一张', () => {
    // 固定 3 × 2：卡片多大都是这几格，第一张占 2 × 2。
    expect(galleryGrid(448, 296, { grid: { columns: 3, rows: 2 } })).toMatchObject({
      columns: 3,
      rows: 2,
      hero: true,
      slots: 3,
    })
    expect(galleryGrid(900, 600, { grid: { columns: 3, rows: 2 } }).slots).toBe(3)
    expect(galleryGrid(448, 296, { hero: false })).toMatchObject({ hero: false, slots: 15 })
    // 固定的不按张数重排：空着的格子就空着。
    expect(galleryLayout(448, 296, 2, { grid: { columns: 4, rows: 2 } })).toMatchObject({
      columns: 4,
      rows: 2,
      spans: [],
    })
    // 不放大时图少也不排出大格。
    for (let n = 1; n <= 20; n += 1) {
      expect(galleryLayout(448, 296, n, { hero: false }).hero).toBe(false)
    }
    // 大图 + 胶片：上面一整行，下面一排小格；张数不够一排时小格少几个，一张就是一张。
    const strip = galleryGrid(448, 296, { layout: 'strip' })
    expect(strip).toMatchObject({ rows: 2, hero: true, strip: 65 })
    expect(strip.heroSpan).toEqual({ columns: strip.columns, rows: 1 })
    expect(strip.slots).toBe(strip.columns + 1)
    expect(galleryLayout(448, 296, 3, { layout: 'strip' })).toMatchObject({
      columns: 2,
      heroSpan: { columns: 2, rows: 1 },
      slots: 3,
    })
    expect(galleryLayout(448, 296, 1, { layout: 'strip' })).toMatchObject({ columns: 1, rows: 1 })
    // 图墙时固定过的格子，换到胶片后不碍事。
    expect(
      galleryLayout(448, 296, 3, { layout: 'strip', grid: { columns: 4, rows: 2 } }),
    ).toMatchObject({ columns: 2, slots: 3 })
    expect(galleryTracks(strip).rows).toBe('minmax(0, 1fr) 65px')
    expect(galleryGrid(448, 296, { layout: 'single' })).toMatchObject({ slots: 1, hero: true })
    // 给模型的说明跟着设置走。
    const shown = { ...base, kind: 'gallery' as const, width: 448, height: 296, zoom: 100 }
    expect(displayBrief({ ...shown, fit: 'cover', gallery: { layout: 'strip' } })).toMatchObject({
      tiles: strip.slots,
      hero: { width: 448, height: 228 },
    })
    expect(displayBrief({ ...shown, fit: 'cover', gallery: { layout: 'single' } })).toMatchObject({
      tiles: 1,
      hero: { width: 448, height: 296 },
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

  it('日志、表格、文件夹的设置：在原设置上逐项改，空值清掉', () => {
    const log: ResourceData = {
      items: [{ kind: 'file', value: 'run.log' }],
      view: { width: 320, height: 192, lines: { from: 'start' } },
    }
    expect(applyDisplay(log, { lines: { filter: 'ERROR', context: 2 } })).toEqual({
      view: {
        width: 320,
        height: 192,
        lines: { from: 'start', filter: { pattern: 'ERROR', context: 2 } },
      },
    })
    const filtered: ResourceData = {
      ...log,
      view: { width: 320, height: 192, lines: { filter: { pattern: 'ERROR', context: 2 } } },
    }
    expect(applyDisplay(filtered, { lines: { regex: true } })).toEqual({
      view: {
        width: 320,
        height: 192,
        lines: { filter: { pattern: 'ERROR', regex: true, context: 2 } },
      },
    })
    expect(applyDisplay(filtered, { lines: { filter: '' } })).toEqual({
      view: { width: 320, height: 192 },
    })

    const csv: ResourceData = { items: [{ kind: 'file', value: 'metrics.csv' }] }
    expect(
      applyDisplay(csv, { table: { sort: 'score', desc: true, bars: true, hide: ['note'] } }),
    ).toEqual({
      view: {
        width: 320,
        height: 192,
        table: { hide: ['note'], bars: true, sort: { column: 'score', desc: true } },
      },
    })
    const sorted: ResourceData = {
      ...csv,
      view: {
        width: 320,
        height: 192,
        table: { bars: true, sort: { column: 'score', desc: true } },
      },
    }
    expect(applyDisplay(sorted, { table: { sort: '', bars: false } })).toEqual({
      view: { width: 320, height: 192 },
    })

    const folder: ResourceData = { items: [{ kind: 'folder', value: 'shots/' }] }
    const wall = applyDisplay(folder, {
      folder: { layout: 'strip', order: 'name', match: '*.png' },
    })
    expect(wall).toEqual({
      view: {
        width: 320,
        height: 216,
        gallery: { layout: 'strip', order: 'name', match: '*.png' },
      },
    })
    const back = applyDisplay(
      { ...folder, view: 'view' in wall ? wall.view : undefined },
      { folder: { layout: 'wall', order: 'newest', match: '' } },
    )
    expect(back).toEqual({ view: { width: 320, height: 216 } })
  })

  it('设置给错了种类、正则写错、只给 regex 没有要找的字：回一句错', () => {
    const log: ResourceData = { items: [{ kind: 'file', value: 'run.log' }] }
    expect(applyDisplay(log, { table: { sort: 'a' } })).toEqual({
      error: expect.stringContaining('display.table 只用于CSV / TSV'),
    })
    expect(applyDisplay(log, { folder: { layout: 'strip' } })).toHaveProperty('error')
    expect(applyDisplay(log, { lines: { filter: '(', regex: true } })).toHaveProperty('error')
    expect(applyDisplay(log, { lines: { regex: true } })).toHaveProperty('error')
    expect(
      applyDisplay({ items: [{ kind: 'file', value: 'metrics.csv' }] }, { lines: { from: 'end' } }),
    ).toHaveProperty('error')
    expect(
      applyDisplay({ items: [{ kind: 'file', value: 'main.ts' }] }, { lines: { from: 'end' } }),
    ).toHaveProperty('error')
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
