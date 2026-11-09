/**
 * dsh-workflow-lite — 计划的「资源」一节：总览、资源里每一项的写法、记忆与画布展示。
 *
 * 派发版只写位置——说明和自定义内容在任务描述里；整卷版没有任务描述，逐项带上说明。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/compile/resources
 */

import { displayBrief, displayOf } from '../display.ts'
import { PLAN_SECTIONS } from '../limits.ts'
import { resourceIdFor } from '../model.ts'
import { resolveItemPath } from '../outputPaths.ts'
import { skillPath } from '../pathVars.ts'
import { memoryOf, memoryPrompt } from '../presets.ts'
import { isShared, underOutputRoot } from '../resources.ts'
import { SKILL_PATHS } from '../skillPack.ts'
import type { ResourceItem, ResourceNode } from '../types.ts'
import { nonEmptyResources, type RenderContext } from './context.ts'
import { code, quoteLines } from './format.ts'

/** 「资源」的开头一句（派发版：说明在任务描述里；整卷版：说明就在下面）。 */
const RESOURCES_INTRO =
  '每个步骤读写的资源（路径与说明）都附在它的任务描述末尾，执行者读任务描述就能拿到，不要另行转述。下面是总览：'
const FULL_RESOURCES_INTRO = '各步骤读写的资源，路径已拼好，说明就是读写它的规格：'

/**
 * 资源：「流程」表里那些资源 id 指的是什么，按 id 码位序，一个资源一行。谁读谁写看「流程」表，这里不重复；
 * 交给所有步骤的（一条线都没连）表里没有，在这里注明。派发版只写位置——说明和自定义内容在任务描述里；
 * 整卷版没有任务描述，逐项带上说明，多行的逐行引用。
 */
export function resourcesSection(ctx: RenderContext, inline: boolean): string {
  const infos = nonEmptyResources(ctx)
  if (infos.length === 0) return ''
  const lines = [PLAN_SECTIONS.resources, inline ? FULL_RESOURCES_INTRO : RESOURCES_INTRO]
  for (const info of infos) {
    const name = resourceName(info.resource)
    const shared = !isShared(info)
      ? ''
      : memoryOf(info.resource.data) !== undefined
        ? '（全局记忆，交给所有步骤）'
        : '（交给所有步骤）'
    const written = underOutputRoot(info)
    if (memoryOf(info.resource.data) !== undefined) {
      // 记忆：派发版里步骤的记忆只写位置（说明在任务描述里）；全局记忆、整卷版带上说明。
      const full = inline || isShared(info)
      if (!full) {
        lines.push(`- ${name}${shared}：${memoryBrief(ctx, info.resource)}`)
        continue
      }
      lines.push(`- ${name}${shared}：`, ...memoryLines(ctx, info.resource, true, '  '))
      continue
    }
    const items = info.resource.data.items
    if (!inline) {
      const brief = items.map((item) => briefItem(ctx, item, written))
      lines.push(`- ${name}${shared}：${brief.join('；')}`)
      continue
    }
    const display = info.writers.length === 0 ? null : displayLine(ctx, info.resource, written)
    const [only, ...more] = items
    if (only !== undefined && more.length === 0) {
      // 只有一项：接在资源名后面，不再套一层列表。
      const [first = '', ...rest] = itemLines(ctx, only, written, true, '')
      lines.push(`- ${name}${shared}：${first.slice(2)}`, ...rest)
    } else {
      lines.push(`- ${name}${shared}：`)
      for (const item of items) {
        lines.push(...itemLines(ctx, item, written, true, '  '))
      }
    }
    if (display !== null) lines.push(`  - ${display}`)
  }
  return lines.join('\n')
}

/** 资源在计划里的称呼：`id`，有名字就跟在括号里。 */
export function resourceName(resource: ResourceNode): string {
  const label = resource.data.label?.trim()
  // id 就是照名字起的（`res-` + 名字）：再括一遍名字只是重复。
  const derived =
    label !== undefined && resourceIdFor({ label, items: [] }, () => false) === resource.id
  return label === undefined || label === '' || derived
    ? code(resource.id)
    : `${code(resource.id)}（${label}）`
}

/**
 * 总览里的一项：只写种类与位置。打包的 skill 标「在包里」（怎么读写在「约定」里）；
 * 自定义内容不抄，它附在任务描述里。
 */
function briefItem(ctx: RenderContext, item: ResourceItem, written: boolean): string {
  const value = item.value.trim()
  switch (item.kind) {
    case 'file':
      return `文件 ${code(resolveItemPath(ctx.root, value, written))}`
    case 'folder':
      return `文件夹 ${code(resolveItemPath(ctx.root, value, written))}`
    case 'url':
      return `网址 ${value}`
    case 'skill':
      return ctx.skill?.bundled.has(value) === true
        ? `Skill ${code(value)}（在包里）`
        : `Skill ${code(value)}`
    default:
      return '自定义内容（附在任务描述里）'
  }
}

