/**
 * dsh-workflow-lite — 图的语义分析：环、回边、执行批次、出边形态。
 *
 * 允许成环之后，编译器最要紧的四件事都在这里一次算清：
 * - **环 = 强连通分量**（SCC）。一个 SCC 就是一个循环体。
 * - **回边**＝在 SCC 内做一次 DFS，**指向当前 DFS 栈上祖先**的那条边（自环也算）。
 *   起点取该 SCC 的**入口节点**——被环外入边指向的那个；没有环外入边时取 `id` 最小者。
 *   一个 SCC **至少**有一条回边；简单环恰好一条，多环交叠的 SCC 可以有多条。
 * - **回边不计入汇合与批次推导**（它不是"要等它"，而是"再触发一次"）。前向边照常计入前置。
 * - **执行批次**＝在"去掉回边之后的 DAG"上做最长路径分层。
 *
 * 全篇的序一律是 **`id` 的码位序**（不是 `localeCompare`，也不是文件里的数组序）。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/graph
 */

import { idKey, isStep } from './model.ts'
import type {
  CycleGroup,
  EdgeShape,
  ExecutionBatch,
  WorkflowDocument,
  WorkflowEdge,
} from './types.ts'

/** 按**码位序**比较两个字符串（`localeCompare` 会随 locale 变，不能用）。 */
export function compareByCodepoint(a: string, b: string): number {
  const left = [...a]
  const right = [...b]
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i += 1) {
    const ca = left[i]?.codePointAt(0)
    const cb = right[i]?.codePointAt(0)
    if (ca === undefined || cb === undefined) break
    if (ca !== cb) return ca - cb
  }
  return left.length - right.length
}

/** 排序助手：按 `id` 码位序升序。 */
export function byId(a: string, b: string): number {
  return compareByCodepoint(a, b)
}

export interface GraphAnalysis {
  /** 全部**步骤** id，按 `id` 码位序（文件节点不在其中）。 */
  nodeIds: string[]
  /** 边 id → 边。 */
  edgesById: Map<string, WorkflowEdge>
  /** 节点 id → 出边形态。 */
  shapes: Map<string, EdgeShape>
  /** 回边 id 集合。 */
  backEdges: Set<string>
  /** 循环体（SCC）列表，按入口 id 码位序。 */
  cycles: CycleGroup[]
  /** 执行批次，按批次序。 */
  batches: ExecutionBatch[]
  /** 节点 id → 前置 id（**含回边**），按 `id` 码位序。 */
  predecessors: Map<string, string[]>
  /** 节点 id → 后继 id，按 `id` 码位序。 */
  successors: Map<string, string[]>
  /** 图内是否有边指向不存在的节点（悬空 edge ⇒ 保存级）。 */
  danglingEdges: WorkflowEdge[]
}

/** 判形态：单条 = 顺序；全无条件 = 并行扇出；全有条件 = 状态分支；混用 = 歧义。 */
export function classifyShape(outgoing: readonly WorkflowEdge[]): EdgeShape {
  if (outgoing.length <= 1) return 'sequence'
  const conditional = outgoing.filter((edge) => {
    const when = edge.data?.when
    return when !== undefined && when !== ''
  }).length
  if (conditional === 0) return 'fanout'
  if (conditional === outgoing.length) return 'branch'
  return 'mixed'
}

/** 一条边的条件值；缺省与空串都当"无条件"。 */
export function edgeWhen(edge: WorkflowEdge): string | undefined {
  const when = edge.data?.when
  return when === undefined || when === '' ? undefined : when
}

/**
 * 分析整张图。对**悬空 edge**（端点不存在）不抛错——它由校验层判保存级，
 * 这里把这类边收进 `danglingEdges` 并从拓扑计算里排除，好让上层能同时报出
 * "图坏了"与"坏在哪"，而不是在分析阶段就崩掉。
 */
