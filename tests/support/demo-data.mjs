import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RunService } from '../../src/host/runs/service.ts'
import { DATABASE_FILE, PluginDatabase } from '../../src/host/store/database.ts'
import { assetsDir, memoryFolder } from '../../src/host/store/paths.ts'
import { newFireId, TriggerStore } from '../../src/host/triggers/store.ts'
import { addGlobalMemory } from '../../src/shared/presets.ts'
import { rpc } from '../lib/web-session.mjs'

export const DEMO_WORKFLOW = '触发器一览'
export const EXPORT_DEMO_WORKFLOW = '触发器导出演示'
const UPSTREAM = '夜间巡检'
const RELEASE = '发版检查'
const REVIEW = '代码评审'

const memories = [
  ['ops-notes', 'workflow', '巡检检查清单', '先查服务健康度，再按严重程度汇总异常。'],
  ['release-notes', 'workflow', '发版说明格式', '按新增、调整和修复分组，写明用户可见的变化。'],
  ['review-checklist', 'step', '评审时要看的问题', '先核对边界条件、错误处理和回归覆盖。'],
  ['weekly-summary', 'step', '周报摘要模板', '列出本周完成、待跟进事项和下周计划。'],
]

const daily = (time, weekdays) => ({
  kind: 'schedule',
  schedule: { kind: 'daily', time, ...(weekdays === undefined ? {} : { weekdays }) },
})
const every = (seconds) => ({ kind: 'schedule', schedule: { kind: 'every', seconds } })

const triggers = [
  ['workdays', '工作日夜巡', daily('02:30', [1, 2, 3, 4, 5])],
  ['daily', '每天早报', daily('09:00')],
  ['every', '每两小时看看', every(7200)],
  ['cron', '周一早上', { kind: 'schedule', schedule: { kind: 'cron', expression: '0 9 * * 1' } }],
  [
    'poll',
    '主干有新提交',
    { ...every(60), check: { command: 'git rev-parse HEAD', when: 'change' } },
  ],
  ['listen', '新文件进来', { kind: 'listen', command: 'node watch.mjs' }],
  ['http', 'CI 通知', { kind: 'http' }],
  ['after', '巡检失败后', { kind: 'after', workflow: UPSTREAM, when: 'failed' }],
  ['afterAny', '巡检跑完后汇总', { kind: 'after', workflow: UPSTREAM, when: 'any' }],
  ['httpOff', '手动接口', { kind: 'http' }],
]

