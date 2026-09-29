/**
 * dsh-workflow-lite — 画布上的节点卡片。
 *
 * 卡片上要有：`label`（缺省回落 `id`）、**上下游度数**、`output`、**校验状态**
 * （错误红 / 警告黄 / 正常绿——用左侧色条，不做整卡染色）。
 *
 * 所有节点都按 `wfNode` 渲染：`node.type` 是存盘的字段，未知类型由 host 报
 * 「未知 `node.type`」警告，画布不该因为一个不认识的字符串就渲染不出来。
 *
 * **卡片不订阅 locale**：它是 React Flow 的受控渲染出口，拖拽时每帧重渲染，
 * 在里面挂 context 订阅会让每次指针移动都多走一遍读取。文案由外层 `t()` 求好后
 * 作为纯数据塞进 `data`，卡片只做渲染。同理，操作簇的回调由 `data.actions` 传入
 * （外层 `useMemo` 出稳定引用），**不引入 context 订阅**。
 *
 * 操作簇的两个按钮必须带 `nodrag`：React Flow 靠这个类名判断"这一点不是拖拽起点"，
 * 少了它，点按钮会被当成开始拖节点，手指一抖就把节点挪走。
 *
 * @module @xiaoso/dsh-workflow-lite/client/components/NodeCard
 */

import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import css from './NodeCard.module.css'
import ui from './ui.module.css'

/** 卡片拿到的 `data`（由 CanvasView 现算，**不存盘**）。 */
export interface CardData extends Record<string, unknown> {
  /** 显示名（已回落过 `id`）。 */
  label: string
  /** 上游 / 下游度数。 */
  upstream: number
  downstream: number
  /** 产出契约的三态在卡片上的呈现：字符串原样、`false` 显示成 `false`、缺省不显示。 */
  output?: string | false
  /** 校验状态（有错误 ⇒ 红、只有警告 ⇒ 黄、干净 ⇒ 绿）。 */
  state: 'ok' | 'warn' | 'invalid'
  /** 坐标还是 `(0,0)` 占位值，或超 `maxNodes` 时的网格假位。 */
  unplaced: boolean
  /** 两条角标文案（外层求好的 `t()` 结果）。 */
  invalidText: string
  unplacedText: string
  /** 卡片操作簇的回调与可读名（外层 `t()` 求好）。 */
  actions: { duplicate: () => void; remove: () => void }
  duplicateText: string
  removeText: string
  /** 操作簇自己的可读名（`role=group` 的 `aria-label`）——两个按钮之外，簇本身也该有名字。 */
  actionsText: string
}

/**
 * 状态点的语气（只表达状态，不表达选中）：孤立 > 校验出错 > 没声明产出 / 校验警告 > **正常（不点）**。
 *
 * 正常态返回空串、**不渲染点**：绝大多数节点都是正常的，每张卡都挂一枚绿点的话，
 * 一屏下来那点绿本身就是新的装饰噪声，"要看的那一张"反而淹掉了。状态色只在**它真的在
 * 说什么**的时候出现——这是这套配色里唯一允许语义色登场的场合。
 * 孤立与校验出错都算危险：否则一张报错的卡上会同时挂着绿点和红角标。
 */
function dotTone(data: CardData): string {
  if (data.upstream === 0 && data.downstream === 0) return css.dotDanger
  if (data.state === 'invalid') return css.dotDanger
  if (data.state === 'warn' || data.output === undefined) return css.dotWarn
  return ''
}

/** 节点卡片。 */
export function WorkflowNodeCard({
  id,
  data,
  selected,
}: NodeProps<Node<CardData>>): React.JSX.Element {
  return (
    <div className={[css.node, selected === true ? css.nodeSelected : ''].join(' ')}>
      <Handle type="target" position={Position.Left} className={css.handle} />
      <div
        className={css.cardActions}
        data-testid={`wl-node-actions-${id}`}
        role="group"
        aria-label={data.actionsText}
      >
        <button
          type="button"
          className={['nodrag', ui.iconButton, css.cardAction].join(' ')}
          data-testid={`wl-node-duplicate-${id}`}
          title={data.duplicateText}
          aria-label={data.duplicateText}
          // 同删除键：拦住冒泡，让「复制出来的那个选中」这条语义不被 React Flow
          // 的节点点击改写成「源节点选中」。
          onClick={(event) => {
            event.stopPropagation()
            data.actions.duplicate()
          }}
        >
          ⧉
        </button>
        <button
          type="button"
          className={['nodrag', ui.iconButton, ui.iconButtonDanger, css.cardAction].join(' ')}
          data-testid={`wl-node-delete-${id}`}
          title={data.removeText}
          aria-label={data.removeText}
          // 不拦住冒泡的话，删掉节点之后这次点击还会落到 React Flow 的节点点击上，
          // 把刚删掉的 id 重新选成「当前节点」。
          onClick={(event) => {
            event.stopPropagation()
            data.actions.remove()
          }}
        >
          ×
        </button>
      </div>
      {/*
        卡片宽 132–220px、还要按画布缩放渲染，长标签必然截断；`title` 是全文的零成本兜底，
        少了它，两个同前缀的长标签在画布上就分不出来（只能点开去右栏确认点对了没有）。
      */}
      <div className={css.nodeHead}>
        {/*
          状态点是**纯视觉**的一枚 6px 圆点：可读文案（“孤立 / 未声明产出”）需要新的
          locale 键，而 locale 表本轮冻结，所以不给它塞 title / aria-label，
          避免把没翻译的中文硬编码进组件。
          **正常态整枚不渲染**（`dotTone` 返回空串）：每张卡都挂绿点等于一屏噪声。
        */}
        {dotTone(data) === '' ? null : (
          <span className={[css.statusDot, dotTone(data)].join(' ')} aria-hidden="true" />
        )}
        <div className={css.nodeTitle} title={data.label}>
          {data.label}
        </div>
      </div>
      <div className={css.nodeMeta}>
        ↑{data.upstream} ↓{data.downstream}
      </div>
      {data.output === undefined ? null : (
        <div className={css.nodeOut} title={data.output === false ? 'false' : data.output}>
          {data.output === false ? <code>false</code> : data.output}
        </div>
      )}
      {data.state === 'invalid' && <span className={ui.badge}>{data.invalidText}</span>}
      {data.unplaced && <span className={css.badgeUnplaced}>{data.unplacedText}</span>}
      <Handle type="source" position={Position.Right} className={css.handle} />
    </div>
  )
}
