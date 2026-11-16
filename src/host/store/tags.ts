/**
 * dsh-workflow-lite — 工作流标签的本机存放：`<数据目录>/tags.json`，工作流名 → 标签，另有挑过的颜色（标签 → 颜色）。
 *
 * 不写进工作流文件、不进版本（见 `shared/tags.ts`）。写都走仓储的同一把锁：改名、删除工作流时在锁内顺手挪走、
 * 去掉它的标签（{@link TagStore.moveWorkflow} / {@link TagStore.dropWorkflow}，调用方已持锁）；
 * 改标签、给标签改名、删标签各自进锁。
 *
 * 文件读不出来（不存在、不是合法 JSON）当成一个标签都没有；下次写会整份重写。
 * 表里按名字不分大小写找（和工作流文件名的规矩一样）。
 * 颜色只留还有工作流用着的标签的（读的时候、每次写的时候都收拾一遍）；标签改名颜色跟过去，删掉颜色一起去掉。
 *
 * @module @xiaoso/dsh-workflow-lite/host/store/tags
 */

import { idKey } from '../../shared/model.ts'
import {
  normalizeTag,
  normalizeTagColors,
  normalizeTags,
  sameTag,
  type TagColor,
} from '../../shared/tags.ts'
import { ensureDir, readFileText, writeFileAtomic } from './atomic.ts'
import { pathKind, tagsFile, workflowFile } from './paths.ts'
import type { RepoCore } from './repoCore.ts'
import { fail, mapWriteFailure, type Outcome, ok } from './repoResult.ts'

/** 工作流名（原样）→ 标签。 */
export type TagTable = Map<string, string[]>

/** 整个文件：标签表，和挑过颜色的标签（标签原样 → 颜色）。 */
export interface TagData {
  workflows: TagTable
  colors: Map<string, TagColor>
}

type TagCore = Pick<RepoCore, 'dataDir' | 'withLock' | 'resolveName'>

const empty = (): TagData => ({ workflows: new Map(), colors: new Map() })

/** 把读出来的 JSON 变成表：认 `{ workflows: { 名字: [标签] }, colors: { 标签: 颜色 } }`，别的形状当空的。 */
function dataOf(raw: unknown): TagData {
  const data = empty()
  if (typeof raw !== 'object' || raw === null) return data
  const { workflows, colors } = raw as { workflows?: unknown; colors?: unknown }
  if (typeof workflows === 'object' && workflows !== null && !Array.isArray(workflows)) {
    for (const [name, tags] of Object.entries(workflows)) {
      const list = normalizeTags(tags)
      if (list.length > 0) data.workflows.set(name, list)
    }
  }
  for (const [tag, color] of Object.entries(normalizeTagColors(colors))) data.colors.set(tag, color)
  tidy(data)
  return data
}

/** 颜色只留还有工作流用着的标签的。 */
function tidy(data: TagData): void {
  const used = [...data.workflows.values()].flat()
  for (const tag of data.colors.keys()) {
    if (!used.some((known) => sameTag(known, tag))) data.colors.delete(tag)
  }
}

const byKey = <V>([a]: [string, V], [b]: [string, V]): number => a.localeCompare(b)

/** 按名字排好、去掉空的：写盘和比对都用它（同样的内容总是同一份文本）。 */
function sorted(data: TagData): { workflows: [string, string[]][]; colors: [string, TagColor][] } {
  return {
    workflows: [...data.workflows].filter(([, tags]) => tags.length > 0).sort(byKey),
    colors: [...data.colors].sort(byKey),
  }
}

const snapshot = (data: TagData): string => JSON.stringify(sorted(data))

/** 颜色表里这个标签的那一项（不分大小写）。 */
function colorKey(colors: Map<string, TagColor>, tag: string): string | undefined {
  for (const known of colors.keys()) if (sameTag(known, tag)) return known
  return undefined
}

/** 表里这个工作流的那一项（名字不分大小写）。 */
function keyIn(table: TagTable, workflow: string): string | undefined {
  const key = idKey(workflow)
  for (const name of table.keys()) if (idKey(name) === key) return name
  return undefined
}

export class TagStore {
  private readonly core: TagCore

  constructor(core: TagCore) {
    this.core = core
  }

  /** 整个文件（只读，不进锁）。 */
  async read(): Promise<TagData> {
    let text: string | null
    try {
      text = await readFileText(tagsFile(this.core.dataDir))
    } catch {
      return empty()
    }
    if (text === null) return empty()
    try {
      return dataOf(JSON.parse(text))
    } catch {
      return empty()
    }
  }

  /** 这个工作流的标签（没有是空数组）。 */
  static tagsOf(data: TagData, workflow: string): string[] {
    const key = keyIn(data.workflows, workflow)
    return key === undefined ? [] : (data.workflows.get(key) ?? [])
  }

  /** 挑过颜色的标签（标签 → 颜色），给了 `tags` 就只要这几个的；没挑过的不在里面（按名字算，见 `autoTagColor`）。 */
  static colorsOf(data: TagData, tags?: readonly string[]): Record<string, TagColor> {
    const colors: Record<string, TagColor> = {}
    for (const [tag, color] of data.colors) {
      if (tags === undefined || tags.some((known) => sameTag(known, tag))) colors[tag] = color
    }
    return colors
  }

  /** 把这个工作流的标签换成 `tags`（归一过的）；给回实际存下的。 */
  async set(workflow: string, tags: unknown): Promise<Outcome<string[]>> {
    return this.assign(workflow, () => tags)
  }

  /** 给这个工作流添上几个标签（已有的不重复；导入并入时用）。 */
  async add(workflow: string, tags: unknown): Promise<Outcome<string[]>> {
    return this.assign(workflow, (current) => [...current, ...normalizeTags(tags)])
  }

