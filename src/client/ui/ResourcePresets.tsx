/**
 * dsh-workflow-lite — 资源卡的类型标记（预设）：标题栏图标块上的「类型」选择，和每种预设自带的快捷配置。
 *
 * 和步骤的「图标与颜色」同一块浮层（`LookPicker`）：点面板标题左边的图标块（右下角挂调色盘），
 * 上面选卡片的颜色，下面一格一种类型（悬停看名字和说明）。选了就换，内容不合换不了的置灰、悬停说原因。
 *
 * 规矩（打上、摘掉时内容和连线怎么变）在 `shared/presets.ts` 的 `PRESET_SPECS`；这里只管名字、图标、颜色和配置块。
 * 加新预设：在 {@link PRESET_UI} 加一行（名字、默认颜色、图标），配置块按需填 `head`（内容上面）/ `tail`（内容下面），
 * 内容清单有自己的规矩（固定几项、每项的默认说明）就填 `items`——清单和编辑框照普通资源的样子画，不另起一块。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ResourcePresets
 */

import { isStepColor, type StepColor } from '../../shared/appearance.ts'
import { idKey } from '../../shared/model.ts'
import {
  defaultMemoryPrompt,
  memoryOf,
  type PresetRefusal,
  presetRefusal,
} from '../../shared/presets.ts'
import {
  type MemoryType,
  RESOURCE_PRESETS,
  type ResourceData,
  type ResourceNode,
  type ResourcePresetKind,
  type WorkflowDocument,
} from '../../shared/types.ts'
import type { HostAccess } from '../app/host.ts'
import { findMemory, useMemories } from '../app/memories.ts'
import type { MemoryPickTarget } from '../app/useMemoryPick.ts'
import type { LocaleKey, T } from '../i18n.ts'
import type { Edit } from '../model/editor.ts'
import { LookPicker } from './AppearancePicker.tsx'
import { Icon, type IconName } from './Icon.tsx'
import ins from './inspector.module.css'
import mem from './memory.module.css'
import { cx } from './primitives.tsx'
import type { ItemNote, ItemsRule } from './ResourceItems.tsx'
import ui from './ui.module.css'

/** 换一条记忆、把资源卡换成记忆：弹「选已有的 / 新建」（贴着 `anchor`，没给就贴着最后按下的位置）。 */
export type PickMemory = (target: MemoryPickTarget, anchor?: Element | null) => void

/** 预设配置块拿到的东西。 */
export interface PresetBlockProps {
  t: T
  node: ResourceNode
  /** 没连线（交给整个工作流）。 */
  shared: boolean
  /** 工作流名；没有（实例视图）就不能换引用的记忆。 */
  workflow: string | null
  host: HostAccess
  onPickMemory?: PickMemory | undefined
  patch(next: Partial<ResourceData>, field?: string): void
  onSeal(): void
}

/** 资源的类型：普通资源（`none`）或一种预设。 */
export type ResourceType = ResourcePresetKind | 'none'

interface TypeUi {
  label: LocaleKey
  /** 没选颜色时卡片的颜色。 */
  color: StepColor
  /** 类型清单里名字下面那句：这种类型是什么。 */
  desc: LocaleKey
  icon: IconName
}

interface PresetUi extends TypeUi {
  /** 内容上面的快捷配置。 */
  head?(props: PresetBlockProps): React.JSX.Element
  /** 内容下面的快捷配置。 */
  tail?(props: PresetBlockProps): React.JSX.Element
  /** 内容清单的规矩（固定几项、每项的名字与默认说明）。 */
  items?(props: PresetBlockProps): ItemsRule
}

const PLAIN_UI: TypeUi = {
  label: 'preset.none',
  color: 'slate',
  desc: 'preset.noneDesc',
  icon: 'layers',
}

export const PRESET_UI: Record<ResourcePresetKind, PresetUi> = {
  memory: {
    label: 'preset.memory',
    color: 'amber',
    desc: 'preset.memoryDesc',
    icon: 'memory',
    head: (props) => <MemoryInfoField {...props} />,
    items: (props) => ({ fixed: true, note: (index) => memoryNote(props, index) }),
  },
}

