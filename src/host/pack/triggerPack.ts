/**
 * dsh-workflow-lite — 导出时触发卡片那一块：盘点（有哪些卡片、各自有没有密钥和脚本数据）、改写各版本的图、挑 `triggers/` 下要带的文件。
 *
 * - 卡片：没勾的从包里各版本去掉；留下的连同开关原样带走（导入的人在预览里按它预选、再调整）；
 * - 触发脚本（`triggers/` 根上的、各卡片目录里的脚本和样本）：留下的卡片里有要跑命令的才整个带上，不按卡片拆；
 * - 各卡片的密钥（`secrets/`）、脚本数据（`data/`）：勾了才带（只限留下的卡片）；试运行数据（`data-test/`）从不带。
 *
 * 导入时列出用的那一版里的卡片（{@link previewTriggers}）：各自缺什么（工作区、固定会话、shell、服务商、模型、预设、权限）、带了几个密钥文件；
 * 导入的人逐张调整开关，当前那一版照选的开关写（{@link setSwitches}），打不开的一律关掉。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pack/triggerPack
 */

import { isTrigger } from '../../shared/model.ts'
import {
  type PackImportTrigger,
  type PackTrigger,
  type PackTriggerGap,
  type PackTriggerPreview,
  packsScripts,
} from '../../shared/pack.ts'
import { resolveSessionChoice } from '../../shared/sessionChoice.ts'
import { commandOf, launchMissing, launchOf, usesWorkspace } from '../../shared/trigger.ts'
import { triggerArea } from '../../shared/triggerDirs.ts'
import type { SessionChoice, TriggerData, WorkflowDocument } from '../../shared/types.ts'
import type { HostAgentsResponse } from '../../shared/wire/host.ts'
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

/** 包里一版的图：没留的卡片去掉，留下的照原样（开关也照原样）；没什么可改的原样返回。 */
export function packTriggers(
  document: WorkflowDocument,
  keep: ReadonlySet<string>,
): WorkflowDocument {
  if (!document.nodes.some((node) => isTrigger(node) && !keep.has(node.id))) return document
  return {
    ...document,
    nodes: document.nodes.filter((node) => !isTrigger(node) || keep.has(node.id)),
  }
}

/**
 * 导入时列出用的那一版里的卡片和各自缺的东西；没有卡片是 `null`。
 * @param catalog 取这台机器上的服务商、模型、预设、权限（有卡片用到才取，只取一次）；拿不到（`undefined`）时这几样不查。
 */
export async function previewTriggers(
  document: WorkflowDocument,
  assets: readonly string[],
  exists: (path: string) => Promise<boolean>,
  catalog: () => Promise<HostAgentsResponse | undefined>,
): Promise<PackTriggerPreview | null> {
  const nodes = document.nodes.filter(isTrigger)
  if (nodes.length === 0) return null
  let host: Promise<HostAgentsResponse | undefined> | undefined
  const cards: PackImportTrigger[] = []
  for (const node of nodes) {
    const { data } = node
    const choice = resolveSessionChoice(data.launch, document.settings)
    const used =
      choice.model !== undefined || choice.preset !== undefined || choice.permission !== undefined
    if (used) host ??= catalog()
    cards.push({
      node: node.id,
      label: data.label ?? '',
      kind: data.source.kind,
      enabled: data.enabled === true,
      gaps: [...(await placeGaps(data, exists)), ...(used ? choiceGaps(choice, await host) : [])],
    })
  }
  const secrets = assets.filter((path) => triggerArea(path)?.area === 'secrets').length
  return { cards, secrets }
}

/** 本机上的地方：固定会话是导出那台机器上的，这台一定要重新选；用到的工作区、选的 shell 要在这台机器上真有。 */
async function placeGaps(
  data: TriggerData,
  exists: (path: string) => Promise<boolean>,
): Promise<PackTriggerGap[]> {
  const gaps: PackTriggerGap[] = []
  const fixed = launchOf(data).session === 'fixed'
  if (fixed) gaps.push({ kind: 'session' })
  const needsWorkspace = !fixed || usesWorkspace(data)
  if (
    needsWorkspace &&
    (launchMissing(data) === 'workspace' ||
      (data.workspace !== undefined && !(await exists(data.workspace))))
  ) {
    gaps.push({ kind: 'workspace' })
  }
  if (data.shell !== undefined && data.shell !== '' && !(await exists(data.shell))) {
    gaps.push({ kind: 'shell', path: data.shell })
  }
  return gaps
}

/** 新建会话用的设置（卡片写了的用卡片的，否则用工作流的）里，这台机器上没有的服务商、模型、预设、权限。 */
function choiceGaps(
  choice: SessionChoice,
  catalog: HostAgentsResponse | undefined,
): PackTriggerGap[] {
  if (catalog === undefined || catalog.unavailable !== undefined) return []
  const gaps: PackTriggerGap[] = []
  const { model, preset, permission } = choice
  // 这个 DSH 不能只给一个会话换模型时，模型本来就不用；一个服务商都列不出来、或这个服务商读不出模型列表时查不了。
  if (
    model !== undefined &&
    catalog.modelSelectable !== false &&
    catalog.providers.length + catalog.failures.length > 0 &&
    !catalog.failures.some((failure) => failure.id === model.provider)
  ) {
    const provider = catalog.providers.find((entry) => entry.id === model.provider)
    if (provider === undefined) gaps.push({ kind: 'provider', provider: model.provider })
    else if (!provider.models.some((entry) => entry.id === model.model)) {
      gaps.push({ kind: 'model', provider: provider.name, model: model.model })
    }
  }
  if (preset !== undefined && !catalog.presets.some((entry) => entry.id === preset)) {
    gaps.push({ kind: 'preset', preset })
  }
  if (
    permission !== undefined &&
    catalog.permissions !== undefined &&
    !catalog.permissions.options.some((entry) => entry.id === permission)
  ) {
    gaps.push({ kind: 'permission', permission })
  }
  return gaps
}

/** 触发卡片的开关照 `on` 写：在里面的开、不在的关；别的节点不动，没什么可改的原样返回。 */
export function setSwitches(document: WorkflowDocument, on: ReadonlySet<string>): WorkflowDocument {
  const differs = (node: WorkflowDocument['nodes'][number]): boolean =>
    isTrigger(node) && (node.data.enabled === true) !== on.has(node.id)
  if (!document.nodes.some(differs)) return document
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!isTrigger(node) || !differs(node)) return node
      if (on.has(node.id)) return { ...node, data: { ...node.data, enabled: true } }
      const { enabled: _enabled, ...data } = node.data
      return { ...node, data }
    }),
  }
}
