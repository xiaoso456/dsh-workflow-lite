import type { TriggerSourceKind } from '../../../../shared/types.ts'
import { glyphPath, ink, ringBox } from '../../motion/glyphPath.ts'

const BODY = ringBox(2.1, 2.1, 21.9, 21.9)
const CENTER = [12, 12] as const

export const TRIGGER_GLYPH: Record<TriggerSourceKind, string> = {
  schedule: glyphPath(
    BODY,
    ringBox(12, 12, 12, 12),
    ink(CENTER, [12, 7.5]),
    ink(CENTER, [15, 14]),
    ink(CENTER),
    ink(CENTER),
    ink(CENTER),
  ),
  listen: glyphPath(
    ringBox(2.1, 3.6, 21.9, 20.4, 3.4),
    ringBox(12, 12, 12, 12),
    ink([10, 12], [7, 9.5]),
    ink([10, 12], [7, 14.5]),
    ink([12.5, 15], [17, 15]),
    ink([17, 15]),
    ink([17, 15]),
  ),
  http: glyphPath(
    BODY,
    ringBox(7.6, 2.1, 16.4, 21.9),
    ink([3.5, 12], [20.5, 12]),
    ink(CENTER),
    ink(CENTER),
    ink(CENTER),
    ink(CENTER),
  ),
  after: glyphPath(
    ringBox(2.6, 2.6, 9.4, 9.4),
    ringBox(14, 12, 14, 12),
    ink([8.6, 6], [14, 6]),
    ink([14, 6], [14, 18]),
    ink([14, 18], [20, 18]),
    ink([17.5, 15.5], [20, 18]),
    ink([17.5, 20.5], [20, 18]),
  ),
}
