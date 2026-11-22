/**
 * dsh-workflow-lite — 触发器的本机状态：落盘位置与读写。
 *
 * 触发卡片的定义和配置都在图里（跟着工作流导出、进版本）；这里放的是这台机器上的事：
 * - 运行记录（下一次的时刻、连续失败、自动停用…）、负责的进程写下的运行情况、「全部暂停」在插件数据库里，见 {@link RunRecords}；
 * - `<dataDir>/triggers/fires/<触发编号>.txt`：背景信息太长时另存的全文，发进会话的消息里只放开头和这个文件的路径。
 *
 * 卡片的脚本、脚本自己的数据和密钥在工作流目录里（`cardDirs.ts`），跟着工作流走。
 *
 * 触发记录（连同每次的触发说明、背景信息）与检查命令、监听程序最近的输出在插件数据库里，
 * 见 {@link FireLog}、{@link OutputLog}。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/store
 */

import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { isWorkflowId } from '../../shared/naming.ts'
import type { SessionAgent } from '../../shared/types.ts'
import type { FireRecord, FireSettled, TriggerActivitySlot } from '../../shared/wire/trigger.ts'
import { ensureDir, unlinkFile, writeFileAtomic } from '../store/atomic.ts'
import type { PluginDatabase } from '../store/database.ts'
import type { Repository } from '../store/repository.ts'
import { type FireDetail, FireLog, type QueuedCount } from './fireLog.ts'
import { OutputLog } from './outputLog.ts'
import { RunRecords } from './runRecords.ts'

export const TRIGGERS_DIR = 'triggers'
/** 背景信息超过这么多字符就另存成文本文件，消息里只放开头。 */
export const INFO_INLINE_CHARS = 4000

export function triggersDir(dataDir: string): string {
  return join(dataDir, TRIGGERS_DIR)
}

/** 一次触发的背景信息全文（太长时才有）。 */
export function fireInfoFile(dataDir: string, id: string): string {
  return join(triggersDir(dataDir), 'fires', `${id}.txt`)
}

/** 触发编号：`f-<YYYYMMDD>-<HHmmss>-<4 位十六进制>`。 */
export function newFireId(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `f-${day}-${time}-${randomBytes(2).toString('hex')}`
}

export type { FireDetail }

/** 触发器在本机的记录。 */
export class TriggerStore {
  private readonly log: FireLog
  /** 检查命令、监听程序最近的输出（负责的进程写，哪个进程都能读、清空）。 */
  readonly outputs: OutputLog
  /** 每张卡片的运行记录、负责的进程写下的运行情况、全部暂停。 */
  readonly runs: RunRecords

  constructor(
    private readonly workflows: Pick<Repository, 'dataDir' | 'workflowById'>,
    database: PluginDatabase,
  ) {
    this.log = new FireLog(database)
    this.outputs = new OutputLog(database)
    this.runs = new RunRecords(database)
  }

  name(id: string): string | undefined {
    return this.workflows.workflowById(id)?.name
  }

  private display(record: FireRecord): FireRecord {
    if (!isWorkflowId(record.workflow)) return record
    return {
      ...record,
      workflow: this.name(record.workflow) ?? record.workflow,
      workflowId: record.workflow,
    }
  }

  // ── 触发记录（插件数据库里，见 FireLog）────────────────────

  /** 记一次触发（连同那一刻的触发说明与背景信息）；背景信息太长时另存全文。 */
  async record(workflowId: string, detail: FireDetail): Promise<void> {
    const { dataDir } = this.workflows
    const long = detail.info !== undefined && detail.info.length > INFO_INLINE_CHARS
    if (long) {
      await ensureDir(join(triggersDir(dataDir), 'fires'))
      await writeFileAtomic(fireInfoFile(dataDir, detail.record.id), detail.info ?? '')
    }
    const { record } = detail
    this.log.record(
      {
        ...detail,
        record: {
          ...record,
          workflow: workflowId,
        },
      },
      long,
    )
  }

  /** 一张卡片最近一次触发。 */
  async last(workflow: string, node: string): Promise<FireRecord | undefined> {
    const record = this.log.last(workflow, node)
    return record === undefined ? undefined : this.display(record)
  }

