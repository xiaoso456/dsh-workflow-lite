/**
 * 拍 README 封面图的素材（中文、英文各一套），封面由 `tests/readme-hero.mjs` 排版出图。
 *
 * **自备环境**：自己起一个假模型、一个截图专用 profile 和一个随机端口的实例，备好夹具会话，
 * 拍完拆掉。不依赖"已经有一台 dsh web 在 3190 上跑着"，也不发真实模型请求——封面拍的是
 * 准备好的数据，不是当时机器上的状态。
 *
 * 每种语言：把浏览器语言设成那种语言（DSH 与插件界面跟着变），在实例里建示例工作流「代码审查循环」，
 * 拍到 `tests/runs/hero/<lang>/`：编辑页的图（canvas.png）、编译出的计划（plan.txt）、
 * 一个实例按状态点亮的图（run-graph.png）、右栏的两小块（run-position.png 执行位置、run-timeline.png 时间线）
 * 与查看框里打开的 HTML 看板（run-dashboard.png）。拍完删掉示例工作流和实例，把浏览器语言、侧栏、步骤库都放回去。
 *
 * 清晰度：封面按 2 倍像素出图，素材的一个像素对应封面的一个像素，不再缩放——
 * 工作流的图按「封面里图的宽度 ÷ 图在页面上的宽度 × 2」拍，正好铺满；右栏小块和看板按图相对原大的比例拍
 * （不小于 MIN_SCALE），字号和图上的字对得上。
 *
 * 前置只有一样：一个带 DevTools 端口的 Chrome（`node tests/lib/cdp-chrome-launch.mjs 9222`）。
 * usage: node --experimental-strip-types tests/readme-shots.mjs [zh|en]
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { RunService } from '../src/host/runs/service.ts'
import { bootToCanvas } from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'
import { installShotsCookie, SHOTS_SESSION_TITLE, startShotsEnv } from './support/shots-env.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DATA_DIR = join(HERE, 'runs', 'review-data')
/** 夹具会话的标题（`enterSession` 按它搜会话，不靠"列表里显示几分钟前"）。 */
const SESSION_TITLE = SHOTS_SESSION_TITLE
/** 夹具会话的工作区；`startShotsEnv` 可能认领到别处（见 `prepareShotsFixture`），以它返回的为准。 */
let WORKSPACE = join(HERE, 'runs', 'readme-ws')
/** 那个目录是不是**上一次**留下的（认领来的）。是的话收尾时不许删它。 */
let ADOPTED_WORKSPACE = false
/**
 * 截图专用的 DSH 家目录：profile、会话库、工作区库、投影缓存全在它底下。
 *
 * 会话与工作区是**全局**的（按 `DSH_HOME` 算，不按 profile 隔离），所以必须另外给一个家，
 * 否则那条"封面夹具"会永久留在用户自己的侧栏里。每次跑前清空、跑完删掉——
 * 从零开始跑出来的东西才叫幂等，夹具会话每跑一次都是新的，假模型也每次都能被证明答过话。
 */
const SHOTS_HOME = join(HERE, 'runs', 'shots-home')
const LANGS = process.argv[2] === undefined ? ['zh', 'en'] : [process.argv[2]]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 封面出图的像素比（同 `tests/readme-hero.mjs`）。 */
const SCALE = 2
/** 封面里工作流的图有多宽（CSS 像素，`hero.html` 里 `.frame` 的内宽）。 */
const GRAPH_WIDTH = 974
/** 第三段下半截：两列间距、外边距——左列放右栏小块，右边的看板按剩下的宽度拍。 */
const DETAIL_GAP = 20
const DETAIL_PAD = 20
/** 右栏小块、看板在封面里最小按原大的几成摆。 */
const MIN_SCALE = 0.85

