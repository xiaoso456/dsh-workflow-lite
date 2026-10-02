/**
 * dsh-workflow-lite — 会话桥：画布上的「执行」要列出同一工作区的会话、往选中的会话里发一句话。
 *
 * 两样都借宿主现成的东西，不自己造：
 * - 会话列表：Session Controller 的 `sessions.list`（和侧栏同一份数据）；
 * - 发消息：会话输入框的标准发送流程（`conversation.input.for(会话 ctx)` 的 `setDraft` + `submit`），
 *   和用户自己敲回车一模一样——会话正忙时按用户的设置排队或插话。
 *
 * 两个服务都是**可选**的：入口用 `ctx.inject` 的子上下文接上，缺了只是「执行」用不了，视图照常。
 * 宿主的类型包不在依赖里，这里只声明用到的那几个成员。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/sessions
 */

import { useSyncExternalStore } from 'react'

/** 列表里的一个会话（侧栏那份数据的子集）。 */
export interface SessionRow {
  id: string
  title: string
  cwd?: string
  running: boolean
  updatedAt: number
  /** 还没说过话的新会话。 */
  blank: boolean
  /** 子代理会话（不在侧栏里列，也不给选）。 */
  subagent: boolean
}

interface Observable<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

interface InputSnapshot {
  draft: string
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

interface SessionInput {
  setDraft(text: string): void
  submit(): void
  readonly state: Observable<InputSnapshot>
}

/** `ctx.conversation` 用到的部分。 */
export interface ConversationService {
  input: { for(ctx: unknown): SessionInput }
}

interface SessionSummary {
  id: string
  title?: string
  displayTitle?: string
  cwd?: string
  origin?: string
  running?: boolean
  blank?: boolean
  updatedAt?: number
}

/** `ctx.sessions` 用到的部分。 */
export interface SessionsService {
  list: Observable<{ ids: readonly string[]; byId: Readonly<Record<string, SessionSummary>> }>
  using<T>(
    target: string,
    options: { source: string },
    operation: (reference: { binding: { ctx: unknown } }) => T | Promise<T>,
  ): Promise<T>
}

/** 发出去之后等多久还没被输入框接走，就算没发出去。 */
const SUBMIT_TIMEOUT_MS = 15000

/** 视图拿到的会话桥。 */
export interface SessionBridge {
  /** 服务接上了没有（没接上 = 「执行」不可用）。 */
  available(): boolean
  rows(): readonly SessionRow[]
  subscribe(fn: () => void): () => void
  /** 往会话里发一句话；没发出去就抛错（错误信息给人看）。 */
  deliver(session: string, text: string): Promise<void>
}

/** 入口里建一个，服务接上 / 断开时调 `attach` / `detach`。 */
export function createSessionBridge(): SessionBridge & {
  attach(sessions: SessionsService, conversation: ConversationService): void
  detach(): void
} {
  let services: { sessions: SessionsService; conversation: ConversationService } | null = null
  let unsubscribe: (() => void) | null = null
  let cache: readonly SessionRow[] = []
  let cachedFrom: unknown = null
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const fn of [...listeners]) fn()
  }

  const rows = (): readonly SessionRow[] => {
    if (services === null) {
      if (cache.length > 0) cache = []
      return cache
    }
    const list = services.sessions.list.getSnapshot()
    if (list === cachedFrom) return cache
    cachedFrom = list
    cache = list.ids.flatMap((id) => {
      const row = list.byId[id]
      if (row === undefined) return []
      return [
        {
          id,
          title: row.displayTitle ?? row.title ?? id,
          ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
          running: row.running === true,
          updatedAt: row.updatedAt ?? 0,
          blank: row.blank === true,
          subagent: row.origin === 'subagent',
        },
      ]
    })
    return cache
  }

  return {
    attach(sessions, conversation) {
      services = { sessions, conversation }
      cachedFrom = null
      unsubscribe = sessions.list.subscribe(emit)
      emit()
    },
    detach() {
      unsubscribe?.()
      unsubscribe = null
      services = null
      emit()
    },
    available: () => services !== null,
    rows,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    async deliver(session, text) {
      const current = services
      if (current === null) throw new Error('会话服务没有就绪')
      const list = current.sessions.list
      const stamp = (): number => list.getSnapshot().byId[session]?.updatedAt ?? 0
      const before = stamp()
      await current.sessions.using(session, { source: 'workflowLite' }, async (reference) => {
        await submitThrough(current.conversation.input.for(reference.binding.ctx), text)
        // 输入框交出去不等于宿主收到了：等会话列表里这个会话动了（宿主记下了这条消息）再放手，
        // 没在看的会话只靠这里临时持有，提前放手会把还在路上的消息一起撤掉。
        const accepted = await until(
          list,
          (value) =>
            value.byId[session]?.running === true || (value.byId[session]?.updatedAt ?? 0) > before,
          SUBMIT_TIMEOUT_MS,
        )
        if (!accepted) throw new Error('消息发出去了，但那个会话没有反应')
      })
    },
  }
}

