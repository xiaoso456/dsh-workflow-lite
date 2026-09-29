/**
 * 节点库分组单测——守的是那次真实反馈：「没有节点模板分组」。
 *
 * 分组规则不是装饰，它有两条会被误用的边界：
 * - 内置 node 是**平铺**的，不再按规划/执行/审查/修复/汇总分堆——那五个角色名是内置
 *   节点自己的概念，套给用户模板是错的，给六个起点分堆也只是把一条主线切碎。
 * - 自定义 node **只有同前缀出现两次以上才成组**；组名就是**前缀原文**（不翻译），
 *   落单的进「其他」，免得每个 `my-thing` 都冒出一个叫 `my` 的组。
 * - 组排序必须**确定**：具名组按组名码位序，「其他」整底；与输入顺序无关。
 *
 * @module tests/client/presets.spec
 */

import { describe, expect, it } from 'vitest'
import type { LocaleKey } from '../../src/client/core/locales.ts'
import {
  filterGroups,
  groupKey,
  groupLabel,
  groupNodeTemplates,
  isFiltering,
  isGroupExpanded,
  matchesFilter,
  NODE_PRESETS,
  OTHER_GROUP,
  PALETTE_COLLAPSED_KEY,
  parseCollapsed,
  readCollapsed,
  sectionKey,
  templatePrefix,
  writeCollapsed,
} from '../../src/client/core/presets.ts'
import type { TemplateEntry } from '../../src/shared/types.ts'

describe('内置 node', () => {
  it('平铺列表的顺序就是那条常见主线（侦察 → 拆解 → 实现 → 审查 → 修复 → 汇总）', () => {
    expect(NODE_PRESETS.map((preset) => preset.id)).toEqual([
      'scan',
      'plan',
      'implement',
      'review',
      'fix',
      'report',
    ])
  })

  it('id 两两不同（否则节点会被撞名加序号）', () => {
    const ids = NODE_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每颗都有词典键，且没有重复的 label 键', () => {
    const labels = NODE_PRESETS.map((preset) => preset.labelKey)
    expect(new Set(labels).size).toBe(labels.length)
    for (const preset of NODE_PRESETS) {
      expect(preset.promptKey.startsWith('preset.')).toBe(true)
      expect(preset.labelKey.startsWith('preset.')).toBe(true)
    }
  })

  it('产出三态都出现过：字符串、false、以及不写 output 的那一档', () => {
    const outputs = NODE_PRESETS.map((preset) => preset.output)
    expect(outputs.some((value) => typeof value === 'string')).toBe(true)
    expect(outputs.some((value) => value === false)).toBe(true)
  })
})

describe('templatePrefix', () => {
  it('取首个 - 之前那一段', () => {
    expect(templatePrefix('exec-code')).toBe('exec')
    expect(templatePrefix('a-b-c')).toBe('a')
  })

  it('没有前缀就返回 null（前导 - 也算没有）', () => {
    expect(templatePrefix('plain')).toBeNull()
    expect(templatePrefix('-leading')).toBeNull()
    expect(templatePrefix('')).toBeNull()
  })
})