const TYPES: readonly ResourceType[] = ['none', ...RESOURCE_PRESETS]

function typeUi(type: ResourceType): TypeUi {
  return type === 'none' ? PLAIN_UI : PRESET_UI[type]
}

const REFUSAL_TEXT = {
  memory_items: 'preset.refused.memoryItems',
  memory_ref: 'preset.refused.memoryRef',
} as const satisfies Record<PresetRefusal, LocaleKey>

/** 资源卡的颜色：自己选了就用它，没选按类型的颜色。 */
export function resourceColor(data: ResourceData): StepColor {
  if (isStepColor(data.color)) return data.color
  return typeUi(data.preset?.kind ?? 'none').color
}

/**
 * 画布上卡片要不要染色：选了颜色、或者是预设（记忆是琥珀色）才染；普通资源没选颜色保持资源卡本来的灰。
 */
export function resourceTint(data: ResourceData): StepColor | null {
  return isStepColor(data.color) || data.preset !== undefined ? resourceColor(data) : null
}

/** 资源卡的图标块：卡片的颜色 + 类型的图标（和步骤的图标块一个样子）。 */
export function ResourceMark(props: { data: ResourceData; size?: number }): React.JSX.Element {
  const type: ResourceType = props.data.preset?.kind ?? 'none'
  return (
    <span className={ui.kind} data-color={resourceColor(props.data)} data-preset={type}>
      <Icon name={typeUi(type).icon} size={props.size ?? 16} />
    </span>
  )
}

/**
 * 标题栏左边的图标块：点开是「颜色与类型」——上面选颜色，下面一格一种类型（悬停看名字），
 * 和步骤的「图标与颜色」同一块浮层。没有工作流名（实例视图）时只是个图标块，换不了。
 */
export function ResourceTypePicker(props: {
  t: T
  doc: WorkflowDocument
  node: ResourceNode
  workflow: string | null
  onEdit(edit: Edit): void
  onPickMemory?: PickMemory | undefined
}): React.JSX.Element {
  const { t, node, workflow } = props
  const mark = <ResourceMark data={node.data} />
  if (workflow === null) return mark
  const value: ResourceType = node.data.preset?.kind ?? 'none'
  const ctx = { id: node.id }
  const icons = TYPES.map((type) => {
    const ui = typeUi(type)
    const why = type === value || type === 'none' ? null : presetRefusal(node.data, type, ctx)
    const name = t(ui.label)
    return {
      value: type,
      icon: ui.icon,
      tip: why === null ? `${name}：${t(ui.desc)}` : `${name}：${t(REFUSAL_TEXT[why])}`,
      disabled: why !== null,
    }
  })
  return (
    <LookPicker<ResourceType>
      t={t}
      title={t('preset.title')}
      iconTitle={t('preset.type')}
      change={t('preset.change')}
      mark={mark}
      color={resourceColor(node.data)}
      icon={value}
      icons={icons}
      custom={isStepColor(node.data.color)}
      testId="wl-resource-type"
      onColor={(color) => props.onEdit({ type: 'patchResource', id: node.id, patch: { color } })}
      onIcon={(type) => {
        if (type === value) return
        if (type === 'memory') {
          // 换成记忆：先挑一条（或新建）；连着步骤的是步骤记忆，没连的是工作流记忆。
          props.onPickMemory?.({ kind: 'card', id: node.id, type: cardMemoryType(props.doc, node) })
          return
        }
        props.onEdit({ type: 'setPreset', id: node.id, preset: type === 'none' ? null : type })
      }}
      onReset={() =>
        props.onEdit({ type: 'patchResource', id: node.id, patch: { color: undefined } })
      }
    />
  )
}

/** 当前预设给内容清单的规矩；普通资源（或预设没写）不给。 */
export function presetItems(props: PresetBlockProps): ItemsRule | undefined {
  const kind = props.node.data.preset?.kind
  return kind === undefined ? undefined : PRESET_UI[kind].items?.(props)
}

