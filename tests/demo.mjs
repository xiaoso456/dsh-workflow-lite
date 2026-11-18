import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { DEMO_WORKFLOW, seedDemo } from './support/demo-data.mjs'
import { REPO_ROOT, startShotsEnv } from './support/shots-env.mjs'

const port = Number(process.argv[2] ?? 0)
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error('端口必须是 0 至 65535 的整数')

const runs = join(REPO_ROOT, 'tests', 'runs')
await mkdir(runs, { recursive: true })
const root = await mkdtemp(join(runs, 'demo-'))
const dataDir = join(root, 'data')
const env = await startShotsEnv({
  dataDir,
  home: join(root, 'home'),
  workspaceDir: join(root, 'ws'),
  port,
})
const stopping = new Promise((resolve) => {
  process.once('SIGINT', resolve)
  process.once('SIGTERM', resolve)
})
try {
  const seeded = await seedDemo(dataDir, env)
  console.log(
    `已创建 ${seeded.workflows} 个工作流、${seeded.runs} 个运行实例、${seeded.memories} 条记忆。`,
  )
  console.log(`READY ${env.url}`)
  console.log(
    `打开侧栏会话「${env.title}」，进入「工作流中心」查看样例；触发示例在「${DEMO_WORKFLOW}」。`,
  )
  await stopping
} finally {
  await env.stop()
}
