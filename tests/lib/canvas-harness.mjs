/**
 * 画布真浏览器验收的**共用骨架**：进画布、真实拖放、真实键鼠。
 *
 * 与 `cdp-session.mjs` 的分工：那边只管"连上 Chrome、发命令、收事件"，
 * 这边管"在 DSH 应用页里怎么走到画布、怎么用真指针/真键盘操作它"。
 *
 * **本文件只提供机制，不提供结论**：所有 `check()` 留在验收脚本里，
 * 免得辅助函数自己吞掉失败、把红的说成绿的。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { waitFor } from './cdp-session.mjs'
import { authenticatedUrl } from './web-session.mjs'

/* ── 走到画布 ─────────────────────────────────────────────── */

const clickAriaExpr = (label) =>
  `(() => {
     const hit = [...document.querySelectorAll('button')]
       .find((el) => el.getAttribute('aria-label') === ${JSON.stringify(label)});
     if (!hit) return false;
     hit.click();
     return true;
   })()`

/** 会话列表在实例刚起来时要等，点一次没出现不代表没有——一律轮询。 */
const clickSessionRowExpr = `(() => {
   const timeish = /\\d+\\s*(分钟|小时|天|分|秒|月)/;
   const all = [...document.querySelectorAll('a,button,li,div')];
   const hit = all.find((el) => {
     const t = (el.textContent || '').trim();
     return t.length > 2 && t.length < 120 && timeish.test(t) && el.querySelectorAll('*').length < 40;
   });
   if (!hit) return null;
   const text = (hit.textContent || '').trim().slice(0, 60);
   hit.click();
   return text;
 })()`

/** 点标题**恰好等于**某段文字的按钮（包含匹配会先命中会话列表里的别的按钮）。 */
export const clickTextExactExpr = (text) =>
  `(() => {
     const hit = [...document.querySelectorAll('button')]
       .find((el) => (el.textContent || '').trim() === ${JSON.stringify(text)});
     if (!hit) return false;
     hit.click();
     return true;
   })()`

/** 点一个 `data-testid` 命中的元素（`HTMLElement.click()`，不是真指针）。 */
export const clickTestIdExpr = (testId) =>
  `(() => {
     const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
     if (!(el instanceof HTMLElement)) return false;
     el.click();
     return true;
   })()`

