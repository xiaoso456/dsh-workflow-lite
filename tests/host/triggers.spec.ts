/**
 * 触发器（host）：谁负责触发、到点触发与跳过、连续失败自动停用、开关与本机设置、
 * 「立即触发一次」，以及触发出来的实例记下的来源；常驻触发源（轮询、监听程序、HTTP）的
 * 命令确认、发进会话、失败计数、模型判断不需要，模型建触发卡片；全部暂停、接续触发、「触发」页的总表。
 * 常驻触发源本身（跑命令、开端口）换成假的，见 `triggerSources.spec.ts`。
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunService } from '../../src/host/runs/service.ts'
import { assetsDir } from '../../src/host/store/paths.ts'
import {
  createRepository,
  type Repository,
  reportProblems,
} from '../../src/host/store/repository.ts'
import type { WorkflowLiteArgs } from '../../src/host/tool/args.ts'
import { createWorkflowLiteHandler, type ToolExecView } from '../../src/host/tool/tool.ts'
import type { FinishedRun, RunWatch } from '../../src/host/triggers/after.ts'
import { createFireClaims } from '../../src/host/triggers/claims.ts'
import { createTriggerGraphs, followRenames } from '../../src/host/triggers/graphs.ts'
import { OWNER_STALE_MS, OwnerLock } from '../../src/host/triggers/owner.ts'
import type { LiveRuntime, LiveSpec, RuntimeEvents } from '../../src/host/triggers/runtime.ts'
import { LATE_MS, TriggerService } from '../../src/host/triggers/service.ts'
import type { SessionPort } from '../../src/host/triggers/sessions.ts'
import { ownerFile, TriggerStore } from '../../src/host/triggers/store.ts'
import type { InstanceView } from '../../src/shared/runState.ts'
import type { TriggerData, WorkflowDocument } from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'

const MINUTE = 60_000

let dataDir: string
let workspace: string
let repository: Repository
let store: TriggerStore
let clock: number
let sent: { session: string; text: string; summary: string }[]
let opened: { cwd: string; title: string }[]
let busy: Set<string>
let gone: Set<string>
let unavailable: string | null
let openError: string | null
/** 假的实例：接续触发看的「哪些实例结束了」（按工作流）。 */
let finished: Map<string, FinishedRun[]>
/** 假的常驻触发源：记下每一轮该开着的，事件口留给测试自己喂。 */
let live: { specs: LiveSpec[]; events: RuntimeEvents | undefined; stopped: number }

const validate = (document: WorkflowDocument, workflow: string) =>
  reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 }))

const sessions: SessionPort = {
  unavailable: () => unavailable,
  open: async (input) => {
    if (openError !== null) throw new Error(openError)
    opened.push(input)
    return `s${String(opened.length)}`
  },
  send: async (session, text, summary) => {
    if (gone.has(session)) throw new Error('会话不存在')
    sent.push({ session, text, summary })
  },
  busy: (session) => busy.has(session),
}

/** 按 `RunReader.finished` 的约定从 {@link finished} 里挑。 */
const watch: RunWatch = {
  finished: async (workflow, since, skip) => {
    const all = finished.get(workflow) ?? []
    return {
      runs: all.filter((run) => run.at > since && !skip.has(run.id)).sort((a, b) => a.at - b.at),
      ids: all.map((run) => run.id),
    }
  },
}

function service(pid = 100, alive: (pid: number) => boolean = () => true): TriggerService {
  return new TriggerService({
    dataDir: () => dataDir,
    store,
    graphs: createTriggerGraphs(repository),
    sessions,
    now: () => clock,
    port: () => 3791,
    runs: watch,
    lock: new OwnerLock({ file: () => ownerFile(dataDir), now: () => clock, pid, alive }),
    runtime: (events): LiveRuntime => {
      live.events = events
      return {
        sync: async (specs) => {
          live.specs = [...specs]
        },
        stopAll: async () => {
          live.specs = []
          live.stopped += 1
        },
      }
    },
  })
}

