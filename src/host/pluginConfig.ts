/**
 * dsh-workflow-lite — 工作流中心「设置」页的后端：经 DSH 的设置服务（`ctx.settings`）读写本插件自己那一行配置。
 *
 * - 只露 {@link PLUGIN_CONFIG_KEYS} 那几项；`routePrefix` 这类接线细节不给人改。
 * - 写入走设置服务的路径编辑（`mutate`）：它按完整 Config 校验、落进当前 profile 的 patch、
 *   就地更新运行中的活配置；带修订号，别人先改过就拒绝，不悄悄覆盖。
 * - 设置服务不在（精简的 profile）时只读：页面照样显示现值，告诉人这里改不了。
 *
 * 本插件在 profile 里那一行的 id 通常就是 `workflow-lite`（`cordis.patch.yml` 里写的）；
 * 有人手动换了 id 时，退回去找「字段正好是这几项」的那一行。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pluginConfig
 */

import {
  PLUGIN_CONFIG_KEYS,
  type PluginConfigKey,
  type PluginConfigValues,
  type PluginConfigView,
} from '../shared/wire.ts'
import { WORKFLOW_LITE_ROW_ID } from './config.ts'

/** 用到的那一小截设置服务（`@deepseek-ai/dsh-settings` 的 `SettingsForms`）。 */
export interface SettingsPort {
  readonly writable: boolean
  describe(options?: { redactSecrets?: boolean }): readonly SettingsRow[]
  mutate(
    ns: string,
    ops: readonly (
      | { op: 'set'; path: readonly string[]; value: unknown }
      | { op: 'unset'; path: readonly string[] }
    )[],
    expectedRevision?: number,
  ): Promise<void>
}

export interface SettingsRow {
  ns: string
  revision: number
  value: unknown
  base?: unknown
  user?: unknown
}

type Outcome<T> = { ok: true; result: T } | { ok: false; error: { code: string; message: string } }

/** 设置服务不在时页面要的现值（从活配置读）。 */
export type LiveValues = () => PluginConfigValues

export function readPluginConfig(
  port: SettingsPort | undefined,
  live: LiveValues,
): PluginConfigView {
  const values = live()
  const row = port === undefined ? undefined : ownRow(port.describe({ redactSecrets: true }))
  if (port === undefined || row === undefined) {
    return {
      available: false,
      writable: false,
      revision: 0,
      values,
      defaults: values,
      overridden: [],
    }
  }
  const current = pick(row.value, values)
  const user = asRecord(row.user)
  return {
    available: true,
    writable: port.writable,
    revision: row.revision,
    values: current,
    defaults: pick(row.base, current),
    overridden: PLUGIN_CONFIG_KEYS.filter((key) => Object.hasOwn(user, key)),
  }
}

export async function writePluginConfig(
  port: SettingsPort | undefined,
  live: LiveValues,
  /** 线上来的原样（键名、值都还没核对过）。 */
  write: { revision: number; set?: Record<string, unknown>; reset?: readonly string[] },
): Promise<Outcome<PluginConfigView>> {
  const row = port === undefined ? undefined : ownRow(port.describe({ redactSecrets: true }))
  if (port === undefined || row === undefined || !port.writable) {
    return { ok: false, error: { code: 'unavailable', message: '这里改不了设置' } }
  }
  const ops: { op: 'set'; path: string[]; value: unknown }[] = []
  const resets: { op: 'unset'; path: string[] }[] = []
  for (const [key, value] of Object.entries(write.set ?? {})) {
    if (!isKey(key)) return invalid(`不认识的设置项 ${key}`)
    const problem = checkValue(key, value)
    if (problem !== null) return invalid(problem)
    ops.push({ op: 'set', path: [key], value: key === 'dataDir' ? String(value).trim() : value })
  }
  for (const key of write.reset ?? []) {
    if (!isKey(key)) return invalid(`不认识的设置项 ${key}`)
    resets.push({ op: 'unset', path: [key] })
  }
  if (ops.length + resets.length === 0) return { ok: true, result: readPluginConfig(port, live) }
  try {
    await port.mutate(row.ns, [...resets, ...ops], write.revision)
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'SETTINGS_CONFLICT') {
      return { ok: false, error: { code: 'conflict', message: '设置刚被别处改过，已重新读取' } }
    }
    return invalid(error instanceof Error ? error.message : String(error))
  }
  return { ok: true, result: readPluginConfig(port, live) }
}

/** 本插件那一行：id 对得上就是它；否则找字段正好是这几项的唯一一行。 */
function ownRow(rows: readonly SettingsRow[]): SettingsRow | undefined {
  const named = rows.find((row) => row.ns === WORKFLOW_LITE_ROW_ID)
  if (named !== undefined) return named
  const shaped = rows.filter((row) => {
    const value = asRecord(row.value)
    return PLUGIN_CONFIG_KEYS.every((key) => Object.hasOwn(value, key))
  })
  return shaped.length === 1 ? shaped[0] : undefined
}

function checkValue(key: PluginConfigKey, value: unknown): string | null {
  switch (key) {
    case 'dataDir':
      return typeof value === 'string' && value.trim() !== '' ? null : '数据目录不能为空'
    case 'installSkill':
      return typeof value === 'boolean' ? null : 'installSkill 要是开或关'
    case 'maxNodes':
      return isInt(value, 1) ? null : '步骤数上限至少是 1'
    case 'saveDebounceMs':
      return isInt(value, 0) ? null : '自动保存等待不能是负数'
    case 'maxResultBytes':
      return isInt(value, 1024) ? null : '读取上限至少 1 KB'
  }
}

function isInt(value: unknown, min: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
}

function isKey(key: unknown): key is PluginConfigKey {
  return typeof key === 'string' && (PLUGIN_CONFIG_KEYS as readonly string[]).includes(key)
}

function invalid(message: string): Outcome<never> {
  return { ok: false, error: { code: 'invalid_args', message } }
}

/** 从一份配置里挑出这几项；缺的或类型不对的用 `fallback` 的。 */
function pick(source: unknown, fallback: PluginConfigValues): PluginConfigValues {
  const record = asRecord(source)
  const out = { ...fallback }
  for (const key of PLUGIN_CONFIG_KEYS) {
    const value = record[key]
    if (typeof value === typeof fallback[key]) (out as Record<string, unknown>)[key] = value
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
