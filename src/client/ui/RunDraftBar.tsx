/**
 * dsh-workflow-lite — 实例视图底部的草稿栏：「已改 x 处 · 改动清单 · 给模型的说明 · 放弃 · 保存并通知模型」。
 *
 * 图的改动与状态的改动攒在一起：清单里图的在前（一处一行），状态的在后（一个字段一行），每行都能单独撤回；
 * 冲突（模型同时改了同一个字段）排在最前面，让用户选。保存不了的时候按钮按住，悬停说明原因。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunDraftBar
 */

import { useState } from 'react'
import type { GraphChange } from '../../shared/graphDiff.ts'
import { idKey, isInput, isResource } from '../../shared/model.ts'
import { resourceTitle } from '../../shared/resources.ts'
import type { NodeStatus, RunStatus, StateEdit } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import type { Run } from '../app/useRuns.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { RUN_TEXT } from './Canvas.tsx'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import { RUN_STATUS_TEXT } from './RunTopBar.tsx'
import run from './run.module.css'
import ui from './ui.module.css'

/** 清单里图的一行。 */
export interface DraftLine {
  key: string
  text: React.ReactNode
  onUndo(): void
}

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

function describe(t: T, edit: StateEdit): React.ReactNode {
  const where = edit.path.length === 1 ? t('run.overall') : edit.path[1]
  const key = edit.path[edit.path.length - 1] ?? ''
  const field = edit.path.length === 1 && key === 'next' ? t('run.nextUp') : key
  const show = (value: StateEdit['to']): string => {
    if (value === null) return t('run.empty')
    if (key === 'status' && typeof value === 'string') {
      const key =
        edit.path.length === 1 ? RUN_STATUS_TEXT[value as RunStatus] : RUN_TEXT[value as NodeStatus]
      return key === undefined ? value : t(key)
    }
    const text = Array.isArray(value) ? value.join('、') : String(value)
    return text.length > 24 ? `${text.slice(0, 24)}…` : text
  }
  return (
    <>
      <b>{where}</b> · {field}：<s>{show(edit.from)}</s> → {show(edit.to)}
    </>
  )
}

export function DraftBar(props: {
  t: T
  current: Run
  /** 图的改动（排在状态的改动前面）。 */
  graph: readonly DraftLine[]
  /** 改了几处：图一处一项，状态按对象算。 */
  count: number
  /** 保存不了的原因（图有问题、改完的状态对不上）；`null` = 能存。 */
  blocked: string | null
  /** 右栏开着没有（开着就让到右栏左边）。 */
  panel: boolean
  onSave(): void
  onDiscard(): void
}): React.JSX.Element {
  const { t, current } = props
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <div className={run.draftSeat} data-panel={props.panel}>
      <div className={cx(ui.panel, run.draft, ui.rise)} data-testid="wl-run-draft">
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          up
          label={t('run.changes')}
          className={run.draftList}
          trigger={
            <button
              type="button"
              className={cx(ui.btn, ui.small)}
              aria-expanded={open}
              data-testid="wl-run-draft-toggle"
              onClick={() => setOpen(!open)}
            >
              <span className={run.draftCount}>
                <span className={run.edited} style={{ margin: 0 }} />
                {t('run.changed').replace('{n}', String(props.count))}
              </span>
              <Icon name="chevronDown" size={13} />
            </button>
          }
        >
          {current.conflicts.map((conflict) => (
            <div
              key={conflict.path.join('.')}
              className={run.conflict}
              data-testid="wl-run-conflict"
            >
              <span>
                {t('run.conflict')} <b>{conflict.path.join('.')}</b>
              </span>
              <span>
                {t('run.conflictMine')}：{String(conflict.to ?? t('run.empty'))} ·{' '}
                {t('run.conflictDisk')}：{String(conflict.disk ?? t('run.empty'))}
              </span>
              <span className={run.conflictActions}>
                <button
                  type="button"
                  className={cx(ui.btn, ui.small, ui.primary)}
                  onClick={() => current.resolve(conflict, 'mine')}
                >
                  {t('run.keepMine')}
                </button>
                <button
                  type="button"
                  className={cx(ui.btn, ui.small)}
                  onClick={() => current.resolve(conflict, 'theirs')}
                >
                  {t('run.useDisk')}
                </button>
              </span>
            </div>
          ))}
          {props.graph.map((line) => (
            <div key={line.key} className={run.change} data-testid="wl-run-graph-change">
              <span className={run.changeText}>{line.text}</span>
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small)}
                aria-label={t('run.undoChange')}
                onClick={line.onUndo}
              >
                <Icon name="undo" size={13} />
              </button>
            </div>
          ))}
          {current.draft.map((edit) => (
            <div key={edit.path.join('.')} className={run.change}>
              <span className={run.changeText}>{describe(t, edit)}</span>
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small)}
                aria-label={t('run.undoChange')}
                onClick={() => current.undoEdit(edit.path)}
              >
                <Icon name="undo" size={13} />
              </button>
            </div>
          ))}
        </Popover>
        <input
          className={cx(ui.input, run.draftNote)}
          value={current.note}
          placeholder={t('run.notePrompt')}
          aria-label={t('run.notePrompt')}
          data-testid="wl-run-draft-note"
          onChange={(event) => current.setNote(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && props.blocked === null) props.onSave()
          }}
        />
        {confirm ? (
          <>
            <span className={run.draftCount}>{t('run.discardConfirm')}</span>
            <button
              type="button"
              className={cx(ui.btn, ui.small)}
              onClick={() => setConfirm(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.dangerSolid)}
              onClick={() => {
                setConfirm(false)
                props.onDiscard()
              }}
            >
              {t('run.discard')}
            </button>
          </>
        ) : (
          <button type="button" className={cx(ui.btn, ui.small)} onClick={() => setConfirm(true)}>
            {t('run.discard')}
          </button>
        )}
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          disabled={
            current.saving ||
            props.count === 0 ||
            current.conflicts.length > 0 ||
            props.blocked !== null
          }
          data-tip={
            current.conflicts.length > 0 ? t('run.resolveFirst') : (props.blocked ?? undefined)
          }
          data-testid="wl-run-save"
          onClick={props.onSave}
        >
          <Icon name="check" size={13} />
          {t('run.save')}
        </button>
      </div>
    </div>
  )
}
