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
import { bootToCanvas, centerOf, mouseClick, mouseMove, screenshot } from './lib/canvas-harness.mjs'
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
      data: { items: [{ kind: 'file', value: 'notes.md', note: '列出现状与风险' }] },
    },
    {
      id: 'refs',
      type: 'wfResource',
      position: { x: 0, y: 0 },
      data: {
        label: '参考',
        description: '侦察时要看的东西',
        items: [
          { kind: 'folder', value: 'src' },
          { kind: 'url', value: 'https://example.com/docs/guide' },
          { kind: 'text', value: '# 规矩\n\n- 先读再改' },
        ],
      },
    },
  ],
  edges: [
    { ...edge('scan', 'review'), data: { handoff: { note: '重点看鉴权和缓存两块' } } },
    edge('review', 'report', 'pass'),
    edge('review', 'fix', 'fail'),
    edge('fix', 'review'),
    edge('scan', 'file-notes.md'),
    edge('refs', 'scan'),
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

/** 画布上一处空白（点下去落在画布底板上，不在卡片、线和浮层上）。 */
async function blankPoint(session) {
  const point = await session.evaluate(`(() => {
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect()
    for (let y = pane.top + 120; y < pane.bottom - 80; y += 24) {
      for (let x = pane.left + 24; x < pane.right - 24; x += 24) {
        const hit = document.elementFromPoint(x, y)
        if (hit?.classList.contains('react-flow__pane')) return { x, y }
      }
    }
    return null
  })()`)
  check(point !== null, '画布上找不到空白处')
  return point
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
  await sleep(300)
  await screenshot(session, 'runs-01-hub.png')

  // 1a) 工作流中心：按工作区分组、会话一栏、搜索、选工作区；存储页统计一次就不再闪。
  const rowSel = `[data-testid="wl-hub-row"][data-id="${instance}"]`
  const hubFacts = await session.evaluate(`(() => {
    const row = document.querySelector('${rowSel}')
    const group = row.closest('[data-testid="wl-hub-group"]')
    return { group: group.textContent, row: row.textContent }
  })()`)
  check(hubFacts.group.includes(WORKSPACE), `实例应归在它的工作区那一组：${hubFacts.group}`)
  check(
    hubFacts.row.includes('会话已不在') || hubFacts.row.includes('其他会话'),
    `假会话应标成「会话已不在」：${hubFacts.row}`,
  )
  check(hubFacts.row.includes(NAME) && hubFacts.row.includes('验收'), '行里应有工作流名和目标')
  const typeSearch = async (text) => {
    await session.evaluate(`(() => {
      const input = document.querySelector('[data-testid="wl-hub-search"]')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, ${JSON.stringify(text)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
  }
  await typeSearch('zz-no-such-thing')
  await waitFor(session, `document.querySelectorAll('[data-testid="wl-hub-row"]').length === 0`)
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-hub-list"]').textContent.includes('没有符合条件的实例')`,
    ),
    '搜不到时应说没有符合条件的实例',
  )
  await typeSearch(`${NAME} 验收`)
  await waitFor(session, `document.querySelector('${rowSel}') !== null`)
  await typeSearch('')
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-workspace"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-hub-workspace-item"]') !== null`)
  await sleep(250)
  await screenshot(session, 'runs-01b-hub-workspace.png')
  await session.evaluate(`(() => {
    const items = [...document.querySelectorAll('[data-testid="wl-hub-workspace-item"]')]
    items.find((item) => item.dataset.path === ${JSON.stringify(WORKSPACE)}).click()
  })()`)
  await waitFor(session, `document.querySelectorAll('[data-testid="wl-hub-group"]').length === 1`)
  check(
    await session.evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="wl-hub-row"]')]
      return rows.length >= 1 && rows.some((row) => row.dataset.id === '${instance}')
    })()`),
    '选了工作区只剩那一组，实例还在',
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-hub-workspace"]').textContent`,
    )) === WORKSPACE.split(/[\\/]/).at(-1),
    '工作区按钮应显示目录名',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-storage"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-hub-stats"]') !== null`)
  const flips = await session.evaluate(`new Promise((resolve) => {
    const button = () => document.querySelector('[data-testid="wl-hub-clear-finished"]')
    let last = button()?.disabled
    let changes = 0
    const timer = setInterval(() => {
      const now = button()?.disabled
      if (now !== last) changes += 1
      last = now
    }, 20)
    setTimeout(() => { clearInterval(timer); resolve(changes) }, 1500)
  })`)
  check(flips === 0, `存储页的按钮不该来回闪（1.5 秒里变了 ${flips} 次）`)
  const storageText = await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-stats"]').textContent`,
  )
  check(
    storageText.includes('数据目录') &&
      storageText.includes('我的步骤') &&
      !storageText.includes('派发缓存'),
    `存储页应列数据目录、各样东西，不再有「派发缓存」：${storageText}`,
  )
  await screenshot(session, 'runs-01c-hub-storage.png')
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-runs"]').click()`)
  await waitFor(session, `document.querySelector('${rowSel} [data-testid="wl-hub-view"]') !== null`)
  pass('工作流中心：按工作区分组、会话一栏、搜索与选工作区；存储页不闪、没有「派发缓存」')

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
  pass('工作流中心 → 查看实例：四张步骤卡挂上状态小标、右栏摊开概览')

  // 1b) 右栏和模板一样能收：点卡片看它、点空白处收起、顶栏开关再打开、右上角 ✕ 收起。
  const panelShown = `document.querySelector('[data-testid="wl-run-panel"]') !== null`
  await mouseClick(session, await centerOf(session, '.react-flow__node[data-id="scan"]'))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-panel"] [data-testid="wl-run-node-status"]') !== null`,
  )
  await mouseClick(session, await blankPoint(session))
  await waitFor(session, `!(${panelShown})`)
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-run-panel-toggle"]').getAttribute('aria-pressed')`,
    )) === 'false',
    '右栏收起后顶栏开关应是关着的',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-run-panel-toggle"]').click()`)
  await waitFor(session, panelShown)
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-run-timeline"], [data-testid="wl-run-overall"]') !== null`,
    ),
    '顶栏开关打开的是概览',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-run-panel-close"]').click()`)
  await waitFor(session, `!(${panelShown})`)
  // 右栏收着：「在看什么」不是激活的样子（图标块不上色）。
  check(
    await session.evaluate(`(() => {
      const nav = document.querySelector('[data-testid="wl-run-nav"]');
      return nav.dataset.idle === 'true' && getComputedStyle(nav.firstElementChild).backgroundColor === 'rgba(0, 0, 0, 0)';
    })()`),
    '右栏收着时「在看什么」不该是激活态',
  )
  await sleep(300)
  await screenshot(session, 'runs-01b-nav-idle.png')
  await session.evaluate(`document.querySelector('[data-testid="wl-run-panel-toggle"]').click()`)
  await waitFor(session, panelShown)
  pass('右栏：点卡片看详情、点空白处收起、顶栏开关打开概览、✕ 收起（收着时「在看什么」不激活）')

  // 2) 模型改状态文件：画布 2 秒左右跟上；走过的线亮起来。
  await modelEdit((state) => {
    state.status = 'running'
    state.nodes.scan = {
      status: 'done',
      round: 1,
      startedAt: '2026-10-02T10:00:00+08:00',
      finishedAt: '2026-10-02T10:05:00+08:00',
      summary:
        '摸清了：鉴权在 auth/ 下，token 刷新逻辑有两处重复；缓存层没有过期策略，命中率无监控；接口层有 3 个未覆盖测试的分支，其中支付回调最危险，需要优先补测试再改动；日志里 warn 级别噪音很多，建议先降噪再排查。',
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

  // 2b) 步骤与连线的详情（和模板一样能顺着上下游跳）：步骤列提示词、连接（箭头绿 = 这次走过）；
  // 点连接看那条线：走过没有、条件、交接、上游这次的摘要；点线的一端回到那一步。
  const inPanel = (selector) => `document.querySelector('[data-testid="wl-run-panel"] ${selector}')`
  await session.evaluate(
    `document.querySelector('.react-flow__edge[data-id="scan->review"] path').dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
  )
  await waitFor(session, `${inPanel('[data-testid="wl-run-edge"]')} !== null`)
  check(
    (await session.evaluate(`${inPanel('[data-testid="wl-run-edge-taken"]')}.dataset.on`)) ===
      'true',
    '画布上点 scan→review：右栏应显示已流转',
  )
  check(
    (
      await session.evaluate(`${inPanel('[data-testid="wl-run-edge-summary"]')}?.textContent ?? ''`)
    ).includes('摸清了'),
    '连线详情应带上游这次的摘要',
  )
  await screenshot(session, 'runs-02b-edge.png')
  await session.evaluate(`${inPanel('[data-testid="wl-run-edge-end"][data-id="review"]')}.click()`)
  await waitFor(session, `${inPanel('[data-testid="wl-run-links"]')} !== null`)
  check(
    (await session.evaluate(`${inPanel('[data-testid="wl-run-prompt"]')}.textContent`)).includes(
      '做 review',
    ),
    '步骤详情应露出提示词',
  )
  const linkTaken = (edgeId) =>
    session.evaluate(
      `${inPanel(`[data-testid="wl-run-link"][data-id="${edgeId}"]`)}?.dataset.taken ?? null`,
    )
  check((await linkTaken('scan->review')) === 'true', '上游 scan→review 这次走过了')
  check((await linkTaken('fix->review')) === 'false', '上游 fix→review 这次还没走')
  check((await linkTaken('review->report#pass')) === 'false', '下游 review→report 还没走')
  await screenshot(session, 'runs-02c-step.png')
  await session.evaluate(`${inPanel('[data-testid="wl-run-prompt-view"]')}.click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-prompt-viewer"]')?.textContent.includes('做 review')`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-prompt-viewer"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-prompt-viewer"]') === null`)
  await session.evaluate(
    `${inPanel('[data-testid="wl-run-link"][data-id="review->report#pass"]')}.click()`,
  )
  await waitFor(session, `${inPanel('[data-testid="wl-run-edge-taken"]')}?.dataset.on === 'false'`)
  check(
    (await session.evaluate(`${inPanel('')}.textContent`)).includes('尚未给出判定'),
    '条件线没走：应说明上游还没给判定',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-run-panel-close"]').click()`)
  await waitFor(session, `!(${panelShown})`)
  await session.evaluate(`document.querySelector('[data-testid="wl-run-panel-toggle"]').click()`)
  await waitFor(session, panelShown)
  pass(
    '步骤详情列提示词与上下游（绿箭头 = 走过）；点连接看线：走过没有、条件、上游摘要；点端点回到步骤',
  )

  // 2d) 执行位置：画布卡片上的「最后执行 / 下一步」小标与概览里的「执行位置」。
  const markOf = (id) =>
    `(document.querySelector('.react-flow__node[data-id="${id}"] [data-testid="wl-run-mark"]')?.dataset.mark ?? null)`
  const posRows = `[...document.querySelectorAll('[data-testid="wl-run-pos-row"]')].map((row) => row.dataset.kind + ':' + row.dataset.id).join(',')`
  await waitFor(session, `${markOf('scan')} === 'last'`)
  check(
    (await session.evaluate(markOf('review'))) === null,
    '在跑的 review 不挂位置小标（它有呼吸光环）',
  )
  check(
    (await session.evaluate(posRows)) === 'running:review,last:scan',
    `执行位置应是「执行中 review、最后执行 scan」：${await session.evaluate(posRows)}`,
  )
  const beforeLoop = await readFile(statePath, 'utf8')
  await modelEdit((state) => {
    state.nodes.review = {
      status: 'done',
      round: 1,
      verdict: 'fail',
      startedAt: '2026-10-02T10:06:00+08:00',
      finishedAt: '2026-10-02T10:10:00+08:00',
      summary: '有 2 处问题',
    }
    state.nodes.fix = {
      status: 'done',
      round: 1,
      startedAt: '2026-10-02T10:11:00+08:00',
      finishedAt: '2026-10-02T10:15:00+08:00',
    }
    state.log.push(
      { at: '2026-10-02T10:10:00+08:00', node: 'review', event: 'done', round: 1, verdict: 'fail' },
      { at: '2026-10-02T10:11:00+08:00', node: 'fix', event: 'start', round: 1 },
      { at: '2026-10-02T10:15:00+08:00', node: 'fix', event: 'done', round: 1 },
    )
  })
  await waitFor(session, `${markOf('fix')} === 'last' && ${markOf('review')} === 'next'`, {
    timeoutMs: 6000,
  })
  check((await session.evaluate(markOf('report'))) === null, '环外的 report 不是下一步')
  check(
    (await session.evaluate(posRows)) === 'last:fix,next:review',
    `执行位置应是「最后执行 fix、下一步 review」：${await session.evaluate(posRows)}`,
  )
  const nextText = await session.evaluate(
    `document.querySelector('[data-testid="wl-run-pos-row"][data-kind="next"]').textContent`,
  )
  check(
    nextText.includes('第 2 轮') && nextText.includes('由 修复 循环回来'),
    `下一步一行应写明第 2 轮、由修复循环回来：${nextText}`,
  )
  await screenshot(session, 'runs-02d-position.png')

  // 2e) 指定下一步：执行位置里「指定」勾一步 → 草稿里下一步换成它（用户指定）；「恢复自动」撤掉。
  await session.evaluate(`document.querySelector('[data-testid="wl-run-pin-open"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-pin"][data-id="report"]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-pin"][data-id="report"]').click()`,
  )
  await waitFor(session, `${markOf('report')} === 'next' && ${markOf('review')} === null`)
  check(
    (await session.evaluate(posRows)) === 'last:fix,next:report',
    `指定后执行位置应是「最后执行 fix、下一步 report」：${await session.evaluate(posRows)}`,
  )
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-run-pos-row"][data-kind="next"]').textContent`,
      )
    ).includes('用户指定'),
    '指定的下一步应写明「用户指定」',
  )
  check(
    (await session.evaluate(`document.querySelector('[data-testid="wl-run-draft"]') !== null`)) &&
      parse(await readFile(statePath, 'utf8')).next === undefined,
    '指定进草稿、不落盘',
  )
  await screenshot(session, 'runs-02e-pin.png')
  await session.evaluate(`document.querySelector('[data-testid="wl-run-pin-clear"]').click()`)
  await waitFor(
    session,
    `${markOf('review')} === 'next' && document.querySelector('[data-testid="wl-run-draft"]') === null`,
  )
  pass(
    '执行位置「指定」：勾 report → 下一步换成它（用户指定），进草稿；恢复自动 → 回到审查第 2 轮、草稿清空',
  )

  await writeFile(statePath, beforeLoop)
  await waitFor(session, `${chipOf('review')} === 'running' && ${markOf('scan')} === 'last'`, {
    timeoutMs: 6000,
  })
  pass('执行位置：卡片挂「最后执行 / 下一步」，循环里修完指回审查第 2 轮而不是环外；概览列出同一份')

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
  // 工作流中心里同一个实例标「状态文件有误」，点小标展开原因。
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-open"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-why"]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-why"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-hub-reason"]') !== null`)
  const reason = await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-reason"]').textContent`,
  )
  check(
    reason.includes('status') && reason.includes('不认识'),
    `原因应指出 status 写错了：${reason}`,
  )
  await sleep(250)
  await screenshot(session, 'runs-03b-hub-why.png')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub"] button[aria-label="关闭"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-hub"]') === null`)
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

  // 4b) 顶栏和模板一样：撤销重做（图和状态排成一条）、整理、检查结果。
  const draftCount = () =>
    session.evaluate(
      `document.querySelector('[data-testid="wl-run-draft-toggle"]')?.textContent ?? ''`,
    )
  const clickTool = (id) =>
    session.evaluate(
      `document.querySelector('[data-testid="wl-run-tools"] [data-testid="${id}"]').click()`,
    )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-run-tools"] [data-testid="wl-issues"]') !== null`,
    ),
    '实例顶栏应有检查结果',
  )
  await clickTool('wl-undo')
  await waitFor(session, `(${chipOf('fix')}) === 'skipped'`)
  check((await draftCount()).includes('1'), `撤销一步应剩 1 处：${await draftCount()}`)
  await clickTool('wl-redo')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-draft-toggle"]')?.textContent.includes('2')`,
  )
  const before = await session.evaluate(
    `(() => { const n = document.querySelector('.react-flow__node[data-id="report"]'); return n.style.transform })()`,
  )
  // 拖一下 report 卡片：图的改动，第 3 处。
  const grip = await centerOf(session, '.react-flow__node[data-id="report"]')
  const drag = async (type, x, y, buttons) =>
    session.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
  await drag('mousePressed', grip.x, grip.y, 1)
  for (let i = 1; i <= 6; i += 1) {
    await drag('mouseMoved', grip.x + i * 25, grip.y + i * 12, 1)
    await sleep(40)
  }
  await sleep(150)
  await drag('mouseReleased', grip.x + 150, grip.y + 72, 0)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-draft-toggle"]')?.textContent.includes('3')`,
  )
  // 拖完浏览器会吞掉紧跟着的那一下点击（d3-drag 的 noclick）：真人移到按钮上早就过去了，这里等一下。
  await sleep(300)
  await clickTool('wl-undo')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-draft-toggle"]')?.textContent.includes('2')`,
  )
  await waitFor(
    session,
    `document.querySelector('.react-flow__node[data-id="report"]').style.transform === ${JSON.stringify(before)}`,
  )
  check((await session.evaluate(chipOf('fix'))) === 'skipped', '撤销挪卡片不该动状态的改动')
  // 整理：点了不报错；排出了不一样的位置就再撤回来，草稿回到 2 处。
  await clickTool('wl-tidy')
  await sleep(900)
  if ((await draftCount()).includes('3')) {
    await clickTool('wl-undo')
    await waitFor(
      session,
      `document.querySelector('[data-testid="wl-run-draft-toggle"]')?.textContent.includes('2')`,
    )
  }
  check(
    await session.evaluate(
      `!document.querySelector('[data-testid="wl-run-tools"] [data-testid="wl-redo"]').disabled`,
    ),
    '撤销后应能重做',
  )
  // 加一步状态改动：重做就作废了（新的一步之后不能重做）。拖卡片时选中了它，先回到概览。
  await session.evaluate(`document.querySelector('[data-testid="wl-run-panel-close"]')?.click()`)
  await session.evaluate(`document.querySelector('[data-testid="wl-run-panel-toggle"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-overall"][data-value="running"]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-overall"][data-value="running"]').click()`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-tools"] [data-testid="wl-redo"]').disabled`,
  )
  await clickTool('wl-undo')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-overall"][data-value="waiting"]')?.getAttribute('aria-checked') === 'true'`,
  )
  await clickTool('wl-issues')
  await waitFor(session, `document.querySelector('[role="dialog"][aria-label="检查"]') !== null`)
  await screenshot(session, 'runs-04b-tools.png')
  await clickTool('wl-issues')
  pass(
    '实例顶栏：撤销 / 重做把状态和图排成一条，整理能撤回，新的一步之后不能重做；检查结果和模板同一套',
  )

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

  // 8b) 改图：右栏切到「编辑」改提示词 → 草稿栏多一处图的改动；执行过的步骤删不掉；
  // 保存 → 快照、planId、状态里的 plan、任务描述都换新，通知（暂存）让模型去 resume。
  const planBefore = JSON.parse(
    await readFile(join(DATA_DIR, 'instances.json'), 'utf8'),
  ).instances.find((item) => item.id === instance).planId
  await session.evaluate(
    `document.querySelector('.react-flow__node[data-id="review"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-mode"]') !== null`)
  // 「运行 / 编辑」是标题栏里关闭按钮左边的两个图标格；两边标题栏一模一样（切换时不动）。
  const headShape = (panel) => `(() => {
    const head = document.querySelector('[data-testid="${panel}"] header');
    const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','); };
    return [box(head), box(head.firstElementChild), box(head.querySelector('[data-testid="wl-run-mode"]')), head.querySelector('input')?.value, head.querySelector('[data-testid="wl-panel-id"]')?.textContent].join('|');
  })()`
  const runHead = await session.evaluate(headShape('wl-run-panel'))
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-mode"] [data-mode="edit"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-inspector"]') !== null`)
  const editHead = await session.evaluate(headShape('wl-inspector'))
  check(runHead === editHead, `运行 / 编辑两边的标题栏应一样：${runHead} vs ${editHead}`)
  check(editHead.includes('review'), '标题栏名字下面一行 ID')
  // 「在看什么」在顶栏最右、右栏开关的右边，不在右栏里；图标块和开关按下时的底色一样大。
  check(
    await session.evaluate(`(() => {
      const nav = document.querySelector('[data-testid="wl-run-nav"]');
      const toggle = document.querySelector('[data-testid="wl-run-panel-toggle"]');
      if (nav === null || toggle === null || nav.closest('aside') !== null) return false;
      const a = nav.getBoundingClientRect(), b = toggle.getBoundingClientRect();
      const tile = nav.firstElementChild.getBoundingClientRect();
      return nav.dataset.idle === 'false' && b.right <= a.left + 1 && a.left - b.right < 12 && Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 2 && tile.width === b.width && tile.height === b.height;
    })()`),
    '「在看什么」应在顶栏、紧挨着右栏开关的右边，图标块与开关一样大',
  )
  // 提示词只露一截，点笔在弹窗里改。
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-ins-prompt-card-edit"]') !== null`,
  )
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-ins-prompt"]') === null`),
    '右栏里不再直接放提示词的输入框',
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-ins-prompt-card-edit"]').click()`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-ins-prompt"]') !== null`)
  await session.evaluate(`(() => {
    const area = document.querySelector('[data-testid="wl-ins-prompt"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, '换个审法：先看鉴权');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(400)
  await screenshot(session, 'runs-07a-edit-prompt.png')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-ins-prompt-card-viewer"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-ins-prompt-card-viewer"]') === null`,
  )
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-ins-prompt-card-card"]').textContent`,
      )
    ).includes('换个审法'),
    '关上弹窗，右栏那一截应是改过的提示词',
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-run-draft"]') !== null`)
  check(
    (
      await session.evaluate(
        `document.querySelector('[data-testid="wl-run-draft-toggle"]').textContent`,
      )
    ).includes('已改 1 处'),
    '改了提示词 → 草稿栏「已改 1 处」',
  )
  await screenshot(session, 'runs-07b-edit-graph.png')
  await session.evaluate(
    `document.querySelector('.react-flow__node[data-id="scan"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-delete-node"]') !== null`)
  await session.evaluate(`document.querySelector('[data-testid="wl-delete-node"]').click()`)
  check(
    await session.evaluate(`document.querySelector('.react-flow__node[data-id="scan"]') !== null`),
    '执行过的步骤 scan 不该被删掉',
  )
  check(
    (await session.evaluate(`document.body.innerText`)).includes('执行过的步骤不能删'),
    '删执行过的步骤应提示改成跳过',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-run-save"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-run-draft"]') === null`, {
    timeoutMs: 8000,
  })
  const graphAfter = JSON.parse(
    await readFile(join(DATA_DIR, 'runs', instance, 'graph.json'), 'utf8'),
  )
  check(
    graphAfter.nodes.find((item) => item.id === 'review').data.prompt === '换个审法：先看鉴权',
    '快照里 review 的提示词应换成新的',
  )
  const recordAfter = JSON.parse(
    await readFile(join(DATA_DIR, 'instances.json'), 'utf8'),
  ).instances.find((item) => item.id === instance)
  check(recordAfter.planId !== planBefore, 'planId 应换新')
  check(
    parse(await readFile(statePath, 'utf8')).plan === recordAfter.planId,
    '状态里的 plan 跟着换',
  )
  check(
    (
      await readFile(
        join(WORKSPACE, '.workflow-lite', 'runs', instance, 'tasks', 'review.md'),
        'utf8',
      )
    ).startsWith('换个审法：先看鉴权\n\n---\n'),
    '任务描述应重写（提示词在前，后面附判定行要求）',
  )
  check(
    recordAfter.pendingNotice?.includes('用户在画布上修改了图') &&
      recordAfter.pendingNotice.includes('action=resume'),
    '通知应说图改了、让模型 resume',
  )
  // 顶栏「在看什么」：按分类列出节点，搜「汇总」回车就切过去；概览是固定图标。
  await session.evaluate(`document.querySelector('[data-testid="wl-run-nav"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-run-nav-search"]') !== null`)
  check(
    (await session.evaluate(
      `document.querySelectorAll('[data-testid="wl-run-nav-item"]').length`,
    )) >= 7,
    '下拉应列出概览、四个步骤与资源',
  )
  await sleep(400)
  await screenshot(session, 'runs-07c-nav.png')
  await session.evaluate(`(() => {
    const input = document.querySelector('[data-testid="wl-run-nav-search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '汇总');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await waitFor(
    session,
    `document.querySelectorAll('[data-testid="wl-run-nav-item"]').length === 1`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-nav-search"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-panel-id"]')?.textContent.includes('report')`,
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-run-nav"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-nav-item"][data-id=""]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-nav-item"][data-id=""]').click()`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-panel"] [data-testid="wl-panel-id"]') === null && document.querySelector('[data-testid="wl-run-panel"]')?.textContent.includes('概览')`,
  )
  pass(
    '运行 / 编辑两边标题栏一样；右栏「编辑」在弹窗里改提示词 → 已改 1 处；顶栏「在看什么」按分类列节点、能搜；执行过的步骤删不掉；保存后快照、planId、任务描述换新，通知让模型 resume',
  )

  // 9) 移到本会话：变成本会话的当前实例，流水记 transfer。
  const browserSession = await session.evaluate(
    `document.querySelector('[data-testid="wl-root"]').dataset.session`,
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-open"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-move"]') !== null`,
  )
  // 列表里的按钮也走共用提示：不被滚动区裁掉，长说明折行、整个在视图里。
  const moveButton = `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-move"]')`
  await mouseMove(
    session,
    await centerOf(
      session,
      `[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-move"]`,
    ),
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-tip"]')?.textContent === ${moveButton}.dataset.tip`,
  )
  check(
    await session.evaluate(`(() => {
      const tip = document.querySelector('[data-testid="wl-tip"]').getBoundingClientRect();
      const root = document.querySelector('[data-testid="wl-root"]').getBoundingClientRect();
      return tip.width <= 320 && tip.left >= root.left && tip.right <= root.right && tip.bottom <= root.bottom;
    })()`),
    '「移到本会话」的提示应折行、整个落在视图里',
  )
  await screenshot(session, 'runs-09-hub-tip.png')
  await session.evaluate(`${moveButton}.click()`)
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
  check(!/^目标：/m.test(planText), '没给目标就不写目标那一行')
  check(planText.includes('create_goal'), '设定目标缺省开：预览应让主 agent 先 create_goal')
  await session.evaluate(
    `document.querySelector('[data-testid="wl-plan"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await waitFor(session, `document.querySelector('[data-testid="wl-plan"]') === null`)
  pass(
    '「预览 / 执行」组：缺省新建会话执行；下拉第一项是新建会话，下面是本工作区会话、本会话在最前；预览和执行时的计划对得上',
  )

  // 14) 不记运行状态的实例（没开开关时从画布执行建出来的）：只显示图，右栏说明为什么没有进度。
  const plain = await rpc('graph/load', { name: NAME })
  // 多一个 HTML 看板（report 产出），第 15 步看它能不能在查看框里渲染。
  const board = {
    id: 'board',
    type: 'wfResource',
    position: { x: 0, y: 0 },
    data: {
      label: '看板',
      items: [
        {
          kind: 'file',
          value: 'board.html',
          note: '单文件 HTML 看板（**只有判定步骤写**）\n· 顶部汇总卡\n· 每轮一行',
        },
      ],
    },
  }
  const untracked = await runs.start({
    workflow: NAME,
    document: {
      ...plain.document,
      nodes: [...plain.document.nodes, board],
      edges: [...plain.document.edges, edge('report', 'board')],
      settings: {},
    },
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
  pass('不记运行状态的实例：图 + 右栏说明，没有状态小标、不报错')

  // 15) 资源：步骤详情列出它写的文件；点进去右栏只放缩略（生成没有 · 大小 · 时间、用到它的步骤），
  // 查看在详情框里：文件读正文（带生成要求），文件夹列内容，网址、自定义文字显示全文。
  // 没配产出根目录：产出落在这个实例自己的 .workflow-lite/runs/<实例>/out 下。
  const out = join(WORKSPACE, '.workflow-lite', 'runs', instance, 'out')
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'notes.md'), '# 侦察笔记\n\n- 第一条\n- 第二条\n')
  await mkdir(join(WORKSPACE, 'src', 'lib'), { recursive: true })
  await writeFile(join(WORKSPACE, 'src', 'main.ts'), 'export {}\n')
  const panelText = (selector) =>
    session.evaluate(
      `document.querySelector('[data-testid="wl-run-panel"] ${selector}')?.textContent ?? ''`,
    )
  // 标题栏里的名字是能改的输入框（和「编辑」那边同一个）：没起名字时显示的是占位。
  const headName = () =>
    session.evaluate(`(() => {
      const input = document.querySelector('[data-testid="wl-run-panel"] header input');
      return input === null ? '' : input.value || input.placeholder;
    })()`)
  const pressEscape = (testId) =>
    session.evaluate(
      `document.querySelector('[data-testid="${testId}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    )
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
  await waitFor(session, `document.querySelector('[data-testid="wl-run-resource"]') !== null`)
  check((await headName()).includes('notes.md'), '右栏标题应是资源的名字')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-item-state"]')?.textContent.includes('已生成')`,
  )
  check(
    /\d+ B/u.test(await panelText('[data-testid="wl-run-resource-item"]')),
    '文件那一行应带大小',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-run-file-step"][data-id="scan"]') !== null`,
    ),
    '右栏应列出用到它的步骤 scan',
  )
  check(
    (await panelText('[data-testid="wl-run-item-note"]')) === '说明' &&
      (
        await session.evaluate(
          `document.querySelector('[data-testid="wl-run-resource-item"] button').dataset.tip`,
        )
      ).includes('列出现状与风险'),
    '有说明的那一行挂「说明」小签，全文在悬停提示里',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-run-file-preview"]') === null`,
    ),
    '右栏不再内嵌文件正文',
  )
  await screenshot(session, 'runs-10-resource.png')
  await session.evaluate(`document.querySelector('[data-testid="wl-run-item-view"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-file-viewer"] h1')?.textContent === '侦察笔记'`,
  )
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-file-viewer"] code').textContent`,
    )) === `.workflow-lite/runs/${instance}/out/notes.md`,
    '查看框的路径应是实例自己的 out 目录',
  )
  // 说明收在标题行的「说明」开关里：缺省收着、不占正文；点开从右边滑出，Esc 先收起它。
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-viewer-note-toggle"]') !== null && document.querySelector('[data-testid="wl-viewer-note"]') === null`,
    ),
    '查看框应有「说明」开关，缺省收着',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-viewer-body"] [data-testid="wl-item-note"]') === null`,
    ),
    '正文上面不再固定放说明',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-viewer-note-toggle"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-viewer-note"]')?.textContent.includes('列出现状与风险')`,
  )
  await new Promise((resolve) => setTimeout(resolve, 300))
  await screenshot(session, 'runs-11-viewer.png')
  await pressEscape('wl-viewer-note')
  await waitFor(session, `document.querySelector('[data-testid="wl-viewer-note"]') === null`)
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-file-viewer"]') !== null`),
    'Esc 先收起说明，查看框还在',
  )
  await pressEscape('wl-file-viewer')
  await waitFor(session, `document.querySelector('[data-testid="wl-file-viewer"]') === null`)
  pass(
    '产出文件：右栏一行缩略（已生成 · 大小 · 时间）+ 用到它的步骤；查看框读正文，说明收在开关里、拉出来盖在右边',
  )

  // HTML 产出：查看框默认在沙箱框里渲染页面（脚本能跑，但碰不到画布），可切到源码。
  // 暗底、够长：要出滚动条，滑块该是浅色（跟页面的底色走，不跟画布主题）。
  const boardRows = Array.from({ length: 60 }, (_, index) => `<tr><td>R${index + 1}</td></tr>`)
  await writeFile(
    join(out, 'board.html'),
    `<!doctype html><html><body style="background:#0f1115;color:#e6e9ef"><h1>看板</h1><table>${boardRows.join('')}</table>
<script>
let sameOrigin = true
try { void parent.document.title } catch { sameOrigin = false }
window.addEventListener('load', () => {
  const root = getComputedStyle(document.documentElement)
  const thumb = root.getPropertyValue('--wl-preview-thumb').trim()
  const track = root.getPropertyValue('--wl-preview-track').trim()
  parent.postMessage({ board: document.querySelectorAll('tr').length, sameOrigin, thumb, track }, '*')
})
</script></body></html>\n`,
  )
  await session.evaluate(`(() => {
    window.__board = null
    window.addEventListener('message', (event) => {
      if (event.data && typeof event.data === 'object' && 'board' in event.data) window.__board = event.data
    })
  })()`)
  await session.evaluate(
    `document.querySelector('.react-flow__node[data-id="report"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-step-file"][data-id="board"]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-run-step-file"][data-id="board"]').click()`,
  )
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-panel"] header input')?.value === '看板'`,
  )
  // 内容清单的卡片不裁内容：行尾按钮的提示、「用其他程序打开」的下拉要能伸出去。
  check(
    await session.evaluate(
      `getComputedStyle(document.querySelector('[data-testid="wl-run-resource-items"] ul')).overflow === 'visible'`,
    ),
    '内容清单的卡片不该裁掉伸出去的提示和下拉',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-run-item-view"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-viewer-frame"]') !== null`)
  await waitFor(session, `window.__board !== null`)
  const boardMessage = await session.evaluate(`window.__board`)
  check(boardMessage.board === 60, `页面里的脚本应跑起来并数到 60 行，实际 ${boardMessage.board}`)
  check(
    boardMessage.thumb === 'rgba(255,255,255,.28)',
    `暗底页面的滚动条滑块应是浅色，实际 ${boardMessage.thumb}`,
  )
  check(
    boardMessage.track === 'rgb(15, 17, 21)',
    `整页滚动条的轨道应是页面底色，实际 ${boardMessage.track}`,
  )
  check(boardMessage.sameOrigin === false, '页面应在独立的源里，碰不到画布')
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-viewer-frame"]').getAttribute('sandbox') === 'allow-scripts'`,
    ),
    '沙箱只开 allow-scripts',
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-viewer-frame"]').srcdoc.startsWith('<!doctype html><html><style data-wl-preview>')`,
    ),
    '页面里补了细滚动条的样式，插在 doctype 之后',
  )
  check(
    await session.evaluate(`(() => {
      const body = document.querySelector('[data-testid="wl-viewer-body"]')
      return body.scrollHeight <= body.clientHeight + 1
    })()`),
    '页面外面不该再多一层滚动条',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-viewer-note-toggle"]').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-viewer-note"]')?.textContent.includes('每轮一行')`,
  )
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-viewer-note"] strong')?.textContent === '只有判定步骤写'`,
    ),
    '说明按 Markdown 排版（粗体不露星号）',
  )
  const viewButtons = () =>
    `[...document.querySelectorAll('[data-testid="wl-file-viewer"] header button')]`
  check(
    await session.evaluate(`${viewButtons()}.some((button) => button.textContent === '页面')`),
    'HTML 的排版视图叫「页面」',
  )
  await new Promise((resolve) => setTimeout(resolve, 300))
  await screenshot(session, 'runs-11b-html.png')
  await session.evaluate(`document.querySelector('[data-testid="wl-viewer-note-toggle"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-viewer-note"]') === null`)
  await screenshot(session, 'runs-11c-html-scroll.png')
  await session.evaluate(`${viewButtons()}.find((button) => button.textContent === '源码').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-viewer-body"] pre')?.textContent.includes('<table>')`,
  )
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-viewer-frame"]') === null`),
    '切到源码后不再渲染页面',
  )
  await pressEscape('wl-file-viewer')
  await waitFor(session, `document.querySelector('[data-testid="wl-file-viewer"]') === null`)
  pass('HTML 产出：查看框在沙箱里渲染页面（脚本能跑、不同源），可切到源码')

  // 别的种类：文件夹列内容、网址、自定义文字。
  await session.evaluate(
    `document.querySelector('.react-flow__node[data-id="refs"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
  )
  await waitFor(
    session,
    `document.querySelectorAll('[data-testid="wl-run-resource-item"]').length === 3`,
  )
  check((await headName()).includes('参考'), '右栏标题应是资源的名字')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-run-resource-item"][data-kind="folder"] [data-testid="wl-run-item-state"]')?.dataset.on === 'true'`,
  )
  await screenshot(session, 'runs-12-kinds.png')
  const openKind = (kind) =>
    session.evaluate(
      `document.querySelector('[data-testid="wl-run-resource-item"][data-kind="${kind}"] button').click()`,
    )
  await openKind('folder')
  await waitFor(
    session,
    `document.querySelectorAll('[data-testid="wl-folder-entries"] li').length === 2`,
  )
  check(
    (await session.evaluate(
      `[...document.querySelectorAll('[data-testid="wl-folder-entries"] li')].map((li) => li.textContent).join(',')`,
    )) === 'lib,main.ts',
    '文件夹详情应列出里面的东西（目录在前）',
  )
  await screenshot(session, 'runs-13-folder.png')
  await pressEscape('wl-folder-viewer')
  await waitFor(session, `document.querySelector('[data-testid="wl-folder-viewer"]') === null`)
  await openKind('url')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-url-open"]')?.getAttribute('href') === 'https://example.com/docs/guide'`,
  )
  await pressEscape('wl-url-viewer')
  await waitFor(session, `document.querySelector('[data-testid="wl-url-viewer"]') === null`)
  await openKind('text')
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-text-viewer"] h1')?.textContent === '规矩'`,
  )
  await pressEscape('wl-text-viewer')
  await waitFor(session, `document.querySelector('[data-testid="wl-text-viewer"]') === null`)
  pass('其他种类：文件夹详情列出里面的东西、网址能在浏览器中打开、自定义文字排版显示')

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