export function analyzeGraph(document: WorkflowDocument): GraphAnalysis {
  // 执行次序只看步骤与步骤之间的线；文件节点和读写线不参与环、批次与前置。
  const steps = document.nodes.filter(isStep)
  const nodeIds = steps.map((node) => node.id).sort(byId)
  const known = new Set(document.nodes.map((node) => idKey(node.id)))
  const stepKeys = new Set(nodeIds.map(idKey))

  const edgesById = new Map<string, WorkflowEdge>()
  const danglingEdges: WorkflowEdge[] = []
  for (const edge of document.edges) {
    edgesById.set(edge.id, edge)
    if (!known.has(idKey(edge.source)) || !known.has(idKey(edge.target))) {
      danglingEdges.push(edge)
    }
  }
  const liveEdges = document.edges.filter(
    (edge) => stepKeys.has(idKey(edge.source)) && stepKeys.has(idKey(edge.target)),
  )

  const outMap = new Map<string, WorkflowEdge[]>()
  const inMap = new Map<string, WorkflowEdge[]>()
  for (const id of nodeIds) {
    outMap.set(id, [])
    inMap.set(id, [])
  }
  for (const edge of liveEdges) {
    outMap.get(resolveKey(nodeIds, edge.source))?.push(edge)
    inMap.get(resolveKey(nodeIds, edge.target))?.push(edge)
  }

  const shapes = new Map<string, EdgeShape>()
  for (const id of nodeIds) shapes.set(id, classifyShape(outMap.get(id) ?? []))

  const sccs = stronglyConnected(nodeIds, liveEdges, outMap)
  const backEdges = new Set<string>()
  const cycles: CycleGroup[] = []

  for (const members of sccs) {
    const set = new Set(members)
    const isSelfLoop =
      members.length === 1 && (outMap.get(members[0] ?? '') ?? []).some((e) => set.has(e.target))
    if (members.length === 1 && !isSelfLoop) continue

    // SCC 的入口：被环外入边指向的节点；没有则取 id 最小者。
    const entry =
      members.find((id) =>
        (inMap.get(id) ?? []).some((edge) => !set.has(resolveKey(nodeIds, edge.source))),
      ) ?? members[0]
    if (entry === undefined) continue

    const back = findBackEdges(entry, set, outMap)
    for (const id of back) backEdges.add(id)
    cycles.push({
      nodes: members,
      backEdges: [...back].sort(byId),
      entry,
      exits: members
        .flatMap((id) => outMap.get(id) ?? [])
        .filter(
          (edge) => !set.has(resolveKey(nodeIds, edge.target)) && edgeWhen(edge) !== undefined,
        )
        .map((edge) => edge.id)
        .sort(byId),
    })
  }
  cycles.sort((a, b) => byId(a.entry, b.entry))

  const predecessors = new Map<string, string[]>()
  const successors = new Map<string, string[]>()
  for (const id of nodeIds) {
    predecessors.set(
      id,
      (inMap.get(id) ?? []).map((edge) => resolveKey(nodeIds, edge.source)).sort(byId),
    )
    successors.set(
      id,
      (outMap.get(id) ?? []).map((edge) => resolveKey(nodeIds, edge.target)).sort(byId),
    )
  }

  return {
    nodeIds,
    edgesById,
    shapes,
    backEdges,
    cycles,
    batches: layerIntoBatches(nodeIds, outMap, inMap, backEdges),
    predecessors,
    successors,
    danglingEdges,
  }
}

/** 把边端点映射回**原样大小写的规范 id**（图内大小写不敏感唯一，但显示要一致）。 */
function resolveKey(nodeIds: readonly string[], raw: string): string {
  const key = idKey(raw)
  return nodeIds.find((id) => idKey(id) === key) ?? raw
}

/**
 * 执行批次：去掉回边之后做最长路径分层。
 * 同一批次内按 `id` 码位序；层内顺序不影响"全部都会走"的语义。
 */
