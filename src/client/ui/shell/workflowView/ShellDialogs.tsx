/**
 * dsh-workflow-lite — 模板编辑时的一组对话框与浮层：记忆选择、自定义文字、就地添加、设置、版本、执行前提问、计划预览。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/ShellDialogs
 */

import { orderedInputs } from '../../../../shared/inputs.ts'
import { isResource } from '../../../../shared/model.ts'
import { stepMemories } from '../../../../shared/presets.ts'
import type {
  InputAnswer,
  Point,
  ResourceItem,
  WorkflowDocument,
} from '../../../../shared/types.ts'
import { addOrigin } from '../../../app/addStep.ts'
import type { Desktop } from '../../../app/desktop.ts'
import type { HostAccess } from '../../../app/host.ts'
import type { SessionRow } from '../../../app/sessions.ts'
import type { useMemoryPick } from '../../../app/useMemoryPick.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { T } from '../../../i18n.ts'
import type { StepSource } from '../../../model/library.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import type { AddRequest } from '../../canvas/Canvas.tsx'
import { QuickAdd } from '../../canvas/QuickAdd.tsx'
import { InputsDialog } from '../../editor/InputsDialog.tsx'
import { PlanDialog } from '../../editor/PlanDialog.tsx'
import { SettingsDialog } from '../../editor/SettingsDialog.tsx'
import { TextDialog } from '../../files/TextDialog.tsx'
import { MemoryPicker } from '../../resources/MemoryPicker.tsx'
import { VersionsDialog } from '../../versions/VersionsDialog.tsx'

export function ShellDialogs({
  t,
  rpc,
  desktop,
  session,
  wf,
  host,
  memoryPick,
  textView,
  setTextView,
  quick,
  setQuick,
  size,
  addStep,
  settingsOpen,
  setSettingsOpen,
  versionsOpen,
  setVersionsOpen,
  asking,
  setAsking,
  lastAnswers,
  sessionRows,
  startRun,
  planOpen,
  setPlanOpen,
  sessionCwd,
  locate,
  focusCanvas,
}: {
  t: T
  rpc: WorkflowLiteRpc
  desktop: Desktop | undefined
  session: string | undefined
  wf: Workflow
  host: HostAccess
  memoryPick: ReturnType<typeof useMemoryPick>
  textView: ResourceItem | null
  setTextView(value: null): void
  quick: (AddRequest & { at: Point }) | null
  setQuick(value: null): void
  /** 视图根的大小（就地添加的菜单据此不出界）。 */
  size: { width: number; height: number }
  addStep(source: StepSource, position: Point, from?: string): Promise<void>
  settingsOpen: boolean
  setSettingsOpen(open: boolean): void
  versionsOpen: boolean
  setVersionsOpen(open: boolean): void
  asking: { target: string | null } | null
  setAsking(value: null): void
  lastAnswers: { current: Map<string, Record<string, InputAnswer>> }
  sessionRows: readonly SessionRow[]
  startRun(target: string | null, answers?: Record<string, InputAnswer>): Promise<void>
  planOpen: boolean
  setPlanOpen(open: boolean): void
  sessionCwd: string | undefined
  locate(nodeId: string): void
  focusCanvas(): void
}): React.JSX.Element {
  const { state } = wf
  const doc = state.doc
  return (
    <>
      {memoryPick.pick !== null && (
        <MemoryPicker
          t={t}
          at={memoryPick.pick.at}
          type={memoryPick.pick.type}
          entries={memoryPick.pick.entries}
          {...(memoryPick.pick.current === undefined ? {} : { current: memoryPick.pick.current })}
          busy={memoryPick.busy}
          onPick={memoryPick.choose}
          onCreate={memoryPick.create}
          onClose={memoryPick.close}
        />
      )}

      {textView !== null && (
        <TextDialog t={t} item={textView} desktop={desktop} onClose={() => setTextView(null)} />
      )}

      {quick !== null && (
        <QuickAdd
          t={t}
          at={quick.at}
          bounds={size}
          templates={wf.catalog?.templates.nodes ?? []}
          origin={addOrigin(doc, quick.from)}
          memory={
            state.name !== null &&
            (doc === null || quick.from === undefined || stepMemories(doc, quick.from).length === 0)
          }
          onClose={() => setQuick(null)}
          onPick={(source) => {
            const request = quick
            setQuick(null)
            void addStep(source, request.flow, request.from)
          }}
        />
      )}

      {settingsOpen && state.name !== null && doc !== null && (
        <SettingsDialog
          t={t}
          name={state.name}
          settings={doc.settings}
          sample={sampleOutput(doc)}
          onSave={(settings) => {
            setSettingsOpen(false)
            wf.edit({ type: 'setSettings', settings })
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {versionsOpen && state.name !== null && (
        <VersionsDialog
          t={t}
          rpc={rpc}
          name={state.name}
          doc={doc}
          memories={host.memories}
          desktop={host.desktop}
          flush={wf.flush}
          onRestored={wf.reload}
          onChanged={() => void wf.refreshCatalog()}
          onClose={() => setVersionsOpen(false)}
        />
      )}

      {asking !== null && state.name !== null && doc !== null && (
        <InputsDialog
          t={t}
          name={state.name}
          inputs={orderedInputs(doc)}
          initial={lastAnswers.current.get(state.name)}
          where={
            asking.target === null
              ? t('launch.newSession')
              : asking.target === session
                ? t('launch.here')
                : (sessionRows.find((row) => row.id === asking.target)?.title ?? asking.target)
          }
          onSubmit={(answers) => {
            const target = asking.target
            if (state.name !== null) lastAnswers.current.set(state.name, answers)
            setAsking(null)
            void startRun(target, answers)
          }}
          onClose={() => setAsking(null)}
        />
      )}

      {planOpen && state.name !== null && (
        <PlanDialog
          t={t}
          name={state.name}
          build={(full) => wf.buildPlan(full, sessionCwd)}
          onLocate={locate}
          onClose={() => {
            setPlanOpen(false)
            focusCanvas()
          }}
        />
      )}
    </>
  )
}

/** 设置对话框里拼接预览用的示例：图里第一个相对路径的文件，没有就用 `plan.md`。 */
function sampleOutput(doc: WorkflowDocument): string {
  for (const node of doc.nodes) {
    if (!isResource(node)) continue
    const item = node.data.items.find(
      (candidate) => candidate.kind === 'file' && !/^([A-Za-z]:)?[\\/]/u.test(candidate.value),
    )
    if (item !== undefined && item.value.trim() !== '') return item.value.trim()
  }
  return 'plan.md'
}
