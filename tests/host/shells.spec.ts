/**
 * 触发器跑命令用的 shell：认程序、找本机的、各类 shell 怎么接命令，以及在本机真有的几个 shell 里各跑一遍。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCommand, startProcess } from '../../src/host/triggers/processes.ts'
import {
  checkShell,
  detectShells,
  familyOf,
  powershellScript,
  shellLaunch,
  shellName,
  systemShell,
} from '../../src/host/triggers/shells.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wl-shells-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('认 shell', () => {
  it('按程序名认是哪一类、给人看的名字', () => {
    expect(familyOf(String.raw`C:\Windows\System32\cmd.exe`)).toBe('cmd')
    expect(familyOf(String.raw`C:\Program Files\PowerShell\7\pwsh.exe`)).toBe('powershell')
    expect(familyOf('/usr/bin/zsh')).toBe('posix')
    expect(familyOf(String.raw`C:\Windows\notepad.exe`)).toBeNull()
    expect(shellName(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)).toBe(
      'Windows PowerShell',
    )
    expect(shellName(String.raw`C:\Program Files\PowerShell\7\pwsh.exe`)).toBe('PowerShell 7')
    expect(shellName(String.raw`C:\Program Files\Git\bin\bash.exe`)).toBe('Git Bash')
    expect(shellName('/bin/bash')).toBe('bash')
  })

  it('系统的：Windows 按 ComSpec，别处 /bin/sh', () => {
    expect(systemShell('linux', {})).toBe('/bin/sh')
    expect(systemShell('win32', { ComSpec: String.raw`D:\cmd.exe` })).toBe(String.raw`D:\cmd.exe`)
  })

  it('自己选的程序：要完整路径、认得出、找得到', async () => {
    const bash = join(dir, 'bash')
    await writeFile(bash, '')
    expect(await checkShell('bash')).toBe('要写 shell 程序的完整路径')
    expect(await checkShell(join(dir, 'notepad.exe'))).toContain('认不出')
    expect(await checkShell(join(dir, 'zsh'))).toBe('找不到这个程序')
    await mkdir(join(dir, 'sh'))
    expect(await checkShell(join(dir, 'sh'))).toBe('这个路径不是一个程序')
    expect(await checkShell(bash)).toEqual({ path: bash, name: 'bash', family: 'posix' })
  })

  it('找本机的：只列在的，同一个只列一次，系统的排第一', async () => {
    const root = join(dir, 'Windows')
    const ps = join(root, 'System32', 'WindowsPowerShell', 'v1.0')
    const git = join(dir, 'Git')
    await mkdir(ps, { recursive: true })
    await mkdir(join(git, 'cmd'), { recursive: true })
    await mkdir(join(git, 'bin'), { recursive: true })
    const cmd = join(root, 'System32', 'cmd.exe')
    await writeFile(cmd, '')
    await writeFile(join(ps, 'powershell.exe'), '')
    await writeFile(join(git, 'cmd', 'git.exe'), '')
    await writeFile(join(git, 'bin', 'bash.exe'), '')
    const found = await detectShells('win32', {
      ComSpec: cmd,
      SystemRoot: root,
      // 同一个目录写两遍、大小写不同：只列一次。
      Path: [join(git, 'cmd'), join(git, 'CMD')].join(process.platform === 'win32' ? ';' : ':'),
      ProgramFiles: dir,
    })
    expect(found.map((shell) => shell.name)).toEqual(['cmd', 'Windows PowerShell', 'Git Bash'])
  })
})

describe('各类 shell 怎么接命令', () => {
  it('cmd：/d /s /c 加引号、原样交给 Windows', () => {
    expect(shellLaunch(undefined, 'echo hi', 'win32')).toMatchObject({
      args: ['/d', '/s', '/c', '"echo hi"'],
      family: 'cmd',
      verbatim: true,
    })
  })

  it('PowerShell：整段脚本作为 -Command 的一个参数，带上退出码那一行', () => {
    const launch = shellLaunch(String.raw`C:\pwsh.exe`, 'git status', 'win32')
    expect(launch.family).toBe('powershell')
    expect(launch.verbatim).toBe(false)
    expect(launch.args.at(-2)).toBe('-Command')
    expect(launch.args.at(-1)).toBe(powershellScript('git status'))
    expect(powershellScript('x')).toContain('$LASTEXITCODE')
  })

  it('sh 一类：-c 命令；没选时别处用 /bin/sh', () => {
    expect(shellLaunch('/bin/zsh', 'echo $HOME', 'linux')).toEqual({
      file: '/bin/zsh',
      args: ['-c', 'echo $HOME'],
      family: 'posix',
      verbatim: false,
    })
    expect(shellLaunch('', 'ls', 'darwin').file).toBe('/bin/sh')
  })
})

/** 输出按行切开；本机的 node 可能往错误输出打警告（代理之类），只留命令自己打的。 */
const ownLines = (text: string): string[] =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('(node:') && !line.startsWith('(Use '))

