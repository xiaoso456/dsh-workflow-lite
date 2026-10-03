/**
 * dsh-workflow-lite — 以会话里那个 agent 的眼光看 skill。
 *
 * web 版 DSH 把本地 skill 的发现（项目的 `.dsh/skills` `.agents/skills`、`~/.dsh/skills`、
 * `~/.agents/skills`）挂在 **agent 预设**底下：每个预设自己的 `skill-filesystem` 注册进它那一层。
 * 不带作用域读 `ctx.skills` 只剩全局那一层（内置的、插件注册的）——只看得到两三个。
 *
 * 和 DSH 自己的 skill 目录（`/` 命令的那份清单）同一套取法：
 * - 会话的 agent 正在跑：用它预设里的 skill 服务，以它为作用域；
 * - 没在跑（或没给会话）：借默认预设的作用域读一次，读完还回去。
 *
 * `agentPresets` 不在本项目的依赖里，按形状收窄，不对就退回全局那一层。
 *
 * @module @xiaoso/dsh-workflow-lite/host/skillView
 */

import type { Context } from '@deepseek-ai/cordis'
// 只借类型：`ctx.agents` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SkillLister, SkillViewer } from './hostFs.ts'

/** `ctx.agentPresets` 用到的那一点。 */
interface AgentPresetsLike {
  serviceFor(agent: { ctx: Context }, name: 'skills'): unknown
  acquireScope(id?: string): Promise<{ key: object } & AsyncDisposable>
}

function hasMethods<K extends string>(value: unknown, names: readonly K[]): boolean {
  if (typeof value !== 'object' || value === null) return false
  return names.every((name) => typeof (value as Record<K, unknown>)[name] === 'function')
}

function agentPresetsOf(ctx: Context): AgentPresetsLike | undefined {
  const service = (ctx as unknown as { get(name: string): unknown }).get('agentPresets')
  return hasMethods(service, ['serviceFor', 'acquireScope'])
    ? (service as AgentPresetsLike)
    : undefined
}

function asLister(value: unknown): SkillLister | undefined {
  return hasMethods(value, ['list', 'get']) ? (value as SkillLister) : undefined
}

/**
 * @param ctx - 插件的上下文（找 `agents`、`agentPresets`）。
 * @param global - 全局的 `ctx.skills`；skill 服务不在时为 `undefined`。
 */
export function createSkillViewer(
  ctx: Context,
  global: () => SkillLister | undefined,
): SkillViewer {
  return async (session) => {
    const presets = agentPresetsOf(ctx)
    const live = session === undefined ? undefined : ctx.get('agents')?.get(session as SessionId)
    if (live !== undefined) {
      const skills = asLister(presets?.serviceFor(live, 'skills')) ?? global()
      return skills === undefined ? undefined : { skills, scope: live }
    }
    const skills = global()
    if (skills === undefined) return undefined
    let lease: ({ key: object } & AsyncDisposable) | undefined
    try {
      lease = await presets?.acquireScope()
    } catch {
      // 默认预设用不了：只看全局那一层。
      lease = undefined
    }
    if (lease === undefined) return { skills }
    const held = lease
    return { skills, scope: held.key, release: async () => await held[Symbol.asyncDispose]() }
  }
}
