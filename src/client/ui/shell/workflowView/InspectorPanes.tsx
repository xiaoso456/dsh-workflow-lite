/**
 * dsh-workflow-lite — 右侧面板：步骤库里点中一项时看它的详情，画布上选中东西时看它的属性。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/InspectorPanes
 */

import type { NodeData } from '../../../../shared/types.ts'
import type { HostAccess } from '../../../app/host.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { T } from '../../../i18n.ts'
import type { Selection } from '../../../model/editor.ts'
import type { LibraryFocus, StepSource } from '../../../model/library.ts'
import { Inspector } from '../../editor/Inspector.tsx'
import { StepPanel } from '../../editor/StepPanel.tsx'
import css from '../shell.module.css'

export function InspectorPanes({
  t,
  wf,
  live,
  focus,
  focusPrompt,
  focusLibrary,
  addToCanvas,
  freshTemplateLook,
  freeStepName,
  select,
  duplicate,
  removeNode,
  focusCanvas,
  onFocusFile,
  host,
  openMemoryPick,
}: {
  t: T
  wf: Workflow
  live: boolean
  focus: LibraryFocus | null
  focusPrompt: boolean
  focusLibrary(next: LibraryFocus | null): void
  addToCanvas(source: StepSource): void
  freshTemplateLook(): Pick<NodeData, 'icon' | 'color'>
  freeStepName(base: string): string
  select(selection: Selection): void
  duplicate(id: string): void
  removeNode(id: string): void
  focusCanvas(): void
  onFocusFile(id: string | null): void
  host: HostAccess
  openMemoryPick: React.ComponentProps<typeof Inspector>['onPickMemory']
}): React.JSX.Element {
  const { state, analysis } = wf
  const doc = state.doc
  return (
    <>
      {live && focus !== null && (
        <div className={css.inspector}>
          <StepPanel
            t={t}
            wf={wf}
            focus={focus}
            onFocus={focusLibrary}
            onAddToCanvas={addToCanvas}
            onCopyToMine={(seed, id) =>
              focusLibrary({
                kind: 'new',
                seed: { ...seed, ...freshTemplateLook() },
                name: freeStepName(`my-${id}`),
              })
            }
          />
        </div>
      )}

      {state.phase === 'ready' &&
        focus === null &&
        doc !== null &&
        analysis !== null &&
        state.selection !== null && (
          <div className={css.inspector}>
            <Inspector
              t={t}
              doc={doc}
              analysis={analysis}
              selection={state.selection}
              focusPrompt={focusPrompt && state.selection.kind === 'node'}
              onEdit={wf.edit}
              onSelect={select}
              onSeal={wf.seal}
              onDuplicate={duplicate}
              onRemoveNode={(id) => {
                removeNode(id)
                focusCanvas()
              }}
              onSaveTemplate={wf.saveTemplate}
              onFocusFile={onFocusFile}
              host={host}
              workflow={state.name}
              onPickMemory={openMemoryPick}
            />
          </div>
        )}
    </>
  )
}
