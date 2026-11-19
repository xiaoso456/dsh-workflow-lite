/**
 * 触发器（host）：谁负责触发、到点触发与跳过、连续失败自动停用、开关与本机设置、
 * 「立即触发一次」，以及触发出来的实例记下的来源；常驻触发源（轮询、监听程序、HTTP）的
 * 命令确认、发进会话、失败计数、模型判断不需要，模型建触发卡片；全部暂停、接续触发、「触发」页的总表。
 * 常驻触发源本身（跑命令、开端口）换成假的，见 `triggerSources.spec.ts`。
 */

import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunService } from '../../src/host/runs/service.ts'
import { DATABASE_FILE, PluginDatabase } from '../../src/host/store/database.ts'
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
import { createTriggerGraphs, followWorkflows } from '../../src/host/triggers/graphs.ts'
import { OWNER_STALE_MS, OwnerLock } from '../../src/host/triggers/owner.ts'
import type { LiveRuntime, LiveSpec, RuntimeEvents } from '../../src/host/triggers/runtime.ts'
import { LATE_MS, TriggerService } from '../../src/host/triggers/service.ts'
import type { SessionPort } from '../../src/host/triggers/sessions.ts'
import { approvalOf, cardDataDir, ownerFile, TriggerStore } from '../../src/host/triggers/store.ts'
import type { InstanceView, RunStatus } from '../../src/shared/runState.ts'
import type { SessionChoice, TriggerData, WorkflowDocument } from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'
import type { ChoiceFallback } from '../../src/shared/wire/host.ts'

const MINUTE = 60_000

let dataDir: string
let workspace: string
let repository: Repository
let store: TriggerStore
let database: PluginDatabase
let clock: number
let sent: { session: string; text: string }[]
let opened: { cwd: string; title: string; choice?: SessionChoice }[]
/** 假会话新建时回的回退（设了的预设、模型没用上）。 */
let openFallbacks: ChoiceFallback[]
/** 假的实例运行状态：实例 → 整体状态（`null` = 实例不在了）。 */
let states: Map<string, { status?: RunStatus; at?: number } | null>
let gone: Set<string>
let unavailable: string | null
/** 插件设置里 HTTP 触发的监听地址。 */
let listenHost = '127.0.0.1'
/** 设置里的默认 shell（空串 = 系统的）。 */
let defaultShell = ''
let openError: string | null
/** 假的实例：接续触发看的「哪些实例结束了」（按工作流）。 */
let finished: Map<string, FinishedRun[]>
/** 假的实例：接续触发卡片上看的「等的那个工作流最新的实例」（按工作流）。 */
let newest: Map<string, { id: string; status?: RunStatus; at: number }>
/** 假的常驻触发源：记下每一轮该开着的，事件口留给测试自己喂。 */
let live: { specs: LiveSpec[]; events: RuntimeEvents | undefined; stopped: number }

const validate = (document: WorkflowDocument, workflow: string) =>
  reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 }))

const sessions: SessionPort = {
  unavailable: () => unavailable,
  open: async (input) => {
    if (openError !== null) throw new Error(openError)
    opened.push(input)
    return { session: `s${String(opened.length)}`, fallbacks: openFallbacks }
  },
  send: async (session, text) => {
    if (gone.has(session)) throw new Error('会话不存在')
    sent.push({ session, text })
  },
  prepare: async () => [],
  catalog: async () => ({ presets: [], providers: [], failures: [], modelSelectable: null }),
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
  stateOf: async (instance) => states.get(instance) ?? null,
  newest: async (workflow) => newest.get(workflow) ?? null,
}

/** 模型为这次触发建了实例、运行状态写着 `status`（不给就是没有状态文件）。 */
async function claim(
  fire: string | undefined,
  instance: string,
  status?: RunStatus,
): Promise<void> {
  await store.bind(fire ?? '', instance)
  states.set(instance, status === undefined ? {} : { status, at: clock })
}

