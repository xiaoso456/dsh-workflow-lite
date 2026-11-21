/**
 * dsh-workflow-lite — 一张卡片的脚本在上一次 `test_trigger` 之后改过没有。
 *
 * 模型改了脚本却没再试就打开，是事件行没带 `::trigger::`、启动就打事件这类问题漏到真触发里的主要路子；
 * 读、写卡片的结果里据此提醒它再试一遍（`retest`，不算打开前还差的）。
 * 看两层：`triggers/` 根上的文件（共用的底子、`package.json` 之类）和这张卡片目录里的文件；
 * 不进子目录（脚本自己的数据、密钥、样本、`node_modules` 都不用看）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/scriptAge
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { cardDir, scriptsDir } from './cardDirs.ts'

/** 修改时刻晚于 `since` 的文件（相对 `triggers/`，卡片目录里的带上 `<卡片>/`，按名字排）；目录不在时是空的。 */
export async function changedScripts(
  workflowDir: string,
  node: string,
  since: number,
): Promise<string[]> {
  const changed = [
    ...(await changedIn(scriptsDir(workflowDir), since)),
    ...(await changedIn(cardDir(workflowDir, node), since)).map((name) => `${node}/${name}`),
  ]
  return changed.sort()
}

async function changedIn(dir: string, since: number): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const changed: string[] = []
  for (const name of names) {
    try {
      const info = await stat(join(dir, name))
      if (info.isFile() && info.mtimeMs > since) changed.push(name)
    } catch {
      // 刚被删掉：不算。
    }
  }
  return changed
}
