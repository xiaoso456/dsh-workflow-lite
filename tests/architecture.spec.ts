/**
 * 源码分层的防回归：看 `src/` 里每条相对 import（含 `export … from`、只引样式的 `import '…'`、
 * 动态 `import('…')`，样式模块也算），守住这几条：
 *
 * 1. `shared` 只依赖 `shared`；`host` 与 `client` 互不依赖。
 * 2. `client/model`、`client/app` 不依赖界面（`client/ui`），只有 `client/app` 用到动效层 `ui/motion`。
 * 3. 界面的基础层（`kit`、`motion`）不依赖功能目录；属性面板的通用零件（`panel`）只依赖基础层。
 * 4. 没有循环 import（只看值依赖，`import type` 不算：它在运行时不存在）。
 * 5. 功能目录之间互相引用的只有下面登记过的几对；新出现一对说明边界划错了，先想清楚再加进表。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)],
  )
}

const show = (file: string): string => relative(SRC, file).split('\\').join('/')

interface Edge {
  from: string
  to: string
  /** `import type` / `export type`：运行时不存在，不算进循环。 */
  typeOnly: boolean
}

const IMPORT =
  /(?:^|[;\n])\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?'(\.[^']+)'|\bimport\(\s*'(\.[^']+)'\s*\)/g

const sources = walk(SRC).filter((file) => /\.tsx?$/.test(file))
const edges: Edge[] = sources.flatMap((file) => {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  return [...text.matchAll(IMPORT)].flatMap((match) => {
    const target = resolve(dirname(file), (match[2] ?? match[3]) as string)
    if (!existsSync(target)) return []
    return [{ from: show(file), to: show(target), typeOnly: match[1] !== undefined }]
  })
})

/** 一个文件归哪一层：`shared`、`host`、`client/model`、`client/app`、`ui/<目录>`、`client`（根上的几个）。 */
function layer(file: string): string {
  const parts = file.split('/')
  if (parts[0] !== 'client') return parts[0] as string
  if (parts[1] === 'ui') return `ui/${parts.length > 3 ? parts[2] : '(root)'}`
  return parts.length > 2 ? `client/${parts[1]}` : 'client'
}

const BASE = new Set(['ui/kit', 'ui/motion'])

/** 属性面板的通用零件：模板编辑器、实例视图、资源面板都用，所以只许依赖基础层。 */
const PANEL = 'ui/panel'

/**
 * 允许互相引用的功能目录（字母序在前的写前面）。这三对都在外框上：工作流视图（shell）装着实例视图（run），
 * 顶栏的菜单行、状态徽标、问题清单几处共用；要拆得先把顶栏零件单独成一层。
 */
const TWO_WAY = new Set<string>(['ui/hub ↔ ui/run', 'ui/hub ↔ ui/shell', 'ui/run ↔ ui/shell'])

const lines = (list: Edge[]): string[] => list.map(({ from, to }) => `${from} → ${to}`)

describe('源码分层', () => {
  it('读到了 import（防正则失灵后整套空跑）', () => {
    expect(edges.length).toBeGreaterThan(1000)
    expect(edges.some((edge) => edge.to.endsWith('.module.css'))).toBe(true)
  })

  it('shared 只依赖 shared；host 与 client 互不依赖', () => {
    const bad = edges.filter(({ from, to }) => {
      const [a, b] = [from.split('/')[0], to.split('/')[0]]
      // 根上的 index.ts 是插件入口（主机侧），把 host 装起来，不算一层。
      if (!from.includes('/')) return false
      return (a === 'shared' && b !== 'shared') || (a !== 'shared' && b !== 'shared' && a !== b)
    })
    expect(lines(bad)).toEqual([])
  })

  it('client/model、client/app 不依赖界面（client/app 只用动效层）', () => {
    const bad = edges.filter(({ from, to }) => {
      const [a, b] = [layer(from), layer(to)]
      if (a !== 'client/model' && a !== 'client/app') return false
      return b.startsWith('ui/') && !(a === 'client/app' && b === 'ui/motion')
    })
    expect(lines(bad)).toEqual([])
  })

  it('界面基础层（kit、motion）不依赖功能目录；panel 只依赖基础层', () => {
    const bad = edges.filter(({ from, to }) => {
      const [a, b] = [layer(from), layer(to)]
      if (!b.startsWith('ui/') || BASE.has(b) || a === b) return false
      return BASE.has(a) || a === PANEL
    })
    expect(lines(bad)).toEqual([])
  })

  it('没有循环 import（只看值依赖）', () => {
    const next = new Map<string, string[]>()
    for (const { from, to, typeOnly } of edges) {
      if (typeOnly || !/\.tsx?$/.test(to)) continue
      next.set(from, [...(next.get(from) ?? []), to])
    }
    // Tarjan 强连通分量：大于一个文件的分量就是一个环。
    const index = new Map<string, number>()
    const low = new Map<string, number>()
    const stack: string[] = []
    const onStack = new Set<string>()
    const cycles: string[][] = []
    const visit = (v: string): void => {
      index.set(v, index.size)
      low.set(v, index.get(v) as number)
      stack.push(v)
      onStack.add(v)
      for (const w of next.get(v) ?? []) {
        if (!index.has(w)) {
          visit(w)
          low.set(v, Math.min(low.get(v) as number, low.get(w) as number))
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v) as number, index.get(w) as number))
        }
      }
      if (low.get(v) !== index.get(v)) return
      const component: string[] = []
      let w: string | undefined
      do {
        w = stack.pop() as string
        onStack.delete(w)
        component.push(w)
      } while (w !== v)
      if (component.length > 1) cycles.push(component.sort())
    }
    for (const file of sources.map(show)) if (!index.has(file)) visit(file)
    expect(cycles).toEqual([])
  })

  it('功能目录之间互相引用的只有登记过的几对', () => {
    const pairs = new Set<string>()
    for (const { from, to } of edges) {
      const [a, b] = [layer(from), layer(to)]
      if (a === b || BASE.has(a) || BASE.has(b)) continue
      if (a.startsWith('ui/') && b.startsWith('ui/')) pairs.add(`${a} ${b}`)
    }
    const twoWay = [...pairs]
      .map((pair) => pair.split(' ') as [string, string])
      .filter(([a, b]) => a < b && pairs.has(`${b} ${a}`))
      .map(([a, b]) => `${a} ↔ ${b}`)
      .sort()
    expect(twoWay).toEqual([...TWO_WAY].sort())
  })
})
