import { describe, expect, it } from 'vitest'
import { duplicateEdit } from '../../src/client/app/addStep.ts'
import { copyTitle, nodeTitle } from '../../src/client/model/nodeName.ts'
import type { WorkflowDocument } from '../../src/shared/types.ts'

const doc = {
  nodes: [
    { id: 'a', type: 'wfNode', position: { x: 10, y: 20 }, data: { label: '写周报', prompt: 'x' } },
    { id: 'b', type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: 'y' } },
    {
      id: 'r',
      type: 'wfResource',
      position: { x: 0, y: 0 },
      data: { label: '周报', items: [{ kind: 'file', value: 'out/weekly.md' }] },
    },
    { id: 'i', type: 'wfInput', position: { x: 0, y: 0 }, data: { question: '写给谁？' } },
  ],
  edges: [],
} as unknown as WorkflowDocument

describe('nodeTitle', () => {
  it('names a step by label, then id; a resource by label; an input by question', () => {
    expect(nodeTitle(doc.nodes[0] as never)).toBe('写周报')
    expect(nodeTitle(doc.nodes[1] as never)).toBe('b')
    expect(nodeTitle(doc.nodes[2] as never)).toBe('周报')
    expect(nodeTitle(doc.nodes[3] as never)).toBe('写给谁？')
  })

  it('shortens a long name', () => {
    const long = { ...doc.nodes[0], data: { label: 'x'.repeat(60) } }
    expect(nodeTitle(long as never)).toHaveLength(28)
  })
})

describe('copyTitle', () => {
  it('appends the suffix, then numbers further copies, never stacking suffixes', () => {
    expect(copyTitle('写周报', '副本', new Set(['写周报']))).toBe('写周报 副本')
    expect(copyTitle('写周报', '副本', new Set(['写周报', '写周报 副本']))).toBe('写周报 副本 2')
    expect(copyTitle('写周报 副本', '副本', new Set(['写周报', '写周报 副本']))).toBe(
      '写周报 副本 2',
    )
    expect(copyTitle('a.b', 'copy', new Set())).toBe('a.b copy')
  })
})

describe('duplicateEdit', () => {
  it('renames a labelled step and resource, leaves an unlabelled step and an input alone', () => {
    const step = duplicateEdit(doc, 'a', '副本')
    expect(step).toMatchObject({ type: 'addNode', data: { label: '写周报 副本' } })
    expect(duplicateEdit(doc, 'b', '副本')).toMatchObject({ data: { prompt: 'y' } })
    expect(duplicateEdit(doc, 'r', '副本')).toMatchObject({
      type: 'addResource',
      data: { label: '周报 副本' },
    })
    expect(duplicateEdit(doc, 'i', '副本')).toMatchObject({
      type: 'addInput',
      data: { question: '写给谁？' },
    })
  })

  it('keeps the original name when no suffix is given', () => {
    expect(duplicateEdit(doc, 'a')).toMatchObject({ data: { label: '写周报' } })
  })

  it('is null for a node that is not there', () => {
    expect(duplicateEdit(doc, 'zzz', '副本')).toBeNull()
  })
})