/** 存一张图：一张每 30 分钟的触发卡片（可改 `data`）加一个步骤。 */
async function saveGraph(name: string, data: Partial<TriggerData> = {}): Promise<void> {
  const document: WorkflowDocument = {
    nodes: [
      {
        id: 'tick',
        type: 'wfTrigger',
        position: { x: 0, y: 0 },
        data: {
          label: '巡检',
          source: { kind: 'schedule', schedule: { kind: 'every', minutes: 30 } },
          ...data,
        },
      },
      { id: 'work', type: 'wfNode', position: { x: 300, y: 0 }, data: { prompt: '干活' } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  const existing = await repository.load(name)
  if (!existing.exists) await repository.create(name)
  const base = (await repository.load(name)).hash
  const saved = await repository.save(name, document, { baseHash: base as string })
  expect(saved.ok).toBe(true)
}

/** 当上负责人（接手分两拍）并对一遍账。 */
async function own(triggers: TriggerService): Promise<void> {
  await triggers.tick()
  await triggers.tick()
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-triggers-'))
  workspace = join(dataDir, 'ws')
  await mkdir(workspace)
  store = new TriggerStore(() => dataDir)
  repository = followRenames(createRepository({ dataDir, validate }), store)
  await repository.ensureLayout()
  clock = new Date(2026, 10, 12, 9, 0).getTime()
  sent = []
  opened = []
  busy = new Set()
  gone = new Set()
  unavailable = null
  openError = null
  live = { specs: [], events: undefined, stopped: 0 }
  finished = new Map()
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('谁负责触发', () => {
  const lock = (pid: number, alive: (pid: number) => boolean = () => true): OwnerLock =>
    new OwnerLock({ file: () => ownerFile(dataDir), now: () => clock, pid, alive })

  it('接手分两拍；已经有人负责时别的进程拿不到', async () => {
    const first = lock(1)
    const second = lock(2)
    expect(await first.beat()).toBe(false)
    expect(await second.beat()).toBe(false)
    expect(await first.beat()).toBe(true)
    expect(await second.beat()).toBe(false)
    expect(await second.current()).toEqual({ mine: false, pid: 1, since: clock })
    expect((await first.current())?.mine).toBe(true)
  })

  it('两个进程同时抢：后写的那个赢，先写的下一拍退出', async () => {
    const first = lock(1)
    const second = lock(2)
    await first.beat()
    // 第二个没看到第一个的标记就写了（这里直接让它当作标记不作数）。
    const racing = new OwnerLock({
      file: () => ownerFile(dataDir),
      now: () => clock,
      pid: 2,
      alive: () => false,
    })
    await racing.beat()
    expect(await first.beat()).toBe(false)
    expect(await racing.beat()).toBe(true)
    expect(await second.beat()).toBe(false)
  })

  it('对方正常退出、进程不在了、太久没报到，都会被接手；原来负责的让出来', async () => {
    const first = lock(1)
    await first.beat()
    await first.beat()
    await first.release()
    const second = lock(2)
    await second.beat()
    expect(await second.beat()).toBe(true)

    // 进程不在了。
    const third = lock(3, (pid) => pid !== 2)
    await third.beat()
    expect(await third.beat()).toBe(true)

    // 卡死：标记太久没更新。
    clock += OWNER_STALE_MS + 1
    const fourth = lock(4)
    await fourth.beat()
    expect(await fourth.beat()).toBe(true)
    expect(await third.beat()).toBe(false)
    // 让出来的那个退出时不会把别人的标记删掉。
    await third.release()
    expect((await fourth.current())?.pid).toBe(4)
  })
})

describe('开关与状态', () => {
  it('打开之前要先选工作区；打开后显示下一次的时刻', async () => {
    await saveGraph('patrol')
    const triggers = service()
    expect((await triggers.list('patrol')).triggers).toEqual([
      { node: 'tick', enabled: false, state: 'off' },
    ])
    const refused = await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true })
    expect(refused.ok).toBe(false)
    const missing = await triggers.set({
      workflow: 'patrol',
      node: 'tick',
      workspace: join(dataDir, 'nope'),
    })
    expect(missing.ok).toBe(false)

    const on = await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    expect(on.ok && on.result.triggers[0]).toMatchObject({
      enabled: true,
      state: 'waiting',
      workspace,
      next: clock + 30 * MINUTE,
    })
    await own(triggers)
    expect((await triggers.list('patrol')).owner).toMatchObject({ mine: true, pid: 100 })
  })

  it('开着的时候改了规则：不等下一轮对账，下一次马上按新规则从现在算', async () => {
    await saveGraph('patrol')
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    await own(triggers)
    clock += 10 * MINUTE
    expect((await triggers.list('patrol')).triggers[0]?.next).toBe(clock + 20 * MINUTE)

    await saveGraph('patrol', {
      source: { kind: 'schedule', schedule: { kind: 'every', minutes: 120 } },
    })
    expect((await triggers.list('patrol')).triggers[0]?.next).toBe(clock + 120 * MINUTE)
    // 对过账之后还是这个时刻。
    await triggers.tick()
    expect((await triggers.list('patrol')).triggers[0]?.next).toBe(clock + 120 * MINUTE)
    expect(sent).toHaveLength(0)
  })

  it('「固定会话」要先选定会话；规则写得不对显示出来，不触发', async () => {
    await saveGraph('patrol', { launch: { session: 'fixed' } })
    const triggers = service()
    const refused = await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true })
    expect(refused.ok).toBe(false)
    const on = await triggers.set({
      workflow: 'patrol',
      node: 'tick',
      enabled: true,
      session: 'chat',
    })
    expect(on.ok).toBe(true)

    await saveGraph('patrol', {
      launch: { session: 'fixed' },
      source: { kind: 'schedule', schedule: { kind: 'cron', expression: '0 25 * * *' } },
    })
    await own(triggers)
    clock += 24 * 60 * MINUTE
    await triggers.tick()
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({ state: 'invalid' })
    expect(sent).toEqual([])
  })

  it('另一个进程在负责时：这里显示「由别的负责」，到点也不触发；对方退出后接手', async () => {
    await saveGraph('patrol')
    const other = service(1)
    const here = service(2)
    await own(other)
    await here.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    expect((await here.list('patrol')).triggers[0]?.state).toBe('elsewhere')
    expect((await other.list('patrol')).triggers[0]?.state).toBe('waiting')

    await other.stop()
    clock += 31 * MINUTE
    await own(here)
    expect(sent).toHaveLength(1)
    expect((await here.list('patrol')).triggers[0]?.state).toBe('waiting')
  })

  it('卡片从图里删掉、工作流删掉：开关跟着清掉；改名时跟着走', async () => {
    await saveGraph('patrol')
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    expect((await repository.rename('patrol', 'watch')).ok).toBe(true)
    expect(Object.keys(await store.locals())).toEqual(['watch'])
    await own(triggers)
    expect((await triggers.list('watch')).triggers[0]?.state).toBe('waiting')

    await repository.remove('watch')
    await triggers.tick()
    expect(await store.locals()).toEqual({})
  })

  it('这个进程发不了会话：不争负责权，状态说明原因', async () => {
    await saveGraph('patrol')
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    unavailable = '这个 DSH 里没有会话服务，发不了会话'
    await own(triggers)
    expect((await triggers.list('patrol')).owner).toBeUndefined()
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      state: 'unavailable',
      problem: unavailable,
    })
  })
})

