import { describe, expect, it } from 'vitest'
import {
  actionOf,
  applyRequest,
  categoryItems,
  categoryOf,
  defaultImportChoice,
  defaultPacked,
  defaultVersions,
  exportGroups,
  fromBase64,
  importSummary,
  leftAbsolute,
  memoryActionOf,
  packedBytes,
  skillChoices,
  skillDestination,
  toBase64,
} from '../../src/client/model/pack.ts'
import type {
  PackImportPreview,
  PackScanItem,
  PackScanResponse,
  PackSkillPreview,
} from '../../src/shared/pack.ts'
import type { VersionEntry } from '../../src/shared/types.ts'

function version(n: number, extra: Partial<VersionEntry> = {}): VersionEntry {
  return { n, createdAt: n, note: '', nodeCount: 1, current: false, ...extra }
}

function item(key: string, state: PackScanItem['state'], extra: Partial<PackScanItem> = {}) {
  return { key, kind: 'file' as const, value: key, state, versions: [1], ...extra }
}

const scan: PackScanResponse = {
  name: 'w',
  items: [
    item('a', 'pack', { bytes: 100 }),
    item('b', 'pack', { bytes: 50 }),
    item('s', 'pack', { kind: 'skill', bytes: 7 }),
    item('m', 'missing'),
    item('r', 'relative'),
    item('x', 'assets'),
    item('o', 'output'),
  ],
  assets: { location: '/d/assets/w', files: 2, bytes: 1000 },
  roots: [],
  limit: 10_000,
}

describe('导出', () => {
  it('默认带和现在一样的那版；没有就最新的；坏的不算', () => {
    expect(defaultVersions([version(1), version(2, { current: true }), version(3)])).toEqual([2])
    expect(defaultVersions([version(1), version(4, { invalid: true }), version(3)])).toEqual([3])
    expect(defaultVersions([])).toEqual([])
  })

  it('分组、大小（资料目录总算进去）、没打包的绝对路径', () => {
    const groups = exportGroups(scan)
    expect(groups.packable.map((entry) => entry.key)).toEqual(['a', 'b', 's'])
    expect(groups.blocked.map((entry) => entry.key)).toEqual(['m'])
    expect(groups.kept.map((entry) => entry.key)).toEqual(['r'])
    expect(groups.assets.map((entry) => entry.key)).toEqual(['x'])
    expect(groups.outputs.map((entry) => entry.key)).toEqual(['o'])
    expect(packedBytes(scan, new Set(['a', 's']))).toBe(1107)
    // b 没勾、m 找不到：两个绝对路径留在图里；没勾的 skill 不算。
    expect(leftAbsolute(scan, new Set(['a']))).toBe(2)
  })

  it('记忆单独一类：能勾、缺省勾上、算大小；库里没有的列在后面；不算留下的绝对路径', () => {
    const withMemory: PackScanResponse = {
      ...scan,
      items: [
        ...scan.items,
        item('mem', 'memory', {
          kind: 'folder',
          value: '{memory}/w',
          bytes: 20,
          memory: { id: 'w', name: '', type: 'workflow' },
        }),
        item('gone', 'missing', { kind: 'folder', value: '{memory}/gone' }),
      ],
    }
    const memory = withMemory.items.find((entry) => entry.key === 'mem') as PackScanItem
    expect(categoryOf(memory)).toBe('memory')
    expect(categoryItems(withMemory, 'memory')).toMatchObject({
      packable: [{ key: 'mem' }],
      others: [{ key: 'gone' }],
    })
    expect(categoryItems(withMemory, 'folder').packable).toEqual([])
    expect([...defaultPacked(withMemory)]).toEqual(['a', 'b', 's', 'mem'])
    expect(packedBytes(withMemory, new Set(['mem']))).toBe(1020)
    expect(leftAbsolute(withMemory, new Set(['a', 'b']))).toBe(1)
  })
})

function skill(state: PackSkillPreview['state'], overwritable = true): PackSkillPreview {
  return {
    name: `k-${state}`,
    source: 'user',
    files: [{ path: 'SKILL.md', bytes: 3 }],
    bytes: 3,
    state,
    target: `/h/.agents/skills/k-${state}`,
    overwritable,
    rename: `k-${state}-2`,
  }
}