/** 两种语言的示例：工作流、实例的目标与各步摘要、看板、界面上要点的按钮。 */
const COPY = {
  zh: {
    name: '代码审查循环',
    browser: ['zh-CN', 'zh'],
    ask: { question: '这次要改哪个模块？', placeholder: '例如 auth/' },
    spec: { label: '需求与规范', description: '实现和审查都要对照' },
    steps: {
      implement: ['实现', '按需求改代码、补测试', '按需求与规范实现这次改动，并补测试。'],
      review: ['审查', '独立检查，给出通过与否', '独立审查这次改动，对照规范给出 pass 或 fail。'],
      fix: ['修复', '按审查意见逐条修', '按 review.md 逐条修复，修完交回审查。'],
      report: ['汇总', '写给人看的结论', '汇总这次改了什么、为什么、还剩什么风险。'],
    },
    notes: {
      review: '问题清单，逐条可改',
      dashboard: '每轮审查后重新生成',
    },
    goal: '给 auth/ 加上 token 刷新的重试',
    summary: {
      implement: '抽出 refreshWithRetry，指数退避三次；补了 6 个单测。',
      fix: '修了审查提的两条：退避上限、并发刷新只发一次。',
      reviewFail: '退避没有上限；并发刷新会发多次',
    },
    dashboard: {
      lang: 'zh-CN',
      title: '代码审查循环 · 看板',
      sub: '第 2 轮审查进行中 · 更新于 10:25',
      cards: [
        ['当前轮次', '2 / 3', '最多三轮', 'blue'],
        ['上轮结论', '未通过', '2 个问题', 'red'],
        ['问题修复', '2 / 2', '已全部修完', 'green'],
        ['单元测试', '6 通过', '新增 6 个', 'green'],
      ],
      rounds: ['第 1 轮', '第 2 轮', '第 3 轮'],
      head: ['轮次', '结论', '问题', '用时'],
      rows: [
        ['第 1 轮', ['red', '未通过'], '退避没有上限；并发刷新会发多次', '5 分钟'],
        ['第 2 轮', ['blue', '审查中'], '—', '进行中'],
      ],
    },
    aria: {
      collapseSidebar: '收起侧边栏',
      expandSidebar: '打开侧边栏',
      collapseLibrary: '收起步骤库',
    },
  },
  en: {
    name: 'code-review-loop',
    browser: ['en-US', 'en'],
    ask: { question: 'Which module should change?', placeholder: 'e.g. auth/' },
    spec: { label: 'Spec & guidelines', description: 'Checked by implement and review' },
    steps: {
      implement: [
        'Implement',
        'Change the code, add tests',
        'Implement the change following the spec and add tests.',
      ],
      review: [
        'Review',
        'Independent check, pass or fail',
        'Review this change against the spec and answer pass or fail.',
      ],
      fix: [
        'Fix',
        'Address review comments',
        'Fix every item in review.md, then hand back to review.',
      ],
      report: [
        'Report',
        'Summary for people',
        'Summarize what changed, why, and the remaining risks.',
      ],
    },
    notes: {
      review: 'Issues, one per line',
      dashboard: 'Regenerated after each review',
    },
    goal: 'Add retry to auth/ token refresh',
    summary: {
      implement: 'Extracted refreshWithRetry with 3 exponential backoffs; added 6 unit tests.',
      fix: 'Fixed both review items: capped the backoff, deduplicated concurrent refreshes.',
      reviewFail: 'No backoff cap; refreshes fire twice',
    },
    dashboard: {
      lang: 'en',
      title: 'code-review-loop · Dashboard',
      sub: 'Review round 2 in progress · updated 10:25',
      cards: [
        ['Round', '2 / 3', 'Max 3 rounds', 'blue'],
        ['Last verdict', 'Fail', '2 issues', 'red'],
        ['Issues fixed', '2 / 2', 'All addressed', 'green'],
        ['Unit tests', '6 passed', '6 added', 'green'],
      ],
      rounds: ['Round 1', 'Round 2', 'Round 3'],
      head: ['Round', 'Verdict', 'Issues', 'Time'],
      rows: [
        ['Round 1', ['red', 'Fail'], 'No backoff cap; refreshes fire twice', '5 min'],
        ['Round 2', ['blue', 'Reviewing'], '—', 'running'],
      ],
    },
    aria: {
      collapseSidebar: 'Collapse sidebar',
      expandSidebar: 'Open sidebar',
      collapseLibrary: 'Collapse library',
    },
  },
}

const edge = (s, t, when) => ({
  id: when === undefined ? `${s}->${t}` : `${s}->${t}#${when}`,
  source: s,
  target: t,
  sourceHandle: null,
  targetHandle: null,
  ...(when === undefined ? {} : { data: { when } }),
})

