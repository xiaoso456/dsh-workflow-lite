/**
 * dsh-workflow-lite — 两版文字逐行比：哪几行删了、哪几行加了，没变的长段折起来。
 *
 * 先去掉首尾相同的行，中间用 Myers 差分（编辑最少的那种对齐）；改得太多（超过 {@link MAX_EDITS} 处）
 * 就不再找最优，中间整段当「删了旧的、加了新的」——这么大的改动逐行对齐也没法看。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/lineDiff
 */

export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
  /** 旧版里的行号（从 1 起；加的行没有）。 */
  a?: number
  /** 新版里的行号（删的行没有）。 */
  b?: number
}

/** 找最优对齐最多走这么多步（编辑数），再多就整段替换。 */
const MAX_EDITS = 1000

/** 拆行：认 `\r\n`、`\n`；末尾的换行不算多出一行空行。 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** Myers：从 `a` 变成 `b` 的最短编辑，按顺序给出每一行是保留、删还是加；超了步数回 `null`。 */
function myers(a: readonly string[], b: readonly string[]): DiffLine['kind'][] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
          ? (v[offset + k + 1] as number)
          : (v[offset + k - 1] as number) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(trace, offset, n, m, d)
    }
  }
  return null
}

function backtrack(
  trace: readonly Int32Array[],
  offset: number,
  n: number,
  m: number,
  depth: number,
): DiffLine['kind'][] {
  const ops: DiffLine['kind'][] = []
  let x = n
  let y = m
  for (let d = depth; d > 0; d -= 1) {
    const v = trace[d] as Int32Array
    const k = x - y
    const down =
      k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
    const prevK = down ? k + 1 : k - 1
    const prevX = v[offset + prevK] as number
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push('same')
      x -= 1
      y -= 1
    }
    ops.push(down ? 'add' : 'del')
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    ops.push('same')
    x -= 1
    y -= 1
  }
  return ops.reverse()
}

/** 逐行比两版文字。 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1
  }
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const ops = myers(midA, midB) ?? [
    ...midA.map(() => 'del' as const),
    ...midB.map(() => 'add' as const),
  ]
  const out: DiffLine[] = []
  for (let index = 0; index < head; index += 1) {
    out.push({ kind: 'same', text: a[index] as string, a: index + 1, b: index + 1 })
  }
  let x = head
  let y = head
  for (const op of ops) {
    if (op === 'same') {
      out.push({ kind: 'same', text: a[x] as string, a: x + 1, b: y + 1 })
      x += 1
      y += 1
    } else if (op === 'del') {
      out.push({ kind: 'del', text: a[x] as string, a: x + 1 })
      x += 1
    } else {
      out.push({ kind: 'add', text: b[y] as string, b: y + 1 })
      y += 1
    }
  }
  for (let index = 0; index < tail; index += 1) {
    out.push({ kind: 'same', text: a[x + index] as string, a: x + index + 1, b: y + index + 1 })
  }
  return out
}

/** 改了几行：加的、删的。 */
export function diffCounts(lines: readonly DiffLine[]): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const line of lines) {
    if (line.kind === 'add') add += 1
    else if (line.kind === 'del') del += 1
  }
  return { add, del }
}

/** 显示的一段：几行，或一段折起来的没变的行。 */
export type DiffChunk =
  | { kind: 'lines'; lines: DiffLine[] }
  | { kind: 'fold'; lines: DiffLine[]; at: number }

/**
 * 没变的长段折起来：改动上下各留 `context` 行，中间超过 `2 × context + 2` 行没变的折成一段（`at` 是它在第几行起）。
 * 一处都没改时整份折成一段。
 */
export function foldDiff(lines: readonly DiffLine[], context = 3): DiffChunk[] {
  const chunks: DiffChunk[] = []
  let shown: DiffLine[] = []
  const flush = (): void => {
    if (shown.length > 0) chunks.push({ kind: 'lines', lines: shown })
    shown = []
  }
  let index = 0
  while (index < lines.length) {
    if ((lines[index] as DiffLine).kind !== 'same') {
      shown.push(lines[index] as DiffLine)
      index += 1
      continue
    }
    let end = index
    while (end < lines.length && (lines[end] as DiffLine).kind === 'same') end += 1
    const run = lines.slice(index, end)
    const first = index === 0
    const last = end === lines.length
    const keepHead = first ? 0 : context
    const keepTail = last ? 0 : context
    if (run.length > keepHead + keepTail + 2) {
      shown.push(...run.slice(0, keepHead))
      flush()
      chunks.push({
        kind: 'fold',
        lines: run.slice(keepHead, run.length - keepTail),
        at: index + keepHead,
      })
      shown.push(...run.slice(run.length - keepTail))
    } else {
      shown.push(...run)
    }
    index = end
  }
  flush()
  return chunks
}