/** 等一份可订阅的状态满足条件（超时回 `false`）。 */
function until<T>(
  source: Observable<T>,
  ok: (value: T) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (ok(source.getSnapshot())) {
      resolve(true)
      return
    }
    let stop = (): void => {}
    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, timeoutMs)
    stop = source.subscribe(() => {
      if (!ok(source.getSnapshot())) return
      clearTimeout(timer)
      stop()
      resolve(true)
    })
  })
}

/**
 * 借输入框发一句话：先把用户正在写的草稿记下，发完再放回去（不吞掉别人写了一半的话）。
 *
 * 编辑器的更新是异步的，提交也是：要**亲眼看到**草稿换成了这句话、提交开始、再回到空闲且草稿被取走，
 * 才算发出去了——没在看的会话由调用方临时持有，提前放手会把还没送出的提交一起撤掉。
 */
async function submitThrough(input: SessionInput, text: string): Promise<void> {
  const before = input.state.getSnapshot()
  if (before.phase !== 'plain') throw new Error('那个会话的输入框正在发送别的消息，稍后再试')
  const kept = before.draft
  const restore = (): void => {
    if (kept.trim() !== '') input.setDraft(kept)
  }
  input.setDraft(text)
  if (!(await until(input.state, (state) => state.draft === text, 3000))) {
    restore()
    throw new Error('消息没能放进那个会话的输入框')
  }
  input.submit()
  const started = await until(
    input.state,
    (state) => state.phase !== 'plain' || state.draft !== text,
    5000,
  )
  const settled =
    started && (await until(input.state, (state) => state.phase === 'plain', SUBMIT_TIMEOUT_MS))
  const sent = settled && input.state.getSnapshot().draft !== text
  if (!sent && input.state.getSnapshot().draft === text) input.setDraft('')
  restore()
  if (!sent) throw new Error('消息没能发出去（输入框没有接收）')
}

/** 同一个工作区：路径大小写、分隔符不同也算同一个（Windows）。 */
function sameDir(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false
  const norm = (value: string): string => value.replace(/[\\/]+$/u, '').replace(/\\/gu, '/')
  return norm(a).toLowerCase() === norm(b).toLowerCase()
}

/** 能选的会话：本会话在最前，其余是同一工作区里说过话的主会话，新的在前。 */
export function pickable(rows: readonly SessionRow[], session: string | undefined): SessionRow[] {
  const self = rows.find((row) => row.id === session)
  const others = rows
    .filter(
      (row) =>
        row.id !== session &&
        !row.subagent &&
        !row.blank &&
        (self?.cwd === undefined || sameDir(row.cwd, self.cwd)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return self === undefined ? others : [self, ...others]
}

/** 订阅会话列表。 */
export function useSessionRows(bridge: SessionBridge | undefined): readonly SessionRow[] {
  return useSyncExternalStore(
    bridge?.subscribe ?? noopSubscribe,
    bridge?.rows ?? emptyRows,
    bridge?.rows ?? emptyRows,
  )
}

const EMPTY: readonly SessionRow[] = []
const emptyRows = (): readonly SessionRow[] => EMPTY
const noopSubscribe = (): (() => void) => () => {}
