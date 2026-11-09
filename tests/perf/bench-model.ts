/**
 * 性能场景（Node 侧，不起浏览器）：大图下几段纯计算各要多久。
 *
 * | 场景 | 量什么 |
 * |---|---|
 * | 整理排版 | `tidy`（ELK）给整张图排一次 |
 * | 全图走线 | `buildRoutes` 没有上一版可复用时（打开、整理、改了图）算一遍所有读写线 |
 * | 拖动一帧走线 | 拖连线最多的步骤时每帧的 `buildRoutes`（复用拖动前的走法，只重算受影响的线） |
 * | 改动比对 | `graphChanges`：改了一个步骤的提示词，和磁盘上那版比出改了什么（保存、实例草稿都走它） |
 * | 工作流列表 | 仓储 `list()`：数据目录里 N 张图时列一次（顶栏切换列表、工作流中心都要它） |
 *
 * usage: node --experimental-strip-types tests/perf/bench-model.ts [--copies 4,16] [--workflows 50,200]
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tidy } from '../../src/client/model/layout.ts'
import { buildRoutes, type RouteBase } from '../../src/client/ui/canvas/flow/buildRoutes.ts'
import { workflowFile } from '../../src/host/store/paths.ts'
import { createRepository } from '../../src/host/store/repository.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { graphChanges } from '../../src/shared/graphDiff.ts'
import type { Point, WorkflowDocument } from '../../src/shared/types.ts'
import { bigGraph, busiestStep } from './bigGraph.ts'

const arg = (name: string, fallback: string): number[] => {
  const i = process.argv.indexOf(`--${name}`)
  return (i < 0 ? fallback : (process.argv[i + 1] ?? fallback)).split(',').map(Number)
}

/** 跑 `reps` 次取中位数和 p90（先空跑 `warm` 次让 JIT 热起来）。 */
async function time(
  reps: number,
  fn: () => unknown,
  warm = 2,
): Promise<{ median: number; p90: number }> {
  for (let i = 0; i < warm; i += 1) await fn()
  const list: number[] = []
  for (let i = 0; i < reps; i += 1) {
    const start = performance.now()
    await fn()
    list.push(performance.now() - start)
  }
  list.sort((a, b) => a - b)
  const at = (q: number): number =>
    +(list[Math.min(list.length - 1, Math.floor(list.length * q))] ?? 0).toFixed(2)
  return { median: at(0.5), p90: at(0.9) }
}

const row = (label: string, value: string): void => console.log(`  ${label.padEnd(22)}${value}`)
const ms = (t: { median: number; p90: number }): string => `${t.median} ms（p90 ${t.p90}）`

async function laidOut(copies: number): Promise<WorkflowDocument> {
  const doc = bigGraph(copies) as WorkflowDocument
  const positions = await tidy(doc, analyzeGraph(doc))
  return {
    ...doc,
    nodes: doc.nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
  }
}

for (const copies of arg('copies', '4,16')) {
  const raw = bigGraph(copies) as WorkflowDocument
  console.log(`\n■ ${raw.nodes.length} 张卡、${raw.edges.length} 条线（${copies} 份）`)
  row('整理排版', ms(await time(5, () => tidy(raw, analyzeGraph(raw)), 1)))

  const doc = await laidOut(copies)
  const sizes = new Map<string, { width: number; height: number }>()
  const fresh = { current: null as RouteBase | null }
  row(
    '全图走线',
    ms(
      await time(20, () =>
        buildRoutes({ doc, dragging: {}, sized: 0, sizes, routeBase: { current: null } }),
      ),
    ),
  )

  // 拖动：先算一遍不拖的（留下 routeBase），再沿一条往返的路一帧一帧挪。
  buildRoutes({ doc, dragging: {}, sized: 0, sizes, routeBase: fresh })
  const busy = busiestStep(doc)
  const start = doc.nodes.find((node) => node.id === busy)?.position as Point
  let frame = 0
  const dragFrame = (): void => {
    frame += 1
    const t = (frame % 60) / 60
    const dragging = {
      [busy]: { x: start.x + Math.sin(t * Math.PI * 2) * 300, y: start.y + t * 200 },
    }
    buildRoutes({ doc, dragging, sized: 0, sizes, routeBase: fresh })
  }
  const degree = doc.edges.filter((edge) => edge.source === busy || edge.target === busy).length
  row(`拖动一帧走线（${degree} 条线）`, ms(await time(120, dragFrame)))

  const edited: WorkflowDocument = {
    ...doc,
    nodes: doc.nodes.map((node) =>
      node.id === busy && node.type === 'wfNode'
        ? { ...node, data: { ...node.data, prompt: `${node.data.prompt}改` } }
        : node,
    ),
  }
  row('改动比对', ms(await time(50, () => graphChanges(doc, edited))))
}

for (const count of arg('workflows', '50,200')) {
  const dataDir = await mkdtemp(join(tmpdir(), 'wl-perf-list-'))
  try {
    const repository = createRepository({ dataDir })
    await repository.ensureLayout()
    const doc = JSON.stringify(await laidOut(4))
    for (let i = 0; i < count; i += 1) await writeFile(workflowFile(dataDir, `wf-${i}`), doc)
    console.log(`\n■ 工作流列表：${count} 张图（每张 ${bigGraph(4).nodes.length} 张卡）`)
    const first = performance.now()
    await repository.list()
    row('第一次', `${(performance.now() - first).toFixed(1)} ms`)
    row('再列（都没改）', ms(await time(10, () => repository.list(), 1)))
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
}
