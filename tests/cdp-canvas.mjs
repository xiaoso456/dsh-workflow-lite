/**
 * 画布的**真浏览器验收**（CDP，headless Chrome）。
 *
 * 这一版不再只探探针，而是**真的进一个会话、点开「工作流」tab、在画布上操作一遍**。
 * 它守的是两件真实事故：
 *
 *  1. **`invalid RPC target`**：客户端调用器曾经把通道与方法名各拼一次，运行时变成
 *     `workflow-lite/workflow-lite/graph/list`，画布一个字节都加载不出来。当时的脚本
 *     自己拼 URL、恰好拼对，所以一路全绿——**绕过被测代码的验收等于没验收**。
 *     现在每一步都要求数据真的从 host 经 `connection.rpc.call` 流到 DOM 上。
 *  2. **画布是个空壳**：没有节点库分组、不能新增/删除、没有校验面板。所以这里逐条
 *     断言它们在真实 DOM 里存在且可用。
 *
 * `conversation.view` 是 session 作用域的槽位，hero 页上没有它，所以脚本先探会话列表。
 * 探不到就**如实报告跳过**（而不是假装通过）。
 *
 * 收尾加固（本轮新增，原有 31 步一步未删；现在共 33 步）：
 *  - 第 29 步：新增一条**既是 `when:'fail'` 又是回边**的边（第二组环里的 `retry2->retry1#fail`），
 *    断言它同时满足「`stroke-dasharray` 非空（回边）」与「`stroke` 是危险色（fail）」——
 *    旧实现三选一，这条边只拿到虚线、丢掉危险色；原有「普通 fail 边」「普通回边」两条断言保留。
 *  - 第 25 步：除"两个落点不重合"外，再断言新节点的 `getBoundingClientRect()` **四条边都落在
 *    `[data-testid="wl-canvas"]` 的矩形内**（上轮红过的"越界 29px、那半截点不到"）。
 *  - 新增两步键盘路径（第 31、32 步）：`Delete` 删选中节点、`Ctrl+Y` 作为重做别名。
 *    这两条都先自检"按点真的压在目标卡片上"，且**轮询到收敛**：刚挂载的卡片有几百毫秒
 *    `elementFromPoint` 会落到画布 pane 上的过渡态，拿它判红是脚本在跟渲染时序较劲。
 *  - 开跑先清 `workflow-lite.lastGraph` / `workflow-lite.palette.collapsed`：上一次运行留下的
 *    偏好不能让这一次的结论变样（同事实测被上一次的残留搞红过一次）。
 *
 * 节点库改版（内置 node 平铺 / 自定义 node 按前缀分组）后本轮的改写：
 *  - 第 5 步：不再断言内置那五组（规划/执行/审查/修复/汇总），改成断言**两个分节标签**
 *    （`内置 node` / `自定义 node`）都在、内置是**平铺的六个条目**、且内置没有二级组折叠钩子。
 *    5a 接着验用户问的那件事「怎么不支持展开收起」：两个**分节头**各是一个带 `aria-expanded` /
 *    `aria-controls` 的原生 button（`wl-section-toggle-*`），点整行就折；折内置分节后六个条目不
 *    在 DOM，刷新页面仍折叠（`localStorage` 的 `section:builtin`），最后恢复展开。
 *  - 第 19/20/21 步：内置没有组可折了，这三步整体挪到**自定义 node** 上——脚本自己往
 *    数据目录的 `templates/nodes/` 写四个模板（`exec` 前缀三个成组 + 落单的 `solo` 进「其他」），
 *    刷新页面后验折叠/持久化/全部收起/筛选。跑完**无论成败**在 `finally` 里删干净。
 *    这一步顺带补上了一个空白：`templates/nodes/` 非空时「自定义 node」那一节长什么样，以前从没验过。
 *  - 条目是**拖源**：点它不加节点、按回车也不加（用户两轮分别拍过这两条）。于是第 22b、
 *    32 步都用**拖**加节点，第 25 步反过来断言"连点两次什么都没发生"（哪天 `click`
 *    handler 回来会立刻红）；第 8 步的删除改从工具条右端「⋯」进（危险动作，窄窗放不下）。
 *
 * usage: DSH_WEB_TOKEN=<token> DSH_CDP_HTTP=http://127.0.0.1:9223 node tests/cdp-canvas.mjs
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  bootToCanvas as bootCanvas,
  centerOf,
  clickTestIdExpr,
  dragItemTo,
  mouseClick,
  mouseMove,
  nodeCountExpr,
  nodeListExpr,
  openCanvasTab,
  pressKey,
  pressShortcut,
  selectGraph,
  setReactInput,
  screenshot as takeScreenshot,
} from './lib/canvas-harness.mjs'
import { CDP_HTTP } from './lib/cdp-endpoint.mjs'
import { openPage, waitFor } from './lib/cdp-session.mjs'
import { authenticatedUrl, rpc } from './lib/web-session.mjs'

const NAME = `cdp-${Date.now().toString(36)}`
const TAB_LABEL = '工作流'
/** 截图落到这里（`tests/runs/` 是 CDP 的产物目录，被 vitest 的 exclude 排掉）。 */
const SHOT = new URL('./runs/canvas.png', import.meta.url)

/**
 * 本轮（交互改版）另外两张 seed 图。
 *
 * 为什么**先在开页之前**备好，而不是用到时再建：选择器里的 option 来自画布的
 * `graph/list`，而脚本侧的 RPC 建图**不会**让页面上的 catalog 刷新——用的时候再建，
 * 页面根本不知道有这张图（这正是"脚本绕过产品"的反面教材：要么让产品自己去刷，
 * 要么在它加载之前就备好）。
 */
const EMPTY_NAME = `cdp-empty-${Date.now().toString(36)}`
const EDGES_NAME = `cdp-edges-${Date.now().toString(36)}`

/** 内置起点的中文标签（用来在节点库里找一个可点的项）。 */
const PRESET_LABEL = '侦察'
/** 节点库两个分节的文字面（用户点名要的措辞）。 */
const BUILTIN_SECTION = '内置 node'
const DISK_SECTION = '自定义 node'
/** 内置起点的六个 id（内置那一节平铺的就是这六个）。 */
const BUILTIN_IDS = ['scan', 'plan', 'implement', 'review', 'fix', 'report']

/**
 * 第 19 / 20 / 21 步要用的**自定义节点模板**。
 *
 * 上一版这三步测的是内置的「规划」组——内置现在是平铺的、没有组可折，所以整体挪到自定义节点上：
 * `exec` 前缀三个模板成一组，`solo` 没有前缀、落单进「其他」。
 *
 * 形状就是节点 `data` 本体（与 `tests/e2e-canvas.mjs` 第 9 步同一形状）：不带 `id`、不带 `position`。
 * 脚本自己写在数据目录里，跑完**无论成败**都在 `finally` 里删干净。
 */
const TEMPLATE_FIXTURES = [
  ['exec-code', { label: '执行·写码', prompt: '按计划写代码。', output: 'code.md' }],
  ['exec-test', { label: '执行·测试', prompt: '给改动补测试。', output: 'test.md' }],
  ['exec-lint', { label: '执行·静态检查', prompt: '跑一遍 lint。', output: false }],
  ['solo', { label: '独行', prompt: '没有前缀的模板。', output: 'solo.md' }],
]

/**
 * 数据目录：默认是 `$DSH_HOME/workflow-lite`（`config.ts` 里 `dataDir` 的默认值）。
 * 实例把数据根配到别处时用 `DSH_WORKFLOW_DATA_DIR` 覆盖（与 `tests/e2e-canvas.mjs` 同一口径）。
 */
const DATA_DIR =
  process.env.DSH_WORKFLOW_DATA_DIR ??
  join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'workflow-lite')
const NODES_DIR = join(DATA_DIR, 'templates', 'nodes')

/**
 * 产品写在 `localStorage` 里的两把偏好键。
 *
 * 它们跨进程活下来：上一次跑留下的"上次打开的图"与"折叠表"会变成这一次的**前提**，
 * 于是同一条断言在两次跑里验的其实是两件事（同事实测被上一次的残留搞红过一次）。
 * 本脚本每次都用图选择器显式选图、从"全展开"起步，所以开跑先把这两把键清掉。
 */
const STORAGE_KEYS = ['workflow-lite.lastGraph', 'workflow-lite.palette.collapsed']

function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

