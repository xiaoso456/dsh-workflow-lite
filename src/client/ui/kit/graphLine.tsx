/**
 * dsh-workflow-lite — 图的一处改动写成一行字：「<b>审查</b> · 改了提示词、名称」。
 *
 * 实例视图底部的草稿栏（`run/RunDraftBar`）的改动清单、版本框里每个版本的改动清单（`versions/VersionRow`）都用它，
 * 单独成文件，让版本框不必回头 import 实例视图的草稿栏。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/graphLine
 */

import type { GraphChange } from '../../../shared/graphDiff.ts'
import { idKey, isInput, isResource } from '../../../shared/model.ts'
import { resourceTitle } from '../../../shared/resources.ts'
import type { WorkflowDocument } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'

const FIELD_TEXT: Record<string, LocaleKey> = {
  label: 'draft.field.label',
  description: 'draft.field.description',
  look: 'draft.field.look',
  prompt: 'draft.field.prompt',
  items: 'draft.field.items',
  question: 'draft.field.question',
  kind: 'draft.field.kind',
  options: 'draft.field.options',
  default: 'draft.field.default',
  placeholder: 'draft.field.placeholder',
  hint: 'draft.field.hint',
  required: 'draft.field.required',
  when: 'draft.field.when',
  handoff: 'draft.field.handoff',
  update: 'draft.field.update',
}

function nodeLabel(doc: WorkflowDocument, id: string): string {
  const node = doc.nodes.find((candidate) => idKey(candidate.id) === idKey(id))
  if (node === undefined) return id
  if (isResource(node)) return resourceTitle(node)
  if (isInput(node)) {
    const question = node.data.question.trim()
    return question === '' ? node.id : question.length > 18 ? `${question.slice(0, 18)}…` : question
  }
  return node.data.label === undefined || node.data.label.trim() === '' ? node.id : node.data.label
}

/** 图的一处改动写成清单里的一行：「<b>审查</b> · 改了提示词、名称」。 */
export function graphLine(
  t: T,
  change: GraphChange,
  base: WorkflowDocument,
  doc: WorkflowDocument,
): React.ReactNode {
  if (change.object === 'layout') {
    return (
      <>
        <b>{t('draft.layout')}</b> · {t('draft.moved').replace('{n}', String(change.fields.length))}
      </>
    )
  }
  const from = change.kind === 'removed' ? base : doc
  let name: string
  if (change.object === 'edge') {
    const edge = from.edges.find((candidate) => candidate.id === change.id)
    name =
      edge === undefined
        ? change.id
        : `${nodeLabel(from, edge.source)} → ${nodeLabel(from, edge.target)}`
  } else {
    name = nodeLabel(from, change.id)
  }
  const what =
    change.kind === 'added'
      ? t(`draft.added.${change.object}` as LocaleKey)
      : change.kind === 'removed'
        ? t('draft.removed')
        : t('draft.changedFields').replace(
            '{fields}',
            change.fields
              .map((field) => (FIELD_TEXT[field] ? t(FIELD_TEXT[field]) : field))
              .join('、'),
          )
  return (
    <>
      <b>{name}</b> · {what}
    </>
  )
}
