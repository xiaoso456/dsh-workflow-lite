/**
 * 交互评审的**截图语料**生成器（取证，不是断言）。
 *
 * 与 `tests/cdp-canvas.mjs` 的分工：那个脚本回答"功能对不对"（33 步硬断言），
 * 这个脚本回答"**人看着难不难受**"——所以它不断言，只把一批真实状态固定成
 * PNG + 结构化探针，交给多个人（或多个 agent）各自冷读。断言会替读者决定"该看什么"，
 * 语料不会。
 *
 * 语料分两段，**每个取景点都成对拍亮色 + 暗色**（配色走两条独立路径：宿主 token 与
 * `light-dark()`，亮色通过不代表暗色通过）：
 *  A. **视口扫** 7 个宽度 × {无选中, 选中节点, 选中边}：窄窗口是历次真实事故的产地
 *     （越界 29px、右栏缩到 216px 撞在一起、整页滚动条）。
 *  B. **状态扫** 空图 / 长内容 / 密集图 / 节点库折叠·筛选·拖拽 / 悬停 / 快捷键弹层 /
 *     两种计划预览页签：每个状态都可能藏着"人没法编辑"的问题。
 *
 * 每张图配一份探针（`probes.json`），它把"看着不对"变成"量出来不对"：
 *  - **越界**：元素矩形超出根视图 1px 以上（历次"漏出对话框"就是这个）
 *  - **裁切**：`scrollWidth/Height` 大于客户区却被 `overflow: hidden` 吞掉（文字被切一半）
 *  - **整页滚动**：`documentElement.scrollHeight > innerHeight`（外框长出对话详情页）
 *  - **对比度**：文本前景色按祖先背景混合后算 WCAG 比值，<4.5（正文）/ <3（大字）记一笔
 *  - **零尺寸**：有内容却量到 0 宽的可见元素
 *
 * 数据根走 profile 的 `dataDir` 覆盖（`tests/runs/review-data`），**碰不到用户自己的图**。
 *
 * usage: DSH_WEB_TOKEN=<token> DSH_CDP_HTTP=http://127.0.0.1:9223 node tests/review-shots.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bootToCanvas, dragItemTo, mouseClick, mouseMove } from './lib/canvas-harness.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = new URL(`./runs/review-${STAMP}/`, import.meta.url)
const SHOTS = new URL('./shots/', OUT)

/**
 * 数据根。必须与 profile patch 里的 `dataDir` 一致：这个脚本要**直接往盘上写**
 * 自定义节点模板（`templates/nodes/` 没有 RPC 可写），所以两边不能各说各话。
 */
const DATA_DIR = process.env.DSH_WORKFLOW_DATA_DIR ?? join(homedir(), '.dsh', 'workflow-lite')

const NODES_DIR = join(DATA_DIR, 'templates', 'nodes')

/** 语料里的三张图。名字带前缀，和用户自己的图不可能撞。 */
const MAIN = 'rv-main'
const EMPTY = 'rv-empty'
const LONG = 'rv-long'
const DENSE = 'rv-dense'
const GRAPHS = [MAIN, EMPTY, LONG, DENSE]

const probes = []
const failures = []

/** 视口扫描用的一组宽度：从宽到窄，760 是"对话详情页被挤没了"的量级。 */
const VIEWPORTS = [
  [1920, 1080],
  [1440, 900],
  [1280, 800],
  [1100, 720],
  [980, 660],
  [860, 620],
  [760, 580],
]

/* ── 探针 ──────────────────────────────────────────────────── */

/**
 * 一次求值里把整页的量都收回来。
 *
 * 为什么不在 Node 侧分很多次求值：每次求值都是一次跨进程往返，几十张图乘十几次探针
 * 会把语料生成拖成分钟级；而且分次取值可能落在不同的渲染帧上，量出来的矩形互相矛盾。
 */
