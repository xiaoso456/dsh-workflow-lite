/**
 * 性能场景（真浏览器）：大图在画布、实例视图里常见操作的主线程开销。自备一次性实例（shots 环境，不碰正在用的 dsh），
 * 要一个带 DevTools 端口的 Chrome（`node tests/lib/cdp-chrome-launch.mjs 9222`），改了前端先 `pnpm run build`。
 *
 * | 场景 | 做什么 |
 * |---|---|
 * | 切到大图 | 从一张小图切到大图，直到画面停稳 |
 * | 静置 | 什么都不做 2 秒（基线） |
 * | 拖步骤 | 拖连线最多的步骤往返一趟（120 步） |
 * | 平移 | 在空白处拖着平移 |
 * | 模板里改提示词 | 选中那个步骤、打开提示词编辑、连打 30 个字 |
 * | 实例里改提示词 | 同一张图建实例、在实例视图里打开那一步的提示词编辑、连打 30 个字 |
 * | 实例静置 | 实例视图开着什么都不做 16 秒（后台每 5 秒问一次状态） |
 * | 打开切换列表 | 数据目录里有 N 张图时点开顶栏的工作流列表，直到列表出来 |
 *
 * 每项记：帧数、帧间隔 p50 / p90 / 最大、超过 33ms 的帧、长任务、主线程（脚本 / 样式 / 布局）；打字另记
 * 每次按键从按下到下一帧画出来的时长（Event Timing）。
 *
 * usage: node --experimental-strip-types tests/perf/canvas-scenarios.mjs
 *          [--copies 16] [--workflows 200] [--throttle 1] [--only 打字] [--out result.json] [--mut] [--profile]
 *
 * 诊断：`--mut` 另记视图里 DOM 的插拔与属性变化（宿主页面有条 `:has` 规则，任何插拔都会让整页重算样式）；
 * `--profile` 另记 CPU 采样，按源码位置列自耗时最多的函数。
 * A/B：`--css "<规则>"` 往页面里加一条样式再量（试某个样式改动值不值得做）；`--no-host-has` 删掉宿主页面样式里
 * 所有带 `:has(` 的规则再量（看多少开销是宿主那条规则带来的，本插件改不了它）。
 */
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  blankExpr,
  click,
  drag,
  focusNode as focusAt,
  laidBigGraph,
  centerOfNode as nodeAt,
  paneCenterExpr,
  saveGraph,
  sleep,
  wheel,
} from '../lib/big-canvas.mjs'
import { bootToCanvas, revealHubRow, selectGraph } from '../lib/canvas-harness.mjs'
import { openPage, waitFor } from '../lib/cdp-session.mjs'
import { rpc } from '../lib/web-session.mjs'
import { installShotsCookie, SHOTS_SESSION_TITLE, startShotsEnv } from '../support/shots-env.mjs'
import { bigGraph, busiestStep } from './bigGraph.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SCRATCH = join(HERE, '..', 'runs', 'perf-scenarios')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? fallback : process.argv[i + 1]
}
const COPIES = Number(arg('copies', '16'))
const WORKFLOWS = Number(arg('workflows', '200'))
const THROTTLE = Number(arg('throttle', '1'))
const ONLY = arg('only', '')
const OUT = arg('out', '')
const MUT = process.argv.includes('--mut')
const CSS = arg('css', '')
const NO_HOST_HAS = process.argv.includes('--no-host-has')
const PROFILE = process.argv.includes('--profile')
const BIG = 'perf-big'
const SMALL = 'perf-small'
/** 画布上是大图了：有卡、而且没有小图的卡（不要求 400 张都挂上——视口裁剪时只挂看得见的）。 */
const BIG_SHOWN = `(() => {
  const ids = [...document.querySelectorAll('.react-flow__node')].map((node) => node.dataset.id ?? '');
  return ids.length > 0 && ids.every((id) => !id.endsWith('_s'));
})()`

