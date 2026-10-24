/**
 * dsh-workflow-lite — 路径变量：路径里 `{…}` 的写法。
 *
 * | 变量 | 写在哪 | 换成什么 |
 * |---|---|---|
 * | `{workflow}` | 资源里文件、文件夹路径的开头 | 工作流自己的目录（`<dataDir>/assets/<图名>/`）；导出成 skill 时换成 `{skill}/assets` |
 * | `{memory}` | 记忆卡那一项的开头（`{memory}/<记忆 id>`，插件写，用户不改） | 插件的记忆库（`<dataDir>/memories/`）；导出成 skill 时换成 `{skill}/memory` |
 * | `{instance}` | 产出根目录、状态文件路径里任意位置 | 实例 id：插件建实例时换；通用口径（skill）由执行者自己取 |
 * | `{skill}` | 导出成 skill 时计划里包内路径的开头 | 加载 skill 时宿主给出的目录：执行者自己换，插件不换 |
 *
 * 认、拼、取相对部分、换成实际值都**只在这里做**，旧写法（`{assets}` → `{workflow}`）的兼容也在这里。
 * 别处不写变量的字面量、不切字符串、不 split / join；讲给模型或用户的句子里要提变量，也用这里的常量拼。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/pathVars
 */

import { join, normalize } from 'pathe'

/** 路径开头是 `token`：变量本身，或后面跟分隔符。 */
function leads(path: string, token: string): boolean {
  const value = path.trim()
  return value === token || value.startsWith(`${token}/`) || value.startsWith(`${token}\\`)
}

/** 去掉开头 `length` 个字符和紧跟的分隔符，规范化；只剩自己时回空串。 */
function restAfter(path: string, length: number): string {
  const rest = path
    .trim()
    .slice(length)
    .replace(/^[/\\]+/u, '')
  return normalize(rest).replace(/^\.$/u, '')
}

/** `token` 下的一个路径（`a/b.md` → `{token}/a/b.md`；空串 → 变量本身），规范化。 */
function under(token: string, relative: string): string {
  const rest = restAfter(relative, 0)
  return rest === '' ? token : `${token}/${rest}`
}

// ── {workflow}：工作流目录 ─────────────────────────────────────────

/** 工作流目录的变量。 */
export const WORKFLOW_VAR = '{workflow}'

/** 旧写法（0.4.0 – 0.6.0）：照样认，读图时改写成 {@link WORKFLOW_VAR}。 */
const LEGACY_WORKFLOW_VARS = ['{assets}'] as const

/** 路径开头是哪个工作流目录的变量（新写法或旧写法）；都不是就回 `undefined`。 */
function workflowVarOf(path: string): string | undefined {
  return [WORKFLOW_VAR, ...LEGACY_WORKFLOW_VARS].find((token) => leads(path, token))
}

/** 这个路径是不是写在工作流目录里（`{workflow}` 本身或 `{workflow}/…`；旧写法也算）。 */
export function isWorkflowPath(path: string): boolean {
  return workflowVarOf(path) !== undefined
}

/** 工作流目录里的路径去掉变量之后的那一截（`{workflow}/a//b.md` → `a/b.md`；`{workflow}` → 空串）。 */
export function workflowRelative(path: string): string {
  return restAfter(path, workflowVarOf(path)?.length ?? 0)
}

/** 工作流目录里的一个路径（`a/b.md` → `{workflow}/a/b.md`；空串 → `{workflow}`）。 */
export function workflowPath(relative: string): string {
  return under(WORKFLOW_VAR, relative)
}

/** 旧写法 `{assets}/…` 换成 `{workflow}/…`（只换开头的变量，后面原样）；别的路径原样返回。 */
export function upgradeWorkflowPath(path: string): string {
  const token = workflowVarOf(path)
  if (token === undefined || token === WORKFLOW_VAR) return path
  return `${WORKFLOW_VAR}${path.trim().slice(token.length)}`
}

/** 把 `{workflow}/…` 换成 `dir` 下的路径（`dir` 是绝对路径，或导出成 skill 时的 `{skill}/assets`）；别的路径原样返回。 */
export function bindWorkflowPath(path: string, dir: string): string {
  if (!isWorkflowPath(path)) return path
  const rest = workflowRelative(path)
  return rest === '' ? normalize(dir) : join(normalize(dir), rest)
}

// ── {memory}：记忆库 ────────────────────────────────────────────

/** 记忆库的变量。 */
export const MEMORY_VAR = '{memory}'

/** 这个路径是不是写在记忆库里（`{memory}` 本身或 `{memory}/…`）。 */
export function isMemoryPath(path: string): boolean {
  return leads(path, MEMORY_VAR)
}

/** 记忆库里一条记忆的文件夹（`code-review` → `{memory}/code-review`）。 */
export function memoryPath(id: string): string {
  return under(MEMORY_VAR, id)
}

/** 把 `{memory}/…` 换成 `dir` 下的路径（`dir` 是绝对路径，或导出成 skill 时的 `{skill}/memory`）；别的路径原样返回。 */
export function bindMemoryPath(path: string, dir: string): string {
  if (!isMemoryPath(path)) return path
  const rest = restAfter(path, MEMORY_VAR.length)
  return rest === '' ? normalize(dir) : join(normalize(dir), rest)
}

// ── {instance}：实例 id ────────────────────────────────────────────

/** 实例 id 的变量：可以出现在路径里任意位置（`.workflow-lite/runs/{instance}/out`）。 */
export const INSTANCE_VAR = '{instance}'

/** 这段文字里有没有用到 {@link INSTANCE_VAR}。 */
export function hasInstanceVar(text: string): boolean {
  return text.includes(INSTANCE_VAR)
}

/** 把文字里所有的 {@link INSTANCE_VAR} 换成实例 id；不做别的规范化。 */
export function bindInstance(text: string, id: string): string {
  return text.split(INSTANCE_VAR).join(id)
}

// ── {skill}：导出成 skill 时 skill 自己的目录 ─────────────────────────

/** skill 目录的变量：加载 skill 时宿主给出的那个目录。 */
export const SKILL_VAR = '{skill}'

/** 这个路径是不是写在 skill 目录里（`{skill}` 本身或 `{skill}/…`）。 */
export function isSkillPath(path: string): boolean {
  return leads(path, SKILL_VAR)
}

/** skill 目录里的一个路径（`steps/a.md` → `{skill}/steps/a.md`；空串 → `{skill}`）。 */
export function skillPath(relative: string): string {
  return under(SKILL_VAR, relative)
}
