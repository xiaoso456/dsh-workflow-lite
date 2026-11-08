/**
 * dsh-workflow-lite — 画布的 UI 文案。
 *
 * **客户端文案一律走 locale 词典**，命名空间与设置命名空间同一个串：`workflow-lite`。
 * 内置步骤的提示词正文也在这里：它会被插进文档、用户看得见也会改，属于用户可见字符串。
 *
 * 措辞口径：界面上不出现「节点 / 边 / 图」这些实现词，统一叫「步骤 / 连线 / 工作流」。
 *
 * 文案按功能分在 `i18n/` 下，每个文件同时放这一组的中文（`zh`）和英文（`en`）；
 * 这里把各组拼成完整的词典，所有调用方仍从本文件取 `zh` / `en` / `T`。
 * 同一个键只能出现在一个文件里，否则后面的会静默盖掉前面的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n
 */

import * as canvas from './i18n/canvas.ts'
import * as common from './i18n/common.ts'
import * as config from './i18n/config.ts'
import * as display from './i18n/display.ts'
import * as files from './i18n/files.ts'
import * as hub from './i18n/hub.ts'
import * as inputs from './i18n/inputs.ts'
import * as inspector from './i18n/inspector.ts'
import * as library from './i18n/library.ts'
import * as memory from './i18n/memory.ts'
import * as pack from './i18n/pack.ts'
import * as plan from './i18n/plan.ts'
import * as resources from './i18n/resources.ts'
import * as run from './i18n/run.ts'
import * as runState from './i18n/runState.ts'
import * as settings from './i18n/settings.ts'
import * as shell from './i18n/shell.ts'

export const NS = 'workflow-lite' as const

/** 中文（默认）。键名即契约，`en` 必须与之同构。 */
export const zh = {
  ...common.zh,
  ...shell.zh,
  ...settings.zh,
  ...library.zh,
  ...canvas.zh,
  ...inspector.zh,
  ...resources.zh,
  ...display.zh,
  ...files.zh,
  ...run.zh,
  ...runState.zh,
  ...hub.zh,
  ...config.zh,
  ...pack.zh,
  ...plan.zh,
  ...memory.zh,
  ...inputs.zh,
} as const

export type LocaleKey = keyof typeof zh

/** 组件拿到的翻译函数（槽位注入的 `t` 收窄到本插件的键）。 */
export type T = (key: LocaleKey) => string

/**
 * 把本插件的命名空间声明进槽位的 locale 表（官方范式）。
 * 少了这一段，`locale: NS` 与 `PropsLocale<typeof NS>` 都拿不到类型。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'workflow-lite': LocaleKey
  }
}

export const en: Record<LocaleKey, string> = {
  ...common.en,
  ...shell.en,
  ...settings.en,
  ...library.en,
  ...canvas.en,
  ...inspector.en,
  ...resources.en,
  ...display.en,
  ...files.en,
  ...run.en,
  ...runState.en,
  ...hub.en,
  ...config.en,
  ...pack.en,
  ...plan.en,
  ...memory.en,
  ...inputs.en,
}