/** 把自造模板写进数据目录（内容固定，重复写就是覆盖）。 */
async function writeTemplateFixtures() {
  await mkdir(NODES_DIR, { recursive: true })
  for (const [name, data] of TEMPLATE_FIXTURES) {
    await writeFile(join(NODES_DIR, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  }
}

/** 删掉自造模板。**失败路径也要跑**：数据目录只该剩下原本就有的东西。 */
async function removeTemplateFixtures() {
  for (const [name] of TEMPLATE_FIXTURES) {
    await rm(join(NODES_DIR, `${name}.json`), { force: true }).catch(() => {})
  }
}

/**
 * 走到画布 tab，但**不选图**（第 5a 步刷新页面时用）。
 *
 * 为什么不能顺手用 `bootCanvas`：它会显式选图，于是第 6 步那次"显式选图"变成**重复**选同一张图。
 * 原生 `change` 事件不因为值没变就不发，`CanvasView.open()` 便再开一次 `graph/load`；那次 load
 * 在途时 DOM 上还是上一份文档、节点数一点没变，看起来"已经就绪"，可这期间点节点库加的节点会被
 * 随后到来的 load 响应**整份覆盖**掉（实测偶发：第 7 步一直是 2，加的那个节点再没出现过）。
 * 刷新只为验折叠偏好，本来也不需要打开任何图，第 6 步再做"唯一一次显式选图"。
 */
async function bootCanvasWithoutGraph(session) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await session.navigate(authenticatedUrl())
  const probe = await waitFor(session, 'globalThis.__WORKFLOW_LITE__ ?? ""', { timeoutMs: 30_000 })
  if (probe !== 'workflow-lite') {
    throw new Error(`e2e 探针应为 workflow-lite，实得 ${JSON.stringify(probe)}`)
  }
  await enterSession(session)
  await openCanvasTab(session)
}

/** 先用 RPC 备一张有内容的图，好让画布有东西可渲染。 */
async function seed() {
  await rpc('graph/create', { name: NAME })
  const load = await rpc('graph/load', { name: NAME })
  const document = {
    nodes: [
      {
        id: 'scan',
        type: 'wfNode',
        position: { x: 80, y: 80 },
        data: { label: '扫描', prompt: '扫描仓库', output: 'scan.json' },
      },
      {
        id: 'report',
        type: 'wfNode',
        position: { x: 340, y: 80 },
        data: { label: '报告', prompt: '写报告', output: 'r.md' },
      },
    ],
    edges: [
      {
        id: 'scan->report',
        source: 'scan',
        target: 'report',
        sourceHandle: null,
        targetHandle: null,
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  await rpc('graph/save', { name: NAME, document, baseHash: load.hash })
  return NAME
}

/** 在页面里点一个 aria-label 命中的按钮。 */
const clickAria = (label) =>
  `(() => {
     const hit = [...document.querySelectorAll('button')]
       .find((el) => el.getAttribute('aria-label') === ${JSON.stringify(label)});
     if (!hit) return false;
     hit.click();
     return true;
   })()`

/** 点第一个带相对时间的会话行（会话列表里的真实条目）。 */
const clickSessionRow = `(() => {
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

/** 会话列表是异步拉的（实例刚起来时更慢），所以**轮询等它出现**，不要只点一次。 */
async function enterSession(session) {
  const opened = await session.evaluate(clickAria('搜索会话'))
  check(opened === true, '应能打开会话列表')
  const deadline = Date.now() + 30_000
  for (;;) {
    const row = await session.evaluate(clickSessionRow)
    if (row !== null) return row
    if (Date.now() > deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** 点标题含某段文字的按钮（节点库的项是「标签+id」拼在一起的，所以用包含匹配）。 */
const clickText = (text) =>
  `(() => {
     const hit = [...document.querySelectorAll('button')]
       .find((el) => (el.textContent || '').includes(${JSON.stringify(text)}));
     if (!hit) return false;
     hit.click();
     return true;
   })()`

/**
 * 点标题**恰好等于**某段文字的按钮。
 *
 * 画布工具条要用这个：侧边栏里有一个「展开其余 63 个会话」，用包含匹配会先命中它，
 * 于是"点了展开"其实展开的是会话列表——这种假通过比失败更坏。
 */
const clickTextExact = (text) =>
  `(() => {
     const hit = [...document.querySelectorAll('button')]
       .find((el) => (el.textContent || '').trim() === ${JSON.stringify(text)});
     if (!hit) return false;
     hit.click();
     return true;
   })()`

/** 打开「图」下拉并把它当前列出的图名列回来（第 4 步：证明 `graph/list` 真的到了 DOM）。 */
const listGraphsExpr = `(() => {
   const trigger = document.querySelector('[data-testid="wl-graph-trigger"]');
   if (trigger === null) return 0;
   if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
   const options = [...document.querySelectorAll('[data-testid="wl-graph-listbox"] [role="option"]')];
   const values = options.map((o) => o.dataset.value).filter((v) => typeof v === 'string' && v !== '');
   /*
    * 空的时候返回 **0 而不是空数组**：waitFor 判的是真假值，而空数组是**真值**，
    * 返回 [] 会让它第一次轮询就"成功"、拿着"一张图都没有"去断言。
    * 点开下拉与 React 把列表渲染出来不在同一个事件循环里，所以必须让它继续轮询。
    */
   return values.length > 0 ? values : 0;
 })()`

/** 把刚打开的下拉收起来（浮层留着会挡住后面靠真实指针的步骤）。 */
const closeGraphListboxExpr = `(() => {
   const trigger = document.querySelector('[data-testid="wl-graph-trigger"]');
   if (trigger !== null && trigger.getAttribute('aria-expanded') === 'true') trigger.click();
   return true;
 })()`

/** 备第二张图：**空图**（验空态可操作）与**带 fail 边 + 回边 + fail 回边**的图（验箭头与语气叠加）。 */
async function seedExtra() {
  await rpc('graph/create', { name: EMPTY_NAME })
  await rpc('graph/create', { name: EDGES_NAME })
  const load = await rpc('graph/load', { name: EDGES_NAME })
  const node = (id, label, prompt, output) => ({
    id,
    type: 'wfNode',
    position: { x: 0, y: 0 },
    data: { label, prompt, ...(output === undefined ? {} : { output }) },
  })
  await rpc('graph/save', {
    name: EDGES_NAME,
    baseHash: load.hash,
    document: {
      nodes: [
        node('plan1', '规划', '做计划', 'plan.md'),
        node('build1', '执行', '照计划执行', 'build.md'),
        node('check1', '审查', '审查产出', 'check.md'),
        node('fix1', '修复', '按问题清单修', 'fix.md'),
        // 第二个环（**与 build1/check1 那个环不相交**）：环的入口由 plan1 的条件 fail 边供给。
        node('retry1', '重试', '按失败原因重试', 'retry.md'),
        node('retry2', '复查', '复查重试结果', 'recheck.md'),
      ],
      edges: [
        // 分支点 plan1 的两条互斥条件出边（pass / fail 齐全）。
        {
          id: 'plan1->build1#pass',
          source: 'plan1',
          target: 'build1',
          sourceHandle: null,
          targetHandle: null,
          data: { when: 'pass' },
        },
        // **普通 fail 边**：不在任何环里（plan1 不属于任何强连通分量），所以它是"顺边"，
        // 该拿危险色、不该拿虚线。
        {
          id: 'plan1->fix1#fail',
          source: 'plan1',
          target: 'fix1',
          sourceHandle: null,
          targetHandle: null,
          data: { when: 'fail' },
        },
        {
          id: 'build1->check1',
          source: 'build1',
          target: 'check1',
          sourceHandle: null,
          targetHandle: null,
        },
        // **普通回边**：环 {build1, check1} 的入口是 build1（唯一有环外入边的成员），
        // DFS 从它出发，`check1->build1` 指回栈上祖先 ⇒ 是回边；它没有 when，所以只该有虚线。
        {
          id: 'check1->build1',
          source: 'check1',
          target: 'build1',
          sourceHandle: null,
          targetHandle: null,
        },
        /*
         * 第二组：`plan1->retry1#fail` 给环 {retry1, retry2} 提供了**环外入口**，
         * 于是入口唯一确定为 retry1，DFS 走 retry1 → retry2，`retry2->retry1#fail`
         * 指回栈上祖先 ⇒ **既是 `when:'fail'` 又是回边**。
         *
         * 这正是"fail 就回退重试"的常见闭环写法。旧实现把语气写成
         * `back ? edgeBack : when==='fail' ? edgeFail : edge` 三选一 ⇒ 回边赢，这条边的
         * 危险色被虚线吃掉（真浏览器量到过 `dash=5px,4px` 而 stroke 是普通描边色）。
         * 现在两类样式各管一个属性，必须**同时**成立。
         *
         * 为什么不直接拿 `plan1->fix1#fail` 配 `fix1->plan1` 成环：那会把 fix1 并进
         * build1/check1 那个环，入口与 DFS 顺序一变，`check1->build1` 就不再是回边，
         * 原有两条断言会被连带改掉。独立的环让三组结论互不干扰。
         */
        {
          id: 'plan1->retry1#fail',
          source: 'plan1',
          target: 'retry1',
          sourceHandle: null,
          targetHandle: null,
          data: { when: 'fail' },
        },
        {
          id: 'retry1->retry2',
          source: 'retry1',
          target: 'retry2',
          sourceHandle: null,
          targetHandle: null,
        },
        {
          id: 'retry2->retry1#fail',
          source: 'retry2',
          target: 'retry1',
          sourceHandle: null,
          targetHandle: null,
          data: { when: 'fail' },
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  })
}

/* ── 屏幕 ↔ 画布坐标：从真实 DOM 读换算，不许脚本自己编 ────────── */

/**
 * 画布几何。
 *
 * React Flow 12 把视口的 `translate(tx,ty) scale(zoom)` 放在 `.react-flow__viewport` 上，
 * 每个节点元素自己的 `transform: translate(x,y)` 里就是**画布坐标**。于是：
 *
 *   屏幕 = 画布容器左上角 + 视口平移 + 画布坐标 × zoom
 *
 * 这三个量（容器 rect、视口矩阵）都从 DOM 读——脚本里**不写死**任何边距/缩放假设。
 */
const GEOMETRY_EXPR = `(() => {
   const canvas = document.querySelector('[data-testid="wl-canvas"]');
   const viewport = document.querySelector('.react-flow__viewport');
   if (!canvas || !viewport) return null;
   const rect = canvas.getBoundingClientRect();
   const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
   const nodes = [...document.querySelectorAll('.react-flow__node')].map((el) => {
     const match = /translate\\(([-0-9.]+)px,\\s*([-0-9.]+)px\\)/.exec(el.style.transform || '');
     const box = el.getBoundingClientRect();
     return {
       id: el.getAttribute('data-id'),
       x: match ? Number(match[1]) : null,
       y: match ? Number(match[2]) : null,
       left: box.left,
       top: box.top,
     };
   });
   return {
     canvas: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
     viewport: { zoom: matrix.a, tx: matrix.e, ty: matrix.f },
     nodes,
   };
 })()`

/** 画布坐标 → 屏幕坐标。 */
function screenOf(geom, point) {
  return {
    x: geom.canvas.x + geom.viewport.tx + point.x * geom.viewport.zoom,
    y: geom.canvas.y + geom.viewport.ty + point.y * geom.viewport.zoom,
  }
}

/**
 * 读几何并**自检**：用已经在画布上的节点反算它们的屏幕位置，对不上就是**脚本的换算错了**
 * （不是产品坏了）。这种时候必须响亮地失败，否则后面的落点断言会变成"脚本自己跟自己比"。
 */
async function readGeometry(session, label) {
  const geom = await session.evaluate(GEOMETRY_EXPR)
  if (geom === null)
    throw new Error(`${label}: 读不到画布几何（wl-canvas 或 react-flow__viewport 不在）`)
  const wrong = geom.nodes.filter(
    (node) =>
      node.x !== null &&
      (Math.abs(screenOf(geom, node).x - node.left) > 2 ||
        Math.abs(screenOf(geom, node).y - node.top) > 2),
  )
  if (wrong.length > 0) {
    throw new Error(
      `${label}: 屏幕↔画布换算自检失败（**脚本问题，不是产品**）：${JSON.stringify(wrong.slice(0, 2))} 视口=${JSON.stringify(geom.viewport)}`,
    )
  }
  return geom
}

/** Node 侧轮询（页面外的 RPC 等落盘用）。 */
async function pollFor(fn, { timeoutMs = 10_000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > deadline) return null
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/**
 * 页面侧轮询到表达式满足条件为止，**返回最后一次读到的值**（超时不抛）。
 *
 * 用在"选图 / 切 tab / 刷新之后立刻读 DOM"会假红的地方：那一下读到的可能还是切换前的
 * 那一帧，结论只反映脚本跑得多快。判据仍由调用方的 `check` 出——这里不吞结论，
 * 只负责别拿中间态去比。
 *
 * @param session - `openPage()` 的会话。
 * @param expression - 页面表达式。
 * @param ok - 判定"已收敛"的谓词。
 * @param options - `timeoutMs` / `intervalMs`。
 */
async function readSettled(session, expression, ok, { timeoutMs = 5_000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await session.evaluate(expression)
    if (ok(value)) return value
    if (Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** 拖拽中的画布/落点标记状态（**可见性**，不是存在性——标记常驻 DOM）。 */
const MARKER_STATE_EXPR = `(() => {
   const canvas = document.querySelector('[data-testid="wl-canvas"]');
   const marker = document.querySelector('[data-testid="wl-drop-marker"]');
   if (!canvas || !marker) return null;
   const box = marker.getBoundingClientRect();
   const style = getComputedStyle(marker);
   return {
     canvasClass: canvas.className,
     markerHidden: marker.hidden,
     markerDisplay: style.display,
     markerW: Math.round(box.width),
     markerH: Math.round(box.height),
     markerX: Math.round(box.left + box.width / 2),
     markerY: Math.round(box.top + box.height / 2),
   };
 })()`

/**
 * 某个节点卡**在画布可见区域内**的可用点（悬停 / 按下都用它）。
 *
 * 为什么不是简单的卡片中心：画布对节点是 `overflow: hidden`，被裁掉的那一截
 * `getBoundingClientRect()` 照样报坐标，但 `elementFromPoint` 命中的是画布下面的东西。
 */
const nodeBoxExpr = (id) =>
  `(() => {
     const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(id)}) + ']');
     const canvas = document.querySelector('[data-testid="wl-canvas"]');
     if (!el || !canvas) return null;
     const box = el.getBoundingClientRect();
     const frame = canvas.getBoundingClientRect();
     const left = Math.max(box.left, frame.left) + 6;
     const right = Math.min(box.right, frame.right) - 6;
     const top = Math.max(box.top, frame.top) + 6;
     const bottom = Math.min(box.bottom, frame.bottom) - 6;
     if (right - left < 40 || bottom - top < 20) return null;
     return {
       center: { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) },
       head: { x: Math.round((left + right) / 2), y: Math.round(top + 4) },
       w: Math.round(box.width),
       h: Math.round(box.height),
     };
   })()`

/** 一条边的渲染事实：marker-end、箭头 polyline 的描边、虚线、以及边组上的类名。 */
const edgeInfoExpr = (id) =>
  `(() => {
     const group = document.querySelector('.react-flow__edge[data-id=' + JSON.stringify(${JSON.stringify(id)}) + ']');
     if (!group) return { id: ${JSON.stringify(id)}, missing: true };
     const path = group.querySelector('.react-flow__edge-path');
     if (!path) return { id: ${JSON.stringify(id)}, missing: 'no-path' };
     const markerEnd = path.getAttribute('marker-end') || path.style.markerEnd || '';
     const match = /url\\(["']?#([^)"']+)/.exec(markerEnd);
     let marker = match ? document.getElementById(match[1]) : null;
     if (!marker) {
       marker = [...document.querySelectorAll('marker')].find((m) => m.id && markerEnd.includes(m.id)) || null;
     }
     const arrow = marker ? marker.querySelector('polyline') : null;
     const style = getComputedStyle(path);
     return {
       id: ${JSON.stringify(id)},
       groupClass: group.getAttribute('class') || '',
       markerEnd,
       dash: style.strokeDasharray,
       stroke: style.stroke,
       markerFound: marker !== null,
       arrowStroke: arrow ? getComputedStyle(arrow).stroke : null,
       arrowFill: arrow ? getComputedStyle(arrow).fill : null,
     };
   })()`

/**
 * 右栏一行边的**只读信息**（第 29c 步）。
 *
 * 量三件事：
 *  1. 这一行**不是可交互元素**（不是 `<button>`、里面一个按钮也没有）——用户要求"点行什么都不做"。
 *  2. `显示名（id）`那一格**没有截断**（`scrollWidth <= clientWidth + 1`）：
 *     它是这一行最要紧的信息，靠省略号吃掉一半等于没写。
 *  3. 条件那一格是**可见文字**，且整行的右边界没有溢出右栏。
 * 宽度两档共用（1440px 视口的 320px 右栏与 1100px 视口的 272px 右栏）。
 */
const EDGE_ROW_PROBE = `(() => {
   const inspector = document.querySelector('[data-testid="wl-inspector"]');
   if (!inspector) return null;
   const frame = inspector.getBoundingClientRect();
   const rows = [...inspector.querySelectorAll('[class*="edgeRow"]')];
   if (rows.length === 0) return null;
   return {
     inspector: { left: frame.left, right: frame.right, width: frame.width },
     rows: rows.map((row) => {
       const name = row.querySelector('[class*="edgeName"]');
       const label = row.querySelector('[class*="whenLabel"]');
       const back = row.querySelector('[class*="tagBack"]');
       const box = row.getBoundingClientRect();
       return {
         tagName: row.tagName,
         buttons: row.querySelectorAll('button, input, [role="button"]').length,
         cursor: getComputedStyle(row).cursor,
         name: name ? (name.textContent || '').trim() : null,
         nameClient: name ? name.clientWidth : null,
         nameScroll: name ? name.scrollWidth : null,
         nameOverflowX: name ? getComputedStyle(name).textOverflow : null,
         nameRight: name ? name.getBoundingClientRect().right : null,
         whenLabel: label ? (label.textContent || '').trim() : null,
         whenRight: label ? label.getBoundingClientRect().right : null,
         back: back ? (back.textContent || '').trim() : null,
         backTitle: back ? back.getAttribute('title') : null,
         height: box.height,
       };
     }),
   };
 })()`

/** 画布与右栏当前的选中态（点右栏边行前后各读一次做对比）。 */
const SELECTION_PROBE = `(() => {
   const node = document.querySelector('.react-flow__node.selected');
   const inspector = document.querySelector('[data-testid="wl-inspector"]');
   const head = inspector ? inspector.querySelector('[class*="panelHead"]') : null;
   return {
     node: node ? node.getAttribute('data-id') : null,
     head: head ? (head.textContent || '').trim() : null,
     edgeInspector: inspector ? inspector.querySelector('[data-testid="wl-edge-inspector"]') !== null : false,
     summary: inspector ? inspector.querySelector('[data-testid="wl-graph-summary"]') !== null : false,
   };
 })()`

/**
 * 一条边上的**屏幕点**（第 29c 步的可点区域）。
 *
 * `offset` 是**画布单位**的法向偏移：沿路径切线取法线，再按视口缩放映射到屏幕。
 * 取 12 个单位是有道理的：React Flow 默认 `interactionWidth` 是 20（半宽 ±10 单位），
 * 产品把它设成 28（半宽 ±14）。所以"离描边 12 个单位"这个点：默认实现**点不中**，
 * 改过之后**点得中**——这就是那条"边得好点"的断言。不用自己算缩放，
 * `getScreenCTM` 已经把视口变换（平移 + 等比缩放）都算进去了。
 */
const edgePointExpr = (id, offset) => `(() => {
   const group = document.querySelector('.react-flow__edge[data-id=' + JSON.stringify(${JSON.stringify(id)}) + ']');
   if (!group) return null;
   const path = group.querySelector('.react-flow__edge-path');
   if (!path) return null;
   const total = path.getTotalLength();
   const map = path.getScreenCTM();
   if (!map) return null;
   const toScreen = (point) => ({
     x: map.a * point.x + map.c * point.y + map.e,
     y: map.b * point.x + map.d * point.y + map.f,
   });
   const mid = toScreen(path.getPointAtLength(total * 0.5));
   const ahead = toScreen(path.getPointAtLength(total * 0.54));
   const dx = ahead.x - mid.x;
   const dy = ahead.y - mid.y;
   const len = Math.hypot(dx, dy) || 1;
   const zoom = Math.hypot(map.a, map.b) || 1;
   const off = ${offset} * zoom;
   const point = { x: mid.x + (-dy / len) * off, y: mid.y + (dx / len) * off };
   const hit = document.elementFromPoint(point.x, point.y);
   const hitEdge = hit && hit.closest ? hit.closest('.react-flow__edge') : null;
   const canvas = document.querySelector('[data-testid="wl-canvas"]');
   const frame = canvas ? canvas.getBoundingClientRect() : null;
   return {
     mid,
     point,
     zoom,
     insideCanvas:
       frame !== null &&
       point.x >= frame.left &&
       point.x <= frame.right &&
       point.y >= frame.top &&
       point.y <= frame.bottom,
     canvas: frame ? { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom } : null,
     hitTag: hit ? hit.tagName : null,
     hitClass: hit ? hit.getAttribute('class') || '' : '',
     hitEdgeId: hitEdge ? hitEdge.getAttribute('data-id') : null,
   };
 })()`

/**
 * 等到某条边**真的渲染出来**再量。
 *
 * 视图变化期间（容器 resize 后的自适应、`fitView`）`@xyflow/react` 会把边短暂从 DOM 里
 * 摘掉：实测同一时刻 6 个节点都在、`.react-flow__edge` 却是 **0 条**，`viewportTransform`
 * 已经是自适应后的值，几百毫秒后边才回来。第 25 步早就为同一类"刚挂载的过渡态"立过
 * "轮询到收敛"的规矩——这里要量的是**稳态**，不是那一帧。
 *
 * 这条是 29c-6 反复红过之后补的：当时只打印 `null`，看不出是"边被重名了"还是"整批边
 * 还没渲染"，只能靠猜。诊断把它钉成了后者。
 */
const waitForEdgeRendered = (session, id) =>
  waitFor(
    session,
    `document.querySelector('.react-flow__edge[data-id=' + JSON.stringify(${JSON.stringify(id)}) + ']') !== null`,
    { timeoutMs: 6_000 },
  )

/**
 * 控制台错误的**归属划分**：本插件（画布）的错 vs 宿主外壳的噪音。
 *
 * 断言只认本插件的错。宿主外壳在会话引用被释放时会抛
 * `Sidebar Session opening failed … Session reference "…" is released`——它来自 DSH 的
 * 会话侧边栏生命周期，与画布一个字节的关系都没有，却会随"此刻会话列表长什么样"随机出现
 * （实测第 33 步红过一次，前面 32 步全绿）。这类噪音**原样打印**、不静默吞掉：
 * 只是不让宿主的问题冒充本插件的验收结论。
 *
 * 加白名单的唯一理由是"归属"：`invalid RPC target`（本插件最该守的那条）走的是**未过滤**
 * 的全集，任何新出现的、名字里带 workflow-lite 的错都不在此列。
 */
const HOST_SHELL_NOISE = [/Sidebar Session opening failed/, /Session reference .* is released/]

function splitConsoleErrors(lines) {
  const plugin = []
  const host = []
  for (const line of lines) {
    if (HOST_SHELL_NOISE.some((pattern) => pattern.test(line))) host.push(line)
    else plugin.push(line)
  }
  return { plugin, host }
}

/** 把被排除的宿主噪音的**首行**打出来（栈太长，只留结论行）。 */
function reportHostNoise(label, host) {
  if (host.length === 0) return
  console.log(`  ${label} 另有宿主外壳噪音 ${host.length} 条（与本插件无关，原文首行）：`)
  for (const line of host) console.log(`    - ${line.split('\n', 1)[0].slice(0, 220)}`)
}

const main = async () => {
  console.log(`# 画布真浏览器验收 @ CDP ${CDP_HTTP}`)
  const graph = await seed()
  console.log(`  0 备图 ok: ${graph}`)
  // 本轮新增的两张图也要在**开页之前**备好：选择器的 option 来自页面自己的 graph/list。
  await seedExtra()
  console.log(`  0b 备图 ok: ${EMPTY_NAME}（空图）、${EDGES_NAME}（fail 边 + 回边）`)

  const session = await openPage()
  try {
    // 三栏布局要在宽屏下才成立（<860px 会收成单栏），所以先把视口撑开。
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await session.navigate(authenticatedUrl())
    /*
     * 让页面相信自己有焦点。
     *
     * headless Chrome 里 `document.hasFocus()` 是 false，`:focus` / `:focus-visible` 一律
     * 不匹配——实测"输入框已经拿到 `document.activeElement`，但 `el.matches('input:focus')`
     * 仍是 false、`outline-style` 是 none"。验收要模拟的是**用户看着的这个窗口**，
     * 不是一个后台标签页；不开这一档，任何聚焦反馈都不在观测范围内。
     */
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    /*
     * 只统计**这次导航之后**的控制台错误。
     *
     * 这个 CDP 会话是导航之前就挂上去的，而同一张 page target 上"上一条命"留下的
     * 页面（别的脚本/别的进程跑出来的）可能在挂载瞬间抛出异常，混进本次的 errors 里——
     * 实测被上一轮探针故意注入的三个错误污染过一次，第 14 步就假红了。
     * 断言控制台是为了证明**产品这次没报错**，不是证明这台机器历史上没报过错。
     */
    session.errors.length = 0

    /*
     * 清掉上一次跑留下的两把偏好键（在**打开画布 tab 之前**清：画布是 tab 激活时才挂载的，
     * 它会在挂载时读 `lastGraph`）。不清的话，第二次跑是在第一次的残留状态上做断言
     * ——"折叠持久化""自动打开上次那张图"两条会变成不可复现的。
     */
    const stalePreferences = await session.evaluate(
      `(() => {
         const keys = ${JSON.stringify(STORAGE_KEYS)};
         const before = keys.map((key) => localStorage.getItem(key));
         keys.forEach((key) => localStorage.removeItem(key));
         return before;
       })()`,
    )
    console.log(`  0c 清偏好 ok（清掉 ${JSON.stringify(stalePreferences)}，之后一律显式选图）`)

    // 1) 客户端半加载并执行
    const probe = await waitFor(session, 'globalThis.__WORKFLOW_LITE__ ?? ""', {
      timeoutMs: 30_000,
    })
    check(probe === 'workflow-lite', `e2e 探针应为 workflow-lite，实得 ${JSON.stringify(probe)}`)
    console.log('  1 客户端半加载并执行 ok')

    // 2) 进一个会话（conversation.view 只在会话页上）
    const row = await enterSession(session)
    if (row === null) {
      console.log('  2 跳过：实例里没有任何会话，conversation.view 无处挂载')
      console.log('\n⚠️  未完成（环境所限，不是通过）')
      return
    }
    console.log(`  2 进入会话 ok: ${JSON.stringify(row)}`)

    // 3) 画布 tab
    const tabs = await waitFor(
      session,
      `(() => { const t = [...document.querySelectorAll('[role="tab"]')].map((el) => (el.textContent || '').trim()); return t.length ? t : 0; })()`,
      { timeoutMs: 20_000 },
    )
    check(tabs.includes(TAB_LABEL), `会话页应有「${TAB_LABEL}」tab，实得 ${JSON.stringify(tabs)}`)
    await session.evaluate(clickText(TAB_LABEL))
    console.log(`  3 画布 tab 在并已点开（tabs=${JSON.stringify(tabs)}）`)

    // 4) graph/list 真的走通了：下拉里列得出我们备的那张图
    const listed = await waitFor(session, listGraphsExpr, { timeoutMs: 20_000 })
    /* 下拉留着会挡住后面靠真实指针的步骤，读完就收起来。 */
    await session.evaluate(closeGraphListboxExpr)
    check(
      Array.isArray(listed) && listed.includes(NAME),
      `graph/list 应经真实 RPC 回执送到选择器，实得 ${JSON.stringify(listed)}`,
    )
    console.log(`  4 graph/list 经真实客户端 RPC 到达 DOM ok（${listed.length} 张图）`)

    /*
     * 5) 节点库：两个分节 + 内置是**平铺**的（没有组头、没有二级折叠）。
     *
     * 上一版这里断言的是内置那五组的标题（规划/执行/审查/修复/汇总）。用户点名要去掉那五组，
     * 断言随之改成：分节标签在、六个内置条目平铺在、内置**一个二级组折叠钩子都没有**。
     * 用户紧接着问的「怎么不支持展开收起」就是这一版要补的：两个**分节头**现在各是一个
     * 带 `aria-expanded` / `aria-controls` 的原生 button（`wl-section-toggle-*`），点整行就能折。
     *
     * 分节标签按**元素自己的 textContent** 读（这两个分节有 `wl-section-*` 钩子）：
     * `innerText` 会带上 CSS 的 `text-transform`（分节标签上一版是 uppercase，会把用户点名要的
     * `内置 node` 说成 `内置 NODE`）——判据是**写进 DOM 的那个字面**，不是某个样式变换后的样子。
     * 所以项数必须放在**另一个** span 里，`wl-section-builtin` 的 textContent 只能是分节名本身。
     */
    const palette = await session.evaluate(
      `(() => {
         const text = document.body.innerText || '';
         const sectionText = (id) => {
           const el = document.querySelector('[data-testid="' + id + '"]');
           return el ? (el.textContent || '').trim() : null;
         };
         const testIds = (prefix) => [...document.querySelectorAll('[data-testid^="' + prefix + '"]')]
           .map((el) => el.getAttribute('data-testid'));
         const attr = (id, name) => {
           const el = document.querySelector('[data-testid="' + id + '"]');
           return el ? el.getAttribute(name) : null;
         };
         /* aria-controls 必须指得到一个真元素（折起来时那个壳也得在），否则屏幕阅读器读到的是空指针。 */
         const controlsWired = (id) => {
           const target = attr(id, 'aria-controls');
           return target !== null && document.getElementById(target) !== null;
         };
         return {
           builtinSection: sectionText('wl-section-builtin'),
           diskSection: sectionText('wl-section-disk'),
           preset: (() => {
             const el = document.querySelector('[data-testid="wl-item-preset-scan"]');
             return el !== null && (el.textContent || '').includes(${JSON.stringify(PRESET_LABEL)});
           })(),
           title: text.includes('节点库'),
           items: testIds('wl-item-preset-'),
           builtinToggles: testIds('wl-group-toggle-builtin'),
           sectionToggles: testIds('wl-section-toggle-'),
           builtinSectionExpanded: attr('wl-section-toggle-builtin', 'aria-expanded'),
           sectionControlsWired:
             controlsWired('wl-section-toggle-builtin') && controlsWired('wl-section-toggle-disk'),
         };
       })()`,
    )
    check(palette.title === true, '节点库那一栏应在')
    check(palette.preset === true, `节点库里应有内置起点「${PRESET_LABEL}」`)
    check(
      palette.builtinSection === BUILTIN_SECTION && palette.diskSection === DISK_SECTION,
      `节点库应有两个分节标签「${BUILTIN_SECTION}」「${DISK_SECTION}」，实得 ${JSON.stringify({ builtin: palette.builtinSection, disk: palette.diskSection })}`,
    )
    check(
      palette.items.length === BUILTIN_IDS.length &&
        BUILTIN_IDS.every((id) => palette.items.includes(`wl-item-preset-${id}`)),
      `内置 node 应是平铺的六个条目，实得 ${JSON.stringify(palette.items)}`,
    )
    check(
      palette.builtinToggles.length === 0,
      `内置 node 这一节内部不该有二级组折叠钩子（节内平铺无组），实得 ${JSON.stringify(palette.builtinToggles)}`,
    )
    check(
      palette.sectionToggles.length === 2 &&
        palette.sectionToggles.includes('wl-section-toggle-builtin') &&
        palette.sectionToggles.includes('wl-section-toggle-disk'),
      `两个分节头都应挂着可点的折叠钩子（wl-section-toggle-*），实得 ${JSON.stringify(palette.sectionToggles)}`,
    )
    check(
      palette.sectionControlsWired === true,
      '两个分节头的 aria-controls 都应指得到一个真元素（折起来时那个壳也要在）',
    )
    check(
      palette.builtinSectionExpanded === 'true',
      `0c 刚清过偏好，内置分节起始应是展开的，实得 ${JSON.stringify(palette.builtinSectionExpanded)}`,
    )
    console.log(
      `  5 节点库两分节 + 内置平铺 ok（${palette.items.length} 个内置条目；内置二级折叠钩子 ${palette.builtinToggles.length} 个；分节钩子 ${JSON.stringify(palette.sectionToggles)}）`,
    )

    /*
     * 5a) 分节折叠 + 持久化（用户问的「怎么不支持展开收起」）。
     *
     * 点内置分节头的**整行** → `aria-expanded=false` 且六个内置条目从 DOM 消失；
     * 再点回来 → 六条回来；折上之后刷新页面 → 仍折叠（`localStorage` 的 `section:builtin` 生效）；
     * 最后恢复展开，免得影响后面那些要点内置条目的步骤（第 7 / 22 / 25 步…）。
     *
     * 只动内置分节：它是**平铺**的，折起来时整节条目都不在 DOM，正好把"消失"验干净。
     */
    const builtinToggleSel = '[data-testid="wl-section-toggle-builtin"]'
    const builtinItemsExpr = `document.querySelectorAll('[data-testid^="wl-item-preset-"]').length`
    const builtinExpandedExpr = `document.querySelector('${builtinToggleSel}')?.getAttribute('aria-expanded')`
    const waitBuiltinState = async (expanded) => {
      await waitFor(
        session,
        `(() => {
           const toggle = document.querySelector('${builtinToggleSel}');
           return toggle
             && toggle.getAttribute('aria-expanded') === '${expanded}'
             && ${builtinItemsExpr} === ${expanded === 'true' ? BUILTIN_IDS.length : 0};
         })()`,
        { timeoutMs: 5_000 },
      )
    }
    await session.evaluate(clickTestIdExpr('wl-section-toggle-builtin'))
    await waitBuiltinState('false')
    const sectionCollapsed = await session.evaluate(
      `(() => ({
         stored: localStorage.getItem('workflow-lite.palette.collapsed'),
       }))()`,
    )
    check(
      typeof sectionCollapsed.stored === 'string' &&
        sectionCollapsed.stored.includes(JSON.stringify('section:builtin')),
      `内置分节的折叠应写进 localStorage 的 section:builtin，实得 ${JSON.stringify(sectionCollapsed.stored)}`,
    )
    await session.evaluate(clickTestIdExpr('wl-section-toggle-builtin'))
    await waitBuiltinState('true')
    // 再折上一次，然后**刷新**：折叠状态应从 localStorage 读回来，而不是从内存里带过来。
    await session.evaluate(clickTestIdExpr('wl-section-toggle-builtin'))
    await waitBuiltinState('false')
    await bootCanvasWithoutGraph(session)
    // 刷新之后**等收敛**再读：刚导航完，节点库那一栏可能还是上一帧（这时还没选图，条目是 disabled 的）。
    const sectionAfterReload = await readSettled(
      session,
      `(() => ({
         expanded: document.querySelector('${builtinToggleSel}')?.getAttribute('aria-expanded') ?? null,
         items: ${builtinItemsExpr},
       }))()`,
      (value) => value?.expanded === 'false' && value.items === 0,
      { timeoutMs: 10_000 },
    )
    check(
      sectionAfterReload.expanded === 'false' && sectionAfterReload.items === 0,
      `刷新后内置分节应仍是折叠的（localStorage 持久化），实得 ${JSON.stringify(sectionAfterReload)}`,
    )
    await session.evaluate(clickTestIdExpr('wl-section-toggle-builtin'))
    await waitBuiltinState('true')
    check((await session.evaluate(builtinExpandedExpr)) === 'true', '5a 收尾应把内置分节恢复成展开')
    console.log(
      `  5a 分节折叠 + 持久化 ok（折叠时 0 条内置条目，localStorage=${JSON.stringify(sectionCollapsed.stored)}；刷新后仍折叠，已恢复展开）`,
    )

    // 6) 选图 → graph/load → React Flow 渲染出节点
    /*
     * 选图走共享的 `selectGraph`：它驱动自绘 combobox（点触发器 → 筛选 → 点 `[role=option]`），
     * 并等到**页面自己认了这张图**（触发器显示图名 + 画布渲染出东西）。
     * 原来的 `pickGraph` 是给原生 `<select>` 赋值的，那条路已经没有了。
     */
    await selectGraph(session, NAME)
    /*
     * 这里用 `readSettled`（等到**正好 2**）而不是裸的 `waitFor(length)`：裸长度第一次读到
     * 非零就返回，而 React Flow 挂载两个节点并不保证在同一个瞬间可见——实测就赶上过一次
     * 只渲染出 1 个的中间态，那一下红的是**脚本的竞态**，不是产品少渲染了节点。
     * 超时仍把最后一次真实读数交给下面的 `check` 出结论。
     */
    const nodes = await readSettled(
      session,
      'document.querySelectorAll(".react-flow__node").length',
      (value) => value === 2,
      { timeoutMs: 20_000 },
    )
    check(nodes === 2, `备好的图有 2 个节点，画布应渲染 2 个，实得 ${nodes}`)
    console.log(`  6 graph/load + React Flow 渲染 ok（${nodes} 个节点）`)

    // 7) 新增节点（用户点名的「没有新增」）
    //
    // 用**拖**加：条目点了不加节点（第 25 步反过来断言这件事），拖才是那条真能加进图里的路。
    const geom7 = await readGeometry(session, '7')
    const scanDropAt = {
      x: Math.round(geom7.canvas.x + geom7.canvas.w * 0.3),
      y: Math.round(geom7.canvas.y + geom7.canvas.h * 0.72),
    }
    await dragItemTo(session, { itemTestId: 'wl-item-preset-scan', to: scanDropAt })
    /*
     * 同样等**正好 3**（理由同第 6 步）：裸的 `waitFor(length)` 一读到真值就返回，
     * 而"松手 → React 提交新节点"之间有一个不保证在同一个瞬间完成的间隙（第 5a 步刷新过页面，
     * 这一下实测赶上过一次中间态）。超时仍把最后一次真实读数交给下面的 `check` 出结论。
     */
    const grew = await readSettled(
      session,
      'document.querySelectorAll(".react-flow__node").length',
      (value) => value === 3,
      { timeoutMs: 15_000 },
    )
    check(grew === 3, `拖一个起点进画布应新增一个节点（2 → 3），实得 ${grew}`)
    console.log(`  7 新增节点 ok（${nodes} → ${grew}，拖入）`)

    // 8) 删除节点（工具条右端「⋯」里的危险动作）
    const beforeDelete = grew
    /*
     * 删除从工具条明面收进了「⋯」：四个只读视图动词常驻，危险动作隔一层菜单
     * （工具条在 ≤1180 放不下第五个动词，滚动区里那个点不到）。先开菜单，再点那一项。
     */
    await session.evaluate(clickTestIdExpr('wl-toolbar-more-trigger'))
    const deleteMenuOpen = await waitFor(
      session,
      `document.querySelector('[data-testid="wl-toolbar-more-menu"]') !== null ? 1 : 0`,
      { timeoutMs: 5_000 },
    )
    check(deleteMenuOpen === 1, '点工具条右端的「⋯」应打开溢出菜单')
    const deleted = await session.evaluate(`(() => {
       const menu = document.querySelector('[data-testid="wl-toolbar-more-menu"]');
       if (menu === null) return false;
       const hit = [...menu.querySelectorAll('[role="menuitem"]')]
         .find((el) => (el.textContent || '').trim() === '删除选中节点');
       if (!hit) return false;
       hit.click();
       return true;
     })()`)
    check(deleted === true, '溢出菜单里应有「删除选中节点」这一项')
    const shrank = await readSettled(
      session,
      'document.querySelectorAll(".react-flow__node").length',
      (value) => value === beforeDelete - 1,
      { timeoutMs: 15_000 },
    )
    check(
      shrank === beforeDelete - 1,
      `删除选中节点应少一个（${beforeDelete} → ${beforeDelete - 1}），实得 ${shrank}`,
    )
    console.log(`  8 删除节点 ok（${beforeDelete} → ${shrank}）`)

    // 9) 校验面板
    const verify = await session.evaluate(
      `(() => {
         const text = document.body.innerText || '';
         return { title: text.includes('校验'), hint: text.includes('提示') || text.includes('没有问题') };
       })()`,
    )
    check(verify.title === true, '校验面板应在')
    console.log('  9 校验面板 ok')

    // 10) 编译预览：plan/build 经真实 RPC 拿到计划（右栏一段，不用点任何开关）
    const plan = await waitFor(
      session,
      `(() => { const pre = document.querySelector('pre'); return pre ? (pre.textContent || '').length : 0; })()`,
      { timeoutMs: 20_000 },
    )
    check(plan > 100, `派发计划应有内容（>100 字符），实得 ${plan}`)
    const hasContract = await session.evaluate(
      `(() => { const pre = document.querySelector('pre'); return (pre ? pre.textContent : '').includes('交付契约'); })()`,
    )
    check(hasContract === true, '派发计划里应有「交付契约」段')
    console.log(`  10 plan/build 经真实客户端 RPC ok（计划 ${plan} 字符，含「交付契约」段）`)

    // 11) 画布占满整页：**会话页自己的 chrome 不该漏出来**
    const hidden = await session.evaluate(`(() => {
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
      };
      const seat = document.querySelector('[data-conversation-region="composer"]');
      const handles = [...document.querySelectorAll('[data-conversation-content] [data-width-handle]')];
      const sidebar = document.querySelector('[data-side="sidebar"]');
      return {
        composer: seat === null ? 'no-seat' : shown(seat) ? 'visible' : 'hidden',
        handles: handles.length,
        handlesShown: handles.filter(shown).length,
        sidebarHandleShown: sidebar === null ? 'absent' : shown(sidebar),
      };
    })()`)
    check(
      hidden.composer === 'hidden',
      `画布激活时输入框应被藏掉（整页占满），实得 ${JSON.stringify(hidden)}`,
    )
    check(
      hidden.handles > 0 && hidden.handlesShown === 0,
      `会话列宽拖拽柄应被藏掉（它们是浮在画布上的隐形热区），实得 ${JSON.stringify(hidden)}`,
    )
    check(
      hidden.sidebarHandleShown === true,
      `左侧导航栏的拖拽柄属于应用外壳，**不能被误伤**，实得 ${JSON.stringify(hidden)}`,
    )
    console.log(
      `  11 会话 chrome 已藏（输入框 + ${hidden.handles} 条列宽拖拽柄）、导航栏拖拽柄未误伤 ok`,
    )

    // 12) 切回「对话」，两件 chrome **必须都回来**——证明隐藏只作用于我们自己的视图
    await session.evaluate(clickTextExact('对话'))
    const restored = await waitFor(
      session,
      `(() => { const seat = document.querySelector('[data-conversation-region="composer"]');
         if (seat === null) return 0;
         const r = seat.getBoundingClientRect();
         const shown = getComputedStyle(seat).display !== 'none' && r.height > 0;
         const handles = [...document.querySelectorAll('[data-conversation-content] [data-width-handle]')];
         const anyHandle = handles.some((el) => getComputedStyle(el).display !== 'none');
         return shown && anyHandle ? Math.round(r.height) : 0; })()`,
      { timeoutMs: 15_000 },
    )
    check(restored > 0, `切回「对话」后输入框与拖拽柄都必须回来，实得 ${restored}`)
    console.log(
      `  12 切回「对话」输入框与拖拽柄都已恢复 ok（高 ${restored}px，隐藏没误伤别的视图）`,
    )

    // 13) 再切回画布，把截图停在画布上
    await session.evaluate(clickTextExact(TAB_LABEL))
    const back = await waitFor(session, `document.querySelectorAll('.react-flow__node').length`, {
      timeoutMs: 15_000,
    })
    console.log(`  13 切回画布 ok（${back} 个节点，视图重新挂载）`)

    // 14) 控制台：干净，且绝不再出现 invalid RPC target
    const errors = session.errors.filter((line) => !line.includes('favicon'))
    const badTarget = errors.filter((line) => line.includes('invalid RPC target'))
    const split14 = splitConsoleErrors(errors)
    check(badTarget.length === 0, `不该再有 invalid RPC target：\n  ${badTarget.join('\n  ')}`)
    check(
      split14.plugin.length === 0,
      `浏览器控制台不该有未捕获错误（本插件）：\n  ${split14.plugin.join('\n  ')}`,
    )
    reportHostNoise('14', split14.host)
    console.log('  14 控制台干净、无 invalid RPC target ok')

    // 15) 留一张截图给人看（也是"画布真的长这样"的证据）
    const shot = await session.send('Page.captureScreenshot', { format: 'png' })
    await mkdir(new URL('./runs/', import.meta.url), { recursive: true })
    await writeFile(SHOT, Buffer.from(shot.data, 'base64'))
    console.log(`  15 截图 ok: ${SHOT.pathname}`)

    // ── 以下为本轮（交互改版）新增：拖放 / 折叠 / 撤销 / 键盘 / 卡片操作 ──
    //
    // 每一条都**先显式选中 seed 的那张图**再做断言，不依赖产品的"记住上次打开的图"
    // （那是产品行为，不是验收前提）。

    // 16) 显式选图，立基线
    const baseCount = await selectGraph(session, NAME)
    check(baseCount === 2, `基线：seed 的图应渲染 2 个节点，实得 ${baseCount}`)
    const baseNodes = await session.evaluate(nodeListExpr)
    const baseIds = baseNodes.map((node) => node.id).sort()
    check(
      baseIds.join(',') === 'report,scan',
      `基线节点应为 report, scan，实得 ${JSON.stringify(baseIds)}`,
    )
    const geom16 = await readGeometry(session, '16')
    console.log(
      `  16 显式选图 + 几何自检 ok（zoom=${geom16.viewport.zoom.toFixed(3)}，画布 ${Math.round(geom16.canvas.w)}×${Math.round(geom16.canvas.h)}）`,
    )

    // 17) 拖放进画布：从节点库条目拖到画布上一个**具体的屏幕坐标**，节点落在那里
    const canvasCenter = {
      x: Math.round(geom16.canvas.x + geom16.canvas.w / 2),
      y: Math.round(geom16.canvas.y + geom16.canvas.h / 2),
    }
    const dropAt = {
      x: Math.round(geom16.canvas.x + geom16.canvas.w * 0.66),
      y: Math.round(geom16.canvas.y + geom16.canvas.h * 0.24),
    }
    const dragOne = await dragItemTo(session, { itemTestId: 'wl-item-preset-scan', to: dropAt })
    const payload = dragOne.data.items?.find(
      (item) => item.mimeType === 'application/x-workflow-lite-node',
    )?.data
    check(
      payload === JSON.stringify({ kind: 'preset', id: 'scan' }),
      `dragstart 应把自有 MIME 的载荷装进 DataTransfer，实得 ${JSON.stringify(payload)}`,
    )
    const grownCount = await waitFor(
      session,
      `(() => { const n = document.querySelectorAll('.react-flow__node').length; return n === 3 ? n : 0; })()`,
      { timeoutMs: 10_000 },
    )
    check(grownCount === 3, `拖放应新增一个节点（2 → 3），实得 ${grownCount}`)
    const afterDrop = await session.evaluate(nodeListExpr)
    const fresh = afterDrop.find((node) => !baseIds.includes(node.id))
    check(fresh !== undefined, `应能认出拖进来的新节点，实得 ${JSON.stringify(afterDrop)}`)
    const freshScreen = screenOf(geom16, fresh)
    const offsetX = Math.abs(freshScreen.x - dropAt.x)
    const offsetY = Math.abs(freshScreen.y - dropAt.y)
    check(
      offsetX <= 40 && offsetY <= 40,
      `新节点应落在落点上（容差 40px）：落点 ${JSON.stringify(dropAt)}，节点 ${fresh.id} 在 ${JSON.stringify({ x: Math.round(freshScreen.x), y: Math.round(freshScreen.y) })}（偏差 ${Math.round(offsetX)}/${Math.round(offsetY)}）`,
    )
    check(
      Math.hypot(freshScreen.x - canvasCenter.x, freshScreen.y - canvasCenter.y) > 100,
      `落点应明显偏离视野中心（否则"用落点"与"用中心"分不出来）：节点离中心 ${Math.round(Math.hypot(freshScreen.x - canvasCenter.x, freshScreen.y - canvasCenter.y))}px`,
    )
    // 顺带验落盘：拖进来的坐标真的写进文档了（走的是产品的保存通路，不是脚本自己算的）。
    let lastLoaded = null
    const persisted = await pollFor(async () => {
      const loaded = await rpc('graph/load', { name: NAME })
      lastLoaded = loaded.document.nodes.map((candidate) => ({
        id: candidate.id,
        x: candidate.position.x,
        y: candidate.position.y,
      }))
      const node = loaded.document.nodes.find((candidate) => candidate.id === fresh.id)
      return node !== undefined ? node : null
    })
    if (persisted === null) {
      const uiState = await session.evaluate(
        `(() => {
           const status = document.querySelector('[data-testid="wl-status"]');
           const root = document.querySelector('[data-testid="wl-root"]');
           return { status: status ? (status.textContent || '').trim() : null, bar: (root ? root.textContent : '').slice(0, 160) };
         })()`,
      )
      throw new Error(
        `FAIL: 拖进来的节点应落盘（graph/load 里应看到 ${fresh.id}）：最后一次读到 ${JSON.stringify(lastLoaded)}，顶栏 ${JSON.stringify(uiState)}`,
      )
    }
    const persistedScreen = screenOf(geom16, persisted.position)
    check(
      Math.abs(persistedScreen.x - dropAt.x) <= 40 && Math.abs(persistedScreen.y - dropAt.y) <= 40,
      `落盘的坐标应就是落点：${JSON.stringify(persisted.position)} ⇒ 屏幕 ${JSON.stringify({ x: Math.round(persistedScreen.x), y: Math.round(persistedScreen.y) })}`,
    )
    const shotRedesign = await takeScreenshot(session, 'canvas-redesign.png')
    console.log(
      `  17 拖放进画布 ok（${fresh.id} 落在 ${JSON.stringify({ x: Math.round(freshScreen.x), y: Math.round(freshScreen.y) })}，与落点差 ${Math.round(Math.hypot(offsetX, offsetY))}px；已落盘）`,
    )

    // 18) 拖拽反馈：dragOver 时高亮 + 落点标记可见且跟着指针；drop 后都还原
    const classBefore = await session.evaluate(
      `document.querySelector('[data-testid="wl-canvas"]').className`,
    )
    const dropAt2 = {
      x: Math.round(geom16.canvas.x + geom16.canvas.w * 0.34),
      y: Math.round(geom16.canvas.y + geom16.canvas.h * 0.62),
    }
    let midDrag = null
    await dragItemTo(session, {
      itemTestId: 'wl-item-preset-plan',
      to: dropAt2,
      onDragOver: async () => {
        midDrag = await session.evaluate(MARKER_STATE_EXPR)
        await takeScreenshot(session, 'drag-in-progress.png')
      },
    })
    check(midDrag !== null, 'dragOver 时应能读到画布与落点标记')
    check(
      midDrag.canvasClass !== classBefore && midDrag.canvasClass.includes('canvasDrop'),
      `dragOver 之后画布应出现拖放高亮类：之前 ${JSON.stringify(classBefore)}，之后 ${JSON.stringify(midDrag.canvasClass)}`,
    )
    check(
      midDrag.markerHidden === false &&
        midDrag.markerDisplay !== 'none' &&
        midDrag.markerW > 0 &&
        midDrag.markerH > 0,
      `dragOver 时落点标记应**可见**（常驻 DOM，靠 hidden 控制）：${JSON.stringify(midDrag)}`,
    )
    check(
      Math.hypot(midDrag.markerX - dropAt2.x, midDrag.markerY - dropAt2.y) <= 20,
      `落点标记应跟着指针走：指针 ${JSON.stringify(dropAt2)}，标记 ${JSON.stringify({ x: midDrag.markerX, y: midDrag.markerY })}`,
    )
    const afterDrop2 = await session.evaluate(MARKER_STATE_EXPR)
    check(
      afterDrop2.canvasClass === classBefore,
      `drop 之后画布高亮类应还原，实得 ${JSON.stringify(afterDrop2.canvasClass)}`,
    )
    check(
      afterDrop2.markerHidden === true && afterDrop2.markerDisplay === 'none',
      `drop 之后落点标记应还原为不可见，实得 ${JSON.stringify(afterDrop2)}`,
    )
    const countAfter18 = await session.evaluate(nodeCountExpr)
    check(countAfter18 === 4, `第二次拖放后应有 4 个节点，实得 ${countAfter18}`)
    console.log(
      `  18 拖拽反馈 ok（dragOver：高亮 + 标记可见且跟手；drop：都还原；${shotRedesign.pathname.split('/').pop()} / drag-in-progress.png 已存）`,
    )

    /*
     * 19) 自定义 node：**平铺** + 分节折叠持久化
     *
     * 先往数据目录的 `templates/nodes/` 造四个模板（`exec-` 前缀三个 + 落单的 `solo`），
     * 再刷新页面让节点库重新拉一次 `graph/templates`。
     */
    await writeTemplateFixtures()
    await bootCanvas(session, NAME)
    /*
     * **二级分类已经被去掉了**（用户要求：「不需要有二级分类节点」）：模板直接平铺在
     * 「自定义 node」下面，不再有 `exec` / `其他` 这一层。
     *
     * 所以这一步断言两件事：四个模板条目都平铺出来了，而且**一个二级分组钩子都不存在**。
     * 后者才是这次改动的回归网——分组层要是哪天回来，这里立刻红。
     */
    const flatTemplates = await waitFor(
      session,
      `(() => {
         const items = [...document.querySelectorAll('[data-testid^="wl-item-template-"]')]
           .map((el) => el.getAttribute('data-testid'));
         return items.length === 4 ? items : 0;
       })()`,
      { timeoutMs: 20_000 },
    )
    check(
      flatTemplates.length === 4,
      `自造 4 个模板后应平铺出 4 个条目，实得 ${JSON.stringify(flatTemplates)}`,
    )
    const groupToggles = await session.evaluate(
      `[...document.querySelectorAll('[data-testid^="wl-group-toggle-"]')]
         .map((el) => el.getAttribute('data-testid'))`,
    )
    check(
      groupToggles.length === 0,
      `节点库不该再有任何二级分组钩子（用户要求去掉二级分类），实得 ${JSON.stringify(groupToggles)}`,
    )
    console.log(
      `  19a 自造模板平铺 + 无二级分组 ok（条目 ${flatTemplates.length} 个，分组钩子 ${groupToggles.length} 个）`,
    )

    /*
     * 19) 「自定义 node」分节折叠 + 持久化
     *
     * 原来这一步测的是**二级分组**（`exec` / `其他`）的折叠与持久化。用户要求去掉二级分类
     * 之后那一层没有主体了，所以把同样的语义挪到**分节**上：它仍然是"折叠表要跨刷新活下来"
     * 的回归网，而这件事第 5a 步只在「内置 node」上验过，自定义那一半此前没有覆盖。
     */
    const diskToggle = '[data-testid="wl-section-toggle-disk"]'
    const diskItem = '[data-testid="wl-item-template-exec-code"]'
    const diskExpanded = `document.querySelector('${diskToggle}')?.getAttribute('aria-expanded')`
    // 归一到「展开」：上一次跑留下的偏好可能就是折叠的，那不是产品的问题，但结论必须从干净状态出。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if ((await session.evaluate(diskExpanded)) === 'true') break
      await session.evaluate(clickTestIdExpr('wl-section-toggle-disk'))
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    check(
      (await session.evaluate(diskExpanded)) === 'true',
      '折叠测试前应能先把「自定义 node」分节展开',
    )
    await session.evaluate(clickTestIdExpr('wl-section-toggle-disk'))
    const diskCollapsed = await waitFor(
      session,
      `(() => {
         const toggle = document.querySelector('${diskToggle}');
         const item = document.querySelector('${diskItem}');
         return toggle && toggle.getAttribute('aria-expanded') === 'false' && item === null
           ? { expanded: 'false', itemGone: true }
           : 0;
       })()`,
    )
    check(diskCollapsed.itemGone === true, '折叠后该分节的模板条目应从 DOM 消失（不能只是 hidden）')
    // 刷新页面：canvas 重新挂载，折叠状态从 localStorage 读回来。
    await bootCanvas(session, NAME)
    // 刷新之后**等收敛**再读：`bootCanvas` 只保证图渲染出来了，节点库那一栏可能还是上一帧。
    const diskAfterReload = await readSettled(
      session,
      `(() => {
         const toggle = document.querySelector('${diskToggle}');
         return {
           expanded: toggle ? toggle.getAttribute('aria-expanded') : null,
           itemGone: document.querySelector('${diskItem}') === null,
           stored: localStorage.getItem('workflow-lite.palette.collapsed'),
         };
       })()`,
      (value) => value !== null && value.expanded === 'false' && value.itemGone === true,
    )
    check(
      diskAfterReload.expanded === 'false' && diskAfterReload.itemGone === true,
      `刷新后「自定义 node」应仍是折叠的（localStorage 持久化），实得 ${JSON.stringify(diskAfterReload)}`,
    )
    await session.evaluate(clickTestIdExpr('wl-section-toggle-disk'))
    await waitFor(session, `document.querySelector('${diskItem}') !== null`, {
      timeoutMs: 5_000,
    })
    console.log(`  19 自定义 node 分节折叠 + 持久化 ok（localStorage=${diskAfterReload.stored}）`)

    /*
     * 20) 「全部收起 / 全部展开」
     *
     * 按钮**常驻**，一次把**两个分节**都收起/展开。所以这里两边一起断言：
     * 收起时两个分节头的 `aria-expanded` 都是 false、六条内置与全部自定义条目都不在 DOM；
     * 展开时两个分节头都回到 true、条目都回来。
     *
     * 折叠表里只该有**两个分节键**：二级分类去掉之后，`disk:exec` / `disk:` 这类组键不再产生，
     * 这里顺带断言"一个分组钩子都不存在"（分组层要是回来，立刻红）。
     */
    const diskToggleSel = '[data-testid^="wl-group-toggle-disk"]'
    const sectionToggleSel = '[data-testid^="wl-section-toggle-"]'
    /* 二级分类去掉之后，折叠表只剩两个分节键（`disk:exec` / `disk:` 这类不再产生）。 */
    const collapseKeys = ['section:builtin', 'section:disk']
    await session.evaluate(clickTestIdExpr('wl-collapse-all'))
    const allCollapsed = await waitFor(
      session,
      `(() => {
         const sections = [...document.querySelectorAll('${sectionToggleSel}')];
         if (sections.length !== 2) return 0;
         const expanded = sections.filter((t) => t.getAttribute('aria-expanded') === 'true').length;
         const templates = document.querySelectorAll('[data-testid^="wl-item-template-"]').length;
         const builtin = document.querySelectorAll('[data-testid^="wl-item-preset-"]').length;
         const groups = document.querySelectorAll('${diskToggleSel}').length;
         if (expanded !== 0 || templates !== 0 || builtin !== 0 || groups !== 0) return 0;
         const stored = localStorage.getItem('workflow-lite.palette.collapsed') || '';
         const wanted = ${JSON.stringify(collapseKeys)};
         if (!wanted.every((key) => stored.includes(JSON.stringify(key)))) return 0;
         return {
           sections: sections.length,
           groups,
           builtin,
           templates,
           stored,
           /* 无字图标按钮：可读名在 aria-label 上，textContent 是空的。 */
           label: document.querySelector('[data-testid="wl-collapse-all"]')?.getAttribute('aria-label') || null,
         };
       })()`,
    )
    check(
      allCollapsed.label === '全部展开',
      `全部收起后按钮的可读名（aria-label）应变成「全部展开」，实得 ${JSON.stringify(allCollapsed.label)}`,
    )
    await session.evaluate(clickTestIdExpr('wl-collapse-all'))
    const allExpanded = await waitFor(
      session,
      `(() => {
         const sections = [...document.querySelectorAll('${sectionToggleSel}')];
         const toggles = [...document.querySelectorAll('${diskToggleSel}')];
         /* 二级分类去掉之后不该再有任何分组钩子；两个分节 + 0 个组才是对的。 */
         if (sections.length !== 2 || toggles.length !== 0) return 0;
         const expandedSections = sections.filter((t) => t.getAttribute('aria-expanded') === 'true').length;
         const expanded = toggles.filter((t) => t.getAttribute('aria-expanded') === 'true').length;
         const templates = document.querySelectorAll('[data-testid^="wl-item-template-"]').length;
         const builtin = document.querySelectorAll('[data-testid^="wl-item-preset-"]').length;
         if (expandedSections !== 2 || expanded !== toggles.length) return 0;
         if (templates !== ${TEMPLATE_FIXTURES.length} || builtin !== ${BUILTIN_IDS.length}) return 0;
         return {
           sections: sections.length,
           groups: toggles.length,
           builtin,
           items: templates,
           /* 无字图标按钮：可读名在 aria-label 上，textContent 是空的。 */
           label: document.querySelector('[data-testid="wl-collapse-all"]')?.getAttribute('aria-label') || null,
         };
       })()`,
    )
    check(
      allExpanded.label === '全部收起',
      `全部展开后按钮的可读名（aria-label）应回到「全部收起」，实得 ${JSON.stringify(allExpanded.label)}`,
    )
    console.log(
      `  20 全部收起 / 全部展开 ok（${allCollapsed.sections} 个分节一起收：收起时内置 ${allCollapsed.builtin} 项、自定义 ${allCollapsed.templates} 项都不在 DOM、分组钩子 ${allCollapsed.groups} 个，折叠表 ${allCollapsed.stored}；展开后回到内置 ${allExpanded.builtin} 项 + 自定义 ${allExpanded.items} 项）`,
    )

    /*
     * 21) 筛选：内置按「显示名 / preset id」平铺过滤，自定义按模板名过滤。
     *
     * 筛 `exec` 时内置六个一个都不该命中（它们的显示名与 preset id 里都没有 exec），
     * 自定义里只有 `exec-*` 三个命中（`solo` 不命中），零命中的「其他」组整组消失。
     */
    await setReactInput(session, '[data-testid="wl-library-filter"]', 'exec')
    const filtered = await waitFor(
      session,
      `(() => {
         const items = [...document.querySelectorAll('[data-testid^="wl-item-template-"]')]
           .map((el) => el.getAttribute('data-testid'));
         const wanted = ['wl-item-template-exec-code', 'wl-item-template-exec-test', 'wl-item-template-exec-lint'];
         const presets = document.querySelectorAll('[data-testid^="wl-item-preset-"]').length;
         if (items.length !== 3 || presets !== 0) return 0;
         return wanted.every((id) => items.includes(id)) ? items : 0;
       })()`,
      { timeoutMs: 5_000 },
    )
    check(
      filtered.length === 3,
      `筛选 exec 后应只剩 3 个自定义节点，实得 ${JSON.stringify(filtered)}`,
    )
    await setReactInput(session, '[data-testid="wl-library-filter"]', '')
    await waitFor(
      session,
      `document.querySelectorAll('[data-testid^="wl-item-"]').length === ${BUILTIN_IDS.length + TEMPLATE_FIXTURES.length}`,
      { timeoutMs: 5_000 },
    )
    console.log(
      `  21 筛选 ok（exec → ${filtered.length} 个自定义节点；清空后回到 ${BUILTIN_IDS.length + TEMPLATE_FIXTURES.length} 项）`,
    )

    // 22) 撤销 / 重做 + 「一次拖拽 = 一次撤销」的合并语义
    const canvasFocusPoint = {
      x: Math.round(geom16.canvas.x + 20),
      y: Math.round(geom16.canvas.y + geom16.canvas.h - 20),
    }
    const focusCanvas = async () => {
      const current = await session.evaluate(
        `document.activeElement?.getAttribute('data-testid') ?? ''`,
      )
      if (current !== 'wl-canvas') await mouseClick(session, canvasFocusPoint)
      check(
        (await session.evaluate(`document.activeElement?.getAttribute('data-testid') ?? ''`)) ===
          'wl-canvas',
        '快捷键只挂在画布容器的 keydown 上：焦点没进画布，Ctrl+Z 验不到',
      )
    }
    // 22a) 合并语义：拖一个**开图时就在**的节点（scan）——一次拖拽 = 一条历史，
    //      按一次 Ctrl+Z 必须整条退回，而不是退一帧。
    //      先验这条、再验"加节点 → 撤销 → 重做"，拖动就不依赖"刚重做出来的节点"。
    const boxDrag = await waitFor(session, nodeBoxExpr('scan'), { timeoutMs: 5_000 })
    check(boxDrag !== null && boxDrag.w > 0, '找不到 scan 节点卡（或它可见部分太小）')
    // 让 React Flow 把这张卡彻底量完、把拖拽绑定挂上。
    await new Promise((resolve) => setTimeout(resolve, 300))
    /*
     * 这里**曾经**有一段"拖拽前等上一次防抖写落定"的让开动作。
     *
     * 它绕的是一个真缺陷：保存成功会 `dispatch({type:'historyBreak'})`，于是那笔写只要落在
     * 拖拽中途，合并链就会被切断，一拖被拆成两条历史——一次 Ctrl+Z 只退得回中间某一帧
     * （实测停在第一帧位移上，8 次跑红了 2 次）。
     *
     * 产品侧已修：合并链该由"**一次交互结束**"来断（松手 / 失焦），不是由"恰好写了一次盘"来断。
     * 让开动作**已删除**——留着它就成了这条语义的遮羞布：D2 一旦复发，断言会照旧全绿。
     */
    /*
     * 命中自检**要等收敛**：节点刚挂载/刚插入时，React Flow 量完尺寸之前有一小段
     * `elementFromPoint` 会落到画布 pane 上的过渡态（实测几百毫秒，本文件第 31 步就逮到过）。
     * 拿过渡态判红是脚本在跟渲染时序较劲，不是产品坏了——所以轮询到命中卡片为止，
     * 超时则把**最后一次真实读数**交给下面的 check 出结论。
     */
    const pressHit = await readSettled(
      session,
      `(() => {
       const el = document.elementFromPoint(${boxDrag.head.x}, ${boxDrag.head.y});
       const canvasEl = document.querySelector('[data-testid="wl-canvas"]');
       const canvas = canvasEl ? canvasEl.getBoundingClientRect() : null;
       const node = document.querySelector('.react-flow__node[data-id="scan"]');
       const box = node ? node.getBoundingClientRect() : null;
       const geometry = {
         canvas: canvas ? { x: Math.round(canvas.left), y: Math.round(canvas.top), r: Math.round(canvas.right), b: Math.round(canvas.bottom) } : null,
         node: box ? { l: Math.round(box.left), t: Math.round(box.top), r: Math.round(box.right), b: Math.round(box.bottom) } : null,
         nodePresent: node !== null,
         nodes: [...document.querySelectorAll('.react-flow__node')].map((el) => el.getAttribute('data-id')),
       };
       if (!el) return { hit: 'nothing', ...geometry };
       const owner = el.closest('.react-flow__node');
       return {
         hit: { tag: el.tagName, cls: (el.className || '').toString().slice(0, 48), inNode: owner ? owner.getAttribute('data-id') : null, nodrag: el.closest('.nodrag') !== null },
         ...geometry,
       };
     })()`,
      (value) => value?.hit?.inNode === 'scan' && value?.hit?.nodrag === false,
      { timeoutMs: 3_000 },
    )
    check(
      pressHit.hit?.inNode === 'scan' && pressHit.hit?.nodrag === false,
      `按下点必须落在 scan 的卡片上（不然这一下按的是画布）：点 ${JSON.stringify(boxDrag.head)} 命中 ${JSON.stringify(pressHit.hit)}；画布 ${JSON.stringify(pressHit.canvas)}；节点 ${JSON.stringify(pressHit.node)}；当前节点 ${JSON.stringify(pressHit.nodes)}`,
    )
    const scanBefore = (await session.evaluate(nodeListExpr)).find((node) => node.id === 'scan')
    const viewportBefore = await session.evaluate(
      `getComputedStyle(document.querySelector('.react-flow__viewport')).transform`,
    )
    /*
     * 非侵入式时间线：盯着状态条的文字变化（`就绪 / 保存中 / 有未保存的改动`）。
     *
     * 为什么要盯它：保存成功会发一次 `historyBreak`（断开"一次拖拽 = 一条历史"的合并链）。
     * 如果**一次保存在拖拽中途落地**，合并链会在拖动过程中被断开，于是这一拖会被拆成两条
     * 历史，一次 Ctrl+Z 只退得回中间某一帧——断言红了但看不出为什么。这个时间线能把
     * "保存发生在拖动中"直接摆出来（只有观察者，没有定时器，不干扰被测行为）。
     */
    await session.evaluate(`(() => {
       const el = document.querySelector('[data-testid="wl-status"]');
       window.__wlStatusLog = el ? [[Math.round(performance.now()), (el.textContent || '').trim()]] : [];
       window.__wlStatusObs?.disconnect();
       if (!el) return false;
       const obs = new MutationObserver(() => {
         window.__wlStatusLog.push([Math.round(performance.now()), (el.textContent || '').trim()]);
       });
       obs.observe(el, { childList: true, characterData: true, subtree: true });
       window.__wlStatusObs = obs;
       window.__wlMark = (label) => window.__wlStatusLog.push([Math.round(performance.now()), label]);
       return true;
     })()`)
    await session.evaluate(`window.__wlMark('=== 按下 ===')`)
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: boxDrag.head.x,
      y: boxDrag.head.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    for (let step = 1; step <= 8; step += 1) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: boxDrag.head.x + step * 12,
        y: boxDrag.head.y + step * 8,
        button: 'left',
        buttons: 1,
      })
      await new Promise((resolve) => setTimeout(resolve, 24))
    }
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: boxDrag.head.x + 96,
      y: boxDrag.head.y + 64,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await new Promise((resolve) => setTimeout(resolve, 600))
    await session.evaluate(`window.__wlMark('=== 松开 600ms ===')`)
    const scanMoved = (await session.evaluate(nodeListExpr)).find((node) => node.id === 'scan')
    check(scanMoved !== undefined, '拖动后 scan 节点应还在')
    const movedBy = Math.hypot(scanMoved.x - scanBefore.x, scanMoved.y - scanBefore.y)
    const viewportAfter = await session.evaluate(
      `getComputedStyle(document.querySelector('.react-flow__viewport')).transform`,
    )
    check(
      movedBy > 30,
      `真鼠标拖动应真的移动了节点，实得位移 ${Math.round(movedBy)}px（节点卡 ${JSON.stringify({ w: boxDrag.w, h: boxDrag.h })}，视口 ${viewportBefore} → ${viewportAfter}；视口变了就说明这一下按到了画布上变成平移视图）`,
    )
    await focusCanvas()
    await session.evaluate(`window.__wlMark('=== Ctrl+Z 前 ===')`)
    await pressShortcut(session, 'z', ['ctrl'])
    await new Promise((resolve) => setTimeout(resolve, 400))
    const scanUndone = (await session.evaluate(nodeListExpr)).find((node) => node.id === 'scan')
    const statusTimeline = await session.evaluate(`(() => {
       window.__wlStatusObs?.disconnect();
       const log = window.__wlStatusLog || [];
       const base = log.length > 0 ? log[0][0] : 0;
       return log.map(([t, text]) => (t - base) + 'ms:' + text);
     })()`)
    check(
      scanUndone !== undefined &&
        Math.abs(scanUndone.x - scanBefore.x) <= 1.5 &&
        Math.abs(scanUndone.y - scanBefore.y) <= 1.5,
      `一次拖拽 = 一次撤销：一次 Ctrl+Z 应把 scan 送回拖动前 ${JSON.stringify({ x: scanBefore.x, y: scanBefore.y })}，实得 ${JSON.stringify(scanUndone)}；` +
        `拖动位移 ${movedBy.toFixed(2)}px（视口 ${viewportBefore} → ${viewportAfter}），状态条时间线 ${JSON.stringify(statusTimeline)}`,
    )

    // 22b) 加节点 → Ctrl+Z → 回原值 → Ctrl+Shift+Z → 又 +1
    const beforeUndo = await session.evaluate(nodeCountExpr)
    /*
     * 用**拖**加这个节点，不是点：条目点了不加节点（用户明确要求只能拖进画布），
     * 所以这条断言顺带证明「拖」是那条真能加进图里的路。
     */
    const reviewDropAt = await session.evaluate(`(() => {
       const r = document.querySelector('[data-testid="wl-canvas"]').getBoundingClientRect();
       return { x: Math.round(r.x + r.width * 0.32), y: Math.round(r.y + r.height * 0.74) };
     })()`)
    await dragItemTo(session, { itemTestId: 'wl-item-preset-review', to: reviewDropAt })
    await waitFor(
      session,
      `document.querySelectorAll('.react-flow__node').length === ${beforeUndo + 1}`,
      {
        timeoutMs: 5_000,
      },
    )
    await focusCanvas()
    await pressShortcut(session, 'z', ['ctrl'])
    await waitFor(
      session,
      `document.querySelectorAll('.react-flow__node').length === ${beforeUndo}`,
      {
        timeoutMs: 5_000,
      },
    )
    await focusCanvas()
    await pressShortcut(session, 'z', ['ctrl', 'shift'])
    await waitFor(
      session,
      `document.querySelector('.react-flow__node[data-id="review"]') !== null`,
      {
        timeoutMs: 5_000,
      },
    )
    const afterRedo = await session.evaluate(nodeCountExpr)
    check(
      afterRedo === beforeUndo + 1,
      `重做应把节点加回来（${beforeUndo} → ${beforeUndo + 1}），实得 ${afterRedo}`,
    )
    console.log(
      `  22 撤销 / 重做 + 合并语义 ok（scan 拖动 ${Math.round(movedBy)}px 后一次 Ctrl+Z 回到原位；加节点 ${beforeUndo}→${beforeUndo + 1}→${beforeUndo}→${afterRedo}；状态条时间线 ${JSON.stringify(statusTimeline)}）`,
    )

    // 23) 节点卡悬停操作簇：悬停出现、可点、点了就删（**不经过工具条**）
    const box23 = await session.evaluate(nodeBoxExpr('review'))
    await mouseMove(session, box23.center)
    const deleteButton = await waitFor(
      session,
      `(() => {
         const group = document.querySelector('[data-testid="wl-node-actions-review"]');
         if (!group) return 0;
         const style = getComputedStyle(group);
         if (style.opacity !== '1' || style.pointerEvents !== 'auto') return 0;
         const button = document.querySelector('[data-testid="wl-node-delete-review"]');
         if (!button) return 0;
         const box = button.getBoundingClientRect();
         return box.width > 0 ? { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2), opacity: style.opacity, pointerEvents: style.pointerEvents } : 0;
       })()`,
      { timeoutMs: 5_000 },
    )
    const beforeDelete23 = await session.evaluate(nodeCountExpr)
    await mouseClick(session, { x: deleteButton.x, y: deleteButton.y })
    await waitFor(
      session,
      `document.querySelector('.react-flow__node[data-id="review"]') === null`,
      {
        timeoutMs: 5_000,
      },
    )
    const afterDelete23 = await session.evaluate(nodeCountExpr)
    check(
      afterDelete23 === beforeDelete23 - 1,
      `卡片上的删除按钮应删掉一个节点（${beforeDelete23} → ${beforeDelete23 - 1}），实得 ${afterDelete23}`,
    )
    console.log(
      `  23 节点卡悬停删除 ok（悬停后 opacity=${deleteButton.opacity} pointerEvents=${deleteButton.pointerEvents}；${beforeDelete23} → ${afterDelete23}）`,
    )

    // 24) 复制节点：新 id 是 `<id>-2`
    const box24 = await session.evaluate(nodeBoxExpr('report'))
    check(box24 !== null, '找不到 report 节点卡')
    await mouseMove(session, box24.center)
    const duplicateButton = await waitFor(
      session,
      `(() => {
         const group = document.querySelector('[data-testid="wl-node-actions-report"]');
         if (!group || getComputedStyle(group).opacity !== '1') return 0;
         const button = document.querySelector('[data-testid="wl-node-duplicate-report"]');
         if (!button) return 0;
         const box = button.getBoundingClientRect();
         return box.width > 0 ? { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) } : 0;
       })()`,
      { timeoutMs: 5_000 },
    )
    const beforeDup = await session.evaluate(nodeCountExpr)
    await mouseClick(session, { x: duplicateButton.x, y: duplicateButton.y })
    await waitFor(
      session,
      `document.querySelector('.react-flow__node[data-id="report-2"]') !== null`,
      {
        timeoutMs: 5_000,
      },
    )
    const afterDup = await session.evaluate(nodeCountExpr)
    check(
      afterDup === beforeDup + 1,
      `复制应新增一个节点（${beforeDup} → ${beforeDup + 1}），实得 ${afterDup}`,
    )
    console.log(`  24 复制节点 ok（report → report-2；${beforeDup} → ${afterDup}）`)

    // 25) 点节点库条目**不加**节点（连点也不加），而"输入框新建"的两个节点**必须不重合**
    //
    // 前半条是用户明确要求的行为：「节点模板应当拖动进画布，而不是点击进画布」——条目是拖源，
    // 点它一下（或连点两下）都不该往图里加东西。这里反过来断言"什么都没发生"，
    // 哪天 `click` handler 又回来会立刻红。
    //
    // 后半条是独立审计 P3 的回归：由 `newPosition` 补位的两个节点不能逐像素重合。
    // 点条目不再产生"无落点添加"之后，这条路只剩"输入框敲个 id 回车"，所以那两个节点改从那儿建。
    //
    // 落点要**量完立刻验**：节点库那一栏会随"校验面板/计划"之类的内容重排，
    // 先量后点之间隔一次 React 渲染的话，点就可能落到邻居条目上（实测红过一次）。
    let fixPoint = null
    let fixHit = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      fixPoint = await centerOf(session, '[data-testid="wl-item-preset-fix"]')
      fixHit = await session.evaluate(`(() => {
         const el = document.elementFromPoint(${fixPoint.x}, ${fixPoint.y});
         if (!el) return { item: 'nothing' };
         const item = el.closest('[data-testid^="wl-item-"]');
         return { tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), item: item ? item.getAttribute('data-testid') : null };
       })()`)
      if (fixHit.item === 'wl-item-preset-fix') break
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    check(
      fixHit.item === 'wl-item-preset-fix',
      `连点的落点必须压在 fix 条目上（不然点出来的是别的东西）：点 ${JSON.stringify(fixPoint)} 命中 ${JSON.stringify(fixHit)}`,
    )
    const beforeFix = await session.evaluate(nodeCountExpr)
    await mouseClick(session, fixPoint)
    await mouseClick(session, fixPoint)
    /*
     * 点完**等一拍**再读：React 提交节点不在同一个事件循环里，立刻读会把"还没提交"当成
     * "没加"——这里等的是**负结果**，不能只轮询一次就下结论（那会假绿）。
     */
    await new Promise((resolve) => setTimeout(resolve, 600))
    const afterClicks = await session.evaluate(nodeCountExpr)
    check(
      afterClicks === beforeFix,
      `点节点库条目不该往图里加节点（连点两次也不该）：${beforeFix} → 实得 ${afterClicks}`,
    )
    /*
     * 那两个 fix 系节点改从**输入框**新建。输入同一个名字两次，`uniqueNodeId` 给出 fix 与 fix-2。
     * 提交时机是回车（见第 28 步），所以这里敲完就回一次车。
     */
    const blankInputSel = '[data-testid="wl-new-node-input"]'
    for (let index = 0; index < 2; index += 1) {
      await session.evaluate(`document.querySelector(${JSON.stringify(blankInputSel)}).focus()`)
      await setReactInput(session, blankInputSel, 'fix')
      await pressKey(session, 'Enter', { text: '\r' })
    }
    await waitFor(
      session,
      `document.querySelectorAll('.react-flow__node').length === ${beforeFix + 2}`,
      {
        timeoutMs: 5_000,
      },
    )
    const fixNodes = (await session.evaluate(nodeListExpr)).filter(
      (node) => node.id === 'fix' || node.id.startsWith('fix-'),
    )
    check(
      fixNodes.length === 2,
      `连点两次应得到两个 fix 系节点，实得 ${JSON.stringify(fixNodes)}（全部 ${JSON.stringify((await session.evaluate(nodeListExpr)).map((n) => n.id))}）`,
    )
    const twoFixes = {
      first: fixNodes[0],
      second: fixNodes[1],
      distance: Math.hypot(fixNodes[0].x - fixNodes[1].x, fixNodes[0].y - fixNodes[1].y),
    }
    /*
     * 诊断用（红了要能一眼区分"产品坏了"与"脚本算错了"）：此刻的视口、画布尺寸，
     * 以及补位算法拿到的每轴上限 = 半宽/半高 ÷ zoom − 半张卡（实现在 CanvasView.newPosition）。
     * 环步长是 260/140 ⇒ 上限一旦小于 260，非零的 x 槽位全被拒，避让就退化成"永远放中心"。
     */
    const geom25 = await readGeometry(session, '25')
    const limit25 = {
      x: Math.round(geom25.canvas.w / (2 * geom25.viewport.zoom) - 112),
      y: Math.round(geom25.canvas.h / (2 * geom25.viewport.zoom) - 48),
    }
    const allPositions = (await session.evaluate(nodeListExpr)).map(
      (node) => `${node.id}@${node.x},${node.y}`,
    )
    /*
     * 25a) 新节点**必须完整落在画布可见区内**：卡片 `getBoundingClientRect()` 的四条边都要
     *      在 `[data-testid="wl-canvas"]` 的矩形里。上轮红过一次的正是"越界 29px、标题被裁、
     *      那半截点不到"——越界量按左/上/右/下四个方向分别报出来，失败时不用再猜。
     *      （子像素上留 0.5px 容差：`getBoundingClientRect` 是浮点，边界上差 1e-13 不该判红。）
     *
     * 先验这条、再验"不重合"：两条都红了要能一次看全（这条失败不会挡住另一条的结论）。
     */
    const fixBoxesExpression = `(() => {
       const canvas = document.querySelector('[data-testid="wl-canvas"]');
       if (!canvas) return null;
       const frame = canvas.getBoundingClientRect();
       const round = (n) => Math.round(n * 10) / 10;
       const ids = ${JSON.stringify(fixNodes.map((node) => node.id))};
       return {
         canvas: { left: round(frame.left), top: round(frame.top), right: round(frame.right), bottom: round(frame.bottom) },
         nodes: ids.map((id) => {
           const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(id) + ']');
           if (!el) return { id, missing: true };
           const box = el.getBoundingClientRect();
           const over = {
             left: Math.max(0, frame.left - box.left),
             top: Math.max(0, frame.top - box.top),
             right: Math.max(0, box.right - frame.right),
             bottom: Math.max(0, box.bottom - frame.bottom),
           };
           const point = document.elementFromPoint(
             Math.round(box.left + box.width / 2),
             Math.round(box.top + box.height / 2),
           );
           const owner = point ? point.closest('.react-flow__node') : null;
           return {
             id,
             box: { left: round(box.left), top: round(box.top), right: round(box.right), bottom: round(box.bottom) },
             over: { left: round(over.left), top: round(over.top), right: round(over.right), bottom: round(over.bottom) },
             inside:
               over.left <= 0.5 && over.top <= 0.5 && over.right <= 0.5 && over.bottom <= 0.5,
             hit: owner ? owner.getAttribute('data-id') : null,
           };
         }),
       };
     })()`
    /*
     * `hit`（卡片中心能不能点中它自己）**只作证据、不作断言**：刚插进来的节点在 React Flow
     * 量完尺寸之前有一小段命中测试还落在 pane 上的过渡态（实测约几百毫秒），拿它判红会是脚本
     * 自己在跟过渡态较劲。但既然要报，就等到收敛再报——`readSettled` 超时不抛，读数仍是真值。
     */
    const fixBoxes = await readSettled(
      session,
      fixBoxesExpression,
      (value) => value?.nodes.every((info) => info.hit === info.id) === true,
      { timeoutMs: 2_500 },
    )
    check(fixBoxes !== null, '读不到 wl-canvas 的矩形，没法判定新节点有没有越界')
    for (const info of fixBoxes.nodes) {
      check(
        info.missing !== true && info.inside === true,
        `新建出来的 ${info.id} 必须完整落在画布可见区内：节点 ${JSON.stringify(info.box)}，画布 ${JSON.stringify(fixBoxes.canvas)}，越界（左/上/右/下）${JSON.stringify(info.over)}px`,
      )
    }
    console.log(
      `  25a 新节点完整落在画布可见区内 ok（四边越界 ${JSON.stringify(fixBoxes.nodes.map((info) => info.over))}；中心命中 ${JSON.stringify(fixBoxes.nodes.map((info) => info.hit))}）`,
    )
    check(
      fixNodes[0].id !== fixNodes[1].id,
      `先后新建的两个节点 id 不该相同，实得 ${JSON.stringify(fixNodes.map((n) => n.id))}`,
    )
    check(
      twoFixes.distance > 20,
      `先后新建的两个节点不能重合：${fixNodes[0].id}=${JSON.stringify(twoFixes.first)} ${fixNodes[1].id}=${JSON.stringify(twoFixes.second)}（间距 ${Math.round(twoFixes.distance)}px）；` +
        `此刻 zoom=${geom25.viewport.zoom.toFixed(3)} 画布=${Math.round(geom25.canvas.w)}×${Math.round(geom25.canvas.h)}（可见 flow 区 ${Math.round(geom25.canvas.w / geom25.viewport.zoom)}×${Math.round(geom25.canvas.h / geom25.viewport.zoom)}），` +
        `补位的每轴上限=${JSON.stringify(limit25)}（环步长 260/140），全部节点=${JSON.stringify(allPositions)}`,
    )
    const idsAfter25 = (await session.evaluate(nodeListExpr)).map((node) => node.id).sort()
    console.log(
      `  25b 点不加 / 新建不叠 ok（${fixNodes[0].id} 与 ${fixNodes[1].id} 间距 ${Math.round(twoFixes.distance)}px；此刻画布上 ${JSON.stringify(idsAfter25)}）`,
    )

    // 26) 键盘：Esc 取消选中；`/` 聚焦筛选框
    const scanBox = await waitFor(session, nodeBoxExpr('scan'), { timeoutMs: 5_000 })
    check(scanBox !== null, '找不到 scan 节点卡（或它可见部分太小）')
    await mouseClick(session, scanBox.center)
    await waitFor(session, `document.querySelectorAll('.react-flow__node.selected').length === 1`, {
      timeoutMs: 5_000,
    })
    await pressKey(session, 'Escape')
    await waitFor(session, `document.querySelectorAll('.react-flow__node.selected').length === 0`, {
      timeoutMs: 5_000,
    })
    await focusCanvas()
    await pressKey(session, '/', { code: 'Slash', text: '/' })
    await waitFor(
      session,
      `document.activeElement?.getAttribute('data-testid') === 'wl-library-filter'`,
      { timeoutMs: 5_000 },
    )
    console.log('  26 键盘 ok（Esc 取消选中；/ 聚焦到 wl-library-filter）')

    // 27) 空图的空态可操作
    const emptyRendered = await selectGraph(session, EMPTY_NAME)
    check(
      emptyRendered === 1,
      `空图应渲染空态（没有节点、但有可操作的按钮），实得 ${emptyRendered}`,
    )
    const emptyAction = await session.evaluate(
      `(() => {
         const el = document.querySelector('[data-testid="wl-empty-action"]');
         if (!el) return null;
         const box = el.getBoundingClientRect();
         const style = getComputedStyle(el);
         return {
           disabled: el.disabled === true,
           pointerEvents: style.pointerEvents,
           w: Math.round(box.width),
           h: Math.round(box.height),
           x: Math.round(box.left + box.width / 2),
           y: Math.round(box.top + box.height / 2),
         };
       })()`,
    )
    check(
      emptyAction !== null &&
        emptyAction.disabled === false &&
        emptyAction.pointerEvents !== 'none' &&
        emptyAction.w > 0,
      `空图上应有可点的「新建空白节点」，实得 ${JSON.stringify(emptyAction)}`,
    )
    await mouseClick(session, { x: emptyAction.x, y: emptyAction.y })
    await waitFor(
      session,
      `document.activeElement?.getAttribute('data-testid') === 'wl-new-node-input'`,
      { timeoutMs: 5_000 },
    )
    console.log(`  27 空图空态可操作 ok（点按钮后焦点到 wl-new-node-input）`)

    // 28) 非法 id（含空格）只能就地红字，**不能把整张图打进只读错误态**（独立审计 P1）
    await selectGraph(session, NAME)
    //
    // 先等节点数**收敛**再立基线：`selectGraph` 只保证"选中了这张图"，DOM 还在换帧时读到的是
    // 中间态（实测同一脚本两次跑分别读到 4 和 5）。基线不收敛，"节点数没变"这条就只是两次
    // 中间态相等，说明不了任何事——顺带把 id 清单打出来，红了能看出是哪一张图的内容。
    const beforeInvalidIds = await waitFor(
      session,
      `(() => {
         const ids = [...document.querySelectorAll('.react-flow__node')].map((el) => el.getAttribute('data-id')).sort();
         return ids.length > 0 ? ids : 0;
       })()`,
      { timeoutMs: 10_000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 250))
    const beforeInvalidSettled = await session.evaluate(
      `[...document.querySelectorAll('.react-flow__node')].map((el) => el.getAttribute('data-id')).sort()`,
    )
    if (beforeInvalidSettled.length !== beforeInvalidIds.length) {
      console.log(
        `  28 提示：选图后节点数仍在变（${beforeInvalidIds.length} → ${beforeInvalidSettled.length}），已多等一帧再立基线`,
      )
    }
    const beforeInvalid = beforeInvalidSettled.length
    /*
     * **断言**（原本只是诊断）：切图不许丢掉未落盘的改动。
     *
     * 这条守的是一个真缺陷：改一下 → 400ms 防抖窗口内切走 → 那次改动**无声消失**
     * （磁盘与画布一起回退到上一次保存的样子，状态还显示"就绪"）。第 25→27→28 步
     * 正好落在这个窗口里，所以以前每跑一轮都会丢两三个节点；产品侧修法是
     * `open()` 换图前把待写的改动冲掉（`flushBeforeSwitch`）。
     *
     * 只断言"没丢"这一个方向：反方向（画布上多出节点）不代表数据丢失，
     * 而且可能来自磁盘版本与本地版本的正常合并，不适合钉死。
     */
    const diskBeforeInvalid = await rpc('graph/load', { name: NAME })
      .then((loaded) => loaded.document.nodes.map((node) => node.id).sort())
      .catch(() => null)
    const lostAfterSwitch = idsAfter25.filter((id) => !beforeInvalidSettled.includes(id))
    const returnedAfterSwitch = beforeInvalidSettled.filter((id) => !idsAfter25.includes(id))
    check(
      lostAfterSwitch.length === 0,
      `切图不能丢掉未落盘的改动（少了 ${JSON.stringify(lostAfterSwitch)}）：` +
        `画布 ${JSON.stringify(beforeInvalidSettled)} vs 第 25 步 ${JSON.stringify(idsAfter25)}`,
    )
    console.log(
      `  28a 切图不丢改动 ok（画布 ${JSON.stringify(beforeInvalidSettled)}；磁盘 ${JSON.stringify(diskBeforeInvalid)}；多出 ${JSON.stringify(returnedAfterSwitch)}）`,
    )
    await session.evaluate(`document.querySelector('[data-testid="wl-new-node-input"]').focus()`)
    await setReactInput(session, '[data-testid="wl-new-node-input"]', 'bad id')
    await pressKey(session, 'Enter', { text: '\r' })
    const invalidState = await waitFor(
      session,
      `(() => {
         const input = document.querySelector('[data-testid="wl-new-node-input"]');
         if (!input) return 0;
         const alert = document.querySelector('[data-testid="wl-library"] [role="alert"]');
         const inputBox = input.getBoundingClientRect();
         const alertBox = alert ? alert.getBoundingClientRect() : null;
         const banner = document.querySelector('[class*="bannerDanger"]');
         const status = document.querySelector('[data-testid="wl-status"]');
         return {
           ariaInvalid: input.getAttribute('aria-invalid'),
           alertText: alert ? (alert.textContent || '').trim() : null,
           alertBelow: alertBox ? alertBox.top >= inputBox.bottom - 2 : false,
           nodes: document.querySelectorAll('.react-flow__node').length,
           ids: [...document.querySelectorAll('.react-flow__node')].map((el) => el.getAttribute('data-id')).sort(),
           dangerBanner: banner !== null,
           statusText: status ? (status.textContent || '').trim() : null,
         };
       })()`,
      { timeoutMs: 5_000 },
    )
    check(
      invalidState.ariaInvalid === 'true',
      `非法 id 应让输入框 aria-invalid=true，实得 ${JSON.stringify(invalidState)}`,
    )
    check(
      typeof invalidState.alertText === 'string' &&
        invalidState.alertText.length > 0 &&
        invalidState.alertBelow === true,
      `非法 id 应在输入框**下方**就地给出红字（role=alert），实得 ${JSON.stringify(invalidState)}`,
    )
    check(
      invalidState.nodes === beforeInvalid && invalidState.nodes > 0,
      `非法 id 绝不能打死画布：节点数应保持 ${beforeInvalid}（${JSON.stringify(beforeInvalidSettled)}），实得 ${JSON.stringify(invalidState)}`,
    )
    check(
      invalidState.dangerBanner === false && !(invalidState.statusText ?? '').includes('只读'),
      `非法 id 不该进入只读错误态（红横幅 / 状态「只读」），实得 ${JSON.stringify(invalidState)}`,
    )
    await setReactInput(session, '[data-testid="wl-new-node-input"]', '')
    console.log(
      `  28 非法 id 就地红字、画布仍在 ok（aria-invalid=true，节点数仍 ${invalidState.nodes}${JSON.stringify(invalidState.ids)}，无红横幅、状态=${JSON.stringify(invalidState.statusText)}）`,
    )

    // 29) 边有箭头：fail 边与回边的 marker-end 非空、箭头描边不是 none、回边虚线
    await selectGraph(session, EDGES_NAME)
    /*
     * 换图后等边数收敛。断言本身没变（7 条），但**超时的那一刻要留下现场**：
     * 这条偶发红过（`selectGraph` 只等到"选择器的值是新图 + 画布上有节点"，那两件事
     * 在旧图的 DOM 还在时也可能成立），红了只有 `last=false` 就什么都看不出来。
     */
    try {
      await waitFor(session, `document.querySelectorAll('.react-flow__edge').length === 7`, {
        timeoutMs: 10_000,
      })
    } catch (error) {
      const scene = await session.evaluate(
        `(() => {
           const trigger = document.querySelector('[data-testid="wl-graph-trigger"]');
           const groups = [...document.querySelectorAll('.react-flow__edge')];
           const status = document.querySelector('[data-testid="wl-status"]');
           const banner = document.querySelector('[class*="banner"]');
           const pane = document.querySelector('.react-flow');
           const edgesLayer = document.querySelector('.react-flow__edges');
           const paneBox = pane ? pane.getBoundingClientRect() : null;
           return {
             graph: trigger ? (trigger.textContent || '').trim() : null,
             edges: groups.length,
             edgeIds: groups.map((group) => group.getAttribute('data-id')),
             nodes: [...document.querySelectorAll('.react-flow__node')].map((node) => node.getAttribute('data-id')),
             handles: document.querySelectorAll('.react-flow__handle').length,
             edgesLayerTags: edgesLayer ? edgesLayer.childElementCount : null,
             edgesLayerHead: edgesLayer ? edgesLayer.innerHTML.slice(0, 300) : null,
             pane: paneBox ? { w: Math.round(paneBox.width), h: Math.round(paneBox.height) } : null,
             status: status ? (status.textContent || '').trim() : null,
             banner: banner ? (banner.textContent || '').trim().slice(0, 120) : null,
             inspector: (document.querySelector('[data-testid="wl-inspector"]') ? 'yes' : 'no'),
             /*
              * 未选中节点时右栏是整图概览，里面的「边」计数就是**客户端内存里那份文档**的
              * 边数。它和上面的 edges 字段（画布上真渲染出来的）一比，就能把
              * 文档里没有边 与 有边但没渲染 分开。
              */
             summary: (() => {
               const el = document.querySelector('[data-testid="wl-graph-summary"]');
               return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null;
             })(),
             inspectorHead: (() => {
               const el = document.querySelector('[data-testid="wl-inspector"]');
               return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) : null;
             })(),
           };
         })()`,
      )
      // 连续采样：确认这不是"晚一拍就出来"的过渡态。
      const samples = []
      for (let i = 0; i < 8; i += 1) {
        samples.push(
          await session.evaluate(`document.querySelectorAll('.react-flow__edge').length`),
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      const onDisk = await rpc('graph/load', { name: EDGES_NAME })
        .then((loaded) => ({
          nodes: loaded.document.nodes.length,
          edges: loaded.document.edges.length,
          ids: loaded.document.edges.map((edge) => edge.id),
        }))
        .catch((error) => ({ failed: String(error) }))
      throw new Error(
        `${error.message}\n换图现场：${JSON.stringify(scene)}\n连续采样：${JSON.stringify(samples)}\n磁盘上的图：${JSON.stringify(onDisk)}`,
      )
    }
    const edges = await session.evaluate(
      `(() => ({
         fail: ${edgeInfoExpr('plan1->fix1#fail')},
         pass: ${edgeInfoExpr('plan1->build1#pass')},
         loop: ${edgeInfoExpr('build1->check1')},
         back: ${edgeInfoExpr('check1->build1')},
         entry: ${edgeInfoExpr('plan1->retry1#fail')},
         retry: ${edgeInfoExpr('retry1->retry2')},
         failBack: ${edgeInfoExpr('retry2->retry1#fail')},
       }))()`,
    )
    for (const [name, info] of Object.entries(edges)) {
      check(info.missing === undefined, `${name} 边没渲染出来：${JSON.stringify(info)}`)
      check(
        typeof info.markerEnd === 'string' && info.markerEnd.includes('url('),
        `${name} 边的 .react-flow__edge-path 应有 marker-end，实得 ${JSON.stringify(info.markerEnd)}`,
      )
      check(
        info.markerFound === true &&
          typeof info.arrowStroke === 'string' &&
          info.arrowStroke !== 'none',
        `${name} 边的箭头 polyline 描边应解析出来不是 none，实得 ${JSON.stringify({ markerFound: info.markerFound, arrowStroke: info.arrowStroke })}`,
      )
    }
    check(
      edges.fail.dash === 'none' || edges.fail.dash === '',
      `fail 边不该是虚线（虚线是回边的语义），实得 ${JSON.stringify(edges.fail.dash)}`,
    )
    check(
      edges.back.dash !== 'none' && edges.back.dash !== '',
      `回边（check1→build1，环里指向入口的那条）的 stroke-dasharray 应非空，实得 ${JSON.stringify(edges.back.dash)}`,
    )
    check(
      (edges.loop.dash === 'none' || edges.loop.dash === '') && edges.pass.dash === 'none',
      `同一环里的**顺边**不该被画成虚线：build1→check1 ${JSON.stringify(edges.loop.dash)}、plan1→build1#pass ${JSON.stringify(edges.pass.dash)}`,
    )
    check(
      edges.fail.stroke !== edges.back.stroke,
      `fail 边（危险色）与回边（普通描边）的 stroke 应不同：fail=${JSON.stringify(edges.fail.stroke)} back=${JSON.stringify(edges.back.stroke)}`,
    )
    /*
     * 29b) **既是 `when:'fail'` 又是回边**的那条（第二组环里的 retry2→retry1#fail）。
     *
     * 两条语气各管一个 CSS 属性——虚线管 `stroke-dasharray`、危险色管 `stroke`——所以它们
     * 必须**同时**成立。旧实现是 `back ? edgeBack : fail ? edgeFail : edge` 三选一，
     * 回边赢 ⇒ 这条边只有虚线、没有红色；而"fail 就回退重试"恰好是最常见的闭环写法。
     *
     * 先钉住它**真的被算法判成回边**（否则这条断言就退化成"又测了一遍普通 fail 边"），
     * 再验两类样式同时成立；危险色以**同一张图上的普通 fail 边**为基准比，不写死色值。
     */
    check(
      edges.failBack.dash !== 'none' && edges.failBack.dash !== '',
      `fail+回边 的 stroke-dasharray 应非空（它是环上指向入口的那条）：实得 ${JSON.stringify(edges.failBack.dash)}，类名 ${JSON.stringify(edges.failBack.groupClass)}`,
    )
    check(
      edges.failBack.stroke === edges.fail.stroke,
      `fail+回边 应保留危险色（与普通 fail 边同色），实得 ${JSON.stringify(edges.failBack.stroke)} ≠ ${JSON.stringify(edges.fail.stroke)}`,
    )
    check(
      edges.failBack.stroke !== edges.pass.stroke && edges.failBack.stroke !== edges.back.stroke,
      `fail+回边 不能被回边样式吃掉颜色（不能退回普通描边色）：failBack=${JSON.stringify(edges.failBack.stroke)} pass=${JSON.stringify(edges.pass.stroke)} back=${JSON.stringify(edges.back.stroke)}`,
    )
    check(
      edges.failBack.arrowStroke === edges.fail.stroke,
      `fail+回边 的箭头也应是危险色（markerEnd 的 color 走的是 fail 分支）：arrow=${JSON.stringify(edges.failBack.arrowStroke)}`,
    )
    check(
      edges.entry.dash === 'none' || edges.entry.dash === '',
      `环外入口那条 plan1→retry1#fail 是顺边，不该是虚线：实得 ${JSON.stringify(edges.entry.dash)}`,
    )
    console.log(
      `  29 边箭头 ok（fail 边 stroke=${edges.fail.stroke} dash=${edges.fail.dash}；回边 stroke=${edges.back.stroke} dash=${edges.back.dash}；箭头 stroke=${edges.fail.arrowStroke}）`,
    )
    console.log(
      `  29b fail+回边 语气叠加 ok（retry2→retry1#fail：dash=${edges.failBack.dash} stroke=${edges.failBack.stroke}（= 普通 fail 边，≠ 普通回边 ${edges.back.stroke}）；类名含 edgeBack=${edges.failBack.groupClass.includes('edgeBack')} edgeFail=${edges.failBack.groupClass.includes('edgeFail')}）`,
    )

    /*
     * 29c) 交互改版的回归钉（两处独立的东西一次钉完，都在 EDGES_NAME 这张图上）。
     *
     *  1. **画布边标签的底**：`.react-flow__edge-textbg` 是 `@xyflow/react` 自带的
     *     `fill: #fff`，我们只改过文字色，于是深色画布上每条带 `when` 的边旁边都垫着
     *     一块小白板。断言它的**计算 `fill` 不是白色**（拿 `rgb(255, 255, 255)` 比）。
     *  2. **交互改版后的六条**（用户看过右栏那两块之后定的："交互逻辑太差、界面太小；
     *     点击入边出边的时候，不要切换节点啊。点击图中的时候切换就好"）：
     *     - 29c-1 右栏那一行**只读**：不是按钮、里面无可交互元素，点它选中态不变；
     *     - 29c-2 画布上点边（用真实路径的中点）就能选中，右栏换成边编辑区、节点选中被清；
     *     - 29c-3 条件点选（fail / 无条件）真的写进文档（回读 `graph/load` 看边 id）；
     *     - 29c-4 自定义条件能**连续输入**并回车提交（那个"只能敲进一个字符"的 bug 的回归网）；
     *     - 29c-5 边行不截断：「显示名（id）」的 `scrollWidth <= clientWidth + 1`（两档右栏宽度各量一次：
     *       1440px 视口的 320px 与 1100px 视口的 272px，都跑 `assertEdgeRows`）；
     *     - 29c-6 `interactionWidth` 真的把边变好点：离描边 12 个画布单位（默认 20 的半宽只有 ±10）仍能选中。
     */
    const labelBg = await session.evaluate(
      `(() => {
         const el = document.querySelector('.react-flow__edge-textbg');
         if (!el) return null;
         const style = getComputedStyle(el);
         const box = el.getBoundingClientRect();
         return { fill: style.fill, stroke: style.stroke, w: Math.round(box.width), h: Math.round(box.height) };
       })()`,
    )
    check(
      labelBg !== null,
      'EDGES_NAME 上有带 when 的边，画布上就该渲染出 .react-flow__edge-textbg',
    )
    check(
      labelBg.fill !== 'rgb(255, 255, 255)',
      `边标签的底不该还是 @xyflow 自带的白（深色画布上就是一块白板）：实得 ${JSON.stringify(labelBg)}`,
    )
    check(
      labelBg.stroke !== 'none' && labelBg.stroke !== '',
      `边标签的底应有一圈描边，让它读起来是一枚小标签：实得 ${JSON.stringify(labelBg)}`,
    )

    // 选中一个有入边（带 when）又有出边的节点，右栏才会列出边行。
    let edgeRowNode = null
    for (const candidate of ['retry1', 'build1', 'plan1', 'check1', 'retry2', 'fix1']) {
      const box = await session.evaluate(nodeBoxExpr(candidate))
      if (box !== null) {
        await mouseClick(session, box.center)
        edgeRowNode = candidate
        break
      }
    }
    check(edgeRowNode !== null, 'EDGES_NAME 里点不到任何节点卡，右栏边行这条验不到')
    /*
     * 边清单现在**默认收起**：右栏降密改成「节点 / 计划」两个页签之后，入/出边收成一行摘要
     *（`上游 N · 下游 M`），点开才把行放进 DOM。所以先把它展开再量——下面的断言一个字不改，
     * 仍然是"行不是按钮、不截断、点了选中态不变"。
     */
    const edgesToggled = await session.evaluate(`(() => {
       const el = document.querySelector('[data-testid="wl-edges-toggle"]');
       if (!(el instanceof HTMLElement)) return 'no-toggle';
       if (el.getAttribute('aria-expanded') !== 'true') el.click();
       return 'clicked';
     })()`)
    check(
      edgesToggled === 'clicked',
      `29c-1: 选中 ${edgeRowNode} 后应有一行边摘要开关，实得 ${JSON.stringify(edgesToggled)}`,
    )
    /*
     * 点完**不能**立刻读 `aria-expanded`：那是 React 的状态，重渲染不在同一个事件循环里，
     * 同步读回来必定还是点击前的 `false`（第一版就是这么假红的）。轮询到它真的翻开。
     */
    const expanded = await waitFor(
      session,
      `(() => {
         const el = document.querySelector('[data-testid="wl-edges-toggle"]');
         return el !== null && el.getAttribute('aria-expanded') === 'true' ? 1 : 0;
       })()`,
      { timeoutMs: 5_000 },
    )
    check(expanded === 1, '29c-1: 展开边摘要之后 aria-expanded 应为 true')
    await waitFor(
      session,
      `document.querySelectorAll('[data-testid="wl-inspector"] [class*="edgeRow"]').length > 0`,
      { timeoutMs: 5_000 },
    )
    // 行是 `useEffect` 里补上 `otherLabel` 之后才定型的，等一帧再量，别量到中间态。
    await new Promise((resolve) => setTimeout(resolve, 250))

    /** 量一次右栏边行，并逐条断言（两档宽度共用）。 */
    const assertEdgeRows = async (label) => {
      const probe = await session.evaluate(EDGE_ROW_PROBE)
      check(
        probe !== null && probe.rows.length > 0,
        `${label}: 选中 ${edgeRowNode} 后右栏应有边行，实得 ${JSON.stringify(probe)}`,
      )
      for (const row of probe.rows) {
        // 1) 只读：不是按钮、里面没有任何可交互元素，也没有可点的光标。
        check(
          row.tagName !== 'BUTTON' && row.buttons === 0,
          `${label}: 出入边行应该是只读信息（用户要求"点行什么都不做"），实得 ${JSON.stringify(row)}`,
        )
        check(
          row.cursor !== 'pointer',
          `${label}: 出入边行不该有可点的指针光标：${JSON.stringify(row)}`,
        )
        // 2) 不截断：`显示名（id）` 那一格的滚动宽度不能超过可见宽度。
        check(
          row.nameScroll !== null &&
            row.nameClient !== null &&
            row.nameScroll <= row.nameClient + 1,
          `${label}: 「显示名（id）」被截断了（scrollWidth ${row.nameScroll} > clientWidth ${row.nameClient}）：${JSON.stringify(row)}`,
        )
        check(
          typeof row.name === 'string' && /（.+）$/.test(row.name),
          `${label}: 边行应写「显示名（id）」（与画布卡片同一口径），实得 ${JSON.stringify(row.name)}`,
        )
        // 3) 条件那一格是可见文字（空值写「无条件」），且不溢出右栏。
        check(
          typeof row.whenLabel === 'string' && row.whenLabel.length > 0,
          `${label}: 边行应有可见的「条件 <值>」：${JSON.stringify(row)}`,
        )
        check(
          row.whenRight !== null && row.whenRight <= probe.inspector.right + 0.5,
          `${label}: 条件那一格被挤出右栏了（右栏 right=${probe.inspector.right}，条件 right=${row.whenRight}）：${JSON.stringify(row)}`,
        )
        // 回边标记：可见文字很短，完整说明（「回边（循环中返回）」）挂在 title 上。
        if (row.back !== null) {
          check(
            typeof row.backTitle === 'string' && row.backTitle.length > row.back.length,
            `${label}: 回边小标的 title 应是完整说明：${JSON.stringify(row)}`,
          )
        }
      }
      return probe
    }

    const wideRows = await assertEdgeRows('29c 宽右栏（1440px 视口 / 右栏 320px）')
    // 留一张图：画布上的边标签（不再是白板）与右栏那几行同框。
    await takeScreenshot(session, 'edge-rows.png')
    // 换到最窄的那一档再量一次：`max-width: 1180px` 会把右栏收到 272px。
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    const narrowRows = await assertEdgeRows('29c 窄右栏（1100px 视口 / 右栏 272px）')
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await new Promise((resolve) => setTimeout(resolve, 300))

    /*
     * 29c-1) 右栏那一行**点下去什么都不发生**（用户明确要求"只能从画布点边"）。
     *
     * 两条独立证据：① 行本身不是按钮、里面一个可交互元素都没有（`assertEdgeRows` 里验）；
     * ② 真指针点行中心之后，画布上的选中节点与右栏标题、边编辑区都没变。
     */
    const rowPoint = await session.evaluate(`(() => {
       const row = document.querySelector('[data-testid="wl-inspector"] [class*="edgeRow"]');
       if (!row) return null;
       const box = row.getBoundingClientRect();
       return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
     })()`)
    check(rowPoint !== null, '29c-1: 找不到右栏边行，点行这条验不到')
    const selectionBefore = await session.evaluate(SELECTION_PROBE)
    check(
      selectionBefore.node === edgeRowNode && selectionBefore.edgeInspector === false,
      `29c-1: 点行之前应当选中节点 ${edgeRowNode} 且没有边编辑区：${JSON.stringify(selectionBefore)}`,
    )
    await mouseClick(session, rowPoint)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const selectionAfter = await session.evaluate(SELECTION_PROBE)
    check(
      selectionAfter.node === selectionBefore.node && selectionAfter.head === selectionBefore.head,
      `29c-1: 点右栏边行不许改变选中态（点前 ${JSON.stringify(selectionBefore)}，点后 ${JSON.stringify(selectionAfter)}）`,
    )
    check(
      selectionAfter.edgeInspector === false && selectionAfter.summary === false,
      `29c-1: 点右栏边行也不该冒出边编辑区 / 整图概览：${JSON.stringify(selectionAfter)}`,
    )

    /*
     * 29c-2) 画布上点一条边 = 选中它（右栏换成边编辑区），节点的选中态被清掉。
     *
     * 点的是**边的屏幕中点**：坐标由 `getPointAtLength` 从真实路径算、`getScreenCTM` 映射到
     * 屏幕，脚本不自己算缩放也不编坐标。
     *
     * 选的是 `check1->build1`（反向的 `build1->check1` 是同一对节点的另一条边，两条在中点
     * 相交，DOM 里后渲染的那条赢命中）；两条都**没有 `when`、即没有边标签**——
     * 边标签是在单独的浮层里（`.react-flow__edgelabel-renderer`），点它会点到标签而不是边。
     */
    const EDGE_ID = 'check1->build1'
    /*
     * 先把整图放进视野（`fitView` 是 220ms 的动画，等它停）。
     *
     * 不这么做量到的"边的中点"可能落在**画布可见区之外**（右栏底下）——切图不会自动
     * 应用文档里存的视口，React Flow 会沿用上一张图的平移/缩放（这一轮实测中点跑到了
     * x=1182，而画布右边界只有 800 多）。那一下点到的就是右栏了。
     */
    await session.evaluate(clickTestIdExpr('wl-fit'))
    await new Promise((resolve) => setTimeout(resolve, 600))
    await waitForEdgeRendered(session, EDGE_ID)
    const midPoint = await session.evaluate(edgePointExpr(EDGE_ID, 0))
    check(midPoint !== null, `29c-2: 画布上找不到边 ${EDGE_ID}（EDGES_NAME 的种子变了？）`)
    check(
      midPoint.insideCanvas === true,
      `29c-2: 边的中点应落在画布可见区内（否则量到/点到的是别的面板）：${JSON.stringify(midPoint)}`,
    )
    check(
      midPoint.hitEdgeId === EDGE_ID,
      `29c-2: 边的中点应当命中它自己，实得 ${JSON.stringify(midPoint)}`,
    )
    await mouseClick(session, midPoint.point)
    await waitFor(session, `document.querySelector('[data-testid="wl-edge-inspector"]') !== null`, {
      timeoutMs: 5_000,
    })
    const edgePanel = await session.evaluate(`(() => {
       const el = document.querySelector('[data-testid="wl-edge-inspector"]');
       if (!el) return null;
       const node = document.querySelector('.react-flow__node.selected');
       return {
         text: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
         selectedNode: node ? node.getAttribute('data-id') : null,
         summary: document.querySelector('[data-testid="wl-graph-summary"]') !== null,
       };
     })()`)
    check(edgePanel !== null, '29c-2: 点边之后右栏应出现 wl-edge-inspector')
    check(
      edgePanel.text.includes('审查（check1）') && edgePanel.text.includes('执行（build1）'),
      `29c-2: 边编辑区要写两端的「显示名（id）」：${JSON.stringify(edgePanel.text)}`,
    )
    check(
      edgePanel.selectedNode === null,
      `29c-2: 选中边之后节点的选中态应该被清掉：${JSON.stringify(edgePanel)}`,
    )
    check(edgePanel.summary === false, '29c-2: 选中边时右栏不该还是整图概览')

    /*
     * 29c-6) `interactionWidth` 真的让边好点了。
     *
     * 先把选中清掉，再点**离描边 12 个画布单位**（沿法线）的那一点。
     * React Flow 的默认 `interactionWidth` 是 20（半宽 ±10 单位），那个点落在命中区之外；
     * 产品设成 28（半宽 ±14）之后点得中。所以这条能区分"真的设宽了"与"中点恰好压在
     * 1.5px 的描边上"，不是把中点那一下又验一遍。
     */
    await pressKey(session, 'Escape')
    try {
      await waitFor(
        session,
        `document.querySelector('[data-testid="wl-edge-inspector"]') === null && document.querySelector('[data-testid="wl-graph-summary"]') !== null`,
        { timeoutMs: 4_000 },
      )
    } catch {
      const dbg = await session.evaluate(`(() => {
         const active = document.activeElement;
         return {
           active: active ? active.tagName + '|' + (active.getAttribute('data-testid') || active.getAttribute('class') || '') : null,
           insideRoot: active !== null && document.querySelector('[data-testid="wl-root"]').contains(active),
           edgeInspector: document.querySelector('[data-testid="wl-edge-inspector"]') !== null,
           summary: document.querySelector('[data-testid="wl-graph-summary"]') !== null,
           nodePanel: document.querySelector('[data-testid="wl-prompt"]') !== null,
           selectedEdges: [...document.querySelectorAll('.react-flow__edge.selected')].map((el) => el.getAttribute('data-id')),
           selectedNodes: [...document.querySelectorAll('.react-flow__node.selected')].map((el) => el.getAttribute('data-id')),
         };
       })()`)
      check(
        false,
        `29c-6: Escape 之后应当什么都不选（右栏回到整图概览），实得 ${JSON.stringify(dbg)}`,
      )
    }
    await waitForEdgeRendered(session, EDGE_ID)
    const offPoint = await session.evaluate(edgePointExpr(EDGE_ID, 12))
    if (offPoint === null) {
      /*
       * `edgePointExpr` 只在**边元素 / 路径 / CTM 三者缺一**时返回 null，而它离上一条
       * 断言只隔一次点边和一次 Esc。曾经这里只打印一个 `null`，等于什么都没说：看不出
       * 是"边被重名了"还是"整批边没渲染出来"。把此刻的 DOM 原样端出来，别让下一个人猜。
       */
      const diag = await session.evaluate(`(() => {
         const edges = [...document.querySelectorAll('.react-flow__edge')];
         const target = document.querySelector('.react-flow__edge[data-id=' + JSON.stringify(${JSON.stringify('check1->build1')}) + ']');
         const path = target === null ? null : target.querySelector('.react-flow__edge-path');
         const canvas = document.querySelector('[data-testid="wl-canvas"]');
         const viewport = document.querySelector('.react-flow__viewport');
         const trigger = document.querySelector('[data-testid="wl-graph-trigger"]');
         const frame = canvas ? canvas.getBoundingClientRect() : null;
         return {
           edgeCount: edges.length,
           edgeIds: edges.map((el) => el.getAttribute('data-id')),
           targetFound: target !== null,
           targetHasPath: path !== null,
           targetCtm: path === null ? null : String(path.getScreenCTM()),
           viewportTransform: viewport === null ? null : getComputedStyle(viewport).transform,
           canvas: frame === null ? null : { w: Math.round(frame.width), h: Math.round(frame.height) },
           graphSelect: select === null ? null : select.value,
           nodeCount: document.querySelectorAll('.react-flow__node').length,
         };
       })()`)
      console.log(`  29c-6 诊断：${JSON.stringify(diag)}`)
    }
    check(
      offPoint !== null &&
        offPoint.insideCanvas === true &&
        typeof offPoint.hitEdgeId === 'string' &&
        offPoint.hitEdgeId !== '',
      `29c-6: 离描边 12 画布单位的点应落在某条边加宽后的可点区域里（默认 interactionWidth=20 只有 ±10 单位，那里是空的）：${JSON.stringify(offPoint)}`,
    )
    await mouseClick(session, offPoint.point)
    await waitFor(session, `document.querySelector('[data-testid="wl-edge-inspector"]') !== null`, {
      timeoutMs: 5_000,
    })
    // 把选中恢复到确定的那一条：上面那一下落在相交点上，赢的是哪条由渲染顺序决定，
    // 而下面的条件断言要钉在一固定的 edge id 上。
    await mouseClick(session, midPoint.point)
    await waitFor(
      session,
      `document.querySelector('.react-flow__edge[data-id=' + JSON.stringify(${JSON.stringify('check1->build1')}) + '].selected') !== null`,
      { timeoutMs: 5_000 },
    )

    /*
     * 29c-3) 条件的点选生效：fail / 无条件两格各点一下，回读盘上那条边的 id。
     *
     * 用 `graph/load` 回读而不是读 DOM：要证明的是"值真的进了文档"，
     * 而 `when` 是边 id 的一部分（`<source>-><target>#<when>`），id 变了就是换了条边。
     */
    await session.evaluate(clickTestIdExpr('wl-edge-condition-fail'))
    const failed = await pollFor(async () => {
      const loaded = await rpc('graph/load', { name: EDGES_NAME })
      return loaded.document.edges.some((edge) => edge.id === 'check1->build1#fail') ? loaded : null
    })
    check(failed !== null, '29c-3: 点「fail」之后盘上那条边应变成 check1->build1#fail')
    /*
     * 改 `when` 等于换边 id，但右栏那块编辑区不能因此关掉——
     * reducer 会把选中搬到新 id 上（否则用户点一下「fail」，编辑区当场消失）。
     */
    const stillOpen = await session.evaluate(
      `document.querySelector('[data-testid="wl-edge-inspector"]') !== null`,
    )
    check(stillOpen === true, '29c-3: 改完条件右栏的边编辑区应还开着（选中要跟着搬到新 id）')
    await session.evaluate(clickTestIdExpr('wl-edge-condition-none'))
    const backToPlain = await pollFor(async () => {
      const loaded = await rpc('graph/load', { name: EDGES_NAME })
      return loaded.document.edges.some((edge) => edge.id === 'check1->build1') ? loaded : null
    })
    check(backToPlain !== null, '29c-3: 点「无条件」之后盘上那条边应回到 check1->build1')

    /*
     * 29c-4) 自定义条件能**连续输入**（那个"只能敲进一个字符"的 bug 的回归网，最重要的一条）。
     *
     * 一次连打 `retry`：改 `when` 就是换边 id，早先每敲一键就提交一次 ⇒ 列表按 id 重排、
     * 整块重挂载、输入框当场失焦，后面几个字符全落在 body 上（实测只有第一个字符进去了）。
     * 现在提交时机是**失焦 / 回车**，所以断言两件事：值完整、焦点还在输入框里。
     */
    await session.evaluate(clickTestIdExpr('wl-edge-condition-custom'))
    const focused = await waitFor(
      session,
      `(() => { const el = document.querySelector('[data-testid="wl-edge-custom-input"]'); return el !== null && document.activeElement === el ? 1 : 0 })()`,
      { timeoutMs: 4_000 },
    )
    check(focused === 1, '29c-4: 点「自定义…」应出现 wl-edge-custom-input 并自动聚焦')
    for (const char of ['r', 'e', 't', 'r', 'y']) {
      await pressKey(session, char, { text: char })
    }
    const typed = await session.evaluate(`(() => {
       const el = document.querySelector('[data-testid="wl-edge-custom-input"]');
       return el === null ? null : { value: el.value, focused: document.activeElement === el };
     })()`)
    check(
      typed !== null && typed.value === 'retry',
      `29c-4: 连打 retry 之后输入框的值应是完整的 retry（只进去一个字符就是那个 bug 回来了）：实得 ${JSON.stringify(typed)}`,
    )
    check(typed.focused === true, `29c-4: 连打之后焦点必须还在输入框里：${JSON.stringify(typed)}`)
    await pressKey(session, 'Enter')
    const custom = await pollFor(async () => {
      const loaded = await rpc('graph/load', { name: EDGES_NAME })
      return loaded.document.edges.some((edge) => edge.id === 'check1->build1#retry')
        ? loaded
        : null
    })
    check(custom !== null, '29c-4: 回车之后盘上那条边应变成 check1->build1#retry')

    console.log(
      `  29c 边标签底 + 右栏边行只读 + 画布点边选中 + 条件点选 + 自定义连续输入 ok（标签底 fill=${labelBg.fill} stroke=${labelBg.stroke}；选中节点 ${edgeRowNode}，宽右栏 ${Math.round(wideRows.inspector.width)}px / 窄右栏 ${Math.round(narrowRows.inspector.width)}px 各 ${narrowRows.rows.length} 行；行名 ${JSON.stringify(wideRows.rows.map((row) => row.name))}，两档都 scroll<=client+1 不截断；条件列 ${JSON.stringify(wideRows.rows.map((row) => row.whenLabel))}；点行后仍选中 ${selectionAfter.node}、右栏标题未变；点 ${EDGE_ID} 中点后 selectedNode=${JSON.stringify(edgePanel.selectedNode)}、两端文本=${JSON.stringify(edgePanel.text.slice(0, 30))}；离描边 12 单位（缩放 ${offPoint.zoom.toFixed(2)}）处命中 ${JSON.stringify(offPoint.hitEdgeId)} 并选中；fail→盘上 ${EDGE_ID}#fail，无条件→${EDGE_ID}；自定义连打后 value=${JSON.stringify(typed.value)} focused=${typed.focused} → 盘上 ${EDGE_ID}#retry）`,
    )

    // 30) 快捷键说明展开（新增键盘映射在界面上唯一的痕迹）
    await selectGraph(session, NAME)
    await session.evaluate(clickTestIdExpr('wl-shortcuts'))
    const shortcutPanel = await waitFor(
      session,
      `(() => {
         const panel = document.getElementById('workflow-lite-shortcuts');
         const toggle = document.querySelector('[data-testid="wl-shortcuts"]');
         if (!panel) return 0;
         const box = panel.getBoundingClientRect();
         if (box.width <= 0 || box.height <= 0) return 0;
         return {
           expanded: toggle ? toggle.getAttribute('aria-expanded') : null,
           keys: panel.querySelectorAll('kbd').length,
           title: (panel.textContent || '').trim().slice(0, 20),
         };
       })()`,
      { timeoutMs: 5_000 },
    )
    check(
      shortcutPanel.expanded === 'true',
      `快捷键按钮应 aria-expanded=true，实得 ${JSON.stringify(shortcutPanel)}`,
    )
    check(shortcutPanel.keys >= 5, `快捷键说明里应有各组合键，实得 ${shortcutPanel.keys} 个 kbd`)
    await takeScreenshot(session, 'shortcuts-expanded.png')
    console.log(`  30 快捷键说明展开 ok（${shortcutPanel.keys} 条组合键）`)

    /*
     * 31) 键盘路径：`Delete` 删除**选中的**节点。
     *
     * 先收起上一步展开的快捷键说明：它是个浮层，压着画布上沿，可能正好盖住要点的卡片。
     * 快捷键只挂在画布容器的 `onKeyDown` 上，所以必须证明：命中的是目标卡片、且按键落在
     * 画布容器**内部**（`input/textarea/select` 里按会被 `isTypingTarget` 让开，验不到）。
     * 注意焦点不一定等于 `wl-canvas` 本身——卡片自己可聚焦，事件从卡片冒泡到容器即可，
     * 所以判据是"焦点在容器内且不是打字控件"，不是"焦点恰好是容器"。
     */
    await session.evaluate(clickTestIdExpr('wl-shortcuts'))
    await waitFor(session, `document.getElementById('workflow-lite-shortcuts') === null`, {
      timeoutMs: 5_000,
    })
    await selectGraph(session, NAME)
    const keyDeleteBox = await waitFor(session, nodeBoxExpr('scan'), { timeoutMs: 5_000 })
    check(keyDeleteBox !== null, '找不到 scan 节点卡（或它可见部分太小），Delete 这条验不到')
    // 命中自检要等收敛（理由同第 22 步：刚挂载的卡片有一小段过渡态命中 pane）。
    const keyDeleteHit = await readSettled(
      session,
      `(() => {
       const el = document.elementFromPoint(${keyDeleteBox.center.x}, ${keyDeleteBox.center.y});
       if (!el) return { node: 'nothing' };
       const owner = el.closest('.react-flow__node');
       return {
         tag: el.tagName,
         cls: (el.className || '').toString().slice(0, 40),
         node: owner ? owner.getAttribute('data-id') : null,
         typing: el.closest('input, textarea, select') !== null,
       };
     })()`,
      (value) => value?.node === 'scan' && value?.typing === false,
      { timeoutMs: 3_000 },
    )
    check(
      keyDeleteHit.node === 'scan' && keyDeleteHit.typing === false,
      `Delete 那一下必须点在 scan 卡片上（点到输入框会被让开）：点 ${JSON.stringify(keyDeleteBox.center)} 命中 ${JSON.stringify(keyDeleteHit)}`,
    )
    await mouseClick(session, keyDeleteBox.center)
    await waitFor(
      session,
      `document.querySelector('.react-flow__node[data-id="scan"].selected') !== null`,
      { timeoutMs: 5_000 },
    )
    const keyDeleteFocus = await session.evaluate(`(() => {
       const canvas = document.querySelector('[data-testid="wl-canvas"]');
       const active = document.activeElement;
       return {
         id: active ? (active.getAttribute('data-testid') || active.tagName) : null,
         insideCanvas: canvas !== null && active !== null && canvas.contains(active),
         typing: active !== null && active.closest('input, textarea, select') !== null,
       };
     })()`)
    check(
      keyDeleteFocus.insideCanvas === true && keyDeleteFocus.typing === false,
      `键盘焦点应落在画布容器内、且不是打字控件（快捷键挂在那里）：实得 ${JSON.stringify(keyDeleteFocus)}`,
    )
    const beforeKeyDelete = await session.evaluate(nodeCountExpr)
    await pressKey(session, 'Delete')
    await waitFor(session, `document.querySelector('.react-flow__node[data-id="scan"]') === null`, {
      timeoutMs: 5_000,
    })
    const afterKeyDelete = await session.evaluate(nodeCountExpr)
    check(
      afterKeyDelete === beforeKeyDelete - 1,
      `Delete 应删掉选中的节点（${beforeKeyDelete} → ${beforeKeyDelete - 1}），实得 ${afterKeyDelete}`,
    )
    console.log(
      `  31 键盘 Delete 删除选中节点 ok（scan，焦点=${JSON.stringify(keyDeleteFocus.id)} 在画布内；${beforeKeyDelete} → ${afterKeyDelete}）`,
    )

    /*
     * 32) 键盘路径：`Ctrl+Y` 是 `Ctrl+Shift+Z` 之外的重做别名。
     *
     * 新加的节点 id 不写死（`implement` 只在它没被占用时才是这个名字）：用前后节点清单差集认出来，
     * 这样撤销/重做断言的是"同一个节点回来了"，而不是"节点数变了"。
     */
    const idsBeforeAlias = (await session.evaluate(nodeListExpr)).map((node) => node.id)
    /*
     * 用**拖**加这个节点：条目点了不加、按回车也不加（两轮都拍过），拖是唯一那条路。
     */
    const aliasDropAt = await session.evaluate(`(() => {
       const r = document.querySelector('[data-testid="wl-canvas"]').getBoundingClientRect();
       return { x: Math.round(r.x + r.width * 0.5), y: Math.round(r.y + r.height * 0.82) };
     })()`)
    await dragItemTo(session, { itemTestId: 'wl-item-preset-implement', to: aliasDropAt })
    const aliasId = await waitFor(
      session,
      `(() => {
         const ids = [...document.querySelectorAll('.react-flow__node')].map((el) => el.getAttribute('data-id'));
         const fresh = ids.filter((id) => !${JSON.stringify(idsBeforeAlias)}.includes(id));
         return fresh.length === 1 ? fresh[0] : 0;
       })()`,
      { timeoutMs: 5_000 },
    )
    const nodeFor = (id) =>
      `document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]')`
    const beforeAlias = await session.evaluate(nodeCountExpr)
    check(
      beforeAlias === idsBeforeAlias.length + 1,
      `拖一个起点进画布应新增一个节点（${idsBeforeAlias.length} → ${idsBeforeAlias.length + 1}），实得 ${beforeAlias}`,
    )
    await focusCanvas()
    await pressShortcut(session, 'z', ['ctrl'])
    await waitFor(session, `${nodeFor(aliasId)} === null`, { timeoutMs: 5_000 })
    const afterUndoAlias = await session.evaluate(nodeCountExpr)
    check(
      afterUndoAlias === beforeAlias - 1,
      `Ctrl+Z 应把刚加的 ${aliasId} 撤掉（${beforeAlias} → ${beforeAlias - 1}），实得 ${afterUndoAlias}`,
    )
    await focusCanvas()
    await pressShortcut(session, 'y', ['ctrl'])
    await waitFor(session, `${nodeFor(aliasId)} !== null`, { timeoutMs: 5_000 })
    const afterRedoAlias = await session.evaluate(nodeCountExpr)
    check(
      afterRedoAlias === beforeAlias &&
        (await session.evaluate(`${nodeFor(aliasId)} !== null`)) === true,
      `Ctrl+Y 应把 ${aliasId} 加回来（同一个 id），实得节点数 ${afterRedoAlias}（期望 ${beforeAlias}）`,
    )
    console.log(
      `  32 键盘 Ctrl+Y 重做别名 ok（${aliasId}：${beforeAlias} → ${afterUndoAlias}（Ctrl+Z）→ ${afterRedoAlias}（Ctrl+Y））`,
    )

    // 33) 收尾再查一次控制台：整轮交互（拖放/撤销/键盘/悬停/切图/刷新）之后仍然干净
    const lateErrors = session.errors.filter((line) => !line.includes('favicon'))
    const lateBadTarget = lateErrors.filter((line) => line.includes('invalid RPC target'))
    const split33 = splitConsoleErrors(lateErrors)
    check(
      lateBadTarget.length === 0,
      `整轮之后仍不该有 invalid RPC target：\n  ${lateBadTarget.join('\n  ')}`,
    )
    check(
      split33.plugin.length === 0,
      `整轮交互之后控制台不该有未捕获错误（含未捕获 Promise、本插件）：\n  ${split33.plugin.join('\n  ')}`,
    )
    reportHostNoise('33', split33.host)
    console.log('  33 整轮之后控制台仍干净（本插件零错误）ok')

    console.log(
      '\n✅ 真浏览器验收通过（原 31 步 + 键盘 Delete/Ctrl+Y 两步 = 33 步；第 25、29 步已加固）',
    )
  } finally {
    /*
     * 把本插件写进 `localStorage` 的**偏好**也还回去。
     *
     * 这一轮之前的验收会在页面里写 `workflow-lite.palette.collapsed`（第 19/20 步）与
     * `workflow-lite.lastGraph`（打开图时产品自己写），跑完就留在**用户那份浏览器配置**里。
     * 后果是真实可见的：用户打开界面时左栏的分组全是收起状态、只剩组名与数字，
     * 看着像坏了——那是验收留下的，不是他的设置。
     *
     * 删而不是还原到"跑之前的值"：这两个键都是**尽力而为的偏好**，缺省就是最合理的样子
     * （全展开、按"唯一一张图"兜底）。清掉比留一个可能已经失效的 `lastGraph` 更安全。
     */
    await session
      .evaluate(
        `(() => { localStorage.removeItem('workflow-lite.palette.collapsed');
                  localStorage.removeItem('workflow-lite.lastGraph'); return true; })()`,
      )
      .catch(() => undefined)
    session.close()
    // 自造的模板文件先删干净：数据目录只该剩下原本就有的东西（失败路径也走这里）。
    await removeTemplateFixtures()
    // 收尾只删**本脚本 seed 的那三张**图（`untitled` 是别人的，一个字都不动）。
    for (const name of [graph, EMPTY_NAME, EDGES_NAME]) {
      await rpc('graph/delete', { name }).catch(() => {})
    }
  }
}

main().catch((error) => {
  console.error('\n❌ 浏览器验收失败：', error.message)
  process.exit(1)
})
