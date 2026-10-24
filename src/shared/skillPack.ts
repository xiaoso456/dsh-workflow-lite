/**
 * dsh-workflow-lite — 把一个工作流导出成 skill：包的布局、名字规矩、SKILL.md 头部与线格式。
 *
 * 软工作流编译出来的本来就是一份提示词（派发计划 + 每步一份任务描述），所以一个版本可以原样落成 skill，
 * 别人不装插件也能用：
 *
 * ```
 * <skill 名>/
 * ├─ SKILL.md          头部（name / description / whenToUse）+ 派发计划（skill 口径）
 * ├─ steps/<id>.md     各步骤的任务描述
 * ├─ assets/…          资料目录 + 打包的只读文件、文件夹
 * └─ skills/<名>/…     打包的被引用 skill（整个目录，当文件读，不靠 skill 工具发现）
 * ```
 *
 * 包里的东西在计划里一律写成 `{skill}/…`（变量见 `pathVars.ts`）：宿主加载 skill 时会让模型「相对路径按
 * skill 目录解析」，而计划里的产出路径是相对工作区的，两种都写成相对路径就分不清了。
 *
 * 纯类型与纯函数，不碰磁盘、不 import DSH 包。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/skillPack
 */

import { skillPath } from './pathVars.ts'
import type { ValidationProblem } from './types.ts'
import type { RunFileResponse } from './wire.ts'

/** 包里各块的位置（相对 skill 目录）。 */
export const SKILL_PATHS = {
  doc: 'SKILL.md',
  step: (id: string) => `steps/${id}.md`,
  asset: (path: string) => `assets/${path}`,
  skill: (name: string, path: string) => `skills/${name}/${path}`,
  memory: (id: string, path: string) => `memory/${id}/${path}`,
} as const

/** 资料目录在 skill 里的位置（`{workflow}/…` 换成它）。 */
export const SKILL_ASSETS = skillPath('assets')

/** 记忆库在 skill 里的位置（`{memory}/…` 换成它）：引用的记忆各一个文件夹，执行时就地攒。 */
export const SKILL_MEMORY = skillPath('memory')

/** skill 名的上限（字数）。 */
export const SKILL_NAME_MAX = 64

/** 描述、使用时机的上限（字数）。 */
export const SKILL_TEXT_MAX = 1024

/** DSH 认的 skill 名：小写字母、数字，用 `-` 连接（和 `@deepseek-ai/dsh-skill` 的规矩一致）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export type SkillNameProblem = 'empty' | 'format' | 'long'

/** skill 名合不合规矩；合规矩回 `null`。 */
export function checkSkillName(name: string): SkillNameProblem | null {
  if (name === '') return 'empty'
  if ([...name].length > SKILL_NAME_MAX) return 'long'
  return SKILL_NAME.test(name) ? null : 'format'
}

/** 从工作流名猜一个 skill 名：转小写、别的字符换成 `-`；猜不出来（比如全是中文）就是空串。 */
export function suggestSkillName(workflow: string): string {
  const name = workflow
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, SKILL_NAME_MAX)
    .replace(/-+$/u, '')
  return checkSkillName(name) === null ? name : ''
}

/** SKILL.md 头部的几项。 */
export interface SkillMeta {
  name: string
  description: string
  /** DSH 认的 `whenToUse`（可选）。 */
  whenToUse?: string
}

export type SkillMetaProblem =
  | { field: 'name'; problem: SkillNameProblem }
  | { field: 'description'; problem: 'empty' | 'long' }
  | { field: 'whenToUse'; problem: 'long' }

/** 头部的几项合不合规矩（第一个问题；都合规矩回 `null`）。 */
export function checkSkillMeta(meta: SkillMeta): SkillMetaProblem | null {
  const name = checkSkillName(meta.name)
  if (name !== null) return { field: 'name', problem: name }
  const description = meta.description.trim()
  if (description === '') return { field: 'description', problem: 'empty' }
  if ([...description].length > SKILL_TEXT_MAX) return { field: 'description', problem: 'long' }
  if ([...(meta.whenToUse?.trim() ?? '')].length > SKILL_TEXT_MAX) {
    return { field: 'whenToUse', problem: 'long' }
  }
  return null
}

/**
 * 整份 SKILL.md：头部 + 标题（skill 名）+ 正文。字符串值用 JSON 的双引号写法（也是合法的 YAML），
 * 换行、引号、冒号都不用另外操心；`whenToUse` 空着就不写。正文的各段是二级标题，上面压一个一级标题。
 */
