/**
 * dsh-workflow-lite — 新建会话时用什么跑，在界面上怎么写：下拉的几项、名字、这台机器上用不了的提醒、一行摘要。
 *
 * 纯计算：工作流设置「会话」页、触发卡片「执行设置」、「执行」小箭头共用。
 * 清单（`HostAgentsResponse`）还没读到时是 `null`：下拉里只列「跟随」和已经设了的那一项，不报用不了。
 * 设了但这台机器上没有的值不清掉，照样列着、标出来（换台机器、升级 DSH 后又能用）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/sessionChoice
 */

import type { ModelChoice, SessionAgent, SessionChoice } from '../../shared/types.ts'
import type {
  ChoiceFallback,
  HostAgentsResponse,
  ModelEntry,
  ModelProviderEntry,
} from '../../shared/wire/host.ts'
import type { LocaleKey, T } from '../i18n.ts'

/** DSH 内置预设没有名字，界面上按 DSH 自己的叫法写。 */
const BUILTIN_PRESETS: Record<string, LocaleKey> = {
  standard: 'session.preset.standard',
  ptc: 'session.preset.ptc',
  minimal: 'session.preset.minimal',
  cordis: 'session.preset.cordis',
}

/** 下拉的一项（和界面下拉的选项同形：名字下面一行灰字、分组名、收起时名字后面的灰字）。 */
export interface ChoiceOption {
  value: string
  label: string
  desc?: string
  group?: string
  valueDesc?: string
}

/** 下拉里「跟随」那一项的值。 */
export const FOLLOW = ''

/** 「跟随」的两种说法：工作流设置里跟随 DSH 的默认，触发卡片上跟随工作流。 */
export type FollowKind = 'default' | 'workflow'

const FOLLOW_TEXT: Record<FollowKind, LocaleKey> = {
  default: 'session.followDefault',
  workflow: 'session.followWorkflow',
}

// ─────────────────────────────────────────────────────────────
// 名字
// ─────────────────────────────────────────────────────────────

export function presetName(t: T, catalog: HostAgentsResponse | null, id: string): string {
  const entry = catalog?.presets.find((preset) => preset.id === id)
  if (entry?.name !== undefined && entry.name !== '') return entry.name
  const builtin = BUILTIN_PRESETS[id]
  return builtin === undefined ? id : t(builtin)
}

/** 不指定预设时 DSH 用的那个的名字；不知道回 `undefined`。 */
function defaultPresetName(t: T, catalog: HostAgentsResponse | null): string | undefined {
  const entry = catalog?.presets.find((preset) => preset.isDefault)
  return entry === undefined ? undefined : presetName(t, catalog, entry.id)
}

function findProvider(
  catalog: HostAgentsResponse | null,
  provider: string,
): ModelProviderEntry | undefined {
  return catalog?.providers.find((entry) => entry.id === provider)
}

export function findModel(
  catalog: HostAgentsResponse | null,
  choice: Pick<ModelChoice, 'provider' | 'model'>,
): ModelEntry | undefined {
  return findProvider(catalog, choice.provider)?.models.find((entry) => entry.id === choice.model)
}

export function modelName(
  catalog: HostAgentsResponse | null,
  choice: Pick<ModelChoice, 'provider' | 'model'>,
): string {
  return findModel(catalog, choice)?.name ?? choice.model
}

function effortName(entry: ModelEntry | undefined, effort: string): string {
  return entry?.efforts.find((level) => level.id === effort)?.name ?? effort
}

/** 「DeepSeek V4 · 思考 高」；档位没写只写模型。 */
export function modelText(t: T, catalog: HostAgentsResponse | null, choice: ModelChoice): string {
  const name = modelName(catalog, choice)
  if (choice.effort === undefined) return name
  const level = effortName(findModel(catalog, choice), choice.effort)
  return `${name} · ${t('session.effortOf').replace('{name}', level)}`
}

/**
 * 一行摘要：「DeepSeek V4 · 思考 高 · 标准模式」（「执行」小箭头里「新建会话」下面那行）。
 * 什么都没设回空串：照默认跑，不写。
 */
export function choiceSummary(
  t: T,
  catalog: HostAgentsResponse | null,
  choice: SessionChoice,
): string {
  return [
    choice.model === undefined ? '' : modelText(t, catalog, choice.model),
    choice.preset === undefined ? '' : presetName(t, catalog, choice.preset),
  ]
    .filter((part) => part !== '')
    .join(' · ')
}

// ─────────────────────────────────────────────────────────────
// 下拉
// ─────────────────────────────────────────────────────────────

/** 模型在下拉里的值：`服务商/模型`（服务商 id 里不会有 `/`，模型 id 里可能有，按第一个拆）。 */
export function modelKey(choice: Pick<ModelChoice, 'provider' | 'model'> | undefined): string {
  return choice === undefined ? FOLLOW : `${choice.provider}/${choice.model}`
}

