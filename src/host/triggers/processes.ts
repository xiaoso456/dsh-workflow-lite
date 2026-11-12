/**
 * dsh-workflow-lite — 触发器在本机跑命令：跑一次等它结束（条件轮询），或常驻、一行一行读它的输出（监听程序）。
 *
 * 命令交给系统的 shell（Windows 是 cmd，其余是 sh），以 DSH 进程的身份在选定的工作区里运行，不进沙箱——
 * 打开开关前用户确认过这条命令（见 `service.ts`）。DSH 自带的 Node 所在目录排在 `PATH` 最前，
 * 脚本写 `node …` 在各系统上都能跑。结束一个命令时连同它拉起的子进程一起结束（`tail -F | grep` 这类管道）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/processes
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { basename, delimiter, dirname } from 'node:path'

/** 一行最长多少字节；再长的截成几段。 */
export const LINE_MAX_BYTES = 64 * 1024
/** 错误输出留最后多少字符（说原因用）。 */
const TAIL_CHARS = 2000
/** 结束命令后等它退出的最长时间。 */
const STOP_WAIT_MS = 5_000

export interface CommandSpec {
  command: string
  cwd: string
  /** 追加的环境变量。 */
  env?: Record<string, string>
}

/** 跑命令用的环境变量：本进程的，加上 DSH 自带 Node 的目录、追加的那些。 */
export function commandEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  // 只有宿主本身就是 node 时它的目录里才有 node（桌面版的可执行文件不是）。
  if (/^node(\.exe)?$/iu.test(basename(process.execPath))) {
    const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'
    env[key] = [dirname(process.execPath), env[key]].filter((part) => part).join(delimiter)
  }
  return env
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const lenient = new TextDecoder('utf-8')
/** Windows 的 cmd 自己报的错按本地代码页（中文系统多是 GBK）写，不是 UTF-8。 */
const local = ((): TextDecoder | undefined => {
  if (process.platform !== 'win32') return undefined
  try {
    return new TextDecoder('gb18030')
  } catch {
    return undefined
  }
})()

/** 一段输出转成文字：先当 UTF-8，不是的话 Windows 下按本地代码页。 */
export function decodeOutput(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes)
  } catch {
    return (local ?? lenient).decode(bytes)
  }
}

/** cmd 找不到命令时的那句话（中文、英文系统）。 */
const CMD_NOT_FOUND = /不是内部或外部命令|is not recognized as an internal or external command/u

/**
 * 找不到命令：sh 退出码 127；cmd 直接跑是退出码 1 加一句「不是内部或外部命令」（批处理里是 9009）。
 * @param errors 错误输出的最后一截。
 */
function notFound(code: number | null, errors: string): boolean {
  if (code === 127 || code === 9009) return true
  return process.platform === 'win32' && code === 1 && CMD_NOT_FOUND.test(errors)
}

function launch(spec: CommandSpec): ChildProcess {
  return spawn(spec.command, {
    cwd: spec.cwd,
    env: commandEnv(spec.env),
    shell: true,
    windowsHide: true,
    // POSIX 下自成一个进程组，结束时整组一起结束。
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** 结束命令连同它拉起的子进程。 */
function killTree(child: ChildProcess): void {
  const { pid } = child
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => child.kill())
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // 已经退出了。
    }
  }, 3_000).unref()
}

/** 只留最后一截的文字（错误输出、最近的输出）。 */
class Tail {
  private text = ''
  constructor(private readonly max: number) {}
  push(chunk: string): void {
    this.text = (this.text + chunk).slice(-this.max)
  }
  toString(): string {
    return this.text.trim()
  }
}

/** 按行切字节流：一行解码一次（多字节字符不会被切开），过长的行切成几段。 */
class LineSplitter {
  private pending: Buffer[] = []
  private size = 0
  constructor(private readonly emit: (line: string) => void) {}

  push(chunk: Buffer): void {
    let rest = chunk
    for (let at = rest.indexOf(0x0a); at !== -1; at = rest.indexOf(0x0a)) {
      this.pending.push(rest.subarray(0, at))
      this.flush()
      rest = rest.subarray(at + 1)
    }
    if (rest.length === 0) return
    this.pending.push(rest)
    this.size += rest.length
    if (this.size >= LINE_MAX_BYTES) this.flush()
  }

  /** 把攒着的半行当一行交出去。 */
  flush(): void {
    if (this.pending.length === 0) return
    const line = decodeOutput(Buffer.concat(this.pending)).replace(/\r$/u, '')
    this.pending = []
    this.size = 0
    this.emit(line)
  }
}