export function skillDoc(meta: SkillMeta, body: string): string {
  const when = meta.whenToUse?.trim() ?? ''
  const head = [
    '---',
    `name: ${meta.name}`,
    `description: ${JSON.stringify(meta.description.trim())}`,
    ...(when === '' ? [] : [`whenToUse: ${JSON.stringify(when)}`]),
    '---',
  ]
  return `${head.join('\n')}\n\n# ${meta.name}\n\n${body}`
}

// ─────────────────────────────────────────────────────────────
// 线格式（`pack/skill*`）
// ─────────────────────────────────────────────────────────────

/** 导出成 skill 的那个版本、要打包的项（`PackScanItem.key`）。 */
export interface SkillBuildRequest {
  /** 工作流名。 */
  name: string
  /** 版本号（skill 是一份快照，只带一个版本）。 */
  version: number
  pack: string[]
  cwd?: string
  session?: string
}

/** 本机上已有的 skill（换名、覆盖时比对用）。 */
export interface SkillExisting {
  name: string
  /** 它的目录（内置的没有）。 */
  path?: string
  /** 在 `~/.agents/skills` 里：装到本机时可以覆盖。 */
  overwritable: boolean
}

export interface SkillPreviewResponse {
  /** SKILL.md 的正文（不含头部；头部按用户填的名字、描述在前端拼）。有编译级问题时为空串。 */
  body: string
  /** 编译级问题（有就导不出来）。 */
  problems: ValidationProblem[]
  /** 步骤的名字（按执行批次）：预填描述用。 */
  steps: string[]
  /** 包里的文件数、字节数（不含 SKILL.md）。 */
  files: number
  bytes: number
  /** 这张图开了「记录运行状态」：skill 里不带。 */
  runState: boolean
  /** 步骤会改写的资料目录文件（在 skill 里，执行时会改到 skill 目录里）。 */
  writtenAssets: string[]
  /** 不在包里、要在本机装好的 skill。 */
  needs: string[]
  /** 按绝对路径引用、没打进包的文件和文件夹。 */
  absolute: string[]
  /** 绝对路径的产出根目录。 */
  roots: string[]
  /** `~/.agents/skills`。 */
  skillsRoot: string
  /** 本机已有的 skill（名字撞了提示一句；装到本机时决定能不能覆盖）。 */
  existing: SkillExisting[]
  /**
   * 整个包在暂存区里摆了一份（`pack/skillDir` / `pack/skillFile` / `pack/skillImage` 按它看，
   * 用完 `pack/discard`）。有编译级问题时没有。
   */
  browse?: string
}

/**
 * `pack/skillDir`、`pack/skillFile`：看暂存的包里的一层、一份。`sub` 是相对包根的路径（`/` 分隔，只许往下走）。
 * 给了 `meta` 就先按它重写包根的 SKILL.md（头部是前端现填的），再读。
 */
export interface SkillBrowseRequest {
  token: string
  sub?: string
  meta?: SkillMeta
}

/** `pack/skillImage`：包里的一张图；`src` 是 Markdown 里引用的相对路径（按文档所在目录解析），不给就是 `sub` 自己。 */
export interface SkillImageRequest extends SkillBrowseRequest {
  src?: string
}

/**
 * 包里的一份文件（同 `run/file`）。Markdown 开头有 YAML 头部（`---` … `---`）时，`head` 是解析出来的键值、
 * `content` 是去掉头部的正文：预览时头部单独列出来，不当正文排版。
 */
export interface SkillFileResponse extends RunFileResponse {
  head?: Record<string, unknown>
  content?: string
}

export interface SkillExportRequest extends SkillBuildRequest {
  meta: SkillMeta
  /** `zip`：打成 zip 交给浏览器下载；`install`：直接装到 `~/.agents/skills/<名>`。 */
  target: 'zip' | 'install'
  /** 装到本机时，同名的已经在了：覆盖它。不给就报 `conflict`。 */
  replace?: boolean
}

export interface SkillExportResponse {
  /** `zip`：暂存编号、字节数、文件名（同 `pack/export`，走 `pack/read` 取回来）。 */
  token?: string
  bytes: number
  fileName?: string
  /** `install`：装到了哪（绝对路径）。 */
  path?: string
}