const PROBE = `(() => {
  const R = (el) => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const q = (sel) => document.querySelector(sel)
  const root = q('[data-testid="wl-root"]')
  const pick = (el) => { if (!el) return null
    const r = R(el)
    const cs = getComputedStyle(el)
    return { rect: r, display: cs.display, overflowX: cs.overflowX, overflowY: cs.overflowY,
      scrollW: el.scrollWidth, scrollH: el.scrollHeight, clientW: el.clientWidth, clientH: el.clientHeight } }

  const regions = {
    root: pick(root),
    bar: pick(root && root.querySelector(':scope > header')),
    library: pick(q('[data-testid="wl-library"]')),
    canvas: pick(q('[data-testid="wl-canvas"]')),
    inspector: pick(q('[data-testid="wl-inspector"]')),
    status: pick(q('[data-testid="wl-status"]')),
    /* 这两个盒子是 lens D 报出来的盲区：长文本能不能读，全靠它俩的 scrollH/clientH。 */
    prompt: pick(q('[data-testid="wl-prompt"]')),
    plan: pick(q('[data-testid="wl-plan"]')),
    summary: pick(q('[data-testid="wl-graph-summary"]')),
    edgeInspector: pick(q('[data-testid="wl-edge-inspector"]')),
  }
  /* body 不是带 testid 的元素：它是 root 里那个装着三栏的 div，用画布的祖先反查。 */
  const canvasEl = q('[data-testid="wl-canvas"]')
  const bodyEl = canvasEl && canvasEl.closest('[data-testid="wl-root"] > div')
  regions.body = pick(bodyEl)
  /* 三栏各自的第一层子元素：历次"栏内元素撞车"都发生在这里。 */
  const sideChildren = []
  if (bodyEl) {
    for (const child of bodyEl.children) {
      sideChildren.push({ tag: child.tagName.toLowerCase(),
        testid: child.getAttribute('data-testid') || null, ...pick(child) })
    }
  }

  const rootRect = root ? root.getBoundingClientRect() : null
  const clipped = []
  const zeroSize = []
  const escapees = []
  const textNodes = []
  const all = root ? [...root.querySelectorAll('*')] : []
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    /*
     * 不在布局树里（祖先 display:none，比如折起的节点库分节里那些条目）：
     * 量到 0×0 是"根本没渲染"，不是"被压扁"。offsetParent 为 null 是这件事的
     * 规范判据（position: fixed 除外，它本来就为 null）。
     */
    if (el.offsetParent === null && cs.position !== 'fixed') continue
    /*
     * 被祖先的 overflow 裁掉：那叫"这一栏里要滚"，不叫"漏出插件"。
     * 不区分的话，窄窗口下节点库那一栏会稳定产出 20 条假越界，把真信号淹掉。
     */
    let clippedByAncestor = false
    for (let ancestor = el.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      const acs = getComputedStyle(ancestor)
      if (acs.overflowX !== 'visible' || acs.overflowY !== 'visible') { clippedByAncestor = true; break }
    }
    /* React Flow 自己的外壳容器：画布按定义就比视口大，它裁剪不是问题。
       注意 rf__wrapper 是 React Flow 打的 **data-testid**，不是 class——
       按 class 判会漏掉它，然后在每一张图里稳定产出一条假裁切。 */
    const canvasShell = el.classList.contains('react-flow__renderer')
      || el.classList.contains('react-flow__pane')
      || el.classList.contains('react-flow__viewport')
      || el.getAttribute('data-testid') === 'rf__wrapper'
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim() !== '')
      .map((n) => n.textContent.trim()).join(' ').slice(0, 60)
    const label = el.tagName.toLowerCase()
      + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '')
      + (own ? ' "' + own + '"' : '')
    /* 裁切：内容比客户区大，而溢出被藏起来（等于人看不到也读不到）。
       行内元素（display:inline）没有客户盒，clientWidth 恒为 0/1，量它必是假阳性。 */
    const hidesX = cs.overflowX === 'hidden' || cs.overflowX === 'clip'
    const hidesY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
    if (cs.display !== 'inline' && cs.display !== 'ruby' && cs.display !== 'contents'
      && !canvasShell && !(el.clientWidth <= 2 && el.clientHeight <= 2)
      && ((hidesX && el.scrollWidth > el.clientWidth + 1) || (hidesY && el.scrollHeight > el.clientHeight + 1))) {
      if (clipped.length < 30) clipped.push({ el: label, scrollW: el.scrollWidth, clientW: el.clientWidth,
        scrollH: el.scrollHeight, clientH: el.clientHeight })
    }
    /* 越界：超出插件根视图，且**真的落在视口里**。
       只看"超出根"会把 React Flow 故意放在 (-1000,-1000) 的测量容器算成漏出；
       那类元素根本不与视口相交，人看不到，不算证据。 */
    if (rootRect && !clippedByAncestor
      && (r.right > rootRect.right + 1 || r.left < rootRect.left - 1
        || r.bottom > rootRect.bottom + 1 || r.top < rootRect.top - 1)
      && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) {
      const inHost = el.closest('[data-dsh-portal], [role="dialog"], [data-radix-popper-content-wrapper]')
      if (!inHost && escapees.length < 20) {
        escapees.push({ el: label, rect: R(el), root: { x: Math.round(rootRect.x), y: Math.round(rootRect.y),
          w: Math.round(rootRect.width), h: Math.round(rootRect.height) } })
      }
    }
    if (own !== '' && r.width > 0 && r.height > 0) {
      textNodes.push({ el, cs, own })
    }
  }
  /* 零尺寸：有文本却量不到面积（通常是被 flex 压扁了）。
     option 是原生控件的内部件，闭合的 select 里恒为 0×0，不是证据。 */
  for (const el of all) {
    if (el.tagName === 'OPTION' || el.tagName === 'DATALIST') continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none') continue
    /* 同上：不在布局树里的元素量到 0×0 是"没渲染"，不是"被压扁"。 */
    if (el.offsetParent === null && cs.position !== 'fixed') continue
    const r = el.getBoundingClientRect()
    const text = (el.textContent || '').trim()
    if (text !== '' && (r.width < 1 || r.height < 1) && el.children.length === 0) {
      if (zeroSize.length < 15) zeroSize.push({ el: el.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), text: text.slice(0, 40) })
    }
  }

  /* 对比度：文本色按祖先背景逐层混合，再算 WCAG 比值。 */
  const parse = (s) => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null
    const p = m[1].split(/[,\\s/]+/).filter((x) => x !== '').map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const lum = (c) => { const f = (v) => { const x = v / 255
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const ratio = (a, b) => { const l1 = lum(a); const l2 = lum(b)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  /*
   * 底色：从元素往上找第一层**不透明**的 background-color。
   *
   * 找不到就**返回 null 并跳过**，绝不兜底成白色：宿主深色主题的底往往不是
   * background-color（渐变 / 图片 / 宿主自己的包装层），兜白会把"深底浅字"
   * 一律算成 1.05:1 的假阳性。顺带把找到的祖先链记下来，方便人去图里核对。
   */
  const bgChainOf = (el) => { const chain = []
    let n = el
    while (n) {
      const cs2 = getComputedStyle(n)
      const c = parse(cs2.backgroundColor)
      if (c && c.a > 0.001) chain.push({ el: n.tagName.toLowerCase() + (n.getAttribute('data-testid') ? '[' + n.getAttribute('data-testid') + ']' : ''),
        bg: cs2.backgroundColor })
      if (chain.length >= 3) break
      n = n.parentElement
    }
    return chain }
  const lowContrast = []
  for (const { el, cs, own } of textNodes.slice(0, 400)) {
    /*
     * SVG 里的文字不吃 color，吃 fill。画布上唯一的文字（边的条件标签）就是这种情况，
     * 按 color 比等于永远拿默认黑去比，下一轮把边标签改淡也不会报。认 svg 祖先再取 fill。
     */
    const inSvg = el.closest('svg') !== null
    /*
     * 纯装饰跳过：aria-hidden 的文字语义就是"不承载信息"，令牌注释里也写明 faint 只给这种。
     * 不跳过的话，右栏每张图都会稳定刷几笔"装饰箭头对比度不足"的噪声。
     */
    if (el.closest('[aria-hidden="true"]') !== null) continue
    const fgRaw = inSvg ? getComputedStyle(el).fill : cs.color
    const fg0 = parse(fgRaw)
    if (!fg0) continue
    const chain = bgChainOf(el)
    const top = chain[0]
    if (!top) continue
    const raw = parse(top.bg)
    if (!raw || raw.a < 1) continue
    const fg = fg0.a < 1 ? over(fg0, raw) : fg0
    const px = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700
    const large = px >= 24 || (bold && px >= 18.66)
    const need = large ? 3 : 4.5
    const val = ratio(fg, raw)
    if (val < need - 0.02 && lowContrast.length < 25) {
      lowContrast.push({ el: el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''),
        text: own, fg: cs.color, bg: top.bg, bgFrom: top.el, chain,
        px: Math.round(px), ratio: Math.round(val * 100) / 100, need })
    }
  }

  /* 画布内的图元：节点卡片、边、边上的标签。 */
  const nodes = [...document.querySelectorAll('.react-flow__node')].map((el) => {
    const r = el.getBoundingClientRect()
    return { id: el.getAttribute('data-id'), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      text: (el.textContent || '').trim().slice(0, 50), selected: el.classList.contains('selected') }
  })
  const edges = [...document.querySelectorAll('.react-flow__edge')].map((el) => {
    const p = el.querySelector('.react-flow__edge-path'); const r = p ? p.getBoundingClientRect() : null
    const cs = p ? getComputedStyle(p) : null
    return { id: el.getAttribute('data-id'), selected: el.classList.contains('selected'),
      stroke: cs ? cs.stroke : null, dash: cs ? cs.strokeDasharray : null,
      label: (el.textContent || '').trim().slice(0, 40),
      rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null }
  })
  const edgeLabels = [...document.querySelectorAll('.react-flow__edge-textwrapper')].map((el) => {
    const r = el.getBoundingClientRect()
    return { text: (el.textContent || '').trim().slice(0, 40), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  })

  /* 侧栏的可见文案：评审要看"人眼读到的字"，而不是源码里的字典。 */
  const visibleText = (sel) => { const el = q(sel); return el ? (el.textContent || '').trim().slice(0, 400) : null }
  const buttons = [...document.querySelectorAll('[data-testid="wl-root"] button')].map((b) => ({
    text: (b.textContent || '').trim().slice(0, 30),
    testid: b.getAttribute('data-testid'), disabled: b.disabled,
    rect: R(b), expanded: b.getAttribute('aria-expanded'), title: b.getAttribute('title'),
  }))
  const overflowOf = (el) => { if (!el) return null
    return { scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight,
      clientH: el.clientHeight, text: (el.textContent || '').trim().slice(0, 200) } }

  /*
   * 宿主的滚动容器。插件长得比它高时，人就得滚对话才能看全画布——这才是"整页被顶开"
   * 的真实判据；documentElement 上的滚动条反而量不到（宿主自己是个内层滚动容器）。
   */
  const hostScrollEl = document.querySelector('[data-conversation-scroll]')
  const hostBox = (el) => { if (!el) return null
    const r = el.getBoundingClientRect()
    return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth,
      scrollTop: el.scrollTop, overflowY: getComputedStyle(el).overflowY,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } } }
  const hostRect = hostScrollEl ? hostScrollEl.getBoundingClientRect() : null
  const rootFitsHost = rootRect && hostRect
    ? { top: Math.round(rootRect.top - hostRect.top), bottom: Math.round(rootRect.bottom - hostRect.bottom),
      overflowsBy: Math.max(0, Math.round(rootRect.bottom - hostRect.bottom)) }
    : null

  /*
   * 所有"自己也滚"的容器（overflow auto/scroll 且内容超出）。
   * 评审要回答"人得滚几屏"，靠的就是这些数字；只收 hidden/clip 的裁切会漏掉它们，
   * 于是"长文本在窄栏里能不能读"退化成看截图猜。
   */
  const scrollables = []
  for (const el of all) {
    const scs = getComputedStyle(el)
    const scrollY = scs.overflowY === 'auto' || scs.overflowY === 'scroll'
    const scrollX = scs.overflowX === 'auto' || scs.overflowX === 'scroll'
    if (!scrollY && !scrollX) continue
    if (!(el.scrollHeight > el.clientHeight + 1) && !(el.scrollWidth > el.clientWidth + 1)) continue
    if (scrollables.length >= 20) break
    scrollables.push({
      el: el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''),
      rect: R(el), scrollH: el.scrollHeight, clientH: el.clientHeight,
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      screens: Math.round((el.scrollHeight / Math.max(1, el.clientHeight)) * 100) / 100,
    })
  }

  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    host: hostBox(hostScrollEl),
    rootFitsHost, scrollables,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    page: { scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight,
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
      bodyScrollH: document.body.scrollHeight },
    regions, sideChildren, escapees, clipped, zeroSize, lowContrast,
    counts: { nodes: nodes.length, edges: edges.length,
      paletteItems: document.querySelectorAll('[data-testid^="wl-item-"]').length,
      paletteGroups: document.querySelectorAll('[data-testid^="wl-group-"]').length,
      inspectorRows: document.querySelectorAll('[data-testid="wl-inspector"] button').length },
    nodes, edges, edgeLabels, buttons,
    texts: {
      /* 兜底：整个插件的可见文案。上一轮漏了 texts.canvas，导致画布上唯一的引导文案
         （"拖一个进来" / "松手放在这里"）在 78 张图里 0 命中，同时判错了"写了但不可见"和"没写"。 */
      all: root ? (root.textContent || '').trim().slice(0, 3000) : null,
      status: visibleText('[data-testid="wl-status"]'),
      graphSelect: (() => {
        const el = q('[data-testid="wl-graph-trigger"]')
        return el ? (el.textContent || '').trim().slice(0, 60) : null
      })(),
      library: visibleText('[data-testid="wl-library"]'),
      inspector: visibleText('[data-testid="wl-inspector"]'),
      summary: visibleText('[data-testid="wl-graph-summary"]'),
      edgeInspector: visibleText('[data-testid="wl-edge-inspector"]'),
      plan: visibleText('[data-testid="wl-plan"]'),
    },
    overflow: {
      library: overflowOf(q('[data-testid="wl-library"]')),
      inspector: overflowOf(q('[data-testid="wl-inspector"]')),
      bar: overflowOf(root && root.querySelector(':scope > header')),
    },
    activeElement: document.activeElement ? document.activeElement.tagName + (document.activeElement.getAttribute('data-testid') ? '[' + document.activeElement.getAttribute('data-testid') + ']' : '') : null,
    storage: Object.keys(localStorage).filter((k) => k.startsWith('workflow-lite')),
    consoleErrors: null,
  }
})()`

