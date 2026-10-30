/**
 * dsh-workflow-lite — 实例里产出的各版：写它的步骤每一轮做完存一份，循环迭代时能回头看每一轮写成了什么样。
 *
 * 什么时候存（{@link historyPlan}，看步骤状态的前后变化）：
 * - 写它的步骤一轮做完（变成完成或失败）：存这一刻的样子，记下步骤、第几轮、结果；
 * - 写它的步骤开始一轮、而这份文件还一版都没存过、却已经在了（在原文件上更新的，或上回留下的）：先存一份原样；
 * - 步骤给出判定（完成时带 `verdict`）：记到它读的、写的文件的最近一版上，判定把流程领回去重做的标成 `again`。
 * 模型自己写文件，插件看不见每一次写；只在轮次的边界上存，中途写了一半的样子不会混进来。
 *
 * 存在哪：数据目录 `runs/<实例>/history/`，不放工作区（模型不会翻到旧版，删实例连它一起删）。
 * `index.json` 记每份文件的各版；内容按哈希存一份（`<哈希>.<扩展名>`），各版、各文件一样的只存一份。
 *
 * 存多少：一份文件最多 {@link RUN_HISTORY_VERSIONS_MAX} 版（超了删中间的，第一版留着），一份超过
 * {@link RUN_HISTORY_FILE_MAX} 的不存，整个实例最多 {@link RUN_HISTORY_INSTANCE_MAX}（超了从版数最多的那份删中间的）。
 * 文件夹不存。只有插件里执行时才有（导出成 skill 的执行没有插件看着）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/history
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { edgeWhen } from '../../shared/graph.ts'
import { idKey } from '../../shared/model.ts'
import { flowEdges, stepResources } from '../../shared/resources.ts'
import type { NodeRunState } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import {
  RUN_HISTORY_FILE_MAX,
  RUN_HISTORY_INSTANCE_MAX,
  RUN_HISTORY_VERSIONS_MAX,
  type RunHistoryResponse,
  type RunVersion,
} from '../../shared/wire.ts'
import { ensureDir, readFileText, removeTree, writeFileAtomic } from '../store/atomic.ts'
import { runDir } from './store.ts'

export const HISTORY_DIR = 'history'
const INDEX_FILE = 'index.json'

export function historyDir(dataDir: string, id: string): string {
  return join(runDir(dataDir, id), HISTORY_DIR)
}

/** 一项的身份串（和画布上的 `displayKey` 一样：资源 id 不分大小写）。 */
export function historyKey(node: string, item: number): string {
  return `${idKey(node)}#${item}`
}

/** 索引里的一版：给前端的那些，加上内容在哪。 */
interface HistoryEntry extends RunVersion {
  hash: string
  ext: string
}

interface HistoryFile {
  /** 下一版的版本号。 */
  next: number
  /** 每变一次（多存一版、记了判定）加一：前端拿它判断要不要重读。 */
  rev: number
  dropped: number
  entries: HistoryEntry[]
}

interface HistoryIndex {
  version: 1
  files: Record<string, HistoryFile>
}

const emptyIndex = (): HistoryIndex => ({ version: 1, files: {} })

/** 资源里的一项（文件）：哪个资源、第几项。 */
export interface HistoryItem {
  node: string
  item: number
}

/** 要存的一份。`ifEmpty`：这份一版都没存过才存（开始前的原样）。 */
export interface HistoryCapture extends HistoryItem {
  step: string
  round: number
  phase: RunVersion['phase']
  ifEmpty?: true
}

/** 要记到最近一版上的判定。 */
export interface HistoryVerdict extends HistoryItem {
  step: string
  value: string
  again: boolean
}

export interface HistoryPlan {
  captures: HistoryCapture[]
  verdicts: HistoryVerdict[]
}

/** 一个步骤连着的资源里的文件项：`writes` 只要它写的，否则读的、写的都要。 */
function fileItems(document: WorkflowDocument, step: string, writes: boolean): HistoryItem[] {
  const linked = stepResources(document, step)
  const resources = writes
    ? linked.writes.map((entry) => entry.resource)
    : [...linked.writes, ...linked.reads].map((entry) => entry.resource)
  const seen = new Set<string>()
  return resources.flatMap((resource) =>
    resource.data.items.flatMap((entry, item) => {
      const key = historyKey(resource.id, item)
      if (entry.kind !== 'file' || entry.value.trim() === '' || seen.has(key)) return []
      seen.add(key)
      return [{ node: resource.id, item }]
    }),
  )
}

/** 步骤给了这个判定，流程会不会绕回它自己（顺着判定那条线往下走，能走回来）。 */
export function verdictLoopsBack(document: WorkflowDocument, step: string, value: string): boolean {
  const edges = flowEdges(document)
  const start = edges
    .filter((edge) => idKey(edge.source) === idKey(step) && edgeWhen(edge) === value)
    .map((edge) => idKey(edge.target))
  const seen = new Set<string>()
  const queue = [...start]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (current === idKey(step)) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of edges) {
      if (idKey(edge.source) === current) queue.push(idKey(edge.target))
    }
  }
  return false
}

