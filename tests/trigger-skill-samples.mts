// 把 skill「场景示例」（skills/workflow-trigger/examples）里的脚本按 skill 说的流程走一遍：
// write_trigger 建卡片（插件放好 triggers/watch.mjs）→ 脚本写进卡片目录 → test_trigger。
// 命令照示例写在卡片目录里跑、用 {workspace} 找工作区里的东西；远端的事件投样本。
// usage: node --experimental-transform-types tests/trigger-skill-samples.mts
// biome-ignore-all lint/suspicious/noExplicitAny: 验收脚本，按名字读工具回来的 JSON，逐字段写类型不值得
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DATABASE_FILE, PluginDatabase } from '../src/host/store/database.ts'
import { assetsDir, pathKind } from '../src/host/store/paths.ts'
import { createRepository, reportProblems } from '../src/host/store/repository.ts'
import { createWorkflowLiteHandler } from '../src/host/tool/tool.ts'
import { cardDir, cardSecretsDir } from '../src/host/triggers/cardDirs.ts'
import { createTriggerGraphs, followWorkflows } from '../src/host/triggers/graphs.ts'
import { OwnerLock } from '../src/host/triggers/owner.ts'
import { TriggerService } from '../src/host/triggers/service.ts'
import { TriggerStore } from '../src/host/triggers/store.ts'
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
const workspace = join(root, 'ws').replace(/\\/g, '/')
await mkdir(workspace, { recursive: true })
const database = new PluginDatabase(() => join(dataDir, DATABASE_FILE))
const workflows = createRepository({
  dataDir,
  validate: (document, workflow) =>
    reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 })),
})
const store = new TriggerStore(workflows, database)
const repository = followWorkflows(workflows, store)
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
  lock: new OwnerLock({ database }),
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

let failed = 0
const cardIds = new Map<string, string>()
const pendingScripts = new Map<string, Map<string, string>>()

/** 建 / 改一张卡片（会话工作区选好），回它的卡片目录。 */
async function card(name: string, trigger: unknown): Promise<string | null> {
  const previous = cardIds.get(name)
  const written: any = await run({
    action: 'write_trigger',
    workflow: 'samples',
    ...(previous === undefined ? {} : { node: previous }),
    trigger,
    local: { workspace },
  } as never)
  if (written.error) {
    failed += 1
    console.log(`✗ ${name}: write_trigger ${written.error.message}`)
    return null
  }
  const id = written.trigger.id as string
  cardIds.set(name, id)
  const home = cardDir(dir, id)
  await mkdir(home, { recursive: true })
  for (const [file, code] of pendingScripts.get(name) ?? []) await script(name, file, code)
  pendingScripts.delete(name)
  return home
}

