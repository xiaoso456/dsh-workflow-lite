/**
 * dsh-workflow-lite — 选中步骤时它连着的资源，与连着资源的线。
 *
 * - {@link StepResourcesField}：选中步骤时，"它写哪些资源、读哪些资源"，还有交给整个工作流的那些；
 *   能新建一个产出文件、关联图里已有的资源；
 * - {@link ResourceEdgeBody}：选中一条连着资源的线时，写入方式或读取说明；
 * - {@link ModeToggle}：整份写出 / 在原文件上更新的小开关（资源面板里写它的步骤也用它）。
 *
 * 行上悬停 = 画布高亮这个资源的上下游；点一行 = 选中那张卡。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Resources
 */

import { useState } from 'react'
import { idKey, isResource } from '../../shared/model.ts'
import { normalizeRoot, rootOf } from '../../shared/outputPaths.ts'
import {
  outputResource,
  type ResourceInfo,
  resourceGraph,
  resourceTitle,
  sharedResources,
  stepResources,
} from '../../shared/resources.ts'
import type { ResourceNode, StepNode, WorkflowDocument, WorkflowEdge } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { type Edit, findNode, type Selection, takenPaths } from '../model/editor.ts'
import type { FocusFile } from './Handoff.tsx'
import css from './handoff.module.css'
import { Icon } from './Icon.tsx'
import ins from './inspector.module.css'
import { OutputEditor } from './Outputs.tsx'
import { cx, Popover, Segmented } from './primitives.tsx'
import res from './resource.module.css'
import { freeFilePath, itemText, KIND_ICON, stepName } from './resourceUi.ts'
import ui from './ui.module.css'

/** 资源的小图标：只有一项时用那一项的种类图标，否则是一叠。 */
export function ResourceIcon(props: { resource: ResourceNode; size?: number }): React.JSX.Element {
  const { items } = props.resource.data
  const only = items.length === 1 ? items[0] : undefined
  return (
    <span className={res.resIcon} data-kind={only?.kind ?? 'many'}>
      <Icon name={only === undefined ? 'layers' : KIND_ICON[only.kind]} size={props.size ?? 13} />
    </span>
  )
}

/** 资源的一行摘要：第一项的写法，多项时加上「等 N 项」。 */
export function resourceSummary(t: T, resource: ResourceNode): string {
  const { items } = resource.data
  const first = items[0]
  if (first === undefined) return t('res.empty')
  const text = itemText(first) || t('res.itemBlank')
  return items.length === 1
    ? text
    : t('res.summaryMore').replace('{first}', text).replace('{n}', String(items.length))
}

// ─────────────────────────────────────────────────────────────
// 选中步骤：它写哪些、读哪些
// ─────────────────────────────────────────────────────────────

