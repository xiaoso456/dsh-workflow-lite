/**
 * watch.mjs — 监视程序的底子（workflow-lite 触发卡片）。
 *
 * 插件把它放进工作流目录的 `triggers/` 下（不在或不一样就换成随插件的这份），监视脚本里 `import { … } from './watch.mjs'`。
 * 只用 Node 自带的模块（Node 18 起），不用装依赖；随工作流一起导出，到了别的机器上照样能跑。
 * 别手改：下次跑命令前会被换回去。
 *
 * 管的是每个监视程序都要、又最容易漏的那几样：
 * - emit：打一行事件（一件事一行，换行换掉）；log / warn：日志（不触发）；
 * - remember / seenIds / edges：记在 TRIGGER_DATA_DIR 里的状态（原子写入；第一次运行时 first 为真，只记下现状）；
 * - secret：读 TRIGGER_SECRETS_DIR 里用户放的令牌、密钥（真打开和试运行是同一处），没放就说清楚放哪、退出；
 * - poll：隔一阵查一次，有事时查得勤、闲下来放慢，出错按退避重试；
 * - stream：长连接（WebSocket、SSE、子进程）断了按退避重连；
 * - getJson：带超时、带 ETag 的 HTTP 请求；
 * - settle：等文件写完（大小、修改时间几秒不变）；
 * - heartbeat：隔一阵打一句「还在运行」，人看「最近的输出」就知道它活着；
 * - injected：试的时候往数据目录投一份样本，当成真事件处理（命令行 `node watch.mjs inject <样本>`）；
 * - 收到结束信号时先跑 onStop 登记的收尾，再退出。
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 脚本自己的数据目录：每张卡片单独一个，只在这台机器上，不导出；手动跑时落在当前目录的 .trigger-data。 */
export const dataDir = resolve(process.env.TRIGGER_DATA_DIR ?? '.trigger-data')
mkdirSync(dataDir, { recursive: true })

/** 用户放令牌、密钥、连接串的目录：每张卡片单独一个，真打开和试运行是同一处，不导出；手动跑时同数据目录。 */
export const secretsDir = resolve(process.env.TRIGGER_SECRETS_DIR ?? dataDir)

// ── 输出 ─────────────────────────────────────────────

/**
 * 打一行事件：插件只认 `::trigger::` 开头的行。
 * @param {string} text 一句话说清这件事，动态拿到的文字直接拼进来。
 * @param {unknown} [data] 要原样给出的字段，跟在后面成一段 JSON。
 */
export function emit(text, data) {
  const line = data === undefined ? String(text) : `${text} ${JSON.stringify(data)}`
  console.log(`::trigger:: ${line.replace(/\r?\n/g, ' ⏎ ')}`)
}

/** 日志：打到标准输出，不触发，用户在「最近的输出」里看得到。 */
export function log(...parts) {
  console.log('[watch]', ...parts)
}

/** 真出错了：打到错误输出（界面上标成错误）。 */
export function warn(...parts) {
  console.error('[watch]', ...parts.map((part) => (part instanceof Error ? part.message : part)))
}

/**
 * 读密钥目录里的一份（令牌、密钥、连接串），去掉首尾空白。没放就在错误输出里说清楚缺什么、放哪，退出（退出码 2）：
 * 「最近的输出」和 test_trigger 的 run.stderr 里一眼看得出来。
 * @param {string} name 文件名，如 'token.txt'。
 * @param {string} [what] 缺了时怎么称呼它，如「访问令牌」。
 */
export function secret(name, what = name) {
  const file = join(secretsDir, name)
  if (!existsSync(file)) {
    warn(`缺${what}：请把它写进 ${file}`)
    process.exit(2)
  }
  return readFileSync(file, 'utf8').trim()
}

// ── 结束 ─────────────────────────────────────────────

const stops = []

/** 登记一件收尾的事（关连接、杀子进程、存状态）；收到结束信号时按登记的先后跑完再退出。 */
export function onStop(fn) {
  stops.push(fn)
}

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  for (const fn of stops) {
    try {
      await fn()
    } catch (error) {
      warn('收尾出错：', error)
    }
  }
  process.exit(0)
}

/** 等一会儿（收到结束信号时进程直接退出，不用等完）。 */
export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

