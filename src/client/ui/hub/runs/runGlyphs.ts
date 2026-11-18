import type { RunTone } from '../../chrome/KindMark.tsx'
import { glyphPath, ink, polygon, ring, ringBox } from '../../motion/glyphPath.ts'

const CENTER = [12, 12] as const
const EMPTY_RING = ringBox(12, 12, 12, 12)
const EMPTY_FACE = polygon(Array.from({ length: 6 }, () => CENTER))

function statusGlyph(parts: { outline?: string; face?: string; strokes?: string[] }): string {
  return glyphPath(
    parts.outline ?? EMPTY_RING,
    parts.face ?? EMPTY_FACE,
    ...Array.from({ length: 6 }, (_, index) => parts.strokes?.[index] ?? ink(CENTER)),
  )
}

export const RUN_GLYPH: Record<RunTone, string> = {
  pending: statusGlyph({
    outline: ringBox(2.1, 2.1, 21.9, 21.9),
    strokes: [ink(CENTER, [12, 7.5]), ink(CENTER, [15, 14])],
  }),
  running: statusGlyph({
    face: polygon([
      [4.8, 3.6],
      [12, 7.8],
      [19.68, 12],
      [12, 16.2],
      [4.8, 20.4],
      [4.8, 12],
    ]),
  }),
  done: statusGlyph({
    face: polygon([
      [2.88, 12.24],
      [5.28, 9.84],
      [10.08, 14.64],
      [18.96, 5.76],
      [21.36, 8.16],
      [10.08, 19.44],
    ]),
  }),
  cancelled: statusGlyph({
    face: polygon([
      [7, 7],
      [12, 7],
      [17, 7],
      [17, 17],
      [7, 17],
      [7, 12],
    ]),
  }),
  failed: statusGlyph({
    outline: ring(
      [
        [10.5, 2.9],
        [13.5, 2.9],
        [23, 20.9],
        [1, 20.9],
      ],
      [
        [11.5, 4.7],
        [12.5, 4.7],
        [20, 19.1],
        [4, 19.1],
      ],
      2,
    ),
    strokes: [ink([12, 8], [12, 13]), ink([12, 16.2], [12, 16.7])],
  }),
  waiting: statusGlyph({
    strokes: [
      ink([7, 3], [17, 3]),
      ink([7, 21], [17, 21]),
      ink([8, 3.5], [12, 12]),
      ink([16, 3.5], [12, 12]),
      ink([12, 12], [8, 20.5]),
      ink([12, 12], [16, 20.5]),
    ],
  }),
  untracked: statusGlyph({
    strokes: [
      ink([4, 6], [7, 6]),
      ink([4, 12], [7, 12]),
      ink([4, 18], [7, 18]),
      ink([10, 6], [20, 6]),
      ink([10, 12], [20, 12]),
      ink([10, 18], [20, 18]),
    ],
  }),
}
