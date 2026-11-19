// 把 skill「场景示例」（skills/workflow-trigger/examples）里的脚本按 skill 说的流程走一遍：写进工作流目录 → write_trigger → test_trigger。
// usage: node --experimental-transform-types tests/trigger-skill-samples.mts
// biome-ignore-all lint/suspicious/noExplicitAny: 验收脚本，按名字读工具回来的 JSON，逐字段写类型不值得
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DATABASE_FILE, PluginDatabase } from '../src/host/store/database.ts'
import { assetsDir } from '../src/host/store/paths.ts'
import { createRepository, reportProblems } from '../src/host/store/repository.ts'
import { createWorkflowLiteHandler } from '../src/host/tool/tool.ts'
import { createTriggerGraphs, followWorkflows } from '../src/host/triggers/graphs.ts'
import { TriggerService } from '../src/host/triggers/service.ts'
import { cardDataDir, TriggerStore } from '../src/host/triggers/store.ts'
import { validateDocument } from '../src/shared/validate.ts'

/** 场景示例文件里第 n 个代码块。 */
async function block(file: string, n = 0, lang = 'js'): Promise<string> {
  const md = (await readFile(`skills/workflow-trigger/examples/${file}.md`, 'utf8')).replace(
    /\r\n/g,
    '\n',
  )
  const fence = '```'
  const blocks = md
    .split(`${fence}${lang}\n`)
    .slice(1)
    .map((part) => part.slice(0, part.indexOf(fence)))
  if (blocks[n] === undefined) throw new Error(`${file} 没有第 ${n} 个 ${lang} 代码块`)
  return blocks[n]
}

const root = await mkdtemp(join(tmpdir(), 'wl-skill-samples-'))
const dataDir = join(root, 'data')
const workspace = join(root, 'ws')
await mkdir(workspace, { recursive: true })
const database = new PluginDatabase(() => join(dataDir, DATABASE_FILE))
const store = new TriggerStore(() => dataDir, database)
const repository = followWorkflows(
  createRepository({
    dataDir,
    validate: (document, workflow) =>
      reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 })),
  }),
  store,
)
await repository.ensureLayout()
const triggers = new TriggerService({
  dataDir: () => dataDir,
  store,
  graphs: createTriggerGraphs(repository),
  sessions: {
    unavailable: () => null,
    open: async () => ({ session: 's', fallbacks: [] }),
    send: async () => {},
    prepare: async () => [],
    catalog: async () => ({ presets: [], providers: [], failures: [], modelSelectable: null }),
  },
  listen: () => ({ host: '127.0.0.1', port: 3999 }),
  runs: {
    finished: async () => ({ runs: [], ids: [] }),
    stateOf: async () => null,
    newest: async () => null,
  },
})
const run = createWorkflowLiteHandler({
  repository,
  dataDir: () => dataDir,
  maxResultBytes: () => 1 << 20,
  triggers,
})
await repository.create('samples')
const dir = assetsDir(dataDir, 'samples')
await mkdir(join(dir, 'triggers'), { recursive: true })

let failed = 0
async function check(
  name: string,
  trigger: unknown,
  args: Record<string, unknown>,
  expect: (r: any) => string | null,
) {
  const written: any = await run({
    action: 'write_trigger',
    workflow: 'samples',
    node: name,
    trigger,
    local: { workspace },
  } as never)
  if (written.error) {
    failed += 1
    return console.log(`✗ ${name}: write_trigger ${written.error.message}`)
  }
  const result: any = await run({
    action: 'test_trigger',
    workflow: 'samples',
    node: name,
    ...args,
  } as never)
  if (process.env.DUMP === name) console.log(JSON.stringify(result, null, 2))
  const problem = result.error ? result.error.message : expect(result)
  if (problem !== null) failed += 1
  console.log(
    `${problem === null ? '✓' : '✗'} ${name}: ${result.verdict ?? ''} ${result.summary ?? ''}${problem === null ? '' : `\n    → ${problem}\n    ${JSON.stringify({ run: result.run, poke: result.poke, events: result.events, logs: result.logs, notes: result.notes }).slice(0, 800)}`}`,
  )
  return result
}
const listen = (command: string, filter?: unknown) => ({
  source: { kind: 'listen', command },
  ...(filter ? { filter } : {}),
})
const checkEvery = (command: string, when = 'every', seconds = 300) => ({
  source: { kind: 'schedule', schedule: { kind: 'every', seconds }, check: { command, when } },
})
const nodeEval = (code: string) => `node -e "${code}"`

