/**
 * dsh-workflow-lite — 一个实例每一步在什么时候做过：从流水算出每一步的几段（「运行实例」页概览的「进程」）。
 *
 * 流水的时刻是插件改状态时自己记的（不靠模型写），一步从「开始」到「完成 / 失败」是一段；停下等用户是另一段；
 * 重跑就是新的一段。还开着的段：实例还在跑（执行中、等待用户）就拉到现在，否则停在最后一次记录（模型没收尾）。
 * 纯计算，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/runSpans
 */

import type { RunState } from '../../shared/runState.ts'

/** 一段的结果：做完、失败、停下等用户、还在做；被跳过、改回待执行、没收尾的是 `stopped`。 */
export type SpanStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

export interface StepSpan {
  from: number
  to: number
  status: SpanStatus
  /** 第几轮（流水里记了才有）。 */
  round?: number
  /** 还开着：拉到了现在。 */
  open?: true
}

export interface RunSpans {
  /** 横轴从哪到哪（epoch 毫秒）：实例建立到现在（还在跑）或最后一次记录。 */
  start: number
  end: number
  /** 还在跑：右端是「现在」。 */
  live: boolean
  /** 步骤 id → 它的几段，从早到晚。 */
  steps: Map<string, StepSpan[]>
}

interface Opened {
  from: number
  status: 'running' | 'waiting'
  round?: number
}

/**
 * 算每一步的几段。
 * @param createdAt - 实例建立的时刻（横轴的左端；流水里有更早的时刻就从那里起，段不画到轴外面）。
 * @param now - 现在（还在跑的实例横轴的右端）。
 */
export function runSpans(state: RunState, createdAt: number, now: number): RunSpans {
  const live = state.status === 'running' || state.status === 'waiting'
  const opened = new Map<string, Opened>()
  const steps = new Map<string, StepSpan[]>()
  let first = createdAt
  let last = createdAt
  const push = (id: string, span: StepSpan): void => {
    const list = steps.get(id) ?? []
    list.push(span)
    steps.set(id, list)
  }
  const close = (id: string, at: number, status: SpanStatus): void => {
    const open = opened.get(id)
    if (open === undefined) return
    opened.delete(id)
    push(id, {
      from: open.from,
      to: Math.max(open.from, at),
      status,
      ...(open.round === undefined ? {} : { round: open.round }),
    })
  }

  for (const entry of state.log) {
    const at = Date.parse(entry.at)
    if (Number.isNaN(at)) continue
    first = Math.min(first, at)
    last = Math.max(last, at)
    const id = entry.node
    if (id === undefined) continue
    switch (entry.event) {
      case 'start':
        // 上一段没收尾又开始了：上一段算停下。
        close(id, at, 'stopped')
        opened.set(id, {
          from: at,
          status: 'running',
          ...(entry.round === undefined ? {} : { round: entry.round }),
        })
        break
      case 'waiting': {
        const round = opened.get(id)?.round
        close(id, at, 'running')
        opened.set(id, { from: at, status: 'waiting', ...(round === undefined ? {} : { round }) })
        break
      }
      case 'done':
      case 'failed':
        close(id, at, entry.event)
        break
      case 'skipped':
        close(id, at, 'stopped')
        break
      case 'note':
        // 步骤上的「备注」只有改回待执行这一种（插件写的）：这一段到此为止。
        close(id, at, 'stopped')
        break
      default:
        break
    }
  }

  const updated = Date.parse(state.updatedAt)
  const end = live ? Math.max(now, last) : Math.max(last, Number.isNaN(updated) ? last : updated)
  for (const [id, open] of opened) {
    push(id, {
      from: open.from,
      to: Math.max(open.from, end),
      status: live ? open.status : 'stopped',
      ...(open.round === undefined ? {} : { round: open.round }),
      ...(live ? { open: true as const } : {}),
    })
  }
  return { start: first, end: Math.max(end, createdAt), live, steps }
}

const MINUTE = 60_000
/** 刻度间隔的候选（分钟）。 */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10_080]

/**
 * 横轴中间的几个刻度（两端另写）：间隔取候选里让刻度不多于 `most` 个的最小一档，对齐本地时间的整点 / 整分；
 * 离两端太近（不到全长的 `margin`）的不要，免得和两端的字挤在一起。
 */
export function spanTicks(start: number, end: number, most = 4, margin = 0.16): number[] {
  const span = end - start
  if (span <= 0) return []
  const size = (STEPS.find((step) => span / (step * MINUTE) <= most + 1) ?? 10_080) * MINUTE
  const offset = new Date(start).getTimezoneOffset() * MINUTE
  const ticks: number[] = []
  for (let at = Math.ceil((start - offset) / size) * size + offset; at < end; at += size) {
    if (at - start >= span * margin && end - at >= span * margin) ticks.push(at)
  }
  return ticks
}
