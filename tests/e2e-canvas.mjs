/**
 * 画布通道的端到端验收（**走真实的 `/api/workflow-lite/*` 路由**，不直接调函数）。
 *
 * 覆盖：列图（含 `limits`）→ 新建 → 读 → 整图保存（写前哈希比对 + 字段级合并）→
 * 重新读回 → 编译派发计划（并核对载荷真的落进 `.dispatch/`）→ 整卷版 →
 * 节点模板（列表 + `data` 本体）→ 改名 → 删除。
 *
 * **清理放在 `finally`**：中途断言失败也要把备图删掉，否则失败一次就在用户的数据目录里
 * 留一张 `e2e-*` 的垃圾图（这是真发生过的）。
 *
 * 前置：测试实例在跑（`dsh --profile workflow-lite-dev --port 3190`），并设好
 * `DSH_WEB_TOKEN` / 可选 `DSH_BASE` / 可选 `DSH_WORKFLOW_DATA_DIR`（给了才查物化与模板）。
 *
 * usage: DSH_WEB_TOKEN=<token> node tests/e2e-canvas.mjs
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { baseUrl, rpc } from './lib/web-session.mjs'

const NAME = `e2e-${Date.now().toString(36)}`

/** 断言助手：失败就抛，带上下文。 */
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