// 文件夹里有新文件：第一次只记下已有的；poke 放进一个新文件后触发一次。
const inbox = join(workspace, 'inbox').replace(/\\/g, '/')
await mkdir(inbox, { recursive: true })
await writeFile(join(inbox, 'old.txt'), 'x')
await writeFile(join(dir, 'triggers', 'watch-folder.mjs'), await block('folder'))
await check(
  'folder',
  listen(`node "{workflow}/triggers/watch-folder.mjs" "${inbox}"`),
  {
    seconds: 8,
    poke: nodeEval(`require('fs').writeFileSync('${inbox}/new-' + Date.now() + '.txt', 'x')`),
  },
  (r) =>
    r.verdict === 'fire' && r.events?.length === 1 && r.events[0].text.includes('new-')
      ? null
      : '要只收到新文件那一行',
)

// 日志里出现关键字：INFO 被挡；ERROR 连同缩进的堆栈是一件、堆栈在末尾的 JSON 里；合并 0 时各算各的。
const log = join(workspace, 'app.log').replace(/\\/g, '/')
await writeFile(log, 'old ERROR before start\n')
await writeFile(join(dir, 'triggers', 'tail-log.mjs'), await block('log'))
const tail = `node "{workflow}/triggers/tail-log.mjs" "${log}"`
await check(
  'log',
  listen(tail, { include: ['ERROR'], merge: 0 }),
  {
    seconds: 6,
    poke: nodeEval(
      `require('fs').appendFileSync('${log}', 'INFO fine\\nERROR pay failed\\n  at Pay.charge(Pay.java:42)\\n')`,
    ),
  },
  (r) => {
    const results = r.events?.map((l: any) => l.result)
    if (
      JSON.stringify(results) !== JSON.stringify(['keyword: 不含 「ERROR」 中的任何一个', 'pass'])
    )
      return '要 INFO 被挡、ERROR 通过（旧日志不算）'
    if (
      r.events[1].text !== 'app.log 出现：ERROR pay failed {"stack":["at Pay.charge(Pay.java:42)"]}'
    )
      return `堆栈要并进同一件：${r.events[1].text}`
    return r.fires === 1 ? null : '要触发 1 次'
  },
)
// 程序没在跑时写进去的：下次启动接着读。
await writeFile(log, `${await readFile(log, 'utf8')}ERROR while off\n`)
await check('log', listen(tail, { include: ['ERROR'], merge: 0 }), { seconds: 4 }, (r) =>
  r.events?.length === 1 && r.events[0].text.includes('while off')
    ? null
    : '要补上没在跑时写进去的那一件',
)
// 缺省合并 5 秒：挨着的两件并成一次，消息里注明合并了几次。
await check(
  'log',
  listen(tail, { include: ['ERROR'] }),
  {
    seconds: 6,
    poke: nodeEval(`require('fs').appendFileSync('${log}', 'ERROR one\\nERROR two\\n')`),
  },
  (r) =>
    r.events?.length === 2 && r.fires === 1 && r.message.includes('2 次触发合并')
      ? null
      : '两件要并成一次',
)

// 远端有新提交：本地建一个裸仓库当 origin；第一次只记下，推一个新提交后列出这一段。
const origin = join(root, 'origin.git')
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
git(root, 'init', '--bare', '-q', '-b', 'main', origin)
git(workspace, 'init', '-q', '-b', 'main')
git(workspace, 'config', 'user.email', 't@t')
git(workspace, 'config', 'user.name', 't')
git(workspace, 'commit', '-q', '--allow-empty', '-m', 'first')
git(workspace, 'remote', 'add', 'origin', origin)
git(workspace, 'push', '-q', 'origin', 'main')
await writeFile(join(dir, 'triggers', 'new-commits.mjs'), await block('git-commits'))
const commitCheck = JSON.parse(await block('git-commits', 0, 'json'))
await check('commits', { source: commitCheck }, {}, (r) =>
  r.verdict === 'skip' && r.run?.code === 1 ? null : '第一次要只记下（返回 1）',
)
git(workspace, 'commit', '-q', '--allow-empty', '-m', 'second change')
git(workspace, 'push', '-q', 'origin', 'main')
await check('commits', { source: commitCheck }, {}, (r) =>
  r.verdict === 'fire' && r.run?.stdout.includes('second change')
    ? null
    : '推了新提交要触发并列出它',
)
await check('commits', { source: commitCheck }, {}, (r) =>
  r.verdict === 'skip' ? null : '没有新提交要不触发',
)

