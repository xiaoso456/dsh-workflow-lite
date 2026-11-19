/**
 * dsh-workflow-lite — 新建会话时用什么跑（agent 预设、模型、思考强度、运行权限）：读、比、合并、去掉。
 *
 * 工作流设置和触发卡片的启动方式各能写一份（{@link SessionChoice}），按项往上找：
 * 触发卡片写了用它的，否则用工作流的，再没有就不传、跟随 DSH 的默认（{@link resolveSessionChoice}）。
 * 只有一处例外：触发器新建的会话，权限两边都没写时用完全权限（{@link resolveTriggerChoice}）。
 * 只存标识：服务商 id、模型 id、档位 id、预设 id、权限预设名，不存地址和密钥；这台机器上没有的照样留着，执行时回退默认。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/sessionChoice
 */

import {
  type ChoiceFallback,
  type ModelChoice,
  type SessionAgent,
  type SessionChoice,
  TRIGGER_PERMISSION,
  TRIGGER_TYPE,
  type TriggerNode,
  type WorkflowDocument,
  type WorkflowNode,
} from './types.ts'

/** 标识的长度上限（DSH 的 id 都很短，过长的当没写）。 */
const MAX_ID = 200

function readId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const id = raw.trim()
  return id === '' || id.length > MAX_ID ? undefined : id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读一个模型：服务商、模型都要有；档位可缺。认不出回 `undefined`（= 跟随）。 */
export function readModelChoice(raw: unknown): ModelChoice | undefined {
  if (!isRecord(raw)) return undefined
  const provider = readId(raw.provider)
  const model = readId(raw.model)
  if (provider === undefined || model === undefined) return undefined
  const effort = readId(raw.effort)
  return { provider, model, ...(effort === undefined ? {} : { effort }) }
}

/** 从一个对象里读出 `preset` / `model` / `permission`（固定键序）；都没有回空对象。 */
export function readSessionChoice(raw: Record<string, unknown>): SessionChoice {
  return pickChoice(readId(raw.preset), readModelChoice(raw.model), readId(raw.permission))
}

/** 按固定键序拼一份，没有的项不出现。 */
function pickChoice(
  preset: string | undefined,
  model: ModelChoice | undefined,
  permission: string | undefined,
): SessionChoice {
  return {
    ...(preset === undefined ? {} : { preset }),
    ...(model === undefined ? {} : { model: { ...model } }),
    ...(permission === undefined ? {} : { permission }),
  }
}

/** 读一项没用上的（认不出的丢掉）。 */
function readFallback(raw: unknown): ChoiceFallback | undefined {
  if (!isRecord(raw)) return undefined
  switch (raw.kind) {
    case 'preset': {
      const preset = readId(raw.preset)
      return preset === undefined ? undefined : { kind: 'preset', preset }
    }
    case 'model': {
      const model = readModelChoice(raw)
      return model === undefined
        ? undefined
        : { kind: 'model', provider: model.provider, model: model.model }
    }
    case 'effort': {
      const model = readId(raw.model)
      const effort = readId(raw.effort)
      return model === undefined || effort === undefined
        ? undefined
        : { kind: 'effort', model, effort }
    }
    case 'unsupported':
      return { kind: 'unsupported' }
    case 'failed':
      return { kind: 'failed', message: typeof raw.message === 'string' ? raw.message : '' }
    case 'permission':
    case 'permissionUnsupported': {
      const permission = readId(raw.permission)
      return permission === undefined ? undefined : { kind: raw.kind, permission }
    }
    default:
      return undefined
  }
}

/** 读插件新建的会话设了什么、哪几项没用上；什么都没有回 `undefined`。 */
export function readSessionAgent(raw: unknown): SessionAgent | undefined {
  if (!isRecord(raw)) return undefined
  const choice = readSessionChoice(raw)
  const fallbacks = Array.isArray(raw.fallbacks)
    ? raw.fallbacks.map(readFallback).filter((item) => item !== undefined)
    : []
  if (!hasSessionChoice(choice) && fallbacks.length === 0) return undefined
  return { ...choice, ...(fallbacks.length === 0 ? {} : { fallbacks }) }
}