function workflow(steps, triggerData, memory) {
  const floor = 180 * Math.ceil(triggerData.length / 5)
  const nodes = [
    ...triggerData.map(([id, label, source], index) => ({
      id,
      type: 'wfTrigger',
      position: { x: (index % 5) * 270, y: Math.floor(index / 5) * 180 },
      data: { label, source },
    })),
    ...steps.map((label, index) => ({
      id: `step-${index + 1}`,
      type: 'wfNode',
      position: { x: index * 300, y: floor },
      data: { label, prompt: `${label}，将结论写成简短报告。` },
    })),
  ]
  const document = {
    nodes,
    edges: steps.slice(1).map((_, index) => ({
      id: `link-${index + 1}`,
      source: `step-${index + 1}`,
      target: `step-${index + 2}`,
      sourceHandle: null,
      targetHandle: null,
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { runState: true },
  }
  return memory === undefined
    ? document
    : addGlobalMemory(document, { memory, type: 'workflow' }, { x: steps.length * 300, y: floor })
        .document
}

function unwrap(outcome) {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.error))
  return outcome.result
}

/**
 * 两个已保存的版本，方便核对触发卡片、触发脚本、密钥和脚本数据各自是否进包：
 * 「服务状态检查」带两个密钥文件和脚本数据，「日志告警」只带脚本数据，「CI 部署通知」只在第二版里；
 * 「工作日早报」开着（导入时预选打开），「周报发进固定会话」「夜间备份」（工作区不在）导入时打不开；
 * 另读工作区里的一份文件和一个文件夹，让「文件」「文件夹」两类也有东西、清单长到要滚动。
 */
export async function seedExportDemo(dataDir, workspace) {
  const name = EXPORT_DEMO_WORKFLOW
  await rpc('graph/create', { name })
  const assets = assetsDir(dataDir, name)
  const checkDir = join(assets, 'triggers', 'check')
  await mkdir(join(checkDir, 'secrets'), { recursive: true })
  await mkdir(join(checkDir, 'data'), { recursive: true })
  await writeFile(
    join(assets, '巡检清单.md'),
    '# 巡检清单\n\n- 核对服务状态\n- 汇总异常和处理结果\n',
  )
  await writeFile(join(checkDir, 'check.mjs'), 'console.log("::trigger:: 巡检样例：服务正常")\n')
  await writeFile(join(checkDir, 'secrets', 'demo-key.txt'), 'demo-only-key\n')
  await writeFile(join(checkDir, 'data', 'last-check.json'), '{"status":"ok"}\n')
  await writeFile(join(checkDir, 'secrets', 'webhook-url.txt'), 'https://example.com/hook\n')
  const logsDir = join(assets, 'triggers', 'logs')
  await mkdir(join(logsDir, 'data'), { recursive: true })
  await writeFile(
    join(logsDir, 'watch-log.mjs'),
    'process.stdin.resume()\nconsole.log("::trigger:: 日志里出现 ERROR")\n',
  )
  await writeFile(join(logsDir, 'data', 'offset.json'), '{"offset":0}\n')
  const runbook = join(workspace, 'docs', '运维手册.md')
  const reports = join(workspace, 'reports')
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await mkdir(reports, { recursive: true })
  await writeFile(runbook, '# 运维手册\n\n- 服务重启步骤\n- 告警升级联系人\n')
  await writeFile(join(reports, '2026-11-20.md'), '# 巡检报告\n\n服务均正常。\n')

  const sources = [
    ['morning', '工作日早报', daily('09:00', [1, 2, 3, 4, 5])],
    [
      'check',
      '服务状态检查',
      { ...every(1800), check: { command: 'node check.mjs', when: 'change' } },
    ],
    ['logs', '日志告警', { kind: 'listen', command: 'node watch-log.mjs' }],
    [
      'hook',
      'CI 部署通知',
      { kind: 'http', hook: 'export-demo-ci', token: 'demo-only-ci-token-2026' },
    ],
    // 导入时打不开的两张，导出时都开着：发进固定会话的；工作区不在、权限这台机器上没有的
    // （导入预览里开关灰掉，名字后面一个告警图标说为什么先关着）。
    ['digest', '周报发进固定会话', daily('17:00', [5])],
    ['backup', '夜间备份', daily('03:00')],
  ]
  const document = workflow(['收集巡检信息', '核对服务状态', '汇总巡检报告'], sources, 'ops-notes')
  for (const node of document.nodes) {
    if (node.type !== 'wfTrigger') continue
    node.data.workspace = node.id === 'backup' ? join(workspace, '不存在的项目') : workspace
    // 导出时开着的三张（都是定时，演示时不会自己跑起来）：morning 导入预览里开关预先打开，另两张打不开。
    if (['morning', 'digest', 'backup'].includes(node.id)) node.data.enabled = true
    if (node.id === 'digest') {
      node.data.launch = { session: 'fixed', sessionId: 'demo-fixed-session' }
    }
    if (node.id === 'backup') node.data.launch = { permission: 'demo-ops-only' }
  }
  document.nodes.push({
    id: 'checklist',
    type: 'wfResource',
    position: { x: -300, y: 180 },
    data: { items: [{ kind: 'file', value: '{workflow}/巡检清单.md' }] },
  })
  document.nodes.push({
    id: 'ops-docs',
    type: 'wfResource',
    position: { x: 300, y: 540 },
    data: {
      items: [
        { kind: 'file', value: runbook },
        { kind: 'folder', value: reports },
      ],
    },
  })
  document.edges.push({
    id: 'ops-docs->step-2',
    source: 'ops-docs',
    target: 'step-2',
    sourceHandle: null,
    targetHandle: null,
  })
  document.edges.push({
    id: 'checklist->step-1',
    source: 'checklist',
    target: 'step-1',
    sourceHandle: null,
    targetHandle: null,
  })

  const save = async (doc, note) => {
    const { hash } = await rpc('graph/load', { name })
    await rpc('graph/save', { name, document: doc, baseHash: hash })
    await rpc('graph/versionSave', { name, note })
  }
  await save(
    { ...document, nodes: document.nodes.filter((node) => node.id !== 'hook') },
    '工作日早报与服务状态检查',
  )
  await save(document, '加入 CI 部署通知')
  await rpc('graph/tags', { name, tags: ['自动化', '运维'] })
}

async function seedMemories(dataDir) {
  for (const [id, type, name, description] of memories) {
    const { memory } = await rpc('memory/create', { id, type, name, description })
    await writeFile(
      join(memoryFolder(dataDir, memory.id), 'SKILL.md'),
      `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${name}\n\n${description}\n`,
    )
  }
}

/** 演示里开着的两张卡片：开关和新建会话的工作区写在图里。 */
const ENABLED = new Set(['workdays', 'every'])

function switchOn(document, workspace) {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      ENABLED.has(node.id) ? { ...node, data: { ...node.data, workspace, enabled: true } } : node,
    ),
  }
}

