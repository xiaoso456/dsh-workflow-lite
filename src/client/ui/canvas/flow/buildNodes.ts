/**
 * dsh-workflow-lite — 画布上的节点对象：步骤卡、资源卡、输入卡各自的数据，以及按"文档里的那个节点 + 指纹"缓存的复用。
 *
 * 没变的节点交回同一个对象，React Flow 就不会重建它的内部状态（尺寸、连接点位置）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/flow/buildNodes
 */

import { inputKind } from '../../../../shared/inputs.ts'
import { memoryTitle } from '../../../../shared/memoryLib.ts'
import { idKey, isInput, isResource } from '../../../../shared/model.ts'
import { memoryOf } from '../../../../shared/presets.ts'
import {
  isShared,
  type ResourceInfo,
  type ResourceRole,
  resourceTitle,
  roleOf,
} from '../../../../shared/resources.ts'
import type { Point, WorkflowDocument, WorkflowNode } from '../../../../shared/types.ts'
import { findMemory } from '../../../app/memories.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { displayOf } from '../../../model/display.ts'
import type { Selection } from '../../../model/editor.ts'
import { isCompactResource, RES_SHOWN } from '../../../model/layout.ts'
import { samePlain } from '../../../model/samePlain.ts'
import { itemText } from '../../kit/resourceUi.ts'
import { lookOf } from '../../kit/StepMark.tsx'
import { resourceTint } from '../../resources/ResourcePresets.tsx'
import type { CanvasProps, RunDecor } from '../Canvas.tsx'
import { RUN_TEXT } from '../cards/cardParts.ts'
import type {
  CardDisplay,
  CardItem,
  FlowNode,
  ResourceCardData,
  RunMark,
  StepData,
  StepRun,
  Tone,
} from '../types.ts'
import type { CanvasRoutes } from './buildRoutes.ts'
import type { CanvasTexts } from './buildTexts.ts'

const MARK_TEXT: Record<RunMark, LocaleKey> = { last: 'run.lastRun', next: 'run.nextUp' }

const ROLE_TEXT: Record<ResourceRole, LocaleKey> = {
  producer: 'role.producer',
  updater: 'role.updater',
  reader: 'role.reader',
}

const NO_HANDLES: readonly string[] = []

/** 文件名的扩展名，大写、最多 4 个字（`review.md` → `MD`）；没有就是空串。 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name
    .slice(dot + 1)
    .toUpperCase()
    .slice(0, 4)
}

/** 提示词压成一行摘要（卡片上最多露两行）。 */
function excerptOf(prompt: string | undefined): string {
  if (prompt === undefined) return ''
  return prompt.replace(/\s+/gu, ' ').trim().slice(0, 160)
}

export interface CacheEntry {
  node: WorkflowNode
  /** 除了文档里的节点，这张卡还取决于什么（选中、语气、文字……）：和上一次逐项比（{@link samePlain}）。 */
  signature: unknown
  flow: FlowNode
}

/** 比指纹时不看的键：每张资源卡共用的回调。 */
const NODE_SKIP: ReadonlySet<string> = new Set(['onFocusFile', 'onView'])

export interface NodesInput {
  doc: WorkflowDocument
  selection: Selection
  tones: Map<string, { tone: Tone; note: string }>
  dragging: Record<string, Point>
  texts: CanvasTexts
  onAdd: StepData['onAdd']
  onFocusFile: ResourceCardData['onFocusFile']
  onView: ResourceCardData['onView']
  /** 悬停（或拖卡片时定住）的那个资源的读写信息。 */
  focused: ResourceInfo | undefined
  focusFile: string | null
  routes: CanvasRoutes
  t: T
  run: RunDecor | undefined
  onRunStatus: StepData['onRunStatus']
  memorySteps: ReadonlySet<string>
  memoryToggle: boolean
  onMemory: NonNullable<StepData['onMemory']>
  /** `props.memories`。 */
  memories: CanvasProps['memories']
  /** `props.workflow`。 */
  workflow: CanvasProps['workflow']
  files: Map<string, ResourceInfo>
  /** 节点对象缓存（传 ref 本身：读写的是调用那一刻的 `.current`）。 */
  cache: React.MutableRefObject<Map<string, CacheEntry>>
  measured: React.MutableRefObject<Map<string, { width: number; height: number }>>
}