/* ── 种子数据 ──────────────────────────────────────────────── */

const node = (id, label, prompt, output) => ({
  id,
  type: 'wfNode',
  position: { x: 0, y: 0 },
  data: { label, prompt, ...(output === undefined ? {} : { output }) },
})

/** 一张"像真在用的"图：七个阶段 + 一条 pass/fail 分支 + 一个回边。 */
function mainDocument() {
  const ids = [
    ['scan', '侦察', '把仓库扫一遍，列出入口、构建脚本与测试命令。', 'scan.md'],
    ['plan', '规划', '读 `scan.md`，产出可执行的步骤清单与验收标准。', 'plan.md'],
    ['impl', '实现', '按 `plan.md` 写代码。改动要小步、可回滚。', 'impl.md'],
    ['test', '测试', '给本轮改动补测试，跑全量并汇报失败项。', 'test.md'],
    ['review', '审查', '逐条对照验收标准审查产出，不通过就写成问题清单。', 'review.md'],
    ['fix', '修复', '按 `review.md` 的问题清单逐条修，不许顺手改别的。', 'fix.md'],
    ['gate', '质量门', '检查测试全绿且无未解决问题。', undefined],
    ['report', '汇总', '把本轮结论、遗留风险与下一步写成最终报告。', 'report.md'],
  ]
  const nodes = ids.map(([id, label, prompt, output], index) => ({
    ...node(id, label, prompt, output),
    position: { x: 60 + (index % 4) * 260, y: 60 + Math.floor(index / 4) * 150 },
  }))
  const edge = (source, target, when) => ({
    id: when === undefined ? `${source}->${target}` : `${source}->${target}#${when}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined ? {} : { data: { when } }),
  })
  return {
    nodes,
    edges: [
      edge('scan', 'plan'),
      edge('plan', 'impl', 'pass'),
      edge('plan', 'fix', 'fail'),
      edge('impl', 'test'),
      edge('test', 'review'),
      edge('review', 'report', 'pass'),
      edge('review', 'fix', 'fail'),
      edge('fix', 'test'),
      edge('impl', 'gate'),
      edge('gate', 'report'),
    ],
    viewport: { x: 0, y: 0, zoom: 0.85 },
  }
}

/** 长内容：长标签、长提示词、长输出路径、长自定义条件。这一档专门打"省略号"的痛处。 */
function longDocument() {
  const longPrompt = [
    '你是一个负责重构的执行者。请严格按下面的约束工作：',
    '',
    '1. 先读 `.dispatch/rv-long/<planId>/plan.md`，不要凭印象开工；',
    '2. 每改完一个文件就跑一次最小测试集，不要攒到最后一起跑；',
    '3. 遇到不确定的接口签名，去读 `src/shared/wire.ts`，不要猜。',
    '',
    '一个不能换行的长串（现实里是 URL / base64 / 路径）：',
    'https://example.internal/repos/team/service/blob/main/packages/gateway/src/very/deeply/nested/directory/that/keeps/going/and/going/module.ts?ref=refs%2Fheads%2Ffeature%2Flong-branch-name&plain=1',
    '',
    '再给一段很长的中文，检查它在窄栏里是不是变成一条竖线或者被切掉：',
    '这一段的用意是让提示词输入框必须滚动而不是把整个右栏撑开，因为右栏一撑开画布就被挤没了，而画布被挤没之后连拖动节点都做不到，这是最严重的一类问题。',
  ].join('\n')
  return {
    nodes: [
      {
        ...node(
          'very-long-node-identifier-for-wrapping',
          '把仓库扫描一遍并输出结构化的入口清单、构建脚本、测试命令、依赖风险与遗留问题（这个标签故意很长）',
          longPrompt,
          'artifacts/round-2026-09-29/reconnaissance/final-scan-report.md',
        ),
        position: { x: 60, y: 60 },
      },
      {
        ...node('b', '短节点', '一句话。', 'b.md'),
        position: { x: 420, y: 200 },
      },
    ],
    edges: [
      {
        id: 'very-long-node-identifier-for-wrapping->b#retry_budget_exhausted_3x_fail',
        source: 'very-long-node-identifier-for-wrapping',
        target: 'b',
        sourceHandle: null,
        targetHandle: null,
        /* `when` 上限是 32 个码点，这里取满 30：要的就是"长到该被 UI 收好"的条件值。 */
        data: { when: 'retry_budget_exhausted_3x_fail' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 0.9 },
  }
}

/** 密集图：24 个节点，接近"自动布局该不该跑"的量级。 */
function denseDocument() {
  const nodes = []
  for (let i = 0; i < 24; i += 1) {
    nodes.push({
      ...node(`n${i + 1}`, `步骤 ${i + 1}`, `第 ${i + 1} 步的提示词。`, `out-${i + 1}.md`),
      position: { x: 40 + (i % 6) * 250, y: 40 + Math.floor(i / 6) * 150 },
    })
  }
  const edges = []
  for (let i = 1; i < nodes.length; i += 1) {
    edges.push({
      id: `n${i}->n${i + 1}`,
      source: `n${i}`,
      target: `n${i + 1}`,
      sourceHandle: null,
      targetHandle: null,
    })
  }
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 0.5 } }
}

/** 自定义节点模板：三个 `exec-` 成一组，`solo` 落单进「其他」。 */
const TEMPLATES = [
  ['exec-code', { label: '执行·写码', prompt: '按计划写代码。', output: 'code.md' }],
  ['exec-test', { label: '执行·测试', prompt: '给改动补测试。', output: 'test.md' }],
  ['exec-lint', { label: '执行·静态检查', prompt: '跑一遍 lint。', output: false }],
  ['solo', { label: '独行', prompt: '没有前缀的模板。', output: 'solo.md' }],
]

async function seed() {
  await mkdir(NODES_DIR, { recursive: true })
  for (const [name, data] of TEMPLATES) {
    await writeFile(join(NODES_DIR, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`)
  }
  const documents = { [MAIN]: mainDocument(), [LONG]: longDocument(), [DENSE]: denseDocument() }
  for (const name of GRAPHS) {
    /* 上一轮崩在半路会留下图：先删干净，语料生成必须可重复跑。 */
    await rpc('graph/delete', { name }).catch(() => {})
    await rpc('graph/create', { name })
    if (documents[name] === undefined) continue
    const load = await rpc('graph/load', { name })
    await rpc('graph/save', { name, document: documents[name], baseHash: load.hash })
  }
}

