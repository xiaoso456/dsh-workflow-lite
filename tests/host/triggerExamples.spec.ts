/**
 * skill `workflow-trigger` 里监视的例子照文档原样跑一遍：脚本取自文档里的代码块，命令、`poke`、样本、`seconds`
 * 取自文档的原话，走 `test_trigger` 同一条路（{@link testCard}）：在卡片目录里跑，`{workflow}`、`{workspace}`、
 * 环境变量和插件给的一样。只换掉文档里指向别人机器的那几样（对方的地址、端口），文档改坏了这里会红。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { cardDataDir, cardDir, cardSecretsDir } from '../../src/host/triggers/cardDirs.ts'
import { type CardTestResult, testCard } from '../../src/host/triggers/cardTest.ts'
import { placeKit } from '../../src/host/triggers/kit.ts'
import { bindWorkflowVar, bindWorkspaceVar } from '../../src/shared/pathVars.ts'
import type { TriggerData, TriggerFilter } from '../../src/shared/types.ts'

const SKILL = fileURLToPath(new URL('../../skills/workflow-trigger/', import.meta.url))
const doc = (rel: string): string => readFileSync(join(SKILL, rel), 'utf8')

/** 文档里某种语言的代码块，按出现的先后。 */
function blocks(text: string, lang: string): string[] {
  return [...text.matchAll(new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\`\`\``, 'gu'))].map(
    (match) => match[1] as string,
  )
}

/** 文档里第一处匹配（取第一组）；没有就让测试红，说清楚缺的是什么。 */
function pick(text: string, pattern: RegExp, what: string): string {
  const found = pattern.exec(text)?.[1]
  if (found === undefined) throw new Error(`文档里找不到${what}`)
  return found
}

const commandOf = (text: string): string => pick(text, /命令 `([^`]+)`/u, '命令')
const pokeOf = (text: string): string => pick(text, /`poke` 写 `([^`]+)`/u, ' poke')
const secondsOf = (text: string): number | undefined => {
  const found = /`seconds` 写 (\d+)/u.exec(text)?.[1]
  return found === undefined ? undefined : Number(found)
}
/** 「存卡片目录的 `samples/x.json`：`{…}`」：样本的文件名和内容。 */
function sampleOf(text: string): { name: string; body: string } {
  const match = /卡片目录的 `samples\/([\w-]+\.json)`：`([^`]+)`/u.exec(text)
  if (match === null) throw new Error('文档里找不到样本')
  JSON.parse(match[2] as string)
  return { name: match[1] as string, body: match[2] as string }
}

const scratch = mkdtempSync(join(tmpdir(), 'wl-trigger-examples-'))
const servers: Server[] = []
afterAll(() => {
  for (const server of servers) server.close()
  rmSync(scratch, { recursive: true, force: true })
})

/** 一个工作流目录（插件放好了底子）、这张卡片的目录（命令在这里跑）、会话工作区、试运行的数据目录、密钥目录。 */
async function setup(name: string) {
  const root = join(scratch, name)
  const workflow = join(root, 'workflow').replaceAll('\\', '/')
  const home = cardDir(workflow, 'tick')
  const paths = {
    workflow,
    home,
    workspace: join(root, 'workspace').replaceAll('\\', '/'),
    data: cardDataDir(workflow, 'tick', true),
    secrets: cardSecretsDir(workflow, 'tick'),
  }
  for (const dir of [join(home, 'samples'), paths.workspace, paths.data, paths.secrets]) {
    mkdirSync(dir, { recursive: true })
  }
  await placeKit(workflow) // 和插件写要跑命令的卡片时一样放好底子
  return {
    ...paths,
    /** 把脚本写进卡片目录，文件名取自命令（`node xxx.mjs …`）。 */
    script(command: string, code: string): void {
      writeFileSync(join(home, pick(command, /^node ([\w-]+\.mjs)/u, '脚本名')), code)
    },
    sample(text: string): void {
      const { name: file, body } = sampleOf(text)
      writeFileSync(join(home, 'samples', file), body)
    },
    /** 和 `test_trigger` 一样试一次。 */
    run(
      command: string,
      options: { poke?: string; seconds?: number | undefined },
      filter: Partial<TriggerFilter> = {},
    ): Promise<CardTestResult> {
      const data: TriggerData = {
        source: { kind: 'listen', command },
        filter: { merge: 0, ...filter },
        note: '试',
      }
      return testCard({
        workflow: 'demo',
        trigger: { node: 'tick', name: '试', data, runState: true, choice: {}, workflowChoice: {} },
        now: Date.now(),
        spec: {
          command: bindWorkspaceVar(bindWorkflowVar(command, workflow), paths.workspace),
          cwd: home,
          env: {
            WORKFLOW_DIR: workflow,
            TRIGGER_WORKSPACE: paths.workspace,
            TRIGGER_DATA_DIR: paths.data,
            TRIGGER_SECRETS_DIR: paths.secrets,
          },
        },
        infoFile: 'f.txt',
        options: {
          ...(options.poke === undefined ? {} : { poke: options.poke }),
          ...(options.seconds === undefined ? {} : { seconds: options.seconds }),
        },
      })
    },
  }
}

/** 错误输出里脚本自己打的（去掉 Node 自己的警告：有的机器上开了代理之类，每个 node 进程都会打一条）。 */
const errors = (result: CardTestResult): string =>
  (result.run?.stderr ?? '')
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '' && !/^\((node|Use `node)/u.test(line))
    .join('\n')

