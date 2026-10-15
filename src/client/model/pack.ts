/**
 * dsh-workflow-lite — 导入导出页面上的算账：默认选哪些版本、清单怎么分组、勾了之后多大、
 * 导入时每个 skill 默认怎么办、确认卡上的汇总。纯函数，不碰 RPC。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/pack
 */

import type {
  PackApplyRequest,
  PackImportPreview,
  PackScanItem,
  PackScanResponse,
  PackSkillAction,
  PackSkillPreview,
} from '../../shared/pack.ts'
import type { ResourceKind, VersionEntry } from '../../shared/types.ts'

/** 导出默认带哪些版本：和现在一样的那版；没有就最新的那版。 */
export function defaultVersions(list: readonly VersionEntry[]): number[] {
  const usable = list.filter((entry) => entry.invalid !== true)
  const current = usable.find((entry) => entry.current)
  if (current !== undefined) return [current.n]
  const latest = usable.reduce<VersionEntry | undefined>(
    (best, entry) => (best === undefined || entry.n > best.n ? entry : best),
    undefined,
  )
  return latest === undefined ? [] : [latest.n]
}

/** 清单分组（呈现顺序）。 */
export interface ExportGroups {
  /** 能打包的：可以勾。 */
  packable: PackScanItem[]
  /** 本来想打、打不了的：找不到、太大。 */
  blocked: PackScanItem[]
  /** 原样引用：内置 skill、相对路径。 */
  kept: PackScanItem[]
  /** 已经在资料目录里的。 */
  assets: PackScanItem[]
  /** 产出（不用处理）。 */
  outputs: PackScanItem[]
}

export function exportGroups(scan: PackScanResponse): ExportGroups {
  const groups: ExportGroups = { packable: [], blocked: [], kept: [], assets: [], outputs: [] }
  for (const item of scan.items) {
    if (item.state === 'pack') groups.packable.push(item)
    else if (item.state === 'missing' || item.state === 'tooLarge') groups.blocked.push(item)
    else if (item.state === 'builtin' || item.state === 'relative') groups.kept.push(item)
    else if (item.state === 'assets') groups.assets.push(item)
    else if (item.state === 'output') groups.outputs.push(item)
  }
  return groups
}

/** 导出清单按资源种类分类展示（呈现顺序）。 */
export const PACK_CATEGORIES: readonly ResourceKind[] = ['skill', 'file', 'folder']

/** 能打包的几类，每类一个总开关：关着的那类整个不打包。 */
export type PackSwitch = 'skill' | 'file' | 'folder'
export type PackSwitches = Readonly<Record<PackSwitch, boolean>>

export function isSwitchable(kind: ResourceKind): kind is PackSwitch {
  return kind === 'skill' || kind === 'file' || kind === 'folder'
}

/** 不能勾的项按这个顺序排：打包不了的在前，原样保留的在后。 */
const OTHER_ORDER: readonly PackScanItem['state'][] = ['missing', 'tooLarge', 'builtin', 'relative']

/** 一类里的项：能勾的、其余的（只说明原因）。产出、资料目录里的不算外部资源，不列。 */
export function categoryItems(
  scan: PackScanResponse,
  kind: ResourceKind,
): { packable: PackScanItem[]; others: PackScanItem[] } {
  const of = scan.items.filter((item) => item.kind === kind)
  return {
    packable: of.filter((item) => item.state === 'pack'),
    others: of
      .filter((item) => OTHER_ORDER.includes(item.state))
      .sort((a, b) => OTHER_ORDER.indexOf(a.state) - OTHER_ORDER.indexOf(b.state)),
  }
}

/** 真正要打包的：逐项勾上的，再去掉总开关关着的那几类（逐项的勾选留着，开关打开就回来）。 */
export function effectivePack(
  scan: PackScanResponse,
  picked: ReadonlySet<string>,
  switches: PackSwitches,
): Set<string> {
  return new Set(
    scan.items
      .filter((item) => picked.has(item.key) && isSwitchable(item.kind) && switches[item.kind])
      .map((item) => item.key),
  )
}