/** 资源里一项的种类与位置：`文件：路径` / `网址：…` / `Skill：名字（怎么加载）` / `自定义：一行内容`。 */
function itemHead(ctx: RenderContext, item: ResourceItem, written: boolean): string {
  const value = item.value.trim()
  switch (item.kind) {
    case 'file':
      return `文件：${code(resolveItemPath(ctx.root, value, written))}`
    case 'folder':
      return `文件夹：${code(resolveItemPath(ctx.root, value, written))}`
    case 'url':
      return `网址：${value}`
    case 'skill': {
      if (ctx.skill?.bundled.has(value) !== true)
        return `Skill：${code(value)}（${ctx.dialect.loadSkill}）`
      const dir = skillPath(SKILL_PATHS.skill(value, '')).replace(/\/$/u, '')
      return `Skill：${code(value)}（在包里：先读 ${code(`${dir}/SKILL.md`)}，它里面的相对路径相对 ${code(`${dir}/`)}）`
    }
    default:
      return `自定义：${value}`
  }
}

/**
 * 资源里的一项，写成列表项（`indent` 是列表的缩进）：种类与位置，`withNote` 时说明跟在后面；
 * 多行的说明、多行的自定义内容逐行引用——标题、表格、分区压成一行就看不清了。
 */
function itemLines(
  ctx: RenderContext,
  item: ResourceItem,
  written: boolean,
  withNote: boolean,
  indent: string,
): string[] {
  if (item.kind === 'text') {
    const text = item.value.trim()
    if (!text.includes('\n')) return [`${indent}- 自定义：${text}`]
    return [`${indent}- 自定义：`, ...quoteLines(text, `${indent}  `)]
  }
  const head = `${indent}- ${itemHead(ctx, item, written)}`
  return withNoteLines(head, withNote ? (item.note?.trim() ?? '') : '', indent)
}

/** 列表项后面接说明：一行的接在句号后面，多行的逐行引用。 */
function withNoteLines(head: string, note: string, indent: string): string[] {
  if (note === '') return [head]
  if (!note.includes('\n')) return [`${head}。说明：${note}`]
  return [`${head}。说明：`, ...quoteLines(note, `${indent}  `)]
}

/**
 * 一个资源的内容，放在任务描述里它自己的小标题下面：只有一项时不套列表——种类与位置一行，
 * 多行的说明空一行后逐行引用；几项的逐项列出。自定义内容直接引用。
 */
export function itemBlock(ctx: RenderContext, resource: ResourceNode, written: boolean): string[] {
  const [first, ...others] = resource.data.items
  if (first === undefined) return []
  if (others.length > 0) {
    return resource.data.items.flatMap((item) => itemLines(ctx, item, written, true, ''))
  }
  if (first.kind === 'text') return quoteLines(first.value.trim(), '')
  const head = itemHead(ctx, first, written)
  const note = first.note?.trim() ?? ''
  if (note === '') return [head]
  if (!note.includes('\n')) return [`${head}。说明：${note}`]
  return [`${head}。说明：`, '', ...quoteLines(note, '')]
}

/**
 * 给写它的步骤的「画布展示」：资源开了展示、展示的是文件或文件夹、适配没关时才有（措辞在口径里，通用口径没有）。
 * 资源里不止一项时点明展示的是哪一项。
 */
export function displayLine(
  ctx: RenderContext,
  resource: ResourceNode,
  written: boolean,
): string | null {
  const display = displayOf(resource.data)
  if (display === null || !display.adapt) return null
  const item = resource.data.items[display.item]
  if (item?.kind !== 'file' && item?.kind !== 'folder') return null
  const target =
    resource.data.items.length === 1
      ? undefined
      : code(resolveItemPath(ctx.root, item.value.trim(), written))
  return ctx.dialect.display(displayBrief(display, item.value.trim()), target)
}

/** 记忆目录（skill 目录）的位置（在记忆库里，不拼产出根目录），去掉尾斜杠。 */
function memoryDir(ctx: RenderContext, resource: ResourceNode): string {
  const value = resource.data.items[0]?.value.trim() ?? ''
  return resolveItemPath(ctx.root, value, false).replace(/\/+$/u, '')
}

/** 总览里的记忆：只写位置。 */
function memoryBrief(ctx: RenderContext, resource: ResourceNode): string {
  return `记忆目录 ${code(memoryDir(ctx, resource))}`
}

/**
 * 记忆：目录的位置，说明跟在下面（没改过的用默认的）。
 * `withNotes` 为假时只给位置（任务描述里的全局记忆）。
 */
export function memoryLines(
  ctx: RenderContext,
  resource: ResourceNode,
  withNotes: boolean,
  indent: string,
): string[] {
  const dir = memoryDir(ctx, resource)
  return withNoteLines(
    `${indent}- 记忆目录：${code(dir)}`,
    withNotes ? memoryPrompt(resource.data) : '',
    indent,
  )
}
