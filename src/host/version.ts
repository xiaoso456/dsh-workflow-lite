/**
 * dsh-workflow-lite — 插件自己的版本号（写进导出包的清单）。
 *
 * 从模块所在目录往上找本包的 `package.json`：构建后是 `lib/index.mjs` 的上一层，跑单测时是源码的上两层。
 * 找不到（被打进别的包里之类）就是空串，不影响导出。
 *
 * @module @xiaoso/dsh-workflow-lite/host/version
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = '@xiaoso/dsh-workflow-lite'

export function pluginVersion(from: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(from))
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as unknown
      if (typeof raw === 'object' && raw !== null) {
        const { name, version } = raw as { name?: unknown; version?: unknown }
        if (name === PACKAGE_NAME && typeof version === 'string') return version
      }
    } catch {
      // 这一层没有：再往上找。
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ''
}
