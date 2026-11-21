/**
 * dsh-workflow-lite — 导出时触发卡片那一块：盘点（有哪些卡片、各自有没有密钥和脚本数据）、改写各版本的图、挑 `triggers/` 下要带的文件。
 *
 * - 卡片：缺省全留，没勾的从包里各版本去掉；留下的开关一律存成关（导入的人自己打开）；
 * - 触发脚本（`triggers/` 根上的、各卡片目录里的脚本和样本）：留下的卡片里有要跑命令的才整个带上，不按卡片拆；
 * - 各卡片的密钥（`secrets/`）、脚本数据（`data/`）：勾了才带（只限留下的卡片）；试运行数据（`data-test/`）从不带。
 *
 * 导入时给一份提醒（{@link previewTriggers}）：几张卡片、哪些要重新选工作区或会话、带了几个密钥文件。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pack/triggerPack
 */

import { isTrigger } from '../../shared/model.ts'
import { type PackTrigger, type PackTriggerPreview, packsScripts } from '../../shared/pack.ts'
import { commandOf, launchOf, withSwitchesOff } from '../../shared/trigger.ts'
import { triggerArea } from '../../shared/triggerDirs.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import type { Tree, TreeFile } from './tree.ts'

/** 工作流目录分成两块：触发器那一块（`triggers/` 下）和别的。 */
export function splitAssets(tree: Tree): { rest: Tree; triggers: TreeFile[] } {
  const rest: TreeFile[] = []
  const triggers: TreeFile[] = []
  for (const file of tree.files) (triggerArea(file.rel) === null ? rest : triggers).push(file)
  return {
    rest: { ...tree, files: rest, bytes: rest.reduce((sum, file) => sum + file.bytes, 0) },
    triggers,
  }
}

/** 盘点选中版本里的触发卡片（按 id 合并，名字和触发方式取最新那版的）和它们目录里的东西。 */
export function scanTriggers(
  versions: readonly { n: number; document: WorkflowDocument }[],
  files: readonly TreeFile[],
): { triggers: PackTrigger[]; scripts: { files: number; bytes: number } | null } {
  const cards = new Map<string, PackTrigger>()
  for (const { n, document } of [...versions].sort((a, b) => a.n - b.n)) {
    for (const node of document.nodes) {
      if (!isTrigger(node)) continue
      const seen = cards.get(node.id)
      cards.set(node.id, {
        node: node.id,
        label: node.data.label ?? '',
        source: node.data.source,
        command: (seen?.command ?? false) || commandOf(node.data.source) !== undefined,
        versions: [...(seen?.versions ?? []), n],
      })
    }
  }
  const scripts = { files: 0, bytes: 0 }
  for (const file of files) {
    const place = triggerArea(file.rel)
    if (place === null || place.area === 'trial') continue
    if (place.area === 'script') {
      scripts.files += 1
      scripts.bytes += file.bytes
      continue
    }
    const card = cards.get(place.node)
    if (card === undefined) continue
    if (place.area === 'secrets') {
      const name = file.rel.split('/').slice(3).join('/')
      card.secrets = {
        names: [...(card.secrets?.names ?? []), name],
        bytes: (card.secrets?.bytes ?? 0) + file.bytes,
      }
    } else {
      card.data = {
        files: (card.data?.files ?? 0) + 1,
        bytes: (card.data?.bytes ?? 0) + file.bytes,
      }
    }
  }
  return { triggers: [...cards.values()], scripts: scripts.files === 0 ? null : scripts }
}

/** 导出时触发卡片怎么处理。 */
export interface TriggerPick {
  /** 留下的卡片。 */
  keep: ReadonlySet<string>
  /** 带上密钥的卡片。 */
  secrets: ReadonlySet<string>
  /** 带上脚本数据的卡片。 */
  data: ReadonlySet<string>
}

/** `triggers/` 下要带进包的文件。 */
export function pickTriggerFiles(
  files: readonly TreeFile[],
  triggers: readonly PackTrigger[],
  pick: TriggerPick,
): TreeFile[] {
  const scripts = packsScripts(triggers, pick.keep)
  return files.filter((file) => {
    const place = triggerArea(file.rel)
    if (place === null) return false
    if (place.area === 'script') return scripts
    if (!pick.keep.has(place.node)) return false
    if (place.area === 'secrets') return pick.secrets.has(place.node)
    if (place.area === 'data') return pick.data.has(place.node)
    return false
  })
}

/** 包里一版的图：没留的卡片去掉，留下的开关存成关；没什么可改的原样返回。 */
export function packTriggers(
  document: WorkflowDocument,
  keep: ReadonlySet<string>,
): WorkflowDocument {
  const dropped = document.nodes.some((node) => isTrigger(node) && !keep.has(node.id))
  const kept = dropped
    ? { ...document, nodes: document.nodes.filter((node) => !isTrigger(node) || keep.has(node.id)) }
    : document
  return withSwitchesOff(kept)
}

/** 导入时的提醒：用的那一版里的卡片；没有卡片是 `null`。 */
export async function previewTriggers(
  document: WorkflowDocument,
  assets: readonly string[],
  exists: (path: string) => Promise<boolean>,
): Promise<PackTriggerPreview | null> {
  const cards = document.nodes.filter(isTrigger)
  if (cards.length === 0) return null
  let workspaceMissing = 0
  let fixed = 0
  for (const card of cards) {
    if (launchOf(card.data).session === 'fixed') fixed += 1
    const { workspace } = card.data
    if (workspace !== undefined && !(await exists(workspace))) workspaceMissing += 1
  }
  const secrets = assets.filter((path) => triggerArea(path)?.area === 'secrets').length
  return { cards: cards.length, workspaceMissing, fixed, secrets }
}
