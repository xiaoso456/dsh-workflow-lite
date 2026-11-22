/**
 * 自 0.11.0 引入：给正式发布的按名称存储的 JSON 工作流补 ID。
 * 迁移前需关闭旧版 DSH 实例。新进程共用 SQLite 写锁，迁移途中退出会自动释放锁。
 *
 * 先保存旧名与 ID 的映射，再补写工作流与实例的归属。途中重启复用同一份映射。
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { setTimeout } from 'node:timers/promises'
import { readDocument } from '../../../shared/model.ts'
import { checkName, isWorkflowId, normalizeName } from '../../../shared/naming.ts'
import { ensureDir, hashOf, readFileText, unlinkFile, writeFileAtomic } from '../atomic.ts'
import { DATABASE_FILE } from '../database.ts'
import { workflowFile, workflowNamesOnDisk } from '../paths.ts'

interface WorkflowIdentity {
  name: string
  id: string
  hash: string
}

const JOURNAL = '.migration-workflow-id.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIdentity(value: unknown): value is WorkflowIdentity {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    checkName(value.name) === null &&
    isWorkflowId(value.id) &&
    typeof value.hash === 'string' &&
    /^[0-9a-f]{64}$/u.test(value.hash)
  )
}

async function lockMigration(db: DatabaseSync): Promise<void> {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      db.exec('BEGIN IMMEDIATE')
      return
    } catch (error) {
      const busy = isRecord(error) && error.errcode === 5
      if (!busy || Date.now() >= deadline) throw error
      await setTimeout(100)
    }
  }
}

async function oldWorkflowText(dataDir: string, name: string): Promise<string | null> {
  if (checkName(name) !== null) return null
  const text = await readFileText(workflowFile(dataDir, name))
  if (text === null) return null
  const { document } = readDocument(text)
  if (document === null || document.workflowId !== undefined) {
    return null
  }
  return text
}

async function planIdentities(dataDir: string): Promise<WorkflowIdentity[]> {
  const identities: WorkflowIdentity[] = []
  for (const name of await workflowNamesOnDisk(dataDir)) {
    const text = await oldWorkflowText(dataDir, name)
    if (text !== null) identities.push({ name, id: randomUUID(), hash: await hashOf(text) })
  }
  return identities
}

async function updateObject(
  file: string,
  change: (object: Record<string, unknown>) => boolean,
): Promise<void> {
  const text = await readFileText(file)
  if (text === null) return
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // 正式版已有处理损坏实例索引的逻辑，迁移保留原文件。
    return
  }
  if (!isRecord(raw) || !change(raw)) return
  await writeFileAtomic(file, `${JSON.stringify(raw, null, 2)}\n`)
}

function identifyInstances(
  raw: Record<string, unknown>,
  ids: ReadonlyMap<string, string>,
): boolean {
  if (raw.version !== 1 || !Array.isArray(raw.instances)) return false
  let changed = false
  for (const instance of raw.instances) {
    if (
      !isRecord(instance) ||
      typeof instance.workflow !== 'string' ||
      instance.workflowId !== undefined
    ) {
      continue
    }
    const id = ids.get(normalizeName(instance.workflow).toLowerCase())
    if (id === undefined) continue
    instance.workflowId = id
    changed = true
  }
  return changed
}

async function writeIdentities(
  dataDir: string,
  identities: readonly WorkflowIdentity[],
): Promise<void> {
  // 先检查全部图仍是登记时的文件，避免曾中断时用旧记录覆盖一张新图的 ID。
  for (const { name, id, hash } of identities) {
    const file = workflowFile(dataDir, name)
    const text = await readFileText(file)
    if (
      text === null ||
      ((await hashOf(text)) !== hash && readDocument(text).document?.workflowId !== id)
    ) {
      throw new Error(`工作流迁移来源已改变：${file}`)
    }
  }
  const ids = new Map(identities.map(({ name, id }) => [normalizeName(name).toLowerCase(), id]))
  if (ids.size !== identities.length || new Set(ids.values()).size !== identities.length) {
    throw new Error('工作流迁移记录存在重复的名称或 ID')
  }
  // 仅补身份。旧名称用于验证存量 state.yaml，其他字段、快照和工作区路径照旧。
  await updateObject(join(dataDir, 'instances.json'), (raw) => identifyInstances(raw, ids))
  for (const { name, id } of identities) {
    await updateObject(workflowFile(dataDir, name), (raw) => {
      if (raw.workflowId === id) return false
      raw.workflowId = id
      return true
    })
  }
}

/** 在仓储对外提供服务前调用。成功后再次启动不会重写已经升级的图。 */
export async function upgradeWorkflowIdentity(dataDir: string): Promise<void> {
  const journal = join(dataDir, JOURNAL)
  if ((await readFileText(journal)) === null && (await planIdentities(dataDir)).length === 0) return
  await ensureDir(dataDir)
  const sqlite = process.getBuiltinModule('node:sqlite')
  if (sqlite === undefined) throw new Error('当前 Node.js 无法锁定工作流迁移')
  const db = new sqlite.DatabaseSync(join(dataDir, DATABASE_FILE))
  try {
    await lockMigration(db)
    const prior = await readFileText(journal)
    const identities: unknown = prior === null ? await planIdentities(dataDir) : JSON.parse(prior)
    if (!Array.isArray(identities) || !identities.every(isIdentity))
      throw new Error(`工作流迁移记录无效：${journal}`)
    if (identities.length > 0) {
      if (prior === null) await writeFileAtomic(journal, `${JSON.stringify(identities, null, 2)}\n`)
      await writeIdentities(dataDir, identities)
    }
    await unlinkFile(journal)
    db.exec('COMMIT')
  } finally {
    db.close()
  }
}
