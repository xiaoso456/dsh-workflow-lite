/**
 * dsh-workflow-lite — 资源在界面上的样子：每种内容的图标与名字、一项内容的简短写法、起名与查重。
 *
 * 画布的资源卡、属性面板、实例视图都从这里取，同一种内容到哪儿都是同一个图标、同一种写法。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/resourceUi
 */

import { idKey, isInput, isResource, itemShortName } from '../../shared/model.ts'
import { outputKey, resolveItemPath } from '../../shared/outputPaths.ts'
import { resourceTitle } from '../../shared/resources.ts'
import type {
  ResourceItem,
  ResourceKind,
  WorkflowDocument,
  WorkflowNode,
} from '../../shared/types.ts'
import type { HostSkillEntry } from '../../shared/wire.ts'
import type { LocaleKey } from '../i18n.ts'
import type { IconName } from './Icon.tsx'

/** 呈现顺序 = 「添加」菜单里的顺序。 */
export const KIND_ORDER: readonly ResourceKind[] = ['file', 'folder', 'url', 'skill', 'text']

export const KIND_ICON: Record<ResourceKind, IconName> = {
  file: 'file',
  folder: 'folder',
  url: 'globe',
  skill: 'sparkle',
  text: 'note',
}

export const KIND_LABEL: Record<ResourceKind, LocaleKey> = {
  file: 'res.kind.file',
  folder: 'res.kind.folder',
  url: 'res.kind.url',
  skill: 'res.kind.skill',
  text: 'res.kind.text',
}

/** 卡片上一项的写法：文件与文件夹取最后一段，网址去掉协议，自定义取第一行。 */
export function itemText(item: ResourceItem): string {
  const value = item.value.trim()
  if (value === '') return ''
  if (item.kind === 'url') return value.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '').replace(/\/$/u, '')
  if (item.kind === 'text') return value.split(/\r?\n/u)[0]?.trim() ?? ''
  return itemShortName(item)
}

/** 面板清单里一项的名字：网址只取主机名（整条网址放在下面一行），其余同 {@link itemText}。 */
export function itemName(item: ResourceItem): string {
  if (item.kind === 'url' && item.value.trim() !== '') return itemShortName(item)
  return itemText(item)
}

/**
 * 面板清单里一项的位置（名字下面那一行）：文件与文件夹是路径（相对路径有步骤写它时换成产出根目录下的
 * 实际位置），网址是整条网址；Skill 与自定义没有位置（空串，界面上写种类）。
 */
export function itemLocation(
  item: ResourceItem,
  root: string | undefined,
  written: boolean,
): { text: string; mono: boolean } {
  const value = item.value.trim()
  if (value === '') return { text: '', mono: false }
  if (item.kind === 'file' || item.kind === 'folder') {
    return { text: resolveItemPath(root, value, written), mono: true }
  }
  if (item.kind === 'url') return { text: value, mono: false }
  return { text: '', mono: false }
}

/** 往资源里加几项：空值照加（等着填），和已有的重复的跳过，满了就停。 */
export function addItems(
  items: readonly ResourceItem[],
  fresh: readonly ResourceItem[],
  max: number,
): ResourceItem[] {
  const next = [...items]
  for (const item of fresh) {
    if (item.value.trim() !== '' && next.some((other) => sameItem(other, item))) continue
    if (next.length >= max) break
    next.push(item)
  }
  return next
}

const SKILL_SOURCES: Record<string, { short: LocaleKey; full: LocaleKey }> = {
  'project-dsh': { short: 'skill.src.project', full: 'skill.from.projectDsh' },
  'project-agents': { short: 'skill.src.project', full: 'skill.from.projectAgents' },
  'user-dsh': { short: 'skill.src.user', full: 'skill.from.userDsh' },
  'user-agents': { short: 'skill.src.user', full: 'skill.from.userAgents' },
  runtime: { short: 'skill.src.runtime', full: 'skill.from.runtime' },
  bundled: { short: 'skill.src.bundled', full: 'skill.from.bundled' },
  custom: { short: 'skill.src.custom', full: 'skill.from.custom' },
}

/** 筛选 skill：名字或说明里有这几个字（不分大小写）。 */
export function filterSkills(
  skills: readonly HostSkillEntry[],
  filter: string,
): readonly HostSkillEntry[] {
  const needle = filter.trim().toLowerCase()
  if (needle === '') return skills
  return skills.filter(
    (entry) =>
      entry.name.toLowerCase().includes(needle) || entry.description.toLowerCase().includes(needle),
  )
}

/** skill 从哪来，给人看的两种说法（清单里的小签、预览里的全称）；不认识的来源原样给。 */
export function skillSource(
  source: string,
  t: (key: LocaleKey) => string,
): { short: string; full: string } {
  const known = Object.hasOwn(SKILL_SOURCES, source) ? SKILL_SOURCES[source] : undefined
  return known === undefined
    ? { short: source, full: source }
    : { short: t(known.short), full: t(known.full) }
}

/** 节点的显示名：步骤取名称，资源取名字（没有就第一项），输入取问题。 */
export function stepName(node: WorkflowNode | undefined, fallback: string): string {
  if (node === undefined) return fallback
  if (isResource(node)) return resourceTitle(node)
  if (isInput(node)) return node.data.question.trim() === '' ? node.id : node.data.question
  return node.data.label === undefined || node.data.label === '' ? node.id : node.data.label
}

/** 路径的最后一段（卡片标题里放不下整条路径）。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/u).filter((part) => part !== '' && part !== '.')
  return parts[parts.length - 1] ?? path
}

/** 图里没被资源占用的文件路径：`x.md` 被占了就 `x-2.md`、`x-3.md`… */
export function freeFilePath(doc: WorkflowDocument, want: string): string {
  const taken = new Set(
    doc.nodes.flatMap((node) =>
      isResource(node)
        ? node.data.items
            .filter((item) => item.kind === 'file')
            .map((item) => outputKey(item.value).toLowerCase())
        : [],
    ),
  )
  if (!taken.has(outputKey(want).toLowerCase())) return want
  const dot = want.lastIndexOf('.')
  const cut = dot > 0 ? dot : want.length
  for (let n = 2; ; n += 1) {
    const candidate = `${want.slice(0, cut)}-${n}${want.slice(cut)}`
    if (!taken.has(outputKey(candidate).toLowerCase())) return candidate
  }
}

/** 同一个资源里两项是不是重复（种类相同、值规范化后相同）。 */
export function sameItem(a: ResourceItem, b: ResourceItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'file' || a.kind === 'folder') {
    return outputKey(a.value).toLowerCase() === outputKey(b.value).toLowerCase()
  }
  return a.value.trim() === b.value.trim()
}

/** 是不是同一个节点。 */
export function sameId(a: string, b: string): boolean {
  return idKey(a) === idKey(b)
}
