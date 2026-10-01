/**
 * 工作流视图的真浏览器验收：真指针、真键盘、真拖放，结论以**磁盘**为准。
 *
 * 走一遍新用户会走的路：空图 → 从步骤库拖一个进来 → 点「＋」接一步 → 双击空白处加空白步骤
 * 并写提示词 → 拖线连接 → 改连线条件 → 删除与撤销 → 整理布局 → 预览计划 → 改名 → 删除。
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
const PLAN_RULE = '有序的任务清单：每条写清改哪个文件、验收标准是什么。'
const STEP_NEW = `${NAME}-new`
const NOTE = '按 plan.md 逐条执行，做完的条目在原文件里打钩'
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

/** 步骤的 id（文件卡另算）。 */
const idsOf = (doc) =>
  doc.nodes
    .filter((node) => node.type !== 'wfFile')
    .map((node) => node.id)
    .sort()
const fileOf = (doc, path) =>
  doc.nodes.find((node) => node.type === 'wfFile' && node.data.path === path)
const isFileId = (doc, id) => doc.nodes.some((node) => node.id === id && node.type === 'wfFile')
/** 步骤之间的线（连着文件卡的读写线另算）。 */
const edgeIds = (doc) =>
  doc.edges
    .filter((edge) => !isFileId(doc, edge.source) && !isFileId(doc, edge.target))
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