export function readModelKey(key: string): { provider: string; model: string } | undefined {
  const cut = key.indexOf('/')
  if (cut <= 0 || cut === key.length - 1) return undefined
  return { provider: key.slice(0, cut), model: key.slice(cut + 1) }
}

/** 「跟随」那一项：名字下面写现在跟随的是什么（工作流那边设的；没有就是 DSH 的默认）。 */
function followOption(t: T, follow: FollowKind, now: string | undefined): ChoiceOption {
  return {
    value: FOLLOW,
    label: t(FOLLOW_TEXT[follow]),
    ...(now === undefined
      ? {}
      : { desc: t('session.nowIs').replace('{name}', now), valueDesc: now }),
  }
}

/** 预设的几项：跟随 + 这台机器上的（坏了的不列，除非正选着）+ 设了但没有的那一个。 */
export function presetOptions(
  t: T,
  catalog: HostAgentsResponse | null,
  current: string | undefined,
  follow: FollowKind,
  inherited: string | undefined,
): ChoiceOption[] {
  const now =
    inherited === undefined ? defaultPresetName(t, catalog) : presetName(t, catalog, inherited)
  const options: ChoiceOption[] = [followOption(t, follow, now)]
  for (const preset of catalog?.presets ?? []) {
    if (preset.broken !== undefined && preset.id !== current) continue
    options.push({
      value: preset.id,
      label: presetName(t, catalog, preset.id),
      ...(preset.broken !== undefined
        ? { desc: t('session.broken') }
        : preset.description === undefined || preset.description === ''
          ? {}
          : { desc: preset.description, valueDesc: '' }),
    })
  }
  if (current !== undefined && !options.some((option) => option.value === current)) {
    options.push({
      value: current,
      label: presetName(t, catalog, current),
      ...(catalog === null ? {} : { desc: t('session.missing') }),
    })
  }
  return options
}

/**
 * 模型的几项：跟随 + 按服务商分组的模型（下面一行写能选的档位）+ 设了但没有的那一个。
 * 读不出列表的服务商只在组名那儿说一句（没有项可列，放一个不能选的说明项太像能选，就写在设了的那一项上）。
 */
export function modelOptions(
  t: T,
  catalog: HostAgentsResponse | null,
  current: ModelChoice | undefined,
  follow: FollowKind,
  inherited: ModelChoice | undefined,
): ChoiceOption[] {
  const fallback = catalog?.defaultModel
  const now =
    inherited !== undefined
      ? modelText(t, catalog, inherited)
      : fallback === undefined
        ? undefined
        : modelText(t, catalog, fallback)
  const options: ChoiceOption[] = [followOption(t, follow, now)]
  for (const provider of catalog?.providers ?? []) {
    for (const model of provider.models) {
      options.push({
        value: modelKey({ provider: provider.id, model: model.id }),
        label: model.name,
        group: provider.name,
        valueDesc: provider.name,
        ...(model.efforts.length === 0
          ? {}
          : {
              desc: t('session.efforts').replace(
                '{list}',
                model.efforts.map((level) => level.name).join(' / '),
              ),
            }),
      })
    }
  }
  const key = modelKey(current)
  if (current !== undefined && !options.some((option) => option.value === key)) {
    const failed = catalog?.failures.find((entry) => entry.id === current.provider)
    options.push({
      value: key,
      label: current.model,
      valueDesc: failed?.name ?? current.provider,
      ...(catalog === null
        ? {}
        : { desc: failed === undefined ? t('session.missing') : t('session.providerFailed') }),
    })
  }
  return options
}

/**
 * 思考强度的几档：「默认」（模型自己的默认档）+ 这个模型的档位；设了但模型没有的那一档也列着。
 * 模型不分档、也没设档位时回空数组（这一项不出现）。
 */
export function effortOptions(
  t: T,
  catalog: HostAgentsResponse | null,
  model: ModelChoice,
): { value: string; label: string }[] {
  const entry = findModel(catalog, model)
  const levels = entry?.efforts ?? []
  const options = [
    { value: FOLLOW, label: t('session.effortDefault') },
    ...levels.map((level) => ({ value: level.id, label: level.name })),
  ]
  if (model.effort !== undefined && !levels.some((level) => level.id === model.effort)) {
    options.push({ value: model.effort, label: model.effort })
  }
  return options.length === 1 ? [] : options
}

/** 换了模型：档位这个模型还有就留着，没有就回到默认档。 */
export function pickModel(
  catalog: HostAgentsResponse | null,
  key: string,
  previous: ModelChoice | undefined,
): ModelChoice | undefined {
  const picked = readModelKey(key)
  if (picked === undefined) return undefined
  const effort = previous?.effort
  const keep =
    effort !== undefined &&
    (findModel(catalog, picked)?.efforts.some((level) => level.id === effort) ?? false)
  return keep ? { ...picked, effort } : picked
}

export function withEffort(model: ModelChoice, effort: string): ModelChoice {
  const { effort: _previous, ...base } = model
  return effort === FOLLOW ? base : { ...base, effort }
}