const passed = (result: CardTestResult): string[] =>
  (result.events ?? []).filter((event) => event.result === 'pass').map((event) => event.text)

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  await new Promise((done) => server.close(done))
  return port
}

describe.concurrent('skill 里的监视例子照文档原样能跑', () => {
  it('listen.md「从头到尾一个例子」：命令、脚本、poke 一字不改', async () => {
    const text = doc('listen.md')
    const definition = JSON.parse(blocks(text, 'json')[0] as string) as {
      source: { command: string }
      filter: Partial<TriggerFilter>
    }
    const box = await setup('listen')
    box.script(definition.source.command, blocks(text, 'js')[0] as string)
    const result = await box.run(
      definition.source.command,
      { poke: (blocks(text, 'text')[0] as string).trim(), seconds: secondsOf(text) },
      definition.filter,
    )
    expect(result.poke?.code).toBe(0)
    expect(result.events).toHaveLength(1)
    expect(passed(result)[0]).toMatch(/^任务清单里来了新任务 #\d+：试一下 \{"id":\d+\}$/u)
    expect(result.logs?.first.map((line) => line.text).join('\n')).toContain('第一次运行')
    expect(result.run?.exited).toBeUndefined()
    expect(errors(result)).toBe('')
  }, 60_000)

  it('examples/folder.md：已有的文件不报，poke 放进来的写完才报', async () => {
    const text = doc('examples/folder.md')
    const box = await setup('folder')
    const inbox = join(box.workspace, 'inbox')
    mkdirSync(inbox)
    writeFileSync(join(inbox, 'old.txt'), 'x')
    const command = commandOf(text)
    box.script(command, blocks(text, 'js')[0] as string)
    const result = await box.run(command, { poke: pokeOf(text), seconds: secondsOf(text) })
    expect(result.poke?.code).toBe(0)
    expect(passed(result)).toHaveLength(1)
    expect(passed(result)[0]).toContain('test-')
    expect(passed(result)[0]).not.toContain('old.txt')
    expect(errors(result)).toBe('')
  }, 60_000)

  it('examples/log.md：旧日志不报；追加的按关键字过，堆栈并进同一件', async () => {
    const text = doc('examples/log.md')
    const box = await setup('log')
    mkdirSync(join(box.workspace, 'logs'))
    writeFileSync(join(box.workspace, 'logs', 'app.log'), 'ERROR old one\n')
    const command = commandOf(text)
    box.script(command, blocks(text, 'js')[0] as string)
    const include = JSON.parse(
      pick(text, /`filter\.include`（如 `([^`]+)`）/u, '关键字'),
    ) as string[]
    const poke = pick(text, /`poke` [^`]*如 `([^`]+)`/u, ' poke')
    const result = await box.run(command, { poke }, { include })
    expect(result.poke?.code).toBe(0)
    expect(result.events?.map((event) => event.result)).toEqual([
      expect.stringMatching(/^keyword/u),
      'pass',
    ])
    expect(passed(result)).toEqual([
      'app.log 出现：ERROR pay failed {"stack":["at Pay.charge(Pay.java:42)"]}',
    ])
    expect(errors(result)).toBe('')
  }, 60_000)

  it('examples/state.md：服务好着不报；投进来的样本打成一行', async () => {
    const text = doc('examples/state.md')
    const box = await setup('state')
    const url = await serve((_, response) => response.writeHead(200).end('ok'))
    const command = commandOf(text).replace('"https://app.example.com/healthz"', `"${url}/healthz"`)
    box.script(command, blocks(text, 'js')[0] as string)
    box.sample(text)
    const result = await box.run(command, { poke: pokeOf(text), seconds: secondsOf(text) })
    expect(result.poke?.code).toBe(0)
    expect(passed(result)).toEqual([
      'https://app.example.com/healthz 挂了：返回 502 {"url":"https://app.example.com/healthz","status":"down"}',
    ])
    expect(errors(result)).toBe('')
  }, 60_000)

  it('examples/records.md：缺令牌说清楚放哪；有令牌时第一次只记下，投进来的样本打成一行、没有鉴权错误', async () => {
    const text = doc('examples/records.md')
    const box = await setup('records')
    const api = await serve((request, response) => {
      if (request.headers.authorization !== 'Bearer t0k')
        return void response.writeHead(401).end('no')
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"items":[]}')
    })
    const command = commandOf(text).replace(
      'https://tracker.example.com/api/issues',
      `${api}/api/issues`,
    )
    box.script(command, blocks(text, 'js')[0] as string)
    box.sample(text)
    const missing = await box.run(command, { seconds: 2 })
    expect(missing.run?.exited).toBe(true)
    expect(errors(missing)).toContain('缺访问令牌')
    expect(errors(missing)).toContain(join(box.secrets, 'token.txt'))
    writeFileSync(join(box.secrets, 'token.txt'), 't0k\n')
    const result = await box.run(command, { poke: pokeOf(text), seconds: secondsOf(text) })
    expect(result.poke?.code).toBe(0)
    expect(passed(result)).toEqual([
      '工单 #101「登录失败」新建 {"id":101,"url":"https://tracker.example.com/issues/101"}',
    ])
    expect(result.logs?.first.map((line) => line.text).join('\n')).toContain('第一次运行')
    expect(errors(result)).toBe('')
  }, 60_000)

  it('examples/push.md：没装客户端时退避重连、不退出；投进来的样本打成一行', async () => {
    const text = doc('examples/push.md')
    const box = await setup('push')
    const command = commandOf(text)
    box.script(command, blocks(text, 'js')[0] as string)
    box.sample(text)
    const result = await box.run(command, { poke: pokeOf(text), seconds: secondsOf(text) })
    expect(result.poke?.code).toBe(0)
    expect(passed(result)).toEqual(['主题 alerts/test 来了消息：disk full'])
    expect(result.run?.exited).toBeUndefined()
  }, 60_000)

  it('examples/webhook.md：照文档的小脚本发签过名的请求打一行；签名不对的回 401、不打', async () => {
    const text = doc('examples/webhook.md')
    const box = await setup('webhook')
    const port = String(await freePort())
    const command = commandOf(text).replace('3801', port)
    box.script(command, blocks(text, 'js')[0] as string)
    const poke = pokeOf(text).replace('3801', port)
    box.script(poke, blocks(text, 'js')[1] as string)
    writeFileSync(join(box.secrets, 'github-secret.txt'), 's3cret\n')
    const right = await box.run(command, { poke, seconds: 4 })
    expect(right.poke?.output).toContain('返回 202')
    expect(passed(right)).toEqual([
      'acme/app 来了 pull_request：#7 试一下 {"event":"pull_request"}',
    ])
    expect(errors(right)).toBe('')
    const forged = `node -e "fetch('http://127.0.0.1:${port}/',{method:'POST',body:'{}',headers:{'x-github-event':'push','x-hub-signature-256':'sha256=00'}}).then((r)=>console.log('返回 '+r.status))"`
    const wrong = await box.run(command, { poke: forged, seconds: 4 })
    expect(wrong.poke?.output).toContain('返回 401')
    expect(wrong.events).toEqual([])
    expect(errors(wrong)).toContain('签名不对')
  }, 60_000)
})