async function pointerDrag(session, from, to, steps = 8) {
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

const exists = (testId) => `document.querySelector('[data-testid="${testId}"]') !== null`
const clickTestId = (testId) =>
  `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) return false; el.click(); return true })()`

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
  await onDisk(NAME, (doc) => idsOf(doc).join() === 'scan', '步骤 scan')
  pass('拖入「侦察」→ 画布出现、属性面板打开、已落盘')

  // 3) 点 scan 右侧的「＋」→ 就地菜单 → 选「拆解」：接在后面并连上。
  await mouseClick(session, await handleCenter(session, 'scan', 'source'))
  await waitFor(session, exists('wl-quick-add'))
  await session.evaluate(clickTestId('wl-quick-plan'))
  await waitFor(session, `document.querySelector('.react-flow__node[data-id="plan"]') !== null`)
  const afterPlus = await onDisk(NAME, (doc) => edgeIds(doc).length === 1, '连线 scan->plan')
  check(edgeIds(afterPlus).join() === 'scan->plan', `应连上 scan->plan：${edgeIds(afterPlus)}`)
  const scanAt = afterPlus.nodes.find((node) => node.id === 'scan').position
  const planAt = afterPlus.nodes.find((node) => node.id === 'plan').position
  check(planAt.x > scanAt.x, '「添加下一步」应落在右边')
  pass('点「＋」添加下一步 → 自动连线、落在右侧')

  // 4) 双击空白处 → 空白步骤，光标直接进提示词；打字落盘。
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
  pass('双击空白处加空白步骤 → 提示词自动聚焦、输入落盘')

  // 5) 从 plan 的出口拖线到 step 的入口。
  await pointerDrag(
    session,
    await handleCenter(session, 'plan', 'source'),
    await handleCenter(session, 'step', 'target'),
  )
  await onDisk(NAME, (doc) => edgeIds(doc).includes('plan->step'), '连线 plan->step')
  pass('拖线连接 plan → step')

  // 6) 点中连线 → 属性面板改成「未通过」→ 边 id 跟着变。
  await mouseClick(session, await edgeMidpoint(session, 'scan->plan'))
  await waitFor(session, `document.querySelector('[data-testid="wl-delete-edge"]') !== null`)
  await session.evaluate(`(() => {
    const radio = [...document.querySelectorAll('[data-testid="wl-inspector"] [role="radio"]')][2];
    radio.click();
  })()`)
  await onDisk(NAME, (doc) => edgeIds(doc).includes('scan->plan#fail'), '连线条件 fail')
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-delete-edge"]') !== null`),
    '改条件后连线面板应仍然开着（选中跟着新 id 走）',
  )
  await screenshot(session, 'ui-02-edge.png')
  pass('选中连线并改为「未通过」→ 落盘为 scan->plan#fail')

  // 7) Delete 删连线 → Ctrl+Z 撤回。
  await pressKey(session, 'Delete')
  await onDisk(NAME, (doc) => !edgeIds(doc).includes('scan->plan#fail'), '删掉连线')
  await pressShortcut(session, 'z')
  await onDisk(NAME, (doc) => edgeIds(doc).includes('scan->plan#fail'), '撤销后连线回来')
  pass('Delete 删连线、Ctrl+Z 撤回')

  // 7b) 自定义条件：一整句自然语言，可以很长；线上截断显示，悬停看全文。
  await mouseClick(session, await edgeMidpoint(session, 'scan->plan#fail'))
  await waitFor(session, exists('wl-delete-edge'))
  await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-inspector"] [role="radio"]')][3].click()`,
  )
  await waitFor(session, exists('wl-edge-custom'))
  await setReactInput(session, '[data-testid="wl-edge-custom"]', CONDITION)
  await onDisk(NAME, (doc) => edgeIds(doc).includes(`scan->plan#${CONDITION}`), '自定义条件')
  check(
    !(await session.evaluate(
      `document.querySelector('[data-testid="wl-inspector"] p')?.textContent?.includes('只能用文字') === true`,
    )),
    '合法的长条件不该报错',
  )
  check(
    await session.evaluate(
      `[...document.querySelectorAll('.react-flow__edgelabel-renderer [role="tooltip"]')].some((el) => el.textContent === ${JSON.stringify(CONDITION)})`,
    ),
    '线上的长条件应带一份全文悬停提示',
  )
  await mouseMove(
    session,
    await centerOf(session, '.react-flow__edgelabel-renderer button[data-when]'),
  )
  await sleep(500)
  await screenshot(session, 'ui-02b-condition.png')
  pass('自定义条件写一整句话 → 落盘，线上截断、悬停看全文')

  // 7c) 文件卡：内置步骤插进来时带着它的产出文件卡；面板里「新建产出文件」再加一张，连上写入线。
  check(
    await session.evaluate(
      `document.querySelector('.react-flow__node[data-id="file-plan.md"] [data-testid="wl-file"]') !== null`,
    ),
    '内置「拆解」插进来时应带着它的产出文件卡',
  )
  await mouseClick(session, await centerOf(session, '.react-flow__node[data-id="plan"]'))
  await waitFor(session, exists('wl-file-new'))
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-step-files"] [data-testid="wl-step-file"]')?.textContent || ''`,
      )
    ).includes(PLAN_RULE),
    '步骤面板的「文件」里应列出它写的文件与要求',
  )
  await session.evaluate(clickTestId('wl-file-new'))
  await waitFor(session, exists('wl-output-dialog'))
  check(
    (await session.evaluate(`document.querySelector('[data-testid="wl-output-path"]').value`)) ===
      'plan-2.md',
    '新建产出文件应预填一个没被占用的文件名',
  )
  await setReactInput(session, '[data-testid="wl-output-path"]', 'plan-risks.md')
  await setReactInput(session, '[data-testid="wl-output-rule"]', RULE)
  await sleep(350)
  await screenshot(session, 'ui-02c-dialog.png')
  await session.evaluate(clickTestId('wl-output-done'))
  await waitFor(session, `document.querySelector('[data-testid="wl-output-dialog"]') === null`)
  const withFile = await onDisk(
    NAME,
    (doc) =>
      fileOf(doc, 'plan-risks.md')?.data.rule === RULE &&
      doc.edges.some(
        (edge) => edge.source === 'plan' && edge.target === fileOf(doc, 'plan-risks.md').id,
      ),
    '新文件卡与 plan 的写入线',
  )
  check(
    (await session.evaluate(
      `document.querySelectorAll('[data-testid="wl-step-files"] [data-testid="wl-step-file"]').length`,
    )) === 2,
    '步骤面板里应列出两个写入的文件',
  )
  const risksId = fileOf(withFile, 'plan-risks.md').id
  await sleep(400)
  await screenshot(session, 'ui-02c-files.png')
  pass('文件卡：内置步骤带着产出卡；「新建产出文件」→ 新卡 + 写入线落盘')

  // 7d) 文件卡上悬停：写它、读它的步骤标出角色，其余淡下去；点开改要求与路径，读写线跟着节点走。
  const risksCard = `.react-flow__node[data-id=${JSON.stringify(risksId)}]`
  await waitFor(session, `document.querySelector('${risksCard}') !== null`)
  await mouseMove(session, await centerOf(session, risksCard))
  await waitFor(
    session,
    `document.querySelector('.react-flow__node[data-id="plan"] [data-testid="wl-step"]')?.getAttribute('data-role') === 'producer'`,
  )
  check(
    (await session.evaluate(
      `document.querySelector('.react-flow__node[data-id="scan"] [data-testid="wl-step"]').getAttribute('data-dim')`,
    )) === 'true',
    '与这份文件无关的步骤应淡下去',
  )
  await sleep(300)
  await screenshot(session, 'ui-02d-file-hover.png')
  await mouseClick(session, await centerOf(session, risksCard))
  await waitFor(session, exists('wl-file-rule'))
  await setReactInput(session, '[data-testid="wl-file-rule"]', FILE_RULE)
  await onDisk(NAME, (doc) => fileOf(doc, 'plan-risks.md')?.data.rule === FILE_RULE, '文件卡的要求')
  // 从文件卡右边的点拖到 step 左边 = step 读它。
  await pointerDrag(
    session,
    await centerOf(session, `${risksCard} .react-flow__handle.source`),
    await handleCenter(session, 'step', 'target'),
  )
  await onDisk(
    NAME,
    (doc) => doc.edges.some((edge) => edge.source === risksId && edge.target === 'step'),
    '读取线 文件 → step',
  )
  // 连上之后选中的是那条新线（面板里是读取说明）；回到文件卡看「读它的步骤」。
  await waitFor(session, exists('wl-delete-edge'))
  await mouseClick(session, await centerOf(session, risksCard))
  await waitFor(session, exists('wl-file-readers'))
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-file-readers"]').textContent`,
      )
    ).includes('step'),
    '文件卡面板应列出读它的步骤',
  )
  await screenshot(session, 'ui-02d-file-panel.png')
  pass('文件卡：悬停高亮上下游；面板里改要求；从文件卡拖线到步骤 = 读取')

  // 7e) 工作流设置：产出根目录（带多余斜杠，保存时标准化）+ 执行方式。
  await session.evaluate(clickTestId('wl-settings-open'))
  await waitFor(session, exists('wl-settings'))
  await setReactInput(session, '[data-testid="wl-settings-root"]', 'artifacts//run/')
  await session.evaluate(clickTestId('wl-settings-mode-subagent'))
  await sleep(350)
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
    (doc) => doc.settings?.outputRoot === 'artifacts/run' && doc.settings?.mode === 'subagent',
    '工作流设置',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-settings-open"]').getAttribute('data-configured') === 'true'`,
    ),
    '改过设置后顶栏按钮应挂上小点',
  )
  // 文件卡面板里预览最终路径。
  await mouseClick(session, await centerOf(session, '.react-flow__node[data-id="file-plan.md"]'))
  await waitFor(session, exists('wl-file-final'))
  check(
    (
      await session.evaluate(`document.querySelector('[data-testid="wl-file-final"]').textContent`)
    ).includes('artifacts/run/plan.md'),
    '文件卡面板应预览拼好的最终路径',
  )
  pass('工作流设置：根目录标准化落盘、执行方式落盘，文件卡预览最终路径')

  // 7f) 交接：步骤之间的线缺省交执行结果（不画标记）；附说明后出现标记、悬停看说明；关掉 = 只管先后。
  const mark = '[data-testid="wl-handoff-mark"][data-edge="plan->step"]'
  check(
    !(await session.evaluate(`document.querySelector('${mark}') !== null`)),
    '缺省的交接不画标记',
  )
  await mouseClick(session, await edgeMidpoint(session, 'plan->step'))
  await waitFor(session, exists('wl-handoff'))
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-handoff-result"]').checked`),
    '缺省应交执行结果',
  )
  await setReactInput(session, '[data-testid="wl-handoff-note"]', NOTE)
  await onDisk(
    NAME,
    (doc) => doc.edges.find((edge) => edge.id === 'plan->step')?.data?.handoff?.note === NOTE,
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
    (doc) => doc.edges.find((edge) => edge.id === 'plan->step')?.data?.handoff === false,
    '只管先后',
  )
  await waitFor(session, `document.querySelector('${mark}')?.getAttribute('data-none') === 'true'`)
  await session.evaluate(clickTestId('wl-handoff-result'))
  await onDisk(
    NAME,
    (doc) => doc.edges.find((edge) => edge.id === 'plan->step')?.data?.handoff?.note === NOTE,
    '再打开时说明还在',
  )
  // 从 step 底边拖到 plan.md：plan 已经在写它，接着写默认是「在原文件上更新」。
  await pointerDrag(
    session,
    await centerOf(
      session,
      '.react-flow__node[data-id="step"] .react-flow__handle.source[data-handleid="file"]',
    ),
    await centerOf(session, '.react-flow__node[data-id="file-plan.md"] .react-flow__handle.target'),
  )
  await onDisk(
    NAME,
    (doc) => doc.edges.find((edge) => edge.id === 'step->file-plan.md')?.data?.update === true,
    'step 在原文件上更新 plan.md',
  )
  // 改文件卡的路径：读写线连着的是卡片，不用改任何引用。
  await mouseClick(session, await centerOf(session, risksCard))
  await waitFor(session, exists('wl-file-path'))
  await setReactInput(session, '[data-testid="wl-file-path"]', 'risks.md')
  await onDisk(
    NAME,
    (doc) =>
      fileOf(doc, 'risks.md') !== undefined &&
      doc.edges.some((edge) => edge.source === risksId && edge.target === 'step'),
    '改了路径，读写线照旧',
  )
  pass('交接：说明落盘、标记 + 悬停卡片；只管先后；从步骤底边拖到文件 = 更新；改路径线照旧')

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
  const boxes = tidied.nodes.map((node) =>
    node.type === 'wfFile'
      ? { ...node.position, w: 188, h: 52 }
      : { ...node.position, w: 216, h: 70 },
  )
  for (const [index, a] of boxes.entries()) {
    for (const b of boxes.slice(index + 1)) {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      check(apart, `整理后卡片不该重叠：${JSON.stringify([a, b])}`)
    }
  }
  await sleep(600)
  await screenshot(session, 'ui-03-tidy.png')
  pass('L 整理布局 → 按执行顺序分列、不重叠')

  // 10) 预览计划：给模型的版本引用 .dispatch，给人看的版本内联提示词。
  await session.evaluate(clickTestId('wl-preview'))
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-plan-text"]')?.textContent || '').includes('.dispatch')`,
  )
  const modelPlan = await session.evaluate(
    `document.querySelector('[data-testid="wl-plan-text"]').textContent`,
  )
  check(modelPlan.includes(`「${CONDITION}」`), '计划里应原样引用自然语言条件')
  check(!modelPlan.includes(`VERDICT: ${CONDITION}`), '自然语言条件不该要求 VERDICT 行')
  // 第二个文件在 7f 里改名成了 risks.md。
  check(modelPlan.includes('artifacts/run/risks.md'), '文件应进计划，路径拼上产出根目录')
  check(modelPlan.includes(FILE_RULE), '文件的要求应进计划')
  check(modelPlan.includes('你是 leader'), '执行方式应进计划')
  // 排版视图里反引号已经渲染成代码样式，textContent 里没有它们。
  check(
    modelPlan.includes('artifacts/run/plan.md：plan 产出；step 在原文件上更新。'),
    '文件块应写清谁产出、谁在原文件上更新',
  )
  check(modelPlan.includes('artifacts/run/risks.md：plan 产出；step 读取。'), '读取应进文件块')
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
    `(document.querySelector('textarea[data-testid="wl-step-prompt"]')?.value || '').includes('VERDICT')`,
  )
  await setReactInput(session, 'textarea[data-testid="wl-step-prompt"]', '改过的提示词')
  await setReactInput(
    session,
    '[data-testid="wl-step-panel"] [data-testid="wl-description"]',
    '我自己的审查',
  )
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
  await setReactInput(session, 'textarea[data-testid="wl-step-prompt"]', '全新的步骤')
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

  // 12) 删除：下拉里点删除 → 确认 → 回到欢迎页。
  await session.evaluate(clickTestId('wl-switcher'))
  await waitFor(session, exists('wl-delete'))
  await session.evaluate(clickTestId('wl-delete'))
  await waitFor(session, exists('wl-delete-confirm'))
  await session.evaluate(clickTestId('wl-delete-confirm'))
  await waitFor(session, exists('wl-welcome'))
  const after = await rpc('graph/list', {})
  check(!after.workflows.some((entry) => entry.name === RENAMED), '删除后目录里不该还有它')
  pass('删除工作流 → 回到欢迎页')

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
  for (const name of [NAME, RENAMED]) await rpc('graph/delete', { name }).catch(() => {})
  for (const name of [STEP, STEP_NEW]) {
    await rpc('graph/nodeTemplateDelete', { name }).catch(() => {})
  }
  session.close()
}
