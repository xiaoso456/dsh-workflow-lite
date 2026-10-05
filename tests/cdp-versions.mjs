/**
 * 工作流版本的真浏览器验收：编辑页的「版本」对话框 + 工作流中心的「工作流」页，结论以磁盘为准。
 *
 * 存版本 → 改图 → 展开看切换会变什么 → 切回去（自动存一份现在的）→ 改说明 → 删版本 →
 * 在工作流中心给另一张没打开的工作流存版本 → 在那里给它改名（版本跟着走）→ 给正开着的那张改名 →
 * 删掉正开着的那张（编辑页空出来）→ 从那里打开另一张。
 *
 * usage: DSH_WEB_TOKEN=<token> DSH_WEB_URL=http://127.0.0.1:3190 node --experimental-strip-types tests/cdp-versions.mjs
 */

import {
  bootToCanvas,
  mouseMove,
  pressKey,
  screenshot,
  setReactInput,
} from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'

const NAME = `ver-${Date.now().toString(36)}`
const OTHER = `${NAME}-b`
const RENAMED = `${NAME}-c`
const NAME2 = `${NAME}-d`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let step = 0
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
function pass(message) {
  step += 1
  console.log(`  ${String(step).padStart(2)} ${message}`)
}

const exists = (testId) => `document.querySelector('[data-testid="${testId}"]') !== null`
const gone = (testId) => `document.querySelector('[data-testid="${testId}"]') === null`
const clickTestId = (testId) =>
  `(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) return false; el.click(); return true })()`
const textOf = (testId) =>
  `(document.querySelector('[data-testid="${testId}"]')?.textContent || '')`

function stepNode(id, prompt, x) {
  return { id, type: 'wfNode', position: { x, y: 0 }, data: { prompt } }
}

async function writeGraph(name, nodes) {
  const loaded = await rpc('graph/load', { name })
  await rpc('graph/save', {
    name,
    document: { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    baseHash: loaded.hash,
  })
}

async function versions(name) {
  return (await rpc('graph/versions', { name })).versions
}

async function hoverTestId(session, testId) {
  const box = await session.evaluate(`(() => {
    const r = document.querySelector('[data-testid="${testId}"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`)
  await mouseMove(session, box)
}

const hubRow = (name) => `[data-testid="wl-hub-wf"][data-value=${JSON.stringify(name)}]`

async function hoverSel(session, selector) {
  const box = await session.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`)
  await mouseMove(session, box)
}

/** 行内改名框：填上新名字、回车，等输入框收起。给了 `shot` 就先截一张刚打开时的样子。 */
async function renameTo(session, name, shot) {
  await waitFor(session, exists('wl-hub-wf-rename-input'))
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-hub-wf-rename-input"]').closest('div').getBoundingClientRect().height < 50`,
    ),
    '改名时这一行不该变高',
  )
  if (shot !== undefined) {
    await sleep(150)
    await screenshot(session, shot)
  }
  await session.evaluate(
    `(() => { const el = document.querySelector('[data-testid="wl-hub-wf-rename-input"]'); el.value = ${JSON.stringify(name)}; el.focus(); })()`,
  )
  await pressKey(session, 'Enter', { code: 'Enter', text: '\r' })
  await waitFor(session, gone('wl-hub-wf-rename-input'))
}