describe('到点触发', () => {
  async function ready(data: Partial<TriggerData> = {}): Promise<TriggerService> {
    await saveGraph('patrol', data)
    const triggers = service()
    const on = await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    expect(on.ok).toBe(true)
    await own(triggers)
    return triggers
  }

  it('没到点不触发；到点在工作区里新建会话、把消息发进去，然后排下一次', async () => {
    const triggers = await ready({ note: '只看 src/' })
    const start = clock
    clock += 29 * MINUTE
    await triggers.tick()
    expect(sent).toEqual([])

    clock = start + 30 * MINUTE
    await triggers.tick()
    expect(opened).toEqual([{ cwd: workspace, title: 'patrol · 巡检' }])
    expect(sent).toHaveLength(1)
    const [fire] = await triggers.history('patrol')
    expect(fire).toMatchObject({
      workflow: 'patrol',
      node: 'tick',
      name: '巡检',
      channel: 'schedule',
      outcome: 'sent',
      session: 's1',
    })
    const message = sent[0]?.text ?? ''
    expect(message).toContain('每 30 分钟')
    expect(message).toContain('> 只看 src/')
    expect(message).toContain(`fire=${fire?.id ?? ''}`)
    expect(message).toContain('action=compile')
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      state: 'waiting',
      next: start + 60 * MINUTE,
      last: { outcome: 'sent' },
    })

    // 同一刻再对一遍账不会重复触发。
    await triggers.tick()
    expect(sent).toHaveLength(1)
  })

  it('上一次的会话还在跑就跳过；选了「并行」照样触发', async () => {
    const triggers = await ready()
    clock += 30 * MINUTE
    await triggers.tick()
    busy.add('s1')
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)
    expect((await triggers.history('patrol'))[0]).toMatchObject({
      outcome: 'skipped',
      reason: '上一次触发的会话还在运行',
    })

    await saveGraph('patrol', { launch: { overlap: 'parallel' } })
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(2)
    expect(opened).toHaveLength(2)
  })

  it('「接着上一次的会话」：发进上一次的会话，它不在了就新建', async () => {
    const triggers = await ready({ launch: { session: 'last' } })
    clock += 30 * MINUTE
    await triggers.tick()
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent.map((item) => item.session)).toEqual(['s1', 's1'])
    gone.add('s1')
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent.map((item) => item.session)).toEqual(['s1', 's1', 's2'])
  })

  it('错过的只补一次；关掉「补触发」就只记一条跳过', async () => {
    const triggers = await ready()
    await triggers.stop()
    clock += 10 * 60 * MINUTE
    const later = service(101)
    await own(later)
    expect(sent).toHaveLength(1)
    await later.tick()
    expect(sent).toHaveLength(1)

    await later.stop()
    await saveGraph('patrol', { launch: { catchUp: false } })
    clock += 10 * 60 * MINUTE + LATE_MS
    const last = service(102)
    await own(last)
    expect(sent).toHaveLength(1)
    expect((await last.history('patrol'))[0]).toMatchObject({ outcome: 'skipped' })
  })

  it('每小时的上限：超过的跳过，不算失败、不停用', async () => {
    const triggers = await ready({
      source: { kind: 'schedule', schedule: { kind: 'every', minutes: 10 } },
      launch: { maxPerHour: 2, overlap: 'parallel' },
    })
    for (let round = 0; round < 4; round += 1) {
      clock += 10 * MINUTE
      await triggers.tick()
    }
    expect(sent).toHaveLength(2)
    const fires = await triggers.history('patrol')
    expect(fires.map((fire) => fire.outcome)).toEqual(['skipped', 'skipped', 'sent', 'sent'])
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      enabled: true,
      state: 'waiting',
    })
  })

  it('连续 3 次发不出去自动停用，说出原因；中间发出去一次就重新数', async () => {
    const triggers = await ready()
    openError = '工作区不见了'
    for (let round = 0; round < 2; round += 1) {
      clock += 30 * MINUTE
      await triggers.tick()
    }
    openError = null
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)

    openError = '工作区不见了'
    for (let round = 0; round < 3; round += 1) {
      clock += 30 * MINUTE
      await triggers.tick()
    }
    const [view] = (await triggers.list('patrol')).triggers
    expect(view).toMatchObject({ enabled: false, state: 'stopped' })
    expect(view?.problem).toContain('连续 3 次失败')
    expect(view?.problem).toContain('工作区不见了')

    // 停用之后不再触发；用户再打开就重新开始。
    openError = null
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true })
    clock += 30 * MINUTE
    await triggers.tick()
    await triggers.tick()
    expect(sent).toHaveLength(2)
  })

  it('图编译不出计划：算发不出去', async () => {
    const triggers = await ready()
    // 只剩触发卡片、没有步骤的图编译不出计划。
    const load = await repository.load('patrol')
    const document = load.document as WorkflowDocument
    const saved = await repository.save(
      'patrol',
      { ...document, nodes: document.nodes.filter((node) => node.type === 'wfTrigger') },
      { baseHash: load.hash as string },
    )
    expect(saved.ok).toBe(true)
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toEqual([])
    const [fire] = await triggers.history('patrol')
    expect(fire?.outcome).toBe('failed')
    expect(fire?.reason).toContain('工作流现在执行不了')
  })
})

