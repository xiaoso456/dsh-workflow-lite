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
import {
  defaultFolderPrompt,
  defaultMemoryPrompt,
  memoryFolder,
  memoryOf,
  onDefaultPath,
  type PresetRefusal,
  presetRefusal,
  rescopeMemory,
  setMemoryFolder,
} from '../../shared/presets.ts'
import {
  MEMORY_SCOPES,
  type MemoryScope,
  RESOURCE_PRESETS,
  type ResourceData,
  type ResourceNode,
  type ResourcePresetKind,
} from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import type { Edit } from '../model/editor.ts'
import { LookPicker } from './AppearancePicker.tsx'
import { Icon, type IconName } from './Icon.tsx'
import input from './input.module.css'
import ins from './inspector.module.css'
import { SwitchTrack } from './motion.tsx'
import type { ItemNote, ItemsRule } from './ResourceItems.tsx'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'

/** 预设配置块拿到的东西。 */
export interface PresetBlockProps {
  t: T
  node: ResourceNode
  /** 没连线（交给整个工作流）。 */
  shared: boolean
  /** 工作流名；没有（实例视图）就不能改默认路径。 */
  workflow: string | null
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
    head: (props) => (
      <>
        <MemoryScopeField {...props} />
        <MemoryFolderField {...props} />
      </>
    ),
    items: (props) => ({ fixed: true, note: (index) => memoryNote(props, index) }),
  },
}

const TYPES: readonly ResourceType[] = ['none', ...RESOURCE_PRESETS]

function typeUi(type: ResourceType): TypeUi {
  return type === 'none' ? PLAIN_UI : PRESET_UI[type]
}

const REFUSAL_TEXT = {
  memory_items: 'preset.refused.memoryItems',
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
  node: ResourceNode
  workflow: string | null
  onEdit(edit: Edit): void
}): React.JSX.Element {
  const { t, node, workflow } = props
  const mark = <ResourceMark data={node.data} />
  if (workflow === null) return mark
  const value: ResourceType = node.data.preset?.kind ?? 'none'
  const ctx = { id: node.id, workflow }
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
        props.onEdit({
          type: 'setPreset',
          id: node.id,
          preset: type === 'none' ? null : type,
          workflow,
        })
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

const SCOPE_TEXT = {
  workspace: 'mem.scope.workspace',
  workflow: 'mem.scope.workflow',
} as const satisfies Record<MemoryScope, LocaleKey>

const SCOPE_TIP = {
  workspace: 'mem.scopeTip.workspace',
  workflow: 'mem.scopeTip.workflow',
} as const satisfies Record<MemoryScope, LocaleKey>

/** 范围：只换默认路径（路径改过就不动）。 */
/**
 * 工具文件夹：开了在记忆文件旁边带一个同名文件夹，放下次能直接复用的脚本、模板；
 * 关掉只是从卡上拿掉，磁盘上的东西不动。默认提示词跟着多两条怎么放、怎么清。
 */
function MemoryFolderField(props: PresetBlockProps): React.JSX.Element {
  const { t, node, workflow } = props
  const on = memoryFolder(node.data) !== undefined
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={workflow === null ? true : undefined}
      className={input.required}
      data-testid="wl-memory-folder"
      onClick={() => {
        if (workflow === null) return
        props.patch({ items: setMemoryFolder(node.data, !on, workflow, node.id).items })
      }}
    >
      <SwitchTrack on={on} />
      <span className={input.requiredText}>
        <span className={input.requiredTitle}>{t('mem.folder')}</span>
        <span className={input.requiredDesc}>{t('mem.folderDesc')}</span>
      </span>
    </button>
  )
}

function MemoryScopeField(props: PresetBlockProps): React.JSX.Element {
  const { t, node, workflow } = props
  const memory = memoryOf(node.data)
  const scope = memory?.scope ?? 'workspace'
  return (
    <section className={ins.field} data-testid="wl-memory-scope">
      <div className={ins.label}>
        <span>{t('mem.scope')}</span>
      </div>
      <Segmented
        label={t('mem.scope')}
        value={scope}
        options={MEMORY_SCOPES.map((value) => ({ value, label: t(SCOPE_TEXT[value]) }))}
        disabled={workflow === null}
        testId="wl-memory-scope"
        onChange={(next) => {
          if (workflow === null || next === scope) return
          const moved = rescopeMemory(node.data, next, workflow, node.id)
          props.patch({ items: moved.items, preset: moved.preset })
        }}
      />
      <p className={ins.help}>
        {t(onDefaultPath(node.data, node.id) ? SCOPE_TIP[scope] : 'mem.scopeTip.custom')}
      </p>
    </section>
  )
}

/** 记忆的两项（记忆文件、工具文件夹）各自的名字与默认说明。 */
const MEMORY_ITEMS = [
  {
    title: 'mem.file',
    label: 'mem.prompt',
    hint: { step: 'mem.hint', global: 'mem.globalHint' },
    fallback: defaultMemoryPrompt,
  },
  {
    title: 'mem.folder',
    label: 'mem.folderPrompt',
    hint: { step: 'mem.folderHint', global: 'mem.folderHint' },
    fallback: defaultFolderPrompt,
  },
] as const

/**
 * 记忆文件 / 工具文件夹的说明：怎么读、什么时候写、怎么写，存在那一项自己的说明里，空着就是默认的那份。
 * 说明里的 `{记忆文件}` / `{工具文件夹}` 交出去时换成实际路径。
 */
function memoryNote(props: PresetBlockProps, index: number): ItemNote | undefined {
  const part = MEMORY_ITEMS[index]
  if (part === undefined) return undefined
  const { t, shared } = props
  return {
    title: t(part.title),
    label: t(part.label),
    fallback: part.fallback(shared),
    hint: `${t(shared ? part.hint.global : part.hint.step)}${t('mem.tokens')}`,
    placeholder: t('mem.promptPlaceholder'),
  }
}
