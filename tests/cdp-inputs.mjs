/**
 * 输入节点与步骤样子的真浏览器验收：真指针、真拖放，结论以**磁盘**为准。
 *
 * 走一遍：从步骤库拖一个「单选」输入进来 → 写问题、改选项、设默认、勾必填 → 从输入卡拖线到步骤 →
 * 步骤面板列出它用到的输入、换图标与颜色 → 加几个空白步骤，样子各不相同 → 预览计划里有问题、
 * 回答处写「执行时填写」、说明不进计划 → 点「执行」先弹「执行前填写」，必填的填好才能执行（不真的发出去）→
 * 用回答建一个实例，实例视图里点输入卡看到这次的回答。
 *
 * 不触发模型：「执行前填写」只验到能执行为止就取消；实例走 `run/start`（前端发消息那一步不做），
 * 工作区是临时目录。
 *
 * usage: DSH_WEB_TOKEN=<token> node --experimental-strip-types tests/cdp-inputs.mjs [dark|light]
 */

import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bootToCanvas,
  centerOf,
  dragItemTo,
  mouseClick,
  screenshot,
  setReactInput,
} from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'

const NAME = `inputs-${Date.now().toString(36)}`
const WORKSPACE = join(tmpdir(), `wl-inputs-${Date.now().toString(36)}`)
const theme = process.argv[2] ?? 'light'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let step = 0
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
function pass(message) {
  step += 1
  console.log(`  ${String(step).padStart(2)} ${message}`)
}

async function onDisk(predicate, what) {
  const deadline = Date.now() + 8_000
  let last
  for (;;) {
    last = (await rpc('graph/load', { name: NAME })).document
    if (predicate(last)) return last
    if (Date.now() > deadline)
      throw new Error(`FAIL: 磁盘上等不到 ${what}\n${JSON.stringify(last)}`)
    await sleep(250)
  }
}