/* ── 截图 ──────────────────────────────────────────────────── */

/**
 * 截一张图 + 取一份探针，落到语料目录。
 *
 * 探针失败（比如求值超时）不吞掉：`failures` 里留一条，语料索引里标出来，
 * 免得"少了一张图"被当成"这个状态没问题"。
 */
/**
 * 一次取景拍**两张**：亮色 + 暗色。
 *
 * 为什么成对拍：换主题换的只是 CSS 变量，DOM 一模一样，所以在同一个页面里切一次
 * `color-scheme` 就能拿到两套配色，省掉一次完整导航。代价记在 `index.md` 里——
 * 这只覆盖"运行中切主题"，不覆盖"加载时就是暗色"。
 *
 * 上一轮语料整批都拍成了暗色（这台机器上宿主默认暗色），**亮色一张都没有**；
 * 而 `--wl-text-mute` 这类 `light-dark()` 取值恰好是两套，不成对拍就漏一半。
 */
async function shoot(session, id, note) {
  for (const theme of ['light', 'dark']) {
    const shotId = `${id}-${theme}`
    try {
      await setDark(session, theme === 'dark')
      const probe = await session.evaluate(PROBE)
      const shot = await session.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      await writeFile(new URL(`${shotId}.png`, SHOTS), Buffer.from(shot.data, 'base64'))
      probes.push({ id: shotId, note, ...probe, consoleErrors: [...session.errors].slice(-10) })
      process.stdout.write(`  shot ${shotId}\n`)
    } catch (error) {
      failures.push({
        id: shotId,
        note,
        error: String(error?.message ? error.message : error),
      })
      process.stdout.write(`  FAIL ${shotId}: ${error?.message ? error.message : error}\n`)
    }
  }
  await setDark(session, false)
}

