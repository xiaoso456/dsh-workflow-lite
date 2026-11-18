/**
 * dsh-workflow-lite — 工作流目录 `triggers/` 下的脚本在上一次 `test_trigger` 之后改过没有。
 *
 * 模型改了脚本却没再试就打开，是事件行没带 `::trigger::`、启动就打事件这类问题漏到真触发里的主要路子；
 * 读、写卡片的结果里据此提醒它再试一遍（`retest`，不算打开前还差的）。只看 `triggers/` 这一层的文件（`package.json` 之类也算），
 * 不进子目录（`node_modules` 不用看）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/scriptAge
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 工作流目录里放触发脚本的那一层。 */
export const SCRIPTS_DIR = 'triggers'

/** `dir/triggers/` 下修改时刻晚于 `since` 的文件名（按名字排）；目录不在时是空的。 */
export async function changedScripts(dir: string, since: number): Promise<string[]> {
  const root = join(dir, SCRIPTS_DIR)
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const changed: string[] = []
  for (const name of names) {
    try {
      const info = await stat(join(root, name))
      if (info.isFile() && info.mtimeMs > since) changed.push(name)
    } catch {
      // 刚被删掉：不算。
    }
  }
  return changed.sort()
}
