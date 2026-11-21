/**
 * dsh-workflow-lite — 触发器跑命令用的 shell：本机有哪些（{@link detectShells}）、一个程序认不认得（{@link checkShell}）、
 * 各类 shell 怎么接一条命令（{@link shellLaunch}）。
 *
 * 三类，按程序名认：
 * - `cmd`：`cmd /d /s /c "命令"`，和 Node 的 `shell: true` 在 Windows 上一样；
 * - `powershell`（Windows PowerShell、PowerShell 7）：整段脚本作为 `-Command` 的一个参数交过去（Node 按 Windows 的规则加引号、转义）。
 *   不用 `-EncodedCommand`：那样 Windows PowerShell 把错误输出写成 CLIXML（一堆 XML），找不到命令也认不出来。
 *   脚本前面让输出走 UTF-8、关掉进度条和颜色，后面按最后一条命令的结果退出（原生程序的退出码原样带出来，cmdlet 失败是 1）；
 * - `posix`（sh、bash、zsh…，Windows 上的 Git Bash 也是）：`shell -c 命令`。
 * 没选、也没设默认时用系统的（Windows 是 `ComSpec` 指的 cmd，别处是 `/bin/sh`），和以前一样。
 *
 * 只列出能直接跑的：WSL 的 `bash.exe` 进的是 Linux，路径对不上，不列（自己选了照样能用）。
 * 从 Microsoft Store 装的 PowerShell 7 只在 `WindowsApps` 里留一个别名（链接到受保护的目录）：
 * `stat` 读不了它（EACCES），但能直接运行，按「是个程序」算（{@link programKind}）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/shells
 */

import { lstat, readFile, readlink, stat } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path'
import type { ShellChoice, ShellFamily } from '../../shared/wire/trigger.ts'

const FAMILY: Record<string, ShellFamily> = {
  cmd: 'cmd',
  powershell: 'powershell',
  pwsh: 'powershell',
  sh: 'posix',
  bash: 'posix',
  zsh: 'posix',
  dash: 'posix',
  ash: 'posix',
  ksh: 'posix',
  mksh: 'posix',
  fish: 'posix',
}

/** 程序名（去掉 `.exe`，不分大小写）。 */
const stem = (path: string): string =>
  basename(path.replace(/\\/gu, '/'))
    .toLowerCase()
    .replace(/\.exe$/u, '')

/** 按程序名认是哪一类；认不出是 `null`。 */
export function familyOf(path: string): ShellFamily | null {
  return FAMILY[stem(path)] ?? null
}

/** 给人看的名字：cmd、Windows PowerShell、PowerShell、Git Bash、bash、zsh…… */
export function shellName(path: string): string {
  const name = stem(path)
  if (name === 'powershell') return 'Windows PowerShell'
  if (name === 'pwsh') return 'PowerShell 7'
  if (name === 'bash' && /[\\/]git[\\/]/iu.test(path)) return 'Git Bash'
  return name
}

/** 没选、也没设默认时用的 shell（同 Node 的 `shell: true`）。 */
export function systemShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== 'win32') return '/bin/sh'
  return env.ComSpec ?? env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe'
}

/** 实际用的是哪个、叫什么（空串是系统的）。 */
export function shellLabel(shell: string): { path: string; name: string } {
  const path = shell === '' ? systemShell() : shell
  return { path, name: shellName(path) }
}

/** 一个路径能不能当 shell 用：完整路径、是个文件、认得出是哪一类。能用回说明，不能用回一句原因。 */
export async function checkShell(path: string): Promise<ShellChoice | string> {
  if (!isAbsolute(path)) return '要写 shell 程序的完整路径'
  const family = familyOf(path)
  if (family === null) return '认不出这是哪种 shell（支持 cmd、PowerShell、sh / bash / zsh 这类）'
  const kind = await programKind(path)
  if (kind === 'missing') return '找不到这个程序'
  if (kind === 'dir') return '这个路径不是一个程序'
  return { path, name: shellName(path), family }
}

/**
 * 一个路径是程序、目录还是不在。Store 应用的别名 `stat` 读不了（指向受保护的 `WindowsApps` 目录），
 * 但它本身是个链接、能运行：算程序。
 */
async function programKind(path: string): Promise<'file' | 'dir' | 'missing'> {
  try {
    return (await stat(path)).isDirectory() ? 'dir' : 'file'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EACCES' && code !== 'EPERM') return 'missing'
    try {
      return (await lstat(path)).isSymbolicLink() ? 'file' : 'missing'
    } catch {
      return 'missing'
    }
  }
}

/** 同一个程序的几个路径（Store 别名有两处）认成一个：是链接就按它指向的地方。 */
async function identity(path: string, platform: NodeJS.Platform): Promise<string> {
  let target = path
  try {
    if ((await lstat(path)).isSymbolicLink()) target = await readlink(path)
  } catch {
    // 读不了就按路径本身。
  }
  return platform === 'win32' ? target.toLowerCase() : target
}

