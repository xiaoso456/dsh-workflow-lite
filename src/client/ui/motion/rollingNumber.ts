/**
 * dsh-workflow-lite — 统计数字怎么换：同一项的数变了逐位滚（只滚变了的位，按增减方向）；
 * 列表换了一项时整个数一起滚（旧数从 `::after` 退场、新数进场，方向跟着列表），不逐位动——
 * 一屏几个数各自逐位滚，切换那一下要同时起十几个小动画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/rollingNumber
 */

interface Glyph {
  digit: string
  exit: -1 | 1 | null
}

interface Place {
  power: number
  digit: string | null
  glyphs: readonly Glyph[]
}

/** 列表换项时整个数换：换下去的那个数、第几次（CSS 动画在两个名字之间切着从头放）、往哪边滚。 */
interface WholeSwap {
  was: string
  n: number
  dir: 'up' | 'down'
}

interface Roll {
  value: number | null
  direction: -1 | 0 | 1
  places: readonly Place[]
  /** 最近一次整数换（没有过是 `null`）；放完不用收，下次换数时覆盖。 */
  swap: WholeSwap | null
}

export const EMPTY_ROLL: Roll = { value: null, direction: 0, places: [], swap: null }

function retargetGlyphs(before: Place, digit: string, direction: -1 | 1): readonly Glyph[] {
  const glyphs = before.glyphs.map((glyph): Glyph => {
    if (glyph.digit === digit) return { digit, exit: null }
    return glyph.exit === null ? { ...glyph, exit: direction } : glyph
  })
  if (!glyphs.some((glyph) => glyph.digit === digit)) glyphs.push({ digit, exit: null })
  return glyphs
}

/**
 * @param whole - 列表正在换项：给方向就整个数一起换（逐位的那套不动）；`null` / 不给 = 逐位滚。
 */
export function reconcileRoll(
  frame: Roll,
  value: number | null,
  whole: 'up' | 'down' | null = null,
): Roll {
  if (value === null || value === frame.value) return frame

  const digits = String(value)
  if (whole !== null && frame.value !== null) {
    return {
      value,
      direction: 0,
      places: [...digits].reverse().map((digit, power) => ({
        power,
        digit,
        glyphs: [{ digit, exit: null }],
      })),
      swap: { was: String(frame.value), n: (frame.swap?.n ?? 0) + 1, dir: whole },
    }
  }
  const direction = frame.value === null ? 0 : value > frame.value ? 1 : -1
  const places = [...digits].reverse().map((digit, power): Place => {
    const before = frame.places[power]
    if (!before || !direction) return { power, digit, glyphs: [{ digit, exit: null }] }
    if (before.digit === digit) return before
    return { power, digit, glyphs: retargetGlyphs(before, digit, direction) }
  })
  for (const place of frame.places.slice(digits.length)) places.push({ ...place, digit: null })
  return { value, direction, places, swap: frame.swap }
}

export function settleRoll(frame: Roll): Roll {
  const places = frame.places
    .filter((place) => place.digit !== null)
    .map((place) => ({ ...place, glyphs: place.glyphs.filter((glyph) => glyph.exit === null) }))
  return { ...frame, places }
}