/** 把示例脚本写进卡片目录。 */
async function script(name: string, file: string, text: string): Promise<void> {
  const id = cardIds.get(name)
  if (id === undefined) {
    const files = pendingScripts.get(name) ?? new Map()
    files.set(file, text)
    pendingScripts.set(name, files)
    return
  }
  const path = join(cardDir(dir, id), file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

async function test(
  name: string,
  args: Record<string, unknown>,
  expect: (r: any) => string | null,
): Promise<any> {
  const result: any = await run({
    action: 'test_trigger',
    workflow: 'samples',
    node: cardIds.get(name),
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

/** 建好卡片再试一次。 */
async function check(
  name: string,
  trigger: unknown,
  args: Record<string, unknown>,
  expect: (r: any) => string | null,
): Promise<void> {
  if ((await card(name, trigger)) !== null) await test(name, args, expect)
}

const listen = (command: string, filter?: unknown) => ({
  source: { kind: 'listen', command },
  ...(filter ? { filter } : {}),
})
const checkEvery = (command: string, when = 'every', seconds = 300) => ({
  source: { kind: 'schedule', schedule: { kind: 'every', seconds }, check: { command, when } },
})
const nodeEval = (code: string, ...args: string[]) =>
  `node -e "${code}"${args.map((arg) => ` "${arg}"`).join('')}`

// 底子：建第一张要跑命令的卡片时插件放好，之后不换。
await card('folder', listen('node watch-folder.mjs "{workspace}/inbox"'))
const kit = join(dir, 'triggers', 'watch.mjs')
if ((await pathKind(kit)) !== 'file') {
  failed += 1
  console.log('✗ kit: 建了要跑命令的卡片，triggers/watch.mjs 却不在')
} else console.log('✓ kit: triggers/watch.mjs 放好了')

// 文件夹里有新文件：第一次只记下已有的；poke 放进一个新文件后触发一次。
await mkdir(join(workspace, 'inbox'), { recursive: true })
await writeFile(join(workspace, 'inbox', 'old.txt'), 'x')
await script('folder', 'watch-folder.mjs', await block('folder'))
await test(
  'folder',
  {
    seconds: 8,
    poke: nodeEval(
      "require('fs').writeFileSync(process.argv[1] + '/new-' + Date.now() + '.txt', 'x')",
      '{workspace}/inbox',
    ),
  },
  (r) =>
    r.verdict === 'fire' && r.events?.length === 1 && r.events[0].text.includes('new-')
      ? null
      : '要只收到新文件那一行',
)

// 日志里出现关键字：INFO 被挡；ERROR 连同缩进的堆栈是一件、堆栈在末尾的 JSON 里；合并 0 时各算各的。
const log = `${workspace}/logs/app.log`
await mkdir(join(workspace, 'logs'), { recursive: true })
await writeFile(log, 'old ERROR before start\n')
await script('log', 'tail-log.mjs', await block('log'))
const tail = 'node tail-log.mjs "{workspace}/logs/app.log"'
await check(
  'log',
  listen(tail, { include: ['ERROR'], merge: 0 }),
  {
    seconds: 6,
    poke: nodeEval(
      "require('fs').appendFileSync(process.argv[1], 'INFO fine\\nERROR pay failed\\n  at Pay.charge(Pay.java:42)\\n')",
      '{workspace}/logs/app.log',
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
await test('log', { seconds: 4 }, (r) =>
  r.events?.length === 1 && r.events[0].text.includes('while off')
    ? null
    : '要补上没在跑时写进去的那一件',
)
// 合并回到缺省的 5 秒（单项回到缺省写缺省值）：挨着的两件并成一次，消息里注明合并了几次。
await check(
  'log',
  listen(tail, { merge: 5 }),
  {
    seconds: 6,
    poke: nodeEval(
      "require('fs').appendFileSync(process.argv[1], 'ERROR one\\nERROR two\\n')",
      '{workspace}/logs/app.log',
    ),
  },
  (r) =>
    r.events?.length === 2 && r.fires === 1 && r.message.includes('2 次触发合并')
      ? null
      : '两件要并成一次',
)

// 远端有新提交：本地建一个裸仓库当 origin，工作区是它的克隆；第一次只记下，推一个新提交后列出这一段。
const origin = join(root, 'origin.git')
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })
git(root, 'init', '--bare', '-q', '-b', 'main', origin)
git(workspace, 'init', '-q', '-b', 'main')
git(workspace, 'config', 'user.email', 't@t')
git(workspace, 'config', 'user.name', 't')
git(workspace, 'commit', '-q', '--allow-empty', '-m', 'first')
git(workspace, 'remote', 'add', 'origin', origin)
git(workspace, 'push', '-q', 'origin', 'main')
await script('commits', 'new-commits.mjs', await block('git-commits'))
const commitCheck = JSON.parse(await block('git-commits', 0, 'json'))
await check('commits', { source: commitCheck }, {}, (r) =>
  r.verdict === 'skip' && r.run?.code === 1 ? null : '第一次要只记下（返回 1）',
)
git(workspace, 'commit', '-q', '--allow-empty', '-m', 'second change')
git(workspace, 'push', '-q', 'origin', 'main')
await test('commits', {}, (r) =>
  r.verdict === 'fire' && r.run?.stdout.includes('second change')
    ? null
    : '推了新提交要触发并列出它',
)
await test('commits', {}, (r) => (r.verdict === 'skip' ? null : '没有新提交要不触发'))

// 网页里某一块变了：本地起一个页面。
const server = createServer((_q, s) =>
  s.end(`<html><h2 class="release">v1.2.3</h2><p>${Date.now()}</p></html>`),
).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
await script('web', 'web-part.mjs', await block('web-change'))
await check('web', checkEvery(`node web-part.mjs ${url}`, 'change'), {}, (r) =>
  r.run?.code === 0 && r.run.stdout === 'v1.2.3' && r.summary.includes('第一次')
    ? null
    : '要只打出 v1.2.3，第一次只记下',
)
server.close()

// 指定时刻只跑一次：今天 → 第一次 0、第二次 1；别的日子 1。
await script('once', 'once.mjs', await block('once'))
const today = new Date().toLocaleDateString('sv')
await check('once', checkEvery(`node once.mjs ${today}`), {}, (r) =>
  r.verdict === 'fire' ? null : '今天要触发',
)
await test('once', {}, (r) => (r.verdict === 'skip' ? null : '跑过了要不再触发'))
await check('once', checkEvery('node once.mjs 2000-01-01'), {}, (r) =>
  r.verdict === 'skip' ? null : '别的日子不触发',
)

// 每月最后一个工作日：只看跑得通、退出码是 0 或 1。
await script('workday', 'last-workday.mjs', await block('last-workday'))
await check('workday', checkEvery('node last-workday.mjs'), {}, (r) =>
  [0, 1].includes(r.run?.code) ? null : '退出码要是 0 或 1',
)

// 一个状态变了：投一份「挂了」的样本，打一件。
await script('state', 'health.mjs', await block('state'))
await script(
  'state',
  'samples/down.json',
  '{"url": "https://app.example.com/healthz", "status": "down", "reason": "返回 502"}',
)
await check(
  'state',
  listen('node health.mjs "http://127.0.0.1:9/healthz"'),
  { seconds: 5, poke: 'node ../watch.mjs inject samples/down.json' },
  (r) =>
    r.events?.length === 1 && r.events[0].text.includes('挂了：返回 502')
      ? null
      : '投的样本要打成一件',
)

// 回调要验签名：secret 放密钥目录；poke 是示例里按同一个 secret 签名发请求的小脚本。
await script('webhook', 'hook.mjs', await block('webhook'))
await script('webhook', 'hook-poke.mjs', await block('webhook', 1))
await mkdir(cardSecretsDir(dir, 'webhook'), { recursive: true })
await writeFile(join(cardSecretsDir(dir, 'webhook'), 'github-secret.txt'), 's3cret\n')
await check(
  'webhook',
  listen('node hook.mjs 3801'),
  { seconds: 6, poke: 'node hook-poke.mjs 3801' },
  (r) =>
    r.fires === 1 &&
    r.events?.length === 1 &&
    r.events[0].text.startsWith('acme/app 来了 pull_request：#7 试一下') &&
    /返回 202/.test(r.poke?.output ?? '')
      ? null
      : '签名对的请求要 202、打一行',
)

// GitLab：拿一段样例请求体过过滤。
await check(
  'gitlab',
  { source: { kind: 'http' }, filter: { include: ['"object_kind":"merge_request"'] } },
  { body: '{"object_kind":"merge_request","object_attributes":{"action":"open"}}' },
  (r) => (r.verdict === 'fire' ? null : 'MR 事件要通过'),
)
await test('gitlab', { body: '{"object_kind":"push"}' }, (r) =>
  r.verdict === 'skip' ? null : 'push 要被挡',
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
await triggers.stop()
database.close()
await rm(root, { recursive: true, force: true }).catch(() => undefined)
process.exit(failed === 0 ? 0 : 1)