// ── 跑一次 ─────────────────────────────────────────────────────

export interface RunResult {
  /** 退出码；没跑起来、超时被结束时是 `null`。 */
  code: number | null
  /** 标准输出（超过上限的部分丢掉）。 */
  output: string
  /** 错误输出的最后一截。 */
  errors: string
  /** 命令没跑成（启动不了、找不到命令、超时）的原因；跑完了（不论退出码）是 `undefined`。 */
  failure?: string
}

/** 跑一次命令、等它结束。 */
export function runCommand(
  spec: CommandSpec,
  limits: { timeoutMs: number; maxBytes: number },
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = launch(spec)
    } catch (error) {
      resolve({ code: null, output: '', errors: '', failure: `启动不了：${messageOf(error)}` })
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    const errors = new Tail(TAIL_CHARS)
    let timedOut = false
    let settled = false
    child.stdout?.on('data', (chunk: Buffer) => {
      if (size >= limits.maxBytes) return
      chunks.push(chunk.subarray(0, limits.maxBytes - size))
      size += chunk.length
    })
    child.stderr?.on('data', (chunk: Buffer) => errors.push(decodeOutput(chunk)))
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, limits.timeoutMs)
    const finish = (result: RunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.on('error', (error) => {
      finish({
        code: null,
        output: '',
        errors: errors.toString(),
        failure: `启动不了：${error.message}`,
      })
    })
    // 等输出读完（close）再算结果；子进程留着管道不放时，超时会把它们一起结束。
    child.on('close', (code) => {
      const output = decodeOutput(Buffer.concat(chunks))
      const tail = errors.toString()
      if (timedOut) {
        const seconds = Math.round(limits.timeoutMs / 1000)
        finish({ code: null, output, errors: tail, failure: `超过 ${String(seconds)} 秒没结束` })
      } else if (notFound(code, tail)) {
        finish({
          code,
          output,
          errors: tail,
          failure: `找不到命令${tail === '' ? '' : `：${tail}`}`,
        })
      } else {
        finish({ code, output, errors: tail })
      }
    })
  })
}

// ── 常驻 ───────────────────────────────────────────────────────

export interface ExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
  /** 错误输出的最后一截。 */
  errors: string
  /** 启动不了、找不到命令时的原因。 */
  failure?: string
}

export interface LiveProcess {
  readonly pid: number | undefined
  /** 结束它（连同子进程），等它真的退出。 */
  stop(): Promise<void>
}

/** 启动一个常驻命令：标准输出每一行交给 `onLine`；两路输出都交给 `onOutput`（最近的输出）；退出时 `onExit`（自己结束的不报）。 */
export function startProcess(
  spec: CommandSpec,
  handlers: {
    onLine(line: string): void
    onOutput?(text: string): void
    onExit(info: ExitInfo): void
  },
): LiveProcess {
  const errors = new Tail(TAIL_CHARS)
  let stopping = false
  let exited = false
  let child: ChildProcess
  const exitWaiters: Array<() => void> = []
  const exit = (info: ExitInfo): void => {
    if (exited) return
    exited = true
    for (const wake of exitWaiters.splice(0)) wake()
    if (!stopping) handlers.onExit(info)
  }
  try {
    child = launch(spec)
  } catch (error) {
    queueMicrotask(() =>
      exit({ code: null, signal: null, errors: '', failure: `启动不了：${messageOf(error)}` }),
    )
    return { pid: undefined, stop: async () => {} }
  }
  const lines = new LineSplitter((line) => {
    handlers.onOutput?.(`${line}\n`)
    if (line.trim() !== '') handlers.onLine(line)
  })
  child.stdout?.on('data', (chunk: Buffer) => lines.push(chunk))
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = decodeOutput(chunk)
    errors.push(text)
    handlers.onOutput?.(text)
  })
  child.on('error', (error) => {
    exit({
      code: null,
      signal: null,
      errors: errors.toString(),
      failure: `启动不了：${error.message}`,
    })
  })
  child.on('close', (code, signal) => {
    lines.flush()
    const tail = errors.toString()
    exit({
      code,
      signal,
      errors: tail,
      ...(notFound(code, tail) ? { failure: `找不到命令${tail === '' ? '' : `：${tail}`}` } : {}),
    })
  })
  return {
    pid: child.pid,
    stop: () => {
      stopping = true
      if (exited) return Promise.resolve()
      killTree(child)
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STOP_WAIT_MS)
        exitWaiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
