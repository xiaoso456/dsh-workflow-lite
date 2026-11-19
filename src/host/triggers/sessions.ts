/**
 * dsh-workflow-lite — 插件怎么进会话：在工作区里新建一个会话（带上预设、装上模型）、把一条消息发进会话、
 * 列出能选的预设和模型。触发器和画布「执行」都只认 {@link SessionPort}；怎么用 DSH 的服务做到，在 {@link createSessionPort} 里。
 * 用到的服务（`sessionController`、`workspaceRegistry`、`agentPresets`、`agents`）都是现取的：哪个不在，
 * 这个进程就做不了对应的事（`unavailable` 说出原因），触发器不在这个进程里负责触发。
 *
 * 触发消息按用户消息发（来源 `user`）：触发器是用户自己建、自己打开的，到点发进去的是用户预先交代的事。
 * DSH 的 `create_goal` / `update_goal` 只认本轮有用户消息的回合，这样模型在触发的这一轮里能自己设定、
 * 完成会话目标，和用户手动执行时一样。
 *
 * 模型：DSH 公开的 `selectModel` 换完会把选择存成用户的默认模型，不能用。这里先按模型目录校验，
 * 再调会话 agent 的 `model.select`（0.2.2 起有，只改这个会话），在发第一条消息之前装上。
 * 没有这个方法（0.2.1）、或装的时候出错，就不装、用默认模型照常发，`logger.warn` 一次，回退记在结果里。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/sessions
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ModelChoice, SessionChoice } from '../../shared/types.ts'
import type {
  AgentPresetEntry,
  ChoiceFallback,
  HostAgentsResponse,
  ModelProviderEntry,
} from '../../shared/wire/host.ts'

export interface SessionPort {
  /** 这个进程里发不了会话时的原因；能发是 `null`。 */
  unavailable(): string | null
  /**
   * 在工作区目录里新建一个会话，回会话 id。`choice` 里设了的预设、模型能用上就用上，
   * 用不上的回退默认、写进 `fallbacks`（不抛）。目录不在、建不出来就抛错。
   */
  open(input: {
    cwd: string
    title: string
    choice?: SessionChoice
  }): Promise<{ session: string; fallbacks: ChoiceFallback[] }>
  /** 把一条用户消息发进会话：空闲就开一轮，正在跑就排在后面。会话不在就抛错。 */
  send(session: string, text: string): Promise<void>
  /** 给刚建好、还没发消息的会话装上模型（画布「执行」：会话在前端建）。用不上的回退默认，不抛。 */
  prepare(session: string, model: ModelChoice): Promise<ChoiceFallback[]>
  /** 能选的预设、模型；给了 `session` 就拿它试一下能不能只给一个会话换模型。 */
  catalog(session?: string): Promise<HostAgentsResponse>
}

/** 会话的 agent 上用到的：发消息，以及（0.2.2 起）只给这个会话换模型。 */
interface AgentLike {
  followup(message: UserMessage): void
  model?: { select?: unknown }
}

/** 用到的 `sessionController` 的那几个方法（DSH 没有随包给出它的类型）。 */
interface SessionControllerLike {
  create(input: { workspaceId: string; agentPreset?: string }): Promise<{ sessionId: string }>
  rename(input: { sessionId: string; title: string }): Promise<unknown>
  /** 找到回 `{ agent }`，找不到回 `{ error }`。 */
  resolveAgent(sessionId: string): Promise<{ agent?: AgentLike; error?: unknown }>
  modelCatalog(): Promise<ModelCatalogLike>
}

/** `modelCatalog()` 回的样子（只取用到的）。 */
interface ModelCatalogLike {
  default?: { provider: string; model: string; reasoningEffort?: string }
  groups?: readonly {
    id: string
    name: string
    models: readonly {
      id: string
      name: string
      description?: string
      reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string }
    }[]
  }[]
  failures?: readonly { id: string; name: string; message: string }[]
}

/** 用到的 `workspaceRegistry` 的那个方法：按目录建（或取回已有的）工作区。 */
interface WorkspaceRegistryLike {
  create(path: string): Promise<{ id: string }>
}

/** 用到的 `agentPresets`：列预设（带哪个是默认）。 */
interface AgentPresetsLike {
  remoteExportList(): Promise<{ presets: readonly AgentPresetEntry[] }>
}