/** 示例只留四步：图越窄，封面里的字越大。 */
function documentFor(copy) {
  const step = (id) => {
    const [label, description, prompt] = copy.steps[id]
    return { id, type: 'wfNode', position: { x: 0, y: 0 }, data: { label, description, prompt } }
  }
  const res = (id, data) => ({ id, type: 'wfResource', position: { x: 0, y: 0 }, data })
  const file = (value, note) => ({ items: [{ kind: 'file', value, note }] })
  return {
    nodes: [
      {
        id: 'ask-module',
        type: 'wfInput',
        position: { x: 0, y: 0 },
        data: { ...copy.ask, required: true },
      },
      res('spec', {
        ...copy.spec,
        items: [
          { kind: 'file', value: 'docs/spec.md' },
          { kind: 'url', value: 'https://example.com/style-guide' },
        ],
      }),
      step('implement'),
      step('review'),
      res('notes', file('review.md', copy.notes.review)),
      res('dashboard', file('dashboard.html', copy.notes.dashboard)),
      step('fix'),
      step('report'),
    ],
    edges: [
      edge('ask-module', 'implement'),
      edge('spec', 'implement'),
      edge('spec', 'review'),
      edge('implement', 'review'),
      edge('review', 'report', 'pass'),
      edge('review', 'fix', 'fail'),
      edge('review', 'notes'),
      edge('review', 'dashboard'),
      edge('notes', 'fix'),
      edge('fix', 'review'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { runState: true },
  }
}

/** 实现做完，第一轮审查没通过，修完了，第二轮审查进行中。 */
function fillState(state, copy) {
  const at = (m) => `2026-10-06T10:${String(m).padStart(2, '0')}:00+08:00`
  const done = (start, end, summary) => ({
    status: 'done',
    round: 1,
    startedAt: at(start),
    finishedAt: at(end),
    by: 'subagent',
    summary,
  })
  state.status = 'running'
  state.nodes.implement = done(0, 11, copy.summary.implement)
  state.nodes.fix = done(18, 24, copy.summary.fix)
  state.nodes.review = { status: 'running', round: 2, startedAt: at(25), by: 'subagent' }
  state.log = [
    { at: at(0), node: 'implement', event: 'start' },
    { at: at(11), node: 'implement', event: 'done' },
    { at: at(12), node: 'review', event: 'start', round: 1 },
    {
      at: at(17),
      node: 'review',
      event: 'done',
      round: 1,
      verdict: 'fail',
      detail: copy.summary.reviewFail,
    },
    { at: at(18), node: 'fix', event: 'start' },
    { at: at(24), node: 'fix', event: 'done' },
    { at: at(25), node: 'review', event: 'start', round: 2 },
  ]
}

/** 示例看板：审查步骤每轮重新生成的单文件 HTML（暗底，顶部几张汇总卡、轮次进度、每轮一行）。 */
function dashboardHtml(d) {
  const tone = { blue: '#4d94ff', red: '#ff7a66', green: '#3ecf8e', gray: '#3a4556' }
  const cards = d.cards
    .map(
      ([label, value, hint, color]) =>
        `<div class="card"><span>${label}</span><b style="color:${tone[color]}">${value}</b><i>${hint}</i></div>`,
    )
    .join('')
  const segs = ['red', 'blue', 'gray']
    .map(
      (color, i) =>
        `<div class="seg"><em style="background:${tone[color]}"></em>${d.rounds[i]}</div>`,
    )
    .join('')
  const rows = d.rows
    .map(
      ([round, [color, verdict], issues, time]) =>
        `<tr><td class="nowrap">${round}</td><td><span class="tag" style="color:${tone[color]};background:${tone[color]}22">${verdict}</span></td><td>${issues}</td><td class="dim nowrap">${time}</td></tr>`,
    )
    .join('')
  return `<!doctype html><html lang="${d.lang}"><head><meta charset="utf-8"><style>
body{margin:0;padding:20px 22px;background:#0f141c;color:#e6ebf3;font:13px/1.5 "Microsoft YaHei UI","PingFang SC",system-ui,sans-serif}
h1{margin:0;font-size:16px;font-weight:650}
.sub{margin:2px 0 14px;color:#8a97ab;font-size:12px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.card{display:flex;flex-direction:column;gap:1px;padding:9px 11px;border:1px solid #232c3a;border-radius:10px;background:#151c27}
.card span{color:#8a97ab;font-size:11.5px}.card b{font-size:19px;font-weight:700;white-space:nowrap}.card i{color:#6f7d92;font-size:11.5px;font-style:normal}
.segs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0 12px}
.seg{color:#8a97ab;font-size:11.5px}.seg em{display:block;height:5px;margin-bottom:4px;border-radius:3px}
table{width:100%;border-collapse:collapse}
th{padding:6px 8px;border-bottom:1px solid #232c3a;color:#6f7d92;font-size:11.5px;font-weight:500;text-align:left}
td{padding:9px 8px;border-bottom:1px solid #1b2330;vertical-align:top}
.tag{padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}.dim{color:#8a97ab}.nowrap{white-space:nowrap}
</style></head><body><h1>${d.title}</h1><p class="sub">${d.sub}</p><div class="cards">${cards}</div>
<div class="segs">${segs}</div><table><tr>${d.head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows}</table></body></html>
`
}

/** 截一块区域（按当前的设备像素比）。 */
async function capture(session, box, file) {
  const { data } = await session.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...box, scale: 1 },
  })
  await writeFile(file, Buffer.from(data, 'base64'))
}

