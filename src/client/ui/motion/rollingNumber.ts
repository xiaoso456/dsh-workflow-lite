interface Glyph {
  digit: string
  exit: -1 | 1 | null
}

interface Place {
  power: number
  digit: string | null
  glyphs: readonly Glyph[]
}

interface Roll {
  value: number | null
  direction: -1 | 0 | 1
  places: readonly Place[]
}

export const EMPTY_ROLL: Roll = { value: null, direction: 0, places: [] }

function retargetGlyphs(before: Place, digit: string, direction: -1 | 1): readonly Glyph[] {
  const glyphs = before.glyphs.map((glyph): Glyph => {
    if (glyph.digit === digit) return { digit, exit: null }
    return glyph.exit === null ? { ...glyph, exit: direction } : glyph
  })
  if (!glyphs.some((glyph) => glyph.digit === digit)) glyphs.push({ digit, exit: null })
  return glyphs
}

export function reconcileRoll(frame: Roll, value: number | null): Roll {
  if (value === null || value === frame.value) return frame

  const digits = String(value)
  const direction = frame.value === null ? 0 : value > frame.value ? 1 : -1
  const places = [...digits].reverse().map((digit, power): Place => {
    const before = frame.places[power]
    if (!before || !direction) return { power, digit, glyphs: [{ digit, exit: null }] }
    if (before.digit === digit) return before
    return { power, digit, glyphs: retargetGlyphs(before, digit, direction) }
  })
  for (const place of frame.places.slice(digits.length)) places.push({ ...place, digit: null })
  return { value, direction, places }
}

export function settleRoll(frame: Roll): Roll {
  const places = frame.places
    .filter((place) => place.digit !== null)
    .map((place) => ({ ...place, glyphs: place.glyphs.filter((glyph) => glyph.exit === null) }))
  return { ...frame, places }
}
