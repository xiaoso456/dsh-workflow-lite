/**
 * 大图（400 张卡）的真浏览器验收：画布只挂视口附近的卡片和线（见 `src/client/model/cull.ts`）之后，
 * 看全图、定位、拖卡片、平移、横穿视口的线、展示卡挪出去再挪回来都和以前一样。结论以磁盘 / DOM 为准。
 *
 * 自备一次性实例（shots 环境，不碰正在用的 dsh），要一个带 DevTools 端口的 Chrome
 * （`node tests/lib/cdp-chrome-launch.mjs 9222`）；改了前端先 `pnpm run build`。
 *
 * usage: node --experimental-strip-types tests/cdp-big.mjs
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cardSize } from '../src/client/model/layout.ts'
import { MIN_ZOOM } from '../src/client/ui/canvas/hooks/useWheelZoom.ts'
import {
  blankExpr,
  centerOfNode,
  drag,
  focusNode,
  laidBigGraph,
  paneCenterExpr,
  saveGraph,
  settleViewport,
  sleep,
  viewportExpr,
  wheel,
} from './lib/big-canvas.mjs'
import { bootToCanvas, revealHubRow, selectGraph } from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { rpc } from './lib/web-session.mjs'
import { installShotsCookie, SHOTS_SESSION_TITLE, startShotsEnv } from './support/shots-env.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SCRATCH = join(HERE, 'runs', 'cdp-big')
const COPIES = 16
const BIG = 'big-check'
const BIG_RUN = 'big-check-run'
const SMALL = 'big-check-small'
/** 提示词留空的那一步（在图的最后一份里，打开时在视口外）：检查结果里点它定位。 */
const EMPTY = `s3_${COPIES - 1}`
/** 实例里摆成展示卡的那份文件（在图中间那一份里）。 */
const SHOWN = `r0_${COPIES / 2}`
const SHOWN_FILE = `docs/${COPIES / 2}-0.md`

let step = 0
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}
function pass(message) {
  step += 1
  console.log(`  ${String(step).padStart(2)} ${message}`)
}

const mountedIdsExpr = `[...document.querySelectorAll('.react-flow__node')].map((el) => el.dataset.id)`
const mountedEdgesExpr = `[...document.querySelectorAll('.react-flow__edge')].map((el) => el.dataset.id)`
const mounted = (id) => `document.querySelector('.react-flow__node[data-id="${id}"]') !== null`