export function buildNodes({
  doc,
  selection,
  tones,
  dragging,
  texts,
  onAdd,
  onFocusFile,
  onView,
  focused,
  focusFile,
  routes,
  t,
  run,
  onRunStatus,
  memorySteps,
  memoryToggle,
  onMemory,
  memories,
  workflow,
  files,
  cache,
  measured,
}: NodesInput): FlowNode[] {
  const next = new Map<string, CacheEntry>()
  const selectedId = selection?.kind === 'node' ? idKey(selection.id) : null
  const list = doc.nodes.map((node): FlowNode => {
    const reported = tones.get(idKey(node.id))
    const selected = idKey(node.id) === selectedId
    const moving = dragging[node.id]
    let signature: unknown
    let build: () => FlowNode
    const used = routes.used.get(idKey(node.id)) ?? NO_HANDLES
    if (isInput(node)) {
      const tone: Tone = reported?.tone ?? 'ok'
      const note = reported?.note ?? ''
      const dim = focusFile !== null
      const kind = inputKind(node.data)
      const question = node.data.question.trim()
      const options = (node.data.options ?? []).filter((option) => option.trim() !== '')
      const meta = [
        texts.inputKinds[kind],
        ...(kind === 'choice' || kind === 'multi'
          ? [texts.optionsCount.replace('{n}', String(options.length))]
          : []),
        ...(node.data.required === true ? [texts.required] : []),
        ...(node.data.other === true && (kind === 'choice' || kind === 'multi')
          ? [texts.otherTag]
          : []),
      ].join(' · ')
      signature = `${selected}|${tone}|${note}|${dim}|${texts.askText}|${meta}`
      build = () => ({
        id: node.id,
        type: 'wfInput',
        position: moving ?? node.position,
        selected,
        data: {
          question,
          meta,
          kind,
          tone,
          note,
          emptyText: texts.emptyQuestion,
          connectText: texts.askText,
          dim,
        },
      })
    } else if (isResource(node)) {
      const isFocus = focusFile !== null && idKey(focusFile) === idKey(node.id)
      const tone: Tone = reported?.tone ?? 'ok'
      const note = reported?.note ?? ''
      const dim = focusFile !== null && !isFocus
      const made = run?.files[node.id]
      const info = files.get(node.id)
      const shared = info !== undefined && isShared(info)
      const memory = memoryOf(node.data)
      const compact = memory !== undefined || isCompactResource(node.data)
      const all = node.data.items
      const first = all[0]
      const items: CardItem[] = all.slice(0, compact ? 1 : RES_SHOWN).map((item, index) => ({
        kind: item.kind,
        text: itemText(item) || '—',
        made: made === undefined ? null : (made[index] ?? null),
      }))
      const firstNote = first?.note?.replace(/\s+/gu, ' ').trim() ?? ''
      const label = node.data.label?.trim() ?? ''
      const entry = memory === undefined ? undefined : findMemory(memories ?? null, memory.memory)
      const others =
        entry?.usedBy.filter((name) => workflow == null || idKey(name) !== idKey(workflow)) ?? []
      const title =
        memory !== undefined
          ? entry !== undefined
            ? memoryTitle(entry)
            : label !== ''
              ? label
              : memory.memory || texts.memTypes[memory.type]
          : compact && first === undefined
            ? texts.resEmpty
            : compact && first !== undefined
              ? itemText(first) || texts.kinds[first.kind]
              : resourceTitle(node)
      const sub =
        memory !== undefined
          ? `${texts.memTypes[memory.type]} · ${memory.memory || '—'}`
          : first === undefined
            ? texts.resEmptySub
            : firstNote !== ''
              ? firstNote
              : first.kind === 'file' || first.kind === 'folder' || first.kind === 'url'
                ? first.value.trim()
                : texts.kinds[first.kind]
      const ext = first?.kind === 'file' ? extensionOf(itemText(first)) : ''
      const description = (node.data.description ?? '').replace(/\s+/gu, ' ').trim()
      const shownView = memory === undefined ? displayOf(node.data) : null
      const shownItem = shownView === null ? undefined : all[shownView.item]
      const display: CardDisplay | null =
        shownView === null || shownItem === undefined || node.data.view === undefined
          ? null
          : {
              info: shownView,
              item: shownItem,
              view: node.data.view,
              writing:
                info?.writers.some((writer) => run?.nodes[writer.id]?.status === 'running') ===
                true,
              made: made === undefined ? null : (made[shownView.item] ?? null),
              ext:
                shownItem.kind === 'file'
                  ? extensionOf(shownItem.value).toUpperCase().slice(0, 4)
                  : '',
              openText: texts.displayOpen,
              interactText: texts.displayInteract,
              leaveText: texts.displayLeave,
              resizeText: texts.displayResize,
              zoomText: texts.displayZoomTag,
            }
      const data: ResourceCardData = {
        compact,
        title,
        sub,
        description,
        items,
        more: Math.max(0, all.length - RES_SHOWN),
        moreText: texts.resMore.replace('{n}', String(Math.max(0, all.length - RES_SHOWN))),
        countText: texts.resCount.replace('{n}', String(all.length)),
        emptyText: texts.resEmpty,
        tab: { kind: first?.kind ?? 'many', ext },
        memory: memory === undefined ? null : memory.type === 'workflow' ? 'global' : 'step',
        memoryShared:
          others.length === 0 ? null : texts.memShared.replace('{n}', String(others.length)),
        tint: resourceTint(node.data),
        shared,
        sharedText: texts.resShared,
        tone,
        note,
        focused: isFocus,
        dim,
        readText: texts.readText,
        onFocusFile,
        generatedText: texts.generated,
        display,
        onView,
      }
      signature = [selected, used, data]
      build = () => ({
        id: node.id,
        type: 'wfResource',
        position: moving ?? node.position,
        selected,
        data,
      })
    } else {
      const prompt = node.data.prompt
      const empty = prompt === undefined || prompt.trim() === ''
      const tone: Tone = empty ? 'error' : (reported?.tone ?? 'ok')
      const note = empty ? texts.noPromptText : (reported?.note ?? '')
      const role = focused === undefined ? null : roleOf(focused, node.id)
      const dim = focusFile !== null && role === null
      const state = run?.nodes[node.id]
      const stepRun: StepRun | null =
        state === undefined
          ? null
          : {
              ...state,
              label: t(RUN_TEXT[state.status]),
              roundText: t('run.round').replace('{n}', String(state.round)),
              markText: state.mark === undefined ? '' : t(MARK_TEXT[state.mark]),
            }
      const memoryOn = memorySteps.has(idKey(node.id))
      const memoryText = memoryOn ? texts.memOff : texts.memOn
      signature = `${selected}|${tone}|${note}|${texts.addText}|${texts.fileText}|${role}|${dim}|${used.join(',')}|${memoryOn}|${memoryText}|${memoryToggle}|${stepRun === null ? '' : `${stepRun.status}/${stepRun.round}/${stepRun.edited}/${stepRun.label}/${stepRun.mark}`}`
      build = () => ({
        id: node.id,
        type: 'wfNode',
        position: moving ?? node.position,
        selected,
        data: {
          used,
          title:
            node.data.label === undefined || node.data.label === '' ? node.id : node.data.label,
          look: lookOf(node.id, node.data),
          // 写了描述就用描述（那是给人看的一句话），没写才摘提示词。
          excerpt:
            node.data.description !== undefined && node.data.description.trim() !== ''
              ? node.data.description
              : excerptOf(prompt),
          tone,
          note,
          noPromptText: texts.noPromptText,
          addText: texts.addText,
          fileText: texts.fileText,
          role,
          roleText: role === null ? '' : t(ROLE_TEXT[role]),
          dim,
          onAdd,
          memory: memoryOn,
          memoryText,
          onMemory: memoryToggle ? onMemory : null,
          run: stepRun,
          onRunStatus,
        },
      })
    }
    const cached = cache.current.get(node.id)
    if (
      moving === undefined &&
      cached !== undefined &&
      cached.node === node &&
      samePlain(cached.signature, signature, NODE_SKIP)
    ) {
      next.set(node.id, cached)
      return cached.flow
    }
    const size = measured.current.get(node.id)
    const built = build()
    if (size !== undefined) built.measured = size
    // 拖动中的对象每帧都不同，不进缓存；松手后按文档里的新坐标重建一次再缓存。
    if (moving === undefined) next.set(node.id, { node, signature, flow: built })
    return built
  })
  cache.current = next
  return list
}
