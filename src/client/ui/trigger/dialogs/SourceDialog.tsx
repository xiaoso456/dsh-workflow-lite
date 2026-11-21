/**
 * dsh-workflow-lite — 「触发方式」对话框：选触发方式、填它的详细设置（草稿，「保存」才写进图）。
 *
 * 左栏是四种方式（{@link SourceRail}），右边是那一种的设置（{@link SourceStage}）；
 * 头部标题右边一句话说它什么时候执行、贴着 ✕ 写现在怎样（{@link SourceSummary}）。
 * 对话框高度固定，换方式时不跟着变高变矮。
 *
 * 换一种方式：这一次对话框开着时那一种填过的先记着，换回来还在；没填过的给常用值，
 * 定时检查换到监听时带上已经写好的命令（见 `source/kinds.ts`）。
 * 定时检查、监视里选的脚本目录、shell 也是草稿，「保存」时一起写进图；会话工作区只在面板「执行设置」里选。
 * HTTP 的地址、令牌同样是草稿（写在触发源里）。
 * 定时检查分两步填（`source/schedulePages.ts`）：第一步底栏主按钮是「下一步」，第二步左边多一个「上一步」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/SourceDialog
 */

import { useRef, useState } from 'react'
import { sourceIssue } from '../../../../shared/trigger.ts'
import type { TriggerData, TriggerSource, TriggerSourceKind } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { SwapNode } from '../../motion/swapText.tsx'
import { switchSource } from '../source/kinds.ts'
import { SourceRail } from '../source/SourceRail.tsx'
import { SourceStage } from '../source/SourceStage.tsx'
import { SourceSummary } from '../source/SourceSummary.tsx'
import { hasCommandPage, pageOf, type SchedulePage } from '../source/schedulePages.ts'
import { TriggerMark } from '../TriggerMark.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { TriggerSheet } from './TriggerSheet.tsx'

export function SourceDialog(props: {
  t: T
  node: string
  /** 卡片名。 */
  name: string
  /** 图里现在的这张卡片。 */
  data: TriggerData
  env: TriggerEnv | null
  /** 保存：改了的几项（触发源、脚本目录、shell）。 */
  onSave(patch: Partial<TriggerData>): void
  onClose(): void
}): React.JSX.Element {
  const { t, env } = props
  const saved = props.data.source
  const [draft, setDraft] = useState<TriggerSource>(saved)
  const savedCwd = props.data.cwd ?? ''
  const [cwd, setCwd] = useState(savedCwd)
  const savedShell = props.data.shell ?? ''
  const [shell, setShell] = useState(savedShell)
  /** 这一次对话框开着时各种方式填过的样子。 */
  const kept = useRef(new Map<TriggerSourceKind, TriggerSource>())
  /** 定时停在哪一步（打开时总是第一步）。 */
  const [wanted, setPage] = useState<SchedulePage>('time')
  const page = pageOf(draft, wanted)
  const steps = hasCommandPage(draft)
  const sourceDirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const cwdDirty = cwd !== savedCwd
  const shellDirty = shell !== savedShell
  const dirty = sourceDirty || cwdDirty || shellDirty
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
      advance={
        steps && page === 'time'
          ? {
              label: t('trigger.step.next'),
              testId: 'wl-trigger-step-next',
              onAdvance: () => setPage('command'),
            }
          : undefined
      }
      footLead={
        steps && page === 'command' ? (
          <button
            type="button"
            className={cx(ui.btn, ui.small)}
            data-testid="wl-trigger-step-back"
            onClick={() => setPage('time')}
          >
            <Icon name="chevronLeft" size={14} />
            {t('trigger.step.back')}
          </button>
        ) : undefined
      }
      onSave={() => {
        props.onSave({
          ...(sourceDirty ? { source: draft } : {}),
          ...(cwdDirty ? { cwd: cwd === '' ? undefined : cwd } : {}),
          ...(shellDirty ? { shell: shell === '' ? undefined : shell } : {}),
        })
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
            setPage('time')
          }}
        />
      }
    >
      <SourceStage
        t={t}
        node={props.node}
        source={draft}
        saved={saved}
        sourceDirty={sourceDirty}
        view={view}
        env={env}
        run={{
          workspace: props.data.workspace ?? '',
          cwd: { value: cwd, saved: savedCwd, onChange: setCwd },
          shell: { value: shell, saved: savedShell, onChange: setShell },
        }}
        page={page}
        onPage={setPage}
        onChange={setDraft}
      />
    </TriggerSheet>
  )
}