/** 挂着的每条线两头的卡片都挂着。 */
async function endpointsMounted(session, doc) {
  const nodes = new Set(await session.evaluate(mountedIdsExpr))
  const byId = new Map(doc.edges.map((edge) => [edge.id, edge]))
  for (const id of await session.evaluate(mountedEdgesExpr)) {
    const edge = byId.get(id)
    check(edge !== undefined, `画布上的线 ${id} 不在图里`)
    check(nodes.has(edge.source) && nodes.has(edge.target), `线 ${id} 的两头没都挂着`)
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

  const doc = await laidBigGraph(COPIES)
  const position = new Map(doc.nodes.map((node) => [node.id, node.position]))
  const at = (id, dy) => centerOfNode(id, position.get(id), dy)
  // 模板：最后一份里一步的提示词留空（检查结果里有它）。
  await saveGraph(BIG, {
    ...doc,
    nodes: doc.nodes.map((node) =>
      node.id === EMPTY ? { ...node, data: { ...node.data, prompt: '' } } : node,
    ),
  })
  // 实例用的：中间那一份的一张资源卡摆成展示卡。
  await saveGraph(BIG_RUN, {
    ...doc,
    nodes: doc.nodes.map((node) =>
      node.id === SHOWN
        ? { ...node, data: { ...node.data, view: { width: 300, height: 200 } } }
        : node,
    ),
  })
  const small = (await laidBigGraph(1)).nodes.length
  await saveGraph(SMALL, await laidBigGraph(1))

  console.log(`大图：${doc.nodes.length} 张卡、${doc.edges.length} 条线`)
  await bootToCanvas(session, SMALL, {
    width: 1600,
    height: 960,
    sessionTitle: SHOTS_SESSION_TITLE,
  })
  await waitFor(session, `document.querySelectorAll('.react-flow__node').length === ${small}`)
  pass(`小图（${small} 张卡）照旧全挂`)

  await selectGraph(session, BIG)
  await waitFor(session, `document.querySelectorAll('.react-flow__node').length > 0`, {
    timeoutMs: 30_000,
  })
  await sleep(1500)
  const first = await session.evaluate(mountedIdsExpr)
  check(first.length < doc.nodes.length, `大图应只挂一部分，实挂 ${first.length}`)
  await endpointsMounted(session, doc)
  pass(`大图只挂视口附近的 ${first.length} / ${doc.nodes.length} 张卡，挂着的线两头都在`)

  // ── 看全图：按全图算（不是只按挂着的那些） ──
  await session.evaluate(`document.querySelector('[data-testid="wl-fit"]').click()`)
  await sleep(1200)
  const fitted = await session.evaluate(viewportExpr)
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const node of doc.nodes) {
    const size = cardSize(node)
    left = Math.min(left, node.position.x)
    right = Math.max(right, node.position.x + size.w)
    top = Math.min(top, node.position.y)
    bottom = Math.max(bottom, node.position.y + size.h)
  }
  const pane = await session.evaluate(
    `(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { w: r.width, h: r.height }; })()`,
  )
  // 全图的中心落在画布里（左右浮层让出的空不一样，不要求正中），缩放是装得下的大小或最小缩放。
  const cx = fitted.x + ((left + right) / 2) * fitted.zoom
  const cy = fitted.y + ((top + bottom) / 2) * fitted.zoom
  check(
    cx > pane.w * 0.25 && cx < pane.w * 0.75,
    `看全图后横向没居中：${Math.round(cx)} / ${pane.w}`,
  )
  check(
    cy > pane.h * 0.25 && cy < pane.h * 0.75,
    `看全图后纵向没居中：${Math.round(cy)} / ${pane.h}`,
  )
  const fits = Math.min(pane.w / (right - left), pane.h / (bottom - top))
  check(
    fitted.zoom <= Math.max(fits, MIN_ZOOM) + 0.01 &&
      fitted.zoom >= Math.min(fits * 0.7, MIN_ZOOM) - 0.01,
    `看全图的缩放不对：${fitted.zoom.toFixed(3)}（装下要 ${fits.toFixed(3)}）`,
  )
  await endpointsMounted(session, doc)
  pass(`看全图按整张图算：缩放 ${fitted.zoom.toFixed(2)}，全图中心在画布中间`)

  // ── 平移一小段：区域还够用，一个元素都不插拔 ──
  await session.evaluate(`(() => {
    const view = document.querySelector('.react-flow__viewport');
    window.__churn = 0;
    window.__churnObs = new MutationObserver((list) => {
      for (const m of list) for (const n of [...m.addedNodes, ...m.removedNodes]) if (n.nodeType === 1 && n.matches?.('.react-flow__node, .react-flow__edge')) window.__churn += 1;
    });
    window.__churnObs.observe(view, { childList: true, subtree: true });
  })()`)
  const blank = await session.evaluate(blankExpr)
  await drag(session, blank, 120, 60, 40, true)
  await sleep(600)
  const churn = await session.evaluate(
    `(() => { window.__churnObs.disconnect(); return window.__churn; })()`,
  )
  check(churn === 0, `小幅平移时插拔了 ${churn} 张卡 / 条线`)
  pass('小幅平移：卡片和线一个都没插拔')

  // ── 平移很远：新的一块挂上、离开的摘掉 ──
  const before = new Set(await session.evaluate(mountedIdsExpr))
  for (let i = 0; i < 3; i += 1) {
    await drag(session, await session.evaluate(blankExpr), -700, 0, 30, false)
    await sleep(300)
  }
  await sleep(1200)
  const after = await session.evaluate(mountedIdsExpr)
  check(
    after.some((id) => !before.has(id)),
    '平移很远后没挂上新的卡片',
  )
  await endpointsMounted(session, doc)
  pass(`平移很远：换挂了一块（现挂 ${after.length} 张），线的两头都在`)

  // ── 检查结果里定位视口外的一步 ──
  await session.evaluate(`document.querySelector('[data-testid="wl-fit"]').click()`)
  await sleep(1000)
  await session.evaluate(`document.querySelector('[data-testid="wl-issues"]').click()`)
  await waitFor(session, `document.querySelector('[data-testid="wl-issue-list"]') !== null`)
  const located = await session.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-testid="wl-issue-list"] button')].find((b) => b.textContent.includes('${EMPTY}'));
    row?.click();
    return row !== undefined;
  })()`)
  check(located, `检查结果里没有 ${EMPTY}`)
  await waitFor(session, mounted(EMPTY), { timeoutMs: 5000 })
  await sleep(300)
  await settleViewport(session)
  const spot = await session.evaluate(`(() => {
    const r = document.querySelector('.react-flow__node[data-id="${EMPTY}"]').getBoundingClientRect();
    const p = document.querySelector('.react-flow__pane').getBoundingClientRect();
    return { r: [r.left, r.top, r.right, r.bottom].map(Math.round), p: [p.left, p.top, p.right, p.bottom].map(Math.round), inside: r.left >= p.left && r.right <= p.right && r.top >= p.top && r.bottom <= p.bottom, selected: document.querySelector('.react-flow__node[data-id="${EMPTY}"]').classList.contains('selected') };
  })()`)
  check(spot.inside, `定位后 ${EMPTY} 不在画布里：${JSON.stringify(spot)}`)
  pass(`检查结果里点视口外的 ${EMPTY}：挂上、挪到画布里`)

  // ── 拖卡片：挪了、松手写进图 ──
  const dragged = `s5_${COPIES - 1}`
  await focusNode(session, dragged, position.get(dragged), 2)
  const from = await session.evaluate(at(dragged, 0.2))
  await drag(session, from, 180, 80, 40, false)
  await sleep(1500)
  const saved = await rpc('graph/load', { name: BIG })
  const moved = saved.document.nodes.find((node) => node.id === dragged)
  const was = position.get(dragged)
  check(
    moved !== undefined && Math.hypot(moved.position.x - was.x, moved.position.y - was.y) > 40,
    `拖动后 ${dragged} 的位置没写进图：${JSON.stringify(moved?.position)}`,
  )
  await endpointsMounted(session, doc)
  pass(`拖 ${dragged}：松手后新位置写进图`)

  // ── 横穿视口的长线：两头都在视口外，线照样画着 ──
  const long = doc.edges
    .map((edge) => {
      const a = position.get(edge.source)
      const b = position.get(edge.target)
      return { edge, a, b, span: Math.hypot(a.x - b.x, a.y - b.y) }
    })
    .sort((x, y) => y.span - x.span)[0]
  const middle = { x: (long.a.x + long.b.x) / 2 + 120, y: (long.a.y + long.b.y) / 2 + 40 }
  // 把线的中点挪到画布中间，放大到两头都出了视口。
  for (let i = 0; i < 6; i += 1) {
    const view = await session.evaluate(viewportExpr)
    const center = await session.evaluate(paneCenterExpr)
    const pane0 = await session.evaluate(
      `(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`,
    )
    const sx = pane0.x + view.x + middle.x * view.zoom
    const sy = pane0.y + view.y + middle.y * view.zoom
    const blank2 = await session.evaluate(blankExpr)
    await drag(session, blank2, center.x - sx, center.y - sy, 20, false)
    await sleep(300)
    await wheel(session, center, 2)
  }
  await sleep(1200)
  const ends = await session.evaluate(`(() => {
    const p = document.querySelector('.react-flow__pane').getBoundingClientRect();
    const out = (id) => { const el = document.querySelector('.react-flow__node[data-id="' + id + '"]'); if (el === null) return true; const r = el.getBoundingClientRect(); return r.right < p.left || r.left > p.right || r.bottom < p.top || r.top > p.bottom; };
    return { a: out(${JSON.stringify(long.edge.source)}), b: out(${JSON.stringify(long.edge.target)}), line: document.querySelector('.react-flow__edge[data-id="${long.edge.id}"]') !== null };
  })()`)
  if (ends.a && ends.b) {
    check(ends.line, `横穿视口的线 ${long.edge.id} 没画`)
    pass(`两头都在视口外的长线 ${long.edge.id} 照样画着`)
  } else {
    check(ends.line, `长线 ${long.edge.id} 没画`)
    pass(`长线 ${long.edge.id} 画着（这台屏幕上两头没能都挪出视口）`)
  }

  // ── 实例：展示卡挪出去再挪回来，内容直接在 ──
  const answers = Object.fromEntries(
    doc.nodes.filter((node) => node.type === 'wfInput').map((node) => [node.id, '验收']),
  )
  const started = await rpc('run/start', {
    workflow: BIG_RUN,
    session: env.sessionId,
    cwd: env.workspaceDir,
    answers,
  })
  const instance = started.instance.id
  // 实例的产出写在实例自己的输出目录里。
  const outDir = join(env.workspaceDir, '.workflow-lite', 'runs', instance, 'out')
  await mkdir(join(outDir, 'docs'), { recursive: true })
  await writeFile(
    join(outDir, SHOWN_FILE),
    '# 展示卡\n\n挪出去再挪回来，内容直接在，不闪「读取中」。\n',
  )
  await session.evaluate(`document.querySelector('[data-testid="wl-hub-open"]').click()`)
  await revealHubRow(session, instance, env.workspaceDir)
  await session.evaluate(
    `document.querySelector('[data-testid="wl-hub-row"][data-id="${instance}"] [data-testid="wl-hub-view"]').click()`,
  )
  await waitFor(session, `document.querySelectorAll('.react-flow__node').length > 0`, {
    timeoutMs: 30_000,
  })
  await sleep(1500)
  await focusNode(session, SHOWN, position.get(SHOWN), 2)
  const content = `(() => {
    const body = document.querySelector('.react-flow__node[data-id="${SHOWN}"] [data-testid="wl-display-body"]');
    if (body === null) return 'none';
    if (body.querySelector('[aria-busy="true"], [class*="loading"]') !== null) return 'loading';
    return body.textContent.includes('展示卡') ? 'content' : 'other';
  })()`
  let shownState = ''
  for (let i = 0; i < 60 && shownState !== 'content'; i += 1) {
    shownState = await session.evaluate(content)
    await sleep(250)
  }
  check(
    shownState === 'content',
    `展示卡没读出内容：${shownState}（${await session.evaluate(`document.querySelector('.react-flow__node[data-id="${SHOWN}"]')?.textContent.slice(0, 200) ?? '没挂'`)}）`,
  )
  pass('实例里的展示卡读出了文件内容')
  // 卡片挂回来那一刻（插进 DOM 的那次变动里）展示区是什么样：记下来。
  await session.evaluate(`(() => {
    window.__remount = [];
    window.__remountObs = new MutationObserver(() => {
      const el = document.querySelector('.react-flow__node[data-id="${SHOWN}"]');
      const was = window.__remountWas ?? true;
      window.__remountWas = el !== null;
      if (el !== null && !was) window.__remount.push(${content});
    });
    window.__remountObs.observe(document.querySelector('.react-flow__viewport'), { childList: true, subtree: true });
  })()`)
  for (let i = 0; i < 8; i += 1) {
    await drag(session, await session.evaluate(blankExpr), -900, 0, 25, false)
    await sleep(250)
  }
  await sleep(1200)
  check(!(await session.evaluate(mounted(SHOWN))), '平移很远后展示卡应已摘下')
  for (let i = 0; i < 8; i += 1) {
    await drag(session, await session.evaluate(blankExpr), 900, 0, 25, false)
    await sleep(250)
  }
  await waitFor(session, mounted(SHOWN), { timeoutMs: 5000 })
  await sleep(600)
  const remount = await session.evaluate(
    `(() => { window.__remountObs.disconnect(); return window.__remount; })()`,
  )
  check(remount.length > 0, '没记到展示卡挂回来')
  check(
    remount.every((state) => state === 'content'),
    `展示卡挂回来时不是直接显示内容：${JSON.stringify(remount)}`,
  )
  pass('展示卡平移出去被摘下、挪回来：挂上那一刻内容就在，没闪「读取中」')
  console.log('\n✅ 大图验收全部通过')
} finally {
  session?.close()
  await env.stop()
  await rm(join(SCRATCH, 'home'), { recursive: true, force: true }).catch(() => {})
}