/** 进入第一个带相对时间的会话（`conversation.view` 只在会话页上有槽位）。 */
export async function enterSession(session, { timeoutMs = 30_000 } = {}) {
  const opened = await session.evaluate(clickAriaExpr('搜索会话'))
  if (opened !== true) throw new Error('进不去会话列表：找不到 aria-label=搜索会话 的按钮')
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const row = await session.evaluate(clickSessionRowExpr)
    if (row !== null) return row
    if (Date.now() > deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** 点开会话页上的「工作流」tab（`role=tab` 里文字恰好等于它的那个）。 */
export async function openCanvasTab(session, { label = '工作流' } = {}) {
  const tabs = await waitFor(
    session,
    `(() => { const t = [...document.querySelectorAll('[role="tab"]')].map((el) => (el.textContent || '').trim()); return t.length ? t : 0; })()`,
    { timeoutMs: 20_000 },
  )
  const hit = await session.evaluate(`(() => {
     const el = [...document.querySelectorAll('[role="tab"]')].find((node) => (node.textContent || '').trim() === ${JSON.stringify(label)});
     if (!el) return false;
     el.click();
     return true;
   })()`)
  if (hit !== true) throw new Error(`找不到「${label}」tab，实得 ${JSON.stringify(tabs)}`)
  return tabs
}

/**
 * 打开「图」下拉的可搜索列表（自绘 combobox，不是原生 `<select>`）。
 *
 * 上一版这里点的是 `wl-graph-select` 那个原生 `<select>`：它不可搜索、样式也跟不了主题，
 * 已经换成自绘组件。驱动方式跟着换成"点触发器 → 在筛选框里输入 → 点命中的 option"。
 */
async function openGraphListbox(session, timeoutMs) {
  const opened = await session.evaluate(`(() => {
    const trigger = document.querySelector('[data-testid="wl-graph-trigger"]');
    if (trigger === null) return 'no-trigger';
    if (trigger.getAttribute('aria-expanded') === 'true') return 'already';
    trigger.click();
    return 'clicked';
  })()`)
  if (opened === 'no-trigger') throw new Error('找不到 wl-graph-trigger：图选择器没渲染出来')
  await waitFor(session, `document.querySelector('[data-testid="wl-graph-listbox"]') !== null`, {
    timeoutMs: 5_000,
  })
}

/**
 * 显式选中某张图，并等到画布真的把它渲染出来（或确认它是空图）。
 *
 * 判据仍是**页面自己认了这张图**，不是脚本读回自己写进去的值：触发器上要出现图名，
 * 状态不能是只读，且画布上要么有节点、要么是空态。
 */
export async function selectGraph(session, name, { timeoutMs = 25_000 } = {}) {
  await openGraphListbox(session, timeoutMs)
  // `graph/list` 是异步来的：列表可能还没有这张图，先在筛选框里输入并等它出现。
  await setReactInput(session, '[data-testid="wl-graph-filter"]', name)
  const optionSel = `[data-testid="wl-graph-listbox"] [role="option"][data-value=${JSON.stringify(name)}]`
  await waitFor(session, `document.querySelector(${JSON.stringify(optionSel)}) !== null`, {
    timeoutMs,
  })
  const picked = await session.evaluate(`(() => {
    const option = document.querySelector(${JSON.stringify(optionSel)});
    if (!(option instanceof HTMLElement)) return false;
    option.click();
    return true;
  })()`)
  if (picked !== true) throw new Error(`下拉里点不到图 ${name}`)
  return waitFor(
    session,
    `(() => {
       const trigger = document.querySelector('[data-testid="wl-graph-trigger"]');
       if (trigger === null) return 0;
       if (!(trigger.textContent || '').includes(${JSON.stringify(name)})) return 0;
       const status = document.querySelector('[data-testid="wl-status"]');
       if (status && (status.textContent || '').includes('只读')) return 0;
       return document.querySelectorAll('.react-flow__node').length || (document.querySelector('[data-testid="wl-empty-action"]') ? 1 : 0);
     })()`,
    { timeoutMs },
  )
}

/* ── 画布状态读取 ─────────────────────────────────────────── */

/**
 * 画布上的节点：id、**flow 坐标**、选中态。
 *
 * React Flow 12 给每个节点写的 `transform: translate(Xpx, Ypx)` 里 X/Y 就是
 * **flow 坐标**（视口的平移缩放由外层 `.react-flow__viewport` 承担），
 * 所以这里读到的数字可以直接和落点比较，不需要再从屏幕坐标反算。
 */
export const nodeListExpr = `(() => {
   return [...document.querySelectorAll('.react-flow__node')].map((el) => {
     const match = /translate\\(([-0-9.]+)px,\\s*([-0-9.]+)px\\)/.exec(el.style.transform || '');
     return {
       id: el.getAttribute('data-id'),
       x: match ? Number(match[1]) : null,
       y: match ? Number(match[2]) : null,
       selected: el.classList.contains('selected'),
     };
   });
 })()`

export const nodeCountExpr = `document.querySelectorAll('.react-flow__node').length`

/** 某个元素（`data-testid`）的视口矩形；找不到给 `null`。 */
export const rectOfTestIdExpr = (testId) =>
  `(() => {
     const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
     if (!el) return null;
     const r = el.getBoundingClientRect();
     return { x: r.left, y: r.top, w: r.width, h: r.height };
   })()`

/** 把元素滚进视野再取中心点（节点库那一栏可能滚过）。 */
export async function centerOf(session, selector) {
  const box = await session.evaluate(`(() => {
     const el = document.querySelector(${JSON.stringify(selector)});
     if (!el) return null;
     el.scrollIntoView({ block: 'center', inline: 'center' });
     const r = el.getBoundingClientRect();
     return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
   })()`)
  if (box === null) throw new Error(`找不到元素：${selector}`)
  if (box.w === 0 || box.h === 0) throw new Error(`元素没有尺寸：${selector}`)
  return { x: Math.round(box.x), y: Math.round(box.y) }
}

/** 受控输入框赋值（原生 setter + `input` 事件，React 才认）。 */
export const setReactInputExpr = (selector, value) =>
  `(() => {
     const el = document.querySelector(${JSON.stringify(selector)});
     if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
     const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
     const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
     setter.call(el, ${JSON.stringify(value)});
     el.dispatchEvent(new Event('input', { bubbles: true }));
     return el.value;
   })()`

export async function setReactInput(session, selector, value) {
  const now = await session.evaluate(setReactInputExpr(selector, value))
  if (now !== value) throw new Error(`输入框赋值失败：${selector} → ${JSON.stringify(now)}`)
  return now
}

/* ── 真指针 / 真键盘 ──────────────────────────────────────── */

/** 真指针点击（按下 + 松开），比 `el.click()` 更接近用户。 */
export async function mouseClick(session, point, { button = 'left' } = {}) {
  const buttons = button === 'left' ? 1 : 2
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0,
  })
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button,
    buttons,
    clickCount: 1,
  })
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button,
    buttons: 0,
    clickCount: 1,
  })
}

/** 把指针移到某点（触发 `:hover` 与 React Flow 的悬停逻辑）。 */
export async function mouseMove(session, point) {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    button: 'none',
    buttons: 0,
  })
}

