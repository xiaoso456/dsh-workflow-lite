/**
 * dsh-workflow-lite — 工作流实例的业务面：建实例、列、读、绑定、删、恢复、保存用户的改动。
 *
 * 工具（`compile` / `resume` / `runs` / `state`）与画布 RPC（`run/*`）共用这一层。状态文件只有插件写：
 * 模型经 `state` 动作改（插件补时间、轮次、流水，改完校验），用户经画布改（逐字段核对冲突）。
 * 同一个实例的写入排队进行，不会互相覆盖。
 *
 * 这里只做转发，按职责分给几个部分：`runSetup`（建立、归属、恢复）、`runReader`（读）、
 * `runProgress`（模型记进度）、`runEdits`（用户的改动），它们共用 `runCore`（依赖、写入排队、快照与状态文件的读取）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/service
 */

import type {
  InstanceRecord,
  InstanceSummary,
  InstanceView,
  StateEdit,
} from '../../shared/runState.ts'
import type {
  RunDirResponse,
  RunFileResponse,
  RunHistoryResponse,
  RunImageResponse,
  RunLatestResponse,
  RunLinesRequest,
  RunLinesResponse,
  RunStatResponse,
} from '../../shared/wire/run.ts'
import type { CompileBundle } from '../plan.ts'
import type { Outcome } from '../store/repoResult.ts'
import type { RunFileTarget } from './files.ts'
import type { RunHistory } from './history.ts'
import { RunCore, type RunServiceDeps, type SessionRef } from './runCore.ts'
import { type GraphEdit, RunEdits, type SaveResult } from './runEdits.ts'
import { RunProgress, type StatePatch, type StateReport } from './runProgress.ts'
import { RunReader, type Unchanged } from './runReader.ts'
import { type InstancePlan, RunSetup } from './runSetup.ts'
import type { InstanceStore } from './store.ts'

export class RunService {
  readonly store: InstanceStore
  /** 产出的各版（循环迭代时每一轮写成了什么样）。 */
  readonly history: RunHistory
  private readonly setup: RunSetup
  private readonly reader: RunReader
  private readonly progress: RunProgress
  private readonly edits: RunEdits

  constructor(deps: RunServiceDeps) {
    const core = new RunCore(deps)
    this.store = core.store
    this.history = core.history
    this.setup = new RunSetup(core)
    this.reader = new RunReader(core)
    this.progress = new RunProgress(core)
    this.edits = new RunEdits(core)
  }

  // ── 建立 ───────────────────────────────────────────────────

  /** 编译成功之后建实例（见 {@link RunSetup.prepare}）。 */
  prepare(input: Parameters<RunSetup['prepare']>[0]): Promise<Outcome<InstanceRecord>> {
    return this.setup.prepare(input)
  }

  /** 工具的 `compile`：图编译得出计划就建一个实例（见 {@link RunSetup.compile}）。 */
  compile(
    input: Parameters<RunSetup['compile']>[0],
  ): Promise<Outcome<InstancePlan | CompileBundle>> {
    return this.setup.compile(input)
  }

  /** 画布上的「执行」：建一个新实例，回一句发进会话的话（见 {@link RunSetup.start}）。 */
  start(
    input: Parameters<RunSetup['start']>[0],
  ): Promise<Outcome<{ instance: InstanceSummary; prompt: string }>> {
    return this.setup.start(input)
  }

  // ── 读 ─────────────────────────────────────────────────────

  /** 列实例：`all` 为假时只列 `session` 的。新的在前。 */
  list(session: string | undefined, all: boolean): Promise<InstanceSummary[]> {
    return this.reader.list(session, all)
  }

  /** 会话的当前实例 id（没有就 `undefined`）。 */
  currentOf(session: string): Promise<string | undefined> {
    return this.reader.currentOf(session)
  }

  /** 读一个实例给画布。`since` 等于文件当前的修改时间时只回"没变"。 */
  view(
    id: string,
    session: string | undefined,
    since?: number,
  ): Promise<Outcome<InstanceView | Unchanged>> {
    return this.reader.view(id, session, since)
  }