/** 等画布把三栏都渲染出来，再开始取景。 */
async function settle(session) {
  await waitFor(
    session,
    `(() => {
    const c = document.querySelector('[data-testid="wl-canvas"]')
    const l = document.querySelector('[data-testid="wl-library"]')
    const i = document.querySelector('[data-testid="wl-inspector"]')
    return Boolean(c && l && i) && c.clientHeight > 80
  })()`,
    { timeoutMs: 20_000 },
  )
}

/**
 * 等图元**真的渲染出来**再取景。
 *
 * 视图变化期间（容器 resize 后的自适应、`fitView`）`@xyflow/react` 会把边短暂从 DOM 里
 * 摘掉：实测 6 个节点都在、`.react-flow__edge` 却是 0 条，几百毫秒后才回来。取景要的是
 * 稳态，不是那一帧——否则语料会随机少拍几个状态，而"少一张图"看起来跟"这个状态没问题"一样。
 */
async function waitForGraphDrawn(session, { nodes = 1, edges = 1 } = {}) {
  try {
    await waitFor(
      session,
      `document.querySelectorAll('.react-flow__node').length >= ${nodes}
      && document.querySelectorAll('.react-flow__edge').length >= ${edges}`,
      { timeoutMs: 8_000 },
    )
  } catch {
    /*
     * 超时不能只丢一句"等不到"。上一轮这条就是静默红的：6 个节点渲染着、边却是 0 条，
     * 几百毫秒后才回来（`@xyflow/react` 在视图变化期间会短暂摘掉边）。把当时的真实计数
     * 与视口变换一起打出来，才分得清"边没渲染完"和"图压根没加载"。
     */
    const diag = await session.evaluate(`(() => {
      const vp = document.querySelector('.react-flow__viewport');
      const canvas = document.querySelector('[data-testid="wl-canvas"]');
      const r = canvas ? canvas.getBoundingClientRect() : null;
      return {
        nodes: document.querySelectorAll('.react-flow__node').length,
        edges: document.querySelectorAll('.react-flow__edge').length,
        edgesSvg: document.querySelectorAll('.react-flow__edges').length,
        transform: vp ? getComputedStyle(vp).transform : null,
        canvas: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null,
        wanted: { nodes: ${nodes}, edges: ${edges} },
      };
    })()`)
    throw new Error(`等图元渲染超时（要 ${nodes} 节点 / ${edges} 边）：${JSON.stringify(diag)}`)
  }
}

