/**
 * 拍文档站（`site/`）用的界面截图：自备环境（假模型、一次性的家、随机端口实例），
 * 建示例工作流和实例，逐张拍到 `tests/runs/docs/`，再转成 webp 放进 `site/src/assets/shots/`。
 *
 * 前置：一个带 DevTools 端口的 Chrome（`node tests/lib/cdp-chrome-launch.mjs 9222`），`pnpm run build` 过。
 * usage: node --experimental-strip-types tests/docs-shots.mjs [名字 ...]   不给名字就全拍。
 *        DOCS_LANG=en node --experimental-strip-types tests/docs-shots.mjs   拍英文界面（`shots/en/`）。
 *        DOCS_KEEP=1 node --experimental-strip-types tests/docs-shots.mjs run-graph   拍完留着环境（打印带令牌的地址），给人在浏览器里看。
 *
 * 环境的坑同 `tests/readme-shots.mjs`：自己一个家、夹具会话是认领来的、关实例要等真的关掉。
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { RunHistory } from '../src/host/runs/history.ts'
import { RunService } from '../src/host/runs/service.ts'
import { DATABASE_FILE, PluginDatabase } from '../src/host/store/database.ts'
import { newFireId, TriggerStore } from '../src/host/triggers/store.ts'
import { addGlobalMemory } from '../src/shared/presets.ts'
import {
  bootToCanvas,
  mouseClick,
  mouseMove,
  revealHubRow,
  setReactInput,
  viewHubRun,
} from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'
import { installShotsCookie, SHOTS_SESSION_TITLE, startShotsEnv } from './support/shots-env.mjs'

/** `DOCS_LANG=en` 拍英文界面那一套（放到 `shots/en/`，英文页引用）；默认中文。 */
const LANG = process.env.DOCS_LANG === 'en' ? 'en' : 'zh'
/** 按语言挑文字：示例内容、界面文字的选择器都走它。 */
const t = (zh, en) => (LANG === 'en' ? en : zh)
const BROWSER_LANGS = LANG === 'en' ? ['en-US', 'en'] : ['zh-CN', 'zh']
const HERE = fileURLToPath(new URL('.', import.meta.url))
const SITE = join(HERE, '..', 'site')
const DATA_DIR = join(HERE, 'runs', 'docs-data')
const SHOTS_HOME = join(HERE, 'runs', 'docs-home')
const OUT = join(HERE, 'runs', 'docs', LANG)
const ASSETS = join(SITE, 'src', 'assets', 'shots', ...(LANG === 'en' ? ['en'] : []))
let WORKSPACE = join(HERE, 'runs', 'docs-ws')
let ADOPTED_WORKSPACE = false
let instance = null
let instance2 = null
const ONLY = new Set(process.argv.slice(2))
const wants = (name) => ONLY.size === 0 || ONLY.has(name)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 出图像素比：文档正文最宽 900 CSS 像素，2 倍够清楚。 */
const DPR = 2
const NAME = t('代码审查循环', 'code-review-loop')

const edge = (s, t, when) => ({
  id: when === undefined ? `${s}->${t}` : `${s}->${t}#${when}`,
  source: s,
  target: t,
  sourceHandle: null,
  targetHandle: null,
  ...(when === undefined ? {} : { data: { when } }),
})

const STEPS = {
  implement: t(
    ['实现', '按需求改代码、补测试', '按需求与规范实现这次改动，并补测试。'],
    [
      'Implement',
      'Change the code and add tests',
      'Implement this change as the requirements and spec describe, and add tests.',
    ],
  ),
  review: t(
    ['审查', '独立检查，给出通过与否', '独立审查这次改动，对照规范给出 pass 或 fail。'],
    [
      'Review',
      'Check independently, give a verdict',
      'Review this change independently against the spec and give a verdict of pass or fail.',
    ],
  ),
  fix: t(
    ['修复', '按审查意见逐条修', '按 review.md 逐条修复，修完交回审查。'],
    [
      'Fix',
      'Fix each review point',
      'Fix each point in review.md, then hand it back to the review.',
    ],
  ),
  report: t(
    ['汇总', '写给人看的结论', '汇总这次改了什么、为什么、还剩什么风险。'],
    ['Summarise', 'A conclusion for people', 'Summarise what changed, why, and what risks remain.'],
  ),
}

/** 示例工作流：实现 → 审查 →（未通过）修复 → 审查，通过后汇总；带一个提问、一份规范、一块看板。 */
function documentFor() {
  const step = (id) => {
    const [label, description, prompt] = STEPS[id]
    return { id, type: 'wfNode', position: { x: 0, y: 0 }, data: { label, description, prompt } }
  }
  const res = (id, data) => ({ id, type: 'wfResource', position: { x: 0, y: 0 }, data })
  const base = {
    nodes: [
      {
        id: 'ask-module',
        type: 'wfInput',
        position: { x: 0, y: 0 },
        data: {
          question: t('这次要改哪个模块？', 'Which module should this change?'),
          placeholder: t('例如 auth/', 'e.g. auth/'),
          required: true,
        },
      },
      res('spec', {
        label: t('需求与规范', 'Requirements and spec'),
        description: t('实现和审查都要对照', 'Both Implement and Review check against it'),
        items: [
          { kind: 'file', value: 'docs/spec.md' },
          { kind: 'url', value: 'https://example.com/style-guide' },
        ],
      }),
      step('implement'),
      step('review'),
      res('notes', {
        items: [
          {
            kind: 'file',
            value: 'review.md',
            note: t('问题清单，逐条可改', 'The list of issues, fixable one by one'),
          },
        ],
      }),
      res('dashboard', {
        items: [
          {
            kind: 'file',
            value: 'dashboard.html',
            note: t('每轮审查后重新生成', 'Regenerated after every review round'),
          },
        ],
        view: { width: 448, height: 256 },
      }),
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
  return addGlobalMemory(base, { memory: 'review-lessons', type: 'workflow' }, { x: 0, y: 0 })
    .document
}

/** 实现做完，第一轮审查没通过，修完了，第二轮审查进行中。 */
function fillState(state) {
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
  state.nodes.implement = done(
    0,
    11,
    t(
      '抽出 refreshWithRetry，指数退避三次；补了 6 个单测。',
      'Extracted refreshWithRetry with three exponential backoffs; added 6 unit tests.',
    ),
  )
  state.nodes.fix = done(
    18,
    24,
    t(
      '修了审查提的两条：退避上限、并发刷新只发一次。',
      'Fixed the two review points: the backoff cap and a single request for concurrent refreshes.',
    ),
  )
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
      detail: t(
        '退避没有上限；并发刷新会发多次',
        'The backoff has no cap; concurrent refreshes send several requests',
      ),
    },
    { at: at(18), node: 'fix', event: 'start' },
    { at: at(24), node: 'fix', event: 'done' },
    { at: at(25), node: 'review', event: 'start', round: 2 },
  ]
}

/** 看板：审查步骤每轮重新生成的单文件 HTML。 */
const BOARD_NOW = {
  sub: t('第 2 轮审查进行中 · 更新于 10:25', 'Round 2 review in progress · updated 10:25'),
  cards: [
    [t('当前轮次', 'Round'), '2 / 3', t('最多三轮', 'Max 3 rounds'), '#4d94ff'],
    [t('上轮结论', 'Verdict'), t('未通过', 'Fail'), t('2 个问题', '2 issues'), '#ff7a66'],
    [t('问题修复', 'Fixes'), '2 / 2', t('已全部修完', 'All done'), '#3ecf8e'],
    [t('单元测试', 'Unit tests'), t('6 通过', '6 passed'), t('新增 6 个', '6 new'), '#3ecf8e'],
  ],
}
const BOARD_ROUND1 = {
  sub: t('第 1 轮审查进行中 · 更新于 10:12', 'Round 1 review in progress · updated 10:12'),
  cards: [
    [t('当前轮次', 'Round'), '1 / 3', t('最多三轮', 'Max 3 rounds'), '#4d94ff'],
    [t('上轮结论', 'Verdict'), t('尚无', 'None'), t('首次审查', 'First review'), '#8a97ab'],
    [t('问题修复', 'Fixes'), '0 / 5', t('5 个待修', '5 to fix'), '#ff7a66'],
    [t('单元测试', 'Unit tests'), t('3 通过', '3 passed'), t('新增 3 个', '3 new'), '#3ecf8e'],
  ],
}
function dashboardHtml(board = BOARD_NOW) {
  const cards = board.cards
    .map(
      ([l, v, h, c]) =>
        `<div class="card"><span>${l}</span><b style="color:${c}">${v}</b><i>${h}</i></div>`,
    )
    .join('')
  return `<!doctype html><html lang="${t('zh-CN', 'en')}"><head><meta charset="utf-8"><style>
body{margin:0;padding:10px 20px 4px;background:#0f141c;color:#e6ebf3;font:13px/1.5 "Microsoft YaHei UI","PingFang SC",system-ui,sans-serif}
h1{margin:0;font-size:17px;font-weight:650}.sub{margin:1px 0 10px;color:#8a97ab}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.card{display:flex;flex-direction:column;padding:6px 11px;border:1px solid #232c3a;border-radius:10px;background:#151c27}
.card span{color:#8a97ab;font-size:12.5px}.card b{font-size:21px;font-weight:700;white-space:nowrap}.card i{color:#6f7d92;font-size:12.5px;font-style:normal}
</style></head><body><h1>${t('代码审查循环 · 看板', 'Code and review loop · Dashboard')}</h1><p class="sub">${board.sub}</p><div class="cards">${cards}</div></body></html>`
}

const clickTestId = (id) => `document.querySelector('[data-testid="${id}"]')?.click()`
const has = (id) => `document.querySelector('[data-testid="${id}"]') !== null`

