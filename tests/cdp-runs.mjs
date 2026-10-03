/**
 * 工作流实例（运行状态）的真浏览器验收：不靠模型，结论以**磁盘**为准。
 *
 * 用插件自己的 `RunService` 在测试实例的数据目录里建一个实例（归属一个假会话、状态文件放在临时工作区），
 * 然后走用户会走的路：工作流中心 → 查看实例 → 画布按状态点亮 → 外部改状态文件，画布 2 秒内跟上 →
 * 写坏 / 修好状态文件 → 卡片小标改状态、右栏改整体 → 模型同时改了同一个字段 → 冲突、用我的 →
 * 保存（会话不在跑：通知暂存）→ 重跑 → 移到本会话 → 删除（连状态文件）→ 工作流设置里打开运行状态。
 *
 * 实例归属假会话，保存时插件找不到这个会话的 agent，所以**不会**真的给谁发通知、也不会触发模型。
 *
 * 前置同 `tests/cdp-ui.mjs`。另需：`WL_DATA_DIR` = 测试实例的 dataDir（缺省 tests/runs/review-data）。
 * usage: DSH_WEB_TOKEN=<token> node --experimental-strip-types tests/cdp-runs.mjs
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { RunService } from '../src/host/runs/service.ts'
import { bootToCanvas, screenshot } from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DATA_DIR = process.env.WL_DATA_DIR ?? join(HERE, 'runs', 'review-data')
const WORKSPACE = join(HERE, 'runs', `e2e-ws-${Date.now().toString(36)}`)
const NAME = `runs-${Date.now().toString(36)}`
const FAKE_SESSION = `e2e-session-${Date.now().toString(36)}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let step = 0
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
function pass(message) {
  step += 1
  console.log(`  ${String(step).padStart(2)} ${message}`)
}

const node = (id, label) => ({
  id,
  type: 'wfNode',
  position: { x: 0, y: 0 },
  data: { label, prompt: `做 ${id}` },
})
const edge = (s, t, when) => ({
  id: when === undefined ? `${s}->${t}` : `${s}->${t}#${when}`,
  source: s,
  target: t,
  sourceHandle: null,
  targetHandle: null,
  ...(when === undefined ? {} : { data: { when } }),
})
const DOC = {
  nodes: [
    node('scan', '侦察'),
    node('review', '审查'),
    node('fix', '修复'),
    node('report', '汇总'),
    {
      id: 'file-notes.md',
      type: 'wfResource',
      position: { x: 0, y: 0 },
      data: { items: [{ kind: 'file', value: 'notes.md' }] },
    },
  ],
  edges: [
    edge('scan', 'review'),
    edge('review', 'report', 'pass'),
    edge('review', 'fix', 'fail'),
    edge('fix', 'review'),
    edge('scan', 'file-notes.md'),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: { runState: true },
}

const runs = new RunService({ dataDir: () => DATA_DIR, validate: () => [] })
const session = await openPage()
let instance = null
let statePath = null

/** 模拟模型改状态文件：读 → 改 → 写回。 */
async function modelEdit(change) {
  const state = parse(await readFile(statePath, 'utf8'))
  change(state)
  await writeFile(statePath, stringify(state, { lineWidth: 0 }))
}

const chipOf = (id) =>
  `(document.querySelector('.react-flow__node[data-id="${id}"] [data-testid="wl-run-chip"]')?.dataset.status ?? null)`

