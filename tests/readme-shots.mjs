/**
 * 拍 README 封面图的素材（中文、英文各一套），封面由 `tests/readme-hero.mjs` 排版出图。
 *
 * **自备环境**：自己起一个假模型、一个截图专用 profile 和一个随机端口的实例，备好夹具会话，
 * 拍完拆掉。不依赖"已经有一台 dsh web 在 3190 上跑着"，也不发真实模型请求——封面拍的是
 * 准备好的数据，不是当时机器上的状态。
 *
 * 每种语言：把浏览器语言设成那种语言（DSH 与插件界面跟着变），在实例里建示例工作流「代码审查循环」，
 * 拍到 `tests/runs/hero/<lang>/`：编辑页的图（canvas.png）、编译出的计划（plan.txt）、
 * 一个实例按状态点亮的图（run-graph.png，看板直接展示在画布上；封面第三段只用它）、右栏的两小块（run-position.png 执行位置、
 * run-timeline.png 时间线）与查看框里打开的看板完整版（run-dashboard.png），后三张给介绍视频备用。拍完删掉示例工作流和实例，把浏览器语言、侧栏、步骤库都放回去。
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
import { BOARD_SCRIPT, BOARD_STYLE } from '../src/host/boardSkill.ts'
import { RunService } from '../src/host/runs/service.ts'
import { addGlobalMemory } from '../src/shared/presets.ts'
import { bootToCanvas, mouseClick, mouseMove, revealHubRow } from './lib/canvas-harness.mjs'
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
/**
 * 是否另拍一套**整屏界面**（`SHOTS_FULL=1`）。
 *
 * 封面要的是"图上所有卡片和连线"那一块（`graphBox` 裁出来的），所以 canvas.png 是个宽扁的条。
 * 介绍视频要的是**整个界面**——侧栏、步骤库、画布、右栏都在，所以这个开关把整屏图（1920×1080）
 * 写进主名 `canvas.png` / `run-graph.png`，裁出来那条改叫 `canvas-graph.png` / `run-graph-crop.png`；
 * 小块与看板另用 `clip.scale` 把出图像素补到 1920 以上。默认关，不改原行为。
 */