/** 各类 shell 里打出「中文 」加环境变量的写法。 */
const ECHO = {
  cmd: 'echo 中文 %WL_TEST%',
  powershell: 'Write-Output "中文 $env:WL_TEST"',
  posix: 'echo "中文 $WL_TEST"',
} as const

describe('在本机的各个 shell 里跑', async () => {
  const shells = await detectShells()
  const cwd = process.cwd()
  const limits = { timeoutMs: 20_000, maxBytes: 4096 }

  it.each(shells.map((shell) => [shell.name, shell] as const))(
    '%s：中文输出、环境变量、退出码、找不到命令、模板里那种 node -e',
    async (_name, shell) => {
      const base = { cwd, shell: shell.path, env: { WL_TEST: '变量' } }
      const echo = await runCommand({ ...base, command: ECHO[shell.family] }, limits)
      expect(echo.code).toBe(0)
      expect(ownLines(echo.output)).toEqual(['中文 变量'])

      const exited = await runCommand({ ...base, command: 'node -e "process.exit(3)"' }, limits)
      expect(exited.code).toBe(3)
      expect(exited.failure).toBeUndefined()

      const missing = await runCommand({ ...base, command: 'no-such-command-wl-test' }, limits)
      expect(missing.failure).toContain('找不到命令')
      // 报错是给人看的字：不是 CLIXML、不带颜色控制符。
      expect(missing.failure).not.toContain('CLIXML')
      expect(missing.failure).not.toContain('\u001b[')

      if (shell.family === 'powershell') {
        // 命令里的引号、反斜杠（含结尾的反斜杠）原样到 PowerShell 手里。
        const tricky = await runCommand(
          { ...base, command: String.raw`Write-Output 'a "b" \c\'; Write-Output "x\\"` },
          limits,
        )
        expect(ownLines(tricky.output)).toEqual(['a "b" \\c\\', 'x\\\\'])
      }

      const quoted = await runCommand(
        { ...base, command: "node -e \"console.log(['a b', 1 + 1].join('|'))\"" },
        limits,
      )
      expect(ownLines(quoted.output)).toEqual(['a b|2'])
    },
    60_000,
  )

  it.each(shells.map((shell) => [shell.name, shell] as const))(
    '%s：常驻的一行一行交出来、结束时连子进程一起结束',
    async (_name, shell) => {
      const lines: string[] = []
      const live = startProcess(
        {
          cwd,
          shell: shell.path,
          command: 'node -e "console.log(\'一\');setInterval(() => {}, 1000)"',
        },
        { onLine: (line) => lines.push(line), onExit: () => {} },
      )
      for (let wait = 0; wait < 150 && !lines.includes('一'); wait += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(lines).toContain('一')
      await live.stop()
    },
    60_000,
  )
})
