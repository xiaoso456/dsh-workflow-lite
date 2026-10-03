/**
 * dsh-workflow-lite — 主机上的东西：资源节点「选文件 / 选文件夹 / 选 Skill」时列给画布看。
 *
 * - {@link listHostDir}：列一个目录里有什么（只给名字和是不是目录，**不读内容**），外加几个可以跳去的根；
 * - {@link listSkills}：会话里的 agent 能用的 skill（只列模型能用的）；{@link readSkill}：读一个的全文。
 *
 * 只读。画布那头是本机用户自己在选路径，选中的路径原样进图，执行时由模型自己去读。
 *
 * @module @xiaoso/dsh-workflow-lite/host/hostFs
 */

import type { Dirent } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type {
  HostListEntry,
  HostListResponse,
  HostSkillResponse,
  HostSkillsResponse,
} from '../shared/wire.ts'
import type { Outcome } from './store/repository.ts'

/** 一个目录最多列多少项（再多前端也没法一眼扫完，改用路径栏直接输入）。 */
const MAX_ENTRIES = 3000

/** 分隔符统一成 `/`（和图里其它路径一个写法）。 */
function slash(path: string): string {
  return path.replace(/\\/gu, '/')
}

/** Windows 上实际存在的盘符。 */
async function drives(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const found = await Promise.all(
    letters.map(async (letter) => {
      try {
        await access(`${letter}:\\`)
        return `${letter}:/`
      } catch {
        return null
      }
    }),
  )
  return found.filter((drive): drive is string => drive !== null)
}

/**
 * 列一个目录。`path` 缺省 = `cwd`（会话的工作区），再缺省 = 用户主目录；相对路径按 `cwd` 解析。
 */
export async function listHostDir(request: {
  path?: string
  cwd?: string
}): Promise<Outcome<HostListResponse>> {
  const base = request.cwd ?? homedir()
  const wanted = request.path?.trim()
  const full = resolve(base, wanted === undefined || wanted === '' ? base : wanted)
  let names: Dirent[]
  try {
    names = await readdir(full, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return {
      ok: false,
      error:
        code === 'ENOENT'
          ? { code: 'not_found', message: `目录不存在：${slash(full)}` }
          : code === 'ENOTDIR'
            ? { code: 'invalid_args', message: `不是目录：${slash(full)}` }
            : { code: 'io_error', message: `读不了 ${slash(full)}：${String(code ?? error)}` },
    }
  }
  const entries: HostListEntry[] = []
  for (const entry of names.slice(0, MAX_ENTRIES)) {
    let dir = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      try {
        dir = (await stat(resolve(full, entry.name))).isDirectory()
      } catch {
        continue
      }
    }
    entries.push({ name: entry.name, dir })
  }
  entries.sort((a, b) =>
    a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1,
  )
  const parent = dirname(full)
  const places: { label: string; path: string }[] = []
  if (request.cwd !== undefined) places.push({ label: 'workspace', path: slash(request.cwd) })
  places.push({ label: 'home', path: slash(homedir()) })
  for (const drive of await drives()) places.push({ label: drive.slice(0, 2), path: drive })
  return {
    ok: true,
    result: {
      path: slash(full),
      parent: parent === full ? null : slash(parent),
      entries,
      truncated: names.length > MAX_ENTRIES,
      places,
    },
  }
}

/** 一条 skill 的摘要（`ctx.skills.list()` 给的那几样）。 */
interface SkillSummaryLike {
  name: string
  description: string
  source: string
  /** SKILL.md 的绝对路径；插件运行时注册的 skill 没有。 */
  path?: string
  whenToUse?: string
  invocation: { modelInvocable: boolean }
}

/** 读 skill 时的作用域与工作区（`scope` 是 DSH 的不透明作用域键）。 */
interface SkillLookup {
  cwd?: string
  scope?: object
}

/** `ctx.skills` 用到的那一点（只借形状，不 import 运行时）。 */
export interface SkillLister {
  list(options: SkillLookup): Promise<readonly SkillSummaryLike[]>
  get(
    name: string,
    options: SkillLookup,
  ): Promise<(SkillSummaryLike & { content: string }) | undefined>
}

/**
 * 以谁的眼光看 skill：DSH 的本地 skill（项目的 `.dsh/skills`、`~/.agents/skills`…）是挂在
 * **agent 预设**底下的，只有带上那个预设的作用域才读得到；不带作用域只剩全局那一层（内置的、
 * 插件注册的）。读完调 `release` 还回作用域。
 */
export interface SkillView {
  skills: SkillLister
  scope?: object
  release?: () => Promise<void>
}

/** 给一个会话（可以不给）找出看 skill 的视角；没装 skill 服务回 `undefined`。 */
export type SkillViewer = (session: string | undefined) => Promise<SkillView | undefined>

async function withView<R>(
  viewer: SkillViewer | undefined,
  session: string | undefined,
  read: (view: SkillView | undefined) => Promise<R>,
): Promise<R> {
  const view = viewer === undefined ? undefined : await viewer(session)
  try {
    return await read(view)
  } finally {
    await view?.release?.()
  }
}

function lookup(view: SkillView, cwd: string | undefined): SkillLookup {
  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(view.scope === undefined ? {} : { scope: view.scope }),
  }
}

/**
 * 会话里的 agent 能用的 skill（只列模型能用的，执行时是模型去加载它们）；没装 skill 服务就是空的。
 */
export async function listSkills(
  viewer: SkillViewer | undefined,
  request: { cwd?: string; session?: string },
): Promise<HostSkillsResponse> {
  return withView(viewer, request.session, async (view) => {
    if (view === undefined) return { skills: [], available: false }
    const list = await view.skills.list(lookup(view, request.cwd))
    return {
      available: true,
      skills: list
        .filter((skill) => skill.invocation.modelInvocable)
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          source: skill.source,
          ...(skill.path === undefined ? {} : { path: slash(skill.path) }),
        })),
    }
  })
}

/** 读一个 skill 的全文（SKILL.md 去掉头部元数据后的正文），给画布预览。 */
export async function readSkill(
  viewer: SkillViewer | undefined,
  request: { name: string; cwd?: string; session?: string },
): Promise<Outcome<HostSkillResponse>> {
  return withView(viewer, request.session, async (view) => {
    if (view === undefined) {
      return { ok: false, error: { code: 'blocked', message: '这个 DSH 没装 skill 服务' } }
    }
    const skill = await view.skills.get(request.name, lookup(view, request.cwd))
    if (skill === undefined) {
      return {
        ok: false,
        error: { code: 'not_found', message: `DSH 认不出 skill「${request.name}」` },
      }
    }
    return {
      ok: true,
      result: {
        name: skill.name,
        description: skill.description,
        source: skill.source,
        ...(skill.path === undefined ? {} : { path: slash(skill.path) }),
        ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
        content: skill.content,
      },
    }
  })
}
