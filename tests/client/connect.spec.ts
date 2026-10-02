/**
 * `src/client/model/connect.ts`：拖线时哪些连接点能连、连上会是什么线。
 */

import { describe, expect, it } from 'vitest'
import { dragKindOf, linkAllowed, previewLink } from '../../src/client/model/connect.ts'
import type { FileNode, StepNode, WorkflowDocument } from '../../src/shared/types.ts'

function step(id: string): StepNode {
  return { id, type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: id } }
}

function file(id: string, path: string): FileNode {
  return { id, type: 'wfFile', position: { x: 0, y: 0 }, data: { path } }
}

const doc: WorkflowDocument = {
  nodes: [step('review'), step('fix'), file('f', 'review.md'), file('g', 'notes.md')],
  edges: [
    { id: 'review->f', source: 'review', target: 'f', sourceHandle: null, targetHandle: null },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
}

describe('起点的种类', () => {
  it('按节点类型与连接点认出是哪种拖线', () => {
    expect(dragKindOf(false, 'out')).toBe('flow')
    expect(dragKindOf(false, 'file')).toBe('write')
    expect(dragKindOf(false, 'in')).toBe('back')
    expect(dragKindOf(true, 'out')).toBe('read')
    expect(dragKindOf(true, 'in')).toBe('writeBack')
    expect(dragKindOf(true, 'file')).toBeNull()
    expect(dragKindOf(false, 'fileUp')).toBe('write')
    expect(dragKindOf(false, 'readTop')).toBe('readBack')
  })
})

describe('能不能连', () => {
  it('步骤右边只连步骤、步骤底边只连文件、文件只连步骤；不连自己', () => {
    const link = (source: string, sourceHandle: string, target: string) =>
      linkAllowed(doc, { source, sourceHandle, target, targetHandle: 'in' })
    expect(link('review', 'out', 'fix')).toBe(true)
    expect(link('review', 'out', 'f')).toBe(false)
    expect(link('review', 'file', 'g')).toBe(true)
    expect(link('review', 'file', 'fix')).toBe(false)
    expect(link('f', 'out', 'fix')).toBe(true)
    expect(link('f', 'out', 'g')).toBe(false)
    expect(link('fix', 'out', 'fix')).toBe(false)
    // 备用点：读点 / 上边的写点，分工同上。
    const raw = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
      linkAllowed(doc, { source, sourceHandle, target, targetHandle })
    expect(raw('f', 'out', 'fix', 'readTop')).toBe(true)
    expect(raw('fix', 'fileUp', 'g', 'in')).toBe(true)
    expect(raw('f', 'in', 'fix', 'read')).toBe(false)
    expect(raw('review', 'out', 'fix', 'read')).toBe(false)
    expect(raw('fix', 'file', 'f', 'out')).toBe(false)
    expect(
      linkAllowed(doc, {
        source: 'review',
        sourceHandle: 'out',
        target: 'fix',
        targetHandle: 'file',
      }),
    ).toBe(false)
  })
})

describe('连上会是什么线', () => {
  it('流程 / 产出 / 别人在写就是更新 / 读取；已经连着的标出来', () => {
    expect(
      previewLink(doc, { source: 'review', sourceHandle: 'out', target: 'fix', targetHandle: 'in' })
        ?.kind,
    ).toBe('flow')
    expect(
      previewLink(doc, { source: 'fix', sourceHandle: 'file', target: 'g', targetHandle: 'in' })
        ?.kind,
    ).toBe('produce')
    expect(
      previewLink(doc, { source: 'fix', sourceHandle: 'file', target: 'f', targetHandle: 'in' })
        ?.kind,
    ).toBe('update')
    const again = previewLink(doc, {
      source: 'review',
      sourceHandle: 'file',
      target: 'f',
      targetHandle: 'in',
    })
    expect(again?.kind).toBe('produce')
    expect(again?.exists).toBe(true)
    expect(
      previewLink(doc, { source: 'f', sourceHandle: 'out', target: 'fix', targetHandle: 'in' })
        ?.kind,
    ).toBe('read')
    expect(
      previewLink(doc, { source: 'f', sourceHandle: 'out', target: 'g', targetHandle: 'in' }),
    ).toBeNull()
  })
})