function layerIntoBatches(
  nodeIds: readonly string[],
  outMap: Map<string, WorkflowEdge[]>,
  inMap: Map<string, WorkflowEdge[]>,
  backEdges: ReadonlySet<string>,
): ExecutionBatch[] {
  const forwardOut = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const id of nodeIds) {
    forwardOut.set(id, [])
    indegree.set(id, 0)
  }
  for (const id of nodeIds) {
    for (const edge of outMap.get(id) ?? []) {
      if (backEdges.has(edge.id)) continue
      const target = resolveKey(nodeIds, edge.target)
      forwardOut.get(id)?.push(target)
      indegree.set(target, (indegree.get(target) ?? 0) + 1)
    }
  }
  // 有环外入边但入度被回边吃掉的节点，入度要按"非回边入边"重算。
  for (const id of nodeIds) {
    const forwardIn = (inMap.get(id) ?? []).filter((edge) => !backEdges.has(edge.id)).length
    indegree.set(id, forwardIn)
  }

  const depth = new Map<string, number>()
  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0)
  for (const id of queue) depth.set(id, 0)
  const pending = new Map(indegree)
  let head = 0
  while (head < queue.length) {
    const id = queue[head]
    head += 1
    if (id === undefined) break
    for (const target of (forwardOut.get(id) ?? []).sort(byId)) {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(id) ?? 0) + 1))
      const left = (pending.get(target) ?? 0) - 1
      pending.set(target, left)
      if (left <= 0) queue.push(target)
    }
  }

  const batches: ExecutionBatch[] = []
  const maxDepth = Math.max(0, ...nodeIds.map((id) => depth.get(id) ?? 0))
  for (let level = 0; level <= maxDepth; level += 1) {
    const nodes = nodeIds.filter((id) => (depth.get(id) ?? 0) === level)
    if (nodes.length > 0) batches.push({ nodes: [...nodes].sort(byId) })
  }
  return batches
}

/** 迭代版 Tarjan——避免深图上递归爆栈。返回的每个分量内部按 `id` 码位序。 */
function stronglyConnected(
  nodeIds: readonly string[],
  edges: readonly WorkflowEdge[],
  outMap: Map<string, WorkflowEdge[]>,
): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const result: string[][] = []
  let counter = 0

  const adjacent = (id: string): string[] =>
    (outMap.get(id) ?? []).map((edge) => resolveKey(nodeIds, edge.target)).sort(byId)

  for (const root of nodeIds) {
    if (index.has(root)) continue
    // 显式栈：每帧记录节点与它的邻居游标。
    const frames: Array<{ id: string; next: number }> = [{ id: root, next: 0 }]
    index.set(root, counter)
    low.set(root, counter)
    counter += 1
    stack.push(root)
    onStack.add(root)

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      if (frame === undefined) break
      const neighbours = adjacent(frame.id)
      if (frame.next < neighbours.length) {
        const target = neighbours[frame.next]
        frame.next += 1
        if (target === undefined) continue
        if (!index.has(target)) {
          index.set(target, counter)
          low.set(target, counter)
          counter += 1
          stack.push(target)
          onStack.add(target)
          frames.push({ id: target, next: 0 })
        } else if (onStack.has(target)) {
          low.set(frame.id, Math.min(low.get(frame.id) ?? 0, index.get(target) ?? 0))
        }
        continue
      }
      frames.pop()
      const parent = frames[frames.length - 1]
      if (parent !== undefined) {
        low.set(parent.id, Math.min(low.get(parent.id) ?? 0, low.get(frame.id) ?? 0))
      }
      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = []
        for (;;) {
          const popped = stack.pop()
          if (popped === undefined) break
          onStack.delete(popped)
          component.push(popped)
          if (popped === frame.id) break
        }
        result.push(component.sort(byId))
      }
    }
  }
  void edges
  return result
}

/**
 * 在 SCC 内做一次 DFS，收集**指向当前 DFS 栈上祖先**的边——即回边。
 * 起点是入口节点；自环（指向自己）也算。
 */
function findBackEdges(
  entry: string,
  members: ReadonlySet<string>,
  outMap: Map<string, WorkflowEdge[]>,
): Set<string> {
  const back = new Set<string>()
  const onPath = new Set<string>()
  const visited = new Set<string>()

  const walk = (id: string): void => {
    visited.add(id)
    onPath.add(id)
    const outgoing = [...(outMap.get(id) ?? [])].sort((a, b) => byId(a.id, b.id))
    for (const edge of outgoing) {
      const target = edge.target
      if (!members.has(target)) continue
      if (onPath.has(target)) {
        back.add(edge.id)
        continue
      }
      if (!visited.has(target)) walk(target)
    }
    onPath.delete(id)
  }

  walk(entry)
  // SCC 内从入口不可达的节点（理论上不该有，稳妥起见补扫）。
  for (const id of members) if (!visited.has(id)) walk(id)
  return back
}

/** 一个循环体是否**没有出口**（环上没有任何指向环外的条件边）——警告级。 */
export function cycleHasNoExit(cycle: CycleGroup): boolean {
  return cycle.exits.length === 0
}
