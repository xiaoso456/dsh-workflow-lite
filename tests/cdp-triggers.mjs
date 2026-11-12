/**
 * 触发卡片的浏览器验收：自备一次性实例（假模型、一次性的家、随机端口，不用 `DSH_WEB_TOKEN`），
 * 建一张带触发卡片的工作流，在真浏览器里走一遍：卡片与面板、没选工作区时开不了、开关与下一次时间、
 * 立即触发（新建会话、消息到达模型）、触发记录、改规则、从步骤库拖入、实例概览与工作流中心里的来源。
 * 结论以磁盘 / RPC 为准；截图落在 `tests/runs/trigger/`，给人看一眼样子。
 *
 * 假模型不调工具，所以「模型带着触发编号编译 → 实例认领来源」这一段不在这里（见 `tests/host/triggers.spec.ts`）；
 * 实例的来源是直接在同一个数据目录里建一个带来源的实例来看界面。
 *
 * 前置：一个带 DevTools 端口的 Chrome（`node tests/lib/cdp-chrome-launch.mjs 9222`），`pnpm run build` 过。
 * usage: node --experimental-strip-types tests/cdp-triggers.mjs
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunService } from '../src/host/runs/service.ts'
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

  // 立即触发一次，带背景信息：假模型收到消息，记录里多一条。
  const served = env.mock.requests.length
  await session.evaluate(`(() => {
    const el = document.querySelector('[data-testid="wl-trigger-info"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, '昨晚 CI 挂了两次，重点看 build 脚本。');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(300)
  await session.evaluate(clickTestId('wl-trigger-fire'))
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
