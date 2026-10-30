/**
 * dsh-workflow-lite — 文本类产出换个样子看：CSV / TSV 排成表、压成一行的 JSON 展开缩进、
 * 文件更新后哪几行是新的（追加的日志、改过的行）。纯函数，展示卡和查看框共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/textShape
 */

import { extensionOf } from '../../shared/fileKind.ts'
import { diffLines } from './lineDiff.ts'

// ── 表格 ────────────────────────────────────────────────────

/** 按扩展名能不能排成表：`.csv` 认逗号（或分号，见 {@link parseDelimited}），`.tsv` / `.tab` 认制表符。 */
export function tableFormat(path: string): 'csv' | 'tsv' | null {
  const ext = extensionOf(path)
  if (ext === 'csv') return 'csv'
  if (ext === 'tsv' || ext === 'tab') return 'tsv'
  return null
}

export interface ParsedTable {
  /** 第一行当表头。 */
  head: string[]
  /** 表体（最多 `maxRows` 行）。 */
  rows: string[][]
  /** 表体一共几行（含没排出来的）。 */
  total: number
  /** 最宽那一行有几列（短的行按空格子补齐）。 */
  columns: number
}

/**
 * CSV 的分隔符：`.tsv` 是制表符；`.csv` 默认逗号，第一行里分号比逗号多就用分号（欧洲区域设置导出的 Excel 常这样）。
 */
export function delimiterOf(format: 'csv' | 'tsv', text: string): string {
  if (format === 'tsv') return '\t'
  const end = text.search(/\r?\n/u)
  const first = end < 0 ? text : text.slice(0, end)
  const count = (char: string): number => first.split(char).length - 1
  return count(';') > count(',') ? ';' : ','
}

/**
 * 按 RFC 4180 拆：双引号包住的格子里可以有分隔符、换行，`""` 是一个引号；行尾认 `\r\n` 和 `\n`，末尾的空行不算。
 * 只拆到 `maxRows` 行表体为止，后面的只数行数（大文件不整份拆开）。
 */
export function parseDelimited(text: string, delimiter: string, maxRows: number): ParsedTable {
  const records: string[][] = []
  let total = 0
  let row: string[] = []
  let cell = ''
  let quoted = false
  let index = 0
  const keep = (): boolean => records.length <= maxRows
  const endRow = (): void => {
    row.push(cell)
    cell = ''
    // 整行都是空的（空行）不算一条。
    if (!(row.length === 1 && row[0] === '')) {
      if (keep()) records.push(row)
      total += 1
    }
    row = []
  }
  while (index < text.length) {
    const char = text[index] as string
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
    } else if (char === '"' && cell === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      endRow()
      // 排够了：剩下的只数行（引号里的换行不算一行，不拆格子）。
      if (!keep()) {
        total += countRecords(text, index + 1)
        break
      }
    } else {
      cell += char
    }
    index += 1
  }
  if (index >= text.length && (cell !== '' || row.length > 0)) endRow()
  const [head = [], ...rows] = records
  const columns = Math.max(head.length, ...rows.map((entry) => entry.length))
  return { head, rows: rows.slice(0, maxRows), total: Math.max(0, total - 1), columns }
}

/** 从 `from` 起还有几条记录：引号外的换行才断行，空行不算。 */
function countRecords(text: string, from: number): number {
  let count = 0
  let quoted = false
  let filled = false
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"') quoted = !quoted
    if (!quoted && (char === '\n' || char === '\r')) {
      if (filled) count += 1
      filled = false
    } else if (char !== ' ' && char !== '\t') {
      filled = true
    }
  }
  return filled ? count + 1 : count
}

/** 像数字的格子：可带正负号、千分位、小数、百分号、货币符号和不超过三个字母的单位（`12.5ms`、`¥1,284.00`）。 */
const NUMERIC = /^[-+]?[¥$€£]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(?:%|[a-zA-Z]{1,3})?$/u

export function isNumeric(cell: string): boolean {
  return NUMERIC.test(cell.trim())
}

/** 每一列是不是数字列（非空格子里七成以上像数字）：数字列右对齐、等宽数字，一眼比得出大小。 */
export function numericColumns(table: ParsedTable): boolean[] {
  return Array.from({ length: table.columns }, (_, column) => {
    let filled = 0
    let numbers = 0
    for (const row of table.rows) {
      const cell = row[column]?.trim() ?? ''
      if (cell === '') continue
      filled += 1
      if (isNumeric(cell)) numbers += 1
    }
    return filled > 0 && numbers / filled >= 0.7
  })
}

/** 列的名字（隐藏、排序按名字记，文件里列换了位置也认得）：表头没写的叫 `#3`。 */
export function columnName(head: readonly string[], column: number): string {
  const name = head[column]?.trim() ?? ''
  return name === '' ? `#${column + 1}` : name
}

/** 格子里的数（去掉千分位、货币符号、单位）；不像数的是 `null`。 */
export function numberOf(cell: string): number | null {
  const match = /^[-+]?\d+(?:\.\d+)?/u.exec(cell.replace(/[\s,¥$€£]/gu, ''))
  return match === null ? null : Number(match[0])
}

