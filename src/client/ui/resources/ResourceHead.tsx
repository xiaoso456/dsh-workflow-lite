/**
 * dsh-workflow-lite — 资源卡的右栏标题栏：图标块（类型）、名称、ID。
 *
 * 模板的资源面板、实例右栏的「运行」与「编辑」都用它，所以实例里两边切换时标题栏一点不动。
 * 其余几种（步骤、输入、连线、概览）的标题栏在 `panel/NodeHeads.tsx`、`run/OverviewHead.tsx`；
 * 这个放在资源这边，是因为默认的图标块（{@link ResourceMark}）是资源的类型标记。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/resources/ResourceHead
 */

import { useState } from 'react'
import { idKey } from '../../../shared/model.ts'
import { resourceTitle } from '../../../shared/resources.ts'
import type { ResourceNode } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import type { Edit } from '../../model/editor.ts'
import { cleanName, type HeadProps } from '../panel/NodeHeads.tsx'
import { PanelHead } from '../panel/PanelHead.tsx'
import { TitleField } from '../panel/TitleField.tsx'
import { ResourceMark } from './ResourcePresets.tsx'

export function ResourceHead(
  props: HeadProps & {
    node: ResourceNode
    /**
     * 记忆卡：标题是记忆库里那条的名称——边打边改草稿，失焦才写回库里（用到它的地方都跟着变）。
     * `placeholder` 是没起名时显示的（记忆的 id）。
     */
    memoryName?: { value: string; placeholder: string; onCommit(value: string): void }
    /** 标题左边的图标块（编辑面板里是类型选择）；缺省按类型画一个不能点的。 */
    lead?: React.ReactNode
    onEdit(edit: Edit): void
    onSeal(): void
  },
): React.JSX.Element {
  const { t, node } = props
  return (
    <PanelHead
      t={t}
      lead={props.lead ?? <ResourceMark data={node.data} />}
      title={
        props.memoryName !== undefined ? (
          <MemoryTitle t={t} {...props.memoryName} />
        ) : (
          <TitleField
            t={t}
            value={node.data.label ?? ''}
            placeholder={resourceTitle({ ...node, data: { ...node.data, label: '' } })}
            ariaLabel={t('res.name')}
            testId="wl-resource-label"
            onType={(value) =>
              props.onEdit({
                type: 'patchResource',
                id: node.id,
                patch: { label: cleanName(value) },
                merge: `${idKey(node.id)}:label`,
              })
            }
            onBlur={props.onSeal}
          />
        )
      }
      id={node.id}
      extra={props.extra}
      onClose={props.onClose}
      closeTestId={props.closeTestId}
    />
  )
}

/** 记忆的名称：草稿在本地（没在改时跟着库里的），失焦（回车、确认）时和库里的不一样才写回去。 */
function MemoryTitle(props: {
  t: T
  value: string
  placeholder: string
  onCommit(value: string): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <TitleField
      t={props.t}
      value={draft ?? props.value}
      placeholder={props.placeholder}
      ariaLabel={props.t('mem.name')}
      testId="wl-memory-name"
      onType={setDraft}
      onBlur={() => {
        if (draft !== null) {
          const next = cleanName(draft) ?? ''
          if (next !== props.value) props.onCommit(next)
        }
        setDraft(null)
      }}
    />
  )
}
