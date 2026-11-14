/**
 * dsh-workflow-lite — 「触发方式」对话框：选触发方式、填它的详细设置（草稿，「保存」才写进图）。
 *
 * 左边是表单（{@link SourceForm}）；右边一栏：卡片上会怎么显示（和画布卡片中间那一行同一个组件）、
 * 这种触发方式的说明，要跑命令的再加最近的输出。
 *
 * 命令改了、保存之后，开着的卡片会停下来等重新确认（宿主比对确认过的命令）——草稿里打字不会中途把它弄成「待确认」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/SourceDialog
 */

import { useState } from 'react'
import { commandOf, sourceIssue } from '../../../../shared/trigger.ts'
import type { TriggerSource } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { triggerGlance } from '../../../model/triggerGlance.ts'
import ins from '../../panel/panel.module.css'
import { RecentOutput } from '../RecentOutput.tsx'
import { SOURCE_HELP, SourceForm } from '../SourceField.tsx'
import { TriggerGlanceRow } from '../TriggerGlanceRow.tsx'
import { TriggerMark, triggerTint } from '../TriggerMark.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { Upcoming } from '../Upcoming.tsx'
import { AsideBlock, TriggerSheet } from './TriggerSheet.tsx'

export function SourceDialog(props: {
  t: T
  node: string
  /** 卡片名。 */
  name: string
  /** 图里现在的触发源。 */
  source: TriggerSource
  env: TriggerEnv | null
  onSave(source: TriggerSource): void
  onClose(): void
}): React.JSX.Element {
  const { t, env } = props
  const [draft, setDraft] = useState<TriggerSource>(props.source)
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.source)
  // 现场（最近一行、地址、轮询进度）是图里那条规则的：草稿改过就只看草稿本身。
  const view = dirty ? undefined : env?.triggers.view(props.node)
  // 卡片开着时，「每隔多久」从打开的那一刻起算：接下来几次从宿主排的那一次往后数（草稿改过就当现在打开）。
  const live =
    view !== undefined && (view.state === 'waiting' || view.state === 'elsewhere')
      ? view.next
      : undefined
  const help = SOURCE_HELP[draft.kind]
  // 最近的输出是现在跑着的那条命令的：草稿换了触发方式、改了命令就不放（那是旧命令的输出）。
  const showOutput =
    env !== null &&
    commandOf(draft) !== undefined &&
    draft.kind === props.source.kind &&
    commandOf(draft) === commandOf(props.source)
  return (
    <TriggerSheet
      t={t}
      title={t('trigger.when')}
      sub={props.name}
      mark={<TriggerMark kind={draft.kind} size={16} />}
      testId="wl-trigger-source-dialog"
      wide
      dirty={dirty}
      canSave={sourceIssue(draft) === null}
      onSave={() => {
        if (dirty) props.onSave(draft)
        props.onClose()
      }}
      onClose={props.onClose}
      aside={
        <>
          <AsideBlock title={t('trigger.onCard')} testId="wl-trigger-source-preview">
            {/* 和画布上那张卡片的中间一行同一个组件，颜色跟着触发方式走。 */}
            <div style={{ '--wl-kind': triggerTint(draft.kind) } as React.CSSProperties}>
              <TriggerGlanceRow glance={triggerGlance(t, draft)} view={view} />
            </div>
          </AsideBlock>
          {draft.kind === 'schedule' && (
            <AsideBlock title={t('trigger.upcoming')}>
              <Upcoming t={t} schedule={draft.schedule} live={live} />
            </AsideBlock>
          )}
          {help.length > 0 && (
            <AsideBlock title={t('trigger.about')}>
              {help.map((key) => (
                <p key={key} className={ins.help}>
                  {t(key)}
                </p>
              ))}
            </AsideBlock>
          )}
          {showOutput && (
            <AsideBlock title={t('trigger.output')} testId="wl-trigger-output">
              <RecentOutput t={t} env={env} node={props.node} />
            </AsideBlock>
          )}
        </>
      }
    >
      <SourceForm
        t={t}
        node={props.node}
        source={draft}
        saved={props.source}
        env={env}
        onChange={setDraft}
      />
    </TriggerSheet>
  )
}