  /** 按现有标签算出新的一组、存下（进锁；工作流不存在是 `not_found`）。 */
  private async assign(
    workflow: string,
    next: (current: string[]) => unknown,
  ): Promise<Outcome<string[]>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(workflow)
      if (!resolved.ok) return resolved
      const name = resolved.result
      if ((await pathKind(workflowFile(this.core.dataDir, name))) !== 'file') {
        return fail('not_found', `图 ${name} 不存在`, { workflow: name })
      }
      return this.change(({ workflows: table }) => {
        const key = keyIn(table, name)
        const list = normalizeTags(next(key === undefined ? [] : (table.get(key) ?? [])))
        if (key !== undefined) table.delete(key)
        if (list.length > 0) table.set(name, list)
        return list
      })
    })
  }

  /** 给标签挑颜色（`null` = 回到按名字算的）；没有工作流用着这个标签是 `not_found`。 */
  async setColor(tag: string, color: TagColor | null): Promise<Outcome<{ changed: boolean }>> {
    return this.core.withLock(async () => {
      const data = await this.read()
      // 存成工作流上的写法。
      const spelled = [...data.workflows.values()].flat().find((known) => sameTag(known, tag))
      if (spelled === undefined) return fail('not_found', `没有工作流用着标签 ${tag}`, { tag })
      return this.change(({ colors }) => {
        const key = colorKey(colors, tag)
        const before = key === undefined ? null : (colors.get(key) ?? null)
        if (key !== undefined) colors.delete(key)
        if (color !== null) colors.set(spelled, color)
        return { changed: before !== color }
      })
    })
  }

  /** 导入时带进来的颜色：本机还没挑过颜色的标签才用（本机挑过的为准）。 */
  async adoptColors(colors: Readonly<Record<string, TagColor>>): Promise<Outcome<null>> {
    return this.core.withLock(() =>
      this.change((data) => {
        for (const [tag, color] of Object.entries(colors)) {
          if (colorKey(data.colors, tag) === undefined) data.colors.set(tag, color)
        }
        return null
      }),
    )
  }

  /** 给标签改名：用着它的每个工作流都换成新名字（新名字已经有了就合成一个）；给回改了几个工作流。 */
  async rename(from: string, to: string): Promise<Outcome<{ changed: number; tag: string }>> {
    const target = normalizeTag(to)
    if (target === null) return fail('invalid_args', '标签不能是空的')
    return this.core.withLock(() =>
      this.change(({ workflows: table, colors }) => {
        let changed = 0
        for (const [name, tags] of table) {
          if (!tags.some((tag) => sameTag(tag, from))) continue
          table.set(name, normalizeTags(tags.map((tag) => (sameTag(tag, from) ? target : tag))))
          changed += 1
        }
        // 颜色跟过去；并进一个已经挑过颜色的标签时，以那个的为准。
        const fromKey = colorKey(colors, from)
        const fromColor = fromKey === undefined ? undefined : colors.get(fromKey)
        if (fromKey !== undefined) colors.delete(fromKey)
        const toKey = colorKey(colors, target)
        const kept = toKey === undefined ? fromColor : colors.get(toKey)
        if (toKey !== undefined) colors.delete(toKey)
        if (kept !== undefined) colors.set(target, kept)
        return { changed, tag: target }
      }),
    )
  }

  /** 删掉一个标签：从每个工作流上去掉；给回改了几个工作流。 */
  async remove(tag: string): Promise<Outcome<{ changed: number }>> {
    return this.core.withLock(() =>
      this.change(({ workflows: table }) => {
        let changed = 0
        for (const [name, tags] of table) {
          const rest = tags.filter((known) => !sameTag(known, tag))
          if (rest.length === tags.length) continue
          if (rest.length === 0) table.delete(name)
          else table.set(name, rest)
          changed += 1
        }
        return { changed }
      }),
    )
  }

  /** 工作流改了名：标签跟过去。**调用方已持锁。** */
  async moveWorkflow(from: string, to: string): Promise<Outcome<null>> {
    return this.change(({ workflows: table }) => {
      const key = keyIn(table, from)
      if (key === undefined) return null
      const tags = table.get(key) ?? []
      table.delete(key)
      // 新名字下要是有没人认领的旧标签（工作流早被删了），以改名过来的为准。
      const stale = keyIn(table, to)
      if (stale !== undefined) table.delete(stale)
      table.set(to, tags)
      return null
    })
  }

  /** 工作流删了：标签一起去掉。**调用方已持锁。** */
  async dropWorkflow(workflow: string): Promise<Outcome<null>> {
    return this.change(({ workflows: table }) => {
      const key = keyIn(table, workflow)
      if (key !== undefined) table.delete(key)
      return null
    })
  }

  /** 读表、改、写回（表没变就不写）。**调用方已持锁。** */
  private async change<T>(edit: (data: TagData) => T): Promise<Outcome<T>> {
    const data = await this.read()
    const before = snapshot(data)
    const result = edit(data)
    tidy(data)
    if (snapshot(data) === before) return ok(result)
    const file = tagsFile(this.core.dataDir)
    try {
      await ensureDir(this.core.dataDir)
      const out = sorted(data)
      const body = {
        workflows: Object.fromEntries(out.workflows),
        ...(out.colors.length > 0 ? { colors: Object.fromEntries(out.colors) } : {}),
      }
      await writeFileAtomic(file, `${JSON.stringify(body, null, 2)}\n`)
    } catch (error) {
      return mapWriteFailure(error, file)
    }
    return ok(result)
  }
}
