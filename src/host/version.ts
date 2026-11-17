/**
 * dsh-workflow-lite — 插件自己的版本号（写进导出包的清单）。
 *
 * 读本包的 `package.json`（见 {@link packageRoot}）。找不到就是空串，不影响导出。
 *
 * @module @xiaoso/dsh-workflow-lite/host/version
 */

import { packageRoot } from './packageRoot.ts'

export function pluginVersion(from: string = import.meta.url): string {
  return packageRoot(from)?.version ?? ''
}