// 网页里某一块变了：本地起一个页面。
const server = createServer((_q, s) =>
  s.end(`<html><h2 class="release">v1.2.3</h2><p>${Date.now()}</p></html>`),
).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
await writeFile(join(dir, 'triggers', 'web-part.mjs'), await block('web-change'))
await check(
  'web',
  checkEvery(`node "{workflow}/triggers/web-part.mjs" ${url}`, 'change'),
  {},
  (r) =>
    r.run?.code === 0 && r.run.stdout === 'v1.2.3' && r.summary.includes('第一次')
      ? null
      : '要只打出 v1.2.3，第一次只记下',
)
server.close()

// 指定时刻只跑一次：今天 → 第一次 0、第二次 1；别的日子 1。
await writeFile(join(dir, 'triggers', 'once.mjs'), await block('once'))
const today = new Date().toLocaleDateString('sv')
await check('once', checkEvery(`node "{workflow}/triggers/once.mjs" ${today}`), {}, (r) =>
  r.verdict === 'fire' ? null : '今天要触发',
)
await check('once', checkEvery(`node "{workflow}/triggers/once.mjs" ${today}`), {}, (r) =>
  r.verdict === 'skip' ? null : '跑过了要不再触发',
)
await check('once', checkEvery(`node "{workflow}/triggers/once.mjs" 2000-01-01`), {}, (r) =>
  r.verdict === 'skip' ? null : '别的日子不触发',
)

// 每月最后一个工作日：只看跑得通、退出码是 0 或 1。
await writeFile(join(dir, 'triggers', 'last-workday.mjs'), await block('last-workday'))
await check('workday', checkEvery(`node "{workflow}/triggers/last-workday.mjs"`), {}, (r) =>
  [0, 1].includes(r.run?.code) ? null : '退出码要是 0 或 1',
)

// GitHub：密钥放数据目录；poke 按同样的密钥签一段请求体发过去。
await writeFile(join(dir, 'triggers', 'github-hook.mjs'), await block('github'))
await run({
  action: 'write_trigger',
  workflow: 'samples',
  node: 'github',
  trigger: listen('node x'),
  local: { workspace },
} as never)
const pokeScript = join(root, 'gh-poke.mjs')
await writeFile(
  pokeScript,
  `import { createHmac } from 'node:crypto'
const body = JSON.stringify({ action: 'opened', repository: { full_name: 'a/b' }, pull_request: { number: 7, title: 'Fix', html_url: 'u' } })
const sign = (s) => 'sha256=' + createHmac('sha256', s).update(body).digest('hex')
for (const [secret, event] of [['wrong', 'pull_request'], ['s3cret', 'ping'], ['s3cret', 'pull_request']]) {
  const r = await fetch('http://127.0.0.1:3801/', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(secret), 'x-github-event': event } })
  console.log(event, r.status)
}
`,
)
for (const trial of [false, true]) {
  const data = cardDataDir(dataDir, 'samples', 'github', trial)
  await mkdir(data, { recursive: true })
  await writeFile(join(data, 'github-secret.txt'), 's3cret\n')
}
await check(
  'github',
  listen(`node "{workflow}/triggers/github-hook.mjs" 3801`, {
    include: ['来了 pull_request'],
  }),
  { seconds: 6, poke: `node "${pokeScript.replace(/\\/g, '/')}"` },
  (r) =>
    r.fires === 1 &&
    r.events?.length === 1 &&
    r.events[0].text.startsWith('a/b 来了 pull_request（opened）：#7 Fix') &&
    /pull_request 202/.test(r.poke?.output ?? '') &&
    /401/.test(r.poke?.output ?? '')
      ? null
      : '签名不对的 401、ping 不打行、PR 打一行',
)

// GitLab：拿一段样例请求体过过滤。
await check(
  'gitlab',
  { source: { kind: 'http' }, filter: { include: ['"object_kind":"merge_request"'] } },
  { body: '{"object_kind":"merge_request","object_attributes":{"action":"open"}}' },
  (r) => (r.verdict === 'fire' ? null : 'MR 事件要通过'),
)
await check(
  'gitlab',
  { source: { kind: 'http' }, filter: { include: ['"object_kind":"merge_request"'] } },
  { body: '{"object_kind":"push"}' },
  (r) => (r.verdict === 'skip' ? null : 'push 要被挡'),
)

if (process.env.DUMP === 'read')
  console.log(
    JSON.stringify(
      await run({
        action: 'read',
        workflow: 'samples',
        node: 'commits',
        include: ['history', 'output'],
      } as never),
      null,
      2,
    ),
  )
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 个不对`)
process.exit(failed === 0 ? 0 : 1)