/** 图上所有卡片、连线、线上标签的外框再留一圈边（回边会绕到卡片外面）。 */
const graphBox = `(() => {
  const parts = document.querySelectorAll('.react-flow__node, .react-flow__edge-path, .react-flow__edgelabel-renderer > *')
  const rects = [...parts].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0)
  const pad = 18
  const left = Math.min(...rects.map((r) => r.left)) - pad
  const top = Math.min(...rects.map((r) => r.top)) - pad - 14
  const right = Math.max(...rects.map((r) => r.right)) + pad
  const bottom = Math.max(...rects.map((r) => r.bottom)) + pad
  return { x: left, y: top, width: right - left, height: bottom - top }
})()`

/** 右栏「概览」里的执行位置：正在执行、最后执行的是哪一步（「说明」前面那一段）。 */
const positionBox = `(() => {
  const panel = document.querySelector('[data-testid="wl-run-panel"]').getBoundingClientRect()
  const note = document.querySelector('[data-testid="wl-run-note"]').closest('section')
  const section = note.previousElementSibling.getBoundingClientRect()
  return { x: panel.left, y: section.top - 12, width: panel.width, height: section.height + 18 }
})()`

/** 右栏「概览」里的时间线：标题加最近的几条。 */
const timelineBox = `(() => {
  const panel = document.querySelector('[data-testid="wl-run-panel"]').getBoundingClientRect()
  const list = document.querySelector('[data-testid="wl-run-timeline"]')
  const top = list.closest('section').getBoundingClientRect().top - 10
  const items = [...list.children]
  // 裁到第 6 条的上沿（只有 5 条以内就到最后一条下面留一点边），不露半截。
  const bottom = items[5]?.getBoundingClientRect().top ?? items[items.length - 1].getBoundingClientRect().bottom + 10
  return { x: panel.left, y: top, width: panel.width, height: bottom - top }
})()`

/** 查看框整块（标题行加正文）。 */
const viewerBox = `(() => {
  const r = document.querySelector('[data-testid="wl-file-viewer"]').getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
})()`

const clickAria = (label) => `document.querySelector('button[aria-label="${label}"]')?.click()`
const clickTestId = (testId) => `document.querySelector('[data-testid="${testId}"]')?.click()`