/**
 * 真实指针点一下画布里的某个节点卡片中心。
 *
 * **落点必须落在画布矩形里**，这条以前没有，是被一次"整页被点走"教训出来的：
 * 缩放提到 0.7 之后图比画布宽，靠外的节点 `getBoundingClientRect()` 仍报它的真实位置，
 * 但那个点已经在画布**外面**了——实测 760 宽下节点中心跑到 x=244，扎进宿主自己的会话
 * 列表，一点就把整页导航走（画布消失，脚本却报"图元渲染超时"，指错了方向）。
 *
 * 所以先按 `prefer` 试，试不到就在画布里找**任意一个中心可点**的节点，都没有就带着
 * 当时的几何报清楚。
 */
async function clickNode(session, prefer = 0) {
  await waitForGraphDrawn(session, { nodes: 1, edges: 0 })
  const target = await session.evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="wl-canvas"]');
    if (canvas === null) return { error: 'no-canvas' };
    const c = canvas.getBoundingClientRect();
    const inside = (x, y) => x > c.left + 12 && x < c.right - 12 && y > c.top + 12 && y < c.bottom - 12;
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const ordered = nodes.slice(${prefer}).concat(nodes.slice(0, ${prefer}));
    for (const el of ordered) {
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (inside(x, y)) return { point: { x: Math.round(x), y: Math.round(y) }, id: el.getAttribute('data-id') };
    }
    const first = nodes.length > 0 ? nodes[0].getBoundingClientRect() : null;
    return {
      error: 'none-inside',
      canvas: { left: Math.round(c.left), top: Math.round(c.top), right: Math.round(c.right), bottom: Math.round(c.bottom) },
      first: first === null ? null : { x: Math.round(first.x), y: Math.round(first.y), w: Math.round(first.width) },
      count: nodes.length,
    };
  })()`)
  if (target.error !== undefined) throw new Error(`画布内没有可点的节点：${JSON.stringify(target)}`)
  await mouseClick(session, target.point)
  return target.id
}

/**
 * 真实指针点一下画布里的某条边。
 *
 * 同 `clickNode`：边的中点也可能落在画布外（图比画布宽时很常见），所以沿路径试几个
 * 采样点，取第一个落在画布里的。
 */
async function clickEdge(session, prefer = 0) {
  await waitForGraphDrawn(session, { nodes: 1, edges: prefer + 1 })
  const target = await session.evaluate(`(() => {
    const canvas = document.querySelector('[data-testid="wl-canvas"]');
    if (canvas === null) return { error: 'no-canvas' };
    const c = canvas.getBoundingClientRect();
    const inside = (x, y) => x > c.left + 12 && x < c.right - 12 && y > c.top + 12 && y < c.bottom - 12;
    const edges = [...document.querySelectorAll('.react-flow__edge')];
    const ordered = edges.slice(${prefer}).concat(edges.slice(0, ${prefer}));
    for (const el of ordered) {
      const path = el.querySelector('.react-flow__edge-path') || el.querySelector('path');
      if (path === null) continue;
      const total = path.getTotalLength();
      const m = path.getScreenCTM();
      if (m === null) continue;
      const svg = path.ownerSVGElement;
      for (const at of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
        const p = path.getPointAtLength(total * at);
        const pt = svg.createSVGPoint();
        pt.x = p.x;
        pt.y = p.y;
        const s = pt.matrixTransform(m);
        if (inside(s.x, s.y)) {
          return { point: { x: Math.round(s.x), y: Math.round(s.y) }, id: el.getAttribute('data-id'), at: at };
        }
      }
    }
    return { error: 'none-inside', count: edges.length };
  })()`)
  if (target.error !== undefined) throw new Error(`画布内没有可点的边：${JSON.stringify(target)}`)
  await mouseClick(session, target.point)
  return target.id
}

/** 点一个 data-testid，点完等一拍。 */
async function clickTestId(session, testId) {
  const hit = await session.evaluate(`(() => {
    const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]')
    if (!(el instanceof HTMLElement)) return false
    el.click()
    return true
  })()`)
  if (hit !== true) throw new Error(`点不到 ${testId}`)
  await new Promise((resolve) => setTimeout(resolve, 220))
}

/** 把某个 testid 的中心挪进视野并悬停。 */
async function hoverTestId(session, testId) {
  const point = await session.evaluate(`(() => {
    const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]')
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  if (point === null) throw new Error(`悬停不到 ${testId}`)
  await mouseMove(session, point)
  await new Promise((resolve) => setTimeout(resolve, 220))
  return point
}