/** 页面里装的计量：rAF 帧间隔、长任务、按键的 Event Timing。 */
const INSTALL = `(() => {
  const p = window.__perf = { on: false };
  p.start = () => {
    p.frames = []; p.long = []; p.keys = [];
    let last = performance.now();
    p.on = true;
    const loop = (t) => { p.frames.push(t - last); last = t; if (p.on) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    p.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) p.long.push(e.duration); });
    p.po.observe({ type: 'longtask' });
    p.ev = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown') p.keys.push(e.duration); });
    p.ev.observe({ type: 'event', durationThreshold: 16 });
    p.mut = { added: 0, removed: 0, attrs: 0, text: 0, byAttr: {}, what: {} };
    const root = document.querySelector('[data-workflow-lite-view]') ?? document.body;
    p.mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'childList') {
          p.mut.added += m.addedNodes.length; p.mut.removed += m.removedNodes.length;
          // 插拔的是什么：元素记「标签.类名（去哈希）」、文字节点记父元素，挑最多的几种列出来。
          for (const n of [...m.addedNodes, ...m.removedNodes]) {
            const el = n.nodeType === 1 ? n : m.target;
            const cls = String(el.className?.baseVal ?? el.className ?? '').split(' ')[0].replace(/^[w-]{6}_/, '');
            const key = (n.nodeType === 1 ? '' : '#text in ') + el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (el.dataset?.testid ? '[' + el.dataset.testid + ']' : '');
            p.mut.what[key] = (p.mut.what[key] ?? 0) + 1;
          }
        }
        else if (m.type === 'attributes') {
          p.mut.attrs += 1;
          // 属性变化按「属性 @ 元素（类名去哈希）」记，看是谁在每帧改。
          const cls = String(m.target.className?.baseVal ?? m.target.className ?? '').split(' ').filter((c) => !c.startsWith('react-flow__node-')).slice(0, 2).map((c) => c.replace(/^[A-Za-z0-9_-]{6}_/, '')).join('.');
          const key = m.attributeName + ' @ ' + m.target.tagName.toLowerCase() + (cls ? '.' + cls : '');
          p.mut.byAttr[key] = (p.mut.byAttr[key] ?? 0) + 1;
        }
        else p.mut.text += 1;
      }
    });
    p.mo.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  p.stop = () => {
    p.on = false; p.po.disconnect(); p.ev.disconnect(); p.mo.disconnect();
    const q = (list, x) => list.length ? +list[Math.min(list.length - 1, Math.floor(list.length * x))].toFixed(1) : 0;
    const f = p.frames.slice(1).sort((a, b) => a - b);
    const k = p.keys.slice().sort((a, b) => a - b);
    return { frames: f.length, p50: q(f, 0.5), p90: q(f, 0.9), max: q(f, 1), over33: f.filter((x) => x > 33.4).length,
      longTasks: p.long.length, longSum: Math.round(p.long.reduce((a, b) => a + b, 0)),
      keysOver16: k.length, keyP50: q(k, 0.5), keyMax: q(k, 1),
      mut: { ...p.mut, byAttr: Object.fromEntries(Object.entries(p.mut.byAttr).sort((a, b) => b[1] - a[1]).slice(0, 6)), what: Object.fromEntries(Object.entries(p.mut.what).sort((a, b) => b[1] - a[1]).slice(0, 8)) } };
  };
  /** 画面停稳：连续 10 帧间隔都在 25ms 内。回停稳那一刻（减去这 10 帧）。 */
  p.settled = () => new Promise((resolve) => {
    let calm = 0; let last = performance.now(); let since = last;
    const loop = (t) => {
      if (t - last < 25) { calm += 1; } else { calm = 0; since = t; }
      last = t;
      if (calm >= 10) resolve(since); else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  return true;
})()`