/**
 * 截图前把夹具留下的本机痕迹换成示意内容：工作区、数据目录的绝对路径，会话已不在的提示。
 * 只改文字节点，拍完就丢，不影响界面状态。
 */
async function maskLocal(session) {
  await session.evaluate(`(() => {
    const rules = [
      [/[A-Za-z]:[\\\\/][^\\s"'<>]*?docs-ws/g, '~/projects/shop'],
      [/[A-Za-z]:[\\\\/][^\\s"'<>]*?docs-data/g, '~/.dsh/workflow-lite'],
      [/(~\\/projects\\/shop)(\\\\[^\\s]*)/g, (_, root, rest) => root + rest.replace(/\\\\/g, '/')],
      [${JSON.stringify(t('会话已不在', 'Session no longer exists'))}, '${t('新建会话', 'New session')}'],
      // 工作区只写文件夹名的地方（下拉里的「shop（当前工作区）」）。
      [/\\bdocs-ws\\b/g, 'shop'],
    ]
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let text = node.nodeValue
      for (const [pattern, to] of rules) text = text.replace(pattern, to)
      if (text !== node.nodeValue) node.nodeValue = text
    }
  })()`)
}

/** 拍 + 转 webp。`box` 是视口坐标的矩形，缺省整个视口。 */
async function snap(session, name, box) {
  if (!wants(name)) return
  await maskLocal(session)
  const metrics = await session.evaluate(`({ w: innerWidth, h: innerHeight })`)
  const clip = box ?? { x: 0, y: 0, width: metrics.w, height: metrics.h }
  const { data } = await session.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...clip, scale: 1 },
  })
  const file = join(OUT, `${name}.png`)
  await writeFile(file, Buffer.from(data, 'base64'))
  const sharp = createRequire(join(SITE, 'package.json'))('sharp')
  await mkdir(ASSETS, { recursive: true })
  await sharp(file)
    .webp({ quality: 86 })
    .toFile(join(ASSETS, `${name}.webp`))
  console.log(`  拍了 ${name}（${LANG}）`)
}

/** 元素的外框（视口坐标），可外扩 pad。 */
const rectOf = (selector, pad = 0, maxHeight = 1e9) => `(() => {
  const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
  return { x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top - ${pad}), width: r.width + ${pad * 2}, height: Math.min(r.height + ${pad * 2}, ${maxHeight}) }
})()`

const metrics = (session, width, height) =>
  session.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: DPR,
    mobile: false,
  })

const clickText = (text) => `(() => {
  const hit = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === ${JSON.stringify(text)})
  if (!hit) return false
  hit.click()
  return true
})()`
const clickAria = (label) => `document.querySelector('button[aria-label="${label}"]')?.click()`
/** 点面板里的一行摘要，等它的对话框长出来、动效停下。 */
async function openSheet(session, rowTestId, dialogTestId) {
  await session.evaluate(clickTestId(rowTestId))
  await waitFor(session, has(dialogTestId))
  await sleep(1000)
  await mouseMove(session, { x: 8, y: 8 })
}
/** 不保存，关掉对话框。 */
async function closeSheet(session, dialogTestId) {
  await session.evaluate(clickTestId(`${dialogTestId}-cancel`))
  await waitFor(session, `document.querySelector('[data-testid="${dialogTestId}"]') === null`)
  await sleep(400)
}
const SOURCE_DIALOG = 'wl-trigger-source-dialog'

const nodeClick = (id) =>
  `document.querySelector('.react-flow__node[data-id="${id}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`
