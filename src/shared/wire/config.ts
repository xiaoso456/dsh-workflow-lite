/**
 * dsh-workflow-lite — 线格式：`config/*` 端点形状：工作流中心「设置」页的插件设置。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/config
 */

// ── 插件设置（工作流中心「设置」页）──────────────────────

/** 设置页能改的几项（插件 Config 里给人用的那几个，`routePrefix` 这类接线细节不露）。 */
export const PLUGIN_CONFIG_KEYS = [
  'dataDir',
  'maxNodes',
  'saveDebounceMs',
  'maxResultBytes',
  'installSkill',
] as const
export type PluginConfigKey = (typeof PLUGIN_CONFIG_KEYS)[number]

export interface PluginConfigValues {
  dataDir: string
  maxNodes: number
  saveDebounceMs: number
  maxResultBytes: number
  installSkill: boolean
}

/** 要重启 DSH 才生效的几项（装配时定住的）。 */
export const RESTART_CONFIG_KEYS: readonly PluginConfigKey[] = ['dataDir', 'installSkill']

/**
 * `config/get` / `config/set` 的回答。`available: false` = 这个 DSH 没有设置服务，页面只读地显示现值。
 * `defaults` 是去掉用户改动后的值（schema 默认值，或 profile 里更底层给的值），「恢复默认」就回到它。
 */
export interface PluginConfigView {
  available: boolean
  writable: boolean
  revision: number
  values: PluginConfigValues
  defaults: PluginConfigValues
  /** 用户改过的那几项。 */
  overridden: PluginConfigKey[]
}

/** `config/set`：改几项、把几项恢复默认；`revision` 是读到时的修订号，别人先改了就拒绝。 */
export interface PluginConfigWrite {
  revision: number
  set?: Partial<PluginConfigValues>
  reset?: PluginConfigKey[]
}