const exists = (testId) => `document.querySelector('[data-testid="${testId}"]') !== null`
const click = (selector) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`
const inputsOf = (doc) => doc.nodes.filter((node) => node.type === 'wfInput')
const nodeOf = (doc, id) => doc.nodes.find((node) => node.id === id)

async function pointerDrag(session, from, to, steps = 10) {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y })
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  for (let index = 1; index <= steps; index += 1) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * index) / steps),
      y: Math.round(from.y + ((to.y - from.y) * index) / steps),
      button: 'left',
      buttons: 1,
    })
    await sleep(16)
  }
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
}

async function doubleClick(session, point) {
  for (const clickCount of [1, 2]) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount,
    })
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount,
    })
  }
}

const step2 = (id, label, prompt, x, y) => ({
  id,
  type: 'wfNode',
  position: { x, y },
  data: { label, prompt },
})

const session = await openPage()
let instance = null
try {
  console.log(`# 输入节点验收：${NAME}（${theme}）`)
  await mkdir(WORKSPACE, { recursive: true })
  await rpc('graph/create', { name: NAME })
  const disk = await rpc('graph/load', { name: NAME })
  await rpc('graph/save', {
    name: NAME,
    document: {
      nodes: [
        step2('scan', '侦察', '读代码，摸清现状', 560, 240),
        step2('report', '汇总', '写一份报告', 880, 240),
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
    },
    baseHash: disk.hash,
  })
  await bootToCanvas(session, NAME)
  await session.evaluate(
    `document.querySelector('[data-testid="wl-root"]').style.colorScheme = '${theme}'`,
  )
  await waitFor(session, `document.querySelector('.react-flow__node[data-id="scan"]') !== null`)

  // 1) 步骤库里只有一个「用户输入」；拖进来后在属性面板里切成「单选」。
  check(await session.evaluate(exists('wl-lib-input')), '步骤库里应有「用户输入」')
  const canvasBox = await session.evaluate(`(() => {
    const r = document.querySelector('[data-testid="wl-canvas"]').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`)
  const scanBox = await session.evaluate(`(() => {
    const r = document.querySelector('.react-flow__node[data-id="scan"]').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`)
  await dragItemTo(session, {
    itemTestId: 'wl-lib-input',
    to: { x: Math.round(scanBox.x + 60), y: Math.round(scanBox.y + scanBox.h + 150) },
  })
  await waitFor(session, exists('wl-input'))
  await waitFor(session, exists('wl-input-question'))
  await session.evaluate(
    `document.querySelectorAll('[data-testid="wl-inspector"] [role="radio"]')[2].click()`,
  )
  let doc = await onDisk(
    (d) => inputsOf(d).length === 1 && inputsOf(d)[0].data.kind === 'choice',
    '一个单选输入节点',
  )
  const input = inputsOf(doc)[0]
  check(input.data.kind === 'choice' && input.data.options.length === 2, '切成单选后带两个示例选项')
  const askId = input.id
  pass(`拖入「用户输入」并切成单选 → 输入卡 ${askId} 出现、属性面板打开、已落盘`)

  // 2) 写问题、改选项、加一项再删掉、设默认、勾必填、写说明。
  await setReactInput(session, '[data-testid="wl-input-question"]', '报告用什么语言？')
  await setReactInput(session, '[data-testid="wl-input-option"]', '中文')
  await session.evaluate(`(() => {
    const el = document.querySelectorAll('[data-testid="wl-input-option"]')[1];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'English');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await session.evaluate(click('[data-testid="wl-input-option-add"]'))
  await waitFor(
    session,
    `document.querySelectorAll('[data-testid="wl-input-option"]').length === 3`,
  )
  await session.evaluate(
    `document.querySelectorAll('[data-testid="wl-input-option-remove"]')[2].click()`,
  )
  await session.evaluate(click('[data-testid="wl-input-default-mark"]'))
  await session.evaluate(click('[data-testid="wl-input-required"]'))
  await setReactInput(session, '[data-testid="wl-input-hint"]', '给谁看就用谁的语言')
  doc = await onDisk((d) => {
    const data = nodeOf(d, askId)?.data
    return (
      data?.question === '报告用什么语言？' &&
      JSON.stringify(data.options) === '["中文","English"]' &&
      data.default === '中文' &&
      data.required === true &&
      data.hint === '给谁看就用谁的语言'
    )
  }, '问题、选项、默认值、必填、说明')
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-input"]').textContent.includes('报告用什么语言？')`,
    ),
    '输入卡上应显示问题',
  )
  await sleep(300)
  await screenshot(session, `inputs-01-panel-${theme}.png`)
  pass('写问题、改选项、设默认、勾必填、写说明 → 落盘，卡片跟着变')

  // 3) 从输入卡右边的点拖到步骤上：连上「输入 → 步骤」，线是墨色圆点线。
  const from = await centerOf(
    session,
    `.react-flow__node[data-id="${askId}"] .react-flow__handle.source`,
  )
  const to = await centerOf(session, '.react-flow__node[data-id="scan"]')
  await pointerDrag(session, from, to)
  doc = await onDisk(
    (d) => d.edges.some((edge) => edge.source === askId && edge.target === 'scan'),
    `线 ${askId}->scan`,
  )
  const line = await session.evaluate(`(() => {
    const path = document.querySelector('.react-flow__edge[data-id="${askId}->scan"] path.react-flow__edge-path');
    if (!path) return null;
    const style = getComputedStyle(path);
    return { dash: style.strokeDasharray, stroke: style.stroke };
  })()`)
  check(line !== null, '画布上应有交回答的线')
  check(/^1(px)?,\s*4(px)?$/.test(line.dash), `交回答的线应是圆点线，实际 ${line.dash}`)
  const legend = await session.evaluate(
    `getComputedStyle(document.querySelector('[data-testid="wl-legend"] [data-line="ask"] line')).stroke`,
  )
  check(line.stroke === legend, `线色应和图例的「回答」一致：${line.stroke} / ${legend}`)
  pass('从输入卡拖线到步骤 → 落盘 ask->scan，墨色圆点线，和图例同色')

  // 4) 点步骤：面板列出它用到的输入；换颜色和图标 → 落盘，卡片上的图标块跟着变。
  await mouseClick(
    session,
    await centerOf(session, '.react-flow__node[data-id="scan"] [data-testid="wl-step"]'),
  )
  await waitFor(session, exists('wl-step-inputs'))
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-step-inputs"]').textContent.includes('报告用什么语言？')`,
    ),
    '步骤面板应列出用到的输入',
  )
  await session.evaluate(click('[data-testid="wl-look"]'))
  await waitFor(session, exists('wl-look-color-pink'))
  await session.evaluate(click('[data-testid="wl-look-color-pink"]'))
  await session.evaluate(click('[data-testid="wl-look-icon-bug"]'))
  await onDisk(
    (d) => nodeOf(d, 'scan')?.data.color === 'pink' && nodeOf(d, 'scan')?.data.icon === 'bug',
    'scan 的颜色与图标',
  )
  await waitFor(
    session,
    `document.querySelector('.react-flow__node[data-id="scan"] [data-color="pink"][data-icon="bug"]') !== null`,
  )
  await screenshot(session, `inputs-02-look-${theme}.png`)
  await session.evaluate(click('[data-testid="wl-look-reset"]'))
  await onDisk((d) => nodeOf(d, 'scan')?.data.color === undefined, 'scan 恢复默认样子')
  await session.evaluate(click('[data-testid="wl-look"]'))
  await session.evaluate(click('[data-testid="wl-look"]'))
  await session.evaluate(click('[data-testid="wl-look-color-teal"]'))
  await onDisk((d) => nodeOf(d, 'scan')?.data.color === 'teal', 'scan 改成青色')
  pass('步骤面板列出用到的输入；换颜色、图标、恢复默认 → 落盘，卡片跟着变')

  // 5) 双击空白处加两个空白步骤：各挑一个不重样的图标和颜色。
  for (const dy of [0, 150]) {
    await doubleClick(session, {
      x: Math.round(canvasBox.x + canvasBox.w * 0.62),
      y: Math.round(canvasBox.y + canvasBox.h * 0.62 + dy),
    })
    await waitFor(session, exists('wl-quick-add'))
    await session.evaluate(click('[data-testid="wl-quick-blank"]'))
    await sleep(300)
  }
  doc = await onDisk(
    (d) => d.nodes.filter((node) => node.type === 'wfNode').length === 4,
    '四个步骤',
  )
  const blanks = doc.nodes.filter((node) => node.id.startsWith('step'))
  check(blanks.length === 2, '应有两个空白步骤')
  const looks = doc.nodes
    .filter((node) => node.type === 'wfNode')
    .map((node) => `${node.data.icon ?? ''}/${node.data.color ?? ''}`)
  check(
    blanks.every((node) => node.data.icon !== undefined && node.data.color !== undefined),
    '新步骤应带上图标与颜色',
  )
  check(
    new Set(blanks.map((node) => node.data.icon)).size === 2,
    `两个新步骤图标不该重样：${looks}`,
  )
  check(
    new Set(blanks.map((node) => node.data.color)).size === 2,
    `两个新步骤颜色不该重样：${looks}`,
  )
  // 空白步骤没有提示词会挡执行：删掉它们。
  for (const node of blanks) {
    await mouseClick(session, await centerOf(session, `.react-flow__node[data-id="${node.id}"]`))
    await waitFor(session, exists('wl-delete-node'))
    await session.evaluate(click('[data-testid="wl-delete-node"]'))
    await sleep(200)
  }
  await onDisk((d) => d.nodes.filter((node) => node.type === 'wfNode').length === 2, '删掉空白步骤')
  pass(
    `新加的步骤各挑一个不重样的样子（${blanks.map((node) => `${node.data.icon}/${node.data.color}`).join('、')}）`,
  )

  // 6) 再拖一个「一句话」进来，必填、没有默认值，不连步骤。
  await dragItemTo(session, {
    itemTestId: 'wl-lib-input',
    to: { x: Math.round(scanBox.x + 60), y: Math.round(scanBox.y - 130) },
  })
  doc = await onDisk((d) => inputsOf(d).length === 2, '第二个输入节点')
  const textId = inputsOf(doc).find((node) => node.id !== askId).id
  await waitFor(session, exists('wl-input-question'))
  await setReactInput(session, '[data-testid="wl-input-question"]', '重点看哪个目录？')
  await setReactInput(session, '[data-testid="wl-input-placeholder"]', '比如 src/')
  await session.evaluate(click('[data-testid="wl-input-required"]'))
  await onDisk(
    (d) =>
      nodeOf(d, textId)?.data.required === true &&
      nodeOf(d, textId)?.data.placeholder === '比如 src/',
    '第二个输入必填、带占位',
  )
  pass(`再加一个「一句话」输入 ${textId}：必填、带占位、不连步骤`)

  // 7) 预览计划：问题进「本次执行」，回答处写「执行时由用户填写」；说明与占位不进计划。
  await session.evaluate(click('[data-testid="wl-preview"]'))
  await waitFor(session, exists('wl-plan'))
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-plan-text"]')?.textContent ?? '').includes('用户输入')`,
    { timeoutMs: 15_000 },
  )
  const planText = await session.evaluate(
    `document.querySelector('[data-testid="wl-plan-text"]').textContent`,
  )
  check(planText.includes('报告用什么语言？'), '预览里应有问题')
  check(planText.includes('执行时由用户填写'), '预览里回答处应写「执行时由用户填写」')
  check(planText.includes('交给所有步骤'), '没连步骤的输入应写「交给所有步骤」')
  check(!planText.includes('给谁看就用谁的语言'), '说明不该进计划')
  check(!planText.includes('比如 src/'), '占位不该进计划')
  await session.evaluate(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await sleep(300)
  if (await session.evaluate(exists('wl-plan'))) {
    await session.evaluate(
      `document.querySelector('[data-testid="wl-plan"] button[aria-label]')?.click()`,
    )
  }
  await waitFor(session, `document.querySelector('[data-testid="wl-plan"]') === null`)
  pass('预览计划：问题与交给谁进计划，回答处写「执行时由用户填写」，说明、占位不进计划')

  // 8) 点「执行」：先弹「执行前填写」；必填的没填不能执行，填好就能执行（这里取消，不真的发出去）。
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-start"]')?.getAttribute('aria-disabled') === 'false'`,
  )
  await session.evaluate(click('[data-testid="wl-run-start"]'))
  await waitFor(session, exists('wl-ask'))
  const questions = await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-ask-question"]')].map((el) => el.dataset.id)`,
  )
  check(
    JSON.stringify(questions) === JSON.stringify([textId, askId]),
    `问题应按画布上从上到下排：${questions}`,
  )
  check(await session.evaluate(exists('wl-ask-missing')), '必填的没填：应提示还差几个')
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-ask-run"]').disabled`),
    '必填的没填：执行按钮应禁用',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-ask-option"][aria-pressed="true"]')?.textContent.includes('中文')`,
    ),
    '单选应预先选中默认值',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-ask-text"]').placeholder === '比如 src/'`,
    ),
    '输入框里应有占位文字',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-ask"]').textContent.includes('给谁看就用谁的语言')`,
    ),
    '填写时应看到说明',
  )
  await sleep(500)
  await screenshot(session, `inputs-03-ask-missing-${theme}.png`)
  await setReactInput(session, '[data-testid="wl-ask-text"]', 'src/host')
  await waitFor(session, `document.querySelector('[data-testid="wl-ask-run"]').disabled === false`)
  await screenshot(session, `inputs-04-ask-ready-${theme}.png`)
  await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-ask"] button')].find((el) => el.textContent.trim() === '取消').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-ask"]') === null`)
  pass('点「执行」先弹「执行前填写」：按画布顺序、默认值预选、占位与说明可见；必填填好才能执行')

  // 9) 带回答建实例（前端发消息那一步不做）：实例视图里点输入卡，看到这次的回答。
  const origin = await session.evaluate(
    `document.querySelector('[data-testid="wl-root"]').dataset.session`,
  )
  const started = await rpc('run/start', {
    workflow: NAME,
    session: origin,
    cwd: WORKSPACE,
    answers: { [textId]: 'src/host', [askId]: 'English' },
  })
  instance = started.instance.id
  await waitFor(session, exists('wl-fresh-run'), { timeoutMs: 20_000 })
  await session.evaluate(click('[data-testid="wl-fresh-run"] button'))
  await waitFor(session, `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`)
  await waitFor(session, `document.querySelector('.react-flow__node[data-id="${askId}"]') !== null`)
  await sleep(600)
  await mouseClick(session, await centerOf(session, `.react-flow__node[data-id="${askId}"]`))
  await waitFor(session, exists('wl-run-input'))
  const answer = await session.evaluate(
    `document.querySelector('[data-testid="wl-run-input-answer"]').textContent`,
  )
  check(answer.includes('English'), `实例视图里应看到回答 English，实际 ${answer}`)
  await screenshot(session, `inputs-05-run-${theme}.png`)
  pass('带回答建实例 → 实例视图里点输入卡，右栏是这次的回答')
  console.log('\n✅ 输入节点验收全部通过')
} catch (error) {
  await screenshot(session, `inputs-fail-${theme}.png`).catch(() => {})
  console.error(
    `\n❌ 第 ${step + 1} 步失败：${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
} finally {
  if (instance !== null) await rpc('run/delete', { id: instance, withState: true }).catch(() => {})
  await rpc('graph/delete', { name: NAME }).catch(() => {})
  await rm(WORKSPACE, { recursive: true, force: true }).catch(() => {})
  session.close()
}
