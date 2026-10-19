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
  /** 这份文件能用哪些程序打开；查不到回 `null`。查到的按扩展名记下，下次同类文件直接用。 */
  applications(path: string, signal: AbortSignal): Promise<readonly DesktopApp[] | null>
  /** 已经查过的同类文件的程序表（没有就 `undefined`）：菜单一打开就能先摆出来。 */
  cached(path: string): readonly DesktopApp[] | undefined
  /** 提前查一次（鼠标移到按钮上时）；已经记下或正在查就什么也不做。 */
  warm(path: string): void
  /** 用默认程序 / 指定程序打开，或在文件管理器里显示。成功回 `true`。 */
  open(path: string, how: { reveal: true } | { application?: string }): Promise<boolean>
}

/**
 * 程序表按扩展名记：系统里「哪些程序能打开 .png」与是哪个 .png 无关，而每次去问都要走一趟宿主、
 * 再让系统枚举注册表 / 取图标，慢。没有扩展名的文件（Makefile、目录）按完整路径记。
 */
function kindKey(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : `path:${path}`
}

export function createDesktop(): Desktop & {
  attach(remote: SessionRemote): void
  detach(): void
} {
  let remote: SessionRemote | null = null
  let probe: Promise<boolean> | null = null
  let known = new Map<string, readonly DesktopApp[]>()
  let pending = new Map<string, Promise<readonly DesktopApp[] | null>>()
  const reset = (): void => {
    probe = null
    known = new Map()
    pending = new Map()
  }
  return {
    attach(next) {
      remote = next
      reset()
    },
    detach() {
      remote = null
      reset()
    },
    cached(path) {
      return known.get(kindKey(path))
    },
    warm(path) {
      if (known.has(kindKey(path))) return
      void this.applications(path, new AbortController().signal)
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
    applications(path) {
      const current = remote
      if (current === null) return Promise.resolve(null)
      const key = kindKey(path)
      // 同类文件正在查就并进去，不重复问；查询本身不跟着某一个调用方取消（别人还要用它的结果）。
      let task = pending.get(key)
      if (task === undefined) {
        const table = pending
        task = current.workspacePathApplications({ path }).then(
          (result) => {
            if (!result.ok) return null
            if (remote === current) known.set(key, result.value)
            return result.value
          },
          () => null,
        )
        table.set(key, task)
        void task.finally(() => {
          if (table.get(key) === task) table.delete(key)
        })
      }
      return task
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
