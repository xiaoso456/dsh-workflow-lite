/**
 * dsh-workflow-lite — 用系统里的程序打开文件（和 DSH 文档预览右上角那个按钮同一套能力）。
 *
 * 借宿主的 Session Remote：`canOpenWorkspacePath`（这台宿主有没有桌面）、
 * `workspacePathApplications`（这类文件注册了哪些程序、哪个是默认）、`openWorkspacePath`
 * （用某个程序打开，或在文件管理器里显示）。服务可选：没接上就不显示「用其他程序打开」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/desktop
 */

/** 能打开这份文件的一个程序。 */
export interface DesktopApp {
  id: string
  name: string
  default: boolean
  /** PNG / SVG 的 data URL；系统没给图标时为 `null`。 */
  icon: string | null
}

type RemoteResult<T> = { ok: true; value: T } | { ok: false }

/** `ctx.remote.session` 用到的部分。 */
export interface SessionRemote {
  canOpenWorkspacePath(): Promise<RemoteResult<boolean>>
  workspacePathApplications(
    request: { path: string },
    signal?: AbortSignal,
  ): Promise<RemoteResult<readonly DesktopApp[]>>
  openWorkspacePath(request: {
    path: string
    action?: 'reveal'
    application?: string
  }): Promise<RemoteResult<unknown>>
}

export interface Desktop {
  /** 宿主能不能把文件交给系统程序（一页只问一次）。 */
  available(): Promise<boolean>
  /** 这份文件能用哪些程序打开；查不到回 `null`。 */
  applications(path: string, signal: AbortSignal): Promise<readonly DesktopApp[] | null>
  /** 用默认程序 / 指定程序打开，或在文件管理器里显示。成功回 `true`。 */
  open(path: string, how: { reveal: true } | { application?: string }): Promise<boolean>
}

export function createDesktop(): Desktop & {
  attach(remote: SessionRemote): void
  detach(): void
} {
  let remote: SessionRemote | null = null
  let probe: Promise<boolean> | null = null
  return {
    attach(next) {
      remote = next
      probe = null
    },
    detach() {
      remote = null
      probe = null
    },
    available() {
      const current = remote
      if (current === null) return Promise.resolve(false)
      probe ??= current.canOpenWorkspacePath().then(
        (result) => result.ok && result.value,
        () => false,
      )
      return probe
    },
    async applications(path, signal) {
      if (remote === null) return null
      try {
        const result = await remote.workspacePathApplications({ path }, signal)
        return result.ok ? result.value : null
      } catch {
        return null
      }
    },
    async open(path, how) {
      if (remote === null) return false
      const request =
        'reveal' in how
          ? { path, action: 'reveal' as const }
          : { path, ...(how.application === undefined ? {} : { application: how.application }) }
      try {
        return (await remote.openWorkspacePath(request)).ok
      } catch {
        return false
      }
    },
  }
}