describe('立即触发一次', () => {
  it('不看开关；带上手填的背景信息；没选工作区时说出原因', async () => {
    await saveGraph('patrol')
    const triggers = service()
    const failed = await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    expect(failed.ok && failed.result).toMatchObject({
      outcome: 'failed',
      reason: '还没选在哪个工作区里新建会话',
    })

    await triggers.set({ workflow: 'patrol', node: 'tick', workspace })
    const fired = await triggers.fireNow({
      workflow: 'patrol',
      node: 'tick',
      info: '线上告警：\n# 磁盘 91%',
    })
    expect(fired.ok && fired.result).toMatchObject({ outcome: 'sent', channel: 'now' })
    expect(sent[0]?.text).toContain('用户点了「立即触发一次」')
    expect(sent[0]?.text).toContain('> 线上告警：\n> # 磁盘 91%')
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      enabled: false,
      state: 'off',
      last: { outcome: 'sent', channel: 'now' },
    })
  })
})

describe('实例记下的来源', () => {
  let runs: RunService
  let run: (args: WorkflowLiteArgs, exec?: ToolExecView) => Promise<JsonValue>
  const exec = (session: string): ToolExecView => ({
    agent: { session: { header: { id: session, cwd: workspace } } },
  })
  const instanceOf = (value: JsonValue): string =>
    (value as { instance?: string }).instance as string
  const view = async (id: string): Promise<InstanceView> => {
    const outcome = await runs.view(id, undefined)
    if (!outcome.ok || 'unchanged' in outcome.result) throw new Error('读不出实例')
    return outcome.result
  }

  beforeEach(() => {
    runs = new RunService({
      dataDir: () => dataDir,
      validate,
      origins: createFireClaims(store, () => clock),
    })
    run = createWorkflowLiteHandler({
      repository,
      dataDir: () => dataDir,
      maxResultBytes: () => 262_144,
      runs,
    })
  })

  it('模型带着触发编号编译：实例记下是哪张卡片、什么时候、带了什么；触发记录里有实例', async () => {
    await saveGraph('patrol', { note: '只看 src/' })
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', workspace })
    const fired = await triggers.fireNow({ workflow: 'patrol', node: 'tick', info: '磁盘 91%' })
    if (!fired.ok) throw new Error('没触发')
    const fire = fired.result
    const id = instanceOf(
      await run({ action: 'compile', workflow: 'patrol', fire: fire.id }, exec('s1')),
    )
    const instance = await view(id)
    expect(instance.origin).toEqual({
      channel: 'now',
      trigger: { id: 'tick', name: '巡检' },
      firedAt: fire.at,
      note: '只看 src/',
      info: '磁盘 91%',
    })
    expect(instance.summary.origin).toEqual({
      channel: 'now',
      trigger: { id: 'tick', name: '巡检' },
      firedAt: fire.at,
    })
    expect((await triggers.history('patrol'))[0]?.instance).toBe(id)
    const index = JSON.parse(await readFile(join(dataDir, 'instances.json'), 'utf8')) as {
      instances: { origin?: unknown }[]
    }
    expect(index.instances[0]?.origin).toEqual(instance.summary.origin)
  })

  it('模型漏了触发编号：按会话对上刚发的那次；别的会话、太久以前的不算', async () => {
    await saveGraph('patrol')
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', workspace })
    await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    const elsewhere = instanceOf(
      await run({ action: 'compile', workflow: 'patrol' }, exec('other')),
    )
    expect((await view(elsewhere)).origin).toEqual({ channel: 'session' })
    const here = instanceOf(await run({ action: 'compile', workflow: 'patrol' }, exec('s1')))
    expect((await view(here)).origin?.channel).toBe('now')

    await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    clock += 2 * 60 * MINUTE
    const late = instanceOf(await run({ action: 'compile', workflow: 'patrol' }, exec('s2')))
    expect((await view(late)).origin).toEqual({ channel: 'session' })
  })

  it('画布上点「执行」的记成手动', async () => {
    await saveGraph('patrol')
    const load = await repository.load('patrol')
    const started = await runs.start({
      workflow: 'patrol',
      document: load.document as WorkflowDocument,
      problems: load.problems,
      session: { id: 's1', cwd: workspace },
    })
    if (!started.ok) throw new Error('没建出实例')
    expect(started.result.instance.origin).toEqual({ channel: 'manual' })
  })
})

