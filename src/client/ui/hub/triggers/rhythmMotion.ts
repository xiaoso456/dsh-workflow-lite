import type { Outcome } from '../../../model/triggerActivity.ts'

export interface RhythmDot {
  day: number
  hour: number
  outcome: Outcome | 'plan'
  many: boolean
}

interface RhythmMark extends RhythmDot {
  id: number
  leaving: boolean
}

interface RhythmFrame {
  selection: string | null
  marks: readonly RhythmMark[]
  nextId: number
}

export const EMPTY_RHYTHM: RhythmFrame = { selection: null, marks: [], nextId: 0 }

const at = (day: number, hour: number, outcome: RhythmDot['outcome']): string =>
  `${day}/${hour}/${outcome}`

export function reconcileRhythm(
  frame: RhythmFrame,
  selection: string,
  dots: readonly RhythmDot[] | null,
): RhythmFrame {
  if (dots === null) return frame

  const remaining = new Map(dots.map((dot) => [at(dot.day, dot.hour, dot.outcome), dot]))
  const claimed = new Map<number, RhythmDot>()
  const claim = (mark: RhythmMark, hour: number): boolean => {
    const key = at(mark.day, hour, mark.outcome)
    const dot = remaining.get(key)
    if (!dot) return false
    remaining.delete(key)
    claimed.set(mark.id, dot)
    return true
  }
  for (const mark of frame.marks) claim(mark, mark.hour)
  if (frame.selection !== selection) {
    for (const mark of frame.marks) {
      if (mark.leaving || claimed.has(mark.id)) continue
      if (!claim(mark, mark.hour - 1)) claim(mark, mark.hour + 1)
    }
  }

  let nextId = frame.nextId
  let changed = frame.selection !== selection || remaining.size > 0
  const marks = frame.marks.map((mark) => {
    const dot = claimed.get(mark.id)
    if (dot) {
      if (!mark.leaving && dot.hour === mark.hour && dot.many === mark.many) return mark
      changed = true
      return { ...dot, id: mark.id, leaving: false }
    }
    if (mark.leaving) return mark
    changed = true
    return { ...mark, leaving: true }
  })
  for (const dot of remaining.values()) marks.push({ ...dot, id: nextId++, leaving: false })
  return changed ? { selection, marks, nextId } : frame
}