const preview: PackImportPreview = {
  token: 't',
  format: 1,
  plugin: '1.0.0',
  exportedAt: '',
  name: 'w',
  current: 2,
  versions: [
    { n: 1, createdAt: 0, note: '', nodeCount: 1 },
    { n: 2, createdAt: 0, note: '', nodeCount: 1 },
  ],
  exists: true,
  unsaved: false,
  suggested: 'w-2',
  assetsRoot: '/d/assets',
  assets: [
    { path: 'a.md', bytes: 1 },
    { path: 'b.md', bytes: 1 },
  ],
  clashes: ['a.md'],
  skillsRoot: '/h/.agents/skills',
  skills: [
    skill('new'),
    skill('same'),
    skill('different'),
    { ...skill('different', false), name: 'k-far' },
  ],
  memories: [
    { id: 'w', type: 'workflow', name: '', files: 2, bytes: 9, exists: false, rename: 'w' },
    {
      id: 'w-review',
      type: 'step',
      name: '审查',
      files: 0,
      bytes: 0,
      exists: true,
      existingName: '本机的审查',
      rename: 'w-review-2',
    },
  ],
  external: [],
}

describe('导入', () => {
  it('每种 skill 能选的处理方式与默认值', () => {
    expect(skillChoices(skill('new'))).toEqual(['install', 'skip'])
    expect(skillChoices(skill('same'))).toEqual(['skip'])
    expect(skillChoices(skill('different'))).toEqual(['skip', 'overwrite', 'rename'])
    expect(skillChoices(skill('different', false))).toEqual(['skip', 'rename'])
    const choice = defaultImportChoice(preview)
    expect(choice).toMatchObject({ mode: 'new', name: 'w-2', assets: 'local' })
    expect(preview.skills.map((entry) => actionOf(choice, entry))).toEqual([
      'install',
      'skip',
      'skip',
      'skip',
    ])
    // 选了不能选的（别处的 skill 选覆盖）：退回默认。
    const odd = { ...choice, skills: { 'k-different': 'overwrite' as const } }
    expect(actionOf(odd, skill('different', false))).toBe('skip')
  })

  it('装到哪', () => {
    expect(skillDestination(preview, skill('new'), 'install')).toBe('/h/.agents/skills/k-new')
    expect(skillDestination(preview, skill('different'), 'rename')).toBe(
      '/h/.agents/skills/k-different-2',
    )
    expect(skillDestination(preview, skill('same'), 'skip')).toBeNull()
  })

  it('记忆：本机没有的就建；有的缺省用本机的，可以另存一份', () => {
    const choice = defaultImportChoice(preview)
    expect(preview.memories.map((entry) => memoryActionOf(choice, entry))).toEqual([
      'create',
      'use',
    ])
    const copy = { ...choice, memories: { 'w-review': 'copy' as const } }
    expect(memoryActionOf(copy, preview.memories[1] as PackImportPreview['memories'][number])).toBe(
      'copy',
    )
    expect(applyRequest(preview, choice, {}).memories).toEqual({ 'w-review': 'use' })
  })

  it('汇总与请求：并入时保留本机的资料不算写入', () => {
    const choice = {
      mode: 'merge' as const,
      name: 'ignored',
      assets: 'local' as const,
      skills: { 'k-different': 'overwrite' as const },
      memories: { 'w-review': 'copy' as const },
    }
    expect(importSummary(preview, choice)).toEqual({
      versions: 2,
      assets: 1,
      skills: 2,
      overwrite: 1,
    })
    expect(applyRequest(preview, choice, { session: 's' })).toEqual({
      token: 't',
      mode: 'merge',
      name: 'w',
      assets: 'local',
      skills: {
        'k-new': 'install',
        'k-same': 'skip',
        'k-different': 'overwrite',
        'k-far': 'skip',
      },
      memories: { 'w-review': 'copy' },
      session: 's',
    })
  })
})

describe('base64', () => {
  it('来回不变（含大于一段的长度）', () => {
    const bytes = new Uint8Array(70_000).map((_, index) => index % 256)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
})