/** 这次新建会话记下的：设了什么、哪几项没用上；什么都没设、也没回退回 `undefined`。 */
export function sessionAgent(
  choice: SessionChoice,
  fallbacks: readonly ChoiceFallback[],
): SessionAgent | undefined {
  if (!hasSessionChoice(choice) && fallbacks.length === 0) return undefined
  return {
    ...resolveSessionChoice(undefined, choice),
    ...(fallbacks.length === 0 ? {} : { fallbacks: [...fallbacks] }),
  }
}

export function sameModelChoice(a: ModelChoice | undefined, b: ModelChoice | undefined): boolean {
  return a?.provider === b?.provider && a?.model === b?.model && a?.effort === b?.effort
}

export function sameSessionChoice(
  a: SessionChoice | undefined,
  b: SessionChoice | undefined,
): boolean {
  return (
    a?.preset === b?.preset &&
    sameModelChoice(a?.model, b?.model) &&
    a?.permission === b?.permission
  )
}

/** 有没有写任何一项。 */
export function hasSessionChoice(choice: SessionChoice | undefined): boolean {
  return (
    choice?.preset !== undefined || choice?.model !== undefined || choice?.permission !== undefined
  )
}

/**
 * 这一次新建会话实际要的：触发卡片写了的项用卡片的，否则用工作流的；两边都没写的项不出现（= 跟随 DSH）。
 * 手动执行没有卡片，`trigger` 传 `undefined`。
 */
export function resolveSessionChoice(
  trigger: SessionChoice | undefined,
  workflow: SessionChoice | undefined,
): SessionChoice {
  return pickChoice(
    trigger?.preset ?? workflow?.preset,
    trigger?.model ?? workflow?.model,
    trigger?.permission ?? workflow?.permission,
  )
}

/** 触发器这一次新建会话实际要的：同 {@link resolveSessionChoice}，只是权限两边都没写时用 {@link TRIGGER_PERMISSION}。 */
export function resolveTriggerChoice(
  trigger: SessionChoice | undefined,
  workflow: SessionChoice | undefined,
): SessionChoice {
  const choice = resolveSessionChoice(trigger, workflow)
  return choice.permission === undefined ? { ...choice, permission: TRIGGER_PERMISSION } : choice
}

/** 去掉 `preset` / `model` / `permission`（导出时不带上用）；本来就没有原样返回。 */
export function withoutSessionChoice<T extends SessionChoice>(value: T): T {
  if (!hasSessionChoice(value)) return value
  const { preset: _preset, model: _model, permission: _permission, ...rest } = value
  return rest as T
}

/** 一张图里有没有写任何预设、模型、权限（工作流设置上的、触发卡片上的）。 */
export function documentHasSessionChoice(document: WorkflowDocument): boolean {
  return (
    hasSessionChoice(document.settings) ||
    document.nodes.some(
      (node) => node.type === TRIGGER_TYPE && hasSessionChoice((node as TriggerNode).data.launch),
    )
  )
}

/** 去掉一张图里所有的预设、模型、权限（导出时不带上）：工作流设置上的、各触发卡片上的。没有就原样返回。 */
export function documentWithoutSessionChoice(document: WorkflowDocument): WorkflowDocument {
  if (!documentHasSessionChoice(document)) return document
  const settings =
    document.settings === undefined ? undefined : withoutSessionChoice(document.settings)
  const nodes = document.nodes.map((node): WorkflowNode => {
    if (node.type !== TRIGGER_TYPE) return node
    const trigger = node as TriggerNode
    const launch = trigger.data.launch
    if (launch === undefined || !hasSessionChoice(launch)) return node
    const rest = withoutSessionChoice(launch)
    const { launch: _launch, ...data } = trigger.data
    return { ...trigger, data: Object.keys(rest).length > 0 ? { ...data, launch: rest } : data }
  })
  const { settings: _settings, ...base } = document
  return {
    ...base,
    nodes,
    ...(settings === undefined || Object.keys(settings).length === 0 ? {} : { settings }),
  }
}
