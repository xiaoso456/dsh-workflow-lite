/**
 * dsh-workflow-lite — 展示区读内容的环境：从哪读（实例或「上次执行」）、卡片上留给状态与时间线的位置。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/displayEnv
 */

import { createContext } from 'react'
import type { RunLatestOutput } from '../../../shared/wire.ts'
import type { DisplayStat } from '../../app/useDisplayStats.ts'
import type { T } from '../../i18n.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'

/** 展示区从哪读：实例视图给出实例与每项的样子；模板里是 `null`（文件还没生成）。 */
export interface DisplayEnv {
  t: T
  run: {
    rpc: WorkflowLiteRpc
    instance: string
    stats: Readonly<Record<string, DisplayStat>>
    /** 步骤 id → 名字（各轮的点上写「改稿 · 第 2 轮」）。 */
    names?: Readonly<Record<string, string>>
  } | null
  /** 模板视图的「上次执行」（按模板里的 `displayKey`）；实例视图不给。 */
  latest?:
    | {
        rpc: WorkflowLiteRpc
        outputs: Readonly<Record<string, RunLatestOutput>>
        /** 点「上次执行」：打开那个实例。 */
        openRun(instance: string): void
      }
    | undefined
  /** 双击展示区、点「打开」：在查看框里看这一项（文件夹可以带 `sub`：直接看里面的那一份）。不给就不能打开。 */
  open?: ((node: string, item: number, sub?: string) => void) | undefined
}

export const DisplayContext = createContext<DisplayEnv | null>(null)

/**
 * 展示卡上留给展示区之外的几块位置：标题行里紧跟标题的状态（生成中、刚更新、筛出几行），标题行里写「看的是哪一版」，
 * 卡片底边外挂时间线（卡片不裁，挂在这里才露得出来）。状态不压在展示区上，免得挡住内容。
 */
export const HistorySlotContext = createContext<{
  status: HTMLElement | null
  slot: HTMLElement | null
  rail: HTMLElement | null
} | null>(null)
