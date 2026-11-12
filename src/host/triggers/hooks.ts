/**
 * dsh-workflow-lite — HTTP 触发：插件自己在本机开一个固定端口，每张 HTTP 触发卡片一个地址、一个令牌。
 *
 * - 只监听 127.0.0.1；端口在插件设置里定；没有开着的 HTTP 触发卡片时不开端口。
 * - `POST /trigger/<地址号>`，令牌放在 `Authorization: Bearer <令牌>`（或 `?token=`）；
 *   令牌不对回 401，地址不在（卡片关着、删了）回 404，别的方法回 405，请求体超过 1 MiB 回 413。
 * - 请求一收到就回 202，不等工作流跑完；请求体原样作为背景信息。
 * - 端口被占用时报出原因，每隔一会儿再试；端口空出来或在设置里换一个就自动恢复。
 *
 * 地址号是随机的（不用工作流名、卡片 id 拼），换令牌时地址不变。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/hooks
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { decodeOutput } from './processes.ts'

export const HOOK_HOST = '127.0.0.1'
/** 请求体上限。 */
export const BODY_MAX_BYTES = 1024 * 1024
/** 端口开不了时隔多久再试。 */
const RETRY_MS = 30_000

/** 新的地址号与令牌。 */
export function newHookId(): string {
  return randomBytes(9).toString('base64url')
}

export function newHookToken(): string {
  return randomBytes(24).toString('base64url')
}

export function hookUrl(port: number, hook: string): string {
  return `http://${HOOK_HOST}:${String(port)}/trigger/${hook}`
}

/** 一个开着的地址：令牌、收到请求体之后交给谁。 */
export interface HookRoute {
  token: string
  accept(body: string): void
}

/** 端口的情况。 */
export type HookPortState =
  | { kind: 'closed' }
  | { kind: 'open'; port: number }
  | { kind: 'error'; port: number; problem: string }

function sameToken(given: string, expected: string): boolean {
  const digest = (text: string): Buffer => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(given), digest(expected))
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
  private port: number | undefined
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

  /** 换上这一轮开着的地址；有地址就保证端口开着（端口换了就重开），没有就关掉端口。 */
  async sync(port: number, routes: Map<string, HookRoute>): Promise<void> {
    this.routes = routes
    await this.opening
    if (routes.size === 0) {
      await this.close()
      return
    }
    if (this.server !== undefined && this.port === port) return
    if (this.server !== undefined) await this.close()
    if (this.state.kind === 'error' && this.state.port === port && this.now() < this.retryAt) return
    this.opening = this.open(port)
    await this.opening
    this.opening = undefined
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.port = undefined
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

  private open(port: number): Promise<void> {
    return new Promise((resolve) => {
      const server = createServer((request, response) => this.handle(request, response))
      server.on('error', (error: NodeJS.ErrnoException) => {
        this.retryAt = this.now() + RETRY_MS
        const problem =
          error.code === 'EADDRINUSE'
            ? `端口 ${String(port)} 被别的程序占用了，换一个端口或关掉占用它的程序`
            : error.code === 'EACCES'
              ? `没有权限使用端口 ${String(port)}`
              : `端口 ${String(port)} 开不了：${error.message}`
        this.setState({ kind: 'error', port, problem })
        resolve()
      })
      server.listen(port, HOOK_HOST, () => {
        this.server = server
        this.port = port
        this.setState({ kind: 'open', port })
        resolve()
      })
    })
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? '/', `http://${HOOK_HOST}`)
    const match = /^\/trigger\/([A-Za-z0-9_-]+)\/?$/u.exec(url.pathname)
    const route = match?.[1] === undefined ? undefined : this.routes.get(match[1])
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
    const token = tokenOf(request, url)
    if (token === undefined || !sameToken(token, route.token)) {
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
