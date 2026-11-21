/**
 * dsh-workflow-lite — 核对、算出一张触发卡片的新设置（模型经 `write_trigger` 的 `local` 改的那几项）。
 *
 * 设置都存在图里（{@link TriggerSettings}）；画布上用户在面板里直接改图，有问题时卡片显示「设置有误」。
 * 模型写的先在这里核对：目录在不在、shell 能不能用、地址重没重、打开前齐没齐，不对就当场回一句原因，
 * 对了再由服务写回图里。HTTP 卡片还没有地址、令牌时顺手生成（地址用工作流名，令牌随机）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/settings
 */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { isWorkflowPath, isWorkspacePath } from '../../shared/pathVars.ts'
import {
  launchMissing,
  settingsOf,
  sourceProblem,
  type TriggerSettings,
  withSettings,
} from '../../shared/trigger.ts'
import {
  HOOK_MAX_LENGTH,
  type HookIssue,
  hookFromName,
  hookIssue,
  TOKEN_MAX_LENGTH,
  TOKEN_MIN_LENGTH,
  type TokenIssue,
  tokenIssue,
} from '../../shared/triggerHttp.ts'
import type { TriggerData } from '../../shared/types.ts'
import { fail, type Outcome, ok } from '../store/repoResult.ts'
import { newHookId, newHookToken } from './hooks.ts'

/** 改一张卡片设置的请求：给了哪项改哪项，文字给空串是清掉。 */
export interface SettingsChange {
  enabled?: boolean
  /** 新建会话用的工作区。 */
  workspace?: string
  /** 定时检查、监听用哪个 shell（程序的完整路径）。 */
  shell?: string
  /** 脚本在哪个目录里跑（绝对路径，或 `{workflow}/…`）；清掉是卡片目录。 */
  cwd?: string
  /** 「固定会话」发进的那个会话。 */
  session?: string
  /** HTTP：地址（`/trigger/` 后面那一段）。 */
  hook?: string
  /** HTTP：令牌。 */
  token?: string
  /** HTTP：不校验令牌（`false` = 恢复校验，令牌还是原来那个）。 */
  noToken?: boolean
  /** HTTP：换一个随机的新令牌。 */
  resetToken?: true
}

export interface SettingsContext {
  workflow: string
  data: TriggerData
  /** 别的卡片已经用了的地址。 */
  taken: ReadonlySet<string>
  /** 打开前还要看的、和别的图有关的问题（接续等的工作流、运行状态）；没有是 `null`。 */
  blocked: string | null
  /** 认一个程序能不能当 shell 用：能用是 `null`。 */
  shellProblem(path: string): Promise<string | null>
}

/** 按请求算出新设置；有一项不对就整个不改，回原因。 */
export async function changeSettings(
  change: SettingsChange,
  context: SettingsContext,
): Promise<Outcome<TriggerSettings>> {
  const { data } = context
  const next = settingsOf(data)
  for (const key of ['workspace', 'shell', 'cwd'] as const) {
    const value = change[key]
    if (value === undefined) continue
    if (value === '') {
      delete next[key]
      continue
    }
    const problem =
      key === 'workspace'
        ? await directoryProblem(value, '工作区')
        : key === 'shell'
          ? await context.shellProblem(value)
          : await cwdProblem(value)
    if (problem !== null) return fail('invalid_args', problem)
    next[key] = value
  }
  if (change.session !== undefined) {
    if (change.session === '') delete next.sessionId
    else next.sessionId = change.session
  }
  const endpoint = changeEndpoint(change, data, next, context)
  if (endpoint !== null) return fail('invalid_args', endpoint)
  if (change.enabled === false) delete next.enabled
  if (change.enabled === true) {
    const problem = await enableProblem(withSettings(data, next), context.blocked)
    if (problem !== null) return fail('blocked', problem)
    next.enabled = true
  }
  return ok(next)
}

/**
 * HTTP 的地址与令牌：自己写的先核对（地址不能和别的卡片重），没有的补上缺省（地址用工作流名、令牌随机）。
 * 不校验令牌只是一个记号，令牌照样留着：再打开校验还是原来那个。
 * @returns 改不成的原因；改成了（或这次不涉及）是 `null`。
 */
function changeEndpoint(
  change: SettingsChange,
  data: TriggerData,
  next: TriggerSettings,
  context: SettingsContext,
): string | null {
  const touched =
    change.hook !== undefined ||
    change.token !== undefined ||
    change.noToken !== undefined ||
    change.resetToken !== undefined
  if (data.source.kind !== 'http') return touched ? '只有 HTTP 触发有地址和令牌' : null
  if (change.token !== undefined && change.resetToken === true)
    return '自己写令牌和换一个令牌只能选一样'
  if (change.hook !== undefined) {
    const hook = change.hook.normalize('NFC')
    const issue = hookIssue(hook)
    if (issue !== null) return HOOK_ISSUE[issue]
    if (context.taken.has(hook)) return `地址「${hook}」已经被别的 HTTP 触发器用了`
    next.hook = hook
  }
  next.hook ??= hookFromName(context.workflow, context.taken) ?? newHookId()
  if (change.token !== undefined) {
    const issue = tokenIssue(change.token)
    if (issue !== null) return TOKEN_ISSUE[issue]
    next.token = change.token
  } else if (change.resetToken === true || next.token === undefined) {
    next.token = newHookToken()
  }
  if (change.noToken === true) next.noToken = true
  else if (change.noToken === false) delete next.noToken
  return null
}

const HOOK_ISSUE: Record<HookIssue, string> = {
  empty: '地址不能为空',
  chars: '地址只能用字母、数字、中文和 - _',
  long: `地址最长 ${String(HOOK_MAX_LENGTH)} 个字`,
}

const TOKEN_ISSUE: Record<TokenIssue, string> = {
  short: `令牌至少 ${String(TOKEN_MIN_LENGTH)} 个字`,
  chars: '令牌只能用字母、数字和 - _ . ~',
  long: `令牌最长 ${String(TOKEN_MAX_LENGTH)} 个字`,
}

/** 打开之前要先配好的；都齐了是 `null`。 */
async function enableProblem(data: TriggerData, blocked: string | null): Promise<string | null> {
  if (blocked !== null) return blocked
  const { source } = data
  const problem = sourceProblem(source)
  if (problem !== null) {
    return source.kind === 'schedule' ? `定时规则不对：${problem}` : `触发设置不对：${problem}`
  }
  const missing = launchMissing(data)
  if (missing === 'session') return '先选定发进哪个会话'
  if (missing === 'workspace') return '先选在哪个工作区里新建会话'
  return data.workspace === undefined ? null : directoryProblem(data.workspace, '工作区')
}

/** 要是一个已有目录的绝对路径；没问题是 `null`。 */
export async function directoryProblem(path: string, what: string): Promise<string | null> {
  if (!isAbsolute(path)) return `${what}要写绝对路径：${path}`
  try {
    return (await stat(path)).isDirectory() ? null : `${what}不是文件夹：${path}`
  } catch {
    return `${what}目录不存在：${path}`
  }
}

/** 脚本的工作目录：工作流目录、会话工作区里的（`{workflow}/…`、`{workspace}/…`）先不看在不在，别处的要是已有目录。 */
async function cwdProblem(path: string): Promise<string | null> {
  if (isWorkflowPath(path) || isWorkspacePath(path)) return null
  return directoryProblem(path, '脚本的工作目录')
}
