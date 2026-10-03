/**
 * 资源在画布上的样子：卡片高度的估算（`model/layout.ts`）、一项的简称、路径查重（`ui/resourceUi.ts`）。
 */

import { describe, expect, it } from 'vitest'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import {
  cardSize,
  isCompactResource,
  RES_H,
  RES_W,
  resourceHeight,
  tidy,
} from '../../src/client/model/layout.ts'
import {
  addItems,
  filterSkills,
  freeFilePath,
  itemLocation,
  itemName,
  itemText,
  sameItem,
  skillSource,
} from '../../src/client/ui/resourceUi.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import type { ResourceItem, WorkflowDocument } from '../../src/shared/types.ts'

const file = (value: string): ResourceItem => ({ kind: 'file', value })

describe('资源卡的高度', () => {
  it('没名字、没描述、最多一项是紧凑的一行；否则标题 + 描述 + 一行一项，最多列 4 项', () => {
    expect(isCompactResource({ items: [file('a.md')] })).toBe(true)
    expect(isCompactResource({ items: [] })).toBe(true)
    expect(isCompactResource({ label: '资料', items: [file('a.md')] })).toBe(false)
    expect(resourceHeight({ items: [file('a.md')] })).toBe(RES_H)
    expect(resourceHeight({ items: [file('a'), file('b')] })).toBe(38 + 2 * 22 + 10)
    expect(resourceHeight({ label: 'x', description: 'd', items: [] })).toBe(38 + 18 + 22 + 10)
    const many = Array.from({ length: 9 }, (_, index) => file(`${index}.md`))
    expect(resourceHeight({ items: many })).toBe(38 + 4 * 22 + 20 + 10)
    expect(
      cardSize({ id: 'r', type: 'wfResource', position: { x: 0, y: 0 }, data: { items: many } }),
    ).toEqual({ w: RES_W, h: 156 })
  })

  it('整理布局：一个步骤下面挂好几张高矮不一的资源卡，彼此不压', async () => {
    const doc: WorkflowDocument = {
      nodes: [
        { id: 'a', type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: 'a' } },
        {
          id: 'big',
          type: 'wfResource',
          position: { x: 0, y: 0 },
          data: { label: '一叠', items: [file('1'), file('2'), file('3')] },
        },
        { id: 'small', type: 'wfResource', position: { x: 0, y: 0 }, data: { items: [file('s')] } },
      ],
      edges: [
        { id: 'a->big', source: 'a', target: 'big', sourceHandle: null, targetHandle: null },
        { id: 'a->small', source: 'a', target: 'small', sourceHandle: null, targetHandle: null },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const placed = await tidy(doc, analyzeGraph(doc))
    const big = placed.big
    const small = placed.small
    expect(big?.x).toBe(small?.x)
    expect((small?.y ?? 0) - (big?.y ?? 0)).toBeGreaterThanOrEqual(
      resourceHeight(doc.nodes[1]?.data as never),
    )
  })
})

describe('一项的写法与查重', () => {
  it('卡片上：文件取最后一段、网址去协议、自定义取第一行', () => {
    expect(itemText(file('D:/x/docs/spec.md'))).toBe('spec.md')
    expect(itemText({ kind: 'folder', value: 'src/lib/' })).toBe('lib')
    expect(itemText({ kind: 'url', value: 'https://example.com/a/' })).toBe('example.com/a')
    expect(itemText({ kind: 'text', value: '\n第一行\n第二行' })).toBe('第一行')
    expect(itemText({ kind: 'text', value: '## 规矩\n- 先读' })).toBe('规矩')
    expect(itemText({ kind: 'text', value: '- 先读再改' })).toBe('先读再改')
    expect(itemText({ kind: 'skill', value: ' pdf ' })).toBe('pdf')
  })

  it('同种类、值规范化后相同算重复；路径被资源占了就加序号', () => {
    expect(sameItem(file('./a.md'), file('A.md'))).toBe(true)
    expect(sameItem(file('a.md'), { kind: 'folder', value: 'a.md' })).toBe(false)
    const doc: WorkflowDocument = {
      nodes: [
        {
          id: 'r',
          type: 'wfResource',
          position: { x: 0, y: 0 },
          data: { items: [file('scan.md'), { kind: 'url', value: 'x.md' }] },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    expect(freeFilePath(doc, 'scan.md')).toBe('scan-2.md')
    expect(freeFilePath(doc, 'x.md')).toBe('x.md')
  })
})

describe('面板清单里的一行', () => {
  it('名字：网址只取主机名，其余同卡片', () => {
    expect(itemName({ kind: 'url', value: 'https://example.com/api/v1' })).toBe('example.com')
    expect(itemName({ kind: 'url', value: '' })).toBe('')
    expect(itemName(file('D:/x/spec.md'))).toBe('spec.md')
    expect(itemName({ kind: 'text', value: '用中文回答\n不要改测试' })).toBe('用中文回答')
  })

  it('位置：路径（相对路径有人写时换成产出根目录下）、整条网址；Skill 与自定义没有位置', () => {
    expect(itemLocation(file('docs/a.md'), 'out', false)).toEqual({ text: 'docs/a.md', mono: true })
    expect(itemLocation(file('a.md'), 'out', true)).toEqual({ text: 'out/a.md', mono: true })
    expect(itemLocation(file('D:/p/a.md'), 'out', true)).toEqual({ text: 'D:/p/a.md', mono: true })
    expect(itemLocation({ kind: 'url', value: ' https://a.io/x ' }, undefined, false)).toEqual({
      text: 'https://a.io/x',
      mono: false,
    })
    expect(itemLocation({ kind: 'skill', value: 'pdf' }, undefined, false).text).toBe('')
    expect(itemLocation({ kind: 'text', value: 'x' }, undefined, false).text).toBe('')
    expect(itemLocation(file('  '), undefined, false).text).toBe('')
  })

  it('Skill 的来源：认识的给短签和全称，不认识的原样；筛选看名字和说明、不分大小写', () => {
    const t = (key: LocaleKey): string => zh[key]
    expect(skillSource('user-agents', t)).toEqual({
      short: '用户',
      full: '用户的 ~/.agents/skills',
    })
    expect(skillSource('project-dsh', t)).toEqual({ short: '项目', full: '项目的 .dsh/skills' })
    expect(skillSource('bundled', t).short).toBe('内置')
    expect(skillSource('remote-hub', t)).toEqual({ short: 'remote-hub', full: 'remote-hub' })
    expect(skillSource('toString', t)).toEqual({ short: 'toString', full: 'toString' })
    const skills = [
      { name: 'pdf', description: 'Read PDF files', source: 'user-agents' },
      { name: 'brainstorming', description: '发散想法', source: 'user-agents' },
    ]
    expect(filterSkills(skills, '  ')).toBe(skills)
    expect(filterSkills(skills, 'PDF').map((entry) => entry.name)).toEqual(['pdf'])
    expect(filterSkills(skills, '想法').map((entry) => entry.name)).toEqual(['brainstorming'])
    expect(filterSkills(skills, 'nope')).toEqual([])
  })

  it('加几项：重复的跳过（空值照加），满了就停', () => {
    const items = [file('a.md')]
    expect(addItems(items, [file('./a.md'), file('b.md')], 50)).toEqual([
      file('a.md'),
      file('b.md'),
    ])
    expect(addItems(items, [file(''), file('')], 50)).toHaveLength(3)
    expect(addItems(items, [file('b.md'), file('c.md')], 2)).toEqual([file('a.md'), file('b.md')])
  })
})