/** 当前预设的配置块（`slot` 指内容的上面还是下面）；普通资源没有。 */
export function PresetBlock(props: PresetBlockProps & { slot: 'head' | 'tail' }): React.ReactNode {
  const kind = props.node.data.preset?.kind
  if (kind === undefined) return null
  const Block = PRESET_UI[kind][props.slot]
  return Block === undefined ? null : <Block {...props} />
}

/* ── 记忆 ─────────────────────────────────────────────────── */

const TYPE_TEXT = {
  workflow: 'mem.type.workflow',
  step: 'mem.type.step',
} as const satisfies Record<MemoryType, LocaleKey>

/** 记忆类型的名字（工作流记忆 / 步骤记忆）。 */
export function memoryTypeText(t: T, type: MemoryType): string {
  return t(TYPE_TEXT[type])
}

/** 一张资源卡换成记忆时是哪种：有步骤写它就是步骤记忆，否则是工作流记忆。 */
function cardMemoryType(doc: WorkflowDocument, node: ResourceNode): MemoryType {
  const written = doc.edges.some(
    (edge) =>
      idKey(edge.target) === idKey(node.id) &&
      doc.nodes.some(
        (source) => idKey(source.id) === idKey(edge.source) && source.type === 'wfNode',
      ),
  )
  return written ? 'step' : 'workflow'
}

/**
 * 这张卡引用的那条记忆：一张小卡，左边图标，中间是类型和谁在用，「换一条」在行尾；
 * 库里找不到时卡片转警示色，行尾改成「换一条或新建」，下面说明怎么办。
 */
function MemoryInfoField(props: PresetBlockProps): React.JSX.Element | null {
  const { t, node, workflow } = props
  const memory = memoryOf(node.data)
  const { entries } = useMemories(props.host.memories)
  if (memory === undefined) return null
  const entry = findMemory(entries, memory.memory)
  const missing = entries !== null && entry === undefined
  const others =
    entry?.usedBy.filter((name) => workflow === null || idKey(name) !== idKey(workflow)) ?? []
  const pick = props.onPickMemory
  return (
    <section className={ins.field} data-testid="wl-memory-info">
      <div className={ins.label}>
        <span>{t('mem.libLabel')}</span>
      </div>
      <div className={mem.info} data-missing={missing}>
        <span className={mem.infoIcon}>
          <Icon name={missing ? 'alert' : 'memory'} size={15} />
        </span>
        <span className={mem.infoType} data-testid="wl-memory-type">
          {memoryTypeText(t, memory.type)}
        </span>
        {entry !== undefined && (
          <span
            className={mem.infoUsed}
            data-shared={others.length > 0}
            data-testid="wl-memory-used"
          >
            {others.length > 0
              ? t('mem.alsoUsed').replace('{n}', String(others.length))
              : t('mem.onlyHere')}
          </span>
        )}
        {workflow !== null && pick !== undefined && (
          <button
            type="button"
            className={cx(ui.btn, ui.small, mem.infoAction)}
            data-testid="wl-memory-rebind"
            onClick={(event) =>
              pick({ kind: 'card', id: node.id, type: memory.type }, event.currentTarget)
            }
          >
            {t(missing ? 'mem.relink' : 'mem.rebind')}
            <Icon name="chevronDown" size={12} />
          </button>
        )}
      </div>
      {missing && (
        <p className={mem.missing} data-testid="wl-memory-missing">
          <span>{t('mem.missing')}</span>
        </p>
      )}
    </section>
  )
}

/**
 * 记忆那一项（skill 目录）的名字与默认说明：怎么读、什么时候改、怎么写，存在那一项自己的说明里，
 * 空着就按类型用默认的那份。
 */
function memoryNote(props: PresetBlockProps, index: number): ItemNote | undefined {
  if (index !== 0) return undefined
  const { t, node } = props
  const type = memoryOf(node.data)?.type ?? 'step'
  return {
    title: t('mem.dir'),
    label: t('mem.prompt'),
    fallback: defaultMemoryPrompt(type),
    hint: t(type === 'workflow' ? 'mem.globalHint' : 'mem.hint'),
    placeholder: t('mem.promptPlaceholder'),
  }
}
