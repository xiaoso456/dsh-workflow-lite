import { describe, expect, it } from 'vitest'
import type { T } from '../../src/client/i18n.ts'
import { diffCounts, diffLines, foldDiff, splitLines } from '../../src/client/model/lineDiff.ts'
import {
  dotIndex,
  historyLine,
  versionName,
  versionTip,
} from '../../src/client/model/outputHistory.ts'
import type { RunVersion } from '../../src/shared/wire.ts'

const t = ((key: string): string => key) as T

const version = (v: number, extra: Partial<RunVersion> = {}): RunVersion => ({
  v,
  step: 'fix',
  round: v,
  phase: 'done',
  at: 0,
  size: v * 10,
  mtime: v * 1000,
  ...extra,
})

describe('historyLine', () => {
  it('一版都没存过：没有点', () => {
    expect(historyLine(null, { exists: true, size: 1, mtime: 1 }).dots).toEqual([])
    expect(historyLine({ versions: [], dropped: 0 }, undefined).dots).toEqual([])
  })

  it('现在的文件就是最后一版：那一版当最新，不另补', () => {
    const line = historyLine(
      { versions: [version(1), version(2)], dropped: 0 },
      { exists: true, size: 20, mtime: 2000 },
    )
    expect(line.dots.map((dot) => [dot.key, dot.v])).toEqual([
      ['v1', 1],
      ['v2', null],
    ])
  })

  it('现在的文件又改过（或不在了）：最后补一点「最新」', () => {
    const changed = historyLine(
      { versions: [version(1)], dropped: 2 },
      { exists: true, size: 99, mtime: 5000 },
    )
    expect(changed.dots.map((dot) => [dot.v, dot.version?.v ?? null])).toEqual([
      [1, 1],
      [null, null],
    ])
    expect(changed.dropped).toBe(2)
    const gone = historyLine({ versions: [version(1)], dropped: 0 }, undefined)
    expect(gone.dots).toHaveLength(2)
  })

  it('判定：有一条把流程领回去就是重做，否则是通过', () => {
    const line = historyLine(
      {
        versions: [
          version(1, { verdicts: [{ step: 'review', value: 'fail', again: true }] }),
          version(2, { verdicts: [{ step: 'review', value: 'pass', again: false }] }),
          version(3),
        ],
        dropped: 0,
      },
      undefined,
    )
    expect(line.dots.map((dot) => dot.tone)).toEqual(['again', 'pass', null, null])
  })

  it('dotIndex：最新是最后一点；被删掉的版本也当最新', () => {
    const line = historyLine(
      { versions: [version(1), version(2)], dropped: 0 },
      { exists: true, size: 20, mtime: 2000 },
    )
    expect(dotIndex(line, 1)).toBe(0)
    expect(dotIndex(line, null)).toBe(1)
    // 最后一版就是最新：按版本号也找得到它。
    expect(dotIndex(line, 2)).toBe(1)
    expect(dotIndex(line, 7)).toBe(1)
  })
})

describe('versionName / versionTip', () => {
  const names = { fix: '改稿', review: '审稿' }

  it('按步骤与轮次起名；开始前的原样、失败的一轮各有说法', () => {
    expect(versionName(t, version(2), names)).toBe('history.round')
    expect(versionName(t, version(1, { phase: 'before' }), names)).toBe('history.before')
    expect(versionName(t, version(3, { phase: 'before' }), names)).toBe('history.beforeRound')
    expect(versionName(t, version(1, { phase: 'failed' }), names)).toBe(
      'history.roundhistory.failedMark',
    )
    expect(versionName(t, null, names)).toBe('history.live')
  })

  it('悬停说明带上判定（用步骤名）', () => {
    const tip = versionTip(
      t,
      {
        v: 1,
        key: 'v1',
        version: version(1, { verdicts: [{ step: 'review', value: '未通过', again: true }] }),
        tone: 'again',
      },
      names,
    )
    expect(tip.endsWith(' · 审稿：未通过')).toBe(true)
  })
})

describe('diffLines', () => {
  it('拆行不多出末尾空行，认 CRLF', () => {
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
  })

  it('改一行：删旧加新，前后没变的带行号', () => {
    const lines = diffLines('a\nb\nc\n', 'a\nB\nc\n')
    expect(lines.map((line) => [line.kind, line.text, line.a ?? null, line.b ?? null])).toEqual([
      ['same', 'a', 1, 1],
      ['del', 'b', 2, null],
      ['add', 'B', null, 2],
      ['same', 'c', 3, 3],
    ])
  })

  it('插入、删除夹在中间：编辑最少', () => {
    const lines = diffLines('x\na\nb\nc\ny', 'x\na\nnew\nc\ny\nz')
    expect(diffCounts(lines)).toEqual({ add: 2, del: 1 })
    expect(lines.filter((line) => line.kind === 'same').map((line) => line.text)).toEqual([
      'x',
      'a',
      'c',
      'y',
    ])
    expect(diffLines('', 'a\nb').map((line) => line.kind)).toEqual(['add', 'add'])
    expect(diffLines('a\nb', '').map((line) => line.kind)).toEqual(['del', 'del'])
  })

  it('两边一样：全是没变的', () => {
    expect(diffCounts(diffLines('a\nb', 'a\nb'))).toEqual({ add: 0, del: 0 })
  })

  it('改得太多：整段删旧加新，不卡住', () => {
    const before = Array.from({ length: 3000 }, (_, n) => `a${n}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, n) => `b${n}`).join('\n')
    expect(diffCounts(diffLines(before, after))).toEqual({ add: 3000, del: 3000 })
  })
})

describe('foldDiff', () => {
  const lines = (spec: string) =>
    [...spec].map((kind, index) => ({
      kind: kind === '+' ? ('add' as const) : kind === '-' ? ('del' as const) : ('same' as const),
      text: String(index),
    }))

  it('改动上下留三行，中间长段折起来；开头、结尾的长段只留挨着改动的三行', () => {
    const chunks = foldDiff(lines('..........+..........-..........'))
    expect(chunks.map((chunk) => [chunk.kind, chunk.lines.length])).toEqual([
      ['fold', 7],
      ['lines', 7],
      ['fold', 4],
      ['lines', 7],
      ['fold', 7],
    ])
    expect(chunks[2]?.kind === 'fold' && chunks[2].at).toBe(14)
  })

  it('短的不折；一处没改整份折成一段', () => {
    expect(foldDiff(lines('...+...')).map((chunk) => chunk.kind)).toEqual(['lines'])
    expect(foldDiff(lines('.....')).map((chunk) => chunk.kind)).toEqual(['fold'])
  })
})
