/**
 * 工作流视图的真浏览器验收：真指针、真键盘、真拖放，结论以**磁盘**为准。
 *
 * 走一遍新用户会走的路：空图 → 从步骤库拖一个进来（带着它的产出资源卡）→ 点「＋」接一步 →
 * 双击空白处加空白步骤并写提示词 → 拖线连接 → 改连线条件 → 删除与撤销 → 资源卡（新建产出、
 * 改说明、读取、更新、改路径）→ 整理布局 → 预览计划 → 改名 → 删除。
 * 每一步都读回 `graph/load` 确认真的落了盘，而不是只看界面。
 *
 * 前置：测试实例在跑（`dsh --profile workflow-lite-dev --port 3190`），headless Chrome 开着
 * DevTools 端口；环境变量同 `tests/e2e-canvas.mjs`（`DSH_WEB_TOKEN` 等）。
 *
 * usage: DSH_WEB_TOKEN=<token> node tests/cdp-ui.mjs
 */

import {
  bootToCanvas,
  centerOf,
  dragItemTo,
  MOD,
  mouseClick,
  mouseMove,
  pressKey,
  pressShortcut,
  screenshot,
  setReactInput,
} from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'

const NAME = `ui-${Date.now().toString(36)}`
const RENAMED = `${NAME}-renamed`
const STEP = `${NAME}-step`
const CONDITION = '测试全部通过，并且没有新增 lint 警告，同时改动说明里写清楚了验证方法'
const RULE = '按优先级列出风险，每条写清影响范围与应对办法'
const IMPL_RULE = '改动说明：改了哪些文件、为什么这么改、如何验证，附上验证命令的输出。'
const STEP_NEW = `${NAME}-new`
const NOTE = '按 changes.md 逐条执行，做完的条目在原文件里打钩'
const FILE_RULE = '风险清单，每条一行「- [ ] 风险：应对」，处理完打钩'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let step = 0
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
function pass(message) {
  step += 1
  console.log(`  ${String(step).padStart(2)} ${message}`)
}

/** 等保存落盘：状态回到「已保存」且磁盘上的文档满足条件。 */
async function onDisk(name, predicate, what) {
  const deadline = Date.now() + 8_000
  let last
  for (;;) {
    last = (await rpc('graph/load', { name })).document
    if (predicate(last)) return last
    if (Date.now() > deadline)
      throw new Error(`FAIL: 磁盘上等不到 ${what}\n${JSON.stringify(last)}`)
    await sleep(250)
  }
}

/** 步骤的 id（资源卡另算）。 */
const idsOf = (doc) =>
  doc.nodes
    .filter((node) => node.type !== 'wfResource')
    .map((node) => node.id)
    .sort()
/** 放着这个文件的资源卡（产出文件是资源里的一个 `file` 项，生成要求写在它的说明里）。 */
const fileOf = (doc, path) =>
  doc.nodes.find(
    (node) =>
      node.type === 'wfResource' &&
      node.data.items.some((item) => item.kind === 'file' && item.value === path),
  )
const noteOf = (doc, path) =>
  fileOf(doc, path)?.data.items.find((item) => item.kind === 'file' && item.value === path)?.note
const isResourceId = (doc, id) =>
  doc.nodes.some((node) => node.id === id && node.type === 'wfResource')
/** 步骤之间的线（连着资源卡的读写线另算）。 */
const edgeIds = (doc) =>
  doc.edges
    .filter((edge) => !isResourceId(doc, edge.source) && !isResourceId(doc, edge.target))
    .map((edge) => edge.id)
    .sort()

/** 某个步骤卡上某个连接点的屏幕中心。 */
async function handleCenter(session, nodeId, type) {
  return centerOf(
    session,
    `.react-flow__node[data-id=${JSON.stringify(nodeId)}] .react-flow__handle.${type}`,
  )
}

/** 一条连线的中点（屏幕坐标），用来"点在线上"。 */
async function edgeMidpoint(session, edgeId) {
  const point = await session.evaluate(`(() => {
    const path = document.querySelector('.react-flow__edge[data-id=' + JSON.stringify(${JSON.stringify(edgeId)}) + '] path.react-flow__edge-path');
    if (!path) return null;
    const mid = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM();
    return { x: Math.round(mid.x * m.a + m.e), y: Math.round(mid.y * m.d + m.f) };
  })()`)
  if (point === null) throw new Error(`找不到连线 ${edgeId}`)
  return point
}

async function pointerDrag(session, from, to, steps = 8, { release = true } = {}) {
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
  if (!release) return
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

const exists = (testId) => `document.querySelector('[data-testid="${testId}"]') !== null`
const clickTestId = (testId) =>
  `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) return false; el.click(); return true })()`

/** 打开资源面板里第一项的编辑框（产出资源里只有那一个文件）。 */
async function openFirstItem(session) {
  await waitFor(session, exists('wl-resource-item'))
  // 一行是 <li>，里面第一个按钮（图标 + 名字 + 位置）才是「打开它」。
  await session.evaluate(
    `document.querySelector('[data-testid="wl-resource-item"] button').click()`,
  )
  await waitFor(session, exists('wl-resource-item-dialog'))
}

/** 编辑框里点「完成」，等它关上。 */
async function saveItem(session) {
  await session.evaluate(clickTestId('wl-resource-item-done'))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-resource-item-dialog"]') === null`,
  )
}