/**
 * 步骤状态从 `before` 变成 `after`，要存哪几份、记哪几条判定（只看图和状态，不碰磁盘）。
 * 一次改了几个步骤时：先存各自开始前的原样，再存做完的，最后记判定（判定落在刚存的那版上）。
 */
export function historyPlan(
  document: WorkflowDocument,
  before: Readonly<Record<string, NodeRunState>>,
  after: Readonly<Record<string, NodeRunState>>,
): HistoryPlan {
  const starts: HistoryCapture[] = []
  const ends: HistoryCapture[] = []
  const verdicts: HistoryVerdict[] = []
  for (const [step, node] of Object.entries(after)) {
    const was = before[step]?.status ?? 'pending'
    if (node.status === was) continue
    const round = node.round ?? 1
    if (node.status === 'running') {
      for (const item of fileItems(document, step, true)) {
        starts.push({ ...item, step, round, phase: 'before', ifEmpty: true })
      }
    } else if (node.status === 'done' || node.status === 'failed') {
      for (const item of fileItems(document, step, true)) {
        ends.push({ ...item, step, round, phase: node.status })
      }
      const value = node.status === 'done' ? node.verdict?.trim() : undefined
      if (value !== undefined && value !== '') {
        const again = verdictLoopsBack(document, step, value)
        for (const item of fileItems(document, step, false)) {
          verdicts.push({ ...item, step, value, again })
        }
      }
    }
  }
  return { captures: [...starts, ...ends], verdicts }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读索引；只有插件写，形状不对（手改坏了）就当空的。 */
function parseIndex(text: string | null): HistoryIndex {
  if (text === null) return emptyIndex()
  try {
    const raw: unknown = JSON.parse(text)
    if (!isRecord(raw) || !isRecord(raw.files)) return emptyIndex()
    const files: Record<string, HistoryFile> = {}
    for (const [key, value] of Object.entries(raw.files)) {
      if (!isRecord(value) || !Array.isArray(value.entries)) continue
      const entries = value.entries.filter(
        (entry): entry is HistoryEntry =>
          isRecord(entry) &&
          typeof entry.v === 'number' &&
          typeof entry.hash === 'string' &&
          /^[0-9a-f]{16,64}$/u.test(entry.hash) &&
          typeof entry.ext === 'string',
      )
      const next = typeof value.next === 'number' ? value.next : entries.length + 1
      const dropped = typeof value.dropped === 'number' ? value.dropped : 0
      const rev = typeof value.rev === 'number' ? value.rev : entries.length
      files[key] = { next, rev, dropped, entries }
    }
    return { version: 1, files }
  } catch {
    return emptyIndex()
  }
}

/** 给前端的一版：去掉内容在哪。 */
function publicVersion(entry: HistoryEntry): RunVersion {
  const { hash: _hash, ext: _ext, ...version } = entry
  return version
}

/** 扩展名只留字母数字（拿去拼文件名）。 */
function safeExt(full: string): string {
  const ext = extname(full).toLowerCase()
  return /^\.[a-z0-9]{1,12}$/u.test(ext) ? ext : ''
}

/** 一个实例的各版：读、存、删。写都在实例的写入队列里（状态、用户改动同一条队），这里不另加锁。 */
export class RunHistory {
  private readonly dataDir: () => string

  constructor(dataDir: () => string) {
    this.dataDir = dataDir
  }

  private dir(id: string): string {
    return historyDir(this.dataDir(), id)
  }

  private async read(id: string): Promise<HistoryIndex> {
    return parseIndex(await readFileText(join(this.dir(id), INDEX_FILE)).catch(() => null))
  }

  /** 每项存了几版、变过几次（`run/stat` 用）。 */
  async counts(
    id: string,
    items: readonly HistoryItem[],
  ): Promise<{ versions: number; revision: number }[]> {
    const index = await this.read(id)
    return items.map(({ node, item }) => {
      const file = index.files[historyKey(node, item)]
      return { versions: file?.entries.length ?? 0, revision: file?.rev ?? 0 }
    })
  }

  async list(id: string, node: string, item: number): Promise<RunHistoryResponse> {
    const file = (await this.read(id)).files[historyKey(node, item)]
    return {
      versions: file?.entries.map(publicVersion) ?? [],
      dropped: file?.dropped ?? 0,
    }
  }

  /** 存下的第 `v` 版在哪（没有这一版是 `null`）。 */
  async locate(
    id: string,
    node: string,
    item: number,
    v: number,
  ): Promise<{ full: string; version: RunVersion } | null> {
    const entry = (await this.read(id)).files[historyKey(node, item)]?.entries.find(
      (candidate) => candidate.v === v,
    )
    if (entry === undefined) return null
    return { full: join(this.dir(id), `${entry.hash}${entry.ext}`), version: publicVersion(entry) }
  }

  /**
   * 照 `plan` 存、记判定。`where` 把一项换成磁盘上的位置（拿不到就跳过）。
   * 存不下（读不了、太大）的跳过，不影响状态本身——调用方吞掉这里的错。
   */
  async apply(
    id: string,
    plan: HistoryPlan,
    where: (item: HistoryItem) => string | null,
    now: number = Date.now(),
  ): Promise<void> {
    if (plan.captures.length === 0 && plan.verdicts.length === 0) return
    const dir = this.dir(id)
    const index = await this.read(id)
    let changed = false
    for (const capture of plan.captures) {
      const key = historyKey(capture.node, capture.item)
      const file = index.files[key] ?? { next: 1, rev: 0, dropped: 0, entries: [] }
      if (capture.ifEmpty === true && file.entries.length > 0) continue
      const full = where(capture)
      if (full === null) continue
      const saved = await this.store(dir, full)
      if (saved === null) continue
      const last = file.entries.at(-1)
      if (last?.hash === saved.hash) continue
      file.entries.push({
        v: file.next,
        step: capture.step,
        round: capture.round,
        phase: capture.phase,
        at: now,
        size: saved.size,
        mtime: saved.mtime,
        hash: saved.hash,
        ext: saved.ext,
      })
      file.next += 1
      file.rev += 1
      while (file.entries.length > RUN_HISTORY_VERSIONS_MAX) {
        file.entries.splice(1, 1)
        file.dropped += 1
      }
      index.files[key] = file
      changed = true
    }
    for (const verdict of plan.verdicts) {
      const file = index.files[historyKey(verdict.node, verdict.item)]
      const last = file?.entries.at(-1)
      if (file === undefined || last === undefined) continue
      const rest = (last.verdicts ?? []).filter((entry) => entry.step !== verdict.step)
      last.verdicts = [...rest, { step: verdict.step, value: verdict.value, again: verdict.again }]
      file.rev += 1
      changed = true
    }
    if (!changed) return
    trimToBudget(index)
    await writeFileAtomic(join(dir, INDEX_FILE), `${JSON.stringify(index)}\n`)
    await this.sweep(dir, index)
  }

  /** 把一份文件的内容按哈希放进去（已经有了就不再写）；读不了、不是文件、太大回 `null`。 */
  private async store(
    dir: string,
    full: string,
  ): Promise<{ hash: string; ext: string; size: number; mtime: number } | null> {
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(full)
    } catch {
      return null
    }
    if (!info.isFile() || info.size > RUN_HISTORY_FILE_MAX) return null
    let bytes: Buffer
    try {
      bytes = await readFile(full)
    } catch {
      return null
    }
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
    const ext = safeExt(full)
    const blob = join(dir, `${hash}${ext}`)
    const present = await stat(blob).then(
      () => true,
      () => false,
    )
    if (!present) {
      await ensureDir(dir)
      // 先写临时文件再改名：写到一半断了，不会留下一份半截的「旧版」。
      const temp = `${blob}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temp, bytes)
      await rename(temp, blob)
    }
    return { hash, ext, size: bytes.length, mtime: info.mtimeMs }
  }

  /** 删掉索引里已经没人用的内容。 */
  private async sweep(dir: string, index: HistoryIndex): Promise<void> {
    const used = new Set(
      Object.values(index.files).flatMap((file) =>
        file.entries.map((entry) => `${entry.hash}${entry.ext}`),
      ),
    )
    const names = await readdir(dir).catch(() => [] as string[])
    for (const name of names) {
      if (name === INDEX_FILE || used.has(name) || name.endsWith('.tmp')) continue
      await unlink(join(dir, name)).catch(() => {})
    }
  }

  /** 删掉一个实例存的所有版本。 */
  async clear(id: string): Promise<void> {
    await removeTree(this.dir(id))
  }
}

/** 整个实例超了 {@link RUN_HISTORY_INSTANCE_MAX}：从版数最多的那份删中间的（第一版、最近一版都留着）。 */
export function trimToBudget(
  index: { files: Record<string, HistoryFile> },
  budget = RUN_HISTORY_INSTANCE_MAX,
): void {
  const total = (): number => {
    const sizes = new Map<string, number>()
    for (const file of Object.values(index.files)) {
      for (const entry of file.entries) sizes.set(entry.hash, entry.size)
    }
    return [...sizes.values()].reduce((sum, size) => sum + size, 0)
  }
  while (total() > budget) {
    const fattest = Object.values(index.files)
      .filter((file) => file.entries.length > 2)
      .sort((a, b) => b.entries.length - a.entries.length)[0]
    if (fattest === undefined) return
    fattest.entries.splice(1, 1)
    fattest.dropped += 1
  }
}
