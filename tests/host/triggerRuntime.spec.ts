/**
 * 常驻触发源把最近的输出记进数据库（真的跑命令）：轮询一次检查一条；监听程序一次运行一条、成批记行，
 * 只往错误输出打字也会在运行情况里留下「最近一次记下输出」的时刻（界面据此重读）；停下时这次运行记成被停下。
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATABASE_FILE, PluginDatabase } from '../../src/host/store/database.ts'
import { HookServer } from '../../src/host/triggers/hooks.ts'
import { OutputLog } from '../../src/host/triggers/outputLog.ts'
import { type LiveSpec, TriggerRuntime } from '../../src/host/triggers/runtime.ts'
import type { LiveFile, TriggerStore } from '../../src/host/triggers/store.ts'

const NO_FILTER = { merge: 0, dedupe: 0, include: [], exclude: [] }

let dataDir: string
let database: PluginDatabase

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-runtime-'))
  database = new PluginDatabase(() => join(dataDir, DATABASE_FILE))
})

afterEach(async () => {
  database.close()
  await rm(dataDir, { recursive: true, force: true })
})

async function until(done: () => boolean, ms = 15_000): Promise<void> {
  for (let waited = 0; !done() && waited < ms; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function runtimeWith(outputs: OutputLog): { runtime: TriggerRuntime; live: LiveFile[] } {
  const live: LiveFile[] = []
  const store = {
    writeLive: async (file: LiveFile) => {
      live.push(file)
    },
  } as Pick<TriggerStore, 'writeLive'> as TriggerStore
  const runtime = new TriggerRuntime({
    store,
    outputs,
    keep: () => 300,
    listen: () => ({ host: '127.0.0.1', port: 0 }),
    events: { deliver: () => {}, failed: () => {}, healthy: () => {}, probed: () => {} },
    hooks: new HookServer(),
  })
  return { runtime, live }
}

const spec = (node: string, source: LiveSpec['source'], command: string): LiveSpec => ({
  workflow: 'wf',
  node,
  source,
  filter: NO_FILTER,
  cwd: process.cwd(),
  command,
})

describe('常驻触发源记下最近的输出', () => {
  it('监听程序：只打错误输出也记下，运行情况带上时刻；停下时记成被停下', async () => {
    const outputs = new OutputLog(database)
    const { runtime, live } = runtimeWith(outputs)
    const command = `node -e "console.error('oops');setInterval(() => {}, 1000)"`
    await runtime.sync([spec('l', { kind: 'listen', command }, command)])
    const lines = (): string[] => {
      const [entry] = outputs.list('wf', 'l', 'all', 5).entries
      return entry === undefined
        ? []
        : (outputs.lines('wf', 'l', [entry.id])[0]?.lines ?? []).map((line) => line.text)
    }
    await until(() => lines().includes('oops') && live.some((file) => file.sources.wf?.l?.output))
    expect(lines()).toContain('oops')
    const status = [...live].reverse().find((file) => file.sources.wf?.l?.output !== undefined)
      ?.sources.wf?.l
    expect(status?.line).toBeUndefined()
    expect(typeof status?.output).toBe('number')

    await runtime.stopAll()
    expect(outputs.list('wf', 'l', 'all', 5).entries[0]).toMatchObject({
      kind: 'run',
      verdict: 'stopped',
    })
  }, 30_000)

  it('定时检查：一次检查一条，带退出码、用时和两路输出', async () => {
    const outputs = new OutputLog(database)
    const { runtime } = runtimeWith(outputs)
    const command = `node -e "console.log('up');console.error('warn');process.exit(3)"`
    const source = {
      kind: 'schedule',
      schedule: { kind: 'every', seconds: 60 },
      check: { command, when: 'success' },
    } as const
    await runtime.sync([spec('p', source, command)])
    await until(() => outputs.list('wf', 'p', 'all', 5).entries.length > 0)
    await runtime.stopAll()
    const [entry] = outputs.list('wf', 'p', 'all', 5).entries
    expect(entry).toMatchObject({ kind: 'check', verdict: 'unmet', code: 3, preview: 'up' })
    expect(entry?.ms).toBeGreaterThanOrEqual(0)
    const read = outputs.lines('wf', 'p', [entry?.id ?? 0])[0]?.lines ?? []
    expect(read.map((line) => [line.stream, line.text])).toContainEqual(['err', 'warn'])
  }, 30_000)
})