describe('磁盘模板分组（自定义 node）', () => {
  const entry = (name: string): TemplateEntry => ({ name })

  it('同前缀两个以上才成组，组名就是前缀原文', () => {
    const groups = groupNodeTemplates([
      entry('exec-code'),
      entry('exec-test'),
      entry('my-thing'),
      entry('plain'),
    ])
    const byGroup = new Map(groups.map((group) => [group.group, group.items.map((e) => e.name)]))
    // 组名就是前缀原文（`exec`），不做任何映射。
    expect(byGroup.get('exec')).toEqual(['exec-code', 'exec-test'])
    // 落单的（`my` 只出现一次）与没前缀的一起进「其他」。
    expect(byGroup.get(OTHER_GROUP)).toEqual(['my-thing', 'plain'])
  })

  it('认不出的前缀出现两次也照成组（组名就是用户起的那个词）', () => {
    const groups = groupNodeTemplates([entry('zeta-a'), entry('zeta-b')])
    expect(groups.map((group) => group.group)).toEqual(['zeta'])
    expect(groups[0]?.items.map((e) => e.name)).toEqual(['zeta-a', 'zeta-b'])
  })

  it('同前缀只出现一次就算落单，进「其他」', () => {
    const groups = groupNodeTemplates([entry('solo-a'), entry('plain')])
    expect(groups.map((group) => group.group)).toEqual([OTHER_GROUP])
    expect(groups[0]?.items.map((e) => e.name)).toEqual(['solo-a', 'plain'])
  })

  it('无前缀的一律进「其他」', () => {
    const groups = groupNodeTemplates([entry('one'), entry('two'), entry('three')])
    expect(groups.map((group) => group.group)).toEqual([OTHER_GROUP])
    expect(groups[0]?.items.map((e) => e.name)).toEqual(['one', 'two', 'three'])
  })

  it('「其他」永远排在最后', () => {
    const groups = groupNodeTemplates([entry('solo'), entry('review-x'), entry('review-y')])
    expect(groups.map((group) => group.group)).toEqual(['review', OTHER_GROUP])
  })

  it('排序确定：具名组按组名码位序、其他垫底，与输入顺序无关', () => {
    const names = ['beta-b', 'alpha-b', 'alpha-a', 'beta-a', 'solo', 'gamma-a', 'gamma-b']
    const orderOf = (input: readonly string[]): string[] =>
      groupNodeTemplates(input.map(entry)).map((group) => group.group)
    const expected = ['alpha', 'beta', 'gamma', OTHER_GROUP]
    expect(orderOf(names)).toEqual(expected)
    expect(orderOf([...names].reverse())).toEqual(expected)
    expect(
      orderOf(['gamma-b', 'solo', 'beta-a', 'alpha-a', 'beta-b', 'alpha-b', 'gamma-a']),
    ).toEqual(expected)
    // 组内顺序不动（还是目录给出的顺序），只有组与组之间被排定。
    expect(
      groupNodeTemplates(names.map(entry))
        .find((group) => group.group === 'alpha')
        ?.items.map((e) => e.name),
    ).toEqual(['alpha-b', 'alpha-a'])
  })

  it('空输入给空表（画布据此显示「还没有自定义节点」）', () => {
    expect(groupNodeTemplates([])).toEqual([])
  })

  it('原样保留 invalid 标记（坏模板要能在面板上标出来）', () => {
    const groups = groupNodeTemplates([
      { name: 'exec-x', invalid: true, reason: 'prompt 为空' },
      { name: 'exec-y' },
    ])
    expect(groups[0]?.items[0]?.invalid).toBe(true)
  })
})

describe('groupLabel', () => {
  it('空组名走词典（「其他」），前缀原文原样返回', () => {
    const t = (key: LocaleKey): string => (key === 'preset.group.other' ? '其他' : `?${key}`)
    expect(groupLabel(OTHER_GROUP, t)).toBe('其他')
    expect(groupLabel('exec', t)).toBe('exec')
  })

  it('具名组根本不碰词典函数：前缀是用户起的名字，不该被翻译', () => {
    const boom = (): string => {
      throw new Error('具名组不该调用 t')
    }
    expect(groupLabel('review', boom)).toBe('review')
    expect(groupLabel('其他', boom)).toBe('其他')
  })
})

/* ─────────────────────────────────────────────────────────────
 * 折叠与筛选
 *
 * 这一段的攻法：折叠状态是**偏好**不是事实，所以任何读不懂的输入都必须回落"全展开"
 * 而不是抛异常或半解析；组键则必须在两个来源之间真的区分得开（尤其是空组名）。
 * ───────────────────────────────────────────────────────────── */

describe('组键', () => {
  it('格式是 <来源>:<组名>', () => {
    expect(groupKey('disk', 'exec')).toBe('disk:exec')
    expect(groupKey('disk', '')).toBe('disk:')
    expect(groupKey('builtin', '')).toBe('builtin:')
  })

  it('两个来源的同名组（尤其空组）必须区分开', () => {
    expect(groupKey('builtin', '')).not.toBe(groupKey('disk', ''))
    expect(groupKey('builtin', 'exec')).not.toBe(groupKey('disk', 'exec'))
  })

  it('自定义节点产生的组键合起来不撞车', () => {
    const keys = groupNodeTemplates([{ name: 'exec-a' }, { name: 'exec-b' }, { name: 'solo' }]).map(
      (group) => groupKey('disk', group.group),
    )
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('disk:exec')
    expect(keys).toContain('disk:')
  })
})