export function StepResourcesField(props: {
  t: T
  doc: WorkflowDocument
  step: StepNode
  onEdit(edit: Edit): void
  onSelect(selection: Selection): void
  onFocusFile: FocusFile
}): React.JSX.Element {
  const { t, doc, step } = props
  const linkedNow = stepResources(doc, step.id)
  const graph = resourceGraph(doc)
  const shared = sharedResources(doc)
  const [creating, setCreating] = useState(false)
  const [linking, setLinking] = useState(false)
  const linked = new Set([
    ...linkedNow.writes.map((item) => item.resource.id),
    ...linkedNow.reads.map((item) => item.resource.id),
  ])
  const others = doc.nodes.filter(
    (node): node is ResourceNode => isResource(node) && !linked.has(node.id),
  )

  const row = (
    resource: ResourceNode,
    key: string,
    badge: React.ReactNode,
    meta: string,
    edge: WorkflowEdge | null,
  ): React.JSX.Element => (
    <div
      key={key}
      className={css.fileRow}
      data-testid="wl-step-resource"
      onPointerEnter={() => props.onFocusFile(resource.id)}
      onPointerLeave={() => props.onFocusFile(null)}
    >
      <button
        type="button"
        className={css.fileRowMain}
        onClick={() => props.onSelect({ kind: 'node', id: resource.id })}
      >
        <ResourceIcon resource={resource} />
        <span className={css.pickText}>
          <span className={css.detailTitle}>{resourceTitle(resource)}</span>
          <span className={css.detailMeta}>{meta}</span>
        </span>
        {badge}
      </button>
      {edge !== null && (
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, css.fileRowRemove)}
          aria-label={t('res.unlink')}
          data-tip={t('res.unlink')}
          onClick={() => props.onEdit({ type: 'removeEdge', id: edge.id })}
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  )

  const writersOf = (info: ResourceInfo | undefined): string =>
    (info?.writers ?? [])
      .filter((writer) => idKey(writer.id) !== idKey(step.id))
      .map((writer) => stepName(findNode(doc, writer.id), writer.id))
      .join('、')

  const nothing =
    linkedNow.writes.length === 0 && linkedNow.reads.length === 0 && shared.length === 0
  return (
    <section className={ins.field} data-testid="wl-step-resources">
      <div className={ins.label}>
        <span>{t('res.title')}</span>
      </div>
      {nothing && <p className={ins.help}>{t('res.none')}</p>}
      {linkedNow.writes.length > 0 && (
        <div className={css.fileGroup}>
          <p className={css.subLabel}>{t('res.writes')}</p>
          {linkedNow.writes.map(({ resource, update, edge }) =>
            row(
              resource,
              edge.id,
              <span className={css.access} data-access={update ? 'update' : 'produce'}>
                {update ? t('file.update') : t('file.produce')}
              </span>,
              resourceSummary(t, resource),
              edge,
            ),
          )}
        </div>
      )}
      {linkedNow.reads.length > 0 && (
        <div className={css.fileGroup}>
          <p className={css.subLabel}>{t('res.reads')}</p>
          {linkedNow.reads.map(({ resource, edge }) => {
            const from = writersOf(graph.get(resource.id))
            return row(
              resource,
              edge.id,
              <span className={css.access} data-access="read">
                {t('file.read')}
              </span>,
              from === '' ? resourceSummary(t, resource) : `${t('res.from')} ${from}`,
              edge,
            )
          })}
        </div>
      )}
      {shared.length > 0 && (
        <div className={css.fileGroup}>
          <p className={css.subLabel}>{t('res.shared')}</p>
          {shared.map((resource) =>
            row(
              resource,
              resource.id,
              <span className={css.access}>{t('res.sharedTag')}</span>,
              resourceSummary(t, resource),
              null,
            ),
          )}
        </div>
      )}
      <div className={css.fileActions}>
        <button
          type="button"
          className={css.outAddLike}
          data-testid="wl-resource-new"
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={13} />
          {t('res.newOutput')}
        </button>
        <Popover
          open={linking}
          onClose={() => setLinking(false)}
          align="end"
          up
          label={t('res.link')}
          className={css.linkMenu}
          trigger={
            <button
              type="button"
              className={css.outAddLike}
              data-testid="wl-resource-link"
              aria-expanded={linking}
              onClick={() => setLinking((open) => !open)}
            >
              <Icon name="handoff" size={13} />
              {t('res.link')}
            </button>
          }
        >
          {others.length === 0 ? (
            <p className={css.empty}>{t('res.linkEmpty')}</p>
          ) : (
            others.map((resource) => (
              <div key={resource.id} className={css.linkItem} data-testid="wl-resource-link-item">
                <ResourceIcon resource={resource} />
                <span className={cx(css.detailTitle, css.linkPath)}>{resourceTitle(resource)}</span>
                <button
                  type="button"
                  className={css.linkAction}
                  data-testid="wl-resource-link-read"
                  onClick={() => {
                    setLinking(false)
                    props.onEdit({ type: 'connect', source: resource.id, target: step.id })
                    props.onSelect({ kind: 'node', id: step.id })
                  }}
                >
                  {t('file.read')}
                </button>
                <button
                  type="button"
                  className={css.linkAction}
                  data-testid="wl-resource-link-write"
                  onClick={() => {
                    setLinking(false)
                    props.onEdit({ type: 'connect', source: step.id, target: resource.id })
                    props.onSelect({ kind: 'node', id: step.id })
                  }}
                >
                  {t('res.linkWrite')}
                </button>
              </div>
            ))
          )}
        </Popover>
      </div>
      {creating && (
        <OutputEditor
          t={t}
          title={t('res.newOutputTitle')}
          owner={stepName(step, step.id)}
          root={normalizeRoot(rootOf(doc.settings))}
          initial={null}
          suggest={freeFilePath(doc, `${step.id}.md`)}
          taken={takenPaths(doc)}
          canRemove={false}
          onSave={(spec) => {
            setCreating(false)
            props.onEdit({
              type: 'addResource',
              data: outputResource(spec),
              writer: step.id,
            })
          }}
          onRemove={() => setCreating(false)}
          onClose={() => setCreating(false)}
        />
      )}
    </section>
  )
}

/** 写入方式：整份写出 / 在原文件上更新（两格的小开关）。 */
export function ModeToggle(props: {
  t: T
  update: boolean
  onChange(update: boolean): void
}): React.JSX.Element {
  const { t } = props
  return (
    <div
      className={css.accessSeg}
      role="radiogroup"
      aria-label={t('res.writers')}
      data-update={props.update}
    >
      {/* 滑块：位置走 transform，颜色是两层叠着的底色交叉淡入（只动合成层）。 */}
      <span className={css.accessThumb} aria-hidden="true" />
      <button
        type="button"
        role="radio"
        aria-checked={!props.update}
        data-access="produce"
        onClick={() => props.onChange(false)}
      >
        {t('file.produce')}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={props.update}
        data-access="update"
        data-testid="wl-resource-mode-update"
        onClick={() => props.onChange(true)}
      >
        {t('file.update')}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 选中一条连着资源的线
// ─────────────────────────────────────────────────────────────

export function ResourceEdgeBody(props: {
  t: T
  edge: WorkflowEdge
  kind: 'write' | 'read'
  onEdit(edit: Edit): void
}): React.JSX.Element {
  const { t, edge } = props
  if (props.kind === 'read') {
    return (
      <section className={ins.field}>
        <div className={ins.label}>
          <span>{t('edge.read')}</span>
        </div>
        <p className={ins.help}>{t('res.readHint')}</p>
      </section>
    )
  }
  const update = edge.data?.update === true
  return (
    <section className={ins.field} data-testid="wl-resource-mode">
      <div className={ins.label}>
        <span>{t('edge.write')}</span>
      </div>
      <Segmented<'produce' | 'update'>
        label={t('edge.write')}
        value={update ? 'update' : 'produce'}
        onChange={(value) =>
          props.onEdit({ type: 'setUpdate', id: edge.id, update: value === 'update' })
        }
        options={[
          { value: 'produce', label: t('file.produceLong') },
          { value: 'update', label: t('file.updateLong') },
        ]}
      />
      <p className={ins.help}>{t('res.modeHint')}</p>
    </section>
  )
}