async function seedWorkflows(session) {
  const workflows = [
    [UPSTREAM, workflow(['检查服务', '汇总异常'], [], 'ops-notes'), ['运维']],
    [
      RELEASE,
      workflow(['核对变更', '验证产物', '写发版说明'], [], 'release-notes'),
      ['研发', '发版'],
    ],
    [REVIEW, workflow(['读改动', '列问题', '写审查结论'], []), ['研发']],
    [
      DEMO_WORKFLOW,
      switchOn(workflow(['扫描改动', '跑检查', '写报告'], triggers), session.cwd),
      ['运维', '自动化'],
    ],
  ]
  const documents = new Map()
  for (const [name, document, tags] of workflows) {
    await rpc('graph/create', { name })
    const disk = await rpc('graph/load', { name })
    await rpc('graph/save', { name, document, baseHash: disk.hash })
    await rpc('graph/tags', { name, tags })
    documents.set(name, (await rpc('graph/load', { name })).document)
  }
  return documents
}

async function seedRuns(dataDir, session, documents) {
  const runs = new RunService({ dataDir: () => dataDir, validate: () => [] })
  const examples = [
    [UPSTREAM, 'done', '完成昨晚的服务巡检'],
    [RELEASE, 'failed', '校验发版产物'],
    [RELEASE, 'waiting', '等待发版审批'],
    [REVIEW, 'cancelled', '取消重复的评审'],
    [REVIEW, 'pending', '检查下一批改动'],
    [DEMO_WORKFLOW, 'running', '检查今天的改动'],
  ]
  for (const [name, status, goal] of examples) {
    const document = documents.get(name)
    const instance = unwrap(
      await runs.prepare({ workflow: name, document, session, goal, reuse: false }),
    )
    if (status === 'pending') continue
    const steps = document.nodes.filter((node) => node.type === 'wfNode')
    unwrap(
      await runs.state(instance.id, session, {
        status,
        nodes: Object.fromEntries(
          steps
            .slice(0, status === 'done' ? steps.length : status === 'cancelled' ? 0 : 2)
            .map((step, index) => [
              step.id,
              index === 0 || status === 'done'
                ? { status: 'done', summary: '已核对，无需补充。' }
                : { status },
            ]),
        ),
      }),
    )
  }
  return examples.length
}

async function seedTriggers(dataDir, session) {
  const database = new PluginDatabase(() => join(dataDir, DATABASE_FILE))
  try {
    const store = new TriggerStore(() => dataDir, database)
    const now = Date.now()
    for (let index = 0; index < 12; index++) {
      const at = now - (1 + index * 5) * 3_600_000
      const outcome = index === 0 ? 'failed' : index % 4 === 0 ? 'skipped' : 'sent'
      await store.record({
        record: {
          id: newFireId(new Date(at)),
          workflow: DEMO_WORKFLOW,
          node: 'workdays',
          name: '工作日夜巡',
          channel: 'schedule',
          at,
          outcome,
          ...(outcome === 'failed' ? { reason: '演示：工作区暂时不可用。' } : {}),
        },
      })
    }
    const at = now - 15 * 60_000
    await store.record({
      record: {
        id: newFireId(new Date(at)),
        workflow: DEMO_WORKFLOW,
        node: 'listen',
        name: '新文件进来',
        channel: 'listen',
        at,
        outcome: 'sent',
        session: session.id,
      },
    })
  } finally {
    database.close()
  }
}

export async function seedDemo(dataDir, env) {
  const session = { id: env.sessionId, cwd: env.workspaceDir }
  await seedMemories(dataDir)
  const documents = await seedWorkflows(session)
  await seedExportDemo(dataDir, session.cwd)
  const runs = await seedRuns(dataDir, session, documents)
  await seedTriggers(dataDir, session)
  return { workflows: documents.size + 1, memories: memories.length, runs }
}