describe('分节键', () => {
  it('格式是 section:<来源>，两个分节各一个键', () => {
    expect(sectionKey('builtin')).toBe('section:builtin')
    expect(sectionKey('disk')).toBe('section:disk')
    expect(sectionKey('builtin')).not.toBe(sectionKey('disk'))
  })

  it('分节键不跟组键共用键空间（分节不是组）', () => {
    // 组键的语义是「来源:组名」。分节要是借道塞进去，就得占用某个组名（比如 `disk:section`），
    // 于是「真有一个模板前缀叫 section」会和「自定义 node 这一节自己」塌成同一个键。
    // 两套前缀分开之后，`section:disk` 与 `disk:section` 是两个互不影响的键。
    expect(sectionKey('disk')).not.toBe(groupKey('disk', 'section'))
    expect(sectionKey('builtin')).not.toBe(groupKey('builtin', 'section'))
    for (const source of ['builtin', 'disk'] as const) {
      expect(sectionKey(source).startsWith('section:')).toBe(true)
      // 组键永远以来源前缀开头，不可能落进 `section:` 命名空间（来源只有 builtin / disk 两个）。
      expect(groupKey(source, 'section').startsWith('section:')).toBe(false)
    }
  })

  it('分节键与自定义节点产生的组键合起来不撞车', () => {
    const keys = [
      sectionKey('builtin'),
      sectionKey('disk'),
      ...groupNodeTemplates([{ name: 'section-a' }, { name: 'section-b' }, { name: 'solo' }]).map(
        (group) => groupKey('disk', group.group),
      ),
    ]
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('disk:section')
    expect(keys).toContain('section:disk')
  })
})

describe('parseCollapsed —— 折叠表解析', () => {
  it('null / 非法 JSON / 不是数组 / 含非字符串，一律回落全展开且不抛', () => {
    const junk = [
      'not json',
      '{',
      '"str"',
      '123',
      'true',
      '{}',
      'null',
      '["a",1]',
      '[null]',
      '[["a"]]',
      '{"__proto__":[]}',
    ]
    for (const raw of junk) {
      expect(() => parseCollapsed(raw)).not.toThrow()
      expect(parseCollapsed(raw)).toEqual([])
    }
    expect(() => parseCollapsed(null)).not.toThrow()
    expect(parseCollapsed(null)).toEqual([])
  })

  it('合法数组原样给出', () => {
    expect(parseCollapsed('[]')).toEqual([])
    expect(parseCollapsed('["builtin:plan","disk:"]')).toEqual(['builtin:plan', 'disk:'])
    expect(parseCollapsed('[""]')).toEqual([''])
  })

  it('混了非字符串就整表作废，不做半解析（否则会留下一个半开半合的栏）', () => {
    expect(parseCollapsed('["builtin:plan",7]')).toEqual([])
    expect(parseCollapsed('[7,"builtin:plan"]')).toEqual([])
  })
})

describe('readCollapsed / writeCollapsed', () => {
  it('拿不到 storage 就全展开，不抛', () => {
    expect(readCollapsed(null)).toEqual([])
    expect(readCollapsed(undefined)).toEqual([])
    expect(() => writeCollapsed(null, ['builtin:plan'])).not.toThrow()
    expect(() => writeCollapsed(undefined, ['builtin:plan'])).not.toThrow()
  })

  it('读取本身抛异常（隐私模式）也回落全展开', () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(() => readCollapsed(storage)).not.toThrow()
    expect(readCollapsed(storage)).toEqual([])
  })

  it('读得到就解析，键里没记录就全展开', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null }
    expect(readCollapsed(storage)).toEqual([])
    store.set(PALETTE_COLLAPSED_KEY, '["disk:"]')
    expect(readCollapsed(storage)).toEqual(['disk:'])
  })

  it('写回用契约里那个键，且写出去的东西读得回来', () => {
    const written: [string, string][] = []
    const storage = {
      setItem: (key: string, value: string) => {
        written.push([key, value])
      },
    }
    writeCollapsed(storage, ['builtin:', 'disk:plan'])
    expect(written).toEqual([[PALETTE_COLLAPSED_KEY, '["builtin:","disk:plan"]']])
    expect(parseCollapsed(written[0]?.[1] ?? null)).toEqual(['builtin:', 'disk:plan'])
  })

  it('写不进去（配额）静默放弃', () => {
    const storage = {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => writeCollapsed(storage, ['builtin:plan'])).not.toThrow()
  })

  it('PALETTE_COLLAPSED_KEY 是契约写死的那个', () => {
    expect(PALETTE_COLLAPSED_KEY).toBe('workflow-lite.palette.collapsed')
  })
})