const FULL = process.env.SHOTS_FULL === '1'
/** 封面里工作流的图有多宽（CSS 像素，`hero.html` 里 `.frame` 的内宽）。 */
const GRAPH_WIDTH = 974
/** 第三段下半截：两列间距、外边距——左边放右栏的时间线，右边的看板按剩下的宽度拍。 */
const DETAIL_GAP = 16
const DETAIL_PAD = 16
/** 第三段画布上展示的看板卡片多大（画布像素，网页的中档）。 */
const BOARD_VIEW = { width: 320, height: 176 }
/** 右栏小块、看板在封面里最小按原大的几成摆：再小，GitHub 把封面缩到 880 宽显示时字就糊了。 */
const MIN_SCALE = 1

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
    memory: { id: 'review-lessons', name: '审查经验', description: '常见问题与最省事的审查走法' },
    goal: '给 auth/ 加上 token 刷新的重试',
    summary: {
      implement: '抽出 refreshWithRetry，指数退避三次；补了 6 个单测。',
      fix: '修了审查提的两条：退避上限、并发刷新只发一次。',
      reviewFail: '退避没有上限；并发刷新会发多次',
    },
    // 画布上的看板（照 workflow-board 的模板写）：卡片版回答「这次改动离合进去还差什么」。
    board: {
      lang: 'zh-CN',
      head: '第 2 轮',
      badge: '审查中',
      ring: ['2/2', '问题已修'],
      stats: [
        ['轮次', '2<span class="u">/3</span>', ''],
        ['单元测试', '6<span class="u">通过</span>', 'ok'],
        ['上轮问题', '2', 'bad'],
      ],
      meter: ['覆盖率', '87%'],
      title: '代码审查循环 · 第 2 轮',
      sub: 'auth/ token 刷新重试 · 更新于 10:25',
      kpis: [
        ['轮次', '2 / 3', '最多三轮', ''],
        ['上轮结论', '未通过', '2 个问题', 'bad'],
        ['问题修复', '2 / 2', '已全部修完', 'ok'],
        ['单元测试', '6', '新增 6 个', 'ok'],
      ],
      steps: ['实现', '审查', '修复', '复审', '汇总'],
      stepsTitle: '阶段',
      issuesTitle: '上轮问题',
      issues: [
        ['退避没有上限', '已修'],
        ['并发刷新会发多次', '已修'],
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
    memory: {
      id: 'review-lessons',
      name: 'Review lessons',
      description: 'Common issues and the quickest way to review',
    },
    goal: 'Add retry to auth/ token refresh',
    summary: {
      implement: 'Extracted refreshWithRetry with 3 exponential backoffs; added 6 unit tests.',
      fix: 'Fixed both review items: capped the backoff, deduplicated concurrent refreshes.',
      reviewFail: 'No backoff cap; refreshes fire twice',
    },
    board: {
      lang: 'en',
      head: 'Round 2',
      badge: 'Reviewing',
      ring: ['2/2', 'fixed'],
      stats: [
        ['Round', '2<span class="u">/3</span>', ''],
        ['Tests', '6<span class="u">pass</span>', 'ok'],
        ['Last issues', '2', 'bad'],
      ],
      meter: ['Coverage', '87%'],
      title: 'code-review-loop · round 2',
      sub: 'Retry for auth/ token refresh · updated 10:25',
      kpis: [
        ['Round', '2 / 3', 'Max 3 rounds', ''],
        ['Last verdict', 'Fail', '2 issues', 'bad'],
        ['Issues fixed', '2 / 2', 'All addressed', 'ok'],
        ['Unit tests', '6', '6 added', 'ok'],
      ],
      steps: ['Implement', 'Review', 'Fix', 'Re-review', 'Report'],
      stepsTitle: 'Stage',
      issuesTitle: 'Last round',
      issues: [
        ['No backoff cap', 'fixed'],
        ['Refresh fires twice', 'fixed'],
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
  const base = {
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
  // 全局记忆：一张不连步骤的记忆卡，每个步骤开始前都会读它。
  return addGlobalMemory(base, { memory: copy.memory.id, type: 'workflow' }, { x: 0, y: 0 })
    .document
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

/**
 * 画布上展示的看板：照 skill `workflow-board` 的模板写（样式、脚本取插件里的同一份），卡片里显示卡片版、
 * 点开显示完整版，颜色跟着画布主题。
 */
function boardHtml(b) {
  const stats = b.stats
    .map(([label, value, tone], i) => {
      const drop = i === b.stats.length - 1 ? ' data-drop="1"' : ''
      return `<div${drop}><dt>${label}</dt><dd class="num ${tone}">${value}</dd></div>`
    })
    .join('')
  const kpis = b.kpis
    .map(
      ([label, value, hint, tone]) =>
        `<div class="kpi"><span>${label}</span><b class="num ${tone}">${value}</b><small>${hint}</small></div>`,
    )
    .join('')
  const steps = b.steps
    .map(
      (name, i) => `<li class="${i < 3 ? 'done' : i === 3 ? 'now' : ''}"><span>${name}</span></li>`,
    )
    .join('')
  const issues = b.issues
    .map(([text, state]) => `<li class="ok"><span>${text}</span><b>${state}</b></li>`)
    .join('')
  return `<!doctype html>
<html lang="${b.lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${b.title}</title>
${BOARD_STYLE}
</head>
<body>
  <section class="card-view">
    <div class="card-head"><h1>${b.head}</h1><span class="badge info">${b.badge}</span></div>
    <div class="card-body">
      <div class="main">
        <div class="ring ok"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="15.5"/><circle class="arc" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="100 100"/></svg><div><b class="num">${b.ring[0]}</b><span>${b.ring[1]}</span></div></div>
      </div>
      <div class="side">
        <dl class="stats">${stats}</dl>
        <div class="meter ok" data-drop="2"><div><span>${b.meter[0]}</span><b class="num">${b.meter[1]}</b></div><i style="--v: 87%; --goal: 80%"></i></div>
      </div>
    </div>
  </section>
  <main class="full-view">
    <header><div><h1>${b.title}</h1><div class="sub">${b.sub}</div></div><span class="badge info">${b.badge}</span></header>
    <div class="kpis">${kpis}</div>
    <div class="grid">
      <section><h2>${b.stepsTitle}</h2><ol class="steps">${steps}</ol></section>
      <section><h2>${b.issuesTitle}</h2><ul class="list">${issues}</ul></section>
    </div>
  </main>
${BOARD_SCRIPT}
</body>
</html>
`
}

/** 截一块区域（按当前的设备像素比）。`density` 再乘一层出图像素（`clip.scale` 是重新光栅化，不是放大位图）。 */
async function capture(session, box, file, density = 1) {
  const { data } = await session.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...box, scale: density },
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

/** 右栏「概览」里的时间线：标题加全部几条（夹具只记了 7 条，正好是一整圈循环）。 */
const timelineBox = `(() => {
  const panel = document.querySelector('[data-testid="wl-run-panel"]').getBoundingClientRect()
  const list = document.querySelector('[data-testid="wl-run-timeline"]')
  const top = list.closest('section').getBoundingClientRect().top - 10
  const items = [...list.children]
  const bottom = items[items.length - 1].getBoundingClientRect().bottom + 10
  return { x: panel.left, y: top, width: panel.width, height: bottom - top }
})()`

/** 查看框整块（标题行加正文）。 */
const viewerBox = `(() => {
  const r = document.querySelector('[data-testid="wl-file-viewer"]').getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
})()`

/** 两张卡的外框（视口坐标；资源卡取卡面，不算角标）；`handle` 是左边那个把手的左缘，对齐用它。 */
const cardRects = (a, b) => `(() => {
  const rect = (id) => {
    const node = document.querySelector('.react-flow__node[data-id="' + id + '"]')
    const box = (node.querySelector('[data-testid="wl-resource"]') ?? node).getBoundingClientRect()
    const handle = node.querySelector('.react-flow__handle.target')?.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width, height: box.height, handle: handle?.left ?? box.left }
  }
  return [rect(${JSON.stringify(a)}), rect(${JSON.stringify(b)})]
})()`

/**
 * 真指针拖一张卡：从卡片中心按下，分几步移到 `(dx, dy)` 之外再松开（和用户手上的拖一样）。
 * 画布要先挪过一小段（`nodeDragThreshold`）才算开始拖，这一段不计入位移：先单独走一步，终点再补上它。
 */
async function dragCard(session, id, dx, dy) {
  const [box] = await session.evaluate(cardRects(id, id))
  const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  const start = { x: from.x + 4, y: from.y + 4 }
  const move = (x, y) =>
    session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'left',
      buttons: 1,
    })
  await mouseMove(session, from)
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await move(start.x, start.y)
  for (let step = 1; step <= 10; step += 1) {
    await move(start.x + (dx * step) / 10, start.y + (dy * step) / 10)
  }
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: start.x + dx,
    y: start.y + dy,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
}

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
    await rpc('memory/delete', { id: copy.memory.id }).catch(() => {})
    await rpc('memory/create', { type: 'workflow', ...copy.memory })
    const disk = await rpc('graph/load', { name: copy.name })
    await rpc('graph/save', { name: copy.name, document: documentFor(copy), baseHash: disk.hash })

    await bootToCanvas(session, copy.name, {
      width: 1500,
      height: 820,
      lang,
      // 夹具自己 rename 出来的固定标题：按它搜会话进去，不靠"列表里显示几分钟前"
      sessionTitle: SESSION_TITLE,
    })
    // 整屏那套要**侧栏和步骤库都在**：趁还没收起，先排好版按 1920×1080 拍一张。
    // `FULL` 时 canvas.png 就是这张整屏图（视频要的是"画布编辑页"整屏，不是裁出来的窄条）；
    // 裁出来那张改叫 canvas-graph.png，仓库里照样留一份。
    if (FULL) {
      await session.evaluate(clickAria(copy.aria.expandSidebar))
      await session.evaluate(clickTestId('wl-tidy'))
      await sleep(1500)
      await metrics(1920, 1080)
      await sleep(600)
      await session.evaluate(clickTestId('wl-fit'))
      await sleep(1200)
      await capture(session, { x: 0, y: 0, width: 1920, height: 1080 }, join(out, 'canvas.png'))
      await metrics(1500, 820)
      await sleep(400)
    }
    await session.evaluate(clickAria(copy.aria.collapseSidebar))
    await sleep(600)
    await session.evaluate(clickAria(copy.aria.collapseLibrary))
    await sleep(400)
    // 整理版面：整理会把没连任何步骤的全局记忆卡排在版面下方、比别的卡更靠左，拖到「需求与规范」正下面，和它左对齐。
    const tidy = async () => {
      await session.evaluate(clickTestId('wl-tidy'))
      await sleep(1500)
      await metrics(1500, 820)
      await sleep(500)
      await session.evaluate(clickTestId('wl-fit'))
      await sleep(1000)
      const [spec, memory] = await session.evaluate(cardRects('spec', 'mem-global'))
      await dragCard(
        session,
        'mem-global',
        spec.handle - memory.handle,
        spec.top + spec.height + 28 - memory.top,
      )
      await sleep(800)
      // 拖完这张卡是选中的、右栏也开了：点卡片下面的空白处，选中和右栏一起收起。
      const [, dropped] = await session.evaluate(cardRects('spec', 'mem-global'))
      await mouseClick(session, { x: dropped.left + 20, y: dropped.top + dropped.height + 70 })
      await sleep(800)
      await session.evaluate(clickTestId('wl-fit'))
      await sleep(1000)
    }
    await tidy()
    const graphScale = await shootGraph(
      1500,
      820,
      join(out, FULL ? 'canvas-graph.png' : 'canvas.png'),
    )
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

    // 计划对话框整块（标题行 + 正文）：介绍视频要的是"编译出来的计划"长什么样。
    if (FULL) {
      // 对话框宽度封顶 900 CSS px（`overlay.module.css` 的 `.dialog`），2 倍只有 1800 宽。
      // 视频要 1920 以上，所以这里把像素比提到 2.2（**只改密度、不改排版**），拍到 1980 宽。
      await metrics(1920, 1080, 2.2)
      await sleep(500)
      await session.evaluate(clickTestId('wl-preview'))
      await waitFor(session, `document.querySelector('[data-testid="wl-plan"]') !== null`)
      await waitFor(session, `document.querySelector('[data-testid="wl-plan-text"]') !== null`, {
        timeoutMs: 30_000,
      })
      await sleep(1200)
      await capture(
        session,
        await session.evaluate(`(() => {
          const r = document.querySelector('[data-testid="wl-plan"]').getBoundingClientRect()
          return { x: r.left, y: r.top, width: r.width, height: r.height }
        })()`),
        join(out, 'plan.png'),
      )
      // 「给人看」那一版：提示词内联，通读用。拍一张给视频当备选（模型版里有一列很长的本机绝对路径）。
      await session.evaluate(`(() => {
        const tab = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === ${JSON.stringify(lang === 'zh' ? '给人看' : 'For people')})
        tab?.click()
      })()`)
      await sleep(1500)
      await capture(
        session,
        await session.evaluate(`(() => {
          const r = document.querySelector('[data-testid="wl-plan"]').getBoundingClientRect()
          return { x: r.left, y: r.top, width: r.width, height: r.height }
        })()`),
        join(out, 'plan-human.png'),
      )
      await session.evaluate(
        `document.querySelector('[data-testid="wl-plan"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      )
      await sleep(500)
      await metrics(1500, 820)
      await sleep(400)
    }

    // 第三段：看板直接展示在画布上。第一段拍完再给看板资源打开展示、重新整理版面，存好之后再建实例（实例按这时的图建）。
    {
      const before = await rpc('graph/load', { name: copy.name })
      const document = structuredClone(before.document)
      const board = document.nodes.find((node) => node.id === 'dashboard')
      board.data.view = { ...BOARD_VIEW }
      await rpc('graph/save', { name: copy.name, document, baseHash: before.hash })
      // 画布不跟着外部的保存刷新：重新进一次画布（侧栏、步骤库的收起记在浏览器里，不用再点）。
      await bootToCanvas(session, copy.name, {
        width: 1500,
        height: 820,
        lang,
        sessionTitle: SESSION_TITLE,
      })
      await session.evaluate(clickAria(copy.aria.collapseSidebar))
      await session.evaluate(clickAria(copy.aria.collapseLibrary))
      await waitFor(
        session,
        `document.querySelector('.react-flow__node[data-id="dashboard"] [data-display]') !== null`,
      )
      await tidy()
      await waitFor(
        session,
        `document.querySelector('[data-testid="wl-status"]')?.dataset.tone === 'saved'`,
      )
    }

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
    await writeFile(join(produced, 'dashboard.html'), boardHtml(copy.board))

    const view = `[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-view"]`
    await session.evaluate(clickTestId('wl-hub-open'))
    await revealHubRow(session, instance, WORKSPACE)
    await waitFor(session, `document.querySelector('${view}') !== null`)
    await session.evaluate(`document.querySelector('${view}').click()`)
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`,
    )
    await sleep(2500)
    // 视口拉高：右栏的概览、时间线整段都在屏幕里。视口收窄到 1000：右栏宽 `clamp(300px, 30cqw, 360px)` 落到最窄的 300，
    // 封面里右边的看板多分到宽度，查看框标题行里的文件名不被挤成省略号（再窄到 760 就成了窄屏布局，右栏收起）。
    await metrics(1000, 1400)
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
    await metrics(1000, 1400, SCALE * shotScale)
    await sleep(600)
    // 小块按原大拍，2 倍像素也只有 600 宽。视频要 1920 以上，再乘一层 `clip.scale`
    // 把出图像素补够——`clip.scale` 是重新光栅化，字不会糊（见 tests/readme-shots.mjs 的 capture）。
    const panelDensity = FULL
      ? Math.max(1, Math.ceil(1920 / (position.width * SCALE * shotScale)))
      : 1
    await capture(session, position, join(out, 'run-position.png'), panelDensity)
    await capture(session, timeline, join(out, 'run-timeline.png'), panelDensity)
    await metrics(1500, 1400)
    await sleep(400)
    // 收起右栏：整张图按状态点亮的样子。
    await session.evaluate(clickTestId('wl-run-panel-close'))
    await sleep(500)
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(1200)
    await shootGraph(1500, 1400, join(out, FULL ? 'run-graph-crop.png' : 'run-graph.png'))
    // 整屏的实例视图：右栏（执行位置 + 时间线）和画布一起进画面。
    // `FULL` 时 run-graph.png 就是这张整屏图（视频要的是实例视图整屏）。
    if (FULL) {
      await metrics(1920, 1080)
      await sleep(600)
      // 上面收过右栏（为了拍"整张图点亮"的窄条），整屏这张要把它放回来。
      if (
        (await session.evaluate(
          `document.querySelector('[data-testid="wl-run-timeline"]') !== null`,
        )) === false
      ) {
        await session.evaluate(clickTestId('wl-run-panel-toggle'))
      }
      await sleep(600)
      await session.evaluate(clickTestId('wl-fit'))
      await sleep(1200)
      await capture(session, { x: 0, y: 0, width: 1920, height: 1080 }, join(out, 'run-graph.png'))
    }

    // 看板：点开资源卡，在查看框里看页面。查看框随视口变：宽度对上封面里看板那一列，高度对上左边的时间线。
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
      GRAPH_WIDTH - DETAIL_PAD * 2 - Math.ceil(timeline.width * shotScale) - DETAIL_GAP
    const boardHeight = Math.round(timeline.height * shotScale)
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
    // 看板列本来跟着封面那一列走（1200 出头宽）。视频要 1920 以上，同样用 `clip.scale` 补密度。
    const boardBox = await session.evaluate(viewerBox)
    const boardDensity = FULL
      ? Math.max(1, Math.ceil(1920 / (boardBox.width * SCALE * shotScale)))
      : 1
    await capture(session, boardBox, join(out, 'run-dashboard.png'), boardDensity)
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
    await rpc('memory/delete', { id: copy.memory.id }).catch(() => {})
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
