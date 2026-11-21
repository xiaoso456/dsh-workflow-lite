/**
 * dsh-workflow-lite — 结束一条命令连同它拉起的子进程（`tail -F | grep` 这类管道、shell 里跑的脚本）。
 *
 * POSIX：命令自成一个进程组（启动时 `detached`），整组先 SIGTERM、3 秒后 SIGKILL。
 * Windows：`taskkill /T /F` 按父子关系结束整棵树。shell 刚启动、正拉起程序的那一下被结束时，
 * taskkill 记下的树里还没有那个程序，它随后起来、父进程已经没了，就留在了后台。
 * 所以 taskkill 之后再查一遍：父进程是这个 shell、在 shell 启动之后到结束之前起来的，一并结束
 * （按时间卡住，pid 被别的进程复用了也不会误伤）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/processTree
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { windowsPowerShell } from './shells.ts'

/** POSIX 上 SIGTERM 之后等多久改发 SIGKILL。 */
const KILL_GRACE_MS = 3_000
/** Windows 上查漏掉的进程最多等多久（PowerShell 起来要一两秒）。 */
const SWEEP_TIMEOUT_MS = 15_000
/** 进程表里的创建时刻和这边记的时刻之间留的余量。 */
const CLOCK_SLACK_MS = 1_000

/**
 * 结束命令连同它拉起的子进程。命令自己已经退出了就不动。
 * @param startedAt 启动命令的时刻（Windows 上据此认出漏掉的子进程）。
 * @returns Windows 上查完漏掉的进程后完成；POSIX 上发完信号就完成。
 */
export async function killTree(child: ChildProcess, startedAt: number): Promise<void> {
  const { pid } = child
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform !== 'win32') {
    killGroup(child, pid)
    return
  }
  const ok = await taskkill(pid)
  if (!ok) child.kill()
  const endedAt = Date.now()
  for (const orphan of await childrenOf(pid)) {
    if (
      orphan.createdAt < startedAt - CLOCK_SLACK_MS ||
      orphan.createdAt > endedAt + CLOCK_SLACK_MS
    ) {
      continue
    }
    await taskkill(orphan.pid)
  }
}

function killGroup(child: ChildProcess, pid: number): void {
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
  }, KILL_GRACE_MS).unref()
}

/** `taskkill /T /F` 结束一棵树，等它跑完；跑不起来时是 `false`。 */
function taskkill(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.on('error', () => resolve(false))
    killer.on('close', () => resolve(true))
  })
}

/** 父进程记的是这个 pid 的进程：pid 和创建时刻（毫秒）。查不了时是空的。 */
function childrenOf(pid: number): Promise<{ pid: number; createdAt: number }[]> {
  const script = [
    `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${String(pid)}' | ForEach-Object {`,
    `  '{0} {1}' -f $_.ProcessId, ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()`,
    '}',
  ].join('\n')
  return new Promise((resolve) => {
    let out = ''
    const query = spawn(
      windowsPowerShell(process.env),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: SWEEP_TIMEOUT_MS },
    )
    query.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    query.on('error', () => resolve([]))
    query.on('close', () => {
      const found: { pid: number; createdAt: number }[] = []
      for (const line of out.split(/\r?\n/u)) {
        const [id, created] = line.trim().split(' ').map(Number)
        if (Number.isInteger(id) && Number.isFinite(created)) {
          found.push({ pid: id as number, createdAt: created as number })
        }
      }
      resolve(found)
    })
  })
}