  /** 快照里几个资源项现在在不在、多大、什么时候改的（见 {@link RunReader.stat}）。 */
  stat(
    id: string,
    targets: readonly { node: string; item: number }[],
  ): Promise<Outcome<RunStatResponse>> {
    return this.reader.stat(id, targets)
  }

  /** 模板画布上的「上次执行」（见 {@link RunReader.latest}）。 */
  latest(
    workflow: string,
    targets: readonly { node: string; value: string }[],
  ): Promise<RunLatestResponse> {
    return this.reader.latest(workflow, targets)
  }

  /** 看实例里的一份产出文件（文件面板与查看框）。 */
  file(
    id: string,
    target: RunFileTarget,
    options: { tail?: boolean } = {},
  ): Promise<Outcome<RunFileResponse>> {
    return this.reader.file(id, target, options)
  }

  /** 日志、纯文本按行读（`run/lines`，见 {@link RunReader.lines}）。 */
  lines(
    id: string,
    target: { node: string; item: number; sub?: string; version?: number },
    request: Omit<RunLinesRequest, 'id' | 'node' | 'item' | 'sub' | 'version'>,
  ): Promise<Outcome<RunLinesResponse>> {
    return this.reader.lines(id, target, request)
  }

  /** 实例里的一张本地图片（见 {@link RunReader.image}）。 */
  image(id: string, target: RunFileTarget, src?: string): Promise<Outcome<RunImageResponse>> {
    return this.reader.image(id, target, src)
  }

  /** 看资源里一个文件夹（或它下面的子文件夹）里有什么：只列这一层。 */
  dir(
    id: string,
    target: { node: string; item: number; sub?: string },
  ): Promise<Outcome<RunDirResponse>> {
    return this.reader.dir(id, target)
  }

  /** 一份文件存下的各版（只认快照里的文件项）。 */
  versions(id: string, node: string, item: number): Promise<Outcome<RunHistoryResponse>> {
    return this.reader.versions(id, node, item)
  }

  // ── 归属 ───────────────────────────────────────────────────

  /** 设 `session` 的当前实例；实例原本属于别的会话时把它转过来（见 {@link RunSetup.bind}）。 */
  bind(id: string, session: string): Promise<Outcome<{ transferred: boolean }>> {
    return this.setup.bind(id, session)
  }

  /** 删实例记录与快照；`withState` 为真时连工作区里的状态文件一起删。 */
  remove(id: string, withState: boolean): Promise<Outcome<{ removed: true }>> {
    return this.setup.remove(id, withState)
  }

  // ── 恢复 ───────────────────────────────────────────────────

  /** 接着跑一个实例：从快照重建计划，带上运行状态段，再给一份摘要（见 {@link RunSetup.resume}）。 */
  resume(id: string | undefined, session: SessionRef): Promise<Outcome<InstancePlan>> {
    return this.setup.resume(id, session)
  }

  // ── 模型记进度 ─────────────────────────────────────────────

  /** 工具的 `state`：看或改一个实例的运行状态（见 {@link RunProgress.state}）。 */
  state(
    id: string | undefined,
    session: SessionRef,
    patch: StatePatch,
  ): Promise<Outcome<StateReport>> {
    return this.progress.state(id, session, patch)
  }

  // ── 用户的改动 ─────────────────────────────────────────────

  /** 保存用户在画布上攒的改动，再通知模型（见 {@link RunEdits.save}）。 */
  save(
    id: string,
    session: string | undefined,
    edits: readonly StateEdit[],
    note: string | undefined,
    graph?: GraphEdit,
    options: { notify?: boolean } = {},
  ): Promise<Outcome<SaveResult>> {
    return this.edits.save(id, session, edits, note, graph, options)
  }

  /** 取走这个会话名下所有没送到的通知（模型调用工具时附在返回值里）。 */
  takeNotices(session: string | undefined): Promise<string[]> {
    return this.edits.takeNotices(session)
  }
}