/**
 * 按一列排：数字列比大小，别的按文字（带数字的按数字大小）；空的、不像数的总在最后。一样的保持原顺序。
 * 回的是行号的新顺序（原来的行号还用得着：新加的行亮一下认的是原来的位置）。
 */
export function sortOrder(
  rows: readonly string[][],
  column: number,
  numeric: boolean,
  desc: boolean,
): number[] {
  const keys = rows.map((row) => {
    const cell = row[column]?.trim() ?? ''
    return numeric ? numberOf(cell) : cell === '' ? null : cell
  })
  const sign = desc ? -1 : 1
  return rows
    .map((_, index) => index)
    .sort((a, b) => {
      const x = keys[a] ?? null
      const y = keys[b] ?? null
      if (x === null || y === null) return x === y ? a - b : x === null ? 1 : -1
      const order =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true })
      return order === 0 ? a - b : order * sign
    })
}

// ── JSON ────────────────────────────────────────────────────

/** 超过这么大的 JSON 不展开（展开要整份解析一遍）。 */
export const PRETTY_JSON_MAX = 512 * 1024

/**
 * 压成一行（或几行很长）的 JSON 展开成两格缩进；已经排好版的、解析不了的、太大的回 `null`（原样显示）。
 * 只改显示，文件本身不动。
 */
export function prettyJson(path: string, text: string): string | null {
  if (extensionOf(path) !== 'json' || text.length > PRETTY_JSON_MAX) return null
  const trimmed = text.trim()
  if (trimmed === '' || !(trimmed.startsWith('{') || trimmed.startsWith('['))) return null
  const lines = trimmed.split('\n')
  // 排过版的（每行都不长）不动：原文的键序、注释位置、缩进习惯都留着。
  const compact = lines.length <= 2 || trimmed.length / lines.length > 160
  if (!compact) return null
  try {
    const pretty = JSON.stringify(JSON.parse(trimmed), null, 2)
    return pretty === trimmed ? null : pretty
  } catch {
    return null
  }
}

// ── 更新了哪几行 ────────────────────────────────────────────

/** 两份都不超过这么大才逐行比（再大只看是不是在后面追加）。 */
const MARK_DIFF_MAX = 200 * 1024
/** 拿旧的最后几行去新的里面找；太短的（一两个字）到处都是，不算数。 */
const ANCHOR_LINES = 3
const ANCHOR_MIN = 12
const ANCHOR_MAX = 4096

/** 最后 {@link ANCHOR_LINES} 行（从行首起，含末尾的换行；最多 {@link ANCHOR_MAX} 个字）。 */
function tailAnchor(text: string): string {
  let start = text.endsWith('\n') ? text.length - 1 : text.length
  for (let found = 0; found < ANCHOR_LINES && start > 0; found += 1) {
    start = text.lastIndexOf('\n', start - 1)
    if (start < 0) break
  }
  const from = start < 0 ? 0 : start + 1
  return text.slice(Math.max(from, text.length - ANCHOR_MAX))
}

/** `text` 前 `end` 个字里有几个换行（= 第 `end` 个字落在第几行，从 0 起）。 */
function countNewlines(text: string, end: number): number {
  let count = 0
  for (
    let index = text.indexOf('\n');
    index >= 0 && index < end;
    index = text.indexOf('\n', index + 1)
  ) {
    count += 1
  }
  return count
}

/**
 * 文件从 `before` 变成 `after`：新的几行（`after` 里的行号，从 0 起）。
 * 在后面追加的（日志）只比较开头，不做整份差分；改得太多（超过一半）不标——那是整份重写，标了也满屏都是。
 */
export function newLines(before: string, after: string): Set<number> {
  const marked = new Set<number>()
  if (before === after) return marked
  const afterLines = after.split(/\r?\n/u)
  if (afterLines.at(-1) === '') afterLines.pop()
  const markFrom = (start: number): Set<number> => {
    for (let line = start; line < afterLines.length; line += 1) marked.add(line)
    return marked
  }
  // 追加：旧的有几个换行，前几行就没动；旧的最后一行没写完（没有换行）时它被续上了，也算新的。
  if (after.startsWith(before)) return markFrom(countNewlines(before, before.length))
  // 只读了末尾一截的（大日志读末尾，开头跟着往后挪）：旧的最后几行在新的里面找得到，那之后就是新追加的。
  // 找最后一处——日志里常有一模一样的行，宁可少标几行，不把旧的标成新的。
  const anchor = tailAnchor(before)
  const at = anchor.length < ANCHOR_MIN ? -1 : after.lastIndexOf(anchor)
  if (at >= 0 && at + anchor.length < after.length) {
    return markFrom(countNewlines(after, at + anchor.length))
  }
  if (before.length > MARK_DIFF_MAX || after.length > MARK_DIFF_MAX) return marked
  for (const line of diffLines(before, after)) {
    if (line.kind === 'add' && line.b !== undefined) marked.add(line.b - 1)
  }
  return marked.size > afterLines.length / 2 ? new Set() : marked
}
