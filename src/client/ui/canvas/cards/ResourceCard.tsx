/**
 * dsh-workflow-lite — 资源卡：一组给步骤用的东西，紧凑一行或带标题的清单；开了画布展示就换成展示卡。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/ResourceCard
 */

import { Handle, type NodeProps, Position } from '@xyflow/react'
import { memo } from 'react'
import type { StepColor } from '../../../../shared/appearance.ts'
import type { ResourceKind } from '../../../../shared/types.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { KIND_ICON } from '../../kit/resourceUi.ts'
import shared from '../canvas.module.css'
import type { ResourceFlowNode } from '../types.ts'
import { tintStyle } from './cardParts.ts'
import { DisplayCard } from './DisplayCard.tsx'
import css from './resourceCard.module.css'

/**
 * 紧凑资源卡左侧的类型签：上面是资源卡统一的「一叠」记号（和清单卡标题里的同一个），
 * 一眼看出这是资源、不是步骤或旧的文件卡；下面一行小字是这一项是什么——文件印扩展名，其余放种类图标。
 * 空资源只有那一叠。
 */
function ResourceTab(props: {
  kind: ResourceKind | 'many'
  ext: string
  memory: boolean
  /** 卡片的颜色（选了颜色、或是记忆这类预设）；`null` = 资源卡本来的灰。 */
  tint: StepColor | null
}): React.JSX.Element {
  const tint = tintStyle(props.tint)
  // 记忆卡的签：一颗脑（记忆总是一个 skill 目录）。
  if (props.memory) {
    return (
      <span
        className={css.fileTab}
        data-tinted={tint !== undefined}
        style={tint}
        aria-hidden="true"
      >
        <Icon name="memory" size={16} />
      </span>
    )
  }
  return (
    <span
      className={css.fileTab}
      data-kind={props.kind}
      data-long={props.ext.length > 3}
      data-tinted={tint !== undefined}
      style={tint}
      aria-hidden="true"
    >
      <span className={css.fileTabMark}>
        <Icon name="layers" size={props.kind === 'many' ? 14 : 12} />
      </span>
      {props.kind !== 'many' && (
        <span className={css.fileTabKind}>
          {props.ext !== '' ? props.ext : <Icon name={KIND_ICON[props.kind]} size={11} />}
        </span>
      )}
    </span>
  )
}

/**
 * 资源卡：一组给步骤用的东西。左边的点接「步骤 → 资源」（写），右边的点拖出去连到步骤（读）。
 * 只放了一项、没起名字时是紧凑的一行（像一张贴了类型签的文件卡）；否则是一张小清单：
 * 标题（名字）、描述、一行一项（最多列 {@link RES_SHOWN} 项）。
 * 悬停时画布高亮所有写它、读它的步骤；一条线都没连时右上角标「全局」——它交给整个工作流。
 */
export const ResourceCard = memo(function ResourceCard(
  props: NodeProps<ResourceFlowNode>,
): React.JSX.Element {
  const { data, id, selected } = props
  if (data.display !== null) return <DisplayCard {...props} display={data.display} />
  const madeAll = data.compact && data.items[0]?.made === true
  return (
    <div
      className={cx(shared.resCard, selected && shared.cardSelected)}
      data-compact={data.compact}
      data-memory={data.memory ?? undefined}
      data-focused={data.focused}
      data-dim={data.dim}
      data-tone={data.tone}
      data-testid="wl-resource"
      data-tip={data.note === '' ? undefined : data.note}
      onPointerEnter={() => data.onFocusFile(id)}
      onPointerLeave={() => data.onFocusFile(null)}
    >
      {/* 和步骤卡一样左进右出：左边接写入（写线从步骤的写点落下来、横着进来），右边拖出去是读取。 */}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        className={cx(shared.handle, shared.hResIn)}
      />
      {data.compact ? (
        <>
          <ResourceTab
            kind={data.tab.kind}
            ext={data.tab.ext}
            memory={data.memory !== null}
            tint={data.tint}
          />
          <span className={shared.fileText}>
            <span className={cx(css.fileName, data.items.length === 0 && css.resEmptyTitle)}>
              {data.title}
            </span>
            <span className={shared.fileRule}>{data.sub}</span>
          </span>
        </>
      ) : (
        <span className={shared.resBody}>
          <span className={css.resHead}>
            <span
              className={css.resHeadIcon}
              data-tinted={data.tint !== null}
              style={tintStyle(data.tint)}
            >
              <Icon name="layers" size={13} />
            </span>
            <span className={css.resName}>{data.title}</span>
            <span className={css.resCount}>{data.countText}</span>
            {data.tone !== 'ok' && (
              <span className={shared.cardFlag} data-tone={data.tone}>
                <Icon name="alert" size={12} />
              </span>
            )}
          </span>
          {data.description !== '' && <span className={css.resDesc}>{data.description}</span>}
          <span className={css.resItems}>
            {data.items.length === 0 ? (
              <span className={cx(css.resItem, css.resItemEmpty)}>{data.emptyText}</span>
            ) : (
              data.items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 资源里的一项没有自己的身份
                <span key={index} className={css.resItem} data-kind={item.kind}>
                  <span className={css.resItemIcon}>
                    <Icon name={KIND_ICON[item.kind]} size={12} />
                  </span>
                  <span
                    className={css.resItemText}
                    data-mono={
                      item.kind === 'file' || item.kind === 'folder' || item.kind === 'skill'
                    }
                  >
                    {item.text}
                  </span>
                  {item.made === true && (
                    <span className={css.resItemMade} data-tip={data.generatedText}>
                      <Icon name="check" size={11} />
                    </span>
                  )}
                </span>
              ))
            )}
            {data.more > 0 && <span className={css.resMore}>{data.moreText}</span>}
          </span>
        </span>
      )}
      {data.shared && data.memory !== 'step' && (
        <span
          className={shared.resShared}
          data-tip={data.sharedText}
          data-testid="wl-resource-shared-tag"
        >
          <Icon name="shared" size={11} />
        </span>
      )}
      {data.memoryShared !== null && (
        <span
          className={shared.resShared}
          data-beside={data.shared || undefined}
          data-tip={data.memoryShared}
          data-testid="wl-memory-shared-tag"
        >
          <Icon name="hub" size={11} />
        </span>
      )}
      {/* 有标题行的卡把警示放在标题行里（项数后面），紧凑的一行卡放在行尾。 */}
      {data.compact && data.tone !== 'ok' && (
        <span className={shared.cardFlag} data-tone={data.tone}>
          <Icon name="alert" size={12} />
        </span>
      )}
      {madeAll && (
        <span className={css.fileMade} data-tip={data.generatedText} data-testid="wl-resource-made">
          <Icon name="check" size={12} />
        </span>
      )}
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={cx(shared.handle, shared.handleOut, shared.handleRead)}
        data-tip={data.readText}
      />
    </div>
  )
})
