/**
 * `src/client/model/connect.ts`：拖线时哪些连接点能连、连上会是什么线。
 */

import { describe, expect, it } from 'vitest'
import { dragKindOf, linkAllowed, previewLink } from '../../src/client/model/connect.ts'
import type { ResourceNode, StepNode, WorkflowDocument } from '../../src/shared/types.ts'

function step(id: string): StepNode {
  return { id, type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: id } }
}

function file(id: string, path: string): ResourceNode {
  return {
    id,
    type: 'wfResource',
    position: { x: 0, y: 0 },
    data: { items: [{ kind: 'file', value: path }] },
  }
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
    expect(dragKindOf('step', 'out')).toBe('flow')
    expect(dragKindOf('step', 'file')).toBe('write')
    expect(dragKindOf('step', 'in')).toBe('back')
    expect(dragKindOf('resource', 'out')).toBe('read')
    expect(dragKindOf('resource', 'in')).toBe('writeBack')
    expect(dragKindOf('resource', 'file')).toBeNull()
    expect(dragKindOf('step', 'fileUp')).toBe('write')
    expect(dragKindOf('step', 'readTop')).toBe('readBack')
    expect(dragKindOf('input', 'out')).toBe('ask')
    expect(dragKindOf('input', 'in')).toBeNull()
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

describe('输入卡的线', () => {
  const doc: WorkflowDocument = {
    nodes: [
      { id: 's', type: 'wfNode', position: { x: 400, y: 0 }, data: { prompt: 'p' } },
      { id: 'q', type: 'wfInput', position: { x: 0, y: 0 }, data: { question: '问' } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }

  it('输入右边只连步骤的入口 / 读点；什么都不能连进输入', () => {
    expect(
      linkAllowed(doc, { source: 'q', sourceHandle: 'out', target: 's', targetHandle: 'read' }),
    ).toBe(true)
    expect(
      linkAllowed(doc, { source: 'q', sourceHandle: 'out', target: 's', targetHandle: 'in' }),
    ).toBe(true)
    expect(
      linkAllowed(doc, { source: 's', sourceHandle: 'out', target: 'q', targetHandle: 'out' }),
    ).toBe(false)
    expect(
      previewLink(doc, { source: 'q', sourceHandle: 'out', target: 's', targetHandle: 'read' })
        ?.kind,
    ).toBe('ask')
  })
})
