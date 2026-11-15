/**
 * 常驻的触发源（host）：过滤（关键字、去重、合并）、条件轮询的判定与节奏、监听程序的退避与失败计数、
 * HTTP 地址（令牌、202、端口被占用），以及在本机真的跑一次命令。
 */

import { createServer as createNetServer, type Server } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type HookRoute, HookServer, hookUrl } from '../../src/host/triggers/hooks.ts'
import { Intake, type IntakeBatch, type IntakeClock } from '../../src/host/triggers/intake.ts'
import {
  backoff,
  exitText,
  HEALTHY_MS,
  Listener,
  type ListenerHandlers,
} from '../../src/host/triggers/listener.ts'
import { FRESH_PROBE, judge, type PollCheck, Poller } from '../../src/host/triggers/poller.ts'
import {
  type ExitInfo,
  type RunResult,
  runCommand,
  startProcess,
} from '../../src/host/triggers/processes.ts'
import { lastLineText } from '../../src/host/triggers/runtime.ts'
import { PING_BODY, pingHook, tryListen, tryPoll } from '../../src/host/triggers/trial.ts'
import { filterOf, keywordMiss } from '../../src/shared/trigger.ts'

const NO_FILTER = { merge: 0, dedupe: 0, include: [], exclude: [] }

/** 手动拨的钟：`advance` 时到点的定时一起跑。 */
function manualClock(): IntakeClock & { advance(ms: number): void } {
  let now = 0
  let timers: { at: number; run: () => void; id: number }[] = []
  let seq = 0
  return {
    now: () => now,
    setTimeout: (run, ms) => {
      seq += 1
      timers.push({ at: now + ms, run, id: seq })
      return seq
    },
    clearTimeout: (handle) => {
      timers = timers.filter((timer) => timer.id !== handle)
    },
    advance(ms) {
      now += ms
      const due = timers.filter((timer) => timer.at <= now)
      timers = timers.filter((timer) => timer.at > now)
      for (const timer of due) timer.run()
    },
  }
}

describe('过滤', () => {
  it('关键字大小写不敏感；「不包含」优先；空内容在有「包含」时不算', () => {
    const filter = { ...NO_FILTER, include: ['error', '失败'], exclude: ['health'] }
    expect(keywordMiss(filter, 'ERROR: disk full')).toBeNull()
    expect(keywordMiss(filter, 'error in /health')).toBe('含有「health」')
    expect(keywordMiss(filter, 'all good')).toContain('「error」')

    const batches: IntakeBatch[] = []
    const intake = new Intake(filter, '\n', (batch) => batches.push(batch))
    intake.push('')
    intake.push('ok')
    intake.push('Error 1')
    expect(batches).toEqual([{ info: 'Error 1', count: 1 }])
  })

  it('去重：时长内一样的内容只算一次，过了时长再来算新的', () => {
    const clock = manualClock()
    const batches: IntakeBatch[] = []
    const intake = new Intake({ ...NO_FILTER, dedupe: 10 }, '\n', (b) => batches.push(b), clock)
    intake.push('磁盘 91%')
    intake.push('  磁盘 91%  ')
    intake.push('磁盘 92%')
    clock.advance(10 * 60_000)
    intake.push('磁盘 91%')
    expect(batches.map((batch) => batch.info)).toEqual(['磁盘 91%', '磁盘 92%', '磁盘 91%'])
  })

  it('合并：窗口从第一段算起，并成一次、按到达顺序；窗口里只有空内容也算一次', () => {
    const clock = manualClock()
    const batches: IntakeBatch[] = []
    const intake = new Intake({ ...NO_FILTER, merge: 5 }, '\n', (b) => batches.push(b), clock)
    intake.push('a')
    clock.advance(3000)
    intake.push('b')
    clock.advance(1999)
    expect(batches).toEqual([])
    clock.advance(1)
    expect(batches).toEqual([{ info: 'a\nb', count: 2 }])

    intake.push('')
    clock.advance(5000)
    expect(batches[1]).toEqual({ count: 1 })

    // 停下时攒着的不交出去。
    intake.push('c')
    intake.dispose()
    clock.advance(5000)
    expect(batches).toHaveLength(2)
  })

  it('缺省：监听程序、HTTP 合并 5 秒，轮询、定时不合并', () => {
    expect(filterOf({ source: { kind: 'listen', command: 'x' } }).merge).toBe(5)
    expect(filterOf({ source: { kind: 'http' } }).merge).toBe(5)
    expect(filterOf({ source: { kind: 'poll', command: 'x', seconds: 60 } }).merge).toBe(0)
    expect(
      filterOf({ source: { kind: 'listen', command: 'x' }, filter: { merge: 0, include: ['E'] } }),
    ).toEqual({ merge: 0, dedupe: 0, include: ['E'], exclude: [] })
  })
})

