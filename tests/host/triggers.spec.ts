/**
 * 触发器（host）：谁负责触发、到点触发与跳过、连续失败自动停用、开关与本机设置、
 * 「立即触发一次」，以及触发出来的实例记下的来源。
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunService } from '../../src/host/runs/service.ts'
import {
  createRepository,
  type Repository,
  reportProblems,
} from '../../src/host/store/repository.ts'
import type { WorkflowLiteArgs } from '../../src/host/tool/args.ts'
import { createWorkflowLiteHandler, type ToolExecView } from '../../src/host/tool/tool.ts'
import { createFireClaims } from '../../src/host/triggers/claims.ts'
import { createTriggerGraphs, followRenames } from '../../src/host/triggers/graphs.ts'
import { OWNER_STALE_MS, OwnerLock } from '../../src/host/triggers/owner.ts'
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

function service(pid = 100, alive: (pid: number) => boolean = () => true): TriggerService {
  return new TriggerService({
    dataDir: () => dataDir,
    store,
    graphs: createTriggerGraphs(repository),
    sessions,
    now: () => clock,
    lock: new OwnerLock({ file: () => ownerFile(dataDir), now: () => clock, pid, alive }),
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
    expect(view?.problem).toContain('连续 3 次没发出去')
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
