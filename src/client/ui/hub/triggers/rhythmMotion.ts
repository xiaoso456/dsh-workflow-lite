/**
 * dsh-workflow-lite — 「概览」节律点阵的进出场：哪些点留着、新进来、退场。
 *
 * - 换了一张卡片（`selection` 变了）：两边都有的点（同一天、同一格、同样的结果和大小）原地不动（`still` 层）；
 *   只有上一张有的点整层先退（{@link RhythmFrame.outgoing}），退完只有这一张有的点整层再进（`fresh` 层）。
 *   点不一个个地动：几十个点各自放动画，每个点都要单独提一层合成、各自结束，切换那半秒里主线程一帧帧地忙；
 *   整层换只有两层在动。新旧不同时出现，不会叠成一片。
 * - 同一张卡片的数据变了（新触发进来）：原地的点不动，新的点自己放大淡入（`enter`），没了的点缩小淡出（`leaving`）。
 *
 * 退完的那一层不另外收拾（收拾一次就是一次重渲染、一帧）：它已经透明了，下次换卡片时直接换掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/rhythmMotion
 */

import type { Outcome } from '../../../model/triggerActivity.ts'

export interface RhythmDot {
  day: number
  hour: number
  outcome: Outcome | 'plan'
  many: boolean
}

export interface RhythmMark extends RhythmDot {
  id: number
  /** 画在哪一层：`still` = 不动的那层（换卡片时两边都有的点、同一张卡片里后来进来的点），`fresh` = 这次换进来的那层。 */
  layer: 'still' | 'fresh'
  /** 正在退场（同一张卡片里没了的点）。 */
  leaving: boolean
  /** 同一张卡片里后来进来的点：自己放大淡入。 */
  enter: boolean
}

export interface RhythmFrame {
  selection: string | null
  /** 换了几次卡片：`fresh` 层按它当 key，每次换是新的一层（从透明开始进），退场的那层留着原来的元素。 */
  generation: number
  marks: readonly RhythmMark[]
  /** 上一张卡片独有的点：整层退场（退完留着，透明的，下次换卡片时换掉）。 */
  outgoing: readonly RhythmMark[]
  nextId: number
}

export const EMPTY_RHYTHM: RhythmFrame = {
  selection: null,
  generation: 0,
  marks: [],
  outgoing: [],
  nextId: 0,
}

const at = (day: number, hour: number, outcome: RhythmDot['outcome']): string =>
  `${day}/${hour}/${outcome}`

/**
 * 按这一次要画的点更新：`dots` 是 `null`（还在读）时留着上一张。
 * 换卡片时两边都有的留着、其余整层换；同一张卡片里只动变了的点。
 */
export function reconcileRhythm(
  frame: RhythmFrame,
  selection: string,
  dots: readonly RhythmDot[] | null,
): RhythmFrame {
  if (dots === null) return frame
  return frame.selection === selection
    ? refreshRhythm(frame, dots)
    : switchRhythm(frame, selection, dots)
}

function switchRhythm(
  frame: RhythmFrame,
  selection: string,
  dots: readonly RhythmDot[],
): RhythmFrame {
  const shown = new Map(
    frame.marks
      .filter((mark) => !mark.leaving)
      .map((mark) => [`${at(mark.day, mark.hour, mark.outcome)}/${mark.many}`, mark]),
  )
  let nextId = frame.nextId
  const marks = dots.map((dot): RhythmMark => {
    const key = `${at(dot.day, dot.hour, dot.outcome)}/${dot.many}`
    const kept = shown.get(key)
    if (kept) {
      shown.delete(key)
      return { ...kept, layer: 'still', enter: false }
    }
    return { ...dot, id: nextId++, layer: 'fresh', leaving: false, enter: false }
  })
  return {
    selection,
    generation: frame.generation + 1,
    marks,
    outgoing: [...shown.values()],
    nextId,
  }
}

function refreshRhythm(frame: RhythmFrame, dots: readonly RhythmDot[]): RhythmFrame {
  const remaining = new Map(dots.map((dot) => [at(dot.day, dot.hour, dot.outcome), dot]))
  let changed = false
  const marks = frame.marks.map((mark) => {
    const key = at(mark.day, mark.hour, mark.outcome)
    const dot = remaining.get(key)
    if (dot) {
      remaining.delete(key)
      if (!mark.leaving && dot.many === mark.many) return mark
      changed = true
      return { ...mark, many: dot.many, leaving: false }
    }
    if (mark.leaving) return mark
    changed = true
    return { ...mark, leaving: true }
  })
  let nextId = frame.nextId
  for (const dot of remaining.values()) {
    changed = true
    marks.push({ ...dot, id: nextId++, layer: 'still', leaving: false, enter: true })
  }
  return changed ? { ...frame, marks, nextId } : frame
}

/** 同一张卡片里退场的点放完了：拿掉。 */
export function settleRhythm(frame: RhythmFrame): RhythmFrame {
  const marks = frame.marks.filter((mark) => !mark.leaving)
  return marks.length === frame.marks.length ? frame : { ...frame, marks }
}

/** 有没有正在退场的点（要不要等一会儿再拿掉）。换卡片退场的那一层不算：它不用收拾。 */
export function rhythmLeaving(frame: RhythmFrame): boolean {
  return frame.marks.some((mark) => mark.leaving)
}
