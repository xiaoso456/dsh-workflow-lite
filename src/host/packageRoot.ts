/**
 * dsh-workflow-lite — 本包在磁盘上的根目录（`package.json` 所在的那层）。
 *
 * 从模块所在目录往上找名字是本包的 `package.json`：构建后是 `lib/index.mjs` 的上一层，跑单测时是源码的上两层。
 * DSH 按普通 npm 包把插件装进 profile 的 `node_modules`，`files` 里列的目录都在这里。
 *
 * @module @xiaoso/dsh-workflow-lite/host/packageRoot
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = '@xiaoso/dsh-workflow-lite'
/** 最多往上找几层。 */
const MAX_DEPTH = 6

export interface PackageRoot {
  dir: string
  version: string
}

/** 找不到（被打进别的包里之类）回 `null`。 */
export function packageRoot(from: string = import.meta.url): PackageRoot | null {
  let dir = dirname(fileURLToPath(from))
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as unknown
      if (typeof raw === 'object' && raw !== null) {
        const { name, version } = raw as { name?: unknown; version?: unknown }
        if (name === PACKAGE_NAME)
          return { dir, version: typeof version === 'string' ? version : '' }
      }
    } catch {
      // 这一层没有：再往上找。
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