describe('筛选', () => {
  it('只有空白不算筛（空词等于不筛，而不是没有东西匹配）', () => {
    expect(isFiltering('')).toBe(false)
    expect(isFiltering('   ')).toBe(false)
    expect(isFiltering('\t\n')).toBe(false)
    expect(isFiltering('a')).toBe(true)
    expect(isFiltering(' a ')).toBe(true)
  })

  it('匹配是大小写不敏感的子串；空词一律命中', () => {
    expect(matchesFilter('Scan Notes', 'SCAN')).toBe(true)
    expect(matchesFilter('scan notes', 'can')).toBe(true)
    expect(matchesFilter('扫描', '扫')).toBe(true)
    expect(matchesFilter('扫描', 'SCAN')).toBe(false)
    expect(matchesFilter('scan', '')).toBe(true)
    expect(matchesFilter('scan', '   ')).toBe(true)
    expect(matchesFilter('scan', ' scan ')).toBe(true)
    expect(matchesFilter('scan', 'zzz')).toBe(false)
  })

  it('不筛时原样返回（顺序与空组都保留），hits = total', () => {
    const groups = [
      { group: 'plan' as const, items: ['scan', 'plan'] },
      { group: '' as const, items: [] },
    ]
    const filtered = filterGroups(groups, '', (item) => item)
    expect(filtered.map((group) => group.group)).toEqual(['plan', ''])
    expect(filtered[0]?.items).toEqual(['scan', 'plan'])
    expect(filtered[0]?.hits).toBe(2)
    expect(filtered[0]?.total).toBe(2)
    expect(filtered[1]?.items).toEqual([])
    expect(filtered[1]?.hits).toBe(0)
  })

  it('筛的时候丢掉零命中的组；组头的 total 仍是筛前的总数', () => {
    const groups = [
      { group: 'plan' as const, items: ['scan', 'plan'] },
      { group: 'exec' as const, items: ['implement'] },
    ]
    const filtered = filterGroups(groups, 'PLA', (item) => item)
    expect(filtered.map((group) => group.group)).toEqual(['plan'])
    expect(filtered[0]?.items).toEqual(['plan'])
    expect(filtered[0]?.hits).toBe(1)
    expect(filtered[0]?.total).toBe(2)
  })

  it('零命中给空表（整栏显示 palette.noMatch）', () => {
    const filtered = filterGroups([{ group: 'plan' as const, items: ['scan'] }], 'zzz', (i) => i)
    expect(filtered).toEqual([])
  })

  it('textOf 拿到的是条目本身（磁盘模板按机器名筛）', () => {
    const groups = [{ group: 'exec' as const, items: [{ name: 'exec-code' }, { name: 'other' }] }]
    const filtered = filterGroups(groups, 'EXEC', (item) => item.name)
    expect(filtered.map((group) => group.items.map((item) => item.name))).toEqual([['exec-code']])
  })

  it('筛出的是原条目本身，不是副本（点它加节点要拿到原参数）', () => {
    const items = [{ name: 'exec-code' }]
    const filtered = filterGroups([{ group: 'exec' as const, items }], 'code', (item) => item.name)
    expect(filtered[0]?.items[0]).toBe(items[0])
  })
})

describe('isGroupExpanded', () => {
  it('折叠表里有就折，没有就展开', () => {
    expect(isGroupExpanded('builtin:plan', [], false)).toBe(true)
    expect(isGroupExpanded('builtin:plan', ['builtin:plan'], false)).toBe(false)
  })

  it('筛选中一律展开（命中的东西必须当场可见）', () => {
    expect(isGroupExpanded('builtin:plan', ['builtin:plan'], true)).toBe(true)
    expect(isGroupExpanded('disk:', ['disk:'], true)).toBe(true)
  })

  it('两个来源的同名组互不牵连', () => {
    expect(isGroupExpanded('builtin:', ['builtin:'], false)).toBe(false)
    expect(isGroupExpanded('disk:', ['builtin:'], false)).toBe(true)
    expect(isGroupExpanded('builtin:plan', ['disk:plan'], false)).toBe(true)
  })
})