// ─────────────────────────────────────────────────────────────
// 用不了的
// ─────────────────────────────────────────────────────────────

/** 设了但这台机器上用不了的：执行时会回退默认。 */
export type ChoiceIssue =
  | { kind: 'preset'; preset: string }
  | { kind: 'model'; model: ModelChoice }
  | { kind: 'effort'; model: ModelChoice }
  | { kind: 'unsupported' }

/**
 * 看一份设置在这台机器上能不能用。清单没读到、DSH 里没有会话服务、服务商读不出列表时不算用不了（不知道）。
 */
export function choiceIssues(
  catalog: HostAgentsResponse | null,
  choice: SessionChoice,
): ChoiceIssue[] {
  if (catalog === null || catalog.unavailable !== undefined) return []
  const issues: ChoiceIssue[] = []
  const { preset, model } = choice
  if (preset !== undefined && catalog.presets.length > 0) {
    const entry = catalog.presets.find((item) => item.id === preset)
    if (entry === undefined || entry.broken !== undefined) issues.push({ kind: 'preset', preset })
  }
  if (model !== undefined) {
    if (catalog.modelSelectable === false) issues.push({ kind: 'unsupported' })
    else if (!catalog.failures.some((entry) => entry.id === model.provider)) {
      const entry = findModel(catalog, model)
      if (entry === undefined) issues.push({ kind: 'model', model })
      else if (
        model.effort !== undefined &&
        !entry.efforts.some((level) => level.id === model.effort)
      )
        issues.push({ kind: 'effort', model })
    }
  }
  return issues
}

export function issueLines(t: T, catalog: HostAgentsResponse | null, issue: ChoiceIssue): string[] {
  switch (issue.kind) {
    case 'preset':
      return [t('session.issue.preset').replace('{name}', presetName(t, catalog, issue.preset))]
    case 'model':
      return [t('session.issue.model').replace('{name}', issue.model.model)]
    case 'effort':
      return [
        t('session.issue.effort')
          .replace('{model}', modelName(catalog, issue.model))
          .replace('{effort}', issue.model.effort ?? ''),
      ]
    case 'unsupported':
      return [t('session.issue.unsupported'), t('session.issue.version')]
  }
}

/** 装模型时回退了默认的一项，一句话。 */
function fallbackLine(t: T, catalog: HostAgentsResponse | null, fallback: ChoiceFallback): string {
  switch (fallback.kind) {
    case 'preset':
      return t('session.fallback.preset').replace('{name}', presetName(t, catalog, fallback.preset))
    case 'model':
      return t('session.fallback.model').replace('{name}', fallback.model)
    case 'effort':
      return t('session.fallback.effort')
        .replace('{model}', fallback.model)
        .replace('{effort}', fallback.effort)
    case 'unsupported':
      return t('session.fallback.unsupported')
    case 'failed':
      return t('session.fallback.failed')
  }
}

/** 装模型时回退了默认的那几项，拼成一句（「执行」之后的提示）。 */
export function fallbackNote(
  t: T,
  catalog: HostAgentsResponse | null,
  fallbacks: readonly ChoiceFallback[],
): string {
  return fallbacks.map((fallback) => fallbackLine(t, catalog, fallback)).join('; ')
}

/** 实例来源里的一项：实际用的是什么；回退了默认时 `wanted` 写设的是什么。 */
export interface AgentLine {
  text: string
  wanted?: string
}

/**
 * 实例来源里的预设、模型两行（插件为它新建会话时设了的才有）：用上了写设的；回退了写「DSH 的默认」，旁边写设的是什么。
 * 不读清单（看实例时不必问 DSH），名字按内置预设的叫法和模型 id 写。
 */
export function agentLines(t: T, agent: SessionAgent): { preset?: AgentLine; model?: AgentLine } {
  const kinds = new Set((agent.fallbacks ?? []).map((fallback) => fallback.kind))
  const wanted = (name: string): string => t('session.wanted').replace('{name}', name)
  const fallen = t('session.dshDefault')
  const preset: AgentLine | undefined =
    agent.preset === undefined
      ? undefined
      : kinds.has('preset')
        ? { text: fallen, wanted: wanted(presetName(t, null, agent.preset)) }
        : { text: presetName(t, null, agent.preset) }
  const { model } = agent
  const modelLine: AgentLine | undefined =
    model === undefined
      ? undefined
      : kinds.has('model') || kinds.has('unsupported') || kinds.has('failed')
        ? { text: fallen, wanted: wanted(modelText(t, null, model)) }
        : kinds.has('effort')
          ? {
              text: model.model,
              wanted: t('session.wantedEffort').replace('{effort}', model.effort ?? ''),
            }
          : { text: modelText(t, null, model) }
  return {
    ...(preset === undefined ? {} : { preset }),
    ...(modelLine === undefined ? {} : { model: modelLine }),
  }
}