describe('条件轮询', () => {
  const result = (code: number | null, output = ''): RunResult => ({ code, output, errors: '' })

  it('成功时触发：只在「上次不成功、这次成功」时触发', () => {
    expect(judge('success', {}, result(0))).toEqual({ met: true, probe: { ok: true } })
    expect(judge('success', { ok: true }, result(0)).met).toBe(false)
    expect(judge('success', { ok: true }, result(1))).toEqual({
      met: false,
      probe: { ok: false },
      note: '命令返回 1',
    })
    expect(judge('success', { ok: false }, result(0)).met).toBe(true)
  })

  it('每次成功时触发：一直成功就每次都触发，失败的那次不触发', () => {
    expect(judge('every', {}, result(0))).toEqual({ met: true, probe: { ok: true } })
    expect(judge('every', { ok: true }, result(0)).met).toBe(true)
    expect(judge('every', { ok: true }, result(3))).toEqual({
      met: false,
      probe: { ok: false },
      note: '命令返回 3',
    })
  })

  it('输出变了时触发：第一次只记下；非零的那次不拿来比；首尾空白不算变化', () => {
    const first = judge('change', {}, result(0, 'abc\n'))
    expect(first.met).toBe(false)
    expect(first.note).toContain('第一次')
    expect(judge('change', first.probe, result(0, '  abc ')).met).toBe(false)
    const failed = judge('change', first.probe, result(2, 'boom'))
    expect(failed).toMatchObject({ met: false, probe: first.probe })
    expect(judge('change', failed.probe, result(0, 'abd')).met).toBe(true)
  })

  it('从现在起算（恢复全部暂停后）：两种判定的第一次检查都只记下', () => {
    expect(judge('success', FRESH_PROBE, result(0)).met).toBe(false)
    expect(judge('success', FRESH_PROBE, result(1)).probe).toEqual({ ok: false })
    const change = judge('change', FRESH_PROBE, result(0, 'abc'))
    expect(change.met).toBe(false)
    expect(change.probe.digest).toBeDefined()
  })

  describe('节奏', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('打开就检查一次，之后每次跑完隔一个间隔；带着上次的结果接着判；跑不起来算失败', async () => {
      const outcomes: RunResult[] = [
        { code: 0, output: 'one', errors: '' },
        { code: 0, output: 'one', errors: '' },
        { code: null, output: '', errors: '', failure: '找不到命令' },
        { code: 0, output: 'two', errors: '' },
      ]
      const fired: string[] = []
      const failed: string[] = []
      const checks: PollCheck[] = []
      const poller = new Poller(
        { command: 'x', cwd: '.', seconds: 60, when: 'change', probe: {} },
        {
          fire: (output) => fired.push(output),
          fail: (reason) => failed.push(reason),
          checked: (check) => checks.push(check),
        },
        async () => outcomes.shift() as RunResult,
      )
      poller.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(checks).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(59_999)
      expect(checks).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.advanceTimersByTimeAsync(60_000)
      poller.stop()
      await vi.advanceTimersByTimeAsync(600_000)
      expect(checks.map((check) => check.met)).toEqual([false, false, false, true])
      expect(fired).toEqual(['two'])
      expect(failed).toEqual(['找不到命令'])
      expect(checks[2]).toMatchObject({ failure: '找不到命令', probe: checks[1]?.probe })
    })
  })
})