async function run(session) {
  console.log(`# 工作流视图验收：${NAME}`)
  await rpc('graph/create', { name: NAME })
  await bootToCanvas(session, NAME)

  // 1) 空图：空态说明在，示例按钮在；检查结果不亮红。
  await waitFor(session, exists('wl-empty'))
  check(await session.evaluate(exists('wl-starter')), '空态里应有「插入示例流程」')
  check(!(await session.evaluate(exists('wl-issues'))), '空图不该亮检查结果')
  await screenshot(session, 'ui-01-empty.png')
  pass('空图显示空态')

  // 2) 从步骤库拖「侦察」到画布中间。
  const canvasBox = await session.evaluate(`(() => {
    const r = document.querySelector('[data-testid="wl-canvas"]').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`)
  const center = {
    x: Math.round(canvasBox.x + canvasBox.w * 0.45),
    y: Math.round(canvasBox.y + canvasBox.h * 0.45),
  }
  const { data } = await dragItemTo(session, { itemTestId: 'wl-lib-preset-scan', to: center })
  check(
    data.items.some((item) => item.mimeType === 'application/x-workflow-lite-step'),
    '拖出来的数据里应有自家 MIME',
  )
  await waitFor(session, `document.querySelector('.react-flow__node[data-id="scan"]') !== null`)
  await waitFor(session, exists('wl-inspector'))
  // 内置步骤带着它的产出：一张只放 scan-notes.md 的资源卡，连着 scan 的写入线。
  await onDisk(
    NAME,
    (doc) =>
      idsOf(doc).join() === 'scan' &&
      fileOf(doc, 'scan-notes.md')?.id === 'res-scan-notes' &&
      doc.edges.some((edge) => edge.source === 'scan' && edge.target === 'res-scan-notes'),
    '步骤 scan 与它的产出资源卡',
  )
  await waitFor(
    session,
    `document.querySelector('.react-flow__node[data-id="res-scan-notes"] [data-testid="wl-resource"]') !== null`,
  )
  pass('拖入「侦察」→ 画布出现（带着产出资源卡）、属性面板打开、已落盘')

  // 3) 点 scan 右侧的「＋」→ 就地菜单 → 选「实现」：接在后面并连上。
  await mouseClick(session, await handleCenter(session, 'scan', 'source'))
  await waitFor(session, exists('wl-quick-add'))
  await session.evaluate(clickTestId('wl-quick-implement'))
  await waitFor(
    session,
    `document.querySelector('.react-flow__node[data-id="implement"]') !== null`,
  )
  const afterPlus = await onDisk(NAME, (doc) => edgeIds(doc).length === 1, '连线 scan->implement')
  check(
    edgeIds(afterPlus).join() === 'scan->implement',
    `应连上 scan->implement：${edgeIds(afterPlus)}`,
  )
  const scanAt = afterPlus.nodes.find((node) => node.id === 'scan').position
  const planAt = afterPlus.nodes.find((node) => node.id === 'implement').position
  check(planAt.x > scanAt.x, '「添加下一步」应落在右边')
  pass('点「＋」添加下一步 → 自动连线、落在右侧')

  // 4) 双击空白处 → 空白步骤，提示词弹窗直接进编辑、光标在里面；打字落盘。
  const blankAt = {
    x: Math.round(canvasBox.x + canvasBox.w * 0.45),
    y: Math.round(canvasBox.y + canvasBox.h * 0.78),
  }
  await doubleClick(session, blankAt)
  await waitFor(session, exists('wl-quick-add'))
  await session.evaluate(clickTestId('wl-quick-blank'))
  await waitFor(session, `document.querySelector('.react-flow__node[data-id="step"]') !== null`)
  await waitFor(session, `document.activeElement?.getAttribute('data-testid') === 'wl-ins-prompt'`)
  await session.send('Input.insertText', { text: '检查所有测试是否通过。' })
  await onDisk(
    NAME,
    (doc) => doc.nodes.find((node) => node.id === 'step')?.data.prompt === '检查所有测试是否通过。',
    'step 的提示词',
  )
  // 提示词在弹窗里写：Esc 关上，右栏那一截是写好的内容。
  await session.evaluate(
    `document.querySelector('[data-testid="wl-ins-prompt-card-viewer"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-ins-prompt-card-viewer"]') === null`,
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-ins-prompt-card-card"]').textContent`,
    )) === '检查所有测试是否通过。',
    '关上弹窗后右栏应露出写好的提示词',
  )
  pass('双击空白处加空白步骤 → 提示词弹窗直接进编辑、输入落盘')

  // 5) 从 implement 的出口拖线到 step 的入口。
  await pointerDrag(
    session,
    await handleCenter(session, 'implement', 'source'),
    await handleCenter(session, 'step', 'target'),
  )
  await onDisk(NAME, (doc) => edgeIds(doc).includes('implement->step'), '连线 implement->step')
  pass('拖线连接 implement → step')

  // 6) 点中连线 → 属性面板改成「未通过」→ 边 id 跟着变。
  await mouseClick(session, await edgeMidpoint(session, 'scan->implement'))
  await waitFor(session, `document.querySelector('[data-testid="wl-delete-edge"]') !== null`)
  await session.evaluate(`(() => {
    const radio = [...document.querySelectorAll('[data-testid="wl-inspector"] [role="radio"]')][2];
    radio.click();
  })()`)
  await onDisk(NAME, (doc) => edgeIds(doc).includes('scan->implement#fail'), '连线条件 fail')
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-delete-edge"]') !== null`),
    '改条件后连线面板应仍然开着（选中跟着新 id 走）',
  )
  // 线色跟着条件走：未通过的线是图例里「未通过」的颜色，没条件的线是「总是」的颜色。
  const strokeOf = (id) =>
    `getComputedStyle(document.querySelector('.react-flow__edge[data-id="${id}"] path.react-flow__edge-path')).stroke`
  const legendStroke = (line) =>
    `getComputedStyle(document.querySelector('[data-testid="wl-legend"] [data-line="${line}"] line')).stroke`
  await waitFor(session, `${strokeOf('scan->implement#fail')} === ${legendStroke('fail')}`)
  check(
    await session.evaluate(`${strokeOf('implement->step')} === ${legendStroke('always')}`),
    '没有条件的线应是「总是」的颜色',
  )
  await screenshot(session, 'ui-02-edge.png')
  pass('选中连线并改为「未通过」→ 落盘为 scan->implement#fail')

  // 7) Delete 删连线 → Ctrl+Z 撤回。
  await pressKey(session, 'Delete')
  await onDisk(NAME, (doc) => !edgeIds(doc).includes('scan->implement#fail'), '删掉连线')
  await pressShortcut(session, 'z')
  await onDisk(NAME, (doc) => edgeIds(doc).includes('scan->implement#fail'), '撤销后连线回来')
  pass('Delete 删连线、Ctrl+Z 撤回')

  // 7b) 自定义条件：一整句自然语言，可以很长；线上截断显示，悬停看全文。
  await mouseClick(session, await edgeMidpoint(session, 'scan->implement#fail'))
  await waitFor(session, exists('wl-delete-edge'))
  await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-inspector"] [role="radio"]')][3].click()`,
  )
  await waitFor(session, exists('wl-edge-custom'))
  await setReactInput(session, '[data-testid="wl-edge-custom"]', CONDITION)
  await onDisk(NAME, (doc) => edgeIds(doc).includes(`scan->implement#${CONDITION}`), '自定义条件')
  check(
    !(await session.evaluate(
      `document.querySelector('[data-testid="wl-inspector"] p')?.textContent?.includes('只能用文字') === true`,
    )),
    '合法的长条件不该报错',
  )
  await waitFor(
    session,
    `${strokeOf(`scan->implement#${CONDITION}`)} === ${legendStroke('custom')}`,
  )
  const conditionLabel = `[...document.querySelectorAll('.react-flow__edgelabel-renderer button[data-when]')].find((el) => el.dataset.tip === ${JSON.stringify(CONDITION)})`
  check(
    await session.evaluate(`${conditionLabel} !== undefined`),
    '线上的长条件应带一份全文悬停提示',
  )
  await mouseMove(
    session,
    await session.evaluate(`(() => {
    const r = ${conditionLabel}.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`),
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-tip"]')?.textContent === ${JSON.stringify(CONDITION)}`,
  )
  const tipBox = await session.evaluate(`(() => {
    const tip = document.querySelector('[data-testid="wl-tip"]').getBoundingClientRect();
    const root = document.querySelector('[data-testid="wl-root"]').getBoundingClientRect();
    return { w: tip.width, h: tip.height, inside: tip.left >= root.left && tip.right <= root.right && tip.top >= root.top && tip.bottom <= root.bottom };
  })()`)
  check(
    tipBox.w <= 320 && tipBox.h > 24,
    `长条件的提示应折行、不超过 320 宽：${JSON.stringify(tipBox)}`,
  )
  check(tipBox.inside, '提示应整个落在视图里')
  await sleep(200)
  await screenshot(session, 'ui-02b-condition.png')
  pass('自定义条件写一整句话 → 落盘，线上截断、悬停看全文（共用提示浮层，折行）')

  // 7b') 悬停提示：顶栏最左边的按钮提示夹在视图里；扫到相邻按钮立刻换；按下就收。
  const tipText = `document.querySelector('[data-testid="wl-tip"]')?.textContent ?? null`
  await mouseMove(session, { x: 5, y: 5 })
  await waitFor(session, `${tipText} === null`)
  const hubButton = await session.evaluate(`(() => {
    const el = document.querySelector('[data-testid="wl-hub-open"]');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tip: el.dataset.tip };
  })()`)
  await mouseMove(session, hubButton)
  await waitFor(session, `${tipText} === ${JSON.stringify(hubButton.tip)}`)
  check(
    await session.evaluate(`(() => {
      const tip = document.querySelector('[data-testid="wl-tip"]').getBoundingClientRect();
      const root = document.querySelector('[data-testid="wl-root"]').getBoundingClientRect();
      return tip.left >= root.left + 8 && tip.top > ${hubButton.y};
    })()`),
    '贴左边的按钮：提示在下方、左边不出视图',
  )
  const undoAt = await centerOf(session, '[data-testid="wl-undo"]')
  await mouseMove(session, undoAt)
  await sleep(60)
  check(
    (await session.evaluate(tipText))?.startsWith('撤销') === true,
    `刚看过一个提示，扫到相邻按钮应立刻换：${await session.evaluate(tipText)}`,
  )
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: undoAt.x,
    y: undoAt.y,
    button: 'left',
    clickCount: 1,
  })
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: undoAt.x,
    y: undoAt.y,
    button: 'left',
    clickCount: 1,
  })
  await sleep(500)
  check((await session.evaluate(tipText)) === null, '按下按钮后提示收起，指针不离开不再弹')
  // 刚才那下点了撤销：重做回来，后面的步骤接着用这条条件。
  await pressShortcut(session, 'z', ['ctrl', 'shift'])
  await onDisk(
    NAME,
    (doc) => edgeIds(doc).includes(`scan->implement#${CONDITION}`),
    '重做回自定义条件',
  )
  pass('悬停提示：夹在视图里、相邻按钮立刻换、按下就收')

  // 7c) 资源卡：内置步骤插进来时带着它的产出资源卡；步骤面板里「新建产出文件」再加一张，连上写入线。
  check(
    await session.evaluate(
      `document.querySelector('.react-flow__node[data-id="res-changes"] [data-testid="wl-resource"]') !== null`,
    ),
    '内置「实现」插进来时应带着它的产出资源卡',
  )
  await mouseClick(session, await centerOf(session, '.react-flow__node[data-id="implement"]'))
  await waitFor(session, exists('wl-resource-new'))
  const writesOf = `[...document.querySelectorAll('[data-testid="wl-step-resources"] [data-testid="wl-step-resource"]')].filter((el) => el.querySelector('[data-access="produce"]'))`
  check(
    (await session.evaluate(`${writesOf}.map((el) => el.textContent).join('|')`)).includes(
      'changes.md',
    ),
    '步骤面板的「资源」里应列出它写的 changes.md',
  )
  // 内置步骤的生成要求跟着进了资源：写在 changes.md 这一项的说明里。
  await onDisk(NAME, (doc) => noteOf(doc, 'changes.md') === IMPL_RULE, 'changes.md 的生成要求')
  await session.evaluate(clickTestId('wl-resource-new'))
  await waitFor(session, exists('wl-output-dialog'))
  check(
    (await session.evaluate(`document.querySelector('[data-testid="wl-output-path"]').value`)) ===
      'implement.md',
    '新建产出文件应预填一个没被占用的文件名',
  )
  await setReactInput(session, '[data-testid="wl-output-path"]', 'impl-risks.md')
  await setReactInput(session, '[data-testid="wl-output-rule"]', RULE)
  await sleep(350)
  await screenshot(session, 'ui-02c-dialog.png')
  await session.evaluate(clickTestId('wl-output-done'))
  await waitFor(session, `document.querySelector('[data-testid="wl-output-dialog"]') === null`)
  const withFile = await onDisk(
    NAME,
    (doc) =>
      noteOf(doc, 'impl-risks.md') === RULE &&
      doc.edges.some(
        (edge) => edge.source === 'implement' && edge.target === fileOf(doc, 'impl-risks.md').id,
      ),
    '新资源卡与 implement 的写入线',
  )
  check((await session.evaluate(`${writesOf}.length`)) === 2, '步骤面板里应列出两份写入的资源')
  const risksId = fileOf(withFile, 'impl-risks.md').id
  await sleep(400)
  await screenshot(session, 'ui-02c-files.png')
  pass('资源卡：内置步骤带着产出卡；「新建产出文件」→ 新卡 + 写入线落盘')

  // 7d) 资源卡上悬停：写它、读它的步骤标出角色，其余淡下去；点开改说明，读写线跟着节点走。
  const risksCard = `.react-flow__node[data-id=${JSON.stringify(risksId)}]`
  await waitFor(session, `document.querySelector('${risksCard}') !== null`)
  // 新卡落在画布最下面，可能被左下角的缩放条（带图例）压住：先看全图。
  await session.evaluate(clickTestId('wl-fit'))
  await sleep(500)
  await mouseMove(session, await centerOf(session, risksCard))
  await waitFor(
    session,
    `document.querySelector('.react-flow__node[data-id="implement"] [data-testid="wl-step"]')?.getAttribute('data-role') === 'producer'`,
  )
  check(
    (await session.evaluate(
      `document.querySelector('.react-flow__node[data-id="scan"] [data-testid="wl-step"]').getAttribute('data-dim')`,
    )) === 'true',
    '与这份资源无关的步骤应淡下去',
  )
  await sleep(300)
  await screenshot(session, 'ui-02d-file-hover.png')
  await mouseClick(session, await centerOf(session, risksCard))
  await openFirstItem(session)
  await setReactInput(session, '[data-testid="wl-resource-note"]', FILE_RULE)
  await saveItem(session)
  await onDisk(NAME, (doc) => noteOf(doc, 'impl-risks.md') === FILE_RULE, '资源里文件的说明')
  // 从资源卡右边的点拖到 step 左边 = step 读它。
  await pointerDrag(
    session,
    await centerOf(session, `${risksCard} .react-flow__handle.source[data-handleid="out"]`),
    await handleCenter(session, 'step', 'target'),
  )
  await onDisk(
    NAME,
    (doc) => doc.edges.some((edge) => edge.source === risksId && edge.target === 'step'),
    '读取线 资源 → step',
  )
  // 连上之后选中的是那条新线（面板里是读取说明）；回到资源卡看「读它的步骤」。
  await waitFor(session, exists('wl-delete-edge'))
  await mouseClick(session, await centerOf(session, risksCard))
  await waitFor(session, exists('wl-resource-readers'))
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-resource-readers"]').textContent`,
      )
    ).includes('step'),
    '资源面板应列出读它的步骤',
  )
  // 选中资源卡：连着它的读写线"活"起来——中点标明种类、光带在走（合成线程上的 transform 动画）。
  await waitFor(
    session,
    `(() => {
      const chips = [...document.querySelectorAll('[data-testid="wl-io-chip"][data-active="true"]')].map((el) => el.dataset.access);
      return chips.includes('produce') && chips.includes('read');
    })()`,
  )
  check(
    await session.evaluate(
      `[...document.querySelectorAll('[data-testid="wl-flow-streak"]')].some((el) => el.getAnimations().some((a) => a.playState === 'running'))`,
    ),
    '选中资源卡时，连着它的线上应有流动的光带',
  )
  // 光带的颜色必须是画布上某条线的描边色（不能红线上跑蓝光）。
  check(
    await session.evaluate(`(() => {
      const strokes = new Set([...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].map((el) => getComputedStyle(el).stroke));
      const lit = [...document.querySelectorAll('[data-testid="wl-flow-streak"]')].filter((el) => el.getAnimations().length > 0);
      return lit.length > 0 && lit.every((el) => strokes.has(getComputedStyle(el).color));
    })()`),
    '光带颜色应和它所在的线一致',
  )
  // 八种线（总是 / 通过 / 未通过 / 自定义 / 产出 / 更新 / 读取 / 交回答）各一色，谁也不和谁重样。
  const legendColors = await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-legend"] [data-line] line')].map((el) => getComputedStyle(el).stroke)`,
  )
  check(legendColors.length === 8, `左下角应常驻八种线的图例，实际 ${legendColors.length}`)
  check(new Set(legendColors).size === 8, `八种线的颜色不能重样：${legendColors.join(' / ')}`)
  // 每条线的两头都要落在一个看得见的连接点上（不能悬在卡片边上没有点的地方）。
  const dangling = await session.evaluate(`(() => {
    const dots = [...document.querySelectorAll('.react-flow__handle')]
      .filter((el) => getComputedStyle(el).opacity === '1')
      .map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const bad = [];
    for (const path of document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')) {
      const m = path.getScreenCTM();
      const total = path.getTotalLength();
      for (const at of [0, total]) {
        const p = path.getPointAtLength(at);
        const x = p.x * m.a + m.e, y = p.y * m.d + m.f;
        if (!dots.some((d) => Math.hypot(d.x - x, d.y - y) <= 12)) bad.push(path.closest('.react-flow__edge').dataset.id);
      }
    }
    return bad;
  })()`)
  check(dangling.length === 0, `这些线的端点没有落在连接点上：${dangling.join(', ')}`)
  await screenshot(session, 'ui-02d-file-panel.png')
  pass('资源卡：悬停高亮上下游；面板里改说明；从资源卡拖线到步骤 = 读取')

  // 7e) 工作流设置：产出根目录（带多余斜杠，保存时标准化）+ 执行方式。
  await session.evaluate(clickTestId('wl-settings-open'))
  await waitFor(session, exists('wl-settings'))
  await setReactInput(session, '[data-testid="wl-settings-root"]', 'artifacts//run/')
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-settings-goal"]').getAttribute('aria-checked') === 'true'`,
    ),
    '设定目标缺省应是开',
  )
  // 串行没有子代理、队员：复用执行者那一行不能点。
  await session.evaluate(clickTestId('wl-settings-mode-serial'))
  await sleep(50)
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-settings-reuse-reuse"]').disabled === true`,
    ),
    '串行时复用执行者应不可选',
  )
  await session.evaluate(clickTestId('wl-settings-mode-subagent'))
  await sleep(50)
  await session.evaluate(clickTestId('wl-settings-reuse-reuse'))
  // 开关整行都能点：点说明文字也拨动开关。
  await mouseClick(
    session,
    await centerOf(
      session,
      '[data-testid="wl-settings"] label:has([data-testid="wl-settings-goal"]) > span:nth-child(2) > span:last-child',
    ),
  )
  await sleep(350)
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-settings-goal"]').getAttribute('aria-checked') === 'false'`,
    ),
    '点开关那一行应拨动开关',
  )
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-settings-reuse-desc"]').textContent`,
      )
    ).includes('上次'),
    '复用执行者的说明应跟着选项换',
  )
  // 打开就不该有滚动条：内容放得下。
  check(
    await session.evaluate(`(() => {
      const body = document.querySelector('[data-testid="wl-settings"] form > div');
      return body.scrollHeight <= body.clientHeight;
    })()`),
    '工作流设置打开时不该出现滚动条',
  )
  await screenshot(session, 'ui-02e-settings.png')
  // 说明与拼接示例收在「?」里：平时不在，悬停才浮出。
  check(!(await session.evaluate(exists('wl-settings-root-help-panel'))), '说明平时应收起')
  await mouseMove(session, await centerOf(session, '[data-testid="wl-settings-root-help"]'))
  await waitFor(session, exists('wl-settings-root-help-panel'))
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-settings-preview"]').textContent`,
      )
    ).includes('artifacts/run/'),
    '说明里的拼接示例应跟着输入实时变化',
  )
  check(
    await session.evaluate(
      `!document.querySelector('[data-testid="wl-settings"]').contains(document.querySelector('[data-testid="wl-settings-root-help-panel"]'))`,
    ),
    '说明浮层不该挂在对话框的滚动区里',
  )
  // 鼠标从「?」移进浮层：浮层不收；在里面拖选文字能选中，对话框也不会被关掉。
  const panelBox = await session.evaluate(`(() => {
    const r = document.querySelector('[data-testid="wl-settings-root-help-panel"] li').getBoundingClientRect();
    return { x: Math.round(r.left + 4), y: Math.round(r.top + 8), right: Math.round(r.right - 8) };
  })()`)
  await mouseMove(session, { x: panelBox.x + 20, y: panelBox.y })
  await sleep(500)
  check(await session.evaluate(exists('wl-settings-root-help-panel')), '鼠标移进浮层后浮层应还在')
  await pointerDrag(session, { x: panelBox.x, y: panelBox.y }, { x: panelBox.right, y: panelBox.y })
  await sleep(200)
  check(
    (await session.evaluate('window.getSelection().toString()')).length > 4,
    '浮层里的文字应能拖选',
  )
  check(await session.evaluate(exists('wl-settings-root-help-panel')), '拖选之后浮层应还在')
  check(await session.evaluate(exists('wl-settings')), '在浮层里操作不该关掉对话框')
  await screenshot(session, 'ui-02f-settings-help.png')
  await pressKey(session, 'Escape')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-settings-root-help-panel"]') === null`,
  )
  check(await session.evaluate(exists('wl-settings')), 'Esc 先只收起说明浮层')
  await session.evaluate(clickTestId('wl-settings-done'))
  await waitFor(session, `document.querySelector('[data-testid="wl-settings"]') === null`)
  await onDisk(
    NAME,
    (doc) =>
      doc.settings?.outputRoot === 'artifacts/run' &&
      doc.settings?.mode === 'subagent' &&
      doc.settings?.reuse === 'reuse' &&
      doc.settings?.setGoal === false,
    '工作流设置',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-settings-open"]').getAttribute('data-configured') === 'true'`,
    ),
    '改过设置后顶栏按钮应挂上小点',
  )
  // 资源里的文件：编辑框里预览拼好的最终路径（有步骤写它 = 放在产出根目录下）。
  await mouseClick(session, await centerOf(session, '.react-flow__node[data-id="res-changes"]'))
  await openFirstItem(session)
  await waitFor(session, exists('wl-resource-located'))
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-resource-located"]').textContent`,
      )
    ).includes('artifacts/run/changes.md'),
    '资源里的文件应预览拼好的最终路径',
  )
  await pressKey(session, 'Escape')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-resource-item-dialog"]') === null`,
  )
  pass('工作流设置：根目录标准化落盘、执行方式落盘，资源里的文件预览最终路径')

  // 7f) 交接：步骤之间的线缺省交执行结果（不画标记）；附说明后出现标记、悬停看说明；关掉 = 只管先后。
  const mark = '[data-testid="wl-handoff-mark"][data-edge="implement->step"]'
  check(
    !(await session.evaluate(`document.querySelector('${mark}') !== null`)),
    '缺省的交接不画标记',
  )
  await mouseClick(session, await edgeMidpoint(session, 'implement->step'))
  await waitFor(session, exists('wl-handoff'))
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-handoff-result"]').checked`),
    '缺省应交执行结果',
  )
  await setReactInput(session, '[data-testid="wl-handoff-note"]', NOTE)
  await onDisk(
    NAME,
    (doc) => doc.edges.find((edge) => edge.id === 'implement->step')?.data?.handoff?.note === NOTE,
    '交接说明',
  )
  await waitFor(session, `document.querySelector('${mark}') !== null`)
  await screenshot(session, 'ui-02g-handoff-edit.png')
  await mouseMove(session, await centerOf(session, mark))
  await waitFor(session, exists('wl-handoff-card'))
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-handoff-card"]').textContent`,
      )
    ).includes(NOTE),
    '悬停标记应看到交接说明',
  )
  await sleep(300)
  await screenshot(session, 'ui-02h-handoff-card.png')
  await mouseMove(session, {
    x: Math.round(canvasBox.x + 40),
    y: Math.round(canvasBox.y + canvasBox.h - 40),
  })
  await session.evaluate(clickTestId('wl-handoff-result'))
  await onDisk(
    NAME,
    (doc) => doc.edges.find((edge) => edge.id === 'implement->step')?.data?.handoff === false,
    '只管先后',
  )
  await waitFor(session, `document.querySelector('${mark}')?.getAttribute('data-none') === 'true'`)
  await session.evaluate(clickTestId('wl-handoff-result'))
  await onDisk(
    NAME,
    (doc) => doc.edges.find((edge) => edge.id === 'implement->step')?.data?.handoff?.note === NOTE,
    '再打开时说明还在',
  )
  // 从 step 底边拖到 changes.md 那张资源卡上任意位置：implement 已经在写它，接着写默认是「在原文件上更新」。
  // 拖的过程中只露出能连的点（资源卡左边的入口），松手前指针旁就预告「更新 step → changes.md」。
  const writeFrom = await centerOf(
    session,
    '.react-flow__node[data-id="step"] .react-flow__handle.source[data-handleid="file"]',
  )
  const writeTo = await centerOf(session, '.react-flow__node[data-id="res-changes"]')
  await pointerDrag(session, writeFrom, writeTo, 10, { release: false })
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-link-preview"][data-kind="update"]')?.textContent.includes('changes.md')`,
  )
  check(
    await session.evaluate(`(() => {
      const opacity = (sel) => getComputedStyle(document.querySelector(sel)).opacity;
      return opacity('.react-flow__node[data-id="implement"] .react-flow__handle[data-handleid="in"]') === '0'
        && opacity('.react-flow__node[data-id="implement"] .react-flow__handle[data-handleid="out"]') === '0'
        && opacity('.react-flow__node[data-id="res-changes"] .react-flow__handle[data-handleid="in"]') === '1'
        && opacity('.react-flow__node[data-id="res-changes"] .react-flow__handle[data-handleid="out"]') === '0';
    })()`),
    '拖写入线时只应露出资源卡左边的入口',
  )
  await screenshot(session, 'ui-02i-drag-preview.png')
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: writeTo.x,
    y: writeTo.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  await onDisk(
    NAME,
    (doc) => doc.edges.find((edge) => edge.id === 'step->res-changes')?.data?.update === true,
    'step 在原文件上更新 changes.md',
  )
  // 改资源里文件的路径：读写线连着的是卡片，不用改任何引用。
  await mouseClick(session, await centerOf(session, risksCard))
  await openFirstItem(session)
  await setReactInput(session, '[data-testid="wl-resource-value"]', 'risks.md')
  await saveItem(session)
  await onDisk(
    NAME,
    (doc) =>
      fileOf(doc, 'risks.md') !== undefined &&
      doc.edges.some((edge) => edge.source === risksId && edge.target === 'step'),
    '改了路径，读写线照旧',
  )
  pass('交接：说明落盘、标记 + 悬停卡片；只管先后；从步骤底边拖到资源卡 = 更新；改路径线照旧')

  // 8) 点选 step，Ctrl+D 复制；Delete 删掉副本。
  await mouseClick(session, await centerOf(session, '.react-flow__node[data-id="step"]'))
  await pressKey(session, 'd', { modifiers: MOD.ctrl })
  await onDisk(NAME, (doc) => idsOf(doc).includes('step-2'), '复制出来的 step-2')
  await pressKey(session, 'Delete')
  await onDisk(NAME, (doc) => !idsOf(doc).includes('step-2'), '删掉 step-2')
  pass('Ctrl+D 复制步骤、Delete 删除')

  // 9) 按 L 整理布局：同一列里的卡片不重叠。
  await mouseClick(session, {
    x: Math.round(canvasBox.x + canvasBox.w - 60),
    y: Math.round(canvasBox.y + canvasBox.h - 60),
  })
  await pressKey(session, 'l')
  const tidied = await onDisk(
    NAME,
    (doc) => doc.nodes.find((node) => node.id === 'scan').position.x === 80,
    '整理后的坐标',
  )
  await sleep(600)
  // 卡片按浏览器里真实画出来的大小比（资源卡高矮不一，标称尺寸不准）。
  const boxes =
    await session.evaluate(`[...document.querySelectorAll('.react-flow__node')].map((node) => {
    const r = node.getBoundingClientRect();
    return { id: node.dataset.id, x: r.left, y: r.top, w: r.width, h: r.height };
  })`)
  check(
    boxes.length === tidied.nodes.length,
    `每张卡都要画出来：${boxes.length}/${tidied.nodes.length}`,
  )
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      check(apart, `整理后卡片不该重叠：${JSON.stringify([a, b])}`)
    }
  }
  // 整理后的每一条线（按浏览器里真实画出来的路径取样）都不穿过除两头之外的任何卡片。
  const ends = Object.fromEntries(tidied.edges.map((edge) => [edge.id, [edge.source, edge.target]]))
  const crossings = await session.evaluate(`(() => {
    const ends = ${JSON.stringify(ends)};
    const cards = [...document.querySelectorAll('.react-flow__node')].map((node) => {
      const r = node.getBoundingClientRect();
      return { id: node.dataset.id, l: r.left + 3, r: r.right - 3, t: r.top + 3, b: r.bottom - 3 };
    });
    const bad = [];
    let sampled = 0;
    for (const edge of document.querySelectorAll('.react-flow__edge')) {
      const id = edge.dataset.id;
      const path = edge.querySelector('path.react-flow__edge-path');
      if (!path || !ends[id]) continue;
      sampled += 1;
      const ctm = path.getScreenCTM();
      const total = path.getTotalLength();
      for (let at = 10; at < total - 10; at += 6) {
        const p = path.getPointAtLength(at);
        const x = ctm.a * p.x + ctm.c * p.y + ctm.e;
        const y = ctm.b * p.x + ctm.d * p.y + ctm.f;
        const hit = cards.find((c) => !ends[id].includes(c.id) && x > c.l && x < c.r && y > c.t && y < c.b);
        if (hit) { bad.push(id + ' 穿过 ' + hit.id); break; }
      }
    }
    return { bad, sampled };
  })()`)
  check(
    crossings.sampled === tidied.edges.length,
    `每条线都要取样：${crossings.sampled}/${tidied.edges.length}`,
  )
  check(crossings.bad.length === 0, `整理后有线穿过卡片：${crossings.bad.join('；')}`)
  await screenshot(session, 'ui-03-tidy.png')
  pass('L 整理布局 → 按执行顺序分列、不重叠')

  // 10) 预览计划：给模型的版本引用实例目录里的任务描述（实例 id 先留 {instance}），给人看的版本内联提示词。
  await session.evaluate(clickTestId('wl-preview'))
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-plan-text"]')?.textContent || '').includes('{instance}')`,
  )
  const modelPlan = await session.evaluate(
    `document.querySelector('[data-testid="wl-plan-text"]').textContent`,
  )
  check(modelPlan.includes(`「${CONDITION}」`), '计划里应原样引用自然语言条件')
  check(!modelPlan.includes(`VERDICT: ${CONDITION}`), '自然语言条件不该要求 VERDICT 行')
  // 第二个文件在 7f 里改名成了 risks.md。
  check(modelPlan.includes('artifacts/run/risks.md'), '文件应进计划，路径拼上产出根目录')
  check(modelPlan.includes(FILE_RULE), '文件的说明应进计划')
  check(modelPlan.includes('你是 leader'), '执行方式应进计划')
  // 排版视图里反引号已经渲染成代码样式，textContent 里没有它们。
  check(
    modelPlan.includes('资源 res-changes：implement 产出；step 在原文件上更新。'),
    '资源块应写清谁产出、谁在原文件上更新',
  )
  check(modelPlan.includes('资源 res-impl-risks：implement 产出；step 读取。'), '读取应进资源块')
  check(
    modelPlan.includes(`文件：artifacts/run/risks.md。说明：${FILE_RULE}`),
    '资源里的文件应带着拼好的路径与说明',
  )
  check(modelPlan.includes(NOTE), '交接说明应进计划')
  await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-plan"] [role="radio"]')][1].click()`,
  )
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-plan-text"]')?.textContent || '').includes('检查所有测试是否通过。')`,
  )
  // 默认按 Markdown 排版：计划里的事实表渲染成真正的表格；切到源码就是原文。
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-plan-text"] table') !== null`),
    '排版视图里应有渲染出来的表格',
  )
  await screenshot(session, 'ui-04-plan.png')
  await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-plan"] [role="radio"]')][3].click()`,
  )
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-plan-text"] pre')?.textContent || '').includes('| ')`,
  )
  await pressKey(session, 'Escape')
  await waitFor(session, `document.querySelector('[data-testid="wl-plan"]') === null`)
  pass('预览计划：两个版本都对，默认排版、可切源码，Esc 关闭')

  // 10a) 步骤库：两节都能收起展开。
  await session.evaluate(clickTestId('wl-lib-section-builtin'))
  await waitFor(session, `document.querySelector('[data-testid="wl-lib-preset-scan"]') === null`)
  await session.evaluate(clickTestId('wl-lib-section-builtin'))
  await waitFor(session, exists('wl-lib-preset-scan'))
  await session.evaluate(clickTestId('wl-lib-section-custom'))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-lib-section-custom"]').getAttribute('aria-expanded') === 'false'`,
  )
  await session.evaluate(clickTestId('wl-lib-section-custom'))
  pass('「常用步骤」「我的步骤」都能收起、展开')

  // 10b) 点内置步骤：右侧只读展示提示词，没有任何输入框，也没有"连接"。
  await session.evaluate(clickTestId('wl-lib-preset-review'))
  await waitFor(session, exists('wl-step-panel'))
  check(
    await session.evaluate(
      `(document.querySelector('[data-testid="wl-step-prompt"]')?.textContent || '').includes('VERDICT')`,
    ),
    '内置步骤的提示词应展示出来',
  )
  check(
    (await session.evaluate(
      `document.querySelectorAll('[data-testid="wl-step-panel"] input, [data-testid="wl-step-panel"] textarea').length`,
    )) === 0,
    '内置步骤不该有可编辑的输入框',
  )
  check(!(await session.evaluate(exists('wl-inspector'))), '看库里的条目时不该同时开着步骤属性')
  await screenshot(session, 'ui-05-preset.png')
  // 内置步骤的产出文件也能点开，看它的生成规则（只读）。
  await session.evaluate(
    `document.querySelector('[data-testid="wl-step-panel"] [data-testid="wl-output-item"]').click()`,
  )
  await waitFor(session, exists('wl-output-rule-view'))
  check(
    (await session.evaluate(
      `document.querySelectorAll('[data-testid="wl-output-dialog"] input, [data-testid="wl-output-dialog"] textarea').length`,
    )) === 0,
    '内置步骤的产出详情不该可编辑',
  )
  await sleep(350)
  await screenshot(session, 'ui-05b-preset-output.png')
  await session.evaluate(clickTestId('wl-output-done'))
  await waitFor(session, `document.querySelector('[data-testid="wl-output-dialog"]') === null`)
  check(await session.evaluate(exists('wl-step-panel')), '关掉产出详情后内置步骤面板应还开着')
  pass('点内置步骤 → 右侧只读展示，产出文件可点开看规则')

  // 10c) 复制为我的步骤 → 改文件名 → 保存：磁盘上出现这份模板，库里出现这一项。
  await session.evaluate(clickTestId('wl-step-copy'))
  await waitFor(session, exists('wl-step-name'))
  check(
    await session.evaluate(`(() => {
      const id = document.querySelector('[data-testid="wl-step-name"]');
      const desc = document.querySelector('[data-testid="wl-step-panel"] [data-testid="wl-description"]');
      return Boolean(id.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING);
    })()`),
    'ID 应排在描述上面',
  )
  await setReactInput(session, '[data-testid="wl-step-name"]', STEP)
  await session.evaluate(clickTestId('wl-step-save'))
  await waitFor(session, exists(`wl-lib-template-${STEP}`))
  const copied = await rpc('graph/nodeTemplateDraft', { name: STEP })
  check(copied.data.prompt.includes('VERDICT'), `复制出来的应带着内置提示词：${copied.data.prompt}`)
  pass('复制为我的步骤并保存 → 落盘、出现在「我的步骤」')

  // 10d) 在右侧改我的步骤，Ctrl+S 保存。
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-step-prompt-card"]')?.textContent || '').includes('VERDICT')`,
  )
  await setReactInput(
    session,
    '[data-testid="wl-step-panel"] [data-testid="wl-description"]',
    '我自己的审查',
  )
  // 提示词在弹窗里改；弹窗里按 Ctrl+S 一样能存。
  await session.evaluate(clickTestId('wl-step-prompt-card-edit'))
  await waitFor(session, exists('wl-step-prompt'))
  await setReactInput(session, 'textarea[data-testid="wl-step-prompt"]', '改过的提示词')
  await session.evaluate(`document.querySelector('textarea[data-testid="wl-step-prompt"]').focus()`)
  await pressKey(session, 's', { modifiers: MOD.ctrl })
  const deadline = Date.now() + 6000
  for (;;) {
    const draft = await rpc('graph/nodeTemplateDraft', { name: STEP })
    if (draft.data.prompt === '改过的提示词' && draft.data.description === '我自己的审查') break
    if (Date.now() > deadline)
      throw new Error(`FAIL: Ctrl+S 没有把改动存下去：${draft.data.prompt}`)
    await sleep(200)
  }
  await pressKey(session, 'Escape')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-step-prompt-card-viewer"]') === null`,
  )
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-lib-template-${STEP}"]')?.textContent || '').includes('我自己的审查')`,
  )
  await screenshot(session, 'ui-06-mine.png')
  pass('编辑我的步骤，Ctrl+S 保存落盘')

  // 10e) 「添加到画布」→ 图里多出这一步。
  await session.evaluate(clickTestId('wl-step-add'))
  await onDisk(NAME, (doc) => idsOf(doc).includes(STEP), `步骤 ${STEP}`)
  pass('从右侧面板添加到画布')

  // 10f) 删除我的步骤（要确认）。
  await session.evaluate(clickTestId(`wl-lib-template-${STEP}`))
  await waitFor(session, exists('wl-step-delete'))
  await session.evaluate(clickTestId('wl-step-delete'))
  await waitFor(session, exists('wl-step-delete-confirm'))
  // 确认卡浮在删除按钮旁边，「保存」等按钮原地不动。
  check(
    await session.evaluate(exists('wl-step-save')),
    '点删除后底栏的「保存」应还在原处（确认卡是浮层，不替换底栏）',
  )
  await sleep(200)
  await screenshot(session, 'ui-19b-step-delete-confirm.png')
  await session.evaluate(clickTestId('wl-step-delete-confirm'))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-lib-template-${STEP}"]') === null`,
  )
  const gone = await rpc('graph/nodeTemplateDraft', { name: STEP }).catch((error) => error)
  check(gone instanceof Error, '删除后磁盘上不该还有这份模板')
  pass('删除我的步骤 → 库里与磁盘上都没了')

  // 10g) 「＋」新建一个我的步骤。
  await session.evaluate(clickTestId('wl-lib-new'))
  await waitFor(session, exists('wl-step-name'))
  await setReactInput(session, '[data-testid="wl-step-name"]', STEP_NEW)
  await session.evaluate(clickTestId('wl-step-prompt-card-card'))
  await waitFor(session, exists('wl-step-prompt'))
  await setReactInput(session, 'textarea[data-testid="wl-step-prompt"]', '全新的步骤')
  await pressKey(session, 'Escape')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-step-prompt-card-viewer"]') === null`,
  )
  await session.evaluate(clickTestId('wl-step-save'))
  await waitFor(session, exists(`wl-lib-template-${STEP_NEW}`))
  check(
    (await rpc('graph/nodeTemplateDraft', { name: STEP_NEW })).data.prompt === '全新的步骤',
    '新建的步骤应落盘',
  )
  pass('「＋」新建我的步骤')
  await pressKey(session, 'Escape')

  // 10b) 模型用工具在别处改了这张图：本地没有未存的改动时，回到窗口就自动同步过来。
  const disk = await rpc('graph/load', { name: NAME })
  const outside = structuredClone(disk.document)
  outside.nodes.find((node) => node.id === 'step').data.label = '外部改名'
  await rpc('graph/save', { name: NAME, document: outside, baseHash: disk.hash })
  await session.evaluate(`window.dispatchEvent(new Event('focus'))`)
  await waitFor(
    session,
    `(document.querySelector('.react-flow__node[data-id="step"]')?.textContent || '').includes('外部改名')`,
  )
  pass('别处改了文件 → 回到窗口时自动同步（本地无改动）')

  // 11) 改名：双击顶栏的名字 → 输入 → 回车。
  await session.evaluate(
    `document.querySelector('[data-testid="wl-switcher"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
  )
  await waitFor(session, exists('wl-rename'))
  await session.evaluate(
    `(() => { const el = document.querySelector('[data-testid="wl-rename"]'); el.value = ${JSON.stringify(RENAMED)}; el.focus(); })()`,
  )
  await pressKey(session, 'Enter', { code: 'Enter', text: '\r' })
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-switcher"]')?.textContent || '').trim() === ${JSON.stringify(RENAMED)}`,
  )
  const listed = await rpc('graph/list', {})
  check(
    listed.workflows.some((entry) => entry.name === RENAMED),
    '改名后目录里应是新名字',
  )
  pass('双击名字改名 → 磁盘上跟着改')

  // 12) 下拉里每一行都能直接改名、删除，不用先切过去。
  const OTHER = `${NAME}-other`
  await rpc('graph/create', { name: OTHER })
  await session.evaluate(clickTestId('wl-switcher'))
  await waitFor(session, exists(`wl-wf-rename-${OTHER}`))
  // 平时只显示步骤数，悬停这一行时「改名 / 删除」浮出来、占同一个位置。
  const rowSel = `[data-testid="wl-wf-item"][data-value=${JSON.stringify(OTHER)}]`
  const rowBox = await session.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(rowSel)}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`)
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rowBox.x, y: rowBox.y })
  await sleep(200)
  check(
    await session.evaluate(
      `getComputedStyle(document.querySelector('[data-testid="wl-wf-delete-${OTHER}"]').parentElement).opacity === '1'`,
    ),
    '悬停一行时改名 / 删除按钮应浮出',
  )
  await screenshot(session, 'ui-25a-row-actions.png')
  const nameBefore = await session.evaluate(
    `document.querySelector('[data-testid="wl-switcher"]').textContent.trim()`,
  )
  await session.evaluate(clickTestId(`wl-wf-rename-${OTHER}`))
  await waitFor(session, exists('wl-wf-rename-input'))
  const OTHER2 = `${OTHER}2`
  await session.evaluate(
    `(() => { const el = document.querySelector('[data-testid="wl-wf-rename-input"]'); el.value = ${JSON.stringify(OTHER2)}; el.focus(); })()`,
  )
  await pressKey(session, 'Enter', { code: 'Enter', text: '\r' })
  await waitFor(session, exists(`wl-wf-rename-${OTHER2}`))
  check(
    (await rpc('graph/list', {})).workflows.some((entry) => entry.name === OTHER2),
    '行内改名应落盘',
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-switcher"]').textContent.trim()`,
    )) === nameBefore,
    '改别的工作流的名字，当前打开的不该变',
  )
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-wf-item"]') !== null`),
    '改完名下拉应还开着',
  )
  pass('下拉里直接给别的工作流改名，不用切过去')

  // 删别的那张：确认卡挂在那一行的删除按钮旁，下拉不收，当前打开的不受影响。
  await session.evaluate(clickTestId(`wl-wf-delete-${OTHER2}`))
  await waitFor(session, exists('wl-delete-confirm-pop'))
  await sleep(250)
  check(
    await session.evaluate(`(() => {
      const pop = document.querySelector('[data-testid="wl-delete-confirm-pop"]').getBoundingClientRect();
      const anchor = document.querySelector('[data-testid="wl-wf-delete-${OTHER2}"]').getBoundingClientRect();
      return pop.top >= anchor.bottom && Math.abs(pop.left - (anchor.left - 8)) < 2;
    })()`),
    '删除确认卡应挂在那一行的删除按钮下面',
  )
  await screenshot(session, 'ui-25b-delete-confirm.png')
  await session.evaluate(clickTestId('wl-delete-confirm'))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-wf-delete-${OTHER2}"]') === null`,
  )
  check(
    !(await rpc('graph/list', {})).workflows.some((entry) => entry.name === OTHER2),
    '删除后目录里不该还有它',
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-switcher"]').textContent.trim()`,
    )) === nameBefore && (await session.evaluate(exists('wl-wf-item'))),
    '删别的工作流：当前打开的不变、下拉还开着',
  )
  pass('下拉里直接删除别的工作流')

  // 再删正开着的这张 → 回到欢迎页。
  await session.evaluate(clickTestId(`wl-wf-delete-${RENAMED}`))
  await waitFor(session, exists('wl-delete-confirm'))
  await session.evaluate(clickTestId('wl-delete-confirm'))
  await waitFor(session, exists('wl-welcome'))
  const after = await rpc('graph/list', {})
  check(!after.workflows.some((entry) => entry.name === RENAMED), '删除后目录里不该还有它')
  pass('删除正开着的工作流 → 回到欢迎页')

  check(session.errors.length === 0, `页面不该有报错：${JSON.stringify(session.errors)}`)
  console.log('\n✅ 工作流视图验收全部通过')
}

const session = await openPage()
try {
  await run(session)
} catch (error) {
  await screenshot(session, 'ui-failure.png').catch(() => {})
  console.error(`\n❌ 第 ${step + 1} 步失败：${error.message}`)
  process.exitCode = 1
} finally {
  for (const name of [NAME, RENAMED, `${NAME}-other`, `${NAME}-other2`]) {
    await rpc('graph/delete', { name }).catch(() => {})
  }
  for (const name of [STEP, STEP_NEW]) {
    await rpc('graph/nodeTemplateDelete', { name }).catch(() => {})
  }
  session.close()
}