describe('常驻触发源', () => {
  const COMMAND = 'node "{workflow}/triggers/tail-log.mjs" app.log'
  const listen = (command = COMMAND): Partial<TriggerData> => ({
    source: { kind: 'listen', command },
  })
  const set = (triggers: TriggerService, change: Record<string, unknown>) =>
    triggers.set({ workflow: 'patrol', node: 'tick', ...change })
  const ref = { workflow: 'patrol', node: 'tick', kind: 'listen' } as const

  /** 一张确认过、开着的监听卡片，本进程负责。 */
  async function listening(data: Partial<TriggerData> = {}): Promise<TriggerService> {
    await saveGraph('patrol', { ...listen(), ...data })
    const triggers = service()
    const on = await set(triggers, {
      workspace,
      approve: (data.source as { command?: string } | undefined)?.command ?? COMMAND,
      enabled: true,
    })
    expect(on.ok).toBe(true)
    await own(triggers)
    return triggers
  }

  it('要跑命令的卡片：先选工作区、确认命令才打开；确认的是图里现在的那条', async () => {
    await saveGraph('patrol', listen())
    const triggers = service()
    const noCwd = await set(triggers, { enabled: true })
    expect(!noCwd.ok && noCwd.error.message).toBe('先选命令在哪个工作区里运行')
    const unconfirmed = await set(triggers, { workspace, enabled: true })
    expect(!unconfirmed.ok && unconfirmed.error.message).toBe('要先确认将要运行的命令')
    // 被拒的那次什么都不留：工作区也要再给一次。
    const stale = await set(triggers, { workspace, approve: 'node old.mjs', enabled: true })
    expect(!stale.ok && stale.error.message).toContain('刚改过')

    const on = await set(triggers, { workspace, approve: COMMAND, enabled: true })
    expect(on.ok && on.result.triggers[0]).toMatchObject({
      enabled: true,
      approved: true,
      state: 'waiting',
    })
    await own(triggers)
    // 命令里的 {workflow} 换成工作流目录，环境变量里也有。
    const dir = assetsDir(dataDir, 'patrol')
    expect(live.specs).toEqual([
      {
        workflow: 'patrol',
        node: 'tick',
        source: { kind: 'listen', command: COMMAND },
        filter: { merge: 5, dedupe: 0, include: [], exclude: [] },
        cwd: workspace,
        command: COMMAND.replace('{workflow}', dir.replace(/\\/gu, '/')),
        env: { WORKFLOW_DIR: dir },
      },
    ])
  })

  it('命令或工作区改过：停下来等重新确认；确认后接着跑', async () => {
    const triggers = await listening()
    await saveGraph('patrol', listen('node other.mjs'))
    await triggers.tick()
    expect(live.specs).toEqual([])
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      enabled: true,
      approved: false,
      state: 'confirm',
      problem: '要运行的命令或工作区改过了，要重新确认',
    })
    await set(triggers, { approve: 'node other.mjs' })
    await triggers.tick()
    expect(live.specs).toHaveLength(1)

    const elsewhere = join(dataDir, 'ws2')
    await mkdir(elsewhere)
    await set(triggers, { workspace: elsewhere })
    await triggers.tick()
    expect(live.specs).toEqual([])
    expect((await triggers.list('patrol')).triggers[0]?.state).toBe('confirm')
  })

  it('监听程序最近打出的一行跟着状态给到卡片；重启等待中也留着', async () => {
    const triggers = await listening()
    const line = { at: clock, text: 'ERROR pay timeout' }
    await store.writeLive({
      pid: 100,
      sources: { patrol: { tick: { state: 'running', since: clock - 1000, line } } },
    })
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      state: 'listening',
      since: clock - 1000,
      line,
    })
    await store.writeLive({
      pid: 100,
      sources: { patrol: { tick: { state: 'restarting', next: clock + 5000, line } } },
    })
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({ state: 'restarting', line })
  })

  it('进来的内容发进会话：带上背景信息、合并了几次；记录的渠道是监听程序', async () => {
    const triggers = await listening({ note: '看看是哪个模块' })
    live.events?.deliver(ref, { info: 'ERROR pay timeout\nERROR pay 502', count: 2 })
    await triggers.settled()
    expect(sent).toHaveLength(1)
    const message = sent[0]?.text ?? ''
    expect(message).toContain('监听程序打出了一行')
    expect(message).toContain('## 背景信息')
    expect(message).toContain('这次是 2 次触发合并在一起的')
    expect(message).toContain('> ERROR pay timeout\n> ERROR pay 502')
    expect(message).not.toContain('action=decline')
    expect((await triggers.history('patrol'))[0]).toMatchObject({
      channel: 'listen',
      outcome: 'sent',
    })

    // 关掉之后进来的不发。
    await set(triggers, { enabled: false })
    live.events?.deliver(ref, { info: 'late', count: 1 })
    await triggers.settled()
    expect(sent).toHaveLength(1)
  })

  it('背景信息很长：消息里只放开头，全文另存成文件', async () => {
    const triggers = await listening()
    const long = `${'x'.repeat(5000)}END`
    live.events?.deliver(ref, { info: long, count: 1 })
    await triggers.settled()
    const message = sent[0]?.text ?? ''
    expect(message).not.toContain('END')
    const [fire] = await triggers.history('patrol')
    const path = /全文在 `([^`]+)`/u.exec(message)?.[1] ?? ''
    expect(path).toContain(fire?.id ?? '?')
    expect(await readFile(path, 'utf8')).toBe(long)
  })

  it('每小时的上限：超过的丢掉，十分钟里只记一条跳过', async () => {
    const triggers = await listening({ launch: { maxPerHour: 1, overlap: 'parallel' } })
    for (let n = 0; n < 4; n += 1) live.events?.deliver(ref, { info: `e${String(n)}`, count: 1 })
    await triggers.settled()
    expect(sent).toHaveLength(1)
    expect((await triggers.history('patrol')).map((fire) => fire.outcome)).toEqual([
      'skipped',
      'sent',
    ])
    clock += 11 * MINUTE
    live.events?.deliver(ref, { info: 'e5', count: 1 })
    await triggers.settled()
    expect((await triggers.history('patrol')).map((fire) => fire.outcome)).toEqual([
      'skipped',
      'skipped',
      'sent',
    ])
  })

  it('程序一启动就退出算失败，连续几次自动停用；好好跑过一次就重新数', async () => {
    const triggers = await listening()
    live.events?.failed(ref, '监听程序运行 1 秒后退出了（退出码 1）')
    live.events?.failed(ref, '监听程序运行 1 秒后退出了（退出码 1）')
    live.events?.healthy(ref)
    live.events?.failed(ref, '监听程序运行 1 秒后退出了（退出码 1）')
    live.events?.failed(ref, '监听程序运行 1 秒后退出了（退出码 1）')
    await triggers.settled()
    expect((await triggers.list('patrol')).triggers[0]?.enabled).toBe(true)
    live.events?.failed(ref, '找不到命令')
    await triggers.settled()
    await triggers.tick()
    const [view] = (await triggers.list('patrol')).triggers
    expect(view).toMatchObject({ enabled: false, state: 'stopped' })
    expect(view?.problem).toBe('连续 3 次失败：找不到命令')
    expect(live.specs).toEqual([])
  })

  it('状态按负责的进程写下的运行情况说；别的进程写的不作数', async () => {
    const triggers = await listening()
    const sources = {
      patrol: { tick: { state: 'restarting' as const, note: '退出了', next: clock + 4000 } },
    }
    await store.writeLive({ pid: 100, sources, port: { kind: 'closed' } })
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      state: 'restarting',
      problem: '退出了',
      next: clock + 4000,
    })
    await store.writeLive({ pid: 999, sources, port: { kind: 'closed' } })
    expect((await triggers.list('patrol')).triggers[0]?.state).toBe('waiting')
  })

  it('HTTP：打开时给地址和令牌；换令牌地址不变；端口开不了时显示出错', async () => {
    await saveGraph('patrol', { source: { kind: 'http' } })
    const triggers = service()
    const on = await set(triggers, { workspace, enabled: true })
    const endpoint = on.ok ? on.result.triggers[0]?.endpoint : undefined
    expect(endpoint?.url).toMatch(/^http:\/\/127\.0\.0\.1:3791\/trigger\/[\w-]+$/u)
    expect(endpoint?.token.length).toBeGreaterThan(20)
    expect(on.ok && on.result.triggers[0]).not.toHaveProperty('approved')

    const reset = await set(triggers, { resetToken: true })
    const after = reset.ok ? reset.result.triggers[0]?.endpoint : undefined
    expect(after?.url).toBe(endpoint?.url)
    expect(after?.token).not.toBe(endpoint?.token)

    await own(triggers)
    expect(live.specs[0]?.hook).toEqual({
      id: endpoint?.url.split('/').pop(),
      token: after?.token,
    })
    await store.writeLive({
      pid: 100,
      sources: {},
      port: { kind: 'error', port: 3791, problem: '端口 3791 被别的程序占用了' },
    })
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      state: 'error',
      problem: '端口 3791 被别的程序占用了',
    })
    // 定时卡片没有令牌可换。
    await saveGraph('patrol')
    const refused = await set(triggers, { resetToken: true })
    expect(!refused.ok && refused.error.message).toBe('只有 HTTP 触发有令牌')
  })

  it('不归这个进程负责时常驻的都停下', async () => {
    const triggers = await listening()
    expect(live.specs).toHaveLength(1)
    unavailable = '这个 DSH 里没有会话服务'
    await triggers.tick()
    expect(live.specs).toEqual([])
    expect(live.stopped).toBeGreaterThan(0)
  })
})

describe('触发条件与模型判断', () => {
  let run: (args: WorkflowLiteArgs, exec?: ToolExecView) => Promise<JsonValue>
  let triggers: TriggerService

  beforeEach(() => {
    triggers = service()
    run = createWorkflowLiteHandler({
      repository,
      dataDir: () => dataDir,
      maxResultBytes: () => 262_144,
      triggers,
    })
  })

  it('有触发条件时先让模型判断；模型判断不需要就记下原因', async () => {
    await saveGraph('patrol', { condition: '只处理支付模块的报错' })
    await triggers.set({ workflow: 'patrol', node: 'tick', workspace })
    const fired = await triggers.fireNow({ workflow: 'patrol', node: 'tick', info: 'ERROR user' })
    if (!fired.ok) throw new Error('没触发')
    const message = sent[0]?.text ?? ''
    expect(message).toContain('## 触发条件')
    expect(message).toContain('> 只处理支付模块的报错')
    expect(message).toContain(`action=decline，fire=${fired.result.id}`)

    const result = await run({ action: 'decline', fire: fired.result.id, reason: '是用户模块的' })
    expect(result).toMatchObject({ declined: fired.result.id })
    expect((await triggers.history('patrol'))[0]).toMatchObject({
      outcome: 'sent',
      declined: '是用户模块的',
    })
    expect((await triggers.list('patrol')).triggers[0]?.last?.declined).toBe('是用户模块的')
    expect(await run({ action: 'decline', fire: 'nope', reason: 'x' })).toMatchObject({
      error: { code: 'not_found' },
    })
  })

  it('已经建出实例的那次不能再说不需要', async () => {
    await saveGraph('patrol')
    await triggers.set({ workflow: 'patrol', node: 'tick', workspace })
    const fired = await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    if (!fired.ok) throw new Error('没触发')
    await store.bind(fired.result.id, 'run-1')
    const refused = await triggers.decline(fired.result.id, '不需要')
    expect(!refused.ok && refused.error.message).toContain('已经开始执行了')
  })
})

describe('模型建触发卡片', () => {
  let run: (args: WorkflowLiteArgs, exec?: ToolExecView) => Promise<JsonValue>

  beforeEach(() => {
    run = createWorkflowLiteHandler({
      repository,
      dataDir: () => dataDir,
      maxResultBytes: () => 262_144,
    })
  })

  it('建一张关着的卡片；同一个 id 再写是修改；设置不对的拒绝；读的时候列出卡片和目录', async () => {
    await saveGraph('patrol')
    const created = await run({
      action: 'write_trigger',
      workflow: 'patrol',
      trigger: {
        label: '日志报错',
        source: { kind: 'listen', command: 'node "{workflow}/triggers/tail-log.mjs" app.log' },
        filter: { include: ['ERROR'] },
        note: '找出是哪个模块',
      },
    })
    expect(created).toMatchObject({ changed: [{ id: 'trigger', op: 'add' }] })
    expect((created as { next?: string }).next).toContain('关着')

    const edited = await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'trigger',
      trigger: { condition: '只管支付模块', note: '' },
    })
    expect(edited).toMatchObject({ changed: [{ id: 'trigger' }] })
    const load = await repository.load('patrol')
    const card = load.document?.nodes.find((node) => node.id === 'trigger')
    expect(card).toMatchObject({
      type: 'wfTrigger',
      position: { x: 0, y: 0 },
      data: {
        label: '日志报错',
        source: { kind: 'listen' },
        condition: '只管支付模块',
        filter: { include: ['ERROR'] },
      },
    })
    expect(card?.data).not.toHaveProperty('note')

    expect(
      await run({
        action: 'write_trigger',
        workflow: 'patrol',
        trigger: { source: { kind: 'poll', command: 'x', seconds: 1 } },
      }),
    ).toMatchObject({ error: { code: 'invalid_args' } })
    expect(
      await run({ action: 'write_trigger', workflow: 'patrol', node: 'work', trigger: {} }),
    ).toMatchObject({ error: { code: 'blocked' } })

    const index = (await run({ action: 'read', workflow: 'patrol' })) as {
      dir?: string
      triggers?: { id: string }[]
    }
    expect(index.dir).toBe(assetsDir(dataDir, 'patrol'))
    expect(index.triggers?.map((item) => item.id)).toEqual(['tick', 'trigger'])
  })

  it('接续触发：触发源里写等哪个工作流、什么结果', async () => {
    await saveGraph('patrol')
    const created = await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'tick',
      trigger: { source: { kind: 'after', workflow: '构建', when: 'failed' } },
    })
    expect(created).toMatchObject({ changed: [{ id: 'tick' }] })
    const load = await repository.load('patrol')
    expect(load.document?.nodes.find((node) => node.id === 'tick')?.data).toMatchObject({
      source: { kind: 'after', workflow: '构建', when: 'failed' },
    })
  })
})

describe('全部暂停', () => {
  async function ready(): Promise<TriggerService> {
    await saveGraph('patrol')
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    await own(triggers)
    return triggers
  }

  it('暂停着到点不触发、开关不变；恢复后不补，下一次从恢复时往后排', async () => {
    const triggers = await ready()
    const paused = await triggers.pause(true)
    expect(paused).toEqual({ paused: clock })
    expect(await triggers.list('patrol')).toMatchObject({
      paused: clock,
      triggers: [{ enabled: true, state: 'paused' }],
    })

    clock += 95 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(0)

    expect(await triggers.pause(false)).toEqual({})
    await triggers.tick()
    expect(sent).toHaveLength(0)
    const view = (await triggers.list('patrol')).triggers[0]
    expect(view).toMatchObject({ enabled: true, state: 'waiting' })
    expect(view?.next).toBeGreaterThan(clock)
    expect(await triggers.history('patrol')).toEqual([])
  })

  it('暂停着「立即触发一次」照常可用', async () => {
    const triggers = await ready()
    await triggers.pause(true)
    const fired = await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    expect(fired.ok && fired.result).toMatchObject({ outcome: 'sent', channel: 'now' })
    expect(sent).toHaveLength(1)
  })

  it('暂停着常驻触发源都停下；恢复后照常开着', async () => {
    const command = 'node watch.mjs'
    await saveGraph('patrol', { source: { kind: 'listen', command } })
    const triggers = service()
    await triggers.set({
      workflow: 'patrol',
      node: 'tick',
      workspace,
      approve: command,
      enabled: true,
    })
    await own(triggers)
    expect(live.specs).toHaveLength(1)
    await triggers.pause(true)
    await triggers.tick()
    expect(live.specs).toEqual([])
    await triggers.pause(false)
    await triggers.tick()
    expect(live.specs).toHaveLength(1)
  })

  it('恢复后条件轮询从现在起算：暂停前记下的结果不拿来比', async () => {
    const command = 'git ls-remote origin'
    await saveGraph('patrol', { source: { kind: 'poll', command, seconds: 60, when: 'change' } })
    const triggers = service()
    await triggers.set({
      workflow: 'patrol',
      node: 'tick',
      workspace,
      approve: command,
      enabled: true,
    })
    await own(triggers)
    live.events?.probed({ workflow: 'patrol', node: 'tick', kind: 'poll' }, { digest: 'before' })
    await triggers.settled()
    expect((await store.locals()).patrol?.tick?.probe).toEqual({ digest: 'before' })

    await triggers.pause(true)
    await triggers.pause(false)
    expect((await store.locals()).patrol?.tick?.probe).toEqual({ ok: true })
    await triggers.tick()
    expect(live.specs[0]).toMatchObject({ probe: { ok: true } })
  })
})

describe('接续触发', () => {
  /** 被等的工作流：一个步骤，可选记不记运行状态。 */
  async function saveUpstream(name: string, runState = true): Promise<void> {
    const existing = await repository.load(name)
    if (!existing.exists) await repository.create(name)
    const base = (await repository.load(name)).hash
    const saved = await repository.save(
      name,
      {
        nodes: [
          { id: 'build', type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: '构建' } },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        ...(runState ? { settings: { runState: true } } : {}),
      },
      { baseHash: base as string },
    )
    expect(saved.ok).toBe(true)
  }

  const run = (id: string, status: FinishedRun['status'], at: number): FinishedRun => ({
    id,
    status,
    at,
    goal: '构建发布包',
    cwd: workspace,
    statePath: join(workspace, '.workflow-lite', 'runs', id, 'state.yaml'),
    done: 3,
    total: 4,
  })

  const enable = (triggers: TriggerService) =>
    triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })

  async function ready(data: Partial<TriggerData> = {}): Promise<TriggerService> {
    await saveUpstream('build')
    await saveGraph('patrol', { source: { kind: 'after', workflow: 'build' }, ...data })
    const triggers = service()
    const on = await enable(triggers)
    expect(on.ok).toBe(true)
    await own(triggers)
    return triggers
  }

  it('等的工作流不在、没开「记录运行状态」、是自己：打不开，说出原因', async () => {
    await saveGraph('patrol', { source: { kind: 'after', workflow: 'build' } })
    const triggers = service()
    const missing = await enable(triggers)
    expect(!missing.ok && missing.error.message).toContain('不存在')

    await saveUpstream('build', false)
    const noState = await enable(triggers)
    expect(!noState.ok && noState.error.message).toContain('记录运行状态')

    await saveGraph('patrol', { source: { kind: 'after', workflow: 'patrol' } })
    const self = await enable(triggers)
    expect(!self.ok && self.error.message).toContain('不能等自己')
  })

  it('开着之后等的工作流关了「记录运行状态」：显示设置不对，不触发', async () => {
    const triggers = await ready()
    await saveUpstream('build', false)
    finished.set('build', [run('r1', 'done', clock + 1)])
    clock += MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(0)
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({ state: 'invalid' })
  })

  it('结束了一次、结果对得上就触发一次，背景信息说明是哪个实例；同一个实例不再触发', async () => {
    const triggers = await ready()
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({ state: 'waiting' })
    // 打开之前结束的不算。
    finished.set('build', [run('old', 'done', clock - MINUTE)])
    await triggers.tick()
    expect(sent).toHaveLength(0)

    finished.set('build', [
      run('old', 'done', clock - MINUTE),
      run('r1', 'done', clock + 1),
      run('r2', 'failed', clock + 2),
    ])
    clock += MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain('工作流「build」的实例 r1 结束了：成功（done），完成 3/4 步。')
    expect(sent[0]?.text).toContain(join(workspace, '.workflow-lite', 'runs', 'r1', 'state.yaml'))
    expect((await triggers.history('patrol'))[0]).toMatchObject({
      outcome: 'sent',
      channel: 'after',
    })

    await triggers.tick()
    expect(sent).toHaveLength(1)
  })

  it('「失败时」「不论结果」按结果挑', async () => {
    const triggers = await ready({ source: { kind: 'after', workflow: 'build', when: 'failed' } })
    finished.set('build', [run('r1', 'done', clock + 1), run('r2', 'failed', clock + 2)])
    clock += MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain('实例 r2 结束了')

    await saveGraph('patrol', { source: { kind: 'after', workflow: 'build', when: 'any' } })
    finished.set('build', [
      run('r1', 'done', clock - 1),
      run('r2', 'failed', clock - 1),
      run('r3', 'cancelled', clock + 1),
    ])
    clock += MINUTE
    await triggers.tick()
    // r1、r2 已经看过，只有 r3。
    expect(sent).toHaveLength(2)
    expect(sent[1]?.text).toContain('实例 r3 结束了：取消（cancelled）')
  })

  it('暂停着结束的只记下、不触发；恢复后也不补', async () => {
    const triggers = await ready()
    await triggers.pause(true)
    finished.set('build', [run('r1', 'done', clock + 1)])
    clock += MINUTE
    await triggers.tick()
    await triggers.pause(false)
    await triggers.tick()
    expect(sent).toHaveLength(0)
  })

  it('两个工作流互相等：每小时的上限挡住来回触发', async () => {
    const triggers = await ready({ launch: { maxPerHour: 2, overlap: 'parallel' } })
    for (let round = 1; round <= 4; round += 1) {
      finished.set('build', [
        ...(finished.get('build') ?? []),
        run(`r${String(round)}`, 'done', clock + 1),
      ])
      clock += MINUTE
      await triggers.tick()
    }
    expect(sent).toHaveLength(2)
    const fires = await triggers.history('patrol')
    expect(fires.map((fire) => fire.outcome)).toEqual(['skipped', 'sent', 'sent'])
  })
})

describe('「触发」页的总表', () => {
  it('列出各工作流里的卡片（按工作流名排），带上定义、状态和暂停', async () => {
    await saveGraph('zeta')
    await saveGraph('alpha', { label: '早报' })
    await repository.create('empty')
    const triggers = service()
    await triggers.set({ workflow: 'zeta', node: 'tick', enabled: true, workspace })
    await triggers.pause(true)
    const all = await triggers.all()
    expect(all.paused).toBe(clock)
    expect(all.triggers.map((entry) => [entry.workflow, entry.name, entry.view.state])).toEqual([
      ['alpha', '早报', 'off'],
      ['zeta', '巡检', 'paused'],
    ])
    expect(all.triggers[0]?.data.source).toEqual({
      kind: 'schedule',
      schedule: { kind: 'every', minutes: 30 },
    })
  })
})