describe('监听程序', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('卡片上的最近一行：去掉终端颜色和首尾空白，太长截到 200 个字', () => {
    expect(lastLineText('[31mERROR[0m pay timeout  ')).toBe('ERROR pay timeout')
    const long = '错'.repeat(250)
    expect(lastLineText(long)).toBe(`${'错'.repeat(200)}…`)
    expect(lastLineText('😀'.repeat(201))).toBe(`${'😀'.repeat(200)}…`)
  })

  it('退避 2 秒起翻倍，最长 1 分钟', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoff)).toEqual([
      2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ])
  })

  it('退出的说法：带退出码和错误输出的最后几行', () => {
    const info: ExitInfo = { code: 1, signal: null, errors: 'a\nb\nc\nd' }
    expect(exitText(info, 2400)).toBe('监视程序运行 2 秒后退出了（退出码 1）：b c d')
    expect(exitText({ ...info, failure: '找不到命令' }, 10)).toBe('找不到命令')
  })

  it('一启动就退出算失败、按退避重启；跑满 1 分钟算好了，退避从头算、再退出不算失败', async () => {
    const exits: ((info: ExitInfo) => void)[] = []
    const lines: string[] = []
    const events: string[] = []
    const handlers: ListenerHandlers = {
      line: (text) => lines.push(text),
      output: () => {},
      running: ({ restarts }) => events.push(`run ${String(restarts)}`),
      healthy: () => events.push('healthy'),
      exited: ({ counted, retryAt, restarts }) =>
        events.push(
          `exit ${String(counted)} +${String(retryAt - Date.now())} #${String(restarts)}`,
        ),
    }
    let emit: (line: string) => void = () => {}
    const listener = new Listener({ command: 'x', cwd: '.' }, handlers, (_spec, h) => {
      exits.push(h.onExit)
      emit = h.onLine
      return { pid: 1, stop: async () => {} }
    })
    listener.start()
    emit('第一行')
    await vi.advanceTimersByTimeAsync(1000)
    exits[0]?.({ code: 1, signal: null, errors: '' })
    await vi.advanceTimersByTimeAsync(2000)
    exits[1]?.({ code: 1, signal: null, errors: '' })
    await vi.advanceTimersByTimeAsync(4000)
    await vi.advanceTimersByTimeAsync(HEALTHY_MS)
    exits[2]?.({ code: 0, signal: null, errors: '' })
    await vi.advanceTimersByTimeAsync(2000)
    await listener.stop()
    expect(lines).toEqual(['第一行'])
    expect(events).toEqual([
      'run 0',
      'exit true +2000 #1',
      'run 1',
      'exit true +4000 #2',
      'run 2',
      'healthy',
      'exit false +2000 #1',
      'run 1',
    ])
    // 停下之后不再重启。
    exits[3]?.({ code: 1, signal: null, errors: '' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(exits).toHaveLength(4)
  })
})

/** 一个这会儿没人用的端口。 */
async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (address === null || typeof address === 'string') throw new Error('拿不到端口')
  return address.port
}

