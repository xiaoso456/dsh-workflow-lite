/**
 * 大图在真浏览器里的共用操作：排好版的大图、存图、按住拖、滚轮缩放、找卡片在屏幕上的位置。
 * `tests/perf/canvas-scenarios.mjs`（量开销）和 `tests/cdp-big.mjs`（验功能）共用。
 *
 * 大图只挂视口附近的卡片：看不见的卡不在 DOM 里，它在屏幕上的位置按视口变换和排版时记下的坐标算。
 */

import { tidy } from '../../src/client/model/layout.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { bigGraph } from '../perf/bigGraph.ts'
import { rpc } from './web-session.mjs'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** `copies` 份 25 张卡的大图，在 Node 里先排好版（画布上点「整理」时就基本不动了）。 */
export async function laidBigGraph(copies) {
  const raw = bigGraph(copies)
  const laid = await tidy(raw, analyzeGraph(raw))
  return {
    ...raw,
    nodes: raw.nodes.map((node) => ({ ...node, position: laid[node.id] ?? node.position })),
  }
}

/** 建一张图并存进去（同名的先删掉）。 */
export async function saveGraph(name, document) {
  await rpc('graph/delete', { name }).catch(() => {})
  await rpc('graph/create', { name })
  const disk = await rpc('graph/load', { name })
  await rpc('graph/save', { name, document, baseHash: disk.hash })
}

/** 卡片在屏幕上的位置（左上角往里一点、高度的 `dy` 处）：挂着就量元素，没挂按视口变换算。 */
export const centerOfNode = (id, position, dy = 0.5) =>
  `(() => {
    const el = document.querySelector('.react-flow__node[data-id="${id}"]');
    if (el !== null) { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(40, r.width / 3)), y: Math.round(r.top + r.height * ${dy}) }; }
    const p = ${JSON.stringify(position ?? null)};
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect();
    return { x: Math.round(pane.left + m.e + (p.x + 40) * m.a), y: Math.round(pane.top + m.f + (p.y + 90 * ${dy}) * m.a) };
  })()`

/** 画布中间、和视口变换（`{ x, y, zoom }`，屏幕坐标）。 */
export const paneCenterExpr = `(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
export const viewportExpr = `(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform); return { x: m.e, y: m.f, zoom: m.a }; })()`

/** 等视口停下来（动画走完）：连续 `quietMs` 毫秒变换都没变。 */
export async function settleViewport(session, { quietMs = 300, timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  let since = Date.now()
  while (Date.now() < deadline) {
    const now = JSON.stringify(await session.evaluate(viewportExpr))
    if (now !== last) {
      last = now
      since = Date.now()
    } else if (Date.now() - since >= quietMs) return
    await sleep(50)
  }
}

/** 画布上一块空白（点下去是在画布上平移，不是拖卡片）。 */
export const blankExpr = `(() => {
  const pane = document.querySelector('.react-flow__pane').getBoundingClientRect();
  for (let y = pane.top + 30; y < pane.bottom - 30; y += 17) for (let x = pane.left + 30; x < pane.right - 30; x += 23) {
    const el = document.elementFromPoint(x, y);
    if (el && el.classList.contains('react-flow__pane')) return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
})()`

export const mouse = (session, type, x, y, buttons) =>
  session.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left',
    buttons,
    clickCount: 1,
  })

/** 按住拖：默认往返一趟回到起点；`back = false` 时拖过去就松手。 */
export async function drag(session, from, dx, dy, steps = 120, back = true) {
  await mouse(session, 'mouseMoved', from.x, from.y, 0)
  await mouse(session, 'mousePressed', from.x, from.y, 1)
  let end = from
  for (let i = 1; i <= steps; i += 1) {
    const t = !back ? i / steps : i <= steps / 2 ? i / (steps / 2) : (steps - i) / (steps / 2)
    end = { x: Math.round(from.x + dx * t), y: Math.round(from.y + dy * t) }
    await mouse(session, 'mouseMoved', end.x, end.y, 1)
    await sleep(14)
  }
  await mouse(session, 'mouseReleased', end.x, end.y, 0)
}

export async function click(session, point) {
  await mouse(session, 'mouseMoved', point.x, point.y, 0)
  await mouse(session, 'mousePressed', point.x, point.y, 1)
  await mouse(session, 'mouseReleased', point.x, point.y, 0)
}

/** 在 `at` 处滚轮 `steps` 下（正数放大、负数缩小）。 */
export async function wheel(session, at, steps) {
  for (let i = 0; i < Math.abs(steps); i += 1) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: at.x,
      y: at.y,
      deltaX: 0,
      deltaY: steps > 0 ? -100 : 100,
    })
    await sleep(250)
  }
}

/** 先把那张卡平移到画布中间，再以它为中心放大 `zoomSteps` 下（大图在最小缩放下也放不下，不挪的话卡可能在屏幕外）。 */
export async function focusNode(session, id, position, zoomSteps = 5) {
  const center = await session.evaluate(paneCenterExpr)
  const at = await session.evaluate(centerOfNode(id, position))
  const blank = await session.evaluate(blankExpr)
  await drag(session, blank, center.x - at.x, center.y - at.y, 30, false)
  await sleep(400)
  for (let i = 0; i < zoomSteps; i += 1) {
    await wheel(session, await session.evaluate(centerOfNode(id, position)), 1)
  }
  await sleep(600)
}
