/**
 * dsh-workflow-lite — `write_resource` / `write_node` 里资源与画布展示（`display`）参数的转换。
 *
 * 只收形状与类型对得上的字段；取值范围由仓储里的 `applyDisplay` / `readView` 再把关。
 * @module @xiaoso/dsh-workflow-lite/host/tool/resourceArgs
 */

import {
  type DisplaySpec,
  FOLDER_ORDER_CHOICES,
  LOOK_CHOICES,
  VIEW_SIZE_KEYS,
} from '../../shared/display.ts'
import type { ResourceItem } from '../../shared/types.ts'
import {
  FOLDER_SHOWS,
  GALLERY_LAYOUTS,
  RESOURCE_KINDS,
  VIEW_FITS,
  VIEW_FROMS,
} from '../../shared/types.ts'
import type { ResourceUpsert } from '../store/repoNodes.ts'
import type { ResourceArgs } from './args.ts'

/** write_resource 的 resource 参数 → 仓储的入参。形状不对就回一句给模型看的错。 */
export function resourceUpsertOf(
  node: string | undefined,
  input: ResourceArgs,
): ResourceUpsert | string {
  const upsert: ResourceUpsert = node === undefined || node === '' ? {} : { id: node }
  for (const key of ['label', 'description'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'string') return `resource.${key} 必须是文字`
    upsert[key] = value
  }
  if (input.items !== undefined) {
    if (!Array.isArray(input.items)) return 'resource.items 要写成 [{ kind, value, note }]'
    const items: ResourceItem[] = []
    for (const [index, raw] of input.items.entries()) {
      if (typeof raw !== 'object' || raw === null)
        return `resource.items[${index}] 要写成 { kind, value }`
      const kind = RESOURCE_KINDS.find((candidate) => candidate === raw.kind)
      if (kind === undefined) {
        return `resource.items[${index}].kind 不认识：${String(raw.kind)}（可选：${RESOURCE_KINDS.join(' / ')}）`
      }
      if (typeof raw.value !== 'string') return `resource.items[${index}].value 必须是文字`
      if (raw.note !== undefined && typeof raw.note !== 'string') {
        return `resource.items[${index}].note 必须是文字`
      }
      items.push(
        raw.note === undefined
          ? { kind, value: raw.value }
          : { kind, value: raw.value, note: raw.note },
      )
    }
    upsert.items = items
  }
  if (input.display !== undefined) {
    const display = displaySpecOf(input.display, 'resource.display')
    if (typeof display === 'string') return display
    upsert.display = display
  }
  return upsert
}

/** `display` 参数 → 展示设置的改动。形状不对就回一句给模型看的错（取值范围由 `applyDisplay` 再把关）。 */
export function displaySpecOf(raw: unknown, where: string): DisplaySpec | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `${where} 要写成 { size, width, height, zoom, fit, item, adapt, look, hideTitle, lines, table, folder } 或 { show: false }`
  }
  const input = raw as Record<string, unknown>
  const spec: DisplaySpec = {}
  for (const key of ['show', 'adapt', 'hideTitle'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'boolean') return `${where}.${key} 必须是 true / false`
    spec[key] = input[key]
  }
  for (const key of ['width', 'height', 'zoom', 'item'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) {
      return `${where}.${key} 必须是数字`
    }
    spec[key] = input[key]
  }
  if (input.size !== undefined) {
    const size = VIEW_SIZE_KEYS.find((candidate) => candidate === input.size)
    if (size === undefined) {
      return `${where}.size 不认识：${String(input.size)}（可选：${VIEW_SIZE_KEYS.join(' / ')}）`
    }
    spec.size = size
  }
  if (input.fit !== undefined) {
    const fit = VIEW_FITS.find((candidate) => candidate === input.fit)
    if (fit === undefined) {
      return `${where}.fit 不认识：${String(input.fit)}（可选：${VIEW_FITS.join(' / ')}）`
    }
    spec.fit = fit
  }
  if (input.look !== undefined) {
    const look = LOOK_CHOICES.find((candidate) => candidate === input.look)
    if (look === undefined) {
      return `${where}.look 不认识：${String(input.look)}（可选：${LOOK_CHOICES.join(' / ')}）`
    }
    spec.look = look
  }
  for (const key of ['lines', 'table', 'folder'] as const) {
    if (input[key] === undefined) continue
    const group = displayGroupOf(input[key], DISPLAY_GROUPS[key], `${where}.${key}`)
    if (typeof group === 'string') return group
    spec[key] = group
  }
  return spec
}

/** `display` 里三组内容设置各自认哪些字段：类型名，或可选值。 */
const DISPLAY_GROUPS = {
  lines: { from: VIEW_FROMS, filter: 'string', regex: 'boolean', context: 'number' },
  table: { from: VIEW_FROMS, hide: 'strings', sort: 'string', desc: 'boolean', bars: 'boolean' },
  folder: {
    show: FOLDER_SHOWS,
    layout: GALLERY_LAYOUTS,
    order: FOLDER_ORDER_CHOICES,
    match: 'string',
  },
} as const

type GroupField = 'string' | 'strings' | 'boolean' | 'number' | readonly string[]

/** 一组内容设置：字段认得、类型对得上才收（取值范围由 `applyDisplay` / `readView` 再把关）。 */
function displayGroupOf(
  raw: unknown,
  fields: Readonly<Record<string, GroupField>>,
  where: string,
): Record<string, never> | string {
  const names = Object.keys(fields).join(' / ')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `${where} 要写成对象（可写：${names}）`
  }
  for (const [key, value] of Object.entries(raw)) {
    const field = fields[key]
    if (value === undefined) continue
    if (field === undefined) return `${where}.${key} 不认识（可写：${names}）`
    if (typeof field !== 'string') {
      if (!field.includes(value as string)) {
        return `${where}.${key} 不认识：${String(value)}（可选：${field.join(' / ')}）`
      }
    } else if (field === 'strings') {
      if (!Array.isArray(value) || value.some((name) => typeof name !== 'string')) {
        return `${where}.${key} 必须是字符串数组`
      }
    } else if (field === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${where}.${key} 必须是数字`
    } else if (typeof value !== field) {
      return `${where}.${key} 必须是${field === 'boolean' ? ' true / false' : '字符串'}`
    }
  }
  return raw as Record<string, never>
}