async function shoot(session, lang) {
  const copy = COPY[lang]
  const out = join(HERE, 'runs', 'hero', lang)
  await mkdir(out, { recursive: true })
  const metrics = (width, height, deviceScaleFactor = SCALE) =>
    session.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
    })
  /**
   * 工作流的图：按封面里的宽度换算像素比再拍，素材一个像素对封面一个像素。
   * 返回图在封面里相对界面原大的比例（画布缩放 × 封面里的缩放），右栏小块和看板按同一比例拍，字号对得上。
   */
  const shootGraph = async (width, height, file) => {
    const box = await session.evaluate(graphBox)
    const zoom = await session.evaluate(
      `new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a`,
    )
    await metrics(width, height, (SCALE * GRAPH_WIDTH) / box.width)
    await sleep(800)
    await capture(session, await session.evaluate(graphBox), file)
    await metrics(width, height)
    await sleep(400)
    return (GRAPH_WIDTH / box.width) * zoom
  }

  // 浏览器语言：DSH 没存过语言偏好时按它选界面语言。
  await session.send('Emulation.setLocaleOverride', { locale: copy.browser[0] })
  const { identifier } = await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(copy.browser)} });
      Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(copy.browser[0])} });`,
  })

  let instance = null
  try {
    await rpc('graph/delete', { name: copy.name }).catch(() => {})
    await rpc('graph/create', { name: copy.name })
    const disk = await rpc('graph/load', { name: copy.name })
    await rpc('graph/save', { name: copy.name, document: documentFor(copy), baseHash: disk.hash })

    await bootToCanvas(session, copy.name, {
      width: 1500,
      height: 820,
      lang,
      // 夹具自己 rename 出来的固定标题：按它搜会话进去，不靠"列表里显示几分钟前"
      sessionTitle: SESSION_TITLE,
    })
    await session.evaluate(clickAria(copy.aria.collapseSidebar))
    await sleep(600)
    await session.evaluate(clickAria(copy.aria.collapseLibrary))
    await sleep(400)
    await session.evaluate(clickTestId('wl-tidy'))
    await sleep(1500)
    await metrics(1500, 820)
    await sleep(500)
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(1000)
    const graphScale = await shootGraph(1500, 820, join(out, 'canvas.png'))
    // 小块按图的比例拍，但不小于 MIN_SCALE：再小就看不清了。
    const shotScale = Math.min(1, Math.max(MIN_SCALE, graphScale))
    console.log(
      `  ${lang}：图在封面里是原大的 ${graphScale.toFixed(2)}，小块按 ${shotScale.toFixed(2)} 拍`,
    )
    const plan = await rpc('plan/build', {
      name: copy.name,
      goal: copy.goal,
      cwd: '~/projects/shop',
    })
    await writeFile(join(out, 'plan.txt'), plan.plan)

    // 实例：状态写好后从工作流中心打开它。
    await mkdir(WORKSPACE, { recursive: true })
    const runs = new RunService({ dataDir: () => DATA_DIR, validate: () => [] })
    const prepared = await runs.prepare({
      workflow: copy.name,
      document: (await rpc('graph/load', { name: copy.name })).document,
      session: { id: 'readme-session', cwd: WORKSPACE },
      goal: copy.goal,
    })
    if (!prepared.ok) throw new Error(JSON.stringify(prepared))
    instance = prepared.result.id
    const state = parse(await readFile(prepared.result.statePath, 'utf8'))
    fillState(state, copy)
    await writeFile(prepared.result.statePath, stringify(state, { lineWidth: 0 }))
    // 看板是审查步骤的产出：没配产出根目录时落在实例自己的 out 目录。
    const produced = join(WORKSPACE, '.workflow-lite', 'runs', instance, 'out')
    await mkdir(produced, { recursive: true })
    await writeFile(join(produced, 'dashboard.html'), dashboardHtml(copy.dashboard))

    const view = `[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-view"]`
    await session.evaluate(clickTestId('wl-hub-open'))
    await waitFor(session, `document.querySelector('${view}') !== null`)
    await session.evaluate(`document.querySelector('${view}').click()`)
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`,
    )
    await sleep(2500)
    // 视口拉高：右栏的概览、时间线整段都在屏幕里。
    await metrics(1500, 1400)
    await sleep(600)
    if (
      !(await session.evaluate(
        `document.querySelector('[data-testid="wl-run-timeline"]') !== null`,
      ))
    ) {
      await session.evaluate(clickTestId('wl-run-panel-toggle'))
    }
    await waitFor(session, `document.querySelector('[data-testid="wl-run-timeline"]') !== null`)
    await sleep(600)
    const position = await session.evaluate(positionBox)
    const timeline = await session.evaluate(timelineBox)
    await metrics(1500, 1400, SCALE * shotScale)
    await sleep(600)
    await capture(session, position, join(out, 'run-position.png'))
    await capture(session, timeline, join(out, 'run-timeline.png'))
    await metrics(1500, 1400)
    await sleep(400)
    // 收起右栏：整张图按状态点亮的样子。
    await session.evaluate(clickTestId('wl-run-panel-close'))
    await sleep(500)
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(1200)
    await shootGraph(1500, 1400, join(out, 'run-graph.png'))

    // 看板：点开资源卡，在查看框里看页面。查看框随视口变：宽度对上封面里看板那一列，高度对上左列两小块叠起来。
    await session.evaluate(
      `document.querySelector('.react-flow__node[data-id="dashboard"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
    )
    await waitFor(session, `document.querySelector('[data-testid="wl-run-item-view"]') !== null`)
    await session.evaluate(clickTestId('wl-run-item-view'))
    await waitFor(session, `document.querySelector('[data-testid="wl-viewer-frame"]') !== null`)
    // 框的最小高度是给长页面留的；这页不长，让它跟着查看框走，不出滚动条。
    await session.evaluate(
      `document.querySelector('[data-testid="wl-viewer-frame"]').style.minHeight = '0'`,
    )
    const boardWidth =
      GRAPH_WIDTH - DETAIL_PAD * 2 - Math.ceil(position.width * shotScale) - DETAIL_GAP
    const boardHeight = Math.round((position.height + timeline.height) * shotScale + 14)
    // 查看框按「那一列的宽度 ÷ 小块的比例」摆，再按同一比例拍：字号和左列一致，仍是一个像素对一个像素。
    // 查看框的大小跟着插件区域走（比视口窄一截、矮一截）：先试一次，再按差值补上。
    const viewerWidth = boardWidth / shotScale
    await metrics(Math.round(viewerWidth + 48), 700)
    await sleep(500)
    const probe = await session.evaluate(viewerBox)
    const viewport = {
      width: Math.round(viewerWidth + 48 + viewerWidth - probe.width),
      height: Math.round(700 + boardHeight / shotScale - probe.height),
    }
    await metrics(viewport.width, viewport.height, SCALE * shotScale)
    await sleep(1200)
    await capture(session, await session.evaluate(viewerBox), join(out, 'run-dashboard.png'))
    await session.evaluate(
      `document.querySelector('[data-testid="wl-file-viewer"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    )
    await sleep(300)
    await metrics(1500, 820)

    // 侧栏、步骤库的开合记在浏览器里：放回去，别影响后面的验收脚本。
    await session.evaluate(clickAria(copy.aria.expandSidebar))
    await session.evaluate(`localStorage.setItem('workflow-lite.library', 'open')`)
    if (session.errors.length > 0) throw new Error(`页面报错：${JSON.stringify(session.errors)}`)
    console.log(`✅ ${lang}：素材已写到 tests/runs/hero/${lang}/`)
  } finally {
    await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    await session.send('Emulation.setLocaleOverride', {})
    if (instance !== null)
      await rpc('run/delete', { id: instance, withState: true }).catch(() => {})
    await rpc('graph/delete', { name: copy.name }).catch(() => {})
    // 只在**这一次**建出来的目录上删。夹具会认领上一次留下的工作区（会话跟着它的 cwd 走），
    // 那条路径可能来自很早以前、甚至仓库搬过家之前——对别人的目录动 rm -rf 是另一回事。
    // 删失败也不该把 finally 剩下的收尾带下去，所以吞掉。
    if (!ADOPTED_WORKSPACE) await rm(WORKSPACE, { recursive: true, force: true }).catch(() => {})
  }
}

// 一开始就拦：写错一个字母（`pnpm run hero fr`）不该等到深处才以
// "Cannot read properties of undefined" 的面目炸出来，那时候语言覆盖已经打上了。
for (const lang of LANGS) {
  if (!Object.hasOwn(COPY, lang)) {
    throw new Error(`不认识的语言 ${lang}；只能给 ${Object.keys(COPY).join(' / ')}`)
  }
}
// 这个临时的家要**从零**开始：上一次的夹具会话、工作区、投影缓存一条都不留。
await rm(SHOTS_HOME, { recursive: true, force: true })
const env = await startShotsEnv({ dataDir: DATA_DIR, workspaceDir: WORKSPACE, home: SHOTS_HOME })
WORKSPACE = env.workspaceDir
ADOPTED_WORKSPACE = env.adoptedWorkspace
// `openPage()` 放在 try 里面：Chrome 没开、没有 page target 是常事，那一下要是抛在外面，
// 实例和假模型就留在后台了。
let session
try {
  session = await openPage()
  await installShotsCookie(session, env.base, env.cookie)
  for (const lang of LANGS) await shoot(session, lang)
} finally {
  session?.close()
  await env.stop()
  await rm(SHOTS_HOME, { recursive: true, force: true }).catch(() => {})
}