/** 勾了这些之后包里一共多少字节（资料目录总是算进去）。 */
export function packedBytes(scan: PackScanResponse, picked: ReadonlySet<string>): number {
  let total = scan.assets?.bytes ?? 0
  for (const item of scan.items) {
    if (item.state === 'pack' && picked.has(item.key)) total += item.bytes ?? 0
  }
  return total
}

/** 没打包、留在图里的绝对路径（会带出本机的目录名）。 */
export function leftAbsolute(scan: PackScanResponse, picked: ReadonlySet<string>): number {
  return scan.items.filter(
    (item) =>
      item.kind !== 'skill' &&
      (item.state === 'missing' ||
        item.state === 'tooLarge' ||
        (item.state === 'pack' && !picked.has(item.key))),
  ).length
}

/** 一个 skill 默认怎么办：新的装，其余保留本机的。 */
export function defaultSkillAction(skill: PackSkillPreview): PackSkillAction {
  return skill.state === 'new' ? 'install' : 'skip'
}

/** 这个 skill 能选哪些处理方式（按呈现顺序）。 */
export function skillChoices(skill: PackSkillPreview): PackSkillAction[] {
  if (skill.state === 'same') return ['skip']
  if (skill.state === 'new') return ['install', 'skip']
  return skill.overwritable ? ['skip', 'overwrite', 'rename'] : ['skip', 'rename']
}

/** 装到哪（不装就是 `null`）。 */
export function skillDestination(
  preview: Pick<PackImportPreview, 'skillsRoot'>,
  skill: PackSkillPreview,
  action: PackSkillAction,
): string | null {
  if (action === 'skip') return null
  if (action === 'rename') return `${preview.skillsRoot}/${skill.rename}`
  return skill.target
}

/** 导入的落脚点：用户选的方式和名字。 */
export interface ImportChoice {
  mode: 'new' | 'merge'
  name: string
  assets: 'package' | 'local'
  skills: Record<string, PackSkillAction>
}

export function defaultImportChoice(preview: PackImportPreview): ImportChoice {
  return {
    mode: 'new',
    name: preview.exists ? preview.suggested : preview.name,
    assets: 'local',
    skills: Object.fromEntries(
      preview.skills.map((skill) => [skill.name, defaultSkillAction(skill)]),
    ),
  }
}

export function actionOf(choice: ImportChoice, skill: PackSkillPreview): PackSkillAction {
  const picked = choice.skills[skill.name] ?? defaultSkillAction(skill)
  return skillChoices(skill).includes(picked) ? picked : defaultSkillAction(skill)
}

/** 确认卡上的汇总。 */
export interface ImportSummary {
  versions: number
  assets: number
  /** 写进 ~/.agents/skills 的。 */
  skills: number
  /** 其中覆盖掉本机已有的。 */
  overwrite: number
}

export function importSummary(preview: PackImportPreview, choice: ImportChoice): ImportSummary {
  let skills = 0
  let overwrite = 0
  for (const skill of preview.skills) {
    const action = actionOf(choice, skill)
    if (action === 'skip') continue
    skills += 1
    if (action === 'overwrite') overwrite += 1
  }
  const kept = choice.mode === 'merge' && choice.assets === 'local' ? preview.clashes.length : 0
  return {
    versions: preview.versions.length,
    assets: preview.assets.length - kept,
    skills,
    overwrite,
  }
}

/** 发给主机的请求。 */
export function applyRequest(
  preview: PackImportPreview,
  choice: ImportChoice,
  scope: { cwd?: string; session?: string },
): PackApplyRequest {
  return {
    token: preview.token,
    mode: choice.mode,
    name: choice.mode === 'merge' ? preview.name : choice.name.trim(),
    assets: choice.assets,
    skills: Object.fromEntries(
      preview.skills.map((skill) => [skill.name, actionOf(choice, skill)]),
    ),
    ...scope,
  }
}

/** 字节 → base64（大数组分段转，免得 `String.fromCharCode(...)` 爆栈）。 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

export function fromBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