  /** 一张卡片最近一次失败的时刻；没失败过是 `undefined`。 */
  async lastFailure(workflow: string, node: string): Promise<number | undefined> {
    return this.log.lastFailure(workflow, node)
  }

  /** 最近 `limit` 次，新的在前；不给卡片就是这个工作流所有卡片的。 */
  async history(workflow: string, node: string | undefined, limit: number): Promise<FireRecord[]> {
    return this.log.recent(workflow, node, limit).map((record) => this.display(record))
  }

  /** `since` 之后这张卡片收下了几次（发出去的、排着的）。 */
  async sentSince(workflow: string, node: string, since: number): Promise<number> {
    return this.log.sentSince(workflow, node, since)
  }

  /** 有排着的那些卡片、各几个。 */
  async queuedCounts(): Promise<QueuedCount[]> {
    return this.log.queuedCounts()
  }

  /** 这张卡片排着几个。 */
  async queuedCount(workflow: string, node: string): Promise<number> {
    return this.log.queuedCount(workflow, node)
  }

  /** 这张卡片排着的，先来的在前。 */
  async queuedFires(workflow: string, node: string): Promise<FireRecord[]> {
    return this.log.queued(workflow, node).map((record) => this.display(record))
  }

  /** 排着的这一次轮到了，记下结果；已经不是排着的回 `false`。 */
  async release(
    id: string,
    outcome: FireSettled,
    extra: { reason?: string; session?: string; agent?: SessionAgent },
    sentAt: number,
  ): Promise<boolean> {
    return this.log.release(id, outcome, extra, sentAt)
  }

  /** 排着的这一次不再执行（记成跳过）；已经不是排着的回 `false`。 */
  async cancel(id: string, reason: string): Promise<boolean> {
    return this.log.cancel(id, reason)
  }

  /** 这张卡片排着的都不再执行（记成跳过），回几个。 */
  async drop(workflow: string, node: string, reason: string): Promise<number> {
    return this.log.drop(workflow, node, reason)
  }

  /** 这个会话里、`since` 以来发进去了还没对上实例的最早一次。 */
  async unclaimed(
    workflow: string,
    session: string,
    since: number,
  ): Promise<FireRecord | undefined> {
    const record = this.log.unclaimed(workflow, session, since)
    return record === undefined ? undefined : this.display(record)
  }

  /** 这张卡片 `since` 到 `until` 每一小格各种结果几次。 */
  async activity(
    workflow: string,
    node: string,
    since: number,
    until: number,
  ): Promise<TriggerActivitySlot[]> {
    return this.log.activity(workflow, node, since, until)
  }

  /** 一次触发的背景信息全文另存在哪（太长时才写这个文件）。 */
  infoPath(id: string): string {
    return fireInfoFile(this.workflows.dataDir, id)
  }

  /** 一次触发的全部；编号不对、记录不在是 `null`。 */
  async detail(id: string): Promise<FireDetail | null> {
    const detail = this.log.detail(id)
    return detail === null ? null : { ...detail, record: this.display(detail.record) }
  }

  /** 这次触发建出了哪个实例。 */
  async bind(id: string, instance: string): Promise<void> {
    this.log.bind(id, instance)
  }

  /** 这个会话里 `since` 以来还没对上实例的同一个工作流的触发，都记成接进了实例 `instance`。 */
  async join(workflow: string, session: string, since: number, instance: string): Promise<void> {
    this.log.join(workflow, session, since, instance)
  }

  /** 记到这个实例上的触发，从早到晚。 */
  async ofInstance(instance: string): Promise<FireRecord[]> {
    return this.log.ofInstance(instance).map((record) => this.display(record))
  }

  /** 模型按触发条件判断这次不需要执行：记下它给的原因。 */
  async decline(id: string, reason: string): Promise<void> {
    this.log.decline(id, reason)
  }

  /** 工作流删掉了：它的运行记录、触发记录连同另存的全文、最近的输出一起删。 */
  async forget(workflow: string): Promise<void> {
    this.outputs.forget(workflow)
    this.runs.forget(workflow)
    const files = this.log.forget(workflow)
    await Promise.all(files.map((id) => unlinkFile(fireInfoFile(this.workflows.dataDir, id))))
  }
}
