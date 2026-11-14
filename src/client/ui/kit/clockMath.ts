/**
 * dsh-workflow-lite — 时刻框（{@link ../TimeField}）的算术：一天里的第几分钟（0–1439）怎么走一步、打的字怎么认。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/clockMath
 */

/** 一天多少分钟。 */
export const DAY_MINUTES = 1440
/** 滚轮在「分」上一格走几分钟。 */
export const MINUTE_NOTCH = 5

export type ClockPart = 'hour' | 'minute'

/** 绕回一天之内（23:59 往后是 00:00）。 */
export const wrapClock = (minutes: number): number =>
  ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES

export const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * 走一步：时一次一小时；分按键一次 1 分钟（Shift 10 分钟），滚轮一格 {@link MINUTE_NOTCH} 分钟、
 * 不在整格上的先落到最近的整格（09:03 往上是 09:05）。走过头绕回，跨小时照常进位。
 */
export function stepClock(
  minutes: number,
  part: ClockPart,
  dir: 1 | -1,
  how: { big?: boolean; wheel?: boolean } = {},
): number {
  if (part === 'hour') return wrapClock(minutes + dir * 60)
  if (how.wheel === true) {
    const at =
      dir > 0
        ? Math.floor(minutes / MINUTE_NOTCH) * MINUTE_NOTCH + MINUTE_NOTCH
        : Math.ceil(minutes / MINUTE_NOTCH) * MINUTE_NOTCH - MINUTE_NOTCH
    return wrapClock(at)
  }
  return wrapClock(minutes + dir * (how.big === true ? 10 : 1))
}

/**
 * 在一段里打字：`typed` 是这一段到现在打的几位。时按 0–23、分按 0–59 夹住；
 * 打满两位、或第一位已经不可能再接一位（时打了 3–9、分打了 6–9）就算打完（`done`，焦点该跳到下一段）。
 */
export function typeClock(
  minutes: number,
  part: ClockPart,
  typed: string,
): { minutes: number; done: boolean } {
  const n = Number(typed)
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  if (part === 'hour') {
    return { minutes: Math.min(23, n) * 60 + minute, done: typed.length >= 2 || n > 2 }
  }
  return { minutes: hour * 60 + Math.min(59, n), done: typed.length >= 2 || n > 5 }
}