describe('HTTP 地址', () => {
  let hooks: HookServer
  let blocker: Server | undefined

  beforeEach(() => {
    hooks = new HookServer()
  })
  afterEach(async () => {
    await hooks.close()
    if (blocker !== undefined) await new Promise((resolve) => blocker?.close(resolve))
    blocker = undefined
  })

  it('令牌对了马上回 202、请求体交出去；令牌不对 401，地址不在 404，GET 405', async () => {
    const port = await freePort()
    const bodies: string[] = []
    const route: HookRoute = { token: 'secret', accept: (body) => bodies.push(body) }
    await hooks.sync({ host: '127.0.0.1', port }, new Map([['abc', route]]))
    expect(hooks.current()).toEqual({ kind: 'open', port, host: '127.0.0.1' })
    const url = hookUrl('127.0.0.1', port, 'abc')
    expect(url).toBe(`http://127.0.0.1:${String(port)}/trigger/abc`)

    const post = (target: string, token?: string) =>
      fetch(target, {
        method: 'POST',
        body: '{"alert":"磁盘 91%"}',
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      })
    expect((await post(url, 'secret')).status).toBe(202)
    expect((await post(`${url}?token=secret`)).status).toBe(202)
    expect((await post(url, 'wrong')).status).toBe(401)
    expect((await post(url)).status).toBe(401)
    expect((await post(hookUrl('127.0.0.1', port, 'nope'), 'secret')).status).toBe(404)
    expect((await fetch(url)).status).toBe(405)
    expect(bodies).toEqual(['{"alert":"磁盘 91%"}', '{"alert":"磁盘 91%"}'])

    // 没有开着的地址就关掉端口。
    await hooks.sync({ host: '127.0.0.1', port }, new Map())
    expect(hooks.current()).toEqual({ kind: 'closed' })
    await expect(post(url, 'secret')).rejects.toThrow()
  })

  it('不要令牌的地址：带不带、带错都收下', async () => {
    const port = await freePort()
    const bodies: string[] = []
    await hooks.sync(
      { host: '127.0.0.1', port },
      new Map([['open', { token: null, accept: (body: string) => bodies.push(body) }]]),
    )
    const url = hookUrl('127.0.0.1', port, 'open')
    expect((await fetch(url, { method: 'POST', body: 'a' })).status).toBe(202)
    const wrong = { authorization: 'Bearer whatever' }
    expect((await fetch(url, { method: 'POST', body: 'b', headers: wrong })).status).toBe(202)
    expect(await pingHook(url, null)).toMatchObject({ status: 202 })
    expect(bodies).toEqual(['a', 'b', PING_BODY])
  })

  it('地址里有中文：网址里转义，收到时解开再对', async () => {
    const port = await freePort()
    const bodies: string[] = []
    const route: HookRoute = { token: 'secret', accept: (body) => bodies.push(body) }
    await hooks.sync({ host: '127.0.0.1', port }, new Map([['巡检-日报', route]]))
    const url = hookUrl('127.0.0.1', port, '巡检-日报')
    expect(url).toBe(
      `http://127.0.0.1:${String(port)}/trigger/%E5%B7%A1%E6%A3%80-%E6%97%A5%E6%8A%A5`,
    )
    const post = (target: string) =>
      fetch(target, { method: 'POST', body: 'x', headers: { authorization: 'Bearer secret' } })
    expect((await post(url)).status).toBe(202)
    expect((await post(`http://127.0.0.1:${String(port)}/trigger/%E5%B7%A1`)).status).toBe(404)
    expect((await post(`http://127.0.0.1:${String(port)}/trigger/%E5%B7`)).status).toBe(404)
    expect(bodies).toEqual(['x'])
  })

  it('监听所有网卡时本机照样连得上', async () => {
    const port = await freePort()
    const bodies: string[] = []
    const route: HookRoute = { token: 'secret', accept: (body) => bodies.push(body) }
    await hooks.sync({ host: '0.0.0.0', port }, new Map([['abc', route]]))
    expect(hooks.current()).toEqual({ kind: 'open', port, host: '0.0.0.0' })
    const response = await fetch(hookUrl('127.0.0.1', port, 'abc'), {
      method: 'POST',
      body: 'x',
      headers: { authorization: 'Bearer secret' },
    })
    expect(response.status).toBe(202)
    expect(bodies).toEqual(['x'])
  })

  it('监听地址换了就重开；本机没有的地址报出原因', async () => {
    const port = await freePort()
    const routes = new Map([['abc', { token: 't', accept: () => {} }]])
    await hooks.sync({ host: '127.0.0.1', port }, routes)
    expect(hooks.current()).toMatchObject({ kind: 'open', host: '127.0.0.1' })
    await hooks.sync({ host: '203.0.113.7', port }, routes)
    const state = hooks.current()
    expect(state).toMatchObject({ kind: 'error', host: '203.0.113.7' })
    expect(state.kind === 'error' && state.problem).toContain('没有地址 203.0.113.7')
  })

  it('端口被占用：报出原因，不抛', async () => {
    const port = await freePort()
    blocker = createNetServer()
    await new Promise<void>((resolve) => blocker?.listen(port, '127.0.0.1', resolve))
    await hooks.sync(
      { host: '127.0.0.1', port },
      new Map([['abc', { token: 't', accept: () => {} }]]),
    )
    const state = hooks.current()
    expect(state.kind).toBe('error')
    expect(state.kind === 'error' && state.problem).toContain('被别的程序占用')
  })
})

