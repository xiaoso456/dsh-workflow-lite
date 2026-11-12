/**
 * dsh-workflow-lite — 触发时怎么进会话：在工作区里新建一个会话、把一条消息发进会话、看会话是不是正在跑。
 *
 * 触发器只认 {@link SessionPort} 这几件事；怎么用 DSH 的服务做到，在 {@link createSessionPort} 里。
 * 用到的服务（`sessionController`、`workspaceRegistry`、`agents`）都是现取的：哪个不在，
 * 这个进程就发不了会话（`unavailable` 说出原因），触发器不在这个进程里负责触发。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/sessions
 */

import type { Context } from '@deepseek-ai/cordis'
// 只借类型：`ctx.agents` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
// `workflow-lite` 这个消息来源在那里登记。
import type {} from '../runs/notice.ts'

export interface SessionPort {
  /** 这个进程里发不了会话时的原因；能发是 `null`。 */
  unavailable(): string | null
  /** 在工作区目录里新建一个会话，回会话 id。目录不在、建不出来就抛错。 */
  open(input: { cwd: string; title: string }): Promise<string>
  /** 把一条消息发进会话：空闲就开一轮，正在跑就排在后面。会话不在就抛错。 */
  send(session: string, text: string, summary: string): Promise<void>
  /** 会话是不是正在跑。 */
  busy(session: string): boolean
}

/** 用到的 `sessionController` 的那几个方法（DSH 没有随包给出它的类型）。 */
interface SessionControllerLike {
  create(input: { workspaceId: string; agentPreset: string }): Promise<{ sessionId: string }>
  rename(input: { sessionId: string; title: string }): Promise<unknown>
  resolveAgent(sessionId: string): Promise<{ agent: { followup(message: UserMessage): void } }>
}

/** 用到的 `workspaceRegistry` 的那个方法：按目录建（或取回已有的）工作区。 */
interface WorkspaceRegistryLike {
  create(path: string): Promise<{ id: string }>
}

/** 新建会话用的 agent 预设。 */
const AGENT_PRESET = 'standard'

export function createSessionPort(ctx: Context): SessionPort {
  const controller = (): SessionControllerLike | undefined => ctx.get('sessionController')
  const workspaces = (): WorkspaceRegistryLike | undefined => ctx.get('workspaceRegistry')
  return {
    unavailable() {
      if (controller() === undefined || workspaces() === undefined) {
        return '这个 DSH 里没有会话服务，发不了会话'
      }
      return null
    },

    async open({ cwd, title }) {
      const sessions = controller()
      const registry = workspaces()
      if (sessions === undefined || registry === undefined) throw new Error('会话服务不在')
      const workspace = await registry.create(cwd)
      const { sessionId } = await sessions.create({
        workspaceId: workspace.id,
        agentPreset: AGENT_PRESET,
      })
      // 标题只是给人认的，改不成不影响触发。
      await sessions.rename({ sessionId, title }).catch(() => {})
      return sessionId
    },

    async send(session, text, summary) {
      const sessions = controller()
      if (sessions === undefined) throw new Error('会话服务不在')
      const { agent } = await sessions.resolveAgent(session)
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'workflow-lite', form: 'notice', summary: boundContextSummary(summary) },
        }),
      )
    },

    busy(session) {
      return ctx.get('agents')?.get(session as SessionId)?.status === 'running'
    },
  }
}