const METRIC_KEYS = ['ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'TaskDuration']
async function metrics(session) {
  const { metrics: list } = await session.send('Performance.getMetrics')
  return Object.fromEntries(
    list.filter((m) => METRIC_KEYS.includes(m.name)).map((m) => [m.name, m.value]),
  )
}

const results = {}
/** 平移这类场景另记插拔了多少个元素（宿主的 `:has` 规则下每次插拔都是整页样式重算；平移中最好一个都没有）。 */
const churn = (f) => ({ 插拔: f.mut.added + f.mut.removed })
async function measure(session, label, act, extra = () => ({})) {
  if (ONLY !== '' && !label.includes(ONLY)) return
  await sleep(600)
  await session.evaluate('window.__perf.start()')
  const before = await metrics(session)
  if (PROFILE) await session.send('Profiler.start')
  const own = await act()
  await sleep(500)
  const profile = PROFILE ? (await session.send('Profiler.stop')).profile : null
  const after = await metrics(session)
  const f = await session.evaluate('window.__perf.stop()')
  const main = Object.fromEntries(
    METRIC_KEYS.map((k) => [
      k.replace('Duration', '').replace('RecalcStyle', 'Style'),
      Math.round((after[k] - before[k]) * 1000),
    ]),
  )
  const result = { ...f, main, ...(own ?? {}), ...extra(f) }
  results[label] = result
  const keys =
    f.keysOver16 > 0 || label.includes('改提示词')
      ? `  按键>16ms ${f.keysOver16} 次 p50 ${f.keyP50} 最大 ${f.keyMax}`
      : ''
  console.log(`\n■ ${label}`)
  const noted = { ...(own ?? {}), ...extra(f) }
  if (Object.keys(noted).length > 0) console.log(`  ${JSON.stringify(noted)}`)
  console.log(
    `  帧 ${f.frames}  p50 ${f.p50}  p90 ${f.p90}  最大 ${f.max}  >33ms ${f.over33}  长任务 ${f.longTasks}（${f.longSum}ms）${keys}`,
  )
  console.log(
    `  主线程 ms：脚本 ${main.Script}  样式 ${main.Style}  布局 ${main.Layout}  合计 ${main.Task}`,
  )
  if (MUT)
    console.log(
      `  DOM：插入 ${f.mut.added}  移除 ${f.mut.removed}  属性 ${f.mut.attrs} ${JSON.stringify(f.mut.byAttr)}  文字 ${f.mut.text}`,
    )
  if (MUT && f.mut.added + f.mut.removed > 0) console.log(`  插拔的：${JSON.stringify(f.mut.what)}`)
  if (profile !== null) {
    console.log('  CPU 自耗时最多：')
    for (const line of await topSelf(profile)) console.log(`    ${line}`)
  }
}

/** 按 `//#region <源码路径>` 把打包后的行号对回源码文件（插件的 client.js 保留了这些标记）。 */
const regionCache = new Map()
async function regionOf(url, line) {
  if (!regionCache.has(url)) {
    const text = await fetch(url, { headers: { cookie: process.env.DSH_AUTH_COOKIE ?? '' } })
      .then((r) => r.text())
      .catch(() => '')
    const list = []
    text.split('\n').forEach((l, i) => {
      const m = /\/\/#region (.*)$/.exec(l)
      if (m) list.push([i, m[1].replace(/.*node_modules\//, '').replace(/^src\/client\//, '')])
    })
    regionCache.set(url, list)
  }
  let hit = '?'
  for (const [start, name] of regionCache.get(url)) {
    if (start > line) break
    hit = name
  }
  return hit
}

async function topSelf(profile, n = 15) {
  const self = new Map()
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const keys = new Map()
  for (const node of profile.nodes) {
    const cf = node.callFrame
    const where = cf.url.includes('/plugins/')
      ? await regionOf(cf.url, cf.lineNumber)
      : (cf.url.split('/').pop() || '(native)').slice(0, 30)
    keys.set(node.id, `${cf.functionName || '(anon)'} [${where}]`)
  }
  profile.samples.forEach((id, i) => {
    const node = byId.get(id)
    if (['(idle)', '(program)'].includes(node.callFrame.functionName)) return
    const k = keys.get(id)
    self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000)
  })
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${v.toFixed(0).padStart(6)}ms  ${k}`)
}

/** 大图排好之后各卡的位置（看不见的卡不在 DOM 里，按它算屏幕位置）。 */
const POSITIONS = new Map()
const centerOfNode = (id, dy = 0.5) => nodeAt(id, POSITIONS.get(id), dy)
const focusNode = (session, id, zoomSteps = 5) => focusAt(session, id, POSITIONS.get(id), zoomSteps)

/** 连打 n 个字，每个字间隔 `gap` 毫秒（打字速度约每秒 12 个字）。 */
async function type(session, n, gap = 80) {
  const text = '性能场景的打字测试用一段中文'
  for (let i = 0; i < n; i += 1) {
    const ch = text[i % text.length]
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: ch,
      unmodifiedText: ch,
      key: ch,
    })
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(gap)
  }
}

await rm(SCRATCH, { recursive: true, force: true })
const env = await startShotsEnv({
  dataDir: join(SCRATCH, 'data'),
  workspaceDir: join(SCRATCH, 'ws'),
  home: join(SCRATCH, 'home'),
})
let session
try {
  session = await openPage()
  await session.send('Network.clearBrowserCookies').catch(() => {})
  await installShotsCookie(session, env.base, env.cookie)
  // 在 Node 里先排好版再存（画布上点「整理」时就基本不动了），各卡的位置脚本里也知道。
  const doc = await laidBigGraph(COPIES)
  for (const node of doc.nodes) POSITIONS.set(node.id, node.position)
  const busy = busiestStep(doc)
  await saveGraph(BIG, doc)
  // 小图的 id 带个后缀，和大图区分开：切过去之后看画布上还有没有小图的卡（大图开了视口裁剪时不会全挂上）。
  const tagged = bigGraph(1)
  const tag = (id) => `${id}_s`
  await saveGraph(SMALL, {
    ...tagged,
    nodes: tagged.nodes.map((node) => ({ ...node, id: tag(node.id) })),
    edges: tagged.edges.map((edge) => ({
      ...edge,
      id: tag(edge.id),
      source: tag(edge.source),
      target: tag(edge.target),
    })),
  })
  // 切换列表要列的那些图（每张一份 25 张卡的流程）。
  const small = bigGraph(1)
  for (let i = 0; i < WORKFLOWS; i += 1)
    await saveGraph(`perf-wf-${String(i).padStart(3, '0')}`, small)
  console.log(`大图：${doc.nodes.length} 张卡、${doc.edges.length} 条线；CPU 降速 ${THROTTLE}x`)

  await bootToCanvas(session, BIG, { width: 1600, height: 960, sessionTitle: SHOTS_SESSION_TITLE })
  // 先排一次版存下（之后切图、建实例用的都是排好的）。
  await session.evaluate(`document.querySelector('[data-testid="wl-tidy"]')?.click()`)
  await sleep(3000)
  await session.send('Performance.enable')
  if (PROFILE) {
    await session.send('Profiler.enable')
    await session.send('Profiler.setSamplingInterval', { interval: 200 })
  }
  await session.evaluate(INSTALL)
  if (NO_HOST_HAS) {
    const removed = await session.evaluate(`(() => {
      const plugin = (sheet) => sheet.ownerNode?.dataset?.plugin === '@xiaoso/dsh-workflow-lite';
      let n = 0;
      const walk = (owner) => { for (let i = owner.cssRules.length - 1; i >= 0; i -= 1) { const r = owner.cssRules[i]; if (r.cssRules && !r.selectorText) walk(r); else if (r.cssText.includes(':has(')) { owner.deleteRule(i); n += 1; } } };
      for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) { try { if (!plugin(sheet)) walk(sheet); } catch {} }
      return n;
    })()`)
    console.log(`删掉了宿主样式里 ${removed} 条带 :has 的规则`)
  }
  if (CSS !== '') {
    await session.evaluate(
      `document.head.appendChild(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(CSS)} }))`,
    )
    console.log(`加了样式：${CSS}`)
  }
  if (THROTTLE > 1) await session.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })

  await measure(session, '切到大图', async () => {
    await selectGraph(session, SMALL)
    await sleep(1500)
    const t0 = await session.evaluate('performance.now()')
    await selectGraph(session, BIG)
    await waitFor(session, BIG_SHOWN, { timeoutMs: 30_000 })
    const done = await session.evaluate('window.__perf.settled()')
    return { 停稳ms: Math.round(done - t0) }
  })
  await session.evaluate(`document.querySelector('[data-testid="wl-fit"]')?.click()`)
  await sleep(1200)
  await measure(session, '静置 2 秒', () => sleep(2000))
  await measure(session, `打开切换列表（${WORKFLOWS + 2} 张图）`, async () => {
    const t0 = await session.evaluate('performance.now()')
    await session.evaluate(`document.querySelector('[data-testid="wl-switcher"]').click()`)
    await waitFor(session, `document.querySelector('[data-testid="wl-wf-item"]') !== null`, {
      timeoutMs: 30_000,
    })
    const done = await session.evaluate('window.__perf.settled()')
    const rows = await session.evaluate(
      `document.querySelectorAll('[data-testid="wl-wf-item"]').length`,
    )
    await session.evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    )
    return { 停稳ms: Math.round(done - t0), 行数: rows }
  })
  await sleep(800)
  await focusNode(session, busy, 0)
  await measure(session, `拖步骤（${busy}）`, async () => {
    const from = await session.evaluate(centerOfNode(busy, 0.2))
    await drag(session, from, 160, 90, 60, false)
    const mid = await session.evaluate(centerOfNode(busy, 0.2))
    await drag(session, mid, from.x - mid.x, from.y - mid.y, 60, false)
    // 卡片真被拖动了（没点空、没变成平移）：拖过去那一下屏幕上挪了多少像素。
    return { 卡片挪了px: Math.round(Math.hypot(mid.x - from.x, mid.y - from.y)) }
  })
  const blank = await session.evaluate(blankExpr)
  await measure(session, '平移画布', async () => drag(session, blank, 220, 120), churn)
  // 缩到最小再来回平移：一屏里卡片最多的时候。
  await wheel(session, await session.evaluate(paneCenterExpr), -8)
  await sleep(800)
  const far = await session.evaluate(blankExpr)
  await measure(session, '缩小后平移', async () => drag(session, far, 360, 200), churn)
  await session.evaluate(`document.querySelector('[data-testid="wl-fit"]')?.click()`)
  await sleep(1200)

  // 模板里改提示词：放大到那一步、点中它、打开提示词编辑、连打 30 个字。
  await focusNode(session, busy)
  await click(session, await session.evaluate(centerOfNode(busy, 0.2)))
  await waitFor(
    session,
    `document.querySelector('[data-testid="wl-ins-prompt-card-edit"]') !== null`,
  )
  await session.evaluate(
    `document.querySelector('[data-testid="wl-ins-prompt-card-edit"]').click()`,
  )
  await waitFor(session, `document.activeElement?.getAttribute('data-testid') === 'wl-ins-prompt'`)
  await session.evaluate(
    `(() => { const el = document.activeElement; el.setSelectionRange(el.value.length, el.value.length) })()`,
  )
  await measure(session, '模板里改提示词（30 字）', () => type(session, 30))
  await session.evaluate(
    `document.querySelector('[data-testid="wl-ins-prompt-card-viewer"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  )
  await sleep(1500)

  // 实例：建一个、从工作流中心打开、静置、在里面改提示词。
  const answers = Object.fromEntries(
    doc.nodes.filter((node) => node.type === 'wfInput').map((node) => [node.id, '性能测试']),
  )
  const started = await rpc('run/start', {
    workflow: BIG,
    session: env.sessionId,
    cwd: env.workspaceDir,
    answers,
  })
  const instance = started.instance.id
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-open"]').click()`)
  await revealHubRow(session, instance, env.workspaceDir)
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-view"]').click()`,
  )
  await waitFor(session, BIG_SHOWN, { timeoutMs: 30_000 })
  await sleep(2000)
  await measure(session, '实例静置 16 秒（后台问 3 次）', () => sleep(16_000))
  await focusNode(session, busy)
  await click(session, await session.evaluate(centerOfNode(busy, 0.2)))
  await waitFor(session, `document.querySelector('[data-testid="wl-run-prompt-edit"]') !== null`)
  await session.evaluate(`document.querySelector('[data-testid="wl-run-prompt-edit"]').click()`)
  await waitFor(
    session,
    `document.activeElement?.getAttribute('data-testid') === 'wl-run-prompt-input'`,
  )
  await session.evaluate(
    `(() => { const el = document.activeElement; el.setSelectionRange(el.value.length, el.value.length) })()`,
  )
  await measure(session, '实例里改提示词（30 字）', () => type(session, 30))

  if (OUT !== '')
    await writeFile(
      OUT,
      `${JSON.stringify({ copies: COPIES, throttle: THROTTLE, results }, null, 2)}\n`,
    )
} finally {
  session?.close()
  await env.stop()
  await rm(join(SCRATCH, 'home'), { recursive: true, force: true }).catch(() => {})
}
