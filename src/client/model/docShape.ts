/**
 * dsh-workflow-lite — 两份文档在某一方面是否一定一样：结构（{@link sameStructure}）、走线（{@link sameRouting}）。
 *
 * 打字改提示词、标题、描述时文档每个字都换一份，但图的结构和卡片位置没变：
 * 由结构、走线算出来的东西（图分析、执行批次、全图走线）可以原样沿用上一份，不用每个字都算一遍。
 * 这里的判断必须**精确**——判成「一样」的两份，算出来的结果一定相同（`tests/client/docShape.spec.ts` 对照着算）。
 * 给这些计算加了新的输入，要同步补进对应的判断。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/docShape
 */

import { edgeWhen } from '../../shared/graph.ts'
import { resolveHandoff } from '../../shared/resources.ts'
import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from '../../shared/types.ts'
import { cardSize } from './layout.ts'

/** 两份文档的节点 id、种类逐个相同，连线逐条是同一个对象。 */
function sameSkeleton(a: WorkflowDocument, b: WorkflowDocument): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false
  for (let i = 0; i < a.nodes.length; i += 1) {
    const x = a.nodes[i] as WorkflowNode
    const y = b.nodes[i] as WorkflowNode
    if (x !== y && (x.id !== y.id || x.type !== y.type)) return false
  }
  return true
}

/**
 * 结构一样：节点 id、种类逐个相同，连线逐条是同一个对象（连线改了任何一处——条件、交接——都算变了）。
 * `analyzeGraph`（执行次序、回边、批次）、`graphFacts`（步骤与判定词）只看这些。
 */
export function sameStructure(a: WorkflowDocument, b: WorkflowDocument): boolean {
  if (a === b) return true
  if (a.edges !== b.edges) {
    if (a.edges.length !== b.edges.length) return false
    for (let i = 0; i < a.edges.length; i += 1) if (a.edges[i] !== b.edges[i]) return false
  }
  return sameSkeleton(a, b)
}

/** 两条线走法相关的部分一样吗：两头、条件（牌子宽度、分道颜色）、交接标记、读写方式。 */
function sameEdgeRoute(a: WorkflowEdge, b: WorkflowEdge): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.source !== b.source || a.target !== b.target) return false
  if (edgeWhen(a) !== edgeWhen(b) || a.data?.update !== b.data?.update) return false
  const ha = resolveHandoff(a.data?.handoff)
  const hb = resolveHandoff(b.data?.handoff)
  return ha.result === hb.result && (ha.note === undefined) === (hb.note === undefined)
}

/**
 * 走线一样：`buildRoutes`（canvas/flow）只看卡片的 id、种类、位置、估算尺寸，和 {@link sameEdgeRoute} 里那几样。
 * 大图上全图走线一次要几十毫秒，改文字时不用重算。
 */
export function sameRouting(a: WorkflowDocument, b: WorkflowDocument): boolean {
  if (a === b) return true
  if (!sameSkeleton(a, b)) return false
  for (let i = 0; i < a.nodes.length; i += 1) {
    const x = a.nodes[i] as WorkflowNode
    const y = b.nodes[i] as WorkflowNode
    if (x === y) continue
    if (x.position.x !== y.position.x || x.position.y !== y.position.y) return false
    const sx = cardSize(x)
    const sy = cardSize(y)
    if (sx.w !== sy.w || sx.h !== sy.h) return false
  }
  for (let i = 0; i < a.edges.length; i += 1) {
    if (!sameEdgeRoute(a.edges[i] as WorkflowEdge, b.edges[i] as WorkflowEdge)) return false
  }
  return true
}
