/**
 * 节点库单测——守的是那次真实反馈：「不需要有二级分类节点」。
 *
 * 现在两层都只有一层，规则简单，但仍有两条会被误用的边界：
 * - 内置 node 是**平铺**的（侦察 → 拆解 → 实现 → 审查 → 修复 → 汇总），不再按角色分堆——
 *   那五个角色名是内置节点自己的概念，给六个起点分堆只是把一条常见主线切碎。
 * - 自定义 node 同样平铺：曾经按模板名前缀归并过，前缀是文件名的偶然形状、不是用户表达的
 *   分类，已被用户否掉。那一整套分组工具（含哨兵组名「其他」）连同它的用例一起删掉了。
 *
 * 折叠状态是**偏好**不是事实：任何读不懂的输入都必须回落"全展开"而不是抛异常或半解析。
 *
 * @module tests/client/presets.spec
 */

import { describe, expect, it } from 'vitest'
import {
  isGroupExpanded,
  NODE_PRESETS,
  PALETTE_COLLAPSED_KEY,
  parseCollapsed,
  readCollapsed,
  sectionKey,
  writeCollapsed,
} from '../../src/client/core/presets.ts'

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

/* ─────────────────────────────────────────────────────────────
 * 折叠
 *
 * 这一段的攻法：折叠状态是**偏好**不是事实，所以任何读不懂的输入都必须回落"全展开"
 * 而不是抛异常或半解析。（筛选那一段随筛选框一起删了。）
 * ───────────────────────────────────────────────────────────── */

describe('分节键', () => {
  it('格式是 section:<来源>，两个分节各一个键', () => {
    expect(sectionKey('builtin')).toBe('section:builtin')
    expect(sectionKey('disk')).toBe('section:disk')
    expect(sectionKey('builtin')).not.toBe(sectionKey('disk'))
  })

  /*
   * 「分节键不与组键撞车」那两条随分组工具一起删了：组键已经不存在，再断言"两套命名空间
   * 互不重叠"就成了对空气的断言。键仍然带 `section:` 前缀——那是给**历史偏好**留的：
   * 上一版写进 localStorage 的 `disk:exec` 那批键不会错位到分节上。
   */
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

describe('isGroupExpanded', () => {
  it('折叠表里有就折，没有就展开', () => {
    expect(isGroupExpanded('section:builtin', [])).toBe(true)
    expect(isGroupExpanded('section:builtin', ['section:builtin'])).toBe(false)
  })

  it('两个分节的键互不牵连', () => {
    expect(isGroupExpanded('section:builtin', ['section:builtin'])).toBe(false)
    expect(isGroupExpanded('section:disk', ['section:builtin'])).toBe(true)
    // 上一版留下的组键（`disk:exec` 一类）对不上任何分节键，因此不会误折。
    expect(isGroupExpanded('section:disk', ['disk:exec'])).toBe(true)
  })
})