// ── 状态 ─────────────────────────────────────────────

function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, text)
  renameSync(temp, file)
}

/**
 * 一份记在数据目录里的状态（JSON）。
 * @param {string} name 文件名，如 'cursor.json'。
 * @param {T} initial 第一次运行（文件不存在）时的值。
 * @returns {{ first: boolean, value: T, save(next?: T): void }} 改了 value 之后调 save()，或直接 save(新值)。
 * @template T
 */
export function remember(name, initial) {
  const file = join(dataDir, name)
  const first = !existsSync(file)
  const box = {
    first,
    value: first ? initial : JSON.parse(readFileSync(file, 'utf8')),
    save(next) {
      if (next !== undefined) box.value = next
      writeAtomic(file, JSON.stringify(box.value))
    },
  }
  return box
}

/**
 * 处理过的编号（消息、记录、文件）：按编号去重，最多记 `limit` 个，多了丢最早的。
 * 对方会重投同一件事（重连之后、没及时确认）时用它挡掉。
 * @returns {{ first: boolean, has(id): boolean, add(id): boolean, save(): void }} add 回 true 表示是新的。
 */
export function seenIds(name = 'seen.json', limit = 5000) {
  const box = remember(name, [])
  const ids = new Set(box.value.map(String))
  return {
    first: box.first,
    has: (id) => ids.has(String(id)),
    add(id) {
      const key = String(id)
      if (ids.has(key)) return false
      ids.add(key)
      while (ids.size > limit) ids.delete(ids.values().next().value)
      return true
    },
    save: () => box.save([...ids]),
  }
}

/**
 * 状态变化（边沿）：同一个键的值变了才算一件事，不是每次查到的状态都算。
 * `confirm` 次连着看到同一个新值才认（挡掉一下好一下坏的抖动）；一个键第一次出现只记下，不算变化。
 * `value(key)` 是这个键现在认下的值（没见过是 undefined），重启后也读得到：带死区的阈值要靠它保持原样。
 * @returns {{ update(key: string, value: string): ({ from: string, to: string } | null), value(key: string): (string | undefined), save(): void }}
 */
export function edges(name = 'edges.json', { confirm = 1 } = {}) {
  const box = remember(name, {})
  return {
    update(key, value) {
      const slot = box.value[key]
      if (slot === undefined) {
        box.value[key] = { value, pending: null, count: 0 }
        return null
      }
      if (slot.value === value) {
        slot.pending = null
        slot.count = 0
        return null
      }
      slot.count = slot.pending === value ? slot.count + 1 : 1
      slot.pending = value
      if (slot.count < confirm) return null
      const from = slot.value
      box.value[key] = { value, pending: null, count: 0 }
      return { from, to: value }
    },
    value: (key) => box.value[key]?.value,
    save: () => box.save(),
  }
}

// ── 怎么等事件 ────────────────────────────────────────

/**
 * 隔一阵查一次：`check` 返回真（比如这一轮打出的事件数）表示有事，下一轮照 `every` 查；
 * 连着 `calm` 轮没事就放慢到 `idle`；出错时退避（`every` 起翻倍，最长 `max`），错误打到错误输出。
 * 一直运行，不返回。
 */
export async function poll(check, { every = 5000, idle = every, calm = 3, max = 300_000 } = {}) {
  let quiet = 0
  let failures = 0
  for (;;) {
    let wait
    try {
      const busy = await check()
      if (failures > 0) log('恢复正常')
      failures = 0
      quiet = busy ? 0 : quiet + 1
      wait = quiet >= calm ? idle : every
    } catch (error) {
      failures += 1
      wait = Math.min(max, every * 2 ** failures)
      warn(`这一轮出错（第 ${failures} 次），${Math.round(wait / 1000)} 秒后再试：`, error)
    }
    await sleep(wait)
  }
}

/**
 * 长连接：`connect()` 建好连接、一直等到它断开才返回（或抛错）；断了按退避重连
 * （`min` 起翻倍，最长 `max`；连上之后稳定了 `healthy` 毫秒再断的，从 `min` 重新算）。一直运行，不返回。
 */
