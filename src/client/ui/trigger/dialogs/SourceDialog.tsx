/**
 * dsh-workflow-lite — 「触发方式」对话框：选触发方式、填它的详细设置（草稿，「保存」才写进图）。
 *
 * 左栏是五种方式（{@link SourceRail}），右边是那一种的设置（{@link SourceStage}）；
 * 头部标题右边一句话说它什么时候执行、贴着 ✕ 写现在怎样（{@link SourceSummary}）。
 * 对话框高度固定，换方式时不跟着变高变矮。
 *
 * 换一种方式：这一次对话框开着时那一种填过的先记着，换回来还在；没填过的给常用值，
 * 轮询和监听之间换时带上已经写好的命令（见 `source/kinds.ts`）。
 * 命令改了、保存之后，开着的卡片会停下来等重新确认（宿主比对确认过的命令）——草稿里打字不会中途把它弄成「待确认」。
 * 轮询、监听里选的工作区（本机状态，和面板「执行设置」里的是同一项）也是草稿，「保存」时一起写。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/SourceDialog
 */

import { useRef, useState } from 'react'
import { sourceIssue } from '../../../../shared/trigger.ts'
import type { TriggerSource, TriggerSourceKind } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { SwapNode } from '../../motion/swapText.tsx'
import { switchSource } from '../source/kinds.ts'
import { SourceRail } from '../source/SourceRail.tsx'
import { SourceStage } from '../source/SourceStage.tsx'
import { SourceSummary } from '../source/SourceSummary.tsx'
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
  const savedWorkspace = env?.triggers.view(props.node)?.workspace ?? ''
  const [workspace, setWorkspace] = useState(savedWorkspace)
  /** 这一次对话框开着时各种方式填过的样子。 */
  const kept = useRef(new Map<TriggerSourceKind, TriggerSource>())
  const sourceDirty = JSON.stringify(draft) !== JSON.stringify(props.source)
  const workspaceDirty = workspace !== savedWorkspace
  const dirty = sourceDirty || workspaceDirty
  // 现场（最近一行、地址、状态）是图里那条规则的：草稿改过就只看草稿本身。
  const view = sourceDirty ? undefined : env?.triggers.view(props.node)
  return (
    <TriggerSheet
      t={t}
      title={t('trigger.when')}
      sub={props.name}
      mark={
        <SwapNode
          id={draft.kind}
          render={(kind) => <TriggerMark kind={kind as TriggerSourceKind} size={16} />}
        />
      }
      head={<SourceSummary t={t} source={draft} view={view} dirty={dirty} />}
      testId="wl-trigger-source-dialog"
      dirty={dirty}
      canSave={sourceIssue(draft) === null}
      onSave={() => {
        if (sourceDirty) props.onSave(draft)
        if (workspaceDirty && env !== null) void env.triggers.set(props.node, { workspace })
        props.onClose()
      }}
      onClose={props.onClose}
      rail={
        <SourceRail
          t={t}
          source={draft}
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
        env={env}
        workspace={{ value: workspace, saved: savedWorkspace, onChange: setWorkspace }}
        onChange={setDraft}
      />
    </TriggerSheet>
  )
}
