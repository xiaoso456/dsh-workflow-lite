/**
 * 触发卡片的浏览器验收：自备一次性实例（假模型、一次性的家、随机端口，不用 `DSH_WEB_TOKEN`），
 * 建一张带触发卡片的工作流，在真浏览器里走一遍：卡片与面板、没选工作区时开不了、开关与下一次时间、
 * 立即触发（新建会话、消息到达模型）、触发记录、改规则、从步骤库拖入、实例概览与工作流中心里的来源；
 * 第二张图走常驻触发源：监听程序（开关旁确认命令 → 程序打出一行 → 过关键字发进会话 → 最近的输出
 * → 改了命令要重新确认）、HTTP（改触发端口、地址与令牌、令牌不对 401、请求到达模型）、换触发源；
 * 接续触发（选等哪个工作流、那边一个实例结束后消息到达模型），以及工作流中心「触发」页
 * （列出各工作流的卡片、触发记录、全部暂停与恢复、行尾开关、在画布上打开并选中）。
 * 结论以磁盘 / RPC 为准；截图落在 `tests/runs/trigger/`，给人看一眼样子。
 *
 * 假模型不调工具，所以「模型带着触发编号编译 → 实例认领来源」这一段不在这里（见 `tests/host/triggers.spec.ts`）；
 * 实例的来源是直接在同一个数据目录里建一个带来源的实例来看界面。
 *
 * 前置：一个带 DevTools 端口的 Chrome（`node tests/lib/cdp-chrome-launch.mjs 9222`），`pnpm run build` 过。
 * usage: node --experimental-strip-types tests/cdp-triggers.mjs
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunService } from '../src/host/runs/service.ts'
import { assetsDir } from '../src/host/store/paths.ts'
import {
  bootToCanvas,
  centerOf,
  dragItemTo,
  mouseClick,
  revealHubRow,
  settleAnimations,
} from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'
import { installShotsCookie, SHOTS_SESSION_TITLE, startShotsEnv } from './support/shots-env.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const RUNS = join(HERE, 'runs')
const DATA_DIR = join(RUNS, 'trigger-data')
const SHOTS_HOME = join(RUNS, 'trigger-home')
const OUT = join(RUNS, 'trigger')
const NAME = '夜间巡检'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clickTestId = (id) => `document.querySelector('[data-testid="${id}"]')?.click()`
const textOf = (selector) =>
  `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').trim()`

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  — ${detail}`}`)
}

const step = (id, label, prompt, x, y) => ({
  id,
  type: 'wfNode',
  position: { x, y },
  data: { label, prompt },
})

const DOC = {
  nodes: [
    step('scan', '扫描改动', '看最近一天的提交，列出改动的模块。', 120, 220),
    step('report', '写巡检报告', '把发现的问题写成一份报告。', 460, 220),
    {
      id: 'nightly',
      type: 'wfTrigger',
      position: { x: 120, y: 90 },
      data: {
        label: '夜巡',
        source: {
          kind: 'schedule',
          schedule: { kind: 'daily', time: '02:30', weekdays: [1, 2, 3, 4, 5] },
        },
        note: '只看 src 目录，报告写中文。',
      },
    },
  ],
  edges: [
    {
      id: 'scan->report',
      source: 'scan',
      target: 'report',
      sourceHandle: null,
      targetHandle: null,
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: { runState: true },
}

async function capture(session, file, clip, scale = 1) {
  await settleAnimations(session, { quiet: true })
  const shot = await session.send('Page.captureScreenshot', {
    format: 'png',
    ...(clip === undefined ? {} : { clip: { ...clip, scale } }),
  })
  await writeFile(join(OUT, file), Buffer.from(shot.data, 'base64'))
  console.log('shot', file)
}

const scheme = (value) =>
  `document.querySelector('[data-workflow-lite-view]').style.colorScheme = '${value}'`

const boxOf = (selector, pad = 24) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.x - ${pad}), y: Math.max(0, r.y - ${pad}), width: r.width + ${pad * 2}, height: r.height + ${pad * 2} };
})()`

const CARD = '.react-flow__node[data-id="nightly"]'

/** 第二张图：一张监听程序、一张 HTTP。 */
const NAME2 = '日志报警'
const TAIL = '.react-flow__node[data-id="tail"]'
const HOOK = '.react-flow__node[data-id="hook"]'
const COMMAND = 'node "{workflow}/triggers/emit.mjs"'
/** 监听程序：先打一行不含关键字的，再打一行报错，然后一直等着。 */
const EMIT = `console.log('INFO 启动好了')
setTimeout(() => console.log('ERROR pay timeout'), 1500)
setInterval(() => {}, 1000)
process.on('SIGTERM', () => process.exit(0))
`
const DOC2 = {
  nodes: [
    step('triage', '分析报错', '找出是哪个模块出的问题。', 120, 260),
    {
      id: 'tail',
      type: 'wfTrigger',
      position: { x: 120, y: 90 },
      data: {
        label: '日志报错',
        source: { kind: 'listen', command: COMMAND },
        note: '找出是哪个模块的问题。',
        filter: { merge: 1, include: ['ERROR'] },
      },
    },
    {
      id: 'hook',
      type: 'wfTrigger',
      position: { x: 460, y: 90 },
      // 上一次的会话还在跑也照样触发（HTTP 发出的会话还开着时，接续那一段要能发出去）。
      data: { label: 'CI 通知', source: { kind: 'http' }, launch: { overlap: 'parallel' } },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: { runState: true },
}

/** 一个这会儿没人用的端口。 */
async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

/** 等到 `rpc('trigger/list')` 里这张卡片满足条件；超时返回最后一次看到的。 */
async function waitTrigger(workflow, node, ok, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let view
  while (Date.now() < deadline) {
    view = (await rpc('trigger/list', { workflow })).triggers.find((item) => item.node === node)
    if (view !== undefined && ok(view)) return view
    await sleep(500)
  }
  return view
}

/** 等假模型收到一条含 `pattern` 的请求；返回那之后收到的全部请求体。 */
async function waitModel(mock, from, pattern, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const body = JSON.stringify(mock.requests.slice(from))
    if (pattern.test(body)) return body
    await sleep(500)
  }
  return JSON.stringify(mock.requests.slice(from))
}

await mkdir(OUT, { recursive: true })
await rm(SHOTS_HOME, { recursive: true, force: true })
await rm(DATA_DIR, { recursive: true, force: true })
const env = await startShotsEnv({
  dataDir: DATA_DIR,
  workspaceDir: join(RUNS, 'trigger-ws'),
  home: SHOTS_HOME,
})
const WORKSPACE = env.workspaceDir
let session
try {
  session = await openPage()
  await session.send('Network.enable').catch(() => {})
  await session.send('Network.clearBrowserCookies').catch(() => {})
  await installShotsCookie(session, env.base, env.cookie)
  await rpc('graph/delete', { name: NAME }).catch(() => {})
  await rpc('graph/create', { name: NAME })
  const disk = await rpc('graph/load', { name: NAME })
  const saved = await rpc('graph/save', { name: NAME, document: DOC, baseHash: disk.hash })
  const problems = (saved.problems ?? []).filter((p) => p.level !== 'hint')
  check('带触发卡片的图能存、没有问题', problems.length === 0, JSON.stringify(problems))

  const first = await rpc('trigger/list', { workflow: NAME })
  check(
    '宿主：列出这张卡片，关着',
    first.triggers.length === 1 && first.triggers[0].state === 'off',
    JSON.stringify(first),
  )

  await bootToCanvas(session, NAME, { width: 1600, height: 960, sessionTitle: SHOTS_SESSION_TITLE })
  await sleep(1500)
  await session.evaluate(clickTestId('wl-fit'))
  await sleep(1200)

  check('画布上有触发卡片', await session.evaluate(`document.querySelector('${CARD}') !== null`))
  const cardText = await session.evaluate(textOf(CARD))
  check(
    '卡片写着名字、规则、状态',
    /夜巡/.test(cardText) && /工作日 02:30/.test(cardText) && /已停用/.test(cardText),
    cardText,
  )
  const handles = await session.evaluate(
    `document.querySelectorAll('${CARD} .react-flow__handle').length`,
  )
  check('卡片没有连接点', handles === 0, String(handles))

  await session.evaluate(scheme('light'))
  await sleep(400)
  await capture(session, 'template-light.png')
  await capture(session, 'card-off-light.png', await session.evaluate(boxOf(CARD)), 2)
  await session.evaluate(scheme('dark'))
  await sleep(400)
  await capture(session, 'card-off-dark.png', await session.evaluate(boxOf(CARD)), 2)
  await session.evaluate(scheme('light'))

  // 没选工作区就开：开不了，提示原因，并打开面板。
  await mouseClick(session, await centerOf(session, `${CARD} [role="switch"]`))
  await sleep(1500)
  const toast = await session.evaluate(textOf('[role="status"]'))
  const afterRefuse = await rpc('trigger/list', { workflow: NAME })
  check(
    '没选工作区开不了，并说出原因',
    afterRefuse.triggers[0].enabled === false && toast !== '',
    toast,
  )
  check(
    '开不了时打开这张卡片的面板',
    await session.evaluate(`document.querySelector('[data-testid="wl-trigger-status"]') !== null`),
  )
  await sleep(600)
  const workspaceSeen = await session.evaluate(`(() => {
    const field = document.querySelector('[data-testid="wl-trigger-workspace"]');
    const panel = document.querySelector('[data-testid="wl-inspector"]');
    if (!field || !panel) return null;
    const f = field.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    return { inside: f.top >= p.top && f.bottom <= p.bottom - 40, focused: field.contains(document.activeElement) || field === document.activeElement };
  })()`)
  check(
    '开不了时把「工作区」带到眼前、焦点落上去',
    workspaceSeen?.inside === true && workspaceSeen.focused === true,
    JSON.stringify(workspaceSeen),
  )
  await capture(session, 'panel-off-light.png')

  // 面板：工作区下拉里有当前工作区。
  const workspaceSelect = await session.evaluate(
    `document.querySelector('[data-testid="wl-trigger-workspace"]') !== null`,
  )
  check('面板里有工作区选择', workspaceSelect)
  const set = await rpc('trigger/set', { workflow: NAME, node: 'nightly', workspace: WORKSPACE })
  check(
    '宿主：存下工作区',
    set.triggers[0].workspace !== undefined,
    JSON.stringify(set.triggers[0]),
  )
  await sleep(5500)

  // 再开：等待中，卡片上写下一次。
  await mouseClick(session, await centerOf(session, `${CARD} [role="switch"]`))
  await sleep(1500)
  const on = await rpc('trigger/list', { workflow: NAME })
  check('这个进程在负责触发', on.owner?.mine === true, JSON.stringify(on.owner))
  check(
    '开关打开后是等待中，有下一次时间',
    on.triggers[0].state === 'waiting' && typeof on.triggers[0].next === 'number',
    JSON.stringify(on.triggers[0]),
  )
  const cardOn = await session.evaluate(textOf(CARD))
  check('卡片写着等待中和下一次', /等待中/.test(cardOn) && /下一次/.test(cardOn), cardOn)
  await capture(session, 'card-on-light.png', await session.evaluate(boxOf(CARD)), 2)
  await session.evaluate(scheme('dark'))
  await sleep(400)
  await capture(session, 'card-on-dark.png', await session.evaluate(boxOf(CARD)), 2)
  await capture(session, 'panel-on-dark.png')
  await session.evaluate(scheme('light'))
  await sleep(300)

  // 立即触发一次，带背景信息：点按钮浮出小卡，写背景信息再点「触发」；假模型收到消息，记录里多一条。
  check(
    '背景信息不常驻在面板里',
    await session.evaluate(`document.querySelector('[data-testid="wl-trigger-info"]') === null`),
  )
  await session.evaluate(clickTestId('wl-trigger-fire'))
  await waitFor(session, `document.querySelector('[data-testid="wl-trigger-fire-pop"]') !== null`)
  await sleep(300)
  check(
    '小卡打开时焦点在背景信息里',
    await session.evaluate(
      `document.activeElement === document.querySelector('[data-testid="wl-trigger-info"]')`,
    ),
  )
  await capture(session, 'fire-pop-light.png')
  const served = env.mock.requests.length
  await session.evaluate(`(() => {
    const el = document.querySelector('[data-testid="wl-trigger-info"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, '昨晚 CI 挂了两次，重点看 build 脚本。');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(300)
  await session.evaluate(clickTestId('wl-trigger-fire-send'))
  const deadline = Date.now() + 40_000
  while (env.mock.requests.length === served && Date.now() < deadline) await sleep(500)
  check('立即触发：消息发到了模型', env.mock.requests.length > served)
  const body = JSON.stringify(env.mock.requests.slice(served))
  check(
    '消息里有触发说明、背景信息和 fire 编号',
    /只看 src 目录/.test(body) &&
      /昨晚 CI 挂了两次/.test(body) &&
      /fire=f-\d{8}-\d{6}-[0-9a-f]{4}/.test(body),
  )
  await sleep(1500)
  const fireResult = await session.evaluate(textOf('[data-testid="wl-trigger-fire-result"]'))
  check('面板上写着已发进会话', /已发进会话/.test(fireResult), fireResult)
  await sleep(4000)
  const fireLater = await session.evaluate(textOf('[data-testid="wl-trigger-fire-result"]'))
  check('「已发进会话」几秒后自己消失', fireLater === '', fireLater)
  const history = await rpc('trigger/history', { workflow: NAME, node: 'nightly' })
  check(
    '宿主：触发记录里有一条已发出的',
    history.fires.length === 1 &&
      history.fires[0].outcome === 'sent' &&
      history.fires[0].channel === 'now' &&
      typeof history.fires[0].session === 'string',
    JSON.stringify(history.fires),
  )
  await sleep(5500)
  const rows = await session.evaluate(
    `document.querySelectorAll('[data-testid="wl-trigger-history"] li').length`,
  )
  check('面板的触发记录列出这一条', rows === 1, String(rows))
  await session.evaluate(
    `document.querySelector('[data-testid="wl-trigger-history"]')?.scrollIntoView({ block: 'end' })`,
  )
  await sleep(500)
  await capture(session, 'panel-history-light.png')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-trigger-launch"]')?.scrollIntoView({ block: 'center' })`,
  )
  await sleep(500)
  await capture(session, 'panel-launch-light.png')

  // 改规则：换成每隔，卡片上的字跟着变。
  await session.evaluate(
    `document.querySelector('[data-testid="wl-trigger-when"]')?.scrollIntoView({ block: 'center' })`,
  )
  await sleep(300)
  await session.evaluate(clickTestId('wl-trigger-kind-every'))
  await sleep(1200)
  const everyText = await session.evaluate(textOf(CARD))
  check('换成「每隔」后卡片写每 1 小时', /每 1 小时/.test(everyText), everyText)
  await capture(session, 'panel-every-light.png')

  // 从步骤库再拖一张：落在画布上，是第二张触发卡片。
  await session.evaluate(clickTestId('wl-inspector-close'))
  await sleep(400)
  const libItem = await session.evaluate(
    `document.querySelector('[data-testid="wl-lib-trigger"]') !== null`,
  )
  check('步骤库「基础」里有「触发」', libItem)
  if (libItem) {
    const pane = await session.evaluate(
      `(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.7), y: Math.round(r.top + r.height * 0.25) }; })()`,
    )
    await dragItemTo(session, { itemTestId: 'wl-lib-trigger', to: pane })
    await sleep(1500)
    const count = await session.evaluate(
      `document.querySelectorAll('.react-flow__node-wfTrigger').length`,
    )
    check('拖进来之后有两张触发卡片', count === 2, String(count))
    await capture(session, 'template-two-light.png')
  }

  // 实例来源：直接在同一个数据目录里建一个带来源的实例，看概览和工作流中心。
  const runs = new RunService({ dataDir: () => DATA_DIR, validate: () => [] })
  const prepared = await runs.prepare({
    workflow: NAME,
    document: (await rpc('graph/load', { name: NAME })).document,
    session: { id: 'trigger-session', cwd: WORKSPACE },
    origin: {
      channel: 'schedule',
      trigger: { id: 'nightly', name: '夜巡' },
      firedAt: Date.now(),
      note: '只看 src 目录，报告写中文。',
      info: '昨晚 CI 挂了两次，重点看 build 脚本。',
    },
  })
  if (!prepared.ok) throw new Error(JSON.stringify(prepared))
  const instance = prepared.result.id
  const view = `[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-view"]`
  await session.evaluate(clickTestId('wl-hub-open'))
  await revealHubRow(session, instance, WORKSPACE)
  await waitFor(session, `document.querySelector('${view}') !== null`)
  const marker = await session.evaluate(
    textOf(`[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-origin"]`),
  )
  check('工作流中心的实例行标出触发卡片', marker === '夜巡', marker)
  await capture(session, 'hub-light.png')
  await session.evaluate(`document.querySelector('${view}').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`)
  await sleep(2500)
  const origin = await session.evaluate(textOf('[data-testid="wl-run-origin"]'))
  const originNote = await session.evaluate(textOf('[data-testid="wl-run-origin-note"]'))
  const originInfo = await session.evaluate(textOf('[data-testid="wl-run-origin-info"]'))
  check('实例概览写着来源', origin === '定时触发 · 夜巡', origin)
  check(
    '实例概览带触发说明和背景信息',
    /只看 src/.test(originNote) && /昨晚 CI/.test(originInfo),
    `${originNote} | ${originInfo}`,
  )
  await capture(session, 'run-light.png')

  // ── 第二张图：常驻触发源 ─────────────────────────────────────
  const port = await freePort()
  const config = await rpc('config/get', {})
  await rpc('config/set', { revision: config.revision, set: { triggerPort: port } })
  await rpc('graph/delete', { name: NAME2 }).catch(() => {})
  await rpc('graph/create', { name: NAME2 })
  const disk2 = await rpc('graph/load', { name: NAME2 })
  await rpc('graph/save', { name: NAME2, document: DOC2, baseHash: disk2.hash })
  const scripts = join(assetsDir(DATA_DIR, NAME2), 'triggers')
  await mkdir(scripts, { recursive: true })
  await writeFile(join(scripts, 'emit.mjs'), EMIT)
  for (const node of ['tail', 'hook']) {
    await rpc('trigger/set', { workflow: NAME2, node, workspace: WORKSPACE })
  }

  await bootToCanvas(session, NAME2, {
    width: 1600,
    height: 960,
    sessionTitle: SHOTS_SESSION_TITLE,
  })
  await sleep(1500)
  await session.evaluate(clickTestId('wl-fit'))
  await sleep(1200)
  const tailText = await session.evaluate(textOf(TAIL))
  check(
    '监听卡片写着「监听程序」',
    /日志报错/.test(tailText) && /监听程序/.test(tailText),
    tailText,
  )

  // 画布上点开关：命令还没确认，就在这个开关旁边浮出确认卡，列出命令和工作区。
  const tailSwitch = await centerOf(session, `${TAIL} [role="switch"]`)
  await mouseClick(session, tailSwitch)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-trigger-card-approve-pop"]') !== null`,
  )
  await sleep(400)
  const popBox = await session.evaluate(`(() => {
    const r = document.querySelector('[data-testid="wl-trigger-card-approve-pop"]').getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  })()`)
  const gapX = Math.max(0, popBox.left - tailSwitch.x, tailSwitch.x - popBox.right)
  const gapY = Math.max(0, popBox.top - tailSwitch.y, tailSwitch.y - popBox.bottom)
  check(
    '确认卡浮在点的那个开关旁边',
    gapX < 40 && gapY < 40,
    JSON.stringify({ popBox, tailSwitch }),
  )
  check(
    '确认卡打开时焦点在「取消」上',
    await session.evaluate(
      `document.activeElement === document.querySelector('[data-testid="wl-trigger-card-approve-pop"] [data-confirm="cancel"]')`,
    ),
  )
  const shown = await session.evaluate(textOf('[data-testid="wl-trigger-approve-command"]'))
  check('确认卡列出要运行的命令', shown === COMMAND, shown)
  const pop = await session.evaluate(textOf('[data-testid="wl-trigger-card-approve-pop"]'))
  check(
    '确认卡写着工作区',
    pop.includes(WORKSPACE.replace(/\\/gu, '/')) || pop.includes(WORKSPACE),
    pop,
  )
  check(
    '确认之前没打开',
    (await rpc('trigger/list', { workflow: NAME2 })).triggers[0].enabled === false,
  )
  await capture(session, 'listen-confirm-light.png')

  // 取消之后，选中这张卡片、换走再选回来：确认卡不会自己再弹出来。
  await session.evaluate(
    `document.querySelector('[data-testid="wl-trigger-card-approve-pop"] [data-confirm="cancel"]').click()`,
  )
  await sleep(400)
  await mouseClick(session, await centerOf(session, `${TAIL} [data-testid="wl-trigger"]`))
  await sleep(600)
  await mouseClick(session, await centerOf(session, `${HOOK} [data-testid="wl-trigger"]`))
  await sleep(600)
  await mouseClick(session, await centerOf(session, `${TAIL} [data-testid="wl-trigger"]`))
  await sleep(800)
  check(
    '取消后再选中卡片，确认卡不再自己弹出',
    await session.evaluate(`document.querySelector('[data-testid$="approve-pop"]') === null`),
  )
  // 面板里的开关同样在它旁边问。
  await session.evaluate(clickTestId('wl-trigger-enable'))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-trigger-approve-pop"]') !== null`,
  )

  const served2 = env.mock.requests.length
  await session.evaluate(clickTestId('wl-trigger-approve'))
  const listening = await waitTrigger(NAME2, 'tail', (view) => view.state === 'listening')
  check(
    '确认后打开，监听程序在跑',
    listening?.enabled === true && listening.approved === true && listening.state === 'listening',
    JSON.stringify(listening),
  )
  const body2 = await waitModel(env.mock, served2, /ERROR pay timeout/u)
  check('程序打出的报错发到了模型', /ERROR pay timeout/u.test(body2))
  check('不含关键字的那行被过滤掉', !/INFO 启动好了/u.test(body2))
  const tailHistory = await rpc('trigger/history', { workflow: NAME2, node: 'tail' })
  check(
    '触发记录：监听程序、已发出',
    tailHistory.fires.length === 1 &&
      tailHistory.fires[0].channel === 'listen' &&
      tailHistory.fires[0].outcome === 'sent',
    JSON.stringify(tailHistory.fires),
  )
  await sleep(5500)
  const tailOn = await session.evaluate(textOf(TAIL))
  check('卡片写着接收中', /接收中/.test(tailOn), tailOn)
  await session.evaluate(clickTestId('wl-trigger-output-toggle'))
  await sleep(1500)
  const output = await session.evaluate(textOf('[data-testid="wl-trigger-output-text"]'))
  check(
    '最近的输出里有两行',
    /INFO 启动好了/.test(output) && /ERROR pay timeout/.test(output),
    output.slice(0, 300),
  )
  await capture(session, 'listen-on-light.png')
  await capture(session, 'card-listen-light.png', await session.evaluate(boxOf(TAIL)), 2)

  // 命令改了：停下来等重新确认。
  const before = await rpc('graph/load', { name: NAME2 })
  const changed = structuredClone(before.document)
  const tailNode = changed.nodes.find((node) => node.id === 'tail')
  tailNode.data.source.command = `${COMMAND} --again`
  await rpc('graph/save', { name: NAME2, document: changed, baseHash: before.hash })
  const confirm = await waitTrigger(NAME2, 'tail', (view) => view.state === 'confirm')
  check(
    '改了命令要重新确认',
    confirm?.state === 'confirm' && confirm.enabled === true && confirm.approved === false,
    JSON.stringify(confirm),
  )
  await sleep(5500)
  const tailConfirm = await session.evaluate(textOf(TAIL))
  check('卡片写着待确认', /待确认/.test(tailConfirm), tailConfirm)
  await rpc('trigger/set', { workflow: NAME2, node: 'tail', enabled: false })

  // HTTP：开关直接打开（没有命令），给地址和令牌；地址用设置里的端口。
  await mouseClick(session, await centerOf(session, `${HOOK} [role="switch"]`))
  const hook = await waitTrigger(NAME2, 'hook', (view) => view.state === 'listening')
  const url = hook?.endpoint?.url ?? ''
  check(
    'HTTP 打开后有地址和令牌，用设置里的端口',
    url.startsWith(`http://127.0.0.1:${port}/trigger/`) &&
      (hook?.endpoint?.token ?? '').length > 20,
    JSON.stringify(hook),
  )
  await mouseClick(session, await centerOf(session, `${HOOK} [data-testid="wl-trigger-state"]`))
  await sleep(1500)
  const shownUrl = await session.evaluate(textOf('[data-testid="wl-trigger-url"]'))
  check('面板上写着地址', shownUrl === url, shownUrl)
  const masked = await session.evaluate(
    `document.querySelector('[data-testid="wl-trigger-token"]')?.dataset.masked`,
  )
  check('令牌默认遮住', masked === 'true', String(masked))
  await capture(session, 'http-panel-light.png')

  const denied = await fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong' },
    body: 'x',
  })
  check('令牌不对回 401', denied.status === 401, String(denied.status))
  const served3 = env.mock.requests.length
  const accepted = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${hook.endpoint.token}` },
    body: '{"pipeline":"nightly","status":"failed"}',
  })
  check('令牌对了回 202', accepted.status === 202, String(accepted.status))
  const body3 = await waitModel(env.mock, served3, /pipeline/u)
  check('请求体作为背景信息发到了模型', /nightly/u.test(body3) && /status/u.test(body3))

  // 换触发源：HTTP 换成条件轮询，出现命令框；卡片上的字跟着变。
  await session.evaluate(clickTestId('wl-trigger-source-poll'))
  await sleep(1500)
  const commandBox = await session.evaluate(
    `document.querySelector('[data-testid="wl-trigger-command"]') !== null`,
  )
  check('换成条件轮询后出现命令框', commandBox)
  const hookText = await session.evaluate(textOf(HOOK))
  check('卡片写着每 5 分钟检查', /每 5 分钟检查/.test(hookText), hookText)
  await capture(session, 'poll-panel-light.png')

  // ── 接续触发：hook 换成「等夜间巡检跑完」────────────────────
  const upstream = await rpc('graph/load', { name: NAME })
  await rpc('graph/save', {
    name: NAME,
    document: {
      ...upstream.document,
      settings: { ...(upstream.document.settings ?? {}), runState: true },
    },
    baseHash: upstream.hash,
  })
  await session.evaluate(clickTestId('wl-trigger-source-after'))
  await sleep(800)
  await session.evaluate(clickTestId('wl-trigger-after'))
  await sleep(400)
  const afterOptions = await session.evaluate(
    `[...document.querySelectorAll('[data-testid^="wl-trigger-after-"][role="menuitemradio"]')].map((el) => el.textContent)`,
  )
  check(
    '接续：下拉里有别的工作流、没有自己',
    afterOptions.includes(NAME) && !afterOptions.includes(NAME2),
    JSON.stringify(afterOptions),
  )
  await session.evaluate(clickTestId(`wl-trigger-after-${NAME}`))
  await sleep(400)
  await session.evaluate(clickTestId('wl-trigger-after-when-any'))
  await sleep(600)
  const afterCard = await session.evaluate(textOf(HOOK))
  check('卡片写着「夜间巡检」跑完后', afterCard.includes(`「${NAME}」跑完后`), afterCard)
  const filterGone = await session.evaluate(
    `document.querySelector('[data-testid="wl-trigger-filter"]') === null`,
  )
  check('接续触发没有过滤', filterGone)
  await capture(session, 'after-panel-light.png')
  // 等自动保存落盘，再打开。
  const savedDeadline = Date.now() + 15_000
  let savedSource
  while (Date.now() < savedDeadline) {
    const loaded = await rpc('graph/load', { name: NAME2 })
    savedSource = loaded.document.nodes.find((node) => node.id === 'hook')?.data.source
    if (savedSource?.kind === 'after' && savedSource.workflow === NAME) break
    await sleep(500)
  }
  check(
    '接续：图里存下等哪个工作流、什么结果',
    savedSource?.kind === 'after' && savedSource.workflow === NAME && savedSource.when === 'any',
    JSON.stringify(savedSource),
  )
  await rpc('trigger/set', { workflow: NAME2, node: 'hook', enabled: true })
  const afterOn = await waitTrigger(NAME2, 'hook', (item) => item.state === 'waiting')
  check('接续：打开后是等待中', afterOn?.state === 'waiting', JSON.stringify(afterOn))

  // 夜间巡检跑完一次（取消也算「不论结果」）：hook 触发，消息里说明是哪个实例。
  const finishedRun = await runs.prepare({
    workflow: NAME,
    document: (await rpc('graph/load', { name: NAME })).document,
    session: { id: 'trigger-session', cwd: WORKSPACE },
  })
  if (!finishedRun.ok) throw new Error(JSON.stringify(finishedRun))
  const finishedId = finishedRun.result.id
  const servedAfter = env.mock.requests.length
  const ended = await runs.state(
    finishedId,
    { id: 'trigger-session', cwd: WORKSPACE },
    { status: 'cancelled' },
  )
  check('实例改成已取消', ended.ok, JSON.stringify(ended))
  const bodyAfter = await waitModel(
    env.mock,
    servedAfter,
    new RegExp(`实例 ${finishedId} 结束了`, 'u'),
    60_000,
  )
  check(
    '接续：那个实例结束后消息发到了模型，带上实例和结果',
    new RegExp(`实例 ${finishedId} 结束了：取消`, 'u').test(bodyAfter),
    bodyAfter.slice(0, 400),
  )
  const afterFired = await waitTrigger(NAME2, 'hook', (item) => item.last?.channel === 'after')
  check(
    '接续：触发记录是接续触发、已发出',
    afterFired?.last?.channel === 'after' && afterFired.last.outcome === 'sent',
    JSON.stringify(afterFired?.last),
  )

  // ── 工作流中心「触发」页 ─────────────────────────────────────
  await session.evaluate(clickTestId('wl-hub-open'))
  await waitFor(session, `document.querySelector('[data-testid="wl-hub-triggers"]') !== null`)
  await session.evaluate(clickTestId('wl-hub-triggers'))
  await waitFor(session, `document.querySelector('[data-testid="wl-hub-trg-page"]') !== null`)
  await waitFor(session, `document.querySelectorAll('[data-testid="wl-hub-trg"]').length >= 3`)
  const rowsHub = await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-hub-trg"]')].map((el) => el.dataset.value)`,
  )
  check(
    // 夜间巡检里还有前面从步骤库拖进来的那一张。
    '「触发」页列出两个工作流里的卡片',
    rowsHub.length === 4 &&
      rowsHub.includes(`${NAME}/nightly`) &&
      rowsHub.includes(`${NAME2}/hook`) &&
      rowsHub.includes(`${NAME2}/tail`),
    JSON.stringify(rowsHub),
  )
  const hookRow = `[data-testid="wl-hub-trg"][data-value="${NAME2}/hook"]`
  await session.evaluate(`document.querySelector('${hookRow}').click()`)
  await sleep(800)
  const historyRows = await session.evaluate(
    `document.querySelectorAll('[data-testid="wl-hub-trg-history"] li').length`,
  )
  check('右栏列出选中卡片的触发记录', historyRows >= 1, String(historyRows))
  const facts = await session.evaluate(textOf('[data-testid="wl-hub-trg-facts"]'))
  check(
    '右栏有何时触发、会话、工作区的摘要',
    /跑完后/.test(facts) && /新建会话/.test(facts) && /工作区/.test(facts),
    facts,
  )
  check(
    '右栏能立即触发一次',
    await session.evaluate(`document.querySelector('[data-testid="wl-hub-trg-fire"]') !== null`),
  )
  await capture(session, 'hub-triggers-light.png')

  // 全部暂停：开关不变，开着的卡片写已全部暂停；恢复后回到等待中。
  await session.evaluate(clickTestId('wl-hub-trg-pause'))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-trg-pausebar"]').dataset.paused === 'true'`,
  )
  const pausedAll = await rpc('trigger/all', {})
  const hookPaused = pausedAll.triggers.find((item) => item.view.node === 'hook')
  check(
    '全部暂停：宿主记下暂停，开着的卡片是已全部暂停、开关不变',
    typeof pausedAll.paused === 'number' &&
      hookPaused?.view.state === 'paused' &&
      hookPaused.view.enabled === true,
    JSON.stringify({ paused: pausedAll.paused, hook: hookPaused?.view }),
  )
  await waitFor(
    session,
    `[...document.querySelectorAll('[data-testid="wl-hub-trg-state"]')].some((el) => el.textContent.includes('已全部暂停'))`,
  )
  const pauseText = await session.evaluate(textOf('[data-testid="wl-hub-trg-pause-text"]'))
  check('总闸写着从什么时候起全部暂停', /起全部暂停/u.test(pauseText), pauseText)
  check(
    '暂停着：右栏只在顶上说一次，状态行不重复',
    await session.evaluate(
      `getComputedStyle(document.querySelector('[data-testid="wl-hub-trg-detail-state"]')).display === 'none' && document.querySelector('[data-testid="wl-hub-trg-paused"]') !== null`,
    ),
  )
  await capture(session, 'hub-triggers-paused-light.png')
  await session.evaluate(scheme('dark'))
  await sleep(400)
  await capture(session, 'hub-triggers-paused-dark.png')
  await session.evaluate(scheme('light'))
  await session.evaluate(clickTestId('wl-hub-trg-pause'))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-trg-pausebar"]').dataset.paused === 'false'`,
  )
  const resumed = await rpc('trigger/all', {})
  check('恢复：不再暂停', resumed.paused === undefined, JSON.stringify(resumed.paused))

  // 行尾的开关就是卡片的开关。
  const hookSwitch = `${hookRow} ~ [data-testid="wl-hub-trg-switch"]`
  await session.evaluate(`document.querySelector('${hookSwitch}').click()`)
  const hookOff = await waitTrigger(NAME2, 'hook', (item) => item.enabled === false, 10_000)
  check('「触发」页的开关关掉了这张卡片', hookOff?.enabled === false, JSON.stringify(hookOff))

  // 在画布上打开：换到夜间巡检，选中夜巡那张。
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-trg"][data-value="${NAME}/nightly"]').click()`,
  )
  await sleep(600)
  await session.evaluate(clickTestId('wl-hub-trg-open'))
  await waitFor(session, `document.querySelector('[data-testid="wl-hub"]') === null`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-trigger-name"]')?.value === '夜巡' || document.querySelector('[data-testid="wl-trigger-name"]')?.textContent === '夜巡'`,
    20_000,
  )
  const selectedCard = await session.evaluate(
    `document.querySelector('${CARD}')?.classList.contains('selected') === true`,
  )
  check('在画布上打开：换到那个工作流并选中这张卡片', selectedCard)
  await rpc('trigger/set', { workflow: NAME2, node: 'hook', enabled: false }).catch(() => {})
  await rpc('trigger/pause', { paused: false }).catch(() => {})
  await rpc('config/set', {
    revision: (await rpc('config/get', {})).revision,
    reset: ['triggerPort'],
  }).catch(() => {})

  // 宿主侧栏自己的一条不算：触发新建的会话出现在侧栏时，它偶尔会报一次打开失败（不是本插件的代码）。
  const errors = session.errors.filter((text) => !text.startsWith('Sidebar Session opening failed'))
  check('页面没有报错', errors.length === 0, errors.slice(0, 5).join(' || ').slice(0, 600))
} catch (error) {
  check('探针跑完', false, error instanceof Error ? (error.stack ?? error.message) : String(error))
  if (session !== undefined) await capture(session, 'failure.png').catch(() => {})
} finally {
  session?.close()
  await env.stop().catch((error) => console.log('stop failed:', error))
  await rm(SHOTS_HOME, { recursive: true, force: true }).catch(() => {})
}

const failed = results.filter((item) => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
