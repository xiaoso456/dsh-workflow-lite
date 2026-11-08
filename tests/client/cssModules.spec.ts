/**
 * CSS 模块的两条防回归：
 * 1. 构建按文件名给 `<style>` 定 id，同名的第二个会被静默丢掉（Windows 又不分大小写），所以文件名转小写后不能重复；
 * 2. CSS 模块的类型是 `Record<string, string>`，引错类名 tsc 查不出，运行时就是 `undefined`（样式静默丢失）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../src/', import.meta.url))

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)],
  )
}

const files = walk(SRC)
const cssFiles = files.filter((file) => file.endsWith('.module.css'))
const sourceFiles = files.filter((file) => /\.tsx?$/.test(file))

const show = (file: string): string => relative(SRC, file).split('\\').join('/')

/** CSS 里定义过的类：只看选择器（`{` 前面的部分），去掉注释、字符串和 `:global(...)`。 */
function definedClasses(css: string): Set<string> {
  const text = css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/:global\([^)]*\)/g, ' ')
  const classes = new Set<string>()
  for (const prelude of text.matchAll(/([^{};]+)\{/g)) {
    for (const found of (prelude[1] as string).matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
      classes.add(found[1] as string)
    }
  }
  return classes
}

/**
 * 把源码里不可能是类引用的部分抹掉：注释、正则字面量、普通字符串、模板字符串的字面部分
 * （`${…}` 里面是代码，保留）。`名字['类名']` 里的字符串是类引用，写成 `«类名»` 留下。
 */
function codeOf(source: string): string {
  let i = 0
  let out = ''
  const regexAllowedAfter = /[(,=:[!&|?{};+\-*%<>~^]$/

  function skipString(quote: string): string {
    const start = i
    i++
    while (i < source.length && source[i] !== quote && source[i] !== '\n') {
      i += source[i] === '\\' ? 2 : 1
    }
    const body = source.slice(start + 1, i)
    i++
    return body
  }

  /** 模板字符串：字面部分丢掉，`${…}` 里按代码读。 */
  function skipTemplate(): void {
    i++
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '\\') {
        i += 2
      } else if (source[i] === '$' && source[i + 1] === '{') {
        i += 2
        out += ' '
        readCode(true)
        out += ' '
      } else {
        i++
      }
    }
    i++
  }

  function readCode(inTemplate: boolean): void {
    let depth = 0
    while (i < source.length) {
      const ch = source[i] as string
      const next = source[i + 1]
      if (ch === '/' && next === '/') {
        while (i < source.length && source[i] !== '\n') i++
      } else if (ch === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2)
        i = end < 0 ? source.length : end + 2
      } else if (ch === '/' && regexAllowedAfter.test(out.trimEnd()) && out.trimEnd() !== '') {
        i++
        let inClass = false
        while (i < source.length && (source[i] !== '/' || inClass) && source[i] !== '\n') {
          if (source[i] === '\\') i++
          else if (source[i] === '[') inClass = true
          else if (source[i] === ']') inClass = false
          i++
        }
        i++
        out += '/regex/'
      } else if (ch === "'" || ch === '"') {
        const body = skipString(ch)
        out += /\[\s*$/.test(out) && /^[\w-]+$/.test(body) ? `«${body}»` : '""'
      } else if (ch === '`') {
        skipTemplate()
        out += '``'
      } else if (ch === '{') {
        depth++
        out += ch
        i++
      } else if (ch === '}') {
        if (inTemplate && depth === 0) {
          i++
          return
        }
        depth--
        out += ch
        i++
      } else {
        out += ch
        i++
      }
    }
  }

  readCode(false)
  return out
}

describe('CSS 模块文件', () => {
  it('找得到 CSS 模块和源码文件（防止路径写错让下面的检查空跑）', () => {
    expect(cssFiles.length).toBeGreaterThan(50)
    expect(sourceFiles.length).toBeGreaterThan(100)
  })

  it('文件名转小写后不能重复（构建按文件名定 style 的 id，同名的第二个静默不注入）', () => {
    const byName = new Map<string, string[]>()
    for (const file of cssFiles) {
      const key = basename(file).toLowerCase()
      byName.set(key, [...(byName.get(key) ?? []), show(file)])
    }
    const clashes = [...byName]
      .filter(([, list]) => list.length > 1)
      .map(([, list]) => list.join(' <-> '))
    expect(clashes).toEqual([])
  })
})

describe('CSS 模块的类引用', () => {
  it("源码抹除器：注释、字符串、模板字符串的字面部分不算；模板插值里的代码和 `名字['类名']` 保留", () => {
    const code = codeOf(
      [
        '// css.inComment',
        '/* css.inBlock */',
        "const a = 'css.inString'",
        'const b = t(`run.hint.$' + '{css.inTemplate}`)',
        "const c = css['bracket-name']",
        'const d = /css.inRegex/.test(x)',
      ].join('\n'),
    )
    expect(code).not.toMatch(/inComment|inBlock|inString|inRegex|run\.hint/)
    expect(code).toContain('css.inTemplate')
    expect(code).toContain('css[«bracket-name»]')
  })

  it("每个 `X.类名` / `X['类名']` 都在它 import 的那个 .module.css 里有定义", () => {
    const cache = new Map<string, Set<string>>()
    const classesOf = (file: string): Set<string> => {
      let set = cache.get(file)
      if (set === undefined) {
        set = definedClasses(readFileSync(file, 'utf8'))
        cache.set(file, set)
      }
      return set
    }
    const problems: string[] = []
    let checked = 0
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8')
      const imports = [...source.matchAll(/^import\s+(\w+)\s+from\s+'([^']+\.module\.css)'/gm)]
      if (imports.length === 0) continue
      const code = codeOf(source)
      for (const imported of imports) {
        const name = imported[1] as string
        const rel = imported[2] as string
        const cssFile = resolve(dirname(file), rel)
        if (!cssFiles.includes(cssFile)) {
          problems.push(`${show(file)}: import 的 ${rel} 不存在`)
          continue
        }
        const have = classesOf(cssFile)
        const ref = new RegExp(`(?<![\\w$.])${name}(?:\\.([A-Za-z_$][\\w$]*)|\\[«([^»]+)»\\])`, 'g')
        for (const found of code.matchAll(ref)) {
          const cls = (found[1] ?? found[2]) as string
          checked++
          if (!have.has(cls))
            problems.push(`${show(file)}: ${name}.${cls}（${show(cssFile)} 里没有）`)
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
    expect(problems).toEqual([])
  })
})