/** 拼一张样张形状的图（三条边 + 四个节点，含一个环）。 */
function demoDocument() {
  const node = (id, label, prompt, output) => ({
    id,
    type: 'wfNode',
    position: { x: 0, y: 0 },
    data: { label, prompt, ...(output === undefined ? {} : { output }) },
  })
  const edge = (source, target, when) => ({
    id: when === undefined ? `${source}->${target}` : `${source}->${target}#${when}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined ? {} : { data: { when } }),
  })
  return {
    nodes: [
      node('scan', '扫描', '扫描仓库，把疑点写成 scan.json。', 'scan.json'),
      node('auth-review', '认证审查', '你是审查者，只审认证相关代码。', 'auth-findings.md'),
      node('fix-auth', '修复', '按 auth-findings.md 修认证问题。', false),
      node('report', '报告', '写一份给 owner 看的报告。', 'review-report.md'),
    ],
    edges: [
      edge('scan', 'auth-review'),
      edge('auth-review', 'fix-auth', 'fail'),
      edge('auth-review', 'report', 'pass'),
      edge('fix-auth', 'auth-review'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

const run = async () => {
  console.log(`# 画布通道端到端验收 @ ${baseUrl()}`)
  const dataDir = process.env.DSH_WORKFLOW_DATA_DIR

  // 1) 列图：至少能看到已有图（可能非空）；并且带回画布要用的两个活配置值。
  const before = await rpc('graph/list', {})
  check(Array.isArray(before.workflows), 'graph/list 要回 workflows 数组')
  check(typeof before.templates === 'object', 'graph/list 要回 templates')
  check(
    typeof before.limits?.maxNodes === 'number' &&
      typeof before.limits?.saveDebounceMs === 'number',
    `graph/list 要回 limits（画布判「超 maxNodes 就不跑自动布局」用）：${JSON.stringify(before.limits)}`,
  )
  console.log(
    `  1 列图 ok（现有 ${before.workflows.length} 张，maxNodes=${before.limits.maxNodes}）`,
  )

  // 2) 新建。
  const created = await rpc('graph/create', { name: NAME })
  check(created.name === NAME, `新建应得 ${NAME}，实得 ${created.name}`)
  console.log(`  2 新建 ok: ${created.name}`)

  // 3) 读：新图是空的、可加载。
  const empty = await rpc('graph/load', { name: NAME })
  check(empty.document.nodes.length === 0, '新图应零节点')
  check(typeof empty.hash === 'string' && empty.hash.length > 0, 'load 要给基线 hash')
  console.log('  3 读 ok（零节点、有基线 hash）')

  // 4) 整图保存（带基线）→ 写回并换基线。
  const document = demoDocument()
  const saved = await rpc('graph/save', { name: NAME, document, baseHash: empty.hash })
  check(typeof saved.hash === 'string' && saved.hash !== empty.hash, 'save 要给新的基线 hash')
  console.log(`  4 保存 ok（新基线 ${saved.hash.slice(0, 12)}…）`)

  // 5) 重新读回：内容逐字段对上（坐标归一化、边 id 构造式）。
  const reloaded = await rpc('graph/load', { name: NAME })
  check(
    reloaded.document.nodes.length === 4,
    `读回应有 4 个节点，实得 ${reloaded.document.nodes.length}`,
  )
  check(reloaded.document.edges.length === 4, '读回应有 4 条边')
  const ids = reloaded.document.nodes.map((n) => n.id).sort()
  check(
    JSON.stringify(ids) === JSON.stringify(['auth-review', 'fix-auth', 'report', 'scan']),
    `节点 id 不对：${ids}`,
  )
  const edgeIds = reloaded.document.edges.map((e) => e.id).sort()
  check(edgeIds.includes('auth-review->fix-auth#fail'), '条件边的 id 应按构造式生成')
  check(
    reloaded.document.edges.every((e) => e.sourceHandle === null && e.targetHandle === null),
    'sourceHandle / targetHandle 一律写出 null',
  )
  console.log('  5 读回 ok（4 节点 / 4 边 / 边 id 构造式 / handle 为 null）')

  // 6) 编译：出计划、正文不内联、路径指向 .dispatch。
  const plan = await rpc('plan/build', { name: NAME, goal: '跑通端到端验收' })
  check(typeof plan.plan === 'string' && plan.plan.length > 0, '编译应出计划')
  check(plan.problems.length === 0, `编译不该有编译级问题：${JSON.stringify(plan.problems)}`)
  check(!plan.plan.includes('你是审查者'), '派发版里不该出现提示词正文')
  check(plan.plan.includes('.dispatch'), '计划里应有载荷路径引用')
  check(plan.plan.includes('## 交付契约'), '计划应有五段结构')
  check(/^[0-9a-f]{8}$/.test(plan.planId), `planId 应是 8 位十六进制：${plan.planId}`)
  console.log(`  6 编译 ok（planId ${plan.planId}，${plan.plan.length} 字符）`)

  // 7) 物化：磁盘上真有载荷，且与 prompt 逐字相同（只在能拿到 dataDir 时查）。
  if (dataDir !== undefined) {
    const dir = join(dataDir, 'workflows')
    const files = await readdir(dir)
    check(files.includes(`${NAME}.json`), `图 JSON 应在 ${dir}`)
    const payload = await readFile(
      join(dataDir, '.dispatch', NAME, plan.planId, 'auth-review.md'),
      'utf8',
    )
    check(payload === '你是审查者，只审认证相关代码。', '载荷必须与 data.prompt 字节相同')
    console.log(`  7 物化 ok（${payload.length} 字节，与 prompt 逐字相同）`)
  } else {
    console.log('  7 物化 跳过（未设 DSH_WORKFLOW_DATA_DIR）')
  }

  // 8) 整卷版：内联正文。
  const full = await rpc('plan/build', { name: NAME, full: true })
  check(full.plan.includes('你是审查者，只审认证相关代码。'), '整卷版应内联正文')
  console.log('  8 整卷版 ok')

  // 9) 节点模板：`graph/templates` 只列名字，`graph/nodeTemplate` 才给 `data` 本体
  //    （画布「点一下模板就加成节点」靠它）。
  if (dataDir !== undefined) {
    const nodesDir = join(dataDir, 'templates', 'nodes')
    await mkdir(nodesDir, { recursive: true })
    await writeFile(
      join(nodesDir, 'e2e-preset.json'),
      JSON.stringify({ label: '模板节点', prompt: '来自模板的提示词', output: 't.md' }, null, 2),
      'utf8',
    )
    const listed = await rpc('graph/templates', {})
    check(
      listed.nodes.some((entry) => entry.name === 'e2e-preset' && entry.invalid !== true),
      `模板应被列出：${JSON.stringify(listed.nodes.map((e) => e.name))}`,
    )
    const template = await rpc('graph/nodeTemplate', { name: 'e2e-preset' })
    check(template.data.prompt === '来自模板的提示词', 'nodeTemplate 要给 data.prompt 本体')
    check(template.data.output === 't.md', 'nodeTemplate 要给 data.output')
    check(!('nodes' in template.data), 'nodeTemplate 回的必须是 data 本体，不是整张图')
    await rm(join(nodesDir, 'e2e-preset.json'), { force: true })
    console.log('  9 节点模板 ok（列表 + data 本体）')
  } else {
    console.log('  9 节点模板 跳过（未设 DSH_WORKFLOW_DATA_DIR）')
  }

  // 10) 改名 / 删除。
  const renamed = `${NAME}-renamed`
  await rpc('graph/rename', { name: NAME, to: renamed })
  const afterRename = await rpc('graph/list', {})
  check(
    afterRename.workflows.some((w) => w.name === renamed),
    '改名后应能在列表里看到',
  )
  await rpc('graph/delete', { name: renamed })
  const afterDelete = await rpc('graph/list', {})
  check(!afterDelete.workflows.some((w) => w.name === renamed), '删除后不该在列表里')
  console.log('  10 改名 / 删除 ok')

  console.log('\n✅ 画布通道端到端验收全部通过')
}

/**
 * 跑一遍，然后**无论成败**都把备图清掉。
 *
 * 两张名字都试：跑到一半失败时图可能还叫原名，也可能已经改成 `-renamed`。
 */
const main = async () => {
  try {
    await run()
  } finally {
    for (const name of [NAME, `${NAME}-renamed`]) {
      await rpc('graph/delete', { name }).catch(() => {})
    }
    /*
     * 图删了，**它物化出来的 `.dispatch/<图名>/` 还在**。
     *
     * 那里面是编译时写下的载荷（`.dispatch/<图名>/<planId>/<节点id>.md`）——设计上说它是
     * 派生物、随时可删，但"删了图却留下派生物目录"会在这个目录里越堆越多，
     * 而清理成本只有一行。只删我们自己的那个图名，别人的一律不碰。
     *
     * 只有给了 `DSH_WORKFLOW_DATA_DIR` 才知道该往哪删（没给就跳过——那说明这次跑的是
     * 别人的实例，我们连目录在哪都不该假设）。
     */
    const dataDir = process.env.DSH_WORKFLOW_DATA_DIR
    if (dataDir !== undefined && dataDir !== '') {
      for (const name of [NAME, `${NAME}-renamed`]) {
        await rm(join(dataDir, '.dispatch', name), { recursive: true, force: true }).catch(() => {})
      }
    }
  }
}

main().catch((error) => {
  console.error('\n❌ 验收失败：', error.message)
  process.exit(1)
})
