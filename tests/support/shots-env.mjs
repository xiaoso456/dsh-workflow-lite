/**
 * dsh-workflow-lite — 截图管线的"自备环境"：一个临时 profile + 一个随机端口的实例。
 *
 * 三条要求：**跨平台、幂等、不写死端口**。
 * 接线照 `dsh-bash-plus/tests/support/harness/support.ts` 的先例：
 * 生成 profile 的 `package.json` 与 `cordis.patch.yml`，把模型接到 `mock-llm.mjs`。
 *
 * @module tests/support/shots-env
 */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockLlm } from './mock-llm.mjs'

/** 仓库根（本文件在 `<repo>/tests/support/`）。 */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
/**
 * dsh 家目录；`DSH_HOME` 可覆盖。
 *
 * 每次现读，不固化成模块常量：调用方要能把整跑指到一个一次性的家去（`tests/runs/` 下），
 * 那就得能在 import 之后再改。
 * @returns {string} 目录。
 */
export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}
/** 截图专用 profile 名。 */
export const SHOTS_PROFILE = 'workflow-lite-shots'
/**
 * dsh 可执行文件；`DSH_BIN` 可覆盖。理由同 {@link dshHome}。
 * @returns {string} 可执行名。
 */
export function dshBin() {
  return process.env.DSH_BIN ?? 'dsh'
}
/** 假模型的 API key 环境变量名（值随便，本地假服务不校验）。 */
export const MOCK_KEY_ENV = 'MOCK_LLM_KEY'
const MOCK_KEY = 'mock-key'

/** 这个 profile 要装的 bundles（与 `workflow-lite-dev` 对齐，够出封面用）。 */
export const SHOTS_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@xiaoso/dsh-workflow-lite',
]

/**
 * 生成（或重写）截图专用 profile：幂等，重复跑结果一致。
 * @param {{ mockUrl: string, dataDir: string, theme?: 'light' | 'dark', profile?: string }} options
 * @returns {string} profile 目录
 */
export function prepareShotsProfile(options) {
  const name = options.profile ?? SHOTS_PROFILE
  const dir = join(dshHome(), 'profiles', name)
  mkdirSync(join(dir, 'node_modules', '@xiaoso'), { recursive: true })

  // 把本仓库链进 profile：Windows 用 junction（不需要管理员），其它平台用普通目录符号链接
  const link = join(dir, 'node_modules', '@xiaoso', 'dsh-workflow-lite')
  rmSync(link, { recursive: true, force: true })
  symlinkSync(REPO_ROOT, link, process.platform === 'win32' ? 'junction' : 'dir')

  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: `dsh-profile-${name}`,
        private: true,
        dependencies: { '@xiaoso/dsh-workflow-lite': `link:${REPO_ROOT.replaceAll('\\', '/')}` },
        dsh: { profile: { bundles: SHOTS_BUNDLES, patchReload: 'startup' } },
      },
      null,
      2,
    )}\n`,
  )

  writeFileSync(
    join(dir, 'cordis.patch.yml'),
    generatedPatch({ ...options, dataDir: options.dataDir.replaceAll('\\', '/') }),
  )
  return dir
}

/**
 * profile 补丁：画布数据根、暗色、假供应商、默认模型与 preset。
 * 全文件由脚本生成——别手改，改了下次跑会被覆盖。
 * @param {{ mockUrl: string, dataDir: string, theme?: 'light' | 'dark' }} options
 * @returns {string} YAML
 */
function generatedPatch(options) {
  return `# 由 tests/support/shots-env.mjs 生成，请勿手改：README 封面截图专用的接线。
# 模型接到 tests/support/mock-llm.mjs，全程不发真实模型请求。

- id: workflow-lite
  config:
    dataDir: ${options.dataDir}

- id: ui-theme
  name: "@deepseek-ai/dsh-client-ui-theme"
  config:
    preference: ${options.theme ?? 'dark'}

- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      mock:
        displayName: Mock
        apiKeyEnv: ${MOCK_KEY_ENV}
        api: openai-completions
        baseURL: ${options.mockUrl}
        models:
          - id: mock-model
            name: mock-model
            contextWindow: 100000
            input:
              - text

- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: mock
    model: mock-model

- id: agent-preset-registry
  name: "@deepseek-ai/dsh-agent-preset-registry"
  config:
    default: standard

- id: permission-presets
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    defaultPreset: danger-full-access
`
}

/**
 * 起一个 web 实例并等它打印带 token 的地址。
 * @param {{ profile?: string, port?: number, timeoutMs?: number }} [options]
 * @returns {Promise<{ base: string, token: string, url: string, stop: () => Promise<void>, output: () => string }>}
 */
export function startShotsInstance(options = {}) {
  const profile = options.profile ?? SHOTS_PROFILE
  const port = options.port ?? 0 // 0 = 让系统挑空闲端口，不写死
  const timeoutMs = options.timeoutMs ?? 120_000
  return new Promise((resolve, reject) => {
    const child = spawn(dshBin(), [profile, '--port', String(port), '--no-open'], {
      cwd: REPO_ROOT,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...process.env, [MOCK_KEY_ENV]: MOCK_KEY },
    })
    let output = ''
    const timer = setTimeout(() => {
      // stop() 自己会抛（kill 没生效时），这里必须吞掉再 reject：放在 setTimeout 的回调里
      // 抛出去就是 unhandled rejection，reject 永远轮不到，**外层 promise 永不落地**。
      // 先等它真的关掉再 reject 也一样——`void stop()` 那种不等的话，调用方一退出，
      // taskkill 就没机会跑，超时这一路照样漏一个后台实例。
      stop()
        .catch(() => {})
        .then(() => {
          reject(new Error(`实例 ${String(timeoutMs)}ms 内没打印地址；输出：\n${output}`))
        })
    }, timeoutMs)
    /**
     * 关掉实例，并**等它真的关掉**。
     *
     * 两层意思，缺一不可：
     * 1. 得等。随手 `spawn('taskkill', …)` 就走人的话，那是个异步子进程，调用方一退出
     *    taskkill 就没机会跑，实例留在后台占着会话的写句柄，下一次跑直接 `session/writer-held`。
     * 2. 兜底不能算成功。10 秒还没等到 `close` 就**抛**——只 `resolve` 的话，kill 失败会被
     *    当成功报上去，下一跑照样撞 `session/writer-held`，而错误信息指向别处。
     *    另外那个兜底定时器必须清掉，否则每次跑完进程都白活 10 秒。
     * @returns {Promise<void>}
     */
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
      const killed = new Promise((resolve, reject) => {
        let timer
        const done = () => {
          clearTimeout(timer)
          if (child.exitCode === null && child.signalCode === null) {
            reject(new Error(`实例 ${String(child.pid)} 没关掉（taskkill 没生效？）`))
            return
          }
          resolve(undefined)
        }
        child.once('close', done)
        timer = setTimeout(done, 10_000)
        if (process.platform !== 'win32') child.kill('SIGTERM')
      })
      if (child.pid !== undefined && process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      }
      return killed
    }
    const onData = (chunk) => {
      output += chunk.toString()
      const match = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([^\s]+)/u.exec(output)
      if (match === null) return
      clearTimeout(timer)
      // Ctrl-C 会直接终止 Node，顶层 finally 根本轮不到——实例就留下来了，占着会话写句柄，
      // 下一跑撞 `session/writer-held`。所以信号也当"收尾"处理（同 tests/lib/cdp-chrome-launch.mjs）。
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
          stop().finally(() => {
            process.exit(130)
          })
        })
      }
      resolve({
        base: `http://127.0.0.1:${match[1]}`,
        token: match[2],
        url: match[0],
        stop,
        output: () => output,
      })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      reject(new Error(`实例提前退出（code=${String(code)}）；输出：\n${output}`))
    })
  })
}

