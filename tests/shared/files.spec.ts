/**
 * `src/shared/files.ts`：线的种类、「谁写谁读」、步骤的产出同步、交接的解释。
 */

import { describe, expect, it } from 'vitest'
import {
  edgeKind,
  fileGraph,
  flowEdges,
  nodeIndex,
  outputsOf,
  resolveHandoff,
  roleOf,
  setStepOutputs,
  stepFiles,
} from '../../src/shared/files.ts'
import { makeEdgeId } from '../../src/shared/model.ts'
import type {
  EdgeData,
  FileNode,
  StepNode,
  WorkflowDocument,
  WorkflowEdge,
} from '../../src/shared/types.ts'

function step(id: string): StepNode {
  return { id, type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: id } }
}

function file(id: string, path: string, rule?: string): FileNode {
  return {
    id,
    type: 'wfFile',
    position: { x: 0, y: 0 },
    data: rule === undefined ? { path } : { path, rule },
  }
}

function edge(source: string, target: string, data?: EdgeData): WorkflowEdge {
  return {
    id: makeEdgeId(source, target, data?.when),
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(data === undefined ? {} : { data }),
  }
}

function doc(nodes: (StepNode | FileNode)[], edges: WorkflowEdge[]): WorkflowDocument {
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }
}

const sample = doc(
  [step('review'), step('fix'), step('report'), file('f', 'issues.md', '问题清单')],
  [
    edge('review', 'fix', { when: 'fail' }),
    edge('review', 'f'),
    edge('fix', 'f', { update: true }),
    edge('f', 'fix'),
    edge('f', 'report'),
  ],
)

describe('线的种类', () => {
  it('步骤 → 步骤 = flow；步骤 → 文件 = write；文件 → 步骤 = read；文件 → 文件 = invalid；端点不在 = dangling', () => {
    const nodes = nodeIndex(doc([step('a'), file('f', 'f.md'), file('g', 'g.md')], []))
    expect(edgeKind(nodes, edge('a', 'a'))).toBe('flow')
    expect(edgeKind(nodes, edge('a', 'f'))).toBe('write')
    expect(edgeKind(nodes, edge('f', 'a'))).toBe('read')
    expect(edgeKind(nodes, edge('f', 'g'))).toBe('invalid')
    expect(edgeKind(nodes, edge('a', 'ghost'))).toBe('dangling')
    expect(flowEdges(sample).map((item) => item.id)).toEqual(['review->fix#fail'])
  })
})

describe('谁写谁读', () => {
  it('写的记写入方式；既写又读的只记成写', () => {
    const info = fileGraph(sample).get('f')
    expect(info?.writers).toEqual([
      { id: 'review', update: false },
      { id: 'fix', update: true },
    ])
    expect(info?.readers).toEqual(['report'])
    expect(roleOf(info, 'review')).toBe('producer')
    expect(roleOf(info, 'fix')).toBe('updater')
    expect(roleOf(info, 'report')).toBe('reader')
    expect(roleOf(info, 'nobody')).toBeNull()
  })

  it('一个步骤的文件：写的、读的；产出清单带上规则（存成模板用）', () => {
    const files = stepFiles(sample, 'fix')
    expect(files.writes.map((item) => [item.file.id, item.update])).toEqual([['f', true]])
    expect(files.reads.map((item) => item.file.id)).toEqual(['f'])
    expect(outputsOf(sample, 'review')).toEqual([{ path: 'issues.md', rule: '问题清单' }])
  })
})

describe('setStepOutputs', () => {
  it('没有的路径新建文件节点；已有的连上（别人在写就默认更新）；不在清单里的断开，没人连的删掉', () => {
    const document = doc(
      [step('a'), step('b'), file('file-old.md', 'old.md')],
      [edge('b', 'file-old.md')],
    )
    setStepOutputs(document, 'a', [{ path: 'new.md', rule: 'r' }, { path: 'old.md' }])
    expect(document.nodes.map((node) => node.id)).toEqual(['a', 'b', 'file-old.md', 'file-new.md'])
    expect(document.edges.find((item) => item.id === 'a->file-old.md')?.data).toEqual({
      update: true,
    })
    expect(document.nodes[3]?.data).toEqual({ path: 'new.md', rule: 'r' })

    setStepOutputs(document, 'a', [])
    expect(document.nodes.map((node) => node.id)).toEqual(['a', 'b', 'file-old.md'])
    expect(document.edges.map((item) => item.id)).toEqual(['b->file-old.md'])
  })
})

describe('resolveHandoff', () => {
  it('缺省交执行结果；对象附说明（空白当没写）；false 只管先后', () => {
    expect(resolveHandoff(undefined)).toEqual({ result: true })
    expect(resolveHandoff({ note: ' 修 ' })).toEqual({ result: true, note: '修' })
    expect(resolveHandoff({ note: '  ' })).toEqual({ result: true })
    expect(resolveHandoff(false)).toEqual({ result: false })
  })
})