/** `agents` 服务：按会话 id 取正活着的 agent（不唤醒）。 */
interface AgentsLike {
  get(session: string): AgentLike | undefined
}

/** 只给一个会话换模型：有就是那个函数，没有是 `undefined`。 */
function selectorOf(agent: AgentLike | undefined): ((selection: object) => void) | undefined {
  const model = agent?.model
  if (model === undefined || model === null || typeof model.select !== 'function') return undefined
  const select = model.select as (selection: object) => void
  return (selection) => {
    select.call(model, selection)
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function createSessionPort(ctx: Context): SessionPort {
  const get = <T>(name: string): T | undefined => ctx.get(name as never) as T | undefined
  const controller = (): SessionControllerLike | undefined => get('sessionController')
  const workspaces = (): WorkspaceRegistryLike | undefined => get('workspaceRegistry')
  const presets = (): AgentPresetsLike | undefined => get('agentPresets')
  const agents = (): AgentsLike | undefined => get('agents')

  /** 上一次看到的「能不能只给一个会话换模型」（还没看过是 `null`）。 */
  let selectable: boolean | null = null
  let warnedUnsupported = false
  const noteSelectable = (agent: AgentLike | undefined): void => {
    if (agent !== undefined) selectable = selectorOf(agent) !== undefined
  }
  const warn = (message: string): void => {
    ctx.logger.warn(`[workflow-lite] ${message}`)
  }

  async function presetList(): Promise<AgentPresetEntry[]> {
    const registry = presets()
    if (registry === undefined || typeof registry.remoteExportList !== 'function') return []
    const roster = await registry.remoteExportList()
    return roster.presets.map((row) => ({
      id: row.id,
      ...(row.name === undefined ? {} : { name: row.name }),
      ...(row.description === undefined ? {} : { description: row.description }),
      isDefault: row.isDefault === true,
      ...(row.broken === undefined ? {} : { broken: row.broken }),
    }))
  }

  /** 设的预设能不能用：在列表里且没坏。列不出列表时不拦（交给 DSH 自己判断）。 */
  async function usablePreset(preset: string): Promise<boolean> {
    try {
      const list = await presetList()
      if (list.length === 0) return true
      const row = list.find((entry) => entry.id === preset)
      return row !== undefined && row.broken === undefined
    } catch {
      return true
    }
  }

  /** 按模型目录校验：模型在不在、这一档有没有。回要装的选择（档位不对就去掉）和回退。 */
  async function checkModel(
    sessions: SessionControllerLike,
    model: ModelChoice,
  ): Promise<{ selection?: object; fallbacks: ChoiceFallback[] }> {
    let catalog: ModelCatalogLike
    try {
      catalog = await sessions.modelCatalog()
    } catch (error) {
      return { fallbacks: [{ kind: 'failed', message: messageOf(error) }] }
    }
    const found = catalog.groups
      ?.find((group) => group.id === model.provider)
      ?.models.find((entry) => entry.id === model.model)
    if (found === undefined) {
      return { fallbacks: [{ kind: 'model', provider: model.provider, model: model.model }] }
    }
    const efforts = found.reasoning?.efforts ?? []
    const effortOk = model.effort !== undefined && efforts.some((e) => e.id === model.effort)
    const fallbacks: ChoiceFallback[] =
      model.effort !== undefined && !effortOk
        ? [{ kind: 'effort', model: model.model, effort: model.effort }]
        : []
    return {
      selection: {
        provider: model.provider,
        model: model.model,
        ...(effortOk ? { reasoningEffort: model.effort } : {}),
      },
      fallbacks,
    }
  }

  /** 装模型：按目录校验后调 `model.select`；做不到就回退（不抛），并告警。 */
  async function install(
    sessions: SessionControllerLike,
    session: string,
    model: ModelChoice,
  ): Promise<ChoiceFallback[]> {
    let agent: AgentLike | undefined
    try {
      const found = await sessions.resolveAgent(session)
      if (found.agent === undefined) throw found.error ?? new Error('会话不在')
      agent = found.agent
    } catch (error) {
      warn(`给会话装模型时取不到 agent，用默认模型：${messageOf(error)}`)
      return [{ kind: 'failed', message: messageOf(error) }]
    }
    noteSelectable(agent)
    const select = selectorOf(agent)
    if (select === undefined) {
      if (!warnedUnsupported) {
        warnedUnsupported = true
        warn(
          '这个 DSH 不能只给一个会话换模型（会话 agent 上没有 model.select），按工作流选模型失效，回退到默认模型',
        )
      }
      return [{ kind: 'unsupported' }]
    }
    const checked = await checkModel(sessions, model)
    if (checked.selection === undefined) {
      warn(`设的模型 ${model.provider}/${model.model} 用不上，用默认模型`)
      return checked.fallbacks
    }
    try {
      select(checked.selection)
    } catch (error) {
      warn(`给会话装模型出错，用默认模型：${messageOf(error)}`)
      return [{ kind: 'failed', message: messageOf(error) }]
    }
    if (checked.fallbacks.length > 0) {
      warn(`模型 ${model.model} 没有 ${model.effort ?? ''} 这一档，用模型的默认档`)
    }
    return checked.fallbacks
  }

  return {
    unavailable() {
      if (controller() === undefined || workspaces() === undefined) {
        return '这个 DSH 里没有会话服务，发不了会话'
      }
      return null
    },

    async open({ cwd, title, choice }) {
      const sessions = controller()
      const registry = workspaces()
      if (sessions === undefined || registry === undefined) throw new Error('会话服务不在')
      const fallbacks: ChoiceFallback[] = []
      // 没设预设就不传，DSH 用用户设的默认预设。
      let preset = choice?.preset
      if (preset !== undefined && !(await usablePreset(preset))) {
        warn(`设的预设 ${preset} 用不上，用默认预设`)
        fallbacks.push({ kind: 'preset', preset })
        preset = undefined
      }
      const workspace = await registry.create(cwd)
      const { sessionId } = await sessions.create({
        workspaceId: workspace.id,
        ...(preset === undefined ? {} : { agentPreset: preset }),
      })
      // 标题只是给人认的，改不成不影响触发。
      await sessions.rename({ sessionId, title }).catch(() => {})
      if (choice?.model !== undefined) {
        fallbacks.push(...(await install(sessions, sessionId, choice.model)))
      }
      return { session: sessionId, fallbacks }
    },

    async send(session, text) {
      const sessions = controller()
      if (sessions === undefined) throw new Error('会话服务不在')
      const { agent, error } = await sessions.resolveAgent(session)
      if (agent === undefined) throw error instanceof Error ? error : new Error('会话不在')
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }),
      )
    },

    async prepare(session, model) {
      const sessions = controller()
      if (sessions === undefined) return [{ kind: 'failed', message: '会话服务不在' }]
      return install(sessions, session, model)
    },

    async catalog(session) {
      const sessions = controller()
      if (sessions === undefined) {
        return {
          presets: [],
          providers: [],
          failures: [],
          modelSelectable: selectable,
          unavailable: '这个 DSH 里没有会话服务',
        }
      }
      if (session !== undefined) {
        let agent = agents()?.get(session)
        if (agent === undefined) {
          agent = await sessions
            .resolveAgent(session)
            .then((found) => found.agent)
            .catch(() => undefined)
        }
        noteSelectable(agent)
      }
      const [catalog, presetRows] = await Promise.all([
        sessions.modelCatalog().catch((): ModelCatalogLike => ({})),
        presetList().catch(() => []),
      ])
      const providers: ModelProviderEntry[] = (catalog.groups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        models: group.models.map((entry) => ({
          id: entry.id,
          name: entry.name,
          ...(entry.description === undefined ? {} : { description: entry.description }),
          efforts: (entry.reasoning?.efforts ?? []).map((effort) => ({
            id: effort.id,
            name: effort.name,
          })),
          ...(entry.reasoning?.defaultEffort === undefined
            ? {}
            : { defaultEffort: entry.reasoning.defaultEffort }),
        })),
      }))
      const fallback = catalog.default
      return {
        presets: presetRows,
        providers,
        failures: (catalog.failures ?? []).map((failure) => ({
          id: failure.id,
          name: failure.name,
          message: failure.message,
        })),
        ...(fallback === undefined
          ? {}
          : {
              defaultModel: {
                provider: fallback.provider,
                model: fallback.model,
                ...(fallback.reasoningEffort === undefined
                  ? {}
                  : { effort: String(fallback.reasoningEffort) }),
              },
            }),
        modelSelectable: selectable,
      }
    },
  }
}