const pressEscape = (session) =>
  session.evaluate(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
/** 图上所有卡片、连线、线上标签的外框再留一圈边。 */
const graphBox = `(() => {
  const parts = document.querySelectorAll('.react-flow__node, .react-flow__edge-path, .react-flow__edgelabel-renderer > *')
  const rects = [...parts].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0)
  const pad = 16
  const left = Math.min(...rects.map((r) => r.left)) - pad
  const top = Math.min(...rects.map((r) => r.top)) - pad
  const right = Math.max(...rects.map((r) => r.right)) + pad
  const bottom = Math.max(...rects.map((r) => r.bottom)) + pad
  return { x: left, y: top, width: right - left, height: bottom - top }
})()`

/** 循环那一段：实现、审查、修复、汇总四个步骤加上修复回到审查的回边，再留一圈边。整张图太宽，缩进正文里字就看不清。 */
const loopBox = `(() => {
  const nodes = ['implement', 'review', 'fix', 'report'].map((id) => document.querySelector('.react-flow__node[data-id="' + id + '"]'))
  const back = document.querySelector('.react-flow__edge[data-id="fix->review"]')
  const rects = [...nodes, back].filter(Boolean).map((n) => n.getBoundingClientRect())
  const pad = 28
  const left = Math.min(...rects.map((r) => r.left)) - pad
  const top = Math.min(...rects.map((r) => r.top)) - pad
  // 回边伸出去的一截不要拍进画布外面的底色：右边不超过画布本身。
  const canvasRight = document.querySelector('.react-flow')?.getBoundingClientRect().right ?? Infinity
  const right = Math.min(Math.max(...rects.map((r) => r.right)) + pad, canvasRight)
  const bottom = Math.max(...rects.map((r) => r.bottom)) + pad
  return { x: Math.max(0, left), y: Math.max(0, top), width: right - Math.max(0, left), height: bottom - Math.max(0, top) }
})()`

/** 一张一张拍；某一张失败只记一行，不拖垮后面的。 */
async function step(name, fn) {
  if (!wants(name)) return
  try {
    await fn()
  } catch (error) {
    console.log(`  ✗ ${name}：${String(error.message).split('\n')[0]}`)
  }
}

async function tidyAndFit(session) {
  await session.evaluate(clickTestId('wl-tidy'))
  await sleep(1500)
  await session.evaluate(clickTestId('wl-fit'))
  await sleep(1000)
}

/** 触发卡片那两张图用的小工作流：三个步骤，上面一张工作日凌晨的触发卡片。 */
const TRIGGER_NAME = t('夜间巡检', 'nightly-check')
function triggerDocument() {
  const step = (id, label, prompt, x) => ({
    id,
    type: 'wfNode',
    position: { x, y: 220 },
    data: { label, prompt },
  })
  return {
    nodes: [
      step(
        'scan',
        t('扫描改动', 'Scan changes'),
        t(
          '看最近一天的提交，列出改动的模块。',
          'Read the last day of commits and list the modules touched.',
        ),
        80,
      ),
      step(
        'check',
        t('跑检查', 'Run checks'),
        t('对改动的模块跑测试和 lint。', 'Run tests and lint on the modules touched.'),
        420,
      ),
      step(
        'report',
        t('写巡检报告', 'Write report'),
        t('把发现的问题写成一份报告。', 'Write up what was found as a report.'),
        760,
      ),
      {
        id: 'nightly',
        type: 'wfTrigger',
        position: { x: 80, y: 100 },
        data: {
          label: t('夜巡', 'Nightly'),
          source: {
            kind: 'schedule',
            schedule: { kind: 'daily', time: '02:30', weekdays: [1, 2, 3, 4, 5] },
          },
          note: t('只看 src 目录，报告写中文。', 'Only look at src/. Keep the report short.'),
        },
      },
    ],
    edges: [edge('scan', 'check'), edge('check', 'report')],
    viewport: { x: 0, y: 0, zoom: 1 },
    // 「上次执行未结束时」缺省跳过，按运行状态判断：没开「记录运行状态」启用不了。
    settings: { runState: true },
  }
}

/**
 * 触发卡片：画布上的卡片（开着、等待中）、它的属性面板和「触发方式」对话框。自己建图、拍完删掉，放在最前面——
 * 后面每一段都从 `bootToCanvas` 重新进页面，不受这里影响（所以这里不收步骤库、不改偏好）。
 * 不点「立即触发一次」：那会在侧栏里多出一个会话。
 */
async function triggerShots(session) {
  if (!['trigger-card', 'trigger-panel', 'trigger-source'].some(wants)) return
  try {
    await rpc('graph/delete', { name: TRIGGER_NAME }).catch(() => {})
    await rpc('graph/create', { name: TRIGGER_NAME })
    const disk = await rpc('graph/load', { name: TRIGGER_NAME })
    await rpc('graph/save', {
      name: TRIGGER_NAME,
      document: triggerDocument(),
      baseHash: disk.hash,
    })
    await rpc('trigger/set', {
      workflow: TRIGGER_NAME,
      node: 'nightly',
      workspace: WORKSPACE,
      enabled: true,
    })
    await bootToCanvas(session, TRIGGER_NAME, {
      width: 1280,
      height: 780,
      lang: LANG,
      sessionTitle: SHOTS_SESSION_TITLE,
    })
    await metrics(session, 1280, 780)
    await sleep(600)
    await session.evaluate(clickTestId('wl-fit'))
    // 等状态读回来：卡片上写出下一次的时刻。
    await waitFor(
      session,
      `document.querySelector('.react-flow__node[data-id="nightly"] [data-state="waiting"]') !== null`,
    )
    await sleep(1200)
    await mouseMove(session, { x: 8, y: 8 })
    await snap(session, 'trigger-card', await session.evaluate(graphBox))

    // 面板只放摘要，详细设置在对话框里：窗口留够高，整块拍下来。
    await metrics(session, 1280, LANG === 'en' ? 960 : 920)
    await sleep(600)
    await session.evaluate(nodeClick('nightly'))
    await waitFor(session, has('wl-trigger-status'))
    await sleep(1200)
    await mouseMove(session, { x: 8, y: 8 })
    await snap(
      session,
      'trigger-panel',
      await session.evaluate(rectOf('[data-testid="wl-inspector"]', 8)),
    )

    // 「触发方式」对话框：左边四种方式，右边规则、常用值、判定和接下来 7 天。
    await openSheet(session, 'wl-trigger-when-edit', SOURCE_DIALOG)
    await snap(
      session,
      'trigger-source',
      await session.evaluate(rectOf(`[data-testid="${SOURCE_DIALOG}"]`)),
    )
    await closeSheet(session, SOURCE_DIALOG)
  } catch (error) {
    console.log(`  ✗ trigger：${String(error.message).split('\n')[0]}`)
  } finally {
    await rpc('graph/delete', { name: TRIGGER_NAME }).catch(() => {})
  }
}

/** 带命令、常驻的触发器那几张图用的工作流：一张定时检查、一张监视（带过滤和触发条件）、一张 HTTP。 */
const SOURCES_NAME = t('线上告警', 'alerts')
const SOURCE_SHOTS = [
  'trigger-check',
  'trigger-try',
  'trigger-confirm',
  'trigger-filter',
  'trigger-guard',
  'trigger-http',
]
function sourcesDocument() {
  const card = (id, x, data) => ({ id, type: 'wfTrigger', position: { x, y: 100 }, data })
  return {
    nodes: [
      {
        id: 'triage',
        type: 'wfNode',
        position: { x: 80, y: 260 },
        data: {
          label: t('分析告警', 'Triage'),
          prompt: t('找出是哪个模块出的问题。', 'Find which module is at fault.'),
        },
      },
      card('remote', 80, {
        label: t('远端有新提交', 'New commits'),
        source: {
          kind: 'schedule',
          schedule: { kind: 'every', seconds: 300 },
          check: { command: 'git ls-remote origin -h refs/heads/main', when: 'change' },
        },
      }),
      card('errors', 420, {
        label: t('日志报错', 'Log errors'),
        source: { kind: 'listen', command: 'node "{workflow}/triggers/tail-log.mjs" logs/app.log' },
        filter: { merge: 10, dedupe: 30, include: ['ERROR'], exclude: ['healthcheck'] },
        condition: t(
          '只处理支付模块的报错，其他模块的忽略。',
          'Only handle errors from the payment module; ignore the rest.',
        ),
      }),
      card('ci', 760, { label: t('CI 通知', 'CI hook'), source: { kind: 'http' } }),
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { runState: true },
  }
}

/** 几个元素合起来的外框（视口坐标），外扩 pad；找不到的跳过。 */
const unionOf = (selectors, pad = 8) => `(() => {
  const rects = ${JSON.stringify(selectors)}
    .map((s) => document.querySelector(s))
    .filter(Boolean)
    .map((el) => el.getBoundingClientRect())
  const left = Math.min(...rects.map((r) => r.left)) - ${pad}
  const top = Math.min(...rects.map((r) => r.top)) - ${pad}
  const right = Math.max(...rects.map((r) => r.right)) + ${pad}
  const bottom = Math.max(...rects.map((r) => r.bottom)) + ${pad}
  return { x: Math.max(0, left), y: Math.max(0, top), width: right - Math.max(0, left), height: bottom - Math.max(0, top) }
})()`

/**
 * 带命令、常驻的触发器：定时检查的「检查命令」一步与试运行、监视启用前的命令确认、过滤、保护、HTTP 的地址与令牌。
 * 只有 HTTP 那张真的启用（不用确认命令）；监视停在确认卡上，不真的跑命令。
 * 试运行在草稿里换成「变为成功」和一条哪都能跑的命令（`git --version`），不保存。
 */
async function triggerSourceShots(session) {
  if (!SOURCE_SHOTS.some(wants)) return
  try {
    await rpc('graph/delete', { name: SOURCES_NAME }).catch(() => {})
    await rpc('graph/create', { name: SOURCES_NAME })
    const disk = await rpc('graph/load', { name: SOURCES_NAME })
    await rpc('graph/save', {
      name: SOURCES_NAME,
      document: sourcesDocument(),
      baseHash: disk.hash,
    })
    for (const node of ['remote', 'errors', 'ci']) {
      await rpc('trigger/set', { workflow: SOURCES_NAME, node, workspace: WORKSPACE })
    }
    await rpc('trigger/set', { workflow: SOURCES_NAME, node: 'ci', enabled: true })
    await bootToCanvas(session, SOURCES_NAME, {
      width: 1280,
      height: 1100,
      lang: LANG,
      sessionTitle: SHOTS_SESSION_TITLE,
    })
    await metrics(session, 1280, 1100)
    await sleep(600)
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(1200)

    // 定时检查：「触发方式」对话框翻到第二步「检查命令」。
    await session.evaluate(nodeClick('remote'))
    await waitFor(session, has('wl-trigger-when-edit'))
    await sleep(800)
    await openSheet(session, 'wl-trigger-when-edit', SOURCE_DIALOG)
    const commandStep = async () => {
      await session.evaluate(clickTestId('wl-trigger-step-command'))
      await waitFor(session, has('wl-trigger-command'))
      await sleep(900)
      await mouseMove(session, { x: 8, y: 8 })
    }
    await commandStep()
    await snap(
      session,
      'trigger-check',
      await session.evaluate(rectOf(`[data-testid="${SOURCE_DIALOG}"]`)),
    )
    // 试运行：草稿里换成「变为成功」和一条哪都能跑的命令，确认后跑一次，拍命令框和结果。
    if (wants('trigger-try')) {
      await session.evaluate(clickTestId('wl-trigger-step-time'))
      await waitFor(session, has('wl-trigger-check-when-success'))
      await sleep(600)
      await session.evaluate(clickTestId('wl-trigger-check-when-success'))
      await sleep(300)
      await commandStep()
      await setReactInput(session, '[data-testid="wl-trigger-command"]', 'git --version')
      await sleep(300)
      await session.evaluate(clickTestId('wl-trigger-try'))
      await waitFor(session, has('wl-trigger-try-confirm'))
      await session.evaluate(clickTestId('wl-trigger-try-confirm'))
      await waitFor(session, has('wl-trigger-try-output'), { timeoutMs: 30_000 })
      await sleep(800)
      await mouseMove(session, { x: 8, y: 8 })
      await snap(
        session,
        'trigger-try',
        await session.evaluate(rectOf('[data-testid="wl-trigger-command-box"]', 8)),
      )
    }
    await closeSheet(session, SOURCE_DIALOG)

    // 监听程序：点开关，开关旁浮出确认卡。
    await session.evaluate(nodeClick('errors'))
    await waitFor(session, has('wl-trigger-enable'))
    await sleep(800)
    await session.evaluate(clickTestId('wl-trigger-enable'))
    await waitFor(session, has('wl-trigger-approve-pop'))
    await sleep(1000)
    await mouseMove(session, { x: 8, y: 8 })
    // 确认卡打开时焦点落在「取消」上：拍之前移走，图里不带焦点框。
    await session.evaluate('document.activeElement?.blur()')
    await sleep(300)
    await snap(
      session,
      'trigger-confirm',
      await session.evaluate(
        unionOf(['[data-testid="wl-trigger-enable"]', '[data-testid="wl-trigger-approve-pop"]']),
      ),
    )
    await session.evaluate(
      `document.querySelector('[data-testid="wl-trigger-approve-pop"] [data-confirm="cancel"]')?.click()`,
    )
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-trigger-approve-pop"]') === null`,
    )
    await sleep(600)

    // 过滤：面板里那一行点开的对话框。
    await openSheet(session, 'wl-trigger-filter-edit', 'wl-trigger-filter-dialog')
    await snap(
      session,
      'trigger-filter',
      await session.evaluate(rectOf('[data-testid="wl-trigger-filter-dialog"]')),
    )
    await closeSheet(session, 'wl-trigger-filter-dialog')

    // 保护：选「排队」，带出排队上限（不保存）。
    if (wants('trigger-guard')) {
      await openSheet(session, 'wl-trigger-guard', 'wl-trigger-guard-dialog')
      await session.evaluate(clickTestId('wl-trigger-overlap-queue'))
      await sleep(900)
      await mouseMove(session, { x: 8, y: 8 })
      await snap(
        session,
        'trigger-guard',
        await session.evaluate(rectOf('[data-testid="wl-trigger-guard-dialog"]')),
      )
      await closeSheet(session, 'wl-trigger-guard-dialog')
    }

    // HTTP：启用着，对话框里有地址、令牌（遮住）、调用示例和「发一条测试请求」（不发）。
    await session.evaluate(nodeClick('ci'))
    await waitFor(session, has('wl-trigger-when-edit'))
    await sleep(1200)
    await openSheet(session, 'wl-trigger-when-edit', SOURCE_DIALOG)
    await waitFor(session, has('wl-trigger-url'))
    await snap(
      session,
      'trigger-http',
      await session.evaluate(rectOf(`[data-testid="${SOURCE_DIALOG}"]`)),
    )
    await closeSheet(session, SOURCE_DIALOG)
  } catch (error) {
    console.log(`  ✗ trigger sources：${String(error.message).split('\n')[0]}`)
  } finally {
    await rpc('trigger/set', { workflow: SOURCES_NAME, node: 'ci', enabled: false }).catch(() => {})
    await rpc('graph/delete', { name: SOURCES_NAME }).catch(() => {})
  }
}

/** 接续触发与「触发」页用的两张图：「夜间构建」跑完接着跑「发布检查」。 */
const CHAIN_UP = t('夜间构建', 'nightly-build')
const CHAIN_DOWN = t('发布检查', 'release-check')
const CHAIN_SHOTS = ['trigger-after', 'trigger-hub', 'trigger-timeline']
function chainDocuments() {
  const work = (id, label, prompt) => ({
    id,
    type: 'wfNode',
    position: { x: 80, y: 260 },
    data: { label, prompt },
  })
  const card = (id, x, data) => ({ id, type: 'wfTrigger', position: { x, y: 100 }, data })
  const base = { edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
  return {
    [CHAIN_UP]: {
      ...base,
      settings: { runState: true },
      nodes: [
        work('build', t('构建', 'Build'), t('构建发布包。', 'Build the release package.')),
        card('nightly', 80, {
          label: t('每晚', 'Nightly'),
          source: { kind: 'schedule', schedule: { kind: 'daily', time: '02:00' } },
        }),
      ],
    },
    [CHAIN_DOWN]: {
      ...base,
      settings: { runState: true },
      nodes: [
        work(
          'check',
          t('检查发布包', 'Check package'),
          t('检查上一次构建的产出。', 'Check what the last build produced.'),
        ),
        card('after', 80, {
          label: t('构建完成后', 'After build'),
          source: { kind: 'after', workflow: CHAIN_UP },
        }),
        card('cleanup', 420, {
          label: t('构建失败善后', 'Build failed'),
          source: { kind: 'after', workflow: CHAIN_UP, when: 'failed' },
          note: t('只清理临时文件，不重试。', 'Only clean up temp files; do not retry.'),
        }),
      ],
    },
  }
}

/**
 * 「构建完成后」近几天的触发记录（发出、模型判断不需要、跳过），「触发」页的概览和时间线才有东西：
 * 直接写进截图专用数据目录的数据库（和实例一样，只有这里在写），不点「立即触发一次」，免得侧栏多出会话。
 */
async function chainFires(store) {
  const now = Date.now()
  const hour = 3600_000
  const base = {
    workflow: CHAIN_DOWN,
    node: 'after',
    name: t('构建完成后', 'After build'),
    channel: 'after',
  }
  const plan = [
    [50 * 60_000, 'sent', {}],
    [
      26 * hour,
      'sent',
      {
        declined: t(
          '这次构建只改了文档，不需要检查发布包。',
          'This build only touched docs; the package needs no check.',
        ),
      },
    ],
    [27 * hour, 'skipped', { reason: t('上次执行未结束', 'The last run has not ended') }],
    [50 * hour, 'sent', {}],
    [74 * hour, 'sent', {}],
  ]
  for (const [ago, outcome, extra] of plan) {
    const at = now - ago
    await store.record({
      record: { ...base, id: newFireId(new Date(at)), at, outcome, ...extra },
      info: t('「夜间构建」的一次执行结束：成功。', 'A run of nightly-build ended: done.'),
    })
  }
}

/** 接续触发：「触发方式」一节；工作流中心「触发」页：两个工作流里的三张卡片，概览和时间线。不点「立即触发一次」。 */
async function triggerChainShots(session) {
  if (!CHAIN_SHOTS.some(wants)) return
  const chainIds = []
  const database = new PluginDatabase(() => join(DATA_DIR, DATABASE_FILE))
  const store = new TriggerStore(() => DATA_DIR, database)
  try {
    for (const [name, document] of Object.entries(chainDocuments())) {
      await rpc('graph/delete', { name }).catch(() => {})
      await rpc('graph/create', { name })
      const disk = await rpc('graph/load', { name })
      await rpc('graph/save', { name, document, baseHash: disk.hash })
    }
    await chainRuns(chainIds)
    await chainFires(store)
    for (const [workflow, node] of [
      [CHAIN_UP, 'nightly'],
      [CHAIN_DOWN, 'after'],
    ]) {
      await rpc('trigger/set', { workflow, node, workspace: WORKSPACE, enabled: true })
    }
    await bootToCanvas(session, CHAIN_DOWN, {
      width: 1280,
      height: 900,
      lang: LANG,
      sessionTitle: SHOTS_SESSION_TITLE,
    })
    await metrics(session, 1280, 900)
    await sleep(600)
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(1200)

    await session.evaluate(nodeClick('after'))
    await waitFor(session, has('wl-trigger-when-edit'))
    await sleep(1200)
    await openSheet(session, 'wl-trigger-when-edit', SOURCE_DIALOG)
    await mouseMove(session, { x: 8, y: 8 })
    await snap(
      session,
      'trigger-after',
      await session.evaluate(rectOf(`[data-testid="${SOURCE_DIALOG}"]`)),
    )
    await closeSheet(session, SOURCE_DIALOG)

    await session.evaluate(clickTestId('wl-hub-open'))
    await waitFor(session, has('wl-hub'))
    await session.evaluate(clickTestId('wl-hub-triggers'))
    await waitFor(session, has('wl-hub-trg-page'))
    await session.evaluate(
      `document.querySelector('[data-testid="wl-hub-trg"][data-value="${CHAIN_DOWN}/after"]').click()`,
    )
    await sleep(1500)
    await mouseMove(session, { x: 8, y: 8 })
    await snap(
      session,
      'trigger-hub',
      await session.evaluate(rectOf('[data-testid="wl-hub"]', 0, 560)),
    )
    if (wants('trigger-timeline')) {
      await session.evaluate(clickTestId('wl-hub-trg-tab-timeline'))
      await sleep(1500)
      await mouseMove(session, { x: 8, y: 8 })
      await snap(
        session,
        'trigger-timeline',
        await session.evaluate(rectOf('[data-testid="wl-hub"]', 0, 560)),
      )
    }
    await pressEscape(session)
    await sleep(600)
  } catch (error) {
    console.log(`  ✗ trigger chain：${String(error.message).split('\n')[0]}`)
  } finally {
    for (const id of chainIds) await rpc('run/delete', { id, withState: true }).catch(() => {})
    for (const name of [CHAIN_UP, CHAIN_DOWN]) {
      await rpc('graph/delete', { name }).catch(() => {})
      await store.forget(name).catch(() => {})
    }
    database.close()
  }
}

/**
 * 「夜间构建」最近三次执行（成功、失败、成功，隔一天一次），「最近的执行」里才有东西可标。
 * 建实例的时刻是现在：往前挪要改状态文件的 `updatedAt`（列表上写的时刻）和实例索引里的 `createdAt`（排序），
 * 截图专用的数据目录，只有这里在写。
 */
async function chainRuns(ids) {
  const runs = new RunService({ dataDir: () => DATA_DIR, validate: () => [] })
  const document = (await rpc('graph/load', { name: CHAIN_UP })).document
  const plan = [
    ['done', 50 * 60_000],
    ['failed', 24 * 3_600_000 + 40 * 60_000],
    ['done', 48 * 3_600_000 + 35 * 60_000],
  ]
  const ago = new Map()
  for (const [index, [status, before]] of plan.entries()) {
    const prepared = await runs.prepare({
      workflow: CHAIN_UP,
      document,
      session: { id: `docs-chain-${String(index)}`, cwd: WORKSPACE },
      goal: t('构建发布包', 'Build the release package'),
    })
    if (!prepared.ok) throw new Error(JSON.stringify(prepared))
    ids.push(prepared.result.id)
    ago.set(prepared.result.id, before)
    const state = parse(await readFile(prepared.result.statePath, 'utf8'))
    state.status = status
    state.updatedAt = new Date(Date.now() - before + 20 * 60_000).toISOString()
    await writeFile(prepared.result.statePath, stringify(state, { lineWidth: 0 }))
  }
  const file = join(DATA_DIR, 'instances.json')
  const index = JSON.parse(await readFile(file, 'utf8'))
  for (const record of index.instances) {
    if (ago.has(record.id)) record.createdAt = Date.now() - ago.get(record.id)
  }
  await writeFile(file, JSON.stringify(index, null, 2))
}

async function main(session) {
  await mkdir(OUT, { recursive: true })
  await triggerShots(session)
  await triggerSourceShots(session)
  await triggerChainShots(session)
  await rpc('graph/delete', { name: NAME }).catch(() => {})
  await rpc('graph/create', { name: NAME })
  await rpc('memory/delete', { id: 'review-lessons' }).catch(() => {})
  await rpc('memory/create', {
    type: 'workflow',
    id: 'review-lessons',
    name: t('审查经验', 'Review lessons'),
    description: t('常见问题与最省事的审查走法', 'Common problems and the cheapest way to review'),
  })
  const disk = await rpc('graph/load', { name: NAME })
  await rpc('graph/save', { name: NAME, document: documentFor(), baseHash: disk.hash })
  await bootToCanvas(session, NAME, {
    width: 1280,
    height: 780,
    lang: LANG,
    sessionTitle: SHOTS_SESSION_TITLE,
  })
  await metrics(session, 1280, 780)
  await sleep(600)
  const root = '[data-testid="wl-root"]'

  // 步骤库：先拍（后面要收起）。
  await session.evaluate(clickAria(t('收起侧边栏', 'Collapse sidebar')))
  await sleep(600)
  await step('library', async () => {
    await snap(
      session,
      'library',
      await session.evaluate(rectOf(`section[aria-label="${t('步骤库', 'Step library')}"]`, 8)),
    )
  })
  await session.evaluate(clickAria(t('收起步骤库', 'Collapse library')))
  await sleep(500)
  await tidyAndFit(session)
  await step('canvas', async () => {
    await snap(session, 'canvas', await session.evaluate(rectOf(root, 0)))
  })
  await step('graph', async () => {
    await snap(session, 'graph', await session.evaluate(loopBox))
  })

  // 步骤面板、连线面板、提问、资源。
  await step('step-panel', async () => {
    await session.evaluate(nodeClick('review'))
    await waitFor(session, has('wl-inspector'))
    await sleep(800)
    await snap(
      session,
      'step-panel',
      await session.evaluate(rectOf('[data-testid="wl-inspector"]', 0)),
    )
  })
  await step('edge-panel', async () => {
    await mouseClick(session, { x: 200, y: 600 })
    await sleep(800)
    const at = await session.evaluate(`(() => {
      const label = [...document.querySelectorAll('.react-flow__edgelabel-renderer > *')].find((n) => n.textContent.includes('${t('未通过', 'Fail')}'))
      const r = label.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await mouseClick(session, at)
    await sleep(1200)
    await snap(
      session,
      'edge-panel',
      await session.evaluate(rectOf('[data-testid="wl-inspector"]', 0)),
    )
  })
  await step('input-panel', async () => {
    await session.evaluate(nodeClick('ask-module'))
    await waitFor(session, has('wl-input'))
    await sleep(800)
    await snap(
      session,
      'input-panel',
      await session.evaluate(rectOf('[data-testid="wl-inspector"]', 0)),
    )
  })
  await step('resource-panel', async () => {
    await session.evaluate(nodeClick('spec'))
    await waitFor(session, `${has('wl-resource-list')} || ${has('wl-resource-items')}`)
    await sleep(800)
    await snap(
      session,
      'resource-panel',
      await session.evaluate(rectOf('[data-testid="wl-inspector"]', 0)),
    )
  })
  await step('memory-panel', async () => {
    await session.evaluate(nodeClick('mem-global'))
    await waitFor(session, `${has('wl-memory-info')} || ${has('wl-memory-name')}`)
    await sleep(800)
    await snap(
      session,
      'memory-panel',
      await session.evaluate(rectOf('[data-testid="wl-inspector"]', 0)),
    )
  })

  await step('ask-dialog', async () => {
    await session.evaluate(clickTestId('wl-run-start'))
    await waitFor(session, has('wl-ask'))
    await sleep(900)
    await snap(session, 'ask-dialog', await session.evaluate(rectOf('[data-testid="wl-ask"]', 0)))
    await pressEscape(session)
    await sleep(500)
  })

  // 对话框：计划、设置、版本、导出。
  await step('plan', async () => {
    await session.evaluate(clickTestId('wl-preview'))
    await waitFor(session, has('wl-plan-text'), { timeoutMs: 30_000 })
    await sleep(1000)
    await snap(session, 'plan', await session.evaluate(rectOf('[data-testid="wl-plan"]', 0)))
    await pressEscape(session)
    await sleep(500)
  })
  await step('settings', async () => {
    await session.evaluate(clickTestId('wl-settings-open'))
    await waitFor(session, `${has('wl-settings-root')} || ${has('wl-settings-run-state')}`)
    await sleep(800)
    await snap(session, 'settings', await session.evaluate(rectOf('[role="dialog"]', 0)))
    await pressEscape(session)
    await sleep(500)
  })
  await step('versions', async () => {
    await session.evaluate(clickTestId('wl-versions-open'))
    await waitFor(session, has('wl-versions-dialog'))
    await sleep(600)
    await session.evaluate(clickText(t('存为版本', 'Save version')))
    await sleep(1200)
    await snap(
      session,
      'versions',
      await session.evaluate(rectOf('[data-testid="wl-versions-dialog"]', 0)),
    )
    await pressEscape(session)
    await sleep(500)
  })
  await step('pack-export', async () => {
    const hub = '[data-testid="wl-hub"]'
    await session.evaluate(clickTestId('wl-export-open'))
    await waitFor(session, `${has('wl-pack-export')} || ${has('wl-pack-next')}`)
    await sleep(1200)
    await session.evaluate(clickTestId('wl-pack-next'))
    await sleep(1500)
    await snap(session, 'pack-export', await session.evaluate(rectOf(hub, 0, 640)))
    await session.evaluate(clickTestId('wl-pack-kind-skill'))
    await sleep(1200)
    for (let i = 0; i < 3 && !(await session.evaluate(has('wl-skill-name'))); i += 1) {
      await session.evaluate(clickTestId('wl-pack-next'))
      await sleep(1800)
    }
    await sleep(800)
    await snap(session, 'skill-export', await session.evaluate(rectOf(hub, 0, 700)))
    await pressEscape(session)
    await sleep(500)
  })

  // 实例：状态写好后从工作流中心打开它。
  await mkdir(WORKSPACE, { recursive: true })
  const runs = new RunService({ dataDir: () => DATA_DIR, validate: () => [] })
  const prepared = await runs.prepare({
    workflow: NAME,
    document: (await rpc('graph/load', { name: NAME })).document,
    session: { id: 'docs-session', cwd: WORKSPACE },
    goal: t('给 auth/ 加上 token 刷新的重试', 'Add retries to the token refresh in auth/'),
  })
  if (!prepared.ok) throw new Error(JSON.stringify(prepared))
  instance = prepared.result.id
  const state = parse(await readFile(prepared.result.statePath, 'utf8'))
  fillState(state)
  await writeFile(prepared.result.statePath, stringify(state, { lineWidth: 0 }))
  const produced = join(WORKSPACE, '.workflow-lite', 'runs', instance, 'out')
  await mkdir(produced, { recursive: true })
  const dashFile = join(produced, 'dashboard.html')
  const history = new RunHistory(() => DATA_DIR)
  const board = { node: 'dashboard', item: 0 }
  await writeFile(dashFile, dashboardHtml(BOARD_ROUND1))
  await history.apply(
    instance,
    {
      captures: [{ ...board, step: 'review', round: 1, phase: 'done' }],
      verdicts: [{ ...board, step: 'review', value: 'fail', again: true }],
    },
    () => dashFile,
    Date.now() - 3_600_000,
  )
  await writeFile(dashFile, dashboardHtml(BOARD_NOW))
  await history.apply(
    instance,
    { captures: [{ ...board, step: 'review', round: 2, phase: 'before' }], verdicts: [] },
    () => dashFile,
    Date.now() - 600_000,
  )
  // 第 2 轮审查进行中，看板又更新了一次：现在的文件比存下的最后一版新，播放条上多出「最新」一格。
  await writeFile(
    dashFile,
    `${dashboardHtml(BOARD_NOW)}
<!-- 10:25 -->`,
  )
  await writeFile(
    join(produced, 'review.md'),
    t(
      '# 审查意见\n\n1. 退避没有上限。\n2. 并发刷新会发多次请求。\n',
      '# Review notes\n\n1. The backoff has no cap.\n2. Concurrent refreshes send several requests.\n',
    ),
  )

  await step('hub-runs', async () => {
    await session.evaluate(clickTestId('wl-hub-open'))
    await waitFor(session, has('wl-hub'))
    await revealHubRow(session, instance)
    await sleep(1000)
    await snap(
      session,
      'hub-runs',
      await session.evaluate(rectOf('[data-testid="wl-hub"]', 0, 560)),
    )
  })
  await step('run-graph', async () => {
    await viewHubRun(session, instance)
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`,
    )
    await sleep(2500)
    await mouseMove(session, { x: 600, y: 700 })
    if (await session.evaluate(has('wl-run-timeline'))) {
      await session.evaluate(clickTestId('wl-run-panel-close'))
      await sleep(600)
    }
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(1000)
    await snap(session, 'run-graph', await session.evaluate(loopBox))
    await session.evaluate(clickTestId('wl-run-panel-toggle'))
    await waitFor(session, has('wl-run-timeline'))
    await sleep(800)
    await mouseMove(session, { x: 600, y: 700 })
    await snap(
      session,
      'run-panel',
      await session.evaluate(rectOf('[data-testid="wl-run-panel"]', 0)),
    )
    await session.evaluate(clickTestId('wl-run-panel-close'))
    await sleep(600)
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(1000)
  })
  await step('display-card', async () => {
    const center = await session.evaluate(`(() => {
      const r = document.querySelector('.react-flow__node[data-id="dashboard"]').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await mouseMove(session, center)
    for (let i = 0; i < 7; i += 1) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: center.x,
        y: center.y,
        deltaX: 0,
        deltaY: -120,
        modifiers: 2,
      })
      await sleep(120)
    }
    await sleep(1000)
    await snap(
      session,
      'display-card',
      await session.evaluate(rectOf('.react-flow__node[data-id="dashboard"]', 14)),
    )
  })
  await step('rounds-bar', async () => {
    const node = '.react-flow__node[data-id="dashboard"]'
    const point = (selector, index = 0) =>
      `(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`
    // 画布拉远一点：时间线在卡片底下，放大时会落到视口底边的图例后面。
    const wheel = async (at, deltaY) => {
      await mouseMove(session, at)
      for (let i = 0; i < 3; i += 1) {
        await session.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: at.x,
          y: at.y,
          deltaX: 0,
          deltaY,
          modifiers: 2,
        })
        await sleep(120)
      }
      await sleep(800)
    }
    const hover = await session.evaluate(point(node))
    await wheel(hover, 120)
    await mouseMove(session, await session.evaluate(point(node)))
    await waitFor(
      session,
      `getComputedStyle(document.querySelector('${node} [data-testid="wl-display-history-timeline"]')).opacity === '1'`,
    )
    // 点左边相邻的那一版：刻度尺滑过去、那道刻度亮起来，卡里换成那一版（悬停只预览，要点一下才停住）。
    // 先从卡片里面往下移进刻度盘，不然指针一出卡片时间线就收了。
    const dots = `${node} [data-testid="wl-display-history-dot"]`
    const count = await session.evaluate(
      `document.querySelectorAll(${JSON.stringify(dots)}).length`,
    )
    const target = await session.evaluate(point(dots, count - 2))
    const card = await session.evaluate(
      `(() => { const r = document.querySelector('${node}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 6 } })()`,
    )
    await mouseMove(session, card)
    await mouseMove(session, { x: target.x, y: card.y })
    await mouseMove(session, target)
    await mouseClick(session, target)
    await sleep(1100)
    await snap(
      session,
      'rounds-bar',
      await session.evaluate(`(() => {
        const a = document.querySelector('${node}').getBoundingClientRect()
        const b = document.querySelector('${node} [data-testid="wl-display-history-timeline"]').getBoundingClientRect()
        const pad = 24
        const x = Math.max(0, Math.min(a.left, b.left) - pad)
        const y = Math.max(0, a.top - pad)
        const right = Math.max(a.right, b.right) + pad
        return { x, y, width: right - x, height: Math.min(innerHeight - y, b.bottom - a.top + pad * 2) }
      })()`),
    )
    // 回到最新，别带着钉住的状态进下一步；画布拉回原来的大小。
    await mouseClick(
      session,
      await session.evaluate(point(`${node} [data-testid="wl-display-history-back"]`)),
    )
    await sleep(400)
    await wheel(hover, -120)
    await mouseMove(session, { x: 20, y: 20 })
  })
  await step('dashboard-viewer', async () => {
    await session.evaluate(nodeClick('dashboard'))
    await waitFor(session, has('wl-run-item-view'))
    await session.evaluate(clickTestId('wl-run-item-view'))
    await waitFor(session, has('wl-viewer-frame'))
    await sleep(1200)
    await snap(
      session,
      'dashboard-viewer',
      await session.evaluate(rectOf('[data-testid="wl-file-viewer"]', 0, 520)),
    )
    await session.evaluate(clickTestId('wl-viewer-versions-toggle'))
    await sleep(1200)
    await snap(
      session,
      'rounds-viewer',
      await session.evaluate(rectOf('[data-testid="wl-file-viewer"]', 0, 520)),
    )
    await session.evaluate(clickTestId('wl-viewer-versions-mode-compare'))
    await sleep(1500)
    await snap(
      session,
      'rounds-compare',
      await session.evaluate(rectOf('[data-testid="wl-file-viewer"]', 0, 520)),
    )
    await pressEscape(session)
    await sleep(500)
  })

  // 第二个示例：日志、表格、图片墙三种展示。
  await step('display-more', async () => {
    const name = t('展示示例', 'display-demo')
    await rpc('graph/delete', { name }).catch(() => {})
    await rpc('graph/create', { name })
    const res = (id, data, x, y) => ({ id, type: 'wfResource', position: { x, y }, data })
    const doc2 = {
      nodes: [
        {
          id: 'bench',
          type: 'wfNode',
          position: { x: 0, y: 330 },
          data: {
            label: t('压测', 'Load test'),
            description: t('跑一轮压测并留下记录', 'Run one round of load tests and keep a record'),
            prompt: t(
              '跑压测，把日志、成绩表和截图写到产出目录。',
              'Run the load test and write the log, the score table and screenshots to the output folder.',
            ),
          },
        },
        res(
          'log',
          { items: [{ kind: 'file', value: 'run.log' }], view: { width: 448, height: 272 } },
          380,
          0,
        ),
        res(
          'table',
          { items: [{ kind: 'file', value: 'scores.csv' }], view: { width: 448, height: 272 } },
          380,
          340,
        ),
        res(
          'shots',
          { items: [{ kind: 'folder', value: 'shots' }], view: { width: 448, height: 296 } },
          380,
          680,
        ),
      ],
      edges: [edge('bench', 'log'), edge('bench', 'table'), edge('bench', 'shots')],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { runState: true },
    }
    const disk2 = await rpc('graph/load', { name })
    await rpc('graph/save', { name, document: doc2, baseHash: disk2.hash })
    const prepared2 = await runs.prepare({
      workflow: name,
      document: (await rpc('graph/load', { name })).document,
      session: { id: 'docs-session', cwd: WORKSPACE },
      goal: t('压测登录接口', 'Load-test the login endpoint'),
    })
    if (!prepared2.ok) throw new Error(JSON.stringify(prepared2))
    instance2 = prepared2.result.id
    const state2 = parse(await readFile(prepared2.result.statePath, 'utf8'))
    state2.status = 'done'
    state2.nodes.bench = {
      status: 'done',
      round: 1,
      startedAt: '2026-10-06T10:00:00+08:00',
      finishedAt: '2026-10-06T10:09:00+08:00',
      by: 'subagent',
      summary: t('压测完成，p95 在 180ms 左右。', 'Load test done; p95 is around 180 ms.'),
    }
    await writeFile(prepared2.result.statePath, stringify(state2, { lineWidth: 0 }))
    const out2 = join(WORKSPACE, '.workflow-lite', 'runs', instance2, 'out')
    await mkdir(join(out2, 'shots'), { recursive: true })
    const levels = ['INFO', 'INFO', 'INFO', 'WARN', 'INFO', 'ERROR']
    const messages = [
      t('worker-N 已就绪，连接池 32', 'worker-N ready, pool size 32'),
      t('请求 /login 平均 Nms', 'Requests to /login average N ms'),
      t('第 N 批请求完成，失败 0 次', 'Batch N done, 0 failures'),
      t('连接池占用超过 80 百分点，当前 N', 'Pool usage above 80 percent, now N'),
      t('写入结果缓存，条目 N', 'Result cache written, N entries'),
      t('请求超时：/login，重试第 N 次', 'Request timed out: /login, retry N'),
    ]
    const lines = []
    for (let i = 0; i < 400; i += 1) {
      const t = new Date(Date.UTC(2026, 9, 6, 2, 0, i * 3)).toISOString().slice(11, 19)
      const k = i % levels.length
      lines.push(
        `2026-10-06 ${t} [${levels[k]}] ${messages[k].replace('N', String(10 + (i % 37)))}`,
      )
    }
    await writeFile(join(out2, 'run.log'), `${lines.join('\n')}\n`)
    const rows = [
      t('接口,请求数,平均(ms),p95(ms),错误率', 'Endpoint,Requests,Mean (ms),p95 (ms),Error rate'),
    ]
    const apis = [
      '/login',
      '/logout',
      '/refresh',
      '/profile',
      '/orders',
      '/orders/{id}',
      '/pay',
      '/search',
      '/upload',
      '/health',
    ]
    for (let i = 0; i < 30; i += 1) {
      const api = apis[i % apis.length]
      rows.push(
        `${api},${1200 + ((i * 137) % 900)},${60 + ((i * 29) % 140)},${150 + ((i * 53) % 260)},${((i * 7) % 23) / 10}%`,
      )
    }
    await writeFile(join(out2, 'scores.csv'), `${rows.join('\n')}\n`)
    const sharp = createRequire(join(SITE, 'package.json'))('sharp')
    const palette = [
      '#3e7ce4',
      '#3ecf8e',
      '#ff7a66',
      '#cd9e70',
      '#8f6ce0',
      '#e45aa0',
      '#2fb7c9',
      '#7a8aa6',
      '#d9b44a',
    ]
    for (let i = 0; i < 9; i += 1) {
      const points = Array.from(
        { length: 9 },
        (_, j) => `${80 + j * 60},${290 - ((j * 37 + i * 53) % 150)}`,
      ).join(' ')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#0f141c"/><rect x="40" y="60" width="560" height="280" rx="14" fill="#151c27" stroke="#232c3a"/><polyline fill="none" stroke="${palette[i]}" stroke-width="6" stroke-linejoin="round" points="${points}"/><text x="60" y="48" font-size="26" fill="#e6ebf3" font-family="sans-serif">${t(`第 ${i + 1} 轮 · 响应时间`, `Round ${i + 1}`)}</text></svg>`
      await sharp(Buffer.from(svg))
        .png()
        .toFile(join(out2, 'shots', `round-${String(i + 1).padStart(2, '0')}.png`))
    }

    await session.evaluate(clickTestId('wl-hub-open'))
    await waitFor(session, has('wl-hub'))
    await session.evaluate(clickTestId('wl-hub-runs'))
    await viewHubRun(session, instance2)
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`,
    )
    await sleep(2500)
    if (await session.evaluate(has('wl-run-timeline'))) {
      await session.evaluate(clickTestId('wl-run-panel-close'))
      await sleep(600)
    }
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(1200)
    await mouseMove(session, { x: 20, y: 700 })
    await snap(session, 'display-more', await session.evaluate(graphBox))
    for (const [id, name2, ready] of [
      ['log', 'log-viewer', 'wl-log-viewer'],
      ['table', 'table-viewer', 'wl-data-table'],
      ['shots', 'gallery-viewer', 'wl-folder-browser'],
    ]) {
      try {
        await session.evaluate(nodeClick(id))
        await waitFor(session, has('wl-run-item-view'))
        await session.evaluate(clickTestId('wl-run-item-view'))
        await waitFor(session, has(ready), { timeoutMs: 8000 })
        await sleep(1200)
        if (id === 'shots') {
          await session.evaluate(
            `document.querySelector('[data-testid="wl-folder-entry"]')?.click()`,
          )
          await sleep(1200)
        }
        await snap(
          session,
          name2,
          await session.evaluate(
            rectOf('[data-testid="wl-file-viewer"], [data-testid="wl-folder-viewer"]', 0),
          ),
        )
      } catch (error) {
        console.log(`  ✗ ${name2}：${String(error.message).split('\n')[0]}`)
      }
      await pressEscape(session)
      await sleep(600)
    }
  })

  /** 建一个「一个生成步骤 + 若干展示资源」的示例工作流和它的实例；返回实例号和产出目录。 */
  const buildShowcase = async ({ name, goal, nodes }) => {
    await rpc('graph/delete', { name }).catch(() => {})
    await rpc('graph/create', { name })
    const doc = {
      nodes: [
        {
          id: 'gen',
          type: 'wfNode',
          position: { x: 0, y: 300 },
          data: {
            label: t('生成', 'Generate'),
            description: t('生成本轮的各份产出', "Produce this round's outputs"),
            prompt: t('生成本轮的各份产出文件。', "Produce this round's output files."),
          },
        },
        ...nodes.map(([id, item, view, x, y]) => ({
          id,
          type: 'wfResource',
          position: { x, y },
          data: { items: [item], view },
        })),
      ],
      edges: nodes.map(([id]) => edge('gen', id)),
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { runState: true },
    }
    const disk = await rpc('graph/load', { name })
    await rpc('graph/save', { name, document: doc, baseHash: disk.hash })
    const prepared = await runs.prepare({
      workflow: name,
      document: (await rpc('graph/load', { name })).document,
      session: { id: 'docs-session', cwd: WORKSPACE },
      goal,
    })
    if (!prepared.ok) throw new Error(JSON.stringify(prepared))
    const state = parse(await readFile(prepared.result.statePath, 'utf8'))
    state.status = 'done'
    state.nodes.gen = {
      status: 'done',
      round: 1,
      startedAt: '2026-10-06T10:00:00+08:00',
      finishedAt: '2026-10-06T10:09:00+08:00',
      by: 'subagent',
      summary: t('各份产出已写好。', 'The outputs are written.'),
    }
    await writeFile(prepared.result.statePath, stringify(state, { lineWidth: 0 }))
    return {
      instanceId: prepared.result.id,
      out: join(WORKSPACE, '.workflow-lite', 'runs', prepared.result.id, 'out'),
    }
  }

  /** 示例产出：封面图、看板、报告、指标 JSON、日志、成绩表、图片墙、一个放文档的文件夹。 */
  const writeShowcaseFiles = async (out) => {
    const sharp = createRequire(join(SITE, 'package.json'))('sharp')
    await mkdir(join(out, 'shots'), { recursive: true })
    await mkdir(join(out, 'reports'), { recursive: true })
    const bars = Array.from({ length: 12 }, (_, i) => {
      const h = 70 + ((i * 53) % 190)
      return `<rect x="${70 + i * 70}" y="${420 - h}" width="44" height="${h}" rx="8" fill="${i === 8 ? '#ff7a66' : '#3e7ce4'}" opacity="${i === 8 ? 1 : 0.85}"/>`
    }).join('')
    const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16203a"/><stop offset="1" stop-color="#0d1320"/></linearGradient></defs><rect width="960" height="600" fill="url(#g)"/><text x="70" y="96" font-size="40" font-weight="700" fill="#e6ebf3" font-family="sans-serif">${t('登录接口 · 响应时间', 'Login endpoint · response time')}</text><text x="70" y="140" font-size="22" fill="#8a97ab" font-family="sans-serif">${t('最近 12 次压测的 p95（毫秒）', 'p95 of the last 12 load tests (ms)')}</text><line x1="50" y1="420" x2="910" y2="420" stroke="#2a3446"/>${bars}</svg>`
    await sharp(Buffer.from(cover)).png().toFile(join(out, 'cover.png'))
    await writeFile(join(out, 'dashboard.html'), dashboardHtml(BOARD_NOW))
    await writeFile(
      join(out, 'report.md'),
      [
        t('# 本轮压测报告', '# Load test report for this round'),
        '',
        t(
          '登录接口在 **500 并发**下 p95 为 182 ms，比上一轮快了 12%。',
          'The login endpoint has a p95 of 182 ms at **500 concurrent users**, 12% faster than the last round.',
        ),
        '',
        t('## 结论', '## Conclusions'),
        '',
        t(
          '- 连接池占用偶尔超过 80%，建议调大到 64',
          '- Pool usage sometimes goes above 80%; raising it to 64 is recommended',
        ),
        t(
          '- `/orders/{id}` 的错误率最高，为 1.2%',
          '- `/orders/{id}` has the highest error rate, at 1.2%',
        ),
        t('- 其余接口均在预期范围内', '- All other endpoints are within expectations'),
        '',
        t('## 各接口', '## Endpoints'),
        '',
        t('| 接口 | p95 | 错误率 |', '| Endpoint | p95 | Error rate |'),
        '|---|---|---|',
        '| /login | 182 ms | 0% |',
        '| /orders | 240 ms | 0.5% |',
        '| /pay | 310 ms | 1.2% |',
        '',
      ].join('\n'),
    )
    await writeFile(
      join(out, 'metrics.json'),
      JSON.stringify({
        service: 'shop-api',
        version: '1.8.2',
        round: 3,
        p95: { login: 182, orders: 240, pay: 310 },
        errors: { total: 12, timeout: 7, refused: 5 },
        passed: false,
        tags: [t('压测', 'load-test'), t('登录', 'login'), 'v1.8'],
      }),
    )
    const levels = ['INFO', 'INFO', 'INFO', 'WARN', 'INFO', 'ERROR']
    const messages = [
      t('worker-N 已就绪，连接池 32', 'worker-N ready, pool size 32'),
      t('请求 /login 平均 Nms', 'Requests to /login average N ms'),
      t('第 N 批请求完成，失败 0 次', 'Batch N done, 0 failures'),
      t('连接池占用超过 80 百分点，当前 N', 'Pool usage above 80 percent, now N'),
      t('写入结果缓存，条目 N', 'Result cache written, N entries'),
      t('请求超时：/login，重试第 N 次', 'Request timed out: /login, retry N'),
    ]
    const lines = []
    for (let i = 0; i < 400; i += 1) {
      const t = new Date(Date.UTC(2026, 9, 6, 2, 0, i * 3)).toISOString().slice(11, 19)
      const k = i % levels.length
      lines.push(
        `2026-10-06 ${t} [${levels[k]}] ${messages[k].replace('N', String(10 + (i % 37)))}`,
      )
    }
    await writeFile(join(out, 'run.log'), `${lines.join('\n')}\n`)
    const apis = [
      '/login',
      '/logout',
      '/refresh',
      '/profile',
      '/orders',
      '/pay',
      '/search',
      '/upload',
    ]
    const rows = [
      t('接口,请求数,平均(ms),p95(ms),错误率', 'Endpoint,Requests,Mean (ms),p95 (ms),Error rate'),
    ]
    for (let i = 0; i < 30; i += 1) {
      rows.push(
        `${apis[i % apis.length]},${1200 + ((i * 137) % 900)},${60 + ((i * 29) % 140)},${150 + ((i * 53) % 260)},${((i * 7) % 23) / 10}%`,
      )
    }
    await writeFile(join(out, 'scores.csv'), `${rows.join('\n')}\n`)
    const palette = [
      '#3e7ce4',
      '#3ecf8e',
      '#ff7a66',
      '#cd9e70',
      '#8f6ce0',
      '#e45aa0',
      '#2fb7c9',
      '#7a8aa6',
      '#d9b44a',
    ]
    for (let i = 0; i < 9; i += 1) {
      const points = Array.from(
        { length: 9 },
        (_, j) => `${80 + j * 60},${290 - ((j * 37 + i * 53) % 150)}`,
      ).join(' ')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#0f141c"/><rect x="40" y="60" width="560" height="280" rx="14" fill="#151c27" stroke="#232c3a"/><polyline fill="none" stroke="${palette[i]}" stroke-width="6" stroke-linejoin="round" points="${points}"/><text x="60" y="48" font-size="26" fill="#e6ebf3" font-family="sans-serif">${t(`第 ${i + 1} 轮 · 响应时间`, `Round ${i + 1}`)}</text></svg>`
      await sharp(Buffer.from(svg))
        .png()
        .toFile(join(out, 'shots', `round-${String(i + 1).padStart(2, '0')}.png`))
    }
    for (const [file, body] of [
      [
        'summary.md',
        t('# 本轮小结\n\n压测完成。\n', '# Summary of this round\n\nLoad test done.\n'),
      ],
      [
        'plan.md',
        t(
          '# 下一轮计划\n\n调大连接池后复测。\n',
          '# Plan for the next round\n\nRetest after raising the pool size.\n',
        ),
      ],
      ['notes.txt', t('连接池占用偶尔超过 80%。\n', 'Pool usage sometimes goes above 80%.\n')],
      ['errors.log', t('[ERROR] 请求超时：/login\n', '[ERROR] Request timed out: /login\n')],
      ['metrics.json', '{"p95":182}\n'],
    ]) {
      await writeFile(join(out, 'reports', file), body)
    }
    // 一个子文件夹：文件列表里标出「N 张图」。
    await mkdir(join(out, 'reports', 'charts'), { recursive: true })
    for (const name of ['r01-p95.svg', 'r02-p95.svg', 'r03-p95.svg']) {
      await writeFile(
        join(out, 'reports', 'charts', name),
        '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
      )
    }
  }

  /** 从工作流中心打开某个实例（进入实例视图，关掉右栏）。 */
  const openRun = async (id) => {
    if (!(await session.evaluate(has('wl-hub')))) {
      await session.evaluate(clickTestId('wl-hub-open'))
      await waitFor(session, has('wl-hub'))
    }
    await session.evaluate(clickTestId('wl-hub-runs'))
    await viewHubRun(session, id)
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`,
    )
    await sleep(2500)
    if (await session.evaluate(has('wl-run-timeline'))) {
      await session.evaluate(clickTestId('wl-run-panel-close'))
      await sleep(600)
    }
  }

  // 第三个示例：每种展示类型各一张卡，加四种外观；拍每种类型的卡片、查看框和设置浮层。
  await step('display-types', async () => {
    const { instanceId, out } = await buildShowcase({
      name: t('展示类型', 'display-types'),
      goal: t('汇总本轮压测', 'Summarise this round of load tests'),
      nodes: [
        ['img', { kind: 'file', value: 'cover.png' }, { width: 320, height: 216 }, 380, 140],
        ['web', { kind: 'file', value: 'dashboard.html' }, { width: 448, height: 176 }, 900, 140],
        ['md', { kind: 'file', value: 'report.md' }, { width: 448, height: 320 }, 380, 440],
        ['json', { kind: 'file', value: 'metrics.json' }, { width: 320, height: 232 }, 900, 440],
        ['log', { kind: 'file', value: 'run.log' }, { width: 448, height: 272 }, 380, 820],
        [
          'table',
          { kind: 'file', value: 'scores.csv' },
          { width: 448, height: 272, table: { bars: true } },
          900,
          820,
        ],
        ['wall', { kind: 'folder', value: 'shots' }, { width: 448, height: 296 }, 380, 1180],
        [
          'list',
          { kind: 'folder', value: 'reports' },
          { width: 320, height: 216, gallery: { show: 'files', time: true } },
          900,
          1180,
        ],
      ],
    })
    await writeShowcaseFiles(out)
    // 整张图按 1:1 摆开：先把窗口拉高再进实例，进入时自动适应窗口，不再点「看全图」。
    await metrics(session, 1440, 1720)
    await openRun(instanceId)
    await sleep(1500)
    await mouseMove(session, { x: 8, y: 8 })
    for (const [id, name] of [
      ['img', 'card-image'],
      ['web', 'card-web'],
      ['md', 'card-markdown'],
      ['json', 'card-json'],
      ['log', 'card-log'],
      ['table', 'card-table'],
      ['wall', 'card-folder-wall'],
      ['list', 'card-folder-list'],
    ]) {
      await snap(
        session,
        name,
        await session.evaluate(rectOf(`.react-flow__node[data-id="${id}"]`, 6)),
      )
    }
    // 拼一张总览：把几种卡片摆在一起，看得清每一种长什么样。
    await step('display-collage', async () => {
      const sharp = createRequire(join(SITE, 'package.json'))('sharp')
      const cells = [
        ['card-markdown', 'card-table', 'card-log'],
        ['card-web', 'card-image', 'card-folder-wall'],
      ]
      const W = 689
      const rowH = cells.map((row) => Math.max(...row.map(() => 0)))
      const sizes = []
      for (const [r, row] of cells.entries()) {
        for (const name of row) {
          const meta = await sharp(join(OUT, `${name}.png`)).metadata()
          sizes.push({ r, name, w: meta.width, h: meta.height })
          rowH[r] = Math.max(rowH[r], meta.height)
        }
      }
      const { data } = await sharp(join(OUT, 'card-markdown.png'))
        .extract({ left: 3, top: 3, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true })
      const background = { r: data[0], g: data[1], b: data[2] }
      const height = rowH.reduce((a, b) => a + b, 0)
      const layers = []
      let y = 0
      for (const [r] of cells.entries()) {
        sizes
          .filter((item) => item.r === r)
          .forEach((item, c) => {
            layers.push({
              input: join(OUT, `${item.name}.png`),
              left: c * W + Math.round((W - item.w) / 2),
              top: y + Math.round((rowH[r] - item.h) / 2),
            })
          })
        y += rowH[r]
      }
      const file = join(OUT, 'display-collage.png')
      await sharp({ create: { width: W * 3, height, channels: 3, background } })
        .composite(layers)
        .png()
        .toFile(file)
      await mkdir(ASSETS, { recursive: true })
      await sharp(file).webp({ quality: 86 }).toFile(join(ASSETS, 'display-collage.webp'))
      console.log('  拍了 display-collage')
    })
    // 设置浮层：以日志卡为例（里面有「只看」）。
    await step('display-settings', async () => {
      await session.evaluate(nodeClick('log'))
      await sleep(600)
      await session.evaluate(
        `document.querySelector('.react-flow__node[data-id="log"] [data-testid="wl-display-settings-open"]').click()`,
      )
      await waitFor(session, has('wl-display-pop'))
      await sleep(900)
      await snap(
        session,
        'display-settings',
        await session.evaluate(rectOf('[data-testid="wl-display-pop"]', 0)),
      )
      await session.evaluate(
        `document.querySelector('.react-flow__node[data-id="log"] [data-testid="wl-display-settings-open"]').click()`,
      )
      await sleep(500)
    })
    // 查看框
    await metrics(session, 1280, 780)
    await sleep(800)
    for (const [id, name, ready] of [
      ['img', 'viewer-image', 'wl-file-viewer'],
      ['md', 'viewer-markdown', 'wl-file-viewer'],
      ['json', 'viewer-json', 'wl-file-viewer'],
      ['list', 'viewer-folder-list', 'wl-folder-browser'],
    ]) {
      try {
        await session.evaluate(nodeClick(id))
        await waitFor(session, has('wl-run-item-view'))
        await session.evaluate(clickTestId('wl-run-item-view'))
        await waitFor(session, has(ready), { timeoutMs: 8000 })
        await sleep(1400)
        await snap(
          session,
          name,
          await session.evaluate(
            rectOf('[data-testid="wl-file-viewer"], [data-testid="wl-folder-viewer"]', 0, 560),
          ),
        )
      } catch (error) {
        console.log(`  ✗ ${name}：${String(error.message).split('\n')[0]}`)
      }
      await pressEscape(session)
      await sleep(600)
    }
  })

  // 四种外观：同一份 Markdown，卡片 / 柔边镂空 / 纯镂空 / 毛玻璃。
  await step('display-looks', async () => {
    const looks = [
      ['card', 'card'],
      ['clear', 'clear'],
      ['bare', 'bare'],
      ['glass', 'glass'],
    ]
    const { instanceId, out } = await buildShowcase({
      name: t('展示外观', 'display-looks'),
      goal: t('对比展示外观', 'Compare the display looks'),
      nodes: looks.map(([id, look], i) => [
        id,
        { kind: 'file', value: `${id}/report.md` },
        { width: 320, height: 232, look },
        380 + (i % 2) * 460,
        Math.floor(i / 2) * 320,
      ]),
    })
    await writeShowcaseFiles(out)
    // 同一份内容放在四个文件夹里：同一个文件不能被两张卡引用。
    const report = await readFile(join(out, 'report.md'), 'utf8')
    for (const [id] of looks) {
      await mkdir(join(out, id), { recursive: true })
      await writeFile(join(out, id, 'report.md'), report)
    }
    await openRun(instanceId)
    await metrics(session, 1280, 780)
    await sleep(1500)
    await mouseMove(session, { x: 8, y: 8 })
    await snap(session, 'display-looks', await session.evaluate(graphBox))
  })

  // 工作流中心各页。「工作流」页缺省按标签分组：给示例工作流打上标签；另一种语言跑剩下的示例删掉，免得混在列表里。
  if (wants('hub-workflows')) {
    const examples = [
      ['代码审查循环', 'code-review-loop', [t('代码审查', 'review'), t('示例', 'example')]],
      ['展示示例', 'display-demo', [t('画布展示', 'display'), t('示例', 'example')]],
      ['展示类型', 'display-types', [t('画布展示', 'display')]],
      ['展示外观', 'display-looks', [t('画布展示', 'display')]],
    ]
    for (const [zh, en, tags] of examples) {
      await rpc('graph/delete', { name: LANG === 'en' ? zh : en }).catch(() => {})
      await rpc('graph/tags', { name: t(zh, en), tags }).catch(() => {})
    }
    await rpc('graph/tagColor', { tag: t('画布展示', 'display'), color: 'green' }).catch(() => {})
    await rpc('graph/tagColor', { tag: t('代码审查', 'review'), color: 'amber' }).catch(() => {})
  }
  for (const [page, name] of [
    ['workflows', 'hub-workflows'],
    ['memories', 'hub-memories'],
    ['storage', 'hub-storage'],
    ['settings', 'hub-settings'],
  ]) {
    await step(name, async () => {
      if (!(await session.evaluate(has('wl-hub')))) {
        await session.evaluate(clickTestId('wl-hub-open'))
        await waitFor(session, has('wl-hub'))
      }
      await session.evaluate(clickTestId(`wl-hub-${page}`))
      await sleep(1200)
      await snap(
        session,
        name,
        await session.evaluate(
          rectOf('[data-testid="wl-hub"]', 0, name === 'hub-settings' ? 780 : 560),
        ),
      )
    })
  }
  // 外观：配色与展示外观；再把画布换成亮色拍一张。
  await step('theme-picker', async () => {
    await waitFor(session, has('wl-theme'))
    await snap(
      session,
      'theme-picker',
      await session.evaluate(rectOf('[data-testid="wl-theme"]', 8)),
    )
  })
  await pressEscape(session)
  await sleep(600)
  await step('canvas-light', async () => {
    await session.evaluate(
      `document.querySelector('[data-workflow-lite-view]').style.colorScheme = 'light'`,
    )
    await sleep(800)
    await session.evaluate(clickTestId('wl-fit'))
    await sleep(800)
    await snap(
      session,
      'canvas-light',
      await session.evaluate(rectOf('[data-testid="wl-root"]', 0)),
    )
    await session.evaluate(
      `document.querySelector('[data-workflow-lite-view]').style.colorScheme = ''`,
    )
  })
}

await rm(SHOTS_HOME, { recursive: true, force: true })
const env = await startShotsEnv({ dataDir: DATA_DIR, workspaceDir: WORKSPACE, home: SHOTS_HOME })
WORKSPACE = env.workspaceDir
ADOPTED_WORKSPACE = env.adoptedWorkspace
let session
try {
  session = await openPage()
  await session.send('Emulation.setLocaleOverride', { locale: BROWSER_LANGS[0] })
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(BROWSER_LANGS)} });
      Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(BROWSER_LANGS[0])} });`,
  })
  await installShotsCookie(session, env.base, env.cookie)
  await main(session)
  if (process.env.DOCS_KEEP !== undefined) {
    // 留着环境给人看：示例工作流和实例都在，Ctrl+C 后照常收尾。
    console.log(`
环境保留中：${env.url}
（Ctrl+C 结束并清理）`)
    await new Promise((resolve) => process.once('SIGINT', resolve))
  }
  if (session.errors.length > 0) console.log('页面报错：', JSON.stringify(session.errors))
} finally {
  if (instance2 !== null)
    await rpc('run/delete', { id: instance2, withState: true }).catch(() => {})
  await rpc('graph/delete', { name: t('展示示例', 'display-demo') }).catch(() => {})
  if (instance !== null) await rpc('run/delete', { id: instance, withState: true }).catch(() => {})
  await rpc('graph/delete', { name: NAME }).catch(() => {})
  await rpc('memory/delete', { id: 'review-lessons' }).catch(() => {})
  session?.close()
  await env.stop()
  await rm(SHOTS_HOME, { recursive: true, force: true }).catch(() => {})
  if (!ADOPTED_WORKSPACE) await rm(WORKSPACE, { recursive: true, force: true }).catch(() => {})
}
