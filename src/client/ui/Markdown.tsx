/**
 * dsh-workflow-lite — 一个小而安全的 Markdown 渲染器（计划预览用）。
 *
 * 为什么不引库：模块加载器只认冻结的平台 externals，引进来的库要整个打进 bundle；而计划
 * 只用到 Markdown 的一小块（标题、段落、粗体、行内代码、表格、列表、引用、代码块、分隔线）。
 *
 * **只产出 React 元素，从不拼 HTML 字符串**：提示词是用户写的任意文本，走 `innerHTML`
 * 就是一个注入口。链接只认 http(s)。
 *
 * 换行按"一行就是一行"处理（GitHub 评论区那种），而不是 CommonMark 的"单个换行算空格"——
 * 提示词与计划都是按行写的，把它们挤成一段反而难读。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Markdown
 */

import type { ReactNode } from 'react'
import css from './markdown.module.css'

// ─────────────────────────────────────────────────────────────
// 行内
// ─────────────────────────────────────────────────────────────

const INLINE: readonly { kind: 'code' | 'strong' | 'em' | 'link'; pattern: RegExp }[] = [
  { kind: 'code', pattern: /`([^`]+)`/ },
  { kind: 'strong', pattern: /\*\*(.+?)\*\*/ },
  { kind: 'link', pattern: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/ },
  // 斜体只认星号：下划线在文件名里太常见（fix_notes.md），按下划线认会把它们拆碎。
  { kind: 'em', pattern: /\*([^*\s](?:[^*]*[^*\s])?)\*/ },
]

/** 把一行文字渲染成行内元素（代码里的东西原样保留，不再往里解析）。 */
export function renderInline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let index = 0
  while (rest !== '') {
    let best: { kind: string; match: RegExpExecArray } | null = null
    for (const { kind, pattern } of INLINE) {
      const match = pattern.exec(rest)
      if (match !== null && (best === null || match.index < best.match.index)) {
        best = { kind, match }
      }
    }
    if (best === null) {
      out.push(rest)
      break
    }
    const { kind, match } = best
    if (match.index > 0) out.push(rest.slice(0, match.index))
    const id = `${key}.${index}`
    const inner = match[1] ?? ''
    if (kind === 'code') out.push(<code key={id}>{inner}</code>)
    if (kind === 'strong') out.push(<strong key={id}>{renderInline(inner, id)}</strong>)
    if (kind === 'em') out.push(<em key={id}>{renderInline(inner, id)}</em>)
    if (kind === 'link') {
      out.push(
        <a key={id} href={match[2]} target="_blank" rel="noopener noreferrer">
          {renderInline(inner, id)}
        </a>,
      )
    }
    rest = rest.slice(match.index + match[0].length)
    index += 1
  }
  return out
}

/** 多行文字：行内渲染，行与行之间换行。 */
function lines(text: readonly string[], key: string): ReactNode[] {
  return text.flatMap((line, index) => {
    const nodes = renderInline(line, `${key}.${index}`)
    if (index === 0) return nodes
    // biome-ignore lint/suspicious/noArrayIndexKey: 换行符只有位置可言，文本不变它就不变
    return [<br key={`${key}.br${index}`} />, ...nodes]
  })
}

// ─────────────────────────────────────────────────────────────
// 块
// ─────────────────────────────────────────────────────────────

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function isTableStart(all: readonly string[], at: number): boolean {
  const head = all[at]
  const rule = all[at + 1]
  return (
    head !== undefined &&
    rule !== undefined &&
    head.includes('|') &&
    TABLE_RULE.test(rule) &&
    rule.includes('-')
  )
}

function startsBlock(all: readonly string[], at: number): boolean {
  const line = all[at] ?? ''
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    isTableStart(all, at)
  )
}

function cells(row: string): string[] {
  let trimmed = row.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split(/(?<!\\)\|/u).map((cell) => cell.trim().replaceAll('\\|', '|'))
}

type Align = 'left' | 'center' | 'right' | undefined

function alignments(rule: string): Align[] {
  return cells(rule).map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return undefined
  })
}

function indentOf(line: string): number {
  return (/^\s*/u.exec(line)?.[0] ?? '').replaceAll('\t', '    ').length
}

/** 把若干行解析成块级元素。 */
function blocks(all: readonly string[], key: string): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  while (at < all.length) {
    const line = all[at] ?? ''
    const id = `${key}.${at}`

    if (line.trim() === '') {
      at += 1
      continue
    }

    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[1] ?? '```'
      const body: string[] = []
      at += 1
      while (at < all.length && !(all[at] ?? '').trim().startsWith(marker)) {
        body.push(all[at] ?? '')
        at += 1
      }
      at += 1
      out.push(
        <pre key={id} className={css.code}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      const level = Math.min(6, (heading[1] ?? '#').length)
      const Tag = `h${level}` as 'h1'
      out.push(<Tag key={id}>{renderInline(heading[2] ?? '', id)}</Tag>)
      at += 1
      continue
    }

    if (RULE.test(line)) {
      out.push(<hr key={id} />)
      at += 1
      continue
    }

    if (isTableStart(all, at)) {
      const head = cells(line)
      const align = alignments(all[at + 1] ?? '')
      const rows: string[][] = []
      at += 2
      while (at < all.length && (all[at] ?? '').includes('|') && (all[at] ?? '').trim() !== '') {
        rows.push(cells(all[at] ?? ''))
        at += 1
      }
      out.push(
        <div key={id} className={css.tableWrap}>
          <table>
            <thead>
              <tr>
                {head.map((cell, column) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 表格列只有位置，没有身份
                  <th key={column} style={{ textAlign: align[column] }}>
                    {renderInline(cell, `${id}.h${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 同上，行也只有位置
                <tr key={rowIndex}>
                  {head.map((_, column) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                    <td key={column} style={{ textAlign: align[column] }}>
                      {renderInline(row[column] ?? '', `${id}.${rowIndex}.${column}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (at < all.length && QUOTE.test(all[at] ?? '')) {
        body.push((all[at] ?? '').replace(QUOTE, ''))
        at += 1
      }
      out.push(<blockquote key={id}>{blocks(body, id)}</blockquote>)
      continue
    }

    const item = LIST_ITEM.exec(line)
    if (item !== null) {
      const base = indentOf(line)
      const ordered = /\d/u.test(item[2] ?? '')
      const items: string[][] = []
      // 收这一张列表：同一缩进的条目开新项，更深的缩进（子列表、续行）归到当前项里。
      while (at < all.length) {
        const current = all[at] ?? ''
        if (current.trim() === '') {
          const next = all[at + 1] ?? ''
          if (indentOf(next) > base && next.trim() !== '') {
            items.at(-1)?.push('')
            at += 1
            continue
          }
          break
        }
        const match = LIST_ITEM.exec(current)
        if (match !== null && indentOf(current) === base) {
          items.push([match[3] ?? ''])
        } else if (indentOf(current) > base) {
          items.at(-1)?.push(current.slice(Math.min(indentOf(current), base + 2)))
        } else {
          break
        }
        at += 1
      }
      const Tag = ordered ? 'ol' : 'ul'
      const start = ordered ? Number.parseInt(item[2] ?? '1', 10) : undefined
      out.push(
        <Tag key={id} {...(ordered && start !== 1 ? { start } : {})}>
          {items.map((body, index) => {
            const itemKey = `${id}.li${index}`
            const [first = '', ...more] = body
            const nested = more.some((_, index) => startsBlock(more, index))
            return (
              <li key={itemKey}>
                {nested ? (
                  <>
                    {renderInline(first, itemKey)}
                    {blocks(more, itemKey)}
                  </>
                ) : (
                  lines(body, itemKey)
                )}
              </li>
            )
          })}
        </Tag>,
      )
      continue
    }

    // 段落：直到空行或别的块开头。
    const body: string[] = []
    while (
      at < all.length &&
      (all[at] ?? '').trim() !== '' &&
      (body.length === 0 || !startsBlock(all, at))
    ) {
      body.push(all[at] ?? '')
      at += 1
    }
    out.push(<p key={id}>{lines(body, id)}</p>)
  }
  return out
}

export function Markdown(props: { text: string; className?: string }): React.JSX.Element {
  return (
    <div className={[css.md, props.className].filter(Boolean).join(' ')}>
      {blocks(props.text.replace(/\r\n?/gu, '\n').split('\n'), 'md')}
    </div>
  )
}
