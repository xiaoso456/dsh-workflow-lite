/**
 * dsh-workflow-lite — 上一次触发发起的那次执行结束了没有（「上次执行未结束时」的跳过、排队都问这里）。
 *
 * 依据（{@link EndBasis}）现在只有一种 `state`：执行它的模型在运行状态里把整体状态改成
 * done / failed / cancelled 才算结束，和接续触发信的是同一份。所以选了跳过、排队的卡片，
 * 所在工作流要开着「记录运行状态」（{@link endProblem}）。在这个依据下：
 *
 * - 发进去了、还没对上实例的不算结束（模型多半还没编译）；
 * - 对上了实例、但它没有状态文件的也不算结束（看不出来）；
 * - 模型说了这次不做（`decline`）的算结束：那是模型自己的判断；
 * - 实例被删掉了的算结束：没有东西可等了；
 * - 用户点了「视为已结束」（本机状态 `waived` 是那一次的编号）的算结束。
 *
 * 以后加别的依据（比如看会话停没停）：在 `EndBasis` 里加一种，在 {@link RunEnds.previous} 里按依据分支，
 * 调用方（发起时的跳过、排队，每一轮放行排着的，卡片上「在等哪一次」）都不用改。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/runEnd
 */

import { FINISHED_STATUSES, needsRunState } from '../../shared/trigger.ts'
import type { TriggerData } from '../../shared/types.ts'
import type { TriggerWaiting } from '../../shared/wire/trigger.ts'
import type { RunWatch } from './after.ts'
import type { TriggerLocal, TriggerStore } from './store.ts'

/** 怎么算一次执行结束了。 */
export type EndBasis = 'state'

/** 上一次结束了；没结束时带上在等的是哪一次（卡片上显示、「视为已结束」用）。 */
export type PreviousRun = { ended: true } | { ended: false; waiting: TriggerWaiting }

/** 这张卡片的设置要看上一次跑完没有、却看不出来时的原因；不用看或看得出来是 `null`。 */
export function endProblem(data: TriggerData, runState: boolean): string | null {
  if (!needsRunState(data, runState)) return null
  return '「上次执行未结束时」选择了跳过或排队，需要根据运行状态判断上次执行是否结束，请先在这个工作流里开启「记录运行状态」'
}

export class RunEnds {
  private readonly store: Pick<TriggerStore, 'detail'>
  private readonly runs: Pick<RunWatch, 'stateOf'>

  constructor(store: Pick<TriggerStore, 'detail'>, runs: Pick<RunWatch, 'stateOf'>) {
    this.store = store
    this.runs = runs
  }

  /** 这张卡片上一次发出去的那次执行结束了没有（按 `basis`，现在只有运行状态一种）。 */
  async previous(local: TriggerLocal, basis: EndBasis = 'state'): Promise<PreviousRun> {
    const fire = local.lastFire
    if (fire === undefined || fire === local.waived) return { ended: true }
    const detail = await this.store.detail(fire)
    if (detail === null) return { ended: true }
    const { record } = detail
    if (record.declined !== undefined) return { ended: true }
    const base = {
      fire,
      at: record.at,
      ...(record.session === undefined ? {} : { session: record.session }),
    }
    const sentAt = record.sentAt ?? record.at
    if (record.instance === undefined) {
      return { ended: false, waiting: { ...base, since: sentAt } }
    }
    switch (basis) {
      case 'state': {
        const state = await this.runs.stateOf(record.instance)
        if (state === null) return { ended: true }
        if (state.status !== undefined && FINISHED_STATUSES.has(state.status)) {
          return { ended: true }
        }
        return {
          ended: false,
          waiting: {
            ...base,
            instance: record.instance,
            ...(state.status === undefined ? {} : { status: state.status }),
            since: state.at ?? sentAt,
          },
        }
      }
    }
  }
}
