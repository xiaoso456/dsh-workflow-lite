import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isWorkflowId, normalizeName } from '../../shared/naming.ts'
import {
  fileStamp,
  isAbsentError,
  isMissingOrUnreadableAsFile,
  JSON_SUFFIX,
  workflowsDir,
} from './paths.ts'

export interface WorkflowIdentity {
  id: string
  name: string
}

/** ID 属于工作流文件，即使图内容损坏，也保留可读的 ID。 */
export function workflowIdFromText(text: string): string | undefined {
  try {
    const raw = JSON.parse(text) as { workflowId?: unknown } | null
    return isWorkflowId(raw?.workflowId) ? raw.workflowId : undefined
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

export function duplicateWorkflowIds(ids: Iterable<string | undefined>): ReadonlySet<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (id === undefined) continue
    if (seen.has(id)) duplicates.add(id)
    else seen.add(id)
  }
  return duplicates
}

/** 当前工作流的身份索引。各文件只在内容变动时重读，重复 ID 暂停归属查询。 */
export class WorkflowIndex {
  private readonly dir: string
  private stamp: string | undefined
  private files = new Map<string, { stamp: string; id: string | undefined }>()
  private byId = new Map<string, WorkflowIdentity>()
  private byName = new Map<string, WorkflowIdentity>()

  constructor(dataDir: string) {
    this.dir = workflowsDir(dataDir)
  }

  getById(id: string): WorkflowIdentity | undefined {
    if (!isWorkflowId(id)) return undefined
    this.refresh()
    return this.byId.get(id)
  }

  getByName(name: string): WorkflowIdentity | undefined {
    this.refresh()
    return this.byName.get(normalizeName(name).toLowerCase())
  }

  private refresh(): void {
    let stamp: string
    try {
      stamp = fileStamp(statSync(this.dir))
    } catch (error) {
      if (!isAbsentError(error)) throw error
      this.stamp = undefined
      this.files.clear()
      this.byId.clear()
      this.byName.clear()
      return
    }
    if (stamp === this.stamp) return

    const files = new Map<string, { stamp: string; id: string | undefined }>()
    const identities: WorkflowIdentity[] = []
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (
        !entry.isFile() ||
        entry.name.startsWith('.') ||
        !entry.name.toLowerCase().endsWith(JSON_SUFFIX)
      )
        continue
      const facts = this.read(entry.name)
      if (facts === undefined) continue
      files.set(entry.name, facts)
      if (facts.id === undefined) continue
      identities.push({ id: facts.id, name: entry.name.slice(0, -JSON_SUFFIX.length) })
    }
    const duplicates = duplicateWorkflowIds(identities.map(({ id }) => id))
    const unique = identities.filter(({ id }) => !duplicates.has(id))
    this.files = files
    this.byId = new Map(unique.map((entry) => [entry.id, entry]))
    this.byName = new Map(unique.map((entry) => [normalizeName(entry.name).toLowerCase(), entry]))
    this.stamp = stamp
  }

  private read(name: string): { stamp: string; id: string | undefined } | undefined {
    const file = join(this.dir, name)
    try {
      const stamp = fileStamp(statSync(file))
      const cached = this.files.get(name)
      if (cached?.stamp === stamp) return cached
      return { stamp, id: workflowIdFromText(readFileSync(file, 'utf8')) }
    } catch (error) {
      if (!isMissingOrUnreadableAsFile(error)) throw error
      return undefined
    }
  }
}