/** 切到暗色：宿主是把 `color-scheme` 设在 `<html>` 上的，`light-dark()` 跟着它走。 */
async function setDark(session, dark) {
  await session.evaluate(`(() => {
    document.documentElement.style.colorScheme = ${JSON.stringify(dark ? 'dark' : 'light')}
    if (${JSON.stringify(dark)}) document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
    return true
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 260))
}

/** 走一遍"进会话 → 开工作流 tab → 选中某张图"，再等三栏齐。 */
async function boot(session, graph, width, height) {
  await bootToCanvas(session, graph, { width, height })
  /*
   * 让页面**相信自己有焦点**。
   *
   * headless Chrome 里 `document.hasFocus()` 是 false，于是 `:focus` 与 `:focus-visible`
   * 一概不匹配。实测过这个反差：点了空图那枚 CTA 之后 `document.activeElement` 确实就是
   * `wl-new-node-input`，但 `el.matches('input:focus')` 仍是 **false**，计算出的
   * `outline-style` 是 `none`；打开焦点模拟之后同一个元素立刻变成 `2px solid`。
   *
   * 也就是说：**语料此前对"聚焦态"整类瞎**，拍不到任何聚焦反馈，而这一轮恰好有一条
   * 发现（空图 CTA 点了零像素变化）落在这个盲区里。这不是产品的毛病，是取景漏了一档。
   */
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await settle(session)
}

/**
 * 清掉产品写在 `localStorage` 里的偏好。
 *
 * 这两把键跨进程活下来：上一次语料跑留下的"折叠表"会变成这一次的**前提**，
 * 于是同一张图在两次跑里拍的是两件事（本轮就是被自己上一步折起的节点库绊倒的：
 * 折叠表持久化，重新导航之后条目根本不在 DOM 里）。
 */
async function clearPrefs(session) {
  await session.evaluate(`(() => {
    for (const key of ['workflow-lite.lastGraph', 'workflow-lite.palette.collapsed']) {
      localStorage.removeItem(key)
    }
    return true
  })()`)
}

/** 节点库折着就把「全部收起 / 展开」按一下，直到要找的条目在 DOM 里。 */
async function ensurePaletteExpanded(session, testId = 'wl-item-preset-implement') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const present = await session.evaluate(
      `Boolean(document.querySelector('[data-testid=${JSON.stringify(testId)}]'))`,
    )
    if (present === true) return
    await clickTestId(session, 'wl-collapse-all')
  }
  throw new Error(`节点库展不开：找不到 ${testId}`)
}

/* ── 三段语料 ──────────────────────────────────────────────── */

/** A 段：视口扫。窄窗口是历次真实事故的产地，所以每档都取三种选中态。 */
async function viewportSweep(session) {
  for (const [width, height] of VIEWPORTS) {
    await boot(session, MAIN, width, height)
    await shoot(session, `v${width}-a-main`, `${width}x${height} 主图，无选中`)
    await clickNode(session, 0)
    await shoot(
      session,
      `v${width}-b-node`,
      `${width}x${height} 选中节点（右栏 = 节点属性 + 进出边清单）`,
    )
    await clickEdge(session, 0)
    await shoot(session, `v${width}-c-edge`, `${width}x${height} 选中边（右栏 = 边编辑）`)
  }
}

/** B 段：状态扫（1440x900）。 */
async function stateSweep(session) {
  await boot(session, EMPTY, 1440, 900)
  await shoot(session, 's-empty', '空图：没有人告诉人下一步该干嘛？')
  await clickTestId(session, 'wl-empty-action')
  await shoot(session, 's-empty-action', '空图点了「建第一个节点」之后，焦点去哪了？')

  await boot(session, LONG, 1440, 900)
  await shoot(session, 's-long-main', '长标签 / 长提示词 / 长条件，都没选中')
  await clickNode(session, 0)
  await shoot(session, 's-long-node', '选中长内容节点：右栏能编辑吗？')
  /* 右栏现在是「节点 / 计划」两个页签，编译预览只在计划页里——先切过去再取景。 */
  await clickTestId(session, 'wl-inspector-tab-plan')
  await shoot(session, 's-long-plan-dispatch', '计划页：默认页签（引用路径）')

  await boot(session, DENSE, 1440, 900)
  await shoot(session, 's-dense', '24 节点密集图')
  await clickTestId(session, 'wl-layout')
  await shoot(session, 's-dense-layout', '按了「重新布局」之后')

  await boot(session, MAIN, 1440, 900)
  await shoot(session, 's-main-1440', '主图基线')
  await hoverTestId(session, 'wl-item-preset-scan')
  await shoot(session, 's-palette-hover', '悬停节点库条目')
  await clickTestId(session, 'wl-section-toggle-builtin')
  await shoot(session, 's-palette-builtin-collapsed', '折起「内置 node」')
  await clickTestId(session, 'wl-section-toggle-disk')
  await shoot(session, 's-palette-disk-collapsed', '连同「自定义 node」一起折起')
  await clickTestId(session, 'wl-collapse-all')
  await shoot(session, 's-palette-all-collapsed', '「全部收起」之后')
  await session.evaluate(`(() => { const i = document.querySelector('[data-testid="wl-library-filter"]');
    if (i instanceof HTMLInputElement) { i.focus(); return true } return false })()`)
  await session.evaluate(`(() => { const i = document.querySelector('[data-testid="wl-library-filter"]');
    if (!(i instanceof HTMLInputElement)) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(i, 'exec'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await new Promise((resolve) => setTimeout(resolve, 260))
  await shoot(session, 's-palette-filter', '筛选 exec：剩下什么、还看得懂吗？')

  await boot(session, MAIN, 1440, 900)
  const target = await session.evaluate(`(() => {
    const el = [...document.querySelectorAll('.react-flow__node')][0]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })()`)
  await mouseMove(session, target)
  await new Promise((resolve) => setTimeout(resolve, 260))
  await shoot(session, 's-node-hover', '悬停节点卡片：操作按钮露出来了吗？压住内容了吗？')
  await clickTestId(session, 'wl-shortcuts')
  await shoot(session, 's-shortcuts', '快捷键弹层')
  await clickTestId(session, 'wl-shortcuts')

  /* 拖拽中的落点提示：真 HTML5 DnD，不然看不到 dropActive 那一套。 */
  await ensurePaletteExpanded(session)
  await dragItemTo(session, {
    itemTestId: 'wl-item-preset-implement',
    to: await session.evaluate(`(() => { const c = document.querySelector('[data-testid="wl-canvas"]')
      const r = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width * 0.62), y: Math.round(r.y + r.height * 0.55) } })()`),
    drop: false,
    holdMs: 260,
  })
  await shoot(session, 's-drag-over', '拖着节点在画布上方：落点提示看得见吗？')
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 10,
    y: 10,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })

  /* 计划页的两种视图：默认是「引用路径」，另一档是「内联全文」。 */
  await boot(session, MAIN, 1440, 900)
  await clickNode(session, 1)
  await clickTestId(session, 'wl-inspector-tab-plan')
  await shoot(session, 's-plan-dispatch', '计划页 = 引用路径')
  await session.evaluate(`(() => {
    const btn = [...document.querySelectorAll('[data-testid="wl-inspector"] button')]
      .find((b) => (b.textContent || '').trim() === '内联全文')
    if (!btn) return false
    btn.click(); return true
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 320))
  await shoot(session, 's-plan-full', '计划预览 = 内联全文（长文在窄栏里的样子）')
}

/* ── 主流程 ────────────────────────────────────────────────── */

async function main() {
  await mkdir(SHOTS, { recursive: true })
  process.stdout.write(`语料目录 ${OUT.pathname}\n`)
  await seed()
  process.stdout.write(`种子就绪：${GRAPHS.join(', ')} + ${TEMPLATES.length} 个自定义节点模板\n`)
  const session = await openPage()
  try {
    /* 先裸导航一次，只为把偏好清干净：折叠表会改变 A 段每一张图的构图。 */
    await session.navigate(authenticatedUrl())
    await clearPrefs(session)
    process.stdout.write('A 段 视口扫\n')
    await viewportSweep(session)
    process.stdout.write('B 段 状态扫\n')
    await stateSweep(session)
  } finally {
    session.close()
  }
  await writeFile(new URL('probes.json', OUT), `${JSON.stringify(probes, null, 2)}\n`)
  const index = [
    `# 交互评审语料 ${STAMP}`,
    '',
    `- 视口：${VIEWPORTS.map(([w, h]) => `${w}x${h}`).join(', ')}`,
    `- 图：${GRAPHS.join(', ')}`,
    `- 截图 ${probes.length} 张，失败 ${failures.length} 条`,
    '- 每张图都有 `-light` / `-dark` 两版，**在同一个页面里切主题**拍的：',
    '  覆盖"运行中切主题"，不覆盖"页面加载时就是暗色"。后者要单独复现。',
    `- 数据根：${DATA_DIR}`,
    '',
    '| id | 状态 | 备注 |',
    '| --- | --- | --- |',
    ...probes.map((p) => `| ${p.id} | ${p.texts.status ?? ''} | ${p.note ?? ''} |`),
    ...failures.map((f) => `| ${f.id} | FAIL | ${f.error} |`),
    '',
    '每张图对应的结构化探针在 `probes.json`（越界 / 裁切 / 对比度 / 整页滚动 / 零尺寸）。',
    '',
  ].join('\n')
  await writeFile(new URL('index.md', OUT), index)
  process.stdout.write(
    `\n完成：${probes.length} 张，失败 ${failures.length} 条\n失败明细：${JSON.stringify(failures)}\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`语料生成崩了：${error?.stack ? error.stack : error}\n`)
  process.exit(1)
})
