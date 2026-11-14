/**
 * dsh-workflow-lite — HTTP 触发：插件自己在本机开一个固定端口，每张 HTTP 触发卡片一个地址、一个令牌。
 *
 * - 监听地址和端口在插件设置里定（缺省只监听 127.0.0.1）；没有开着的 HTTP 触发卡片时不开端口。
 * - `POST /trigger/<地址>`，令牌放在 `Authorization: Bearer <令牌>`（或 `?token=`）；卡片可以设成不校验令牌；
 *   令牌不对回 401，地址不在（卡片关着、删了）回 404，别的方法回 405，请求体超过 1 MiB 回 413。
 * - 请求一收到就回 202，不等工作流跑完；请求体原样作为背景信息。
 * - 端口被占用、监听地址不在本机时报出原因，每隔一会儿再试；空出来或在设置里换一个就自动恢复。
 *
 * 地址与令牌都能自己写（规则见 `shared/triggerHttp`）；新卡片的地址缺省用工作流名，换令牌时地址不变。
 * 地址里有中文等字时，网址里按 UTF-8 转义，收到时解开再对。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/hooks
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hookPath } from '../../shared/triggerHttp.ts'
import { decodeOutput } from './processes.ts'

/** 请求体上限。 */
export const BODY_MAX_BYTES = 1024 * 1024
/** 端口开不了时隔多久再试。 */
const RETRY_MS = 30_000

/** 随机的地址（工作流名拼不出来时用）与令牌。 */
export function newHookId(): string {
  return randomBytes(9).toString('base64url')
}

export function newHookToken(): string {
  return randomBytes(24).toString('base64url')
}

/** 在哪个地址、哪个端口上监听。 */
export interface HookBind {
  host: string
  port: number
}

/** @param host - 别人连的地址（监听所有网卡时是某块网卡的地址，见 `advertisedHost`）。 */
export function hookUrl(host: string, port: number, hook: string): string {
  return `http://${host}:${String(port)}${hookPath(hook)}`
}

/** 一个开着的地址：令牌（`null` = 不校验）、收到请求体之后交给谁。 */
export interface HookRoute {
  token: string | null
  accept(body: string): void
}

/** 端口的情况。 */
export type HookPortState =
  | { kind: 'closed' }
  | { kind: 'open'; port: number; host: string }
  | { kind: 'error'; port: number; host: string; problem: string }

function sameBind(a: HookBind | undefined, b: HookBind): boolean {
  return a !== undefined && a.host === b.host && a.port === b.port
}

/** 端口开不了的一句原因。 */
function openProblem(error: NodeJS.ErrnoException, bind: HookBind): string {
  const port = String(bind.port)
  if (error.code === 'EADDRINUSE')
    return `端口 ${port} 被别的程序占用了，换一个端口或关掉占用它的程序`
  if (error.code === 'EACCES') return `没有权限使用端口 ${port}`
  if (error.code === 'EADDRNOTAVAIL') {
    return `这台电脑上没有地址 ${bind.host}（网卡换了或断开了），到设置里换一个监听地址`
  }
  return `端口 ${port} 开不了：${error.message}`
}

/** `/trigger/<地址>` 里的地址（解开转义）；不是这个样子的路径是 `undefined`。 */
function hookOf(pathname: string): string | undefined {
  const match = /^\/trigger\/([^/]+)\/?$/u.exec(pathname)
  if (match?.[1] === undefined) return undefined
  try {
    return decodeURIComponent(match[1]).normalize('NFC')
  } catch {
    return undefined
  }
}

function sameToken(given: string, expected: string): boolean {
  const digest = (text: string): Buffer => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

/** 带的令牌对不对；地址不校验令牌（`expected` 是 `null`）时都算对。 */
function authorized(request: IncomingMessage, url: URL, expected: string | null): boolean {
  if (expected === null) return true
  const given = tokenOf(request, url)
  return given !== undefined && sameToken(given, expected)
}

function tokenOf(request: IncomingMessage, url: URL): string | undefined {
  const header = request.headers.authorization
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/iu.exec(header.trim())
    if (match?.[1] !== undefined) return match[1].trim()
  }
  return url.searchParams.get('token') ?? undefined
}

function reply(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(body)}\n`)
}

export class HookServer {
  private server: Server | undefined
  private bound: HookBind | undefined
  private state: HookPortState = { kind: 'closed' }
  private retryAt = 0
  private routes = new Map<string, HookRoute>()
  private opening: Promise<void> | undefined

  constructor(
    private readonly onState: (state: HookPortState) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  current(): HookPortState {
    return this.state
  }

  /** 换上这一轮开着的地址；有地址就保证端口开着（监听地址、端口换了就重开），没有就关掉端口。 */
  async sync(bind: HookBind, routes: Map<string, HookRoute>): Promise<void> {
    this.routes = routes
    await this.opening
    if (routes.size === 0) {
      await this.close()
      return
    }
    if (this.server !== undefined && sameBind(this.bound, bind)) return
    if (this.server !== undefined) await this.close()
    if (this.state.kind === 'error' && sameBind(this.state, bind) && this.now() < this.retryAt) {
      return
    }
    this.opening = this.open(bind)
    await this.opening
    this.opening = undefined
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.bound = undefined
    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
    this.setState({ kind: 'closed' })
  }

  private setState(state: HookPortState): void {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return
    this.state = state
    this.onState(state)
  }

  private open(bind: HookBind): Promise<void> {
    const { host, port } = bind
    return new Promise((resolve) => {
      const server = createServer((request, response) => this.handle(request, response))
      server.on('error', (error: NodeJS.ErrnoException) => {
        this.retryAt = this.now() + RETRY_MS
        this.setState({ kind: 'error', port, host, problem: openProblem(error, bind) })
        resolve()
      })
      server.listen(port, host, () => {
        this.server = server
        this.bound = bind
        this.setState({ kind: 'open', port, host })
        resolve()
      })
    })
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://hook.invalid')
    const hook = hookOf(url.pathname)
    const route = hook === undefined ? undefined : this.routes.get(hook)
    if (route === undefined) {
      reply(response, 404, {
        error: 'not_found',
        message: '没有这个触发地址，或这张触发卡片没打开',
      })
      request.resume()
      return
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST')
      reply(response, 405, { error: 'method_not_allowed', message: '用 POST' })
      request.resume()
      return
    }
    if (!authorized(request, url, route.token)) {
      reply(response, 401, { error: 'unauthorized', message: '令牌不对' })
      request.resume()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_MAX_BYTES) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) {
        reply(response, 413, { error: 'too_large', message: '请求体超过 1 MiB' })
        return
      }
      reply(response, 202, { accepted: true })
      route.accept(decodeOutput(Buffer.concat(chunks)))
    })
    request.on('error', () => response.destroy())
  }
}