try {
  console.log(`# 工作流实例验收：${NAME}`)
  await mkdir(WORKSPACE, { recursive: true })
  await rpc('graph/create', { name: NAME })
  const disk = await rpc('graph/load', { name: NAME })
  await rpc('graph/save', { name: NAME, document: DOC, baseHash: disk.hash })
  const prepared = await runs.prepare({
    workflow: NAME,
    document: (await rpc('graph/load', { name: NAME })).document,
    session: { id: FAKE_SESSION, cwd: WORKSPACE },
    goal: '验收',
  })
  check(prepared.ok, `建实例失败：${JSON.stringify(prepared)}`)
  instance = prepared.result.id
  statePath = prepared.result.statePath
  pass(`建实例 ${instance}（假会话、临时工作区）`)

  // 1) 工作流中心 → 运行实例 → 查看。
  await bootToCanvas(session, NAME)
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-open"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"]') !== null`,
  )
  await screenshot(session, 'runs-01-hub.png')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-view"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`)
  await waitFor(session, `document.querySelectorAll('[data-testid="wl-run-chip"]').length === 4`)
  check((await session.evaluate(chipOf('scan'))) === 'pending', 'scan 一开始应是待执行')
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-run-panel"]') !== null`),
    '实例视图应常驻右栏',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-canvas"]').dataset.readonly === 'true'`,
    ),
    '实例视图里图不能改',
  )
  pass('工作流中心 → 查看实例：画布只读、四张步骤卡挂上状态小标、右栏常驻')

  // 2) 模型改状态文件：画布 2 秒左右跟上；走过的线亮起来。
  await modelEdit((state) => {
    state.status = 'running'
    state.nodes.scan = {
      status: 'done',
      round: 1,
      startedAt: '2026-10-02T10:00:00+08:00',
      finishedAt: '2026-10-02T10:05:00+08:00',
      summary: '摸清了',
    }
    state.nodes.review = { status: 'running', round: 1, startedAt: '2026-10-02T10:06:00+08:00' }
    state.log = [
      { at: '2026-10-02T10:00:00+08:00', node: 'scan', event: 'start' },
      { at: '2026-10-02T10:05:00+08:00', node: 'scan', event: 'done' },
      { at: '2026-10-02T10:06:00+08:00', node: 'review', event: 'start' },
    ]
  })
  const t0 = Date.now()
  await waitFor(session, `${chipOf('review')} === 'running'`, { timeoutMs: 6000 })
  const lag = Date.now() - t0
  check(lag < 4500, `画布跟上状态文件用了 ${lag}ms`)
  check((await session.evaluate(chipOf('scan'))) === 'done', 'scan 应显示完成')
  check(
    await session.evaluate(
      `!document.querySelector('.react-flow__edge[data-id="scan->review"]').classList.toString().includes('linkDim') && document.querySelector('.react-flow__edge[data-id="review->report#pass"]').getAttribute('class').includes('Dim')`,
    ),
    '走过的线（scan→review）亮着，没走过的（review→report）淡下去',
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-run-progress"]').textContent`,
    )) === '1/4',
    '顶栏进度应是 1/4',
  )
  check(
    await session.evaluate(
      `document.querySelectorAll('[data-testid="wl-run-timeline"] li').length === 3`,
    ),
    '时间线应有 3 条',
  )
  await screenshot(session, 'runs-02-live.png')
  pass(`外部改状态文件 → 画布 ${lag}ms 内跟上，走过的线亮、没走过的淡，进度与时间线对`)

  // 3) 写坏 → 提示条、保留上一次合法的样子；修好 → 提示条消失。
  const good = await readFile(statePath, 'utf8')
  await writeFile(statePath, good.replace('status: running\n', 'status: complete\n'))
  await waitFor(session, `document.querySelector('[data-testid="wl-run-banner"]') !== null`, {
    timeoutMs: 6000,
  })
  check(
    (
      await session.evaluate(`document.querySelector('[data-testid="wl-run-banner"]').textContent`)
    ).includes('status'),
    '提示条应指出出错的字段',
  )
  check((await session.evaluate(chipOf('review'))) === 'running', '写坏时画布保留上一次合法的状态')
  await screenshot(session, 'runs-03-invalid.png')
  await writeFile(statePath, good)
  await waitFor(session, `document.querySelector('[data-testid="wl-run-banner"]') === null`, {
    timeoutMs: 6000,
  })
  pass('状态文件写坏 → 提示条列出问题、画布不跳；修好 → 提示条消失')

  // 4) 卡片小标改状态（菜单）、右栏改整体：草稿，不落盘。
  await session.evaluate(
    `document.querySelector('.react-flow__node[data-id="fix"] [data-testid="wl-run-chip"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-menu"]') !== null`)
  await screenshot(session, 'runs-04-menu.png')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-menu"] [data-status="skipped"]').click()`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-overall"][data-value="waiting"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-draft"]') !== null`)
  check((await session.evaluate(chipOf('fix'))) === 'skipped', '草稿里 fix 应已显示跳过')
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-run-draft-toggle"]').textContent`,
      )
    ).includes('2'),
    '草稿栏应写「已改 2 处」',
  )
  check(parse(await readFile(statePath, 'utf8')).nodes.fix.status === 'pending', '草稿不该落盘')
  pass('卡片小标一点改成跳过、右栏把整体改成等你 → 草稿栏「已改 2 处」，文件没动')

  // 5) 审查完成时要判定：菜单先问判定。
  await session.evaluate(
    `document.querySelector('.react-flow__node[data-id="review"] [data-testid="wl-run-chip"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-menu"]') !== null`)
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-menu"] [data-status="done"]').click()`,
  )
  await waitFor(session, `document.querySelectorAll('[data-testid="wl-run-verdict"]').length === 2`)
  await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-run-verdict"]')].find((el) => el.textContent.includes('pass')).click()`,
  )
  check((await session.evaluate(chipOf('review'))) === 'done', '选了判定后 review 应是完成')
  pass('有条件出边的步骤改成完成 → 先选判定（pass / fail）')

  // 6) 模型同时改了同一个字段 → 冲突；用我的。
  await modelEdit((state) => {
    state.status = 'failed'
    state.note = '模型：卡住了'
  })
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-save"]')?.disabled === true`,
    { timeoutMs: 6000 },
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-run-draft-toggle"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-run-conflict"]') !== null`)
  await screenshot(session, 'runs-05-conflict.png')
  await session.evaluate(
    `[...document.querySelectorAll('[data-testid="wl-run-conflict"] button')][0].click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-conflict"]') === null`)
  pass('模型同时把整体改成了失败 → 草稿标出冲突、保存按钮锁住；选「用我的」解开')

  // 7) 保存：会话不在跑 → 通知暂存；文件里只改了动过的字段，流水多一条 by: user。
  await session.evaluate(`(() => {
    const input = document.querySelector('[data-testid="wl-run-draft-note"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '先别修，等我看');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await session.evaluate(`document.querySelector('[data-testid="wl-run-save"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-run-draft"]') === null`, {
    timeoutMs: 8000,
  })
  const saved = parse(await readFile(statePath, 'utf8'))
  check(saved.status === 'waiting', `整体应是等你，实得 ${saved.status}`)
  check(saved.note === '模型：卡住了', '说明是模型写的，用户没动，应保留')
  check(
    saved.nodes.fix.status === 'skipped' && saved.nodes.review.verdict === 'pass',
    'fix 跳过、review 判定 pass',
  )
  const last = saved.log.at(-1)
  check(
    last.event === 'edit' && last.by === 'user' && last.detail.includes('先别修'),
    `流水最后一条应是用户的改动：${JSON.stringify(last)}`,
  )
  const index = JSON.parse(await readFile(join(DATA_DIR, 'instances.json'), 'utf8'))
  const record = index.instances.find((item) => item.id === instance)
  check(
    record.pendingNotice?.includes('用户在画布上修改了运行状态'),
    '会话不在跑：通知应暂存在索引里',
  )
  check(
    (await session.evaluate(`document.body.innerText`)).includes('模型下次活动时会收到'),
    '提示应说明通知会在模型下次活动时送到',
  )
  await screenshot(session, 'runs-06-saved.png')
  pass('保存 → 只改动过的字段、流水追加 by: user；会话不在跑，通知暂存待交付')

  // 8) 重跑：review 与下游做过的步骤改回待执行。
  await session.evaluate(
    `document.querySelector('.react-flow__node[data-id="review"] [data-testid="wl-run-chip"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-rerun"]') !== null`)
  await session.evaluate(`document.querySelector('[data-testid="wl-run-rerun"]').click()`)
  check((await session.evaluate(chipOf('review'))) === 'pending', '重跑后 review 应回到待执行')
  check((await session.evaluate(chipOf('fix'))) === 'pending', '下游 fix 也应回到待执行')
  check((await session.evaluate(chipOf('scan'))) === 'done', '上游 scan 不动')
  await session.evaluate(`document.querySelector('[data-testid="wl-run-save"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-run-draft"]') === null`, {
    timeoutMs: 8000,
  })
  const rerun = parse(await readFile(statePath, 'utf8'))
  check(
    rerun.nodes.review.status === 'pending' && rerun.nodes.review.verdict === undefined,
    'review 改回待执行并清掉判定',
  )
  pass('「重跑这一步」→ 它与下游做过的步骤改回待执行，保存落盘')

  // 9) 移到本会话：变成本会话的当前实例，流水记 transfer。
  const browserSession = await session.evaluate(
    `document.querySelector('[data-testid="wl-root"]').dataset.session`,
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-open"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-move"]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-move"]').click()`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-move"]') === null`,
  )
  const moved = JSON.parse(await readFile(join(DATA_DIR, 'instances.json'), 'utf8'))
  check(
    moved.instances.find((item) => item.id === instance).session === browserSession,
    '实例应归到本会话',
  )
  check(moved.current[browserSession] === instance, '应成为本会话的当前实例')
  check(
    parse(await readFile(statePath, 'utf8')).log.at(-1).event === 'transfer',
    '流水应记一条 transfer',
  )
  pass('工作流中心「移到本会话」→ 只属于本会话、成为当前实例、流水记 transfer')

  // 10) 删除：记录、快照、状态文件都没了。
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-delete"]').click()`,
  )
  await session.evaluate(
    `(() => { const box = document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] input[type="checkbox"]'); box.click(); })()`,
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-delete-confirm"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"]') === null`,
  )
  const afterDelete = JSON.parse(await readFile(join(DATA_DIR, 'instances.json'), 'utf8'))
  check(!afterDelete.instances.some((item) => item.id === instance), '索引里不该再有它')
  check(
    await readFile(statePath, 'utf8').then(
      () => false,
      () => true,
    ),
    '勾了「连状态文件一起删」，状态文件应被删掉',
  )
  instance = null
  pass('删除（勾选连状态文件）→ 索引、快照、状态文件都没了')

  // 11) 工作流设置：打开「记录运行状态」→ 落盘 settings.runState。
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  await sleep(300)
  // 回到模板：打开模板按钮（若还在实例视图）或直接用顶栏。
  const inRun = await session.evaluate(
    `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'run'`,
  )
  if (inRun) {
    await session.evaluate(`document.querySelector('[data-testid="wl-run-open-template"]').click()`)
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-root"]').dataset.mode === 'template'`,
    )
  }
  const settingsOnDisk = async (want) => {
    const deadline = Date.now() + 8000
    for (;;) {
      const doc = (await rpc('graph/load', { name: NAME })).document
      if ((doc.settings?.runState === true) === want) return
      if (Date.now() > deadline)
        throw new Error(`FAIL: 设置没落盘：${JSON.stringify(doc.settings)}`)
      await sleep(250)
    }
  }
  const toggleRunState = async () => {
    await waitFor(session, `document.querySelector('[data-testid="wl-settings-open"]') !== null`)
    await session.evaluate(`document.querySelector('[data-testid="wl-settings-open"]').click()`)
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-settings-run-state"]') !== null`,
    )
    const was = await session.evaluate(
      `document.querySelector('[data-testid="wl-settings-run-state"]').getAttribute('aria-checked')`,
    )
    await session.evaluate(
      `document.querySelector('[data-testid="wl-settings-run-state"]').click()`,
    )
    await screenshot(session, 'runs-07-settings.png')
    await session.evaluate(`document.querySelector('[data-testid="wl-settings-done"]').click()`)
    return was === 'true'
  }
  check((await toggleRunState()) === true, '这张图开着运行状态，设置里的开关应是开的')
  await settingsOnDisk(false)
  check((await toggleRunState()) === false, '关掉之后再打开设置，开关应是关的')
  await settingsOnDisk(true)
  pass('工作流设置里开关「记录运行状态」→ 落盘 settings.runState（关掉整键不写）')

  // 13) 顶栏「预览 / 执行」组：执行可点，小箭头列出本工作区的会话、本会话在最前（不真的执行）。
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-start"]')?.getAttribute('aria-disabled') === 'false'`,
  )
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-preview"]') !== null`),
    '预览按钮还在（只留图标）',
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-run-start"]').getAttribute('aria-label')`,
    )) === '新建会话执行',
    '主按钮缺省是新建会话执行',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-run-more"]').click()`)
  await waitFor(session, `document.querySelectorAll('[data-testid="wl-run-session"]').length > 0`)
  check(
    await session.evaluate(
      `(() => { const menu = document.querySelector('[data-testid="wl-run-new"]'); const first = document.querySelector('[data-testid="wl-run-session"]'); return menu !== null && (menu.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 })()`,
    ),
    '下拉第一项应是「新建会话」',
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-run-session"]').dataset.value`,
    )) === browserSession,
    '会话列表第一项应是本会话',
  )
  await screenshot(session, 'runs-08-launch.png')
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
  })
  // 预览计划：和执行时模型拿到的同一份——工作区写本会话的，实例 id 先留 {instance}，带运行状态段。
  await session.evaluate(`document.querySelector('[data-testid="wl-preview"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-plan-text"]') !== null`, {
    timeoutMs: 8000,
  })
  const planText = await session.evaluate(
    `document.querySelector('[data-testid="wl-plan-text"]').innerText`,
  )
  check(!planText.includes('未指定'), '预览里的工作区路径应是本会话的')
  check(planText.includes('{instance}'), '预览里实例 id 处应留着 {instance}')
  check(planText.includes('state'), '开了运行状态的预览应带「运行状态」段（用 state 动作记）')
  check(!planText.includes('目标：'), '没给目标就不写目标那一行')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-plan"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-plan"]') === null`)
  pass(
    '「预览 / 执行」组：缺省新建会话执行；下拉第一项是新建会话，下面是本工作区会话、本会话在最前；预览和执行时的计划对得上',
  )

  // 14) 不记运行状态的实例（没开开关时从画布执行建出来的）：只显示图，右栏说明为什么没有进度。
  const plain = await rpc('graph/load', { name: NAME })
  const untracked = await runs.start({
    workflow: NAME,
    document: { ...plain.document, settings: {} },
    problems: [],
    session: { id: FAKE_SESSION, cwd: WORKSPACE },
  })
  check(untracked.ok && untracked.result.instance.statePath === undefined, '应建出不记状态的实例')
  instance = untracked.result.instance.id
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-open"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-view"]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-view"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-untracked"]') !== null`)
  check(
    await session.evaluate(`document.querySelectorAll('[data-testid="wl-run-chip"]').length === 0`),
    '不记状态的实例不挂状态小标',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-run-status"]').textContent.includes('不记进度')`,
    ),
    '顶栏小标应是「不记进度」',
  )
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-run-banner"]') === null`),
    '不该报「状态文件不在了」',
  )
  await screenshot(session, 'runs-09-untracked.png')
  pass('不记运行状态的实例：只读的图 + 右栏说明，没有状态小标、不报错')

  // 15) 产出文件：步骤详情列出它写的文件；点进去是文件面板（生成没有、预览、谁写谁读）；查看框渲染 Markdown。
  // 没配产出根目录：产出落在这个实例自己的 .workflow-lite/runs/<实例>/out 下。
  const out = join(WORKSPACE, '.workflow-lite', 'runs', instance, 'out')
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'notes.md'), '# 侦察笔记\n\n- 第一条\n- 第二条\n')
  await session.evaluate(
    `document.querySelector('.react-flow__node[data-id="scan"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-step-file"][data-id="file-notes.md"]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-step-file"][data-id="file-notes.md"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-file-preview"]') !== null`)
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-run-file-state"]').textContent`,
      )
    ).includes('已生成'),
    '文件面板应标「已生成」',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-run-file-step"][data-id="scan"]') !== null`,
    ),
    '文件面板应列出写它的步骤 scan',
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-run-file-path"]').textContent`,
    )) === `.workflow-lite/runs/${instance}/out/notes.md`,
    '文件面板的路径应是实例自己的 out 目录',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-file-view"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-file-viewer"] h1')?.textContent === '侦察笔记'`,
  )
  await screenshot(session, 'runs-10-viewer.png')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-file-viewer"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-file-viewer"]') === null`)
  pass('产出文件：步骤详情 → 文件面板（已生成、预览、谁写它）→ 查看框渲染 Markdown')

  console.log('\n✅ 工作流实例验收全部通过')
} catch (error) {
  await screenshot(session, 'runs-fail.png').catch(() => {})
  console.error(
    `\n❌ 第 ${step + 1} 步失败：${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
} finally {
  if (instance !== null) await runs.remove(instance, true).catch(() => {})
  await rpc('graph/delete', { name: NAME }).catch(() => {})
  await rm(WORKSPACE, { recursive: true, force: true }).catch(() => {})
  session.close()
}
