/**
 * dsh-workflow-lite — 「触发方式」对话框的右边：这种方式自己的设置（那句话和现在怎样在头部，见 {@link SourceSummary}）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/SourceStage
 */

import { commandOf } from '../../../../shared/trigger.ts'
import type { TriggerSource } from '../../../../shared/types.ts'
import type { TriggerView } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { Staged } from '../../motion/stage.tsx'
import { triggerTint } from '../TriggerMark.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { AfterStage } from './AfterStage.tsx'
import { HttpStage } from './HttpStage.tsx'
import { SOURCE_KINDS } from './kinds.ts'
import { ListenStage } from './ListenStage.tsx'
import type { RunDrafts } from './runDraft.ts'
import { ScheduleStage } from './ScheduleStage.tsx'
import { armedNext } from './SourceSummary.tsx'
import type { SchedulePage } from './schedulePages.ts'
import css from './sourceStage.module.css'

export function SourceStage(props: {
  t: T
  node: string
  /** 草稿。 */
  source: TriggerSource
  /** 图里存着的。 */
  saved: TriggerSource
  /** 触发方式有未保存的改动。 */
  sourceDirty: boolean
  /** 现场（草稿改过时不给）。 */
  view: TriggerView | undefined
  env: TriggerEnv | null
  /** 定时检查、监视：脚本目录、用哪个 shell 跑（草稿），卡片上存着的会话工作区。 */
  run: RunDrafts
  /** 定时停在哪一步。 */
  page: SchedulePage
  onPage(page: SchedulePage): void
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source, view, env } = props
  // 「每隔多久」从打开的那一刻起算：卡片开着时从宿主排的那一次往后数。
  const live = armedNext(view)
  // 最近的输出是现在跑着的那条命令的：草稿换了方式、改了命令就不放。
  const showOutput =
    commandOf(source) !== undefined &&
    source.kind === props.saved.kind &&
    commandOf(source) === commandOf(props.saved)
  return (
    <div
      className={css.stage}
      style={{ '--wl-kind': triggerTint(source.kind) } as React.CSSProperties}
      data-testid="wl-trigger-when"
      data-kind={source.kind}
    >
      {/* 换一种方式：旧的往左栏移动的反方向退、新的从那边进来（左栏往下选，新的从下面上来）。 */}
      <Staged
        at={source.kind}
        order={SOURCE_KINDS.findIndex((kind) => kind.value === source.kind)}
        axis="y"
        className={css.staged}
      >
        {source.kind === 'schedule' && (
          <ScheduleStage
            t={t}
            node={props.node}
            source={source}
            env={env}
            run={props.run}
            showOutput={showOutput}
            live={live}
            page={props.page}
            onPage={props.onPage}
            onChange={props.onChange}
          />
        )}
        {source.kind === 'listen' && (
          <ListenStage
            t={t}
            node={props.node}
            source={source}
            env={env}
            run={props.run}
            showOutput={showOutput}
            onChange={props.onChange}
          />
        )}
        {source.kind === 'http' && (
          <HttpStage
            t={t}
            node={props.node}
            env={env}
            source={source}
            view={view}
            sourceDirty={props.sourceDirty}
            onChange={props.onChange}
          />
        )}
        {source.kind === 'after' && (
          <AfterStage t={t} source={source} env={env} onChange={props.onChange} />
        )}
      </Staged>
    </div>
  )
}