describe('在本机跑命令', () => {
  const cwd = process.cwd()

  it('跑一次：退出码、标准输出、找不到命令、超时', async () => {
    const limits = { timeoutMs: 10_000, maxBytes: 1024 }
    const ok = await runCommand(
      {
        command: `node -e "console.log(process.env.WORKFLOW_DIR)"`,
        cwd,
        env: { WORKFLOW_DIR: 'D:/wf' },
      },
      limits,
    )
    expect(ok).toMatchObject({ code: 0, output: 'D:/wf\n' })
    expect(ok.output.trim()).toBe('D:/wf')

    const exited = await runCommand({ command: 'node -e "process.exit(3)"', cwd }, limits)
    expect(exited).toMatchObject({ code: 3 })
    expect(exited.failure).toBeUndefined()

    const missing = await runCommand({ command: 'no-such-command-wl-test', cwd }, limits)
    expect(missing.failure).toContain('找不到命令')

    const slow = await runCommand(
      { command: 'node -e "setTimeout(() => {}, 30000)"', cwd },
      { timeoutMs: 500, maxBytes: 1024 },
    )
    expect(slow.failure).toContain('没结束')
  }, 30_000)

  it('常驻：一行一行交出来；结束时等它真的退出、不报退出', async () => {
    const lines: string[] = []
    const exits: ExitInfo[] = []
    const live = startProcess(
      {
        command: "node -e \"console.log('一');console.log('二');setInterval(() => {}, 1000)\"",
        cwd,
      },
      { onLine: (line) => lines.push(line), onExit: (info) => exits.push(info) },
    )
    for (let wait = 0; wait < 100 && lines.length < 2; wait += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(lines).toEqual(['一', '二'])
    await live.stop()
    expect(exits).toEqual([])
  }, 30_000)
})

/** 输出按行切开；本机的 node 可能往错误输出打警告（代理之类），只留命令自己打的。 */
const ownLines = (text: string): string[] =>
  text.split(/\r?\n/u).filter((line) => !line.startsWith('(node:') && !line.startsWith('(Use '))

describe('试一试（「触发方式」对话框）', () => {
  const cwd = process.cwd()

  it('轮询试运行：退出码、输出（标准输出 + 错误输出）、用时；找不到命令给原因', async () => {
    const ok = await tryPoll({
      command: `node -e "console.log('up');console.error('warn');process.exit(2)"`,
      cwd,
    })
    expect(ok.code).toBe(2)
    expect(ownLines(ok.output)).toEqual(['up', 'warn'])
    expect(ok.ms).toBeGreaterThanOrEqual(0)
    expect(ok.failure).toBeUndefined()

    const missing = await tryPoll({ command: 'no-such-command-wl-test', cwd })
    expect(missing.failure).toContain('找不到命令')

    const slow = await tryPoll({ command: 'node -e "setTimeout(() => {}, 30000)"', cwd }, 500)
    expect(slow).toMatchObject({ code: null })
    expect(slow.failure).toContain('没结束')
  }, 30_000)

  it('监听试运行：到点结束程序、数出打了几行；自己先退出的记下退出码', async () => {
    const running = await tryListen(
      {
        command:
          "node -e \"console.log('a');console.log('');console.log('b');setInterval(() => {}, 1000)\"",
        cwd,
      },
      1500,
    )
    expect(running).toMatchObject({ code: null, stopped: true, lines: 2 })
    expect(ownLines(running.output)).toEqual(['a', '', 'b'])

    const quick = await tryListen(
      { command: 'node -e "console.log(\'x\');process.exit(4)"', cwd },
      5000,
    )
    expect(quick).toMatchObject({ code: 4, lines: 1 })
    expect(quick.stopped).toBeUndefined()
  }, 30_000)

  it('测试请求：带上令牌发 POST，回状态码；连不上给原因', async () => {
    const hooks = new HookServer()
    try {
      const port = await freePort()
      const bodies: string[] = []
      await hooks.sync(
        { host: '127.0.0.1', port },
        new Map([['abc', { token: 'secret', accept: (body: string) => bodies.push(body) }]]),
      )
      const url = hookUrl('127.0.0.1', port, 'abc')
      expect(await pingHook(url, 'secret')).toMatchObject({ status: 202 })
      expect(bodies).toEqual([PING_BODY])
      expect(await pingHook(url, 'wrong')).toMatchObject({ status: 401 })
      await hooks.sync({ host: '127.0.0.1', port }, new Map())
      const refused = await pingHook(url, 'secret', 2000)
      expect('failure' in refused && refused.failure).toContain('连不上')
    } finally {
      await hooks.close()
    }
  }, 30_000)
})