/** 在 `PATH` 里找一个程序。 */
async function onPath(name: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const key = Object.keys(env).find((item) => item.toUpperCase() === 'PATH') ?? 'PATH'
  for (const dir of (env[key] ?? '').split(delimiter)) {
    if (dir === '') continue
    const path = join(dir, name)
    if ((await programKind(path)) === 'file') return path
  }
  return undefined
}

/** Windows 自带的 PowerShell（5.1，各版本 Windows 都有）。 */
export function windowsPowerShell(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Windows 上可能装着的几个 shell（不一定都在）。 */
async function windowsCandidates(env: NodeJS.ProcessEnv): Promise<string[]> {
  const programs = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(
    (dir): dir is string => dir !== undefined,
  )
  const git = await onPath('git.exe', env)
  const home = env.USERPROFILE
  return [
    systemShell('win32', env),
    windowsPowerShell(env),
    // PowerShell 7：安装包装的、Microsoft Store 装的（别名）、dotnet tool、Scoop 装的，再看 PATH 里有没有别处的。
    // 同一个程序只留排在前面的那条路径（Store 的别名有两处，留短的那个）。
    ...programs.map((dir) => join(dir, 'PowerShell', '7', 'pwsh.exe')),
    ...programs.map((dir) => join(dir, 'PowerShell', '7-preview', 'pwsh.exe')),
    ...(env.LOCALAPPDATA === undefined
      ? []
      : [join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pwsh.exe')]),
    ...(home === undefined
      ? []
      : [
          join(home, '.dotnet', 'tools', 'pwsh.exe'),
          join(home, 'scoop', 'apps', 'pwsh', 'current', 'pwsh.exe'),
        ]),
    (await onPath('pwsh.exe', env)) ?? '',
    // Git 装在哪，Git Bash 就在它的 bin 里（git.exe 在 cmd 或 bin 下面）。
    ...(git === undefined ? [] : [join(dirname(dirname(git)), 'bin', 'bash.exe')]),
    ...programs.map((dir) => join(dir, 'Git', 'bin', 'bash.exe')),
    ...(env.LOCALAPPDATA === undefined
      ? []
      : [join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe')]),
  ]
}

/** 别的系统：`/bin/sh`、登录 shell、`/etc/shells` 里列的。 */
async function posixCandidates(env: NodeJS.ProcessEnv): Promise<string[]> {
  let listed: string[] = []
  try {
    listed = (await readFile('/etc/shells', 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('/'))
  } catch {
    // 没有这份清单。
  }
  return ['/bin/sh', env.SHELL ?? '', ...listed, (await onPath('pwsh', env)) ?? '']
}

/** 本机能用的 shell：系统缺省的排第一，同一个程序只列一次。 */
export async function detectShells(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ShellChoice[]> {
  const candidates =
    platform === 'win32' ? await windowsCandidates(env) : await posixCandidates(env)
  const seen = new Set<string>()
  const found: ShellChoice[] = []
  for (const path of candidates) {
    if (path === '') continue
    const key = await identity(path, platform)
    if (seen.has(key)) continue
    seen.add(key)
    const checked = await checkShell(path)
    if (typeof checked !== 'string') found.push(checked)
  }
  return found
}

/** 怎么启动：程序、参数，以及参数要不要原样交给 Windows（cmd 的引号规则和别的程序不一样）。 */
export interface ShellLaunch {
  file: string
  args: string[]
  family: ShellFamily
  verbatim: boolean
}

/**
 * PowerShell 里包住命令的那几行：输出走 UTF-8、不出进度条、PowerShell 7 的报错不带颜色控制符，
 * 跑完按最后一条命令的结果退出：成功 0；原生程序失败带出它的退出码；cmdlet 失败是 1。
 */
export function powershellScript(command: string): string {
  return [
    '$ProgressPreference = "SilentlyContinue"',
    'if ($PSStyle) { $PSStyle.OutputRendering = "PlainText" }',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    command,
    'exit $(if ($?) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 })',
  ].join('\n')
}

/** 一条命令交给 `shell`（空着是系统的）怎么启动。 */
export function shellLaunch(
  shell: string | undefined,
  command: string,
  platform: NodeJS.Platform = process.platform,
): ShellLaunch {
  const file = shell === undefined || shell === '' ? systemShell(platform) : shell
  const family = familyOf(file) ?? (platform === 'win32' ? 'cmd' : 'posix')
  if (family === 'cmd') {
    return { file, args: ['/d', '/s', '/c', `"${command}"`], family, verbatim: true }
  }
  if (family === 'powershell') {
    return {
      file,
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        powershellScript(command),
      ],
      family,
      verbatim: false,
    }
  }
  return { file, args: ['-c', command], family, verbatim: false }
}