/** 截图夹具的固定标题：`enterSession` 按它点会话行，不靠"列表里显示几分钟前"。 */
export const SHOTS_SESSION_TITLE = '封面夹具'
/** 夹具会话的固定 id（幂等：重复跑复用同一条）。 */
export const SHOTS_SESSION_ID = 'session-hero-shots'

/**
 * 备好封面要拍的那份数据：工作区、会话、一条走假模型的消息，最后把标题改成固定的。
 *
 * 幂等靠**认领**：会话一旦建出来就跟着它的 cwd 走（拿同名会话换个目录再建，host 回
 * `session/conflict`，而 host 没有删会话的接口），所以先按 id 在列表里找——找到就用它自己的 cwd
 * 当工作区，没找到才建。重复跑永远收敛到同一个家，不残留第二条。
 * @param {(channel: string, method: string, request?: unknown, options?: { as?: string }) => Promise<unknown>} rpc
 * @param {{ workspaceDir: string, mock: { requests: unknown[] }, sessionId?: string, title?: string, prompt?: string }} options
 * @returns {Promise<{ workspaceId: string, workspaceDir: string, sessionId: string, title: string, adoptedWorkspace: boolean }>}
 */
export async function prepareShotsFixture(rpc, options) {
  const sessionId = options.sessionId ?? SHOTS_SESSION_ID
  const title = options.title ?? SHOTS_SESSION_TITLE
  // `mock` 是必填：下面那两条判据是"没发真实模型请求"的唯一凭据，做成可选就等于留了个
  // 把判据关掉的开关——一关，绿的跑法照样绿，而没人知道模型请求到底打给谁了。
  const mock = options.mock
  if (mock === undefined)
    throw new Error('prepareShotsFixture 必须拿到 mock，否则没法证明没发真实请求')

  const before = await rpc('session', 'list', {}, { as: '_request' })
  const existing = (before.items ?? []).find((item) => item.sessionId === sessionId)
  // 「认领」意味着这个目录可能是**上一次**跑出来的（甚至仓库搬过家之后的旧路径），
  // 不是这一次建的——调用方要据此决定能不能删它。
  const adoptedWorkspace = existing?.cwd !== undefined
  const workspaceDir = existing?.cwd ?? options.workspaceDir
  mkdirSync(workspaceDir, { recursive: true })

  const workspace = await rpc('workspace', 'create', { path: workspaceDir })
  const workspaceId = workspace.workspace.workspaceId
  if (existing === undefined) {
    await rpc('session', 'create', { workspaceId, sessionId, agentPreset: 'standard' })
  }

  // 空白会话页没有 tab，所以必须让它有一条消息；已经有了就不重复发
  if (existing?.blank !== false) {
    const served = mock.requests.length
    await rpc('session', 'prompt', {
      requestId: `shots-${String(Date.now())}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: options.prompt ?? '（截图夹具）随便回一句就行。' }],
    })
    // 「全程不发真实模型请求」这条要求得有**直接证据**，而且要对得上**这一轮**。
    //
    // 关键是别拿 `blank` 变 false 当完成信号：它只说明这条用户消息记下了，模型调用还在后面，
    // 两者之间差着几百毫秒——拿它当信号就是抢跑，会读到"假模型还没被叫到"，报一个**假红**。
    // （实测见过两种时序都出现过。）所以这里等的是**判据本身**：假模型收到请求。
    // 顺带它也就是那条断言：等不到就是红，不再从别的东西往回推。
    const deadline = Date.now() + 30_000
    while (mock.requests.length === served) {
      if (Date.now() > deadline) {
        throw new Error('这一轮 prompt 30 秒内没打到假模型上——真模型可能已经被调用了')
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    // 再等这一轮落成非空白：空白会话页没有 tab，后面按标题搜会话要的是非空白那条
    const blankDeadline = Date.now() + 30_000
    for (;;) {
      const now = await rpc('session', 'list', {}, { as: '_request' })
      if ((now.items ?? []).find((item) => item.sessionId === sessionId)?.blank === false) break
      if (Date.now() > blankDeadline) throw new Error('夹具会话 30 秒内仍未被标记为非空白')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  await rpc('session', 'rename', { sessionId, title })

  // 事后旁证（**不能单独用**）：投影里最近用过的模型应当是假供应商。轮询是因为它由
  // `request/header` 事件写、可能落在 `blank` 之后；重跑路径上它读的是上一轮的值，
  // 所以它只用来兜"夹具被别的东西污染过"，证明力靠上面那条。
  const deadline = Date.now() + 15_000
  for (;;) {
    const after = await rpc('session', 'list', {}, { as: '_request' })
    const used = (after.items ?? []).find((item) => item.sessionId === sessionId)?.projections
      ?.values?.modelSelection?.lastUsed
    if (used?.provider === 'mock') break
    if (Date.now() > deadline) {
      throw new Error(`夹具会话最近用的模型是 ${JSON.stringify(used)}，不是假供应商 mock`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return { workspaceId, workspaceDir, sessionId, title, adoptedWorkspace }
}

/**
 * 拿实例打印的 launch token 换一条浏览器会话 cookie。
 *
 * 立刻换、并把它写进 `DSH_AUTH_COOKIE`：launch token 有寿命，而一轮截图要好几分钟，
 * 中途过期会以"401"的形式在无关的地方炸掉。
 * @param {string} base - 实例基址
 * @param {string} token - `dsh web` 打印的 launch token
 * @returns {Promise<string>} `name=value`
 */
export async function shotsCookie(base, token) {
  const response = await fetch(`${base}/?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
  })
  const cookie = (
    response.headers.getSetCookie?.()[0] ??
    response.headers.get('set-cookie') ??
    ''
  ).split(';', 1)[0]
  if (cookie === '') throw new Error(`换 cookie 失败：HTTP ${String(response.status)}`)
  return cookie
}

/**
 * 把那条 cookie 塞进浏览器。
 *
 * 为什么非要种：换端口就等于换一条 cookie——宿主按 `host:port` 派生的名字叫
 * `dsh-auth-<hash>`，同一个 `127.0.0.1` 下每条端口的 cookie 都躺在同一个罐子里互不顶替。
 * 所以只设 `DSH_AUTH_COOKIE`（跳过 `?token=`）会让页面裸奔到 401。
 * @param {{ send: (method: string, params?: unknown) => Promise<unknown> }} page - CDP 会话
 * @param {string} base - 实例基址
 * @param {string} cookie - `name=value`
 * @returns {Promise<void>}
 */
export async function installShotsCookie(page, base, cookie) {
  const [name, ...rest] = cookie.split('=')
  const result = await page.send('Network.setCookie', {
    url: `${base}/`,
    name,
    value: rest.join('='),
  })
  // 不看回执的话，`{success:false}` 会被静默吞掉，30 秒后才以
  // `waitFor timed out: __WORKFLOW_LITE__` 的面目出现，指向完全无关的地方
  if (result?.success !== true) {
    throw new Error(`往浏览器种 cookie 失败：${JSON.stringify(result)}`)
  }
}

/**
 * 换一次会话 cookie，然后打宿主 Remote。信封形状：`payload.args.<wrapper>`。
 *
 * 网关对参数的 wrapper 名不统一：多数端点叫 `request`，`session/list` 这类读接口叫 `_request`
 * （名字对不上会被回 `missing "request"` / `unexpected "cwd"`）。
 * @param {string} base - 实例基址
 * @param {string} token - `dsh web` 打印的 launch token
 * @returns {Promise<(channel: string, method: string, request?: unknown, options?: { as?: string }) => Promise<unknown>>}
 */
export async function createRpc(base, token) {
  const cookie = await shotsCookie(base, token)
  return async (channel, method, request, options = {}) => {
    const wire = `${channel}/${method}`
    const r = await fetch(`${base}/api/${wire}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `shots-${method}-${String(Date.now())}`,
        method: wire,
        payload: { args: { [options.as ?? 'request']: request ?? {} } },
      }),
    })
    const body = await r.json()
    if (body?.result?.ok !== true)
      throw new Error(`${wire} 失败：${JSON.stringify(body?.result?.error)}`)
    return body.result.value
  }
}

/**
 * 等宿主把 `sessionController` 挂起来。
 *
 * 实例把带 token 的地址打印出来的时候插件还没加载完，这时候打 RPC 会回
 * `gateway/service-unavailable`；这不是错误，只是还没到时候。
 * **只重试这一种**：别的错（401、参数不对）再等多久都不会自己好，早点红比等满 60 秒强。
 * @param {(channel: string, method: string, request?: unknown, options?: { as?: string }) => Promise<unknown>} rpc
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export async function waitForShotsHost(rpc, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await rpc('session', 'list', {}, { as: '_request' })
      return
    } catch (error) {
      if (!String(error.message).includes('service-unavailable')) throw error
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

/**
 * 起整套截图环境，并把基址与 cookie 写进环境变量。
 *
 * 顺序是有讲究的：假模型先起来（profile 里要写它的地址）→ 重写 profile → 起实例（随机端口）→
 * 换 cookie 并写进 `process.env`（`tests/lib/web-session.mjs` 每次现读，所以顺序上只要在**发 RPC 之前**就行）
 * → 备好夹具会话。
 *
 * 幂等：profile 每次整份重写，工作区按 path 解析、会话按固定 id 认领，重复跑结果一致。
 *
 * **假模型必须在 try 之内关**：它是个监听中的 HTTP server，会让 Node 的事件循环一直活着。
 * 建完它之后的任何一步抛（profile 写不进去、实例起不来）如果不收，调用方就**永久挂住**——
 * 连报错都看不到。
 * @param {{ dataDir: string, workspaceDir: string, home: string, theme?: 'light' | 'dark', port?: number }} options
 * @returns {Promise<{ base: string, cookie: string, workspaceId: string, workspaceDir: string, adoptedWorkspace: boolean, sessionId: string, title: string, mock: object, stop: () => Promise<void> }>}
 */
export async function startShotsEnv(options) {
  // **换一个家**：profile、会话库、工作区库、投影缓存全落在它底下。
  // 这几样在 DSH 里是按 `DSH_HOME` 算的、**不按 profile 隔离**——共用用户自己的家的话，
  // 那条"封面夹具"会永久留在他侧栏里，工作区库里也多一条。指定一个一次性的家，整跑删掉就干净了。
  // 必须在 `prepareShotsProfile` 之前设：那里读 `dshHome()`。
  process.env.DSH_HOME = options.home
  const mock = await startMockLlm({ port: 0 })
  let instance
  /** 收尾：实例关不掉也要把假模型收掉——它是监听中的 server，留着 Node 就永远不退出。 */
  const shutdown = async () => {
    try {
      await instance?.stop()
    } finally {
      await mock.close()
    }
  }
  try {
    prepareShotsProfile({
      mockUrl: mock.url,
      dataDir: options.dataDir,
      ...(options.theme === undefined ? {} : { theme: options.theme }),
    })
    mkdirSync(options.workspaceDir, { recursive: true })
    instance = await startShotsInstance({
      ...(options.port === undefined ? {} : { port: options.port }),
    })

    const cookie = await shotsCookie(instance.base, instance.token)
    process.env.DSH_BASE = instance.base
    process.env.DSH_AUTH_COOKIE = cookie
    const rpc = await createRpc(instance.base, instance.token)
    await waitForShotsHost(rpc)
    const fixture = await prepareShotsFixture(rpc, {
      workspaceDir: options.workspaceDir,
      mock,
    })
    return {
      base: instance.base,
      cookie,
      ...fixture,
      mock,
      stop: shutdown,
    }
  } catch (error) {
    await shutdown().catch(() => {})
    throw error
  }
}
