/**
 * 工作流中心「设置」页的真浏览器验收：改一项 → 保存条 → 保存落进 profile → 恢复默认 → 再保存。结论以 `config/get` 为准。
 *
 * 只动「单张工作流最多步骤」，收尾时把它恢复成默认（数据目录等别的项一概不碰——测试实例的 profile 自己改过数据目录）。
 *
 * usage: DSH_WEB_TOKEN=<token> DSH_BASE=http://127.0.0.1:3190 node --experimental-strip-types tests/cdp-config.mjs
 */

import { bootToCanvas, screenshot, setReactInput } from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'

const NAME = `cfg-${Date.now().toString(36)}`
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
const inputValue = (testId) => `document.querySelector('[data-testid="${testId}"]').value`

async function run(session) {
  console.log(`# 插件设置验收：${NAME}`)
  const before = await rpc('config/get', {})
  check(before.available && before.writable, `测试实例应能改设置：${JSON.stringify(before)}`)
  const fallback = before.defaults.maxNodes
  await rpc('graph/create', { name: NAME })
  await bootToCanvas(session, NAME)

  // 1) 打开工作流中心 →「设置」：现值都在，没有保存条。
  await session.evaluate(clickTestId('wl-hub-open'))
  await waitFor(session, exists('wl-hub-settings'))
  await session.evaluate(clickTestId('wl-hub-settings'))
  await waitFor(session, exists('wl-cfg-maxNodes'))
  check(
    (await session.evaluate(inputValue('wl-cfg-maxNodes'))) === String(before.values.maxNodes),
    '步骤上限应显示现值',
  )
  check(
    (await session.evaluate(inputValue('wl-cfg-dataDir'))) === before.values.dataDir,
    '数据目录应显示现值',
  )
  check(await session.evaluate(gone('wl-cfg-bar')), '没改时不该有保存条')
  await sleep(250)
  await screenshot(session, 'cfg-01-page.png')
  pass('设置页：显示现值')

  // 2) 填个坏值：报错、保存按钮按住；改成好值：保存条说 1 处改动。
  await setReactInput(session, '[data-testid="wl-cfg-maxNodes"]', '0')
  await waitFor(session, exists('wl-cfg-bar'))
  check(
    await session.evaluate(`document.querySelector('[data-testid="wl-cfg-save"]').disabled`),
    '坏值不能保存',
  )
  await setReactInput(session, '[data-testid="wl-cfg-maxNodes"]', String(fallback + 50))
  await waitFor(session, `!document.querySelector('[data-testid="wl-cfg-save"]').disabled`)
  check(
    (
      await session.evaluate(`document.querySelector('[data-testid="wl-cfg-bar"]').textContent`)
    ).includes('1 处'),
    '保存条应说 1 处改动',
  )
  await sleep(250)
  await screenshot(session, 'cfg-02-dirty.png')
  pass('改一项：坏值挡住，好值出保存条')

  // 3) 保存：落进 profile，活配置跟着变（graph/list 回的上限也变了），保存条收起。
  await session.evaluate(clickTestId('wl-cfg-save'))
  await waitFor(session, gone('wl-cfg-bar'))
  const saved = await rpc('config/get', {})
  check(
    saved.values.maxNodes === fallback + 50 && saved.overridden.includes('maxNodes'),
    `应已保存：${JSON.stringify(saved)}`,
  )
  check((await rpc('graph/list', {})).limits.maxNodes === fallback + 50, '活配置应即时生效')
  check(saved.values.dataDir === before.values.dataDir, '别的项不该被动')
  pass('保存：写进 profile，马上生效')

  // 4) 恢复默认：小按钮把草稿换回默认值，再保存 → profile 里这一项删掉。
  await session.evaluate(clickTestId('wl-cfg-maxNodes-reset'))
  await waitFor(session, `${inputValue('wl-cfg-maxNodes')} === ${JSON.stringify(String(fallback))}`)
  await waitFor(session, exists('wl-cfg-bar'))
  await session.evaluate(clickTestId('wl-cfg-save'))
  await waitFor(session, gone('wl-cfg-bar'))
  const reset = await rpc('config/get', {})
  check(
    reset.values.maxNodes === fallback && !reset.overridden.includes('maxNodes'),
    `应已恢复默认：${JSON.stringify(reset)}`,
  )
  check(await session.evaluate(gone('wl-cfg-maxNodes-reset')), '回到默认后不该再有恢复按钮')
  pass('恢复默认：profile 里那一项删掉')

  // 5) 放弃：改了不保存，点放弃回到已保存的值。
  await setReactInput(session, '[data-testid="wl-cfg-saveDebounceMs"]', '900')
  await waitFor(session, exists('wl-cfg-bar'))
  await session.evaluate(clickTestId('wl-cfg-discard'))
  await waitFor(session, gone('wl-cfg-bar'))
  check(
    (await session.evaluate(inputValue('wl-cfg-saveDebounceMs'))) ===
      String(reset.values.saveDebounceMs),
    '放弃后回到已保存的值',
  )
  check(
    (await rpc('config/get', {})).values.saveDebounceMs === reset.values.saveDebounceMs,
    '放弃不该写盘',
  )
  pass('放弃：草稿回到已保存的值')

  // 6) 外观：亮色、暗色各四套，点一下马上换（不进保存条），记在浏览器里，重新打开还在。
  const option = (id) => `[data-testid="wl-theme-option"][data-theme="${id}"]`
  const rootVar = (name) =>
    `getComputedStyle(document.querySelector('[data-testid="wl-root"]')).getPropertyValue('${name}').trim()`
  check(
    (await session.evaluate(
      `document.querySelectorAll('[data-testid="wl-theme-option"]').length`,
    )) === 8,
    '外观里应有八套主题',
  )
  check(
    await session.evaluate(
      `document.querySelector('${option('paper')}').getAttribute('aria-checked') === 'true' && document.querySelector('${option('slate')}').getAttribute('aria-checked') === 'true'`,
    ),
    '默认应是米色 + 石板',
  )
  await session.evaluate(`document.querySelector('${option('mist')}').click()`)
  await session.evaluate(`document.querySelector('${option('umber')}').click()`)
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-root"]').dataset.lightTheme === 'mist' && document.querySelector('[data-testid="wl-root"]').dataset.darkTheme === 'umber'`,
  )
  check((await session.evaluate(rootVar('--wl-l-canvas'))) === '#eff2f6', '亮色变量应换成雾蓝')
  check((await session.evaluate(rootVar('--wl-d-canvas'))) === '#171310', '暗色变量应换成暖夜')
  check(await session.evaluate(gone('wl-cfg-bar')), '换主题不该出保存条')
  check(
    (await session.evaluate(`localStorage.getItem('workflow-lite.theme')`)) ===
      JSON.stringify({ light: 'mist', dark: 'umber' }),
    '选择应记在浏览器里',
  )
  await bootToCanvas(session, NAME)
  check(
    (await session.evaluate(
      `document.querySelector('[data-testid="wl-root"]').dataset.lightTheme`,
    )) === 'mist',
    '重新打开后还是雾蓝',
  )
  await session.evaluate(clickTestId('wl-hub-open'))
  await waitFor(session, exists('wl-hub-settings'))
  await session.evaluate(clickTestId('wl-hub-settings'))
  await waitFor(session, exists('wl-theme'))
  await session.evaluate(`document.querySelector('${option('paper')}').click()`)
  await session.evaluate(`document.querySelector('${option('slate')}').click()`)
  await waitFor(session, `localStorage.getItem('workflow-lite.theme') === null`)
  pass('外观：换主题马上生效、记在浏览器里，换回默认不留记录')

  check(session.errors.length === 0, `页面不该有报错：${JSON.stringify(session.errors)}`)
  console.log('\n✅ 插件设置验收全部通过')
}

const session = await openPage()
try {
  await run(session)
} catch (error) {
  await screenshot(session, 'cfg-failure.png').catch(() => {})
  console.error(`\n❌ 第 ${step + 1} 步失败：${error.message}`)
  process.exitCode = 1
} finally {
  // 万一中途失败：把步骤上限恢复成默认（别的项不碰）。
  const now = await rpc('config/get', {}).catch(() => null)
  if (now?.overridden.includes('maxNodes')) {
    await rpc('config/set', { revision: now.revision, reset: ['maxNodes'] }).catch(() => {})
  }
  await rpc('graph/delete', { name: NAME }).catch(() => {})
  session.close()
}
