/**
 * dsh-workflow-lite — 工作流实例：落盘位置与实例索引。
 *
 * 三处文件：
 * - `<dataDir>/instances.json`：实例索引，全局一份，**只有插件写**（进程内写锁 + 原子写）；
 * - `<dataDir>/runs/<实例 id>/graph.json`：编译那一刻的图快照，建立后只读；
 * - `<工作区>/.workflow-lite/runs/<实例 id>.yaml`：状态文件，主 agent 维护（拿不到工作区时退到
 *   `<dataDir>/runs/<实例 id>/state.yaml`）。
 *
 * 状态不进索引：进度的事实源只有状态文件，索引只记"在哪、属于谁"。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/store
 */

import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { InstanceRecord } from '../../shared/runState.ts'
import { EXECUTION_MODES } from '../../shared/types.ts'
import { ensureDir, readFileText, renamePath, writeFileAtomic } from '../store/atomic.ts'

export const INSTANCES_FILE = 'instances.json'
export const RUNS_DIR = 'runs'
/** 工作区里放状态文件的目录（隐藏目录，里面放一个忽略一切的 `.gitignore`）。 */
export const WORKSPACE_RUNS_DIR = join('.workflow-lite', 'runs')

/**
 * 工作区里 `.workflow-lite/` 放一个忽略一切的 `.gitignore`（状态文件、默认的产出都不进版本库）。
 * 给了 `root` 时只在它落在 `.workflow-lite/` 下时才放。
 */
export async function ensureWorkspaceIgnore(cwd: string, root?: string): Promise<void> {
  if (root !== undefined && !/^\.workflow-lite(\/|$)/u.test(root)) return
  const file = join(cwd, WORKSPACE_RUNS_DIR, '..', '.gitignore')
  if ((await readFileText(file)) !== null) return
  await ensureDir(dirname(file))
  await writeFileAtomic(file, '*\n')
}

export function instancesFile(dataDir: string): string {
  return join(dataDir, INSTANCES_FILE)
}

export function runDir(dataDir: string, id: string): string {
  return join(dataDir, RUNS_DIR, id)
}

export function snapshotFile(dataDir: string, id: string): string {
  return join(runDir(dataDir, id), 'graph.json')
}

/** 状态文件放哪：有工作区就放工作区（沙箱 `workspace-write` 档能写），否则退回数据目录。 */
export function statePathFor(dataDir: string, id: string, cwd: string | undefined): string {
  return cwd === undefined
    ? join(runDir(dataDir, id), 'state.yaml')
    : join(cwd, WORKSPACE_RUNS_DIR, `${id}.yaml`)
}

/** 实例 id：`<YYYYMMDD>-<HHmmss>-<4 位十六进制>`，按时间天然有序、能当文件名。 */
export function newInstanceId(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${day}-${time}-${randomBytes(2).toString('hex')}`
}

/** 实例 id 的形状（RPC / 工具入参先过这一道，再拿去拼路径）。 */
export function isInstanceId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{8}-\d{6}-[0-9a-f]{4}$/u.test(value)
}

export interface InstanceIndex {
  version: 1
  instances: InstanceRecord[]
  /** 会话 id → 它的当前实例 id。 */
  current: Record<string, string>
}

function emptyIndex(): InstanceIndex {
  return { version: 1, instances: [], current: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读一条记录；形状不对的丢掉（索引只有插件写，坏条目只可能来自手改）。 */
function readRecord(raw: unknown): InstanceRecord | null {
  if (!isRecord(raw)) return null
  const { id, workflow, planId, statePath, createdAt } = raw
  const mode = EXECUTION_MODES.find((candidate) => candidate === raw.mode)
  if (
    !isInstanceId(id) ||
    typeof workflow !== 'string' ||
    typeof planId !== 'string' ||
    (statePath !== undefined && typeof statePath !== 'string') ||
    typeof createdAt !== 'number' ||
    mode === undefined
  ) {
    return null
  }
  return {
    id,
    workflow,
    planId,
    mode,
    ...(typeof raw.goal === 'string' ? { goal: raw.goal } : {}),
    ...(typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {}),
    ...(typeof statePath === 'string' ? { statePath } : {}),
    ...(typeof raw.session === 'string' ? { session: raw.session } : {}),
    createdAt,
    ...(typeof raw.pendingNotice === 'string' ? { pendingNotice: raw.pendingNotice } : {}),
  }
}

function parseIndex(text: string): InstanceIndex | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || !Array.isArray(raw.instances)) return null
  const instances = raw.instances
    .map(readRecord)
    .filter((record): record is InstanceRecord => record !== null)
  const ids = new Set(instances.map((record) => record.id))
  const current: Record<string, string> = {}
  if (isRecord(raw.current)) {
    for (const [session, id] of Object.entries(raw.current)) {
      if (typeof id === 'string' && ids.has(id)) current[session] = id
    }
  }
  return { version: 1, instances, current }
}

/**
 * 实例索引的读写。写一律走 {@link update}：进程内串行（读 → 改 → 原子写），
 * 不会有两次修改互相覆盖。
 */
export class InstanceStore {
  private chain: Promise<unknown> = Promise.resolve()
  private readonly dataDir: () => string

  constructor(dataDir: () => string) {
    this.dataDir = dataDir
  }

  get file(): string {
    return instancesFile(this.dataDir())
  }

  /** 读索引。文件不在 = 空；解析不了就把它挪到一边（`instances.json.broken-<时间>`）再当空的。 */
  async read(): Promise<InstanceIndex> {
    const text = await readFileText(this.file)
    if (text === null) return emptyIndex()
    const index = parseIndex(text)
    if (index !== null) return index
    await renamePath(this.file, `${this.file}.broken-${Date.now()}`).catch(() => {})
    return emptyIndex()
  }

  /** 在写锁里读 → 改 → 写回。`change` 返回 `false` 表示没改，不写盘。 */
  update<T>(change: (index: InstanceIndex) => T | Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const index = await this.read()
      const before = JSON.stringify(index)
      const result = await change(index)
      const after = JSON.stringify(index)
      if (after !== before) await writeFileAtomic(this.file, `${JSON.stringify(index, null, 2)}\n`)
      return result
    })
    this.chain = run.catch(() => {})
    return run
  }
}