function service(pid = 100, alive: (pid: number) => boolean = () => true): TriggerService {
  return new TriggerService({
    dataDir: () => dataDir,
    store,
    graphs: createTriggerGraphs(repository),
    sessions,
    now: () => clock,
    listen: () => ({ host: listenHost, port: 3791 }),
    defaultShell: () => defaultShell,
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
async function saveGraph(
  name: string,
  data: Partial<TriggerData> = {},
  runState = true,
  choice: SessionChoice = {},
): Promise<void> {
  const settings = { ...(runState ? { runState: true as const } : {}), ...choice }
  const document: WorkflowDocument = {
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
    nodes: [
      {
        id: 'tick',
        type: 'wfTrigger',
        position: { x: 0, y: 0 },
        data: {
          label: '巡检',
          source: { kind: 'schedule', schedule: { kind: 'every', seconds: 1800 } },
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
  listenHost = '127.0.0.1'
  defaultShell = ''
  workspace = join(dataDir, 'ws')
  await mkdir(workspace)
  database = new PluginDatabase(() => join(dataDir, DATABASE_FILE))
  store = new TriggerStore(() => dataDir, database)
  repository = followWorkflows(createRepository({ dataDir, validate }), store)
  await repository.ensureLayout()
  clock = new Date(2026, 10, 12, 9, 0).getTime()
  sent = []
  opened = []
  openFallbacks = []
  states = new Map()
  gone = new Set()
  unavailable = null
  openError = null
  live = { specs: [], events: undefined, stopped: 0 }
  finished = new Map()
  newest = new Map()
})

afterEach(async () => {
  database.close()
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
      { node: 'tick', enabled: false, runState: true, state: 'off' },
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
      source: { kind: 'schedule', schedule: { kind: 'every', seconds: 7200 } },
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

  it('卡片从图里删掉、工作流删掉：开关跟着清掉、触发记录一起删；改名时开关和触发记录跟着走', async () => {
    await saveGraph('patrol')
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    const fired = await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    if (!fired.ok) throw new Error('没触发')
    expect((await repository.rename('patrol', 'watch')).ok).toBe(true)
    expect(Object.keys(await store.locals())).toEqual(['watch'])
    expect((await triggers.history('watch', 'tick')).map((fire) => fire.id)).toEqual([
      fired.result.id,
    ])
    expect(await triggers.history('patrol', 'tick')).toEqual([])
    expect((await triggers.list('watch')).triggers[0]?.last?.workflow).toBe('watch')
    await own(triggers)
    expect((await triggers.list('watch')).triggers[0]?.state).toBe('waiting')

    await repository.remove('watch')
    expect(await triggers.history('watch', 'tick')).toEqual([])
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
    // 卡片、工作流都没设权限：触发器新建的会话用完全权限。
    expect(opened).toEqual([
      { cwd: workspace, title: 'patrol · 巡检', choice: { permission: 'danger-full-access' } },
    ])
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

  it('新建会话按卡片和工作流设的预设、模型、权限（卡片的项优先）；没用上的写进触发记录', async () => {
    await saveGraph(
      'patrol',
      { launch: { model: { provider: 'acme', model: 'small' }, permission: 'read-only' } },
      true,
      {
        preset: 'minimal',
        model: { provider: 'acme', model: 'big', effort: 'high' },
        permission: 'workspace-write',
      },
    )
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    await own(triggers)
    openFallbacks = [{ kind: 'unsupported' }]
    clock += 30 * MINUTE
    await triggers.tick()
    expect(opened[0]?.choice).toEqual({
      preset: 'minimal',
      model: { provider: 'acme', model: 'small' },
      permission: 'read-only',
    })
    const [fire] = await triggers.history('patrol')
    expect(fire).toMatchObject({
      outcome: 'sent',
      agent: {
        preset: 'minimal',
        model: { provider: 'acme', model: 'small' },
        permission: 'read-only',
        fallbacks: [{ kind: 'unsupported' }],
      },
    })
    // 卡片上「跟随工作流」要写的那一份跟着卡片的状态给出去（工作流设的，不掺触发器的缺省）。
    expect((await triggers.list('patrol')).triggers[0]?.workflowChoice).toEqual({
      preset: 'minimal',
      model: { provider: 'acme', model: 'big', effort: 'high' },
      permission: 'workspace-write',
    })
  })

  it('卡片没设权限时跟随工作流设的，不用触发器的缺省', async () => {
    await saveGraph('patrol', {}, true, { permission: 'read-only' })
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    await own(triggers)
    clock += 30 * MINUTE
    await triggers.tick()
    expect(opened[0]?.choice).toEqual({ permission: 'read-only' })
  })

  /** 最近一次发出去的那条。 */
  async function lastSent(triggers: TriggerService): Promise<string | undefined> {
    return (await triggers.history('patrol')).find((record) => record.outcome === 'sent')?.id
  }

  it('上一次没跑完（运行状态没写结束）就跳过；写了结束、模型说不做、点了「视为已结束」、实例删了都算跑完；「并行」照发', async () => {
    const triggers = await ready()
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)

    // 发进去了、还没对上实例：算没跑完。
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)
    expect((await triggers.history('patrol'))[0]).toMatchObject({
      outcome: 'skipped',
      reason: '上次执行未结束（运行状态尚未改为结束）',
    })
    // 被跳过了：卡片上写着在等哪一次（「视为已结束」对它说）；工作流开着「记录运行状态」。
    const first = await lastSent(triggers)
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      runState: true,
      waiting: { fire: first, session: 's1' },
    })
    expect((await triggers.list('patrol')).triggers[0]?.queued).toBeUndefined()

    // 对上了实例，模型停下来等用户回答（会话已经不在跑了）：还是没跑完。
    await claim(await lastSent(triggers), 'r1', 'waiting')
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)

    // 模型把状态改成完成：跑完了。
    states.set('r1', { status: 'done', at: clock })
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(2)

    // 模型说这次不用做：算跑完。
    await store.decline((await lastSent(triggers)) ?? '', '没有新提交')
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(3)

    // 一直卡着：点「视为已结束」。
    await claim(await lastSent(triggers), 'r3', 'running')
    expect((await triggers.waive('patrol', 'tick')).ok).toBe(true)
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(4)

    // 实例被删了：没东西可等。
    await claim(await lastSent(triggers), 'r4', 'running')
    states.set('r4', null)
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(5)

    await saveGraph('patrol', { launch: { overlap: 'parallel' } })
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(6)
  })

  it('选了跳过、排队却没开「记录运行状态」：卡片说明原因、打不开；已经开着的只记跳过；「并行」不受影响', async () => {
    const triggers = await ready()
    await saveGraph('patrol', {}, false)
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      state: 'invalid',
      problem: expect.stringContaining('记录运行状态'),
    })
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(0)
    expect((await triggers.history('patrol'))[0]).toMatchObject({
      outcome: 'skipped',
      reason: expect.stringContaining('记录运行状态'),
    })

    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: false })
    const refused = await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true })
    expect(!refused.ok && refused.error.message).toContain('记录运行状态')

    await saveGraph('patrol', { launch: { overlap: 'parallel' } }, false)
    expect((await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true })).ok).toBe(true)
  })

  it('排队：上一次没跑完就排着，排满了跳过；跑完了每一轮放行最早的一个，刚放出去的那个还没对上实例也算没跑完', async () => {
    const triggers = await ready({ launch: { overlap: 'queue', queueMax: 2 } })
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)
    const previous = await lastSent(triggers)
    await claim(previous, 'r1', 'running')
    for (let i = 0; i < 3; i += 1) {
      clock += 30 * MINUTE
      await triggers.tick()
    }
    expect(sent).toHaveLength(1)
    const [full, second, first] = await triggers.history('patrol')
    expect(full).toMatchObject({ outcome: 'skipped', reason: '已经排了 2 个，排满了' })
    expect(second?.outcome).toBe('queued')
    expect(first?.outcome).toBe('queued')
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      queued: 2,
      waiting: {
        fire: previous,
        session: 's1',
        instance: 'r1',
        status: 'running',
        since: clock - 90 * MINUTE,
      },
    })

    // 跑完了：放行先来的那个，新建会话发进去，原来那一条改成发出去、记下轮到的时刻。
    states.set('r1', { status: 'done', at: clock })
    await triggers.tick()
    expect(sent).toHaveLength(2)
    expect(sent[1]?.session).toBe('s2')
    expect(sent[1]?.text).toContain(`fire=${first?.id ?? ''}`)
    expect(
      (await triggers.history('patrol')).find((record) => record.id === first?.id),
    ).toMatchObject({
      outcome: 'sent',
      session: 's2',
      sentAt: clock,
    })
    // 刚放出去、模型还没建实例：不再放行，在等的换成它。
    await triggers.tick()
    expect(sent).toHaveLength(2)
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      queued: 1,
      waiting: { fire: first?.id, session: 's2', since: clock },
    })
    // 视为已结束：放行下一个。
    await triggers.waive('patrol', 'tick')
    await triggers.tick()
    expect(sent).toHaveLength(3)
    expect((await triggers.list('patrol')).triggers[0]?.queued).toBeUndefined()
  })

  it('排队：已经有排着的，上一次跑完了新来的也排在后面；关掉卡片、取消、清空都记成跳过；全部暂停时留着不发', async () => {
    const triggers = await ready({ launch: { overlap: 'queue' } })
    clock += 30 * MINUTE
    await triggers.tick()
    await claim(await lastSent(triggers), 'r1', 'running')
    clock += 30 * MINUTE
    await triggers.tick()
    states.set('r1', { status: 'done', at: clock })
    await triggers.pause(true)
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)
    expect((await triggers.list('patrol')).triggers[0]?.queued).toBe(1)
    await triggers.pause(false)

    // 取消排着的那一个；再取消一次说它已经不在排队了。
    const [queued] = await triggers.history('patrol')
    expect(queued?.outcome).toBe('queued')
    const cancelled = await triggers.cancelQueued(queued?.id ?? '')
    expect(cancelled.ok && cancelled.result).toMatchObject({
      outcome: 'skipped',
      reason: '手动取消',
    })
    expect((await triggers.cancelQueued(queued?.id ?? '')).ok).toBe(false)

    // 排一个；上一次跑完了，同一轮里到点的新来的排在它后面，先放行的是早来的那个。
    states.set('r1', { status: 'running', at: clock })
    clock += 30 * MINUTE
    await triggers.tick()
    const [early] = await triggers.history('patrol')
    expect(early?.outcome).toBe('queued')
    states.set('r1', { status: 'done', at: clock })
    clock += 30 * MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(2)
    expect(sent[1]?.text).toContain(`fire=${early?.id ?? ''}`)
    expect((await triggers.list('patrol')).triggers[0]?.queued).toBe(1)

    clock += 30 * MINUTE
    await triggers.tick()
    expect((await triggers.list('patrol')).triggers[0]?.queued).toBe(2)
    const cleared = await triggers.clearQueue('patrol', 'tick')
    expect(cleared.ok && cleared.result).toEqual({ cleared: 2 })

    clock += 30 * MINUTE
    await triggers.tick()
    expect((await triggers.list('patrol')).triggers[0]?.queued).toBe(1)
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: false })
    expect((await triggers.history('patrol'))[0]).toMatchObject({
      outcome: 'skipped',
      reason: '触发器停用了，排着的不再执行',
    })
    expect((await triggers.list('patrol')).triggers[0]?.queued).toBeUndefined()
  })

  it('「接着上一次的会话」：发进上一次的会话，它不在了就新建', async () => {
    const triggers = await ready({ launch: { session: 'last', overlap: 'parallel' } })
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

  it('打开「补触发」时错过的只补一次；缺省不补，只记一条跳过', async () => {
    const triggers = await ready({ launch: { catchUp: true } })
    await triggers.stop()
    clock += 10 * 60 * MINUTE
    const later = service(101)
    await own(later)
    expect(sent).toHaveLength(1)
    await later.tick()
    expect(sent).toHaveLength(1)

    await later.stop()
    await saveGraph('patrol', { launch: {} })
    clock += 10 * 60 * MINUTE + LATE_MS
    const last = service(102)
    await own(last)
    expect(sent).toHaveLength(1)
    expect((await last.history('patrol'))[0]).toMatchObject({ outcome: 'skipped' })
  })

  it('每小时的上限：超过的跳过，不算失败、不停用', async () => {
    const triggers = await ready({
      source: { kind: 'schedule', schedule: { kind: 'every', seconds: 600 } },
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

  it('上限写 0 是不限制：每小时不限次数，失败多少次都不自动停用', async () => {
    const triggers = await ready({
      source: { kind: 'schedule', schedule: { kind: 'every', seconds: 60 } },
      launch: { maxPerHour: 0, maxFailures: 0, overlap: 'parallel' },
    })
    for (let round = 0; round < 20; round += 1) {
      clock += MINUTE
      await triggers.tick()
    }
    expect(sent).toHaveLength(20)

    openError = '工作区不见了'
    for (let round = 0; round < 5; round += 1) {
      clock += MINUTE
      await triggers.tick()
    }
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({ enabled: true })
  })

  it('连续 3 次发不出去自动停用，说出原因；中间发出去一次就重新数', async () => {
    const triggers = await ready({ launch: { overlap: 'parallel' } })
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

  it('触发记录按要的条数给；一次触发的详情带着那一刻的触发说明和背景信息，太长只给开头', async () => {
    await saveGraph('patrol', { note: '只看 src/', launch: { overlap: 'parallel' } })
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', workspace })
    const ids: string[] = []
    for (const info of ['磁盘 91%', 'x'.repeat(20_500), undefined]) {
      const fired = await triggers.fireNow({
        workflow: 'patrol',
        node: 'tick',
        ...(info === undefined ? {} : { info }),
      })
      if (!fired.ok) throw new Error('没触发')
      ids.push(fired.result.id)
    }
    const [first = '', long = '', bare = ''] = ids

    // 新的在前；给了条数就只给那么多，乱给的数当成至少一条。
    expect((await triggers.history('patrol', 'tick')).map((fire) => fire.id)).toEqual([
      bare,
      long,
      first,
    ])
    expect((await triggers.history('patrol', 'tick', 2)).map((fire) => fire.id)).toEqual([
      bare,
      long,
    ])
    expect(await triggers.history('patrol', 'tick', 0)).toHaveLength(1)

    expect(await triggers.detail(first)).toEqual({ note: '只看 src/', info: '磁盘 91%' })
    const clipped = await triggers.detail(long)
    expect(clipped.info).toHaveLength(20_000)
    expect(clipped.infoClipped).toBe(true)
    expect(await triggers.detail(bare)).toEqual({ note: '只看 src/' })
    // 编号不对、记录已经不在：什么都没有，不报错。
    expect(await triggers.detail('f-20260101-000000-0000')).toEqual({})
    expect(await triggers.detail('../state')).toEqual({})
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
      agent: { permission: 'danger-full-access' },
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

  it('新建会话设的预设、模型和没用上的，跟着认领记进实例的来源', async () => {
    await saveGraph('patrol', {}, false, { model: { provider: 'acme', model: 'big' } })
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', workspace })
    openFallbacks = [{ kind: 'model', provider: 'acme', model: 'big' }]
    const fired = await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    if (!fired.ok) throw new Error('没触发')
    const id = instanceOf(
      await run({ action: 'compile', workflow: 'patrol', fire: fired.result.id }, exec('s1')),
    )
    expect((await view(id)).origin?.agent).toEqual({
      model: { provider: 'acme', model: 'big' },
      permission: 'danger-full-access',
      fallbacks: [{ kind: 'model', provider: 'acme', model: 'big' }],
    })
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

  it('实例还在跑时又触发了、模型接着这个实例做：那次触发记到这个实例上；按实例编号查得到', async () => {
    await saveGraph('patrol', { launch: { session: 'last', overlap: 'parallel' } })
    const triggers = service()
    await triggers.set({ workflow: 'patrol', node: 'tick', workspace })
    const first = await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    if (!first.ok) throw new Error('没触发')
    const id = instanceOf(
      await run({ action: 'compile', workflow: 'patrol', fire: first.result.id }, exec('s1')),
    )
    // 实例的建立时刻是真钟点：第二次触发在它之后。
    clock = Date.now() + MINUTE
    const again = await triggers.fireNow({ workflow: 'patrol', node: 'tick' })
    if (!again.ok) throw new Error('没触发')
    // 只看不算接着做。
    await run({ action: 'state' }, exec('s1'))
    expect((await triggers.ofInstance(id)).map((fire) => fire.id)).toEqual([first.result.id])

    await run({ action: 'state', status: 'running' }, exec('s1'))
    expect((await triggers.ofInstance(id)).map((fire) => [fire.id, fire.joined === true])).toEqual([
      [first.result.id, false],
      [again.result.id, true],
    ])
    expect((await triggers.history('patrol'))[0]).toMatchObject({ instance: id, joined: true })
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
    // 命令里的 {workflow} 换成工作流目录，环境变量里也有；另给这张卡片的数据目录（已经建好）。
    const dir = assetsDir(dataDir, 'patrol')
    const data = cardDataDir(dataDir, 'patrol', 'tick')
    expect((await stat(data)).isDirectory()).toBe(true)
    expect(live.specs).toEqual([
      {
        workflow: 'patrol',
        node: 'tick',
        source: { kind: 'listen', command: COMMAND },
        filter: { merge: 5, dedupe: 0, include: [], exclude: [] },
        cwd: workspace,
        command: COMMAND.replace('{workflow}', dir.replace(/\\/gu, '/')),
        env: { WORKFLOW_DIR: dir, TRIGGER_DATA_DIR: data },
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
      problem: '要运行的命令、工作区或 shell 改过了，要重新确认',
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

  it('换了 shell（卡片自己选的、或它跟着的默认）：停下来等重新确认；确认后按选的 shell 跑', async () => {
    const bin = join(dataDir, 'bin')
    await mkdir(bin)
    const pwsh = join(bin, 'pwsh.exe')
    const bash = join(bin, 'bash')
    await writeFile(pwsh, '')
    await writeFile(bash, '')
    // 没选 shell 时确认的样子和以前一样：升级前确认过的卡片不用重新确认。
    expect(approvalOf(COMMAND, workspace)).toBe(JSON.stringify([COMMAND, workspace]))
    expect(approvalOf(COMMAND, workspace, '')).toBe(approvalOf(COMMAND, workspace))

    const triggers = await listening()
    expect(live.specs[0]).not.toHaveProperty('shell')
    await set(triggers, { shell: pwsh })
    await triggers.tick()
    expect(live.specs).toEqual([])
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      shell: pwsh,
      runShell: { path: pwsh, name: 'PowerShell 7' },
      state: 'confirm',
    })
    await set(triggers, { approve: COMMAND })
    await triggers.tick()
    expect(live.specs[0]?.shell).toBe(pwsh)

    // 改回跟随默认：确认的是 PowerShell，要再确认一次。
    await set(triggers, { shell: '' })
    await triggers.tick()
    expect((await triggers.list('patrol')).triggers[0]).not.toHaveProperty('shell')
    expect((await triggers.list('patrol')).triggers[0]?.state).toBe('confirm')
    await set(triggers, { approve: COMMAND })
    await triggers.tick()
    expect(live.specs).toHaveLength(1)

    // 设置里的默认换了：跟着默认的卡片也要重新确认。
    defaultShell = bash
    await triggers.tick()
    expect(live.specs).toEqual([])
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      state: 'confirm',
      runShell: { path: bash, name: 'bash' },
    })
    await set(triggers, { approve: COMMAND })
    await triggers.tick()
    expect(live.specs[0]?.shell).toBe(bash)
  })

  it('选的 shell 要是认得的、在的程序', async () => {
    await saveGraph('patrol', listen())
    const triggers = service()
    const relative = await set(triggers, { shell: 'pwsh' })
    expect(!relative.ok && relative.error.message).toBe('要写 shell 程序的完整路径')
    const missing = await set(triggers, { shell: join(dataDir, 'nope', 'bash') })
    expect(!missing.ok && missing.error.message).toBe('找不到这个程序')
    const unknown = await set(triggers, { shell: join(dataDir, 'notepad.exe') })
    expect(!unknown.ok && unknown.error.message).toContain('认不出')
    expect((await triggers.list('patrol')).triggers[0]).not.toHaveProperty('shell')
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
    expect(message).toContain('监视程序打出了一行 ::trigger::')
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
    live.events?.failed(ref, '监视程序运行 1 秒后退出了（退出码 1）')
    live.events?.failed(ref, '监视程序运行 1 秒后退出了（退出码 1）')
    live.events?.healthy(ref)
    live.events?.failed(ref, '监视程序运行 1 秒后退出了（退出码 1）')
    live.events?.failed(ref, '监视程序运行 1 秒后退出了（退出码 1）')
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

  it('HTTP：打开时给地址（缺省用工作流名）和令牌；换令牌地址不变；端口开不了时显示出错', async () => {
    await saveGraph('patrol', { source: { kind: 'http' } })
    const triggers = service()
    const on = await set(triggers, { workspace, enabled: true })
    const endpoint = on.ok ? on.result.triggers[0]?.endpoint : undefined
    expect(endpoint?.url).toBe('http://127.0.0.1:3791/trigger/patrol')
    expect(endpoint?.hook).toBe('patrol')
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
      port: { kind: 'error', port: 3791, host: '127.0.0.1', problem: '端口 3791 被别的程序占用了' },
    })
    expect((await triggers.list('patrol')).triggers[0]).toMatchObject({
      state: 'error',
      problem: '端口 3791 被别的程序占用了',
    })
    // 换成定时之后，先前生成的地址、令牌还留着，照样能换；从来没有过地址的定时卡片没有令牌可换。
    await saveGraph('patrol')
    expect((await set(triggers, { resetToken: true })).ok).toBe(true)
    await saveGraph('other')
    const refused = await triggers.set({ workflow: 'other', node: 'tick', resetToken: true })
    expect(!refused.ok && refused.error.message).toBe('只有 HTTP 触发有地址和令牌')
  })

  it('HTTP：可以不要令牌；令牌照样留着，换回需要还是它', async () => {
    await saveGraph('patrol', { source: { kind: 'http' } })
    const triggers = service()
    const on = await set(triggers, { workspace, enabled: true })
    const token = on.ok ? on.result.triggers[0]?.endpoint?.token : undefined
    expect(token).toBeDefined()

    const off = await set(triggers, { noToken: true })
    expect(off.ok && off.result.triggers[0]?.endpoint).toMatchObject({ token, noToken: true })
    await own(triggers)
    expect(live.specs[0]?.hook).toEqual({ id: 'patrol', token: null })

    const back = await set(triggers, { noToken: false })
    expect(back.ok && back.result.triggers[0]?.endpoint).not.toHaveProperty('noToken')
    await triggers.tick()
    expect(live.specs[0]?.hook).toEqual({ id: 'patrol', token })

    // 从来没有过地址的定时卡片：没有令牌可放开。
    await saveGraph('other')
    const refused = await triggers.set({ workflow: 'other', node: 'tick', noToken: true })
    expect(!refused.ok && refused.error.message).toBe('只有 HTTP 触发有地址和令牌')
  })

  it('HTTP：先生成地址、令牌不打开开关；图里还不是 HTTP（对话框里没保存）也能先生成', async () => {
    const triggers = service()
    await saveGraph('patrol')
    expect((await set(triggers, { prepareEndpoint: true })).ok).toBe(true)
    const [view] = (await triggers.list('patrol')).triggers
    expect(view).toMatchObject({ enabled: false, state: 'off' })
    expect(view?.endpoint?.hook).toBe('patrol')
    expect(view?.endpoint?.token.length).toBeGreaterThanOrEqual(16)
    // 再要一次不换：地址、令牌原样。
    await set(triggers, { prepareEndpoint: true })
    expect((await triggers.list('patrol')).triggers[0]?.endpoint).toEqual(view?.endpoint)
    // 先生成过的能改地址；改成 HTTP、打开之后用的就是它。
    expect((await set(triggers, { hook: 'ci-done' })).ok).toBe(true)
    await saveGraph('patrol', { source: { kind: 'http' } })
    expect((await triggers.list('patrol')).triggers[0]?.endpoint?.hook).toBe('ci-done')
  })

  it('HTTP：地址、令牌能自己写；写得不对、和别的卡片重了就拒绝', async () => {
    await saveGraph('patrol', { source: { kind: 'http' } })
    await saveGraph('other', { source: { kind: 'http' } })
    const triggers = service()
    const endpointOf = async (workflow: string) =>
      (await triggers.list(workflow)).triggers[0]?.endpoint

    // 没打开过也能先写地址：令牌跟着生成。
    const named = await set(triggers, { hook: '巡检-日报' })
    expect(named.ok).toBe(true)
    expect(await endpointOf('patrol')).toMatchObject({
      hook: '巡检-日报',
      url: `http://127.0.0.1:3791/trigger/${encodeURIComponent('巡检-日报')}`,
    })
    const token = 'my-own_token.v1~abcdef'
    expect((await set(triggers, { token })).ok).toBe(true)
    expect((await endpointOf('patrol'))?.token).toBe(token)

    const message = async (change: Record<string, unknown>) => {
      const outcome = await set(triggers, change)
      return outcome.ok ? null : outcome.error.message
    }
    expect(await message({ hook: '' })).toBe('地址不能为空')
    expect(await message({ hook: 'a/b' })).toBe('地址只能用字母、数字、中文和 - _')
    expect(await message({ token: 'short' })).toBe('令牌至少 16 个字')
    expect(await message({ token: 'has space in it 1234' })).toBe('令牌只能用字母、数字和 - _ . ~')
    expect(await message({ token, resetToken: true })).toBe('自己写令牌和换一个令牌只能选一样')
    expect((await endpointOf('patrol'))?.token).toBe(token)

    // 另一个工作流打开时缺省用自己的名字；改成已被占的地址被拒，原来的不变。
    expect((await triggers.set({ workflow: 'other', node: 'tick', hook: '巡检-日报' })).ok).toBe(
      false,
    )
    await triggers.set({ workflow: 'other', node: 'tick', workspace, enabled: true })
    expect((await endpointOf('other'))?.hook).toBe('other')
    // 自己的地址原样再写一遍不算重。
    expect((await set(triggers, { hook: '巡检-日报' })).ok).toBe(true)
  })

  it('HTTP 监听状态：没人负责、没开、开着、开不了，按负责的进程写下的说', async () => {
    const triggers = service()
    expect(await triggers.httpStatus()).toEqual({ state: 'away' })
    await own(triggers)
    expect(await triggers.httpStatus()).toEqual({ state: 'idle' })
    await store.writeLive({
      pid: 100,
      sources: {},
      port: { kind: 'open', port: 3791, host: '192.168.1.20' },
    })
    expect(await triggers.httpStatus()).toEqual({
      state: 'open',
      host: '192.168.1.20',
      port: 3791,
      url: 'http://192.168.1.20:3791',
    })
    await store.writeLive({
      pid: 100,
      sources: {},
      port: { kind: 'error', port: 3791, host: '127.0.0.1', problem: '端口 3791 被别的程序占用了' },
    })
    expect(await triggers.httpStatus()).toEqual({
      state: 'error',
      problem: '端口 3791 被别的程序占用了',
    })
    // 别的进程写的不作数。
    await store.writeLive({ pid: 999, sources: {}, port: { kind: 'open', port: 1, host: 'x' } })
    expect(await triggers.httpStatus()).toEqual({ state: 'idle' })
  })

  it('HTTP：缺省地址和别的卡片重了接 -2；监听地址设成某块网卡时网址用它', async () => {
    await saveGraph('patrol', { source: { kind: 'http' } })
    await saveGraph('other', { source: { kind: 'http' } })
    const triggers = service()
    await triggers.set({ workflow: 'other', node: 'tick', hook: 'patrol' })
    listenHost = '192.168.1.20'
    await set(triggers, { workspace, enabled: true })
    const endpoint = (await triggers.list('patrol')).triggers[0]?.endpoint
    expect(endpoint?.url).toBe('http://192.168.1.20:3791/trigger/patrol-2')
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

  it('新卡片的权限缺省写成完全权限；预设、模型、权限只认画布上设的，模型替换、清除执行设置都留着', async () => {
    await saveGraph('patrol')
    await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'fresh',
      trigger: { source: { kind: 'http' }, launch: { session: 'last' } },
    })
    const launchOfCard = async (id: string): Promise<unknown> =>
      (
        (await repository.load('patrol')).document?.nodes.find((node) => node.id === id)?.data as {
          launch?: unknown
        }
      )?.launch
    expect(await launchOfCard('fresh')).toEqual({
      session: 'last',
      permission: 'danger-full-access',
    })
    await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'fresh',
      trigger: { launch: { overlap: 'queue', permission: 'read-only', preset: 'x' } },
    })
    expect(await launchOfCard('fresh')).toEqual({
      overlap: 'queue',
      permission: 'danger-full-access',
    })
    await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'fresh',
      trigger: { launch: null },
    })
    expect(await launchOfCard('fresh')).toEqual({ permission: 'danger-full-access' })
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
    expect((created as { next?: string }).next).toContain('local.enabled')

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
        trigger: {
          source: {
            kind: 'schedule',
            schedule: { kind: 'every', seconds: 1 },
            check: { command: 'x' },
          },
        },
      }),
    ).toMatchObject({ error: { code: 'invalid_args' } })

    // 检查没写判定：按「每次成功」写进图；明说了的照写。
    const checked = (command: string, when?: string) => ({
      source: {
        kind: 'schedule',
        schedule: { kind: 'every', seconds: 60 },
        check: when === undefined ? { command } : { command, when },
      },
    })
    await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'queue',
      trigger: checked('node has-work.mjs'),
    })
    await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'ready',
      trigger: checked('node up.mjs', 'success'),
    })
    const checks = (await repository.load('patrol')).document?.nodes
    expect(checks?.find((node) => node.id === 'queue')?.data).toMatchObject({
      source: { check: { command: 'node has-work.mjs', when: 'every' } },
    })
    expect(checks?.find((node) => node.id === 'ready')?.data).toMatchObject({
      source: { kind: 'schedule', check: { when: 'success' } },
    })
    expect(
      await run({ action: 'write_trigger', workflow: 'patrol', node: 'work', trigger: {} }),
    ).toMatchObject({ error: { code: 'blocked' } })

    const index = (await run({ action: 'read', workflow: 'patrol' })) as {
      dir?: string
      triggers?: { id: string }[]
    }
    expect(index.dir).toBe(assetsDir(dataDir, 'patrol'))
    expect(index.triggers?.map((item) => item.id)).toEqual(['tick', 'trigger', 'queue', 'ready'])
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

describe('模型读、改、试触发卡片', () => {
  let triggers: TriggerService
  let run: (args: WorkflowLiteArgs, exec?: ToolExecView) => Promise<JsonValue>
  const exec: ToolExecView = { agent: { session: { header: { id: 'sess-1' } } } }

  beforeEach(() => {
    triggers = service()
    run = createWorkflowLiteHandler({
      repository,
      dataDir: () => dataDir,
      maxResultBytes: () => 262_144,
      triggers,
    })
  })

  it('读一张卡片：定义连缺省值、本机情况、打开前还差什么；图的索引带开没开', async () => {
    await saveGraph('patrol', {
      source: { kind: 'listen', command: 'node "{workflow}/triggers/w.mjs"' },
    })
    const read = (await run({ action: 'read', workflow: 'patrol', node: 'tick' })) as Record<
      string,
      unknown
    >
    expect(read).toMatchObject({
      node: { id: 'tick', type: 'wfTrigger' },
      effective: {
        filter: { merge: 5, dedupe: 0 },
        launch: { session: 'new', overlap: 'skip', maxPerHour: 60 },
      },
      local: {
        enabled: false,
        state: 'off',
        toEnable: ['先选命令在哪个工作区里运行'],
        dataDir: cardDataDir(dataDir, 'patrol', 'tick'),
      },
    })
    const index = (await run({ action: 'read', workflow: 'patrol' })) as {
      triggers?: unknown[]
    }
    expect(index.triggers).toEqual([
      expect.objectContaining({ id: 'tick', enabled: false, state: 'off' }),
    ])
  })

  it('改本机设置：只给 local 不碰定义；工作区改了回到待确认；HTTP 地址、令牌、当前会话', async () => {
    await saveGraph('patrol', {
      source: { kind: 'listen', command: 'node w.mjs' },
    })
    const set = (await run(
      { action: 'write_trigger', workflow: 'patrol', node: 'tick', local: { workspace } },
      exec,
    )) as Record<string, unknown>
    expect(set).toMatchObject({
      trigger: { id: 'tick', source: { kind: 'listen' } },
      local: { workspace, approved: false, toEnable: ['要先确认将要运行的命令'] },
    })
    expect(set).not.toHaveProperty('changed')
    // 只改本机设置时要说是哪张卡片。
    expect(
      await run({ action: 'write_trigger', workflow: 'patrol', local: { workspace } }),
    ).toMatchObject({ error: { code: 'invalid_args' } })

    await saveGraph('patrol', {
      source: { kind: 'http' },
      launch: { session: 'fixed' },
    })
    const http = (await run(
      {
        action: 'write_trigger',
        workflow: 'patrol',
        node: 'tick',
        local: { hook: 'ci-done', token: 'a-very-long-token-123', session: 'current' },
      },
      exec,
    )) as { local?: Record<string, unknown> }
    expect(http.local).toMatchObject({
      session: 'sess-1',
      endpoint: { hook: 'ci-done', token: 'a-very-long-token-123' },
    })
    expect(
      await run({
        action: 'write_trigger',
        workflow: 'patrol',
        node: 'tick',
        local: { token: 'short' },
      }),
    ).toMatchObject({ error: { code: 'blocked' } })
  })

  it('模型自己开关：打开要跑命令的卡片就是确认命令；改了命令停在待确认，再打开一次；关掉', async () => {
    await saveGraph('patrol')
    const created = (await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'watch',
      trigger: { source: { kind: 'listen', command: 'node w.mjs' } },
      local: { workspace, enabled: true },
    })) as { local?: Record<string, unknown>; next?: string }
    expect(created.local).toMatchObject({ enabled: true, approved: true, workspace })
    expect(created.local).not.toHaveProperty('toEnable')
    // 没试过就打开了：照开，但提醒先试（不算「打开前还差的」）；带上输出怎么算。
    expect(created.local?.retest).toContain('还没用 test_trigger 试过')
    expect(created.next).toContain('卡片已经开着')
    expect((created as { output?: string }).output).toContain('::trigger::')

    // 只改定义：命令变了，卡片还开着但停在待确认，返回里说要再打开一次。
    const edited = (await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'watch',
      trigger: { source: { kind: 'listen', command: 'node w2.mjs' } },
    })) as { local?: Record<string, unknown>; next?: string }
    expect(edited.local).toMatchObject({ enabled: true, state: 'confirm', approved: false })
    expect(edited.next).toContain('local.enabled = true')

    const again = (await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'watch',
      local: { enabled: true },
    })) as { local?: Record<string, unknown> }
    expect(again.local).toMatchObject({ enabled: true, approved: true })

    const off = (await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'watch',
      local: { enabled: false },
    })) as { local?: Record<string, unknown> }
    expect(off.local).toMatchObject({ enabled: false, state: 'off' })
    // 关掉不撤确认：同一条命令下次直接打开。
    expect(off.local?.approved).toBe(true)

    // 不跑命令的照样能开；缺工作区的打不开，回原因。
    expect(
      await run({
        action: 'write_trigger',
        workflow: 'patrol',
        node: 'tick',
        local: { workspace, enabled: true },
      }),
    ).toMatchObject({ local: { enabled: true } })
    await run({
      action: 'write_trigger',
      workflow: 'patrol',
      node: 'bare',
      trigger: { source: { kind: 'listen', command: 'node w.mjs' } },
    })
    expect(
      await run({
        action: 'write_trigger',
        workflow: 'patrol',
        node: 'bare',
        local: { enabled: true },
      }),
    ).toMatchObject({ error: { code: 'blocked', message: '先选命令在哪个工作区里运行' } })
    expect(
      await run({
        action: 'write_trigger',
        workflow: 'patrol',
        node: 'bare',
        local: { enabled: 'yes' as unknown as boolean },
      }),
    ).toMatchObject({ error: { code: 'invalid_args' } })
  })

  it('test_trigger 记下试过的时刻；之后改了 triggers/ 里的脚本，读的结果点名要再试', async () => {
    const scripts = join(assetsDir(dataDir, 'patrol'), 'triggers')
    await saveGraph('patrol', {
      source: {
        kind: 'schedule',
        schedule: { kind: 'every', seconds: 1800 },
        check: { command: 'node "{workflow}/triggers/check.mjs"', when: 'every' },
      },
    })
    await mkdir(scripts, { recursive: true })
    const script = join(scripts, 'check.mjs')
    await writeFile(script, "console.log('[check] 日志')\nconsole.log('::trigger:: 有新提交')\n")
    const readCard = async () =>
      (await run({ action: 'read', workflow: 'patrol', node: 'tick' })) as {
        local: { retest?: string }
        effective?: { output?: string }
      }
    expect((await readCard()).local.retest).toContain('还没用 test_trigger 试过')

    const tried = (await run({
      action: 'test_trigger',
      workflow: 'patrol',
      node: 'tick',
      workspace,
    })) as { info?: string }
    // 有 ::trigger:: 行时只有它交出去，日志不算。
    expect(tried.info).toBe('有新提交')
    const fresh = await readCard()
    expect(fresh.local).not.toHaveProperty('retest')
    expect(fresh.effective?.output).toContain('::trigger::')

    // mtime 精度因文件系统而异：往后拨一点，免得和试的时刻落在同一毫秒里。
    const later = new Date(Date.now() + 5000)
    await utimes(script, later, later)
    expect((await readCard()).local.retest).toBe(
      'triggers/ 里的 check.mjs 在上次 test_trigger 之后改过：再试一遍，过了再打开',
    )
  })

  it('读带上触发记录、排队和一次触发的全文；trigger_queue 视为已结束、清空', async () => {
    await saveGraph('patrol', { launch: { overlap: 'queue' }, note: '只看 src/' })
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    await own(triggers)
    clock += 30 * MINUTE
    await triggers.tick()
    const fire = (await triggers.history('patrol'))[0]?.id ?? ''
    await claim(fire, 'r1', 'running')
    for (let i = 0; i < 2; i += 1) {
      clock += 30 * MINUTE
      await triggers.tick()
    }
    const read = (await run({
      action: 'read',
      workflow: 'patrol',
      node: 'tick',
      include: ['history', 'queue'],
      fire,
    })) as Record<string, unknown>
    expect(read).toMatchObject({
      local: { enabled: true, queued: 2, waiting: { fire, instance: 'r1', status: 'running' } },
      fire: { id: fire, note: '只看 src/' },
    })
    expect((read.history as unknown[]).length).toBe(3)
    expect((read.queue as { outcome: string }[]).map((item) => item.outcome)).toEqual([
      'queued',
      'queued',
    ])
    expect(typeof (read.local as { next?: string[] }).next?.[0]).toBe('string')

    expect(
      await run({ action: 'trigger_queue', workflow: 'patrol', node: 'tick', queue: 'waive' }),
    ).toEqual({ waived: true })
    await triggers.tick()
    expect(sent).toHaveLength(2)
    expect(
      await run({ action: 'trigger_queue', workflow: 'patrol', node: 'tick', queue: 'clear' }),
    ).toEqual({ cleared: 1 })
    expect(
      await run({ action: 'trigger_queue', workflow: 'patrol', node: 'tick', queue: 'nope' }),
    ).toMatchObject({ error: { code: 'invalid_args' } })
  })

  it('试一张卡片：定时给出接下来几次；要跑命令的没工作区说清楚；不动开关、不记触发记录', async () => {
    await saveGraph('patrol')
    const plain = (await run({ action: 'test_trigger', workflow: 'patrol', node: 'tick' })) as {
      verdict?: string
      next?: string[]
    }
    expect(plain.verdict).toBe('fire')
    expect(plain.next).toHaveLength(5)

    await saveGraph('patrol', { source: { kind: 'listen', command: 'node w.mjs' } })
    expect(await run({ action: 'test_trigger', workflow: 'patrol', node: 'tick' })).toMatchObject({
      error: { code: 'invalid_args', message: expect.stringContaining('workspace') },
    })

    await saveGraph('patrol', { source: { kind: 'http' }, filter: { include: ['push'] } })
    expect(
      await run({
        action: 'test_trigger',
        workflow: 'patrol',
        node: 'tick',
        body: '{"event":"tag"}',
      }),
    ).toMatchObject({ verdict: 'skip' })
    expect(await triggers.history('patrol')).toEqual([])
    expect((await triggers.list('patrol')).triggers[0]?.enabled).toBe(false)
  })

  it('list 带上所有卡片的状态与问题；被自动停用的，打开前还差的里说清楚要用户重新打开', async () => {
    expect(await run({ action: 'list' })).not.toHaveProperty('triggers')
    await saveGraph('patrol', { launch: { overlap: 'parallel' } })
    await triggers.set({ workflow: 'patrol', node: 'tick', enabled: true, workspace })
    await own(triggers)
    openError = '工作区不见了'
    for (let round = 0; round < 3; round += 1) {
      clock += 30 * MINUTE
      await triggers.tick()
    }
    const listed = (await run({ action: 'list' })) as {
      triggers?: { cards: Record<string, unknown>[] }
    }
    expect(listed.triggers?.cards).toEqual([
      {
        workflow: 'patrol',
        node: 'tick',
        name: expect.any(String),
        kind: 'schedule',
        enabled: false,
        state: 'stopped',
        problem: expect.stringContaining('连续 3 次失败：'),
      },
    ])
    const read = (await run({ action: 'read', workflow: 'patrol', node: 'tick' })) as {
      local: { toEnable?: string[] }
    }
    expect(read.local.toEnable?.[0]).toMatch(/^已自动停用（连续 3 次失败：.*工作区不见了.*）/u)
  })

  it('图编译不出计划时，打开前还差的里说清楚', async () => {
    await saveGraph('patrol')
    const load = await repository.load('patrol')
    const document = load.document as WorkflowDocument
    const saved = await repository.save(
      'patrol',
      { ...document, nodes: document.nodes.filter((node) => node.type === 'wfTrigger') },
      { baseHash: load.hash as string },
    )
    expect(saved.ok).toBe(true)
    const tried = (await run({ action: 'test_trigger', workflow: 'patrol', node: 'tick' })) as {
      toEnable?: string[]
    }
    expect(tried.toEnable?.[0]).toMatch(/^工作流现在执行不了（.+）：先改好图/u)
  })

  it('试一张卡片：背景信息太长时报出长度并提醒只放开头', async () => {
    await saveGraph('patrol', { source: { kind: 'http' } })
    const short = (await run({
      action: 'test_trigger',
      workflow: 'patrol',
      node: 'tick',
      body: '{"status":"failed"}',
    })) as { infoChars?: number; notes?: string[] }
    expect(short.infoChars).toBe(19)
    expect(short.notes?.join('')).not.toContain('个字符')
    const long = (await run({
      action: 'test_trigger',
      workflow: 'patrol',
      node: 'tick',
      body: 'x'.repeat(5000),
    })) as { infoChars?: number; notes?: string[] }
    expect(long.infoChars).toBe(5000)
    expect(long.notes?.at(-1)).toContain('背景信息有 5000 个字符')
  })

  it('工作流改名、删除：脚本的数据目录跟着走、一起删', async () => {
    await saveGraph('patrol')
    const data = cardDataDir(dataDir, 'patrol', 'tick')
    await mkdir(data, { recursive: true })
    await writeFile(join(data, 'seen.json'), '[]')
    expect((await repository.rename('patrol', 'guard')).ok).toBe(true)
    expect(await readFile(join(cardDataDir(dataDir, 'guard', 'tick'), 'seen.json'), 'utf8')).toBe(
      '[]',
    )
    expect((await repository.remove('guard')).ok).toBe(true)
    await expect(stat(cardDataDir(dataDir, 'guard', 'tick'))).rejects.toThrow()
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

  it('恢复后定时检查从现在起算：暂停前记下的结果不拿来比', async () => {
    const command = 'git ls-remote origin'
    await saveGraph('patrol', {
      source: {
        kind: 'schedule',
        schedule: { kind: 'every', seconds: 60 },
        check: { command, when: 'change' },
      },
    })
    const triggers = service()
    await triggers.set({
      workflow: 'patrol',
      node: 'tick',
      workspace,
      approve: command,
      enabled: true,
    })
    await own(triggers)
    live.events?.probed(
      { workflow: 'patrol', node: 'tick', kind: 'schedule' },
      { digest: 'before' },
    )
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

  it('还没选、等的工作流不在、没开「记录运行状态」、是自己：打不开，说出原因', async () => {
    await saveGraph('patrol', { source: { kind: 'after', workflow: '' } })
    const triggers = service()
    const none = await enable(triggers)
    expect(!none.ok && none.error.message).toBe('还没选等哪个工作流跑完')

    await saveGraph('patrol', { source: { kind: 'after', workflow: 'build' } })
    const missing = await enable(triggers)
    expect(!missing.ok && missing.error.message).toContain('不存在')

    await saveUpstream('build', false)
    const noState = await enable(triggers)
    expect(!noState.ok && noState.error.message).toContain('记录运行状态')

    await saveGraph('patrol', { source: { kind: 'after', workflow: 'patrol' } })
    const self = await enable(triggers)
    expect(!self.ok && self.error.message).toContain('不能等自己')
  })

  it('卡片上带着等的那个工作流最新的实例；没有实例、没选工作流时不带', async () => {
    const triggers = await ready()
    const view = async () => (await triggers.list('patrol')).triggers[0]
    expect((await view())?.upstream).toBeUndefined()
    newest.set('build', { id: 'r9', status: 'running', at: clock })
    expect((await view())?.upstream).toEqual({ id: 'r9', status: 'running', at: clock })
    await saveGraph('patrol', { source: { kind: 'after', workflow: '' } })
    expect((await view())?.upstream).toBeUndefined()
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
    const triggers = await ready({
      source: { kind: 'after', workflow: 'build', when: 'failed' },
      launch: { overlap: 'parallel' },
    })
    finished.set('build', [run('r1', 'done', clock + 1), run('r2', 'failed', clock + 2)])
    clock += MINUTE
    await triggers.tick()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain('实例 r2 结束了')

    await saveGraph('patrol', {
      source: { kind: 'after', workflow: 'build', when: 'any' },
      launch: { overlap: 'parallel' },
    })
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
      schedule: { kind: 'every', seconds: 1800 },
    })
  })
})
