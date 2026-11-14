/**
 * dsh-workflow-lite — 「触发方式」对话框：选触发方式、填它的详细设置（草稿，「保存」才写进图）。
 *
 * 左栏是五种方式和卡片预览（{@link SourceRail}），右边是一句话说明它什么时候执行、下面是那一种的设置（{@link SourceStage}）。
 * 对话框高度固定，换方式时不跟着变高变矮。
 *
 * 换一种方式：这一次对话框开着时那一种填过的先记着，换回来还在；没填过的给常用值，
 * 轮询和监听之间换时带上已经写好的命令（见 `source/kinds.ts`）。
 * 命令改了、保存之后，开着的卡片会停下来等重新确认（宿主比对确认过的命令）——草稿里打字不会中途把它弄成「待确认」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/SourceDialog
 */

import { useRef, useState } from 'react'
import { sourceIssue } from '../../../../shared/trigger.ts'
import type { TriggerSource, TriggerSourceKind } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { switchSource } from '../source/kinds.ts'
import { SourceRail } from '../source/SourceRail.tsx'
import { SourceStage } from '../source/SourceStage.tsx'
import { TriggerMark } from '../TriggerMark.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { TriggerSheet } from './TriggerSheet.tsx'

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
  /** 这一次对话框开着时各种方式填过的样子。 */
  const kept = useRef(new Map<TriggerSourceKind, TriggerSource>())
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.source)
  // 现场（最近一行、地址、状态）是图里那条规则的：草稿改过就只看草稿本身。
  const view = dirty ? undefined : env?.triggers.view(props.node)
  return (
    <TriggerSheet
      t={t}
      title={t('trigger.when')}
      sub={props.name}
      mark={<TriggerMark kind={draft.kind} size={16} />}
      testId="wl-trigger-source-dialog"
      dirty={dirty}
      canSave={sourceIssue(draft) === null}
      onSave={() => {
        if (dirty) props.onSave(draft)
        props.onClose()
      }}
      onClose={props.onClose}
      rail={
        <SourceRail
          t={t}
          name={props.name}
          source={draft}
          view={view}
          onPick={(kind) => {
            kept.current.set(draft.kind, draft)
            setDraft(switchSource(draft, kind, kept.current))
          }}
        />
      }
    >
      <SourceStage
        t={t}
        node={props.node}
        source={draft}
        saved={props.source}
        view={view}
        dirty={dirty}
        env={env}
        onChange={setDraft}
      />
    </TriggerSheet>
  )
}
