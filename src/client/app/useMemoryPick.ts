/**
 * dsh-workflow-lite — 加记忆、换一条记忆：弹「选已有的 / 新建」的小菜单（`ui/MemoryPicker.tsx`），选好了改图。
 *
 * 三种目标：给步骤开记忆、在画布上加一张工作流记忆、给一张卡换引用（资源卡换成记忆，或记忆卡换一条）。
 * 库里没有同类型的就不弹，直接新建；换一条时照样弹（好看清现在是哪条、也能新建）。
 * 菜单贴着点的那个按钮弹出（锚点写了 `data-pick-match` 的，菜单和它左对齐、一样宽）；没有按钮（从步骤库、快捷添加来的）就贴着最后一次按下的位置。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useMemoryPick
 */

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { MemoryEntry } from '../../shared/memoryLib.ts'
import { idKey, isStep } from '../../shared/model.ts'
import { type MemoryRef, memoryOf, rebindMemory, suggestMemoryId } from '../../shared/presets.ts'
import type { MemoryType, Point, WorkflowDocument } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { type Edit, findNode } from '../model/editor.ts'
import { errorMessage } from '../rpc.ts'
import { MEMORY_PICKER_W } from '../ui/MemoryPicker.tsx'
import { type MemoryStore, memoriesOfType } from './memories.ts'

export type MemoryPickTarget =
  | { kind: 'step'; step: string }
  | { kind: 'workflow'; position: Point }
  /** 一张卡换引用：资源卡换成记忆（`type` 按它连没连步骤），或记忆卡换一条。 */
  | { kind: 'card'; id: string; type: MemoryType }

export interface MemoryPickState {
  target: MemoryPickTarget
  type: MemoryType
  at: { x: number; y: number; width?: number }
  entries: MemoryEntry[]
  /** 换一条时现在引用的那条。 */
  current?: string
}

const GAP = 8

function typeOf(target: MemoryPickTarget): MemoryType {
  return target.kind === 'step' ? 'step' : target.kind === 'workflow' ? 'workflow' : target.type
}

export function useMemoryPick(options: {
  t: T
  store: MemoryStore
  doc: WorkflowDocument | null
  workflow: string | null
  root: RefObject<HTMLElement | null>
  edit(edit: Edit): void
  notify(text: string, tone?: 'info' | 'error'): void
}): {
  pick: MemoryPickState | null
  busy: boolean
  open(target: MemoryPickTarget, anchor?: Element | null): void
  choose(entry: MemoryEntry): void
  create(): void
  close(): void
} {
  const { t, store, doc, workflow, root, edit, notify } = options
  const [pick, setPick] = useState<MemoryPickState | null>(null)
  const [busy, setBusy] = useState(false)
  // 最后一次按下的位置（相对视图根）：没有按钮可贴时菜单弹在这儿。
  const pointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const element = root.current
    if (element === null) return
    const onDown = (event: PointerEvent): void => {
      const box = element.getBoundingClientRect()
      pointer.current = { x: event.clientX - box.left, y: event.clientY - box.top }
    }
    element.addEventListener('pointerdown', onDown, true)
    return () => element.removeEventListener('pointerdown', onDown, true)
  }, [root])

  const placeAt = useCallback(
    (anchor: Element | null | undefined): { x: number; y: number; width?: number } => {
      const element = root.current
      const box = element?.getBoundingClientRect()
      if (box === undefined) return { x: GAP, y: GAP }
      const rect = anchor?.getBoundingClientRect()
      // 锚点是一整块（比如「记忆库」那张卡）：菜单和它一样宽，不是只贴着里面的小按钮。
      const width =
        rect !== undefined && anchor?.hasAttribute('data-pick-match') === true
          ? Math.min(rect.width, box.width - GAP * 2)
          : undefined
      const raw =
        rect !== undefined
          ? { x: rect.left - box.left, y: rect.bottom - box.top + 6 }
          : (pointer.current ?? { x: box.width / 2 - MEMORY_PICKER_W / 2, y: box.height / 3 })
      return {
        x: Math.max(GAP, Math.min(raw.x, box.width - (width ?? MEMORY_PICKER_W) - GAP)),
        y: Math.max(GAP, Math.min(raw.y, box.height - 320)),
        ...(width === undefined ? {} : { width }),
      }
    },
    [root],
  )

  /** 引用 `ref`：按目标改图。 */
  const apply = useCallback(
    (target: MemoryPickTarget, ref: MemoryRef): void => {
      if (target.kind === 'step') {
        edit({ type: 'setStepMemory', step: target.step, on: true, memory: ref })
        return
      }
      if (target.kind === 'workflow') {
        edit({ type: 'addGlobalMemory', memory: ref, position: target.position })
        return
      }
      const node = doc === null ? undefined : findNode(doc, target.id)
      if (node === undefined || node.type !== 'wfResource') return
      if (memoryOf(node.data) !== undefined) {
        const next = rebindMemory(node.data, ref)
        edit({
          type: 'patchResource',
          id: node.id,
          patch: { items: next.items, preset: next.preset },
        })
      } else {
        edit({ type: 'setPreset', id: node.id, preset: 'memory', memory: ref })
      }
    },
    [doc, edit],
  )

  /** 新建一条再引用它：id 按工作流名（步骤记忆再加上是哪一步）。 */
  const createFor = useCallback(
    async (target: MemoryPickTarget): Promise<void> => {
      if (workflow === null) return
      const type = typeOf(target)
      let step: string | undefined
      if (target.kind === 'step') step = target.step
      else if (target.kind === 'card' && doc !== null) {
        // 记忆卡换一条：按写它的那一步起名。
        const writer = doc.edges.find((edge) => idKey(edge.target) === idKey(target.id))
        const source = writer === undefined ? undefined : findNode(doc, writer.source)
        if (source !== undefined && isStep(source)) step = source.id
      }
      setBusy(true)
      try {
        const entry = await store.create({ type, id: suggestMemoryId(type, workflow, step) })
        apply(target, { memory: entry.id, type: entry.type })
        setPick(null)
      } catch (reason) {
        notify(t('mem.createFailed').replace('{error}', errorMessage(reason)), 'error')
      } finally {
        setBusy(false)
      }
    },
    [workflow, doc, store, apply, notify, t],
  )

  const open = useCallback(
    (target: MemoryPickTarget, anchor?: Element | null): void => {
      const at = placeAt(anchor)
      void (async () => {
        if (store.snapshot().entries === null) await store.refresh()
        const type = typeOf(target)
        const entries = memoriesOfType(store.snapshot().entries, type)
        const node = target.kind === 'card' && doc !== null ? findNode(doc, target.id) : undefined
        const current =
          node !== undefined && node.type === 'wfResource' ? memoryOf(node.data)?.memory : undefined
        if (entries.length === 0 && current === undefined) {
          await createFor(target)
          return
        }
        setPick({ target, type, at, entries, ...(current === undefined ? {} : { current }) })
      })()
    },
    [placeAt, store, doc, createFor],
  )

  const choose = useCallback(
    (entry: MemoryEntry): void => {
      if (pick === null) return
      apply(pick.target, { memory: entry.id, type: entry.type })
      setPick(null)
    },
    [pick, apply],
  )

  const create = useCallback((): void => {
    if (pick !== null) void createFor(pick.target)
  }, [pick, createFor])

  const close = useCallback((): void => setPick(null), [])

  return { pick, busy, open, choose, create, close }
}