async function run(session) {
  console.log(`# 工作流版本验收：${NAME}`)
  await rpc('graph/create', { name: NAME })
  await rpc('graph/create', { name: OTHER })
  await writeGraph(NAME, [stepNode('a', '第一步', 0)])
  await writeGraph(OTHER, [stepNode('b', '别的', 0)])
  await bootToCanvas(session, NAME)

  // 1) 打开版本对话框：还没有版本，说现在的内容没存过。
  await session.evaluate(clickTestId('wl-versions-open'))
  await waitFor(session, exists('wl-versions-dialog'))
  await waitFor(session, exists('wl-ver-state'))
  check((await session.evaluate(textOf('wl-ver-state'))).includes('还没存成版本'), '应说还没存过')
  await screenshot(session, 'ver-01-empty.png')
  pass('版本对话框：空状态')

  // 2) 写说明、存为版本 → v1，按钮按住，状态说「现在的内容就是 v1」。
  await setReactInput(session, '[data-testid="wl-ver-note"]', '第一版')
  await session.evaluate(clickTestId('wl-ver-save'))
  await waitFor(session, exists('wl-ver-1'))
  const saved = await versions(NAME)
  check(saved.length === 1 && saved[0].note === '第一版' && saved[0].current, '磁盘上应有 v1')
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-ver-save"]').disabled`),
    '内容没变时存的按钮应按住',
  )
  check((await session.evaluate(textOf('wl-ver-state'))).includes('v1'), '状态应说就是 v1')
  pass('存为版本 v1（带说明），内容没变时不能再存')

  // 3) 关掉对话框，图在别处被改了（多一步 c）→ 画布自动同步。
  await pressKey(session, 'Escape')
  await waitFor(session, gone('wl-versions-dialog'))
  await writeGraph(NAME, [stepNode('a', '第一步', 0), stepNode('c', '新加的', 320)])
  await session.evaluate(`window.dispatchEvent(new Event('focus'))`)
  await waitFor(session, `document.querySelector('.react-flow__node[data-id="c"]') !== null`)

  // 4) 再打开：现在的内容没存过；展开 v1，看到「切到这一版会删掉 c」。
  await session.evaluate(clickTestId('wl-versions-open'))
  await waitFor(session, exists('wl-ver-1'))
  await waitFor(session, `${textOf('wl-ver-state')}.includes('还没存成版本')`)
  await session.evaluate(clickTestId('wl-ver-1-toggle'))
  await waitFor(session, exists('wl-ver-1-diff'))
  const diff = await session.evaluate(textOf('wl-ver-1-diff'))
  check(diff.includes('c') && diff.includes('删掉了'), `展开应列出删掉 c：${diff}`)
  await hoverTestId(session, 'wl-ver-1-toggle')
  await sleep(200)
  await screenshot(session, 'ver-02-diff.png')
  pass('展开一版：列出切过去会有哪些变化')

  // 5) 切回 v1：确认卡说会先自动存一份；确认后 v2 = 切换前的内容，画布回到只有 a。
  await session.evaluate(clickTestId('wl-ver-1-restore'))
  await waitFor(session, exists('wl-ver-1-restore-confirm-pop'))
  check(
    (await session.evaluate(textOf('wl-ver-1-restore-confirm-pop'))).includes('自动存一份'),
    '确认卡应说会自动存一份',
  )
  await sleep(250)
  await screenshot(session, 'ver-03-restore-confirm.png')
  await session.evaluate(clickTestId('wl-ver-1-restore-confirm'))
  await waitFor(session, exists('wl-ver-2'))
  await waitFor(session, `document.querySelector('.react-flow__node[data-id="c"]') === null`)
  const afterRestore = await versions(NAME)
  check(
    afterRestore.map((entry) => [entry.n, entry.current, entry.autoBefore ?? null]).join('|') ===
      '2,false,1|1,true,',
    `切换后应有 v2（自动存）且 v1 是当前：${JSON.stringify(afterRestore)}`,
  )
  const disk = (await rpc('graph/load', { name: NAME })).document
  check(disk.nodes.map((node) => node.id).join() === 'a', '磁盘上应回到只有 a')
  check(
    (await session.evaluate(textOf('wl-ver-2'))).includes('切到 v1 前自动存的'),
    'v2 应写明来历',
  )
  pass('切换到 v1：先自动存了 v2，画布与磁盘回到 v1')

  // 6) 给 v2 写说明：原地输入框，回车保存。
  await session.evaluate(clickTestId('wl-ver-2-note'))
  await waitFor(session, exists('wl-ver-note-input'))
  await session.evaluate(
    `(() => { const el = document.querySelector('[data-testid="wl-ver-note-input"]'); el.value = '加了 c 的试验版'; el.focus(); })()`,
  )
  await pressKey(session, 'Enter', { code: 'Enter', text: '\r' })
  await waitFor(session, gone('wl-ver-note-input'))
  check(
    (await versions(NAME)).find((entry) => entry.n === 2)?.note === '加了 c 的试验版',
    '说明应落盘',
  )
  check(await session.evaluate(exists('wl-versions-dialog')), 'Enter 不该把对话框关掉')
  pass('编辑版本说明')

  // 7) 删 v2：确认卡 → 没了。
  await session.evaluate(clickTestId('wl-ver-2-delete'))
  await waitFor(session, exists('wl-ver-2-delete-confirm'))
  await session.evaluate(clickTestId('wl-ver-2-delete-confirm'))
  await waitFor(session, gone('wl-ver-2'))
  check((await versions(NAME)).map((entry) => entry.n).join() === '1', '磁盘上只剩 v1')
  check(await session.evaluate(exists('wl-versions-dialog')), '删完对话框还开着')
  pass('删除版本')
  await pressKey(session, 'Escape')
  await waitFor(session, gone('wl-versions-dialog'))

  // 8) 工作流中心「工作流」页：选另一张（没打开），给它存版本。
  await session.evaluate(clickTestId('wl-hub-open'))
  await waitFor(session, exists('wl-hub-workflows'))
  await session.evaluate(clickTestId('wl-hub-workflows'))
  const otherSel = `[data-testid="wl-hub-wf"][data-value=${JSON.stringify(OTHER)}]`
  await waitFor(session, `document.querySelector(${JSON.stringify(otherSel)}) !== null`)
  check(
    await session.evaluate(
      `document.querySelector('[data-testid="wl-hub-wf"][data-value=${JSON.stringify(NAME)}]').textContent.includes('1 个版本')`,
    ),
    '列表里应写着 1 个版本',
  )
  await session.evaluate(`document.querySelector(${JSON.stringify(otherSel)}).click()`)
  await waitFor(session, exists('wl-hub-wf-open'))
  await waitFor(session, `${textOf('wl-ver-state')}.includes('还没存成版本')`)
  await setReactInput(session, '[data-testid="wl-ver-note"]', '另一张的起点')
  await session.evaluate(clickTestId('wl-ver-save'))
  await waitFor(session, exists('wl-ver-1'))
  check((await versions(OTHER))[0]?.note === '另一张的起点', '另一张应存下 v1')
  check(
    (await session.evaluate(`document.querySelector('[data-testid="wl-switcher"]').textContent`))
      .trim()
      .startsWith(NAME),
    '编辑页还开着原来那张',
  )
  await sleep(250)
  await screenshot(session, 'ver-04-hub.png')
  pass('工作流中心：给没打开的工作流存版本')

  // 9) 在左边那一行上给没打开的那张改名：版本跟着走，右边跟着换成新名字。
  await hoverSel(session, hubRow(OTHER))
  await sleep(200)
  await screenshot(session, 'ver-05-hub-row-hover.png')
  await session.evaluate(clickTestId(`wl-hub-wf-rename-${OTHER}`))
  await renameTo(session, RENAMED, 'ver-05b-hub-rename.png')
  await waitFor(session, `document.querySelector(${JSON.stringify(hubRow(RENAMED))}) !== null`)
  const names = (await rpc('graph/list', {})).workflows.map((entry) => entry.name)
  check(names.includes(RENAMED) && !names.includes(OTHER), '磁盘上应换成新名字')
  check((await versions(RENAMED))[0]?.note === '另一张的起点', '版本应跟着新名字走')
  await waitFor(session, `${textOf('wl-hub')}.includes(${JSON.stringify(RENAMED)})`)
  check(
    (await session.evaluate(
      `document.querySelector(${JSON.stringify(hubRow(RENAMED))}).getAttribute('aria-current')`,
    )) === 'true',
    '改完名还选着它',
  )
  check(await session.evaluate(exists('wl-hub')), 'Enter 不该把工作流中心关掉')
  pass('工作流中心：给没打开的工作流改名，版本跟着走')

  // 10) 给正开着的那张改名：编辑页顶栏跟着换。
  await session.evaluate(clickTestId(`wl-hub-wf-rename-${NAME}`))
  await renameTo(session, NAME2)
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-switcher"]')?.textContent || '').trim() === ${JSON.stringify(NAME2)}`,
  )
  check((await versions(NAME2)).length === 1, '正开着那张的版本也跟着走')
  pass('工作流中心：给正开着的工作流改名，编辑页跟上')

  // 11) 删掉正开着的那张：确认卡说编辑页会空出来、版本一起删；删完列表里没了，编辑页关上。
  await session.evaluate(clickTestId(`wl-hub-wf-delete-${NAME2}`))
  await waitFor(session, exists('wl-hub-wf-delete-confirm-pop'))
  const warn = await session.evaluate(textOf('wl-hub-wf-delete-confirm-pop'))
  check(warn.includes('正开着') && warn.includes('1 个版本'), `确认卡应说清后果：${warn}`)
  await sleep(250)
  await screenshot(session, 'ver-06-hub-delete-confirm.png')
  await session.evaluate(clickTestId('wl-hub-wf-delete-confirm'))
  await waitFor(session, `document.querySelector(${JSON.stringify(hubRow(NAME2))}) === null`)
  check(
    !(await rpc('graph/list', {})).workflows.some((entry) => entry.name === NAME2),
    '磁盘上应删掉了',
  )
  await waitFor(
    session,
    `!(document.querySelector('[data-testid="wl-switcher"]')?.textContent || '').includes(${JSON.stringify(NAME2)})`,
  )
  check(
    await session.evaluate(
      `document.querySelector('[aria-current="true"][data-testid="wl-hub-wf"]') !== null`,
    ),
    '删完应选着别的一张',
  )
  check(await session.evaluate(exists('wl-hub')), '删完工作流中心还开着')
  pass('工作流中心：删掉正开着的工作流，编辑页空出来')

  // 12) 从那里打开改过名的那张：中心关掉，编辑页换成这张。
  await session.evaluate(`document.querySelector(${JSON.stringify(hubRow(RENAMED))}).click()`)
  await waitFor(session, exists('wl-hub-wf-open'))
  await session.evaluate(clickTestId('wl-hub-wf-open'))
  await waitFor(session, gone('wl-hub'))
  await waitFor(
    session,
    `(document.querySelector('[data-testid="wl-switcher"]')?.textContent || '').trim() === ${JSON.stringify(RENAMED)}`,
  )
  pass('从工作流中心打开别的工作流')

  check(session.errors.length === 0, `页面不该有报错：${JSON.stringify(session.errors)}`)
  console.log('\n✅ 工作流版本验收全部通过')
}

const session = await openPage()
try {
  await run(session)
} catch (error) {
  await screenshot(session, 'ver-failure.png').catch(() => {})
  console.error(`\n❌ 第 ${step + 1} 步失败：${error.message}`)
  process.exitCode = 1
} finally {
  for (const name of [NAME, OTHER, RENAMED, NAME2])
    await rpc('graph/delete', { name }).catch(() => {})
  session.close()
}