/**
 * 真实 HTML5 拖放：按住拖源 → 让 Chrome 把 `dragstart` 的 `DragData` 交出来 →
 * 用同一份 `DragData` 向目标派发 `dragEnter` / `dragOver` / (`drop`)。
 *
 * 关键点：`setInterceptDrags(true)` 之后**页面自己的 `dragstart` 真的跑过**
 * （`dataTransfer` 里的自定义 MIME 是产品写进去的），我们只是把浏览器接下来
 * 该做的投递动作显式做出来。所以这条通路验的是产品，不是脚本。
 *
 * @param session - `openPage()` 的会话。
 * @param options - `{ itemTestId, to, steps, onDragOver, drop }`。
 * @returns 页面写进 `dataTransfer` 的 DragData（可断言 MIME 与内容）。
 */
export async function dragItemTo(
  session,
  { itemTestId, to, steps = 3, onDragOver, drop = true, holdMs = 120 },
) {
  const selector = `[data-testid="${itemTestId}"]`
  const from = await centerOf(session, selector)
  const fromLabel = await session.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? (el.textContent || '').trim().slice(0, 40) : null })()`,
  )
  await session.send('Input.setInterceptDrags', { enabled: true })
  try {
    const intercepted = session.once('Input.dragIntercepted', { timeoutMs: 6_000 })
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: from.x,
      y: from.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    // 分几步挪过去：一步就跳到远处的话，某些实现根本不会认定为拖拽。
    for (let step = 1; step <= steps; step += 1) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(from.x + ((to.x - from.x) * step) / steps),
        y: Math.round(from.y + ((to.y - from.y) * step) / steps),
        button: 'left',
        buttons: 1,
      })
    }
    const event = await intercepted
    const data = event?.data ?? null
    if (data === null) throw new Error('没有收到 Input.dragIntercepted：页面的 dragstart 没跑')
    const modifiers = data.dragOperationsMask ?? 1
    const dispatch = (type) =>
      session.send('Input.dispatchDragEvent', { type, x: to.x, y: to.y, data, modifiers })
    await dispatch('dragEnter')
    await dispatch('dragOver')
    if (onDragOver !== undefined) await onDragOver()
    if (drop) await dispatch('drop')
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: to.x,
      y: to.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, holdMs))
    return { data, from, fromLabel }
  } finally {
    await session.send('Input.setInterceptDrags', { enabled: false })
  }
}

/** CDP 的修饰键位：Alt=1、Ctrl=2、Meta=4、Shift=8。 */
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }

const VK = {
  z: 90,
  ArrowDown: 40,
  ArrowUp: 38,
  y: 89,
  Escape: 27,
  Enter: 13,
  Slash: 191,
  Delete: 46,
}

/**
 * 真键盘：一条 `keyDown` + 一条 `keyUp`。
 *
 * 合成 `KeyboardEvent` 不行——`event.isTrusted` 是 false，而且修饰键状态得自己糊。
 * 走 CDP 的 `Input.dispatchKeyEvent`，页面收到的是**真的**按键。
 */
export async function pressKey(session, key, { modifiers = 0, code, text } = {}) {
  const keyCode = VK[key] ?? key.toUpperCase().charCodeAt(0)
  const params = {
    key,
    code: code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key),
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  }
  await session.send('Input.dispatchKeyEvent', {
    type: text === undefined ? 'rawKeyDown' : 'keyDown',
    ...params,
    ...(text === undefined ? {} : { text }),
  })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

/** `Ctrl+Z` / `Ctrl+Shift+Z` 这类组合键。 */
export async function pressShortcut(session, key, mods = ['ctrl']) {
  let modifiers = 0
  for (const mod of mods) modifiers |= MOD[mod]
  await pressKey(session, key, { modifiers, text: undefined })
}

/* ── 截图 ─────────────────────────────────────────────────── */

/** 截图落到 `tests/runs/<name>`（`runs/` 被 vitest 排除）。 */
export async function screenshot(session, name) {
  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  const target = new URL(`../runs/${name}`, import.meta.url)
  await mkdir(new URL('../runs/', import.meta.url), { recursive: true })
  await writeFile(target, Buffer.from(shot.data, 'base64'))
  return target
}

/**
 * 从零走到画布：设视口 → 导航 → 等客户端半加载 → 进会话 → 开「工作流」tab → 显式选图。
 *
 * **不依赖"自动打开上次那张图"**：A16 的自动打开是产品行为，验收要能独立于它成立，
 * 所以每次都用图选择器显式选图。
 */
export async function bootToCanvas(session, graphName, { width = 1440, height = 900 } = {}) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await session.navigate(authenticatedUrl())
  const probe = await waitFor(session, 'globalThis.__WORKFLOW_LITE__ ?? ""', { timeoutMs: 30_000 })
  if (probe !== 'workflow-lite') throw new Error(`e2e 探针应为 workflow-lite，实得 ${JSON.stringify(probe)}`)
  const row = await enterSession(session)
  await openCanvasTab(session)
  const rendered = await selectGraph(session, graphName)
  return { row, rendered }
}