export async function stream(connect, { min = 2000, max = 60_000, healthy = 60_000 } = {}) {
  let delay = min
  for (;;) {
    const started = Date.now()
    try {
      await connect()
      log('连接断开')
    } catch (error) {
      warn('连接出错：', error)
    }
    if (Date.now() - started >= healthy) delay = min
    log(`${Math.round(delay / 1000)} 秒后重连`)
    await sleep(delay)
    delay = Math.min(max, delay * 2)
  }
}

/**
 * GET 一个 JSON 接口：带超时；给了上一次的 `etag` 时对方没变就回 `{ notModified: true }`，不再传整份内容。
 * 状态码不是 2xx、304 时抛错（带上状态码和开头一截返回）。
 * @returns {Promise<{ notModified: boolean, etag?: string, data?: any }>}
 */
export async function getJson(url, { headers = {}, etag, timeout = 15_000 } = {}) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...headers, ...(etag ? { 'if-none-match': etag } : {}) },
    signal: AbortSignal.timeout(timeout),
  })
  if (response.status === 304) return { notModified: true, etag }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${url} 返回 ${response.status}：${text.slice(0, 200)}`)
  }
  return {
    notModified: false,
    etag: response.headers.get('etag') ?? undefined,
    data: await response.json(),
  }
}

/**
 * 等一个文件写完：大小和修改时间连着 `quiet` 毫秒不变才算。文件没了、等了 `timeout` 还在变，回 false。
 */
export async function settle(path, { quiet = 2000, timeout = 120_000, step = 500 } = {}) {
  const started = Date.now()
  let last = ''
  let since = Date.now()
  while (Date.now() - started < timeout) {
    let mark
    try {
      const stat = statSync(path)
      mark = `${stat.size}:${stat.mtimeMs}`
    } catch {
      return false
    }
    if (mark !== last) {
      last = mark
      since = Date.now()
    } else if (Date.now() - since >= quiet) {
      return true
    }
    await sleep(step)
  }
  return false
}

/** 隔一阵（缺省 10 分钟）打一句「还在运行」，`describe()` 可以补一句现状（查到哪了、连着没）。 */
export function heartbeat(describe = () => '', every = 600_000) {
  setInterval(() => log('还在运行', describe()), every).unref()
}

// ── 试的时候投样本 ────────────────────────────────────

const INBOX = 'inject.jsonl'

/**
 * 每隔 `every` 毫秒看一眼数据目录里有没有投进来的样本，有就逐条交给 `handle`（和真事件走同一个处理函数）。
 * 远端的事件（接口、数据库、聊天软件）没法在本地造时，`test_trigger` 的 `poke` 写
 * `node "{workflow}/triggers/watch.mjs" inject "{workflow}/triggers/samples/xxx.json"`。
 * 平时没有这个文件，不影响什么。
 */
export function injected(handle, { every = 1000 } = {}) {
  const file = join(dataDir, INBOX)
  const timer = setInterval(async () => {
    if (!existsSync(file)) return
    const taken = `${file}.${process.pid}.taking`
    try {
      renameSync(file, taken)
    } catch {
      return
    }
    const lines = readFileSync(taken, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '')
    rmSync(taken, { force: true })
    for (const line of lines) {
      try {
        await handle(JSON.parse(line))
      } catch (error) {
        warn('处理投进来的样本出错：', error)
      }
    }
  }, every)
  onStop(() => clearInterval(timer))
}

/** 命令行：`node watch.mjs inject <样本文件或一段 JSON>`，往数据目录投样本（数组里每一项算一件）。 */
function inject(source) {
  const text = existsSync(source) ? readFileSync(source, 'utf8') : source
  const trimmed = text.trim()
  const items = trimmed.startsWith('[')
    ? JSON.parse(trimmed)
    : trimmed.startsWith('{')
      ? [JSON.parse(trimmed)]
      : trimmed.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
  appendFileSync(join(dataDir, INBOX), items.map((item) => `${JSON.stringify(item)}\n`).join(''))
  console.log(`投了 ${items.length} 件样本到 ${join(dataDir, INBOX)}`)
}

const direct = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (direct) {
  const [command, source] = process.argv.slice(2)
  if (command === 'inject' && source !== undefined) inject(source)
  else {
    console.error('用法：node watch.mjs inject <样本文件或一段 JSON>')
    process.exit(2)
  }
} else {
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
