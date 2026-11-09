/**
 * dsh-workflow-lite — 实例视图的草稿：图的改动清单、「已改 x 处」的数、保存被拦住的原因，以及保存。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/runView/useRunDraft
 */

import { useMemo } from 'react'
import { type graphFacts, type RunState, validateRunState } from '../../../../shared/runState.ts'
import type { WorkflowDocument } from '../../../../shared/types.ts'
import type { RunGraph } from '../../../app/useRunGraph.ts'
import type { Run } from '../../../app/useRuns.ts'
import type { T } from '../../../i18n.ts'
import { changeCount } from '../../../model/runDraft.ts'
import { type DraftLine, graphLine } from '../RunDraftBar.tsx'

export interface RunDraftInput {
  t: T
  current: Run
  graph: RunGraph
  doc: WorkflowDocument | null
  shown: RunState | null
  facts: ReturnType<typeof graphFacts> | null
}

export function useRunDraft({ t, current, graph, doc, shown, facts }: RunDraftInput): {
  graphLines: DraftLine[]
  count: number
  blocked: string | null
  save(): void
} {
  const graphLines = useMemo<DraftLine[]>(
    () =>
      graph.base === null || doc === null
        ? []
        : graph.changes.map((change) => ({
            key: `${change.object}:${change.kind}:${change.id}`,
            text: graphLine(t, change, graph.base as WorkflowDocument, doc),
            onUndo: () => graph.revert(change),
          })),
    [graph.base, graph.changes, graph.revert, doc, t],
  )
  const count = changeCount(current.draft) + graph.changes.length
  const blocked = useMemo((): string | null => {
    const problem = graph.problems[0]
    if (problem !== undefined) return t('run.graphProblem').replace('{p}', problem.message)
    if (graph.changes.length === 0 || shown === null || facts === null) return null
    const issue = validateRunState(shown, facts).issues[0]
    return issue === undefined
      ? null
      : t('run.stateMismatch').replace('{p}', `${issue.path} ${issue.message}`)
  }, [graph.problems, graph.changes.length, shown, facts, t])
  const save = (): void => {
    const changed = graph.changes.length > 0 && graph.doc !== null && graph.basePlan !== null
    void current
      .save(
        changed && graph.doc !== null && graph.basePlan !== null
          ? { base: graph.basePlan, document: graph.doc }
          : undefined,
      )
      .then((result) => {
        if (result?.planId !== undefined) graph.commit(result.planId)
      })
  }
  return { graphLines, count, blocked, save }
}
