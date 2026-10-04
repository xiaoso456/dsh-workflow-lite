/**
 * dsh-workflow-lite — 选中资源卡时的属性面板。
 *
 * 从上到下：名字（标题栏里直接改）、ID、描述（只在卡片上显示，不进计划）、内容（一项一行，点开在模态框里改）、
 * 写它的步骤（每个带整份写出 / 在原文件上更新的开关）、读它的步骤。一条线都没连时写明「交给整个工作流」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ResourcePanel
 */

import { idKey, isStep } from '../../shared/model.ts'
import { normalizeRoot, rootOf } from '../../shared/outputPaths.ts'
import { isShared, resourceGraph, resourceTitle } from '../../shared/resources.ts'
import type {
  ResourceItem,
  ResourceNode,
  WorkflowDocument,
  WorkflowEdge,
} from '../../shared/types.ts'
import type { HostAccess } from '../app/host.ts'
import type { T } from '../i18n.ts'
import { type Edit, findNode, type Selection } from '../model/editor.ts'
import type { FocusFile } from './Handoff.tsx'
import css from './handoff.module.css'
import { Icon } from './Icon.tsx'
import { DescriptionField } from './Inspector.tsx'
import ins from './inspector.module.css'
import { ResourceHead } from './NodeHeads.tsx'
import { cx } from './primitives.tsx'
import { ResourceItems } from './ResourceItems.tsx'
import { ModeToggle } from './Resources.tsx'
import res from './resource.module.css'
import { stepName } from './resourceUi.ts'
import { lookOf, StepMark } from './StepMark.tsx'
import ui from './ui.module.css'

export function ResourcePanel(props: {
  t: T
  doc: WorkflowDocument
  node: ResourceNode
  host: HostAccess
  onEdit(edit: Edit): void
  onSelect(selection: Selection): void
  onSeal(): void
  onFocusFile: FocusFile
  onRemove(id: string): void
  /** 标题栏里关闭按钮左边的切换（实例视图里「运行 / 编辑」）。 */
  tabs?: React.ReactNode
}): React.JSX.Element {
  const { t, doc, node } = props
  const info = resourceGraph(doc).get(node.id)
  const merge = (field: string): string => `${idKey(node.id)}:${field}`
  const written = (info?.writers.length ?? 0) > 0

  const patch = (next: Partial<ResourceNode['data']>, field?: string): void =>
    props.onEdit({
      type: 'patchResource',
      id: node.id,
      patch: next,
      ...(field === undefined ? {} : { merge: merge(field) }),
    })

  const stepRow = (id: string, extra: React.ReactNode, edge: WorkflowEdge): React.JSX.Element => {
    const step = findNode(doc, id)
    return (
      <div key={edge.id} className={css.fileRow} data-testid="wl-resource-user">
        <button
          type="button"
          className={css.fileRowMain}
          onClick={() => props.onSelect({ kind: 'node', id })}
        >
          <StepMark
            look={lookOf(id, step !== undefined && isStep(step) ? step.data : undefined)}
            size={13}
          />
          <span className={cx(css.detailTitle, css.grow)}>{stepName(step, id)}</span>
        </button>
        {extra}
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, css.fileRowRemove)}
          aria-label={t('res.unlink')}
          title={t('res.unlink')}
          onClick={() => props.onEdit({ type: 'removeEdge', id: edge.id })}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    )
  }

  const edgeOf = (source: string, target: string): WorkflowEdge | undefined =>
    doc.edges.find(
      (edge) => idKey(edge.source) === idKey(source) && idKey(edge.target) === idKey(target),
    )

  return (
    <aside
      className={cx(ui.panel, ins.panel)}
      data-testid="wl-inspector"
      aria-label={t('res.title')}
      onPointerEnter={() => props.onFocusFile(node.id)}
      onPointerLeave={() => props.onFocusFile(null)}
    >
      <ResourceHead
        t={t}
        node={node}
        onEdit={props.onEdit}
        onSeal={props.onSeal}
        extra={props.tabs}
        onClose={() => props.onSelect(null)}
      />

      <div className={ins.body}>
        <DescriptionField
          t={t}
          value={node.data.description ?? ''}
          onChange={(description) =>
            patch({ description: description === '' ? undefined : description }, 'description')
          }
          onBlur={props.onSeal}
        />

        <section className={ins.field} data-testid="wl-resource-items">
          <div className={ins.label}>
            <span>{t('res.items')}</span>
            {node.data.items.length > 0 && (
              <span className={ins.count}>
                {t('res.itemCount').replace('{n}', String(node.data.items.length))}
              </span>
            )}
          </div>
          <ResourceItems
            t={t}
            items={node.data.items}
            host={props.host}
            owner={resourceTitle(node)}
            written={written}
            root={normalizeRoot(rootOf(doc.settings))}
            onChange={(items: ResourceItem[]) => patch({ items })}
          />
        </section>

        {info !== undefined && isShared(info) ? (
          <section className={ins.field} data-testid="wl-resource-shared">
            <div className={ins.label}>
              <span>{t('res.users')}</span>
            </div>
            <p className={res.sharedNote}>
              <Icon name="shared" size={13} />
              <span>{t('res.sharedHint')}</span>
            </p>
          </section>
        ) : (
          <>
            <section className={ins.field} data-testid="wl-resource-writers">
              <div className={ins.label}>
                <span>{t('res.writers')}</span>
              </div>
              {(info?.writers ?? []).length === 0 ? (
                <p className={ins.help}>{t('res.noWriters')}</p>
              ) : (
                <div className={css.fileGroup}>
                  {(info?.writers ?? []).map((writer) => {
                    const edge = edgeOf(writer.id, node.id)
                    if (edge === undefined) return null
                    return stepRow(
                      writer.id,
                      <ModeToggle
                        t={t}
                        update={writer.update}
                        onChange={(update) =>
                          props.onEdit({ type: 'setUpdate', id: edge.id, update })
                        }
                      />,
                      edge,
                    )
                  })}
                  <p className={ins.help}>{t('res.modeHint')}</p>
                </div>
              )}
            </section>

            <section className={ins.field} data-testid="wl-resource-readers">
              <div className={ins.label}>
                <span>{t('res.readers')}</span>
              </div>
              {(info?.readers ?? []).length === 0 ? (
                <p className={ins.help}>{t('res.noReaders')}</p>
              ) : (
                <div className={css.fileGroup}>
                  {(info?.readers ?? []).map((reader) => {
                    const edge = edgeOf(node.id, reader)
                    return edge === undefined
                      ? null
                      : stepRow(
                          reader,
                          <span className={css.access} data-access="read">
                            {t('file.read')}
                          </span>,
                          edge,
                        )
                  })}
                </div>
              )}
            </section>
          </>
        )}
        <p className={ins.help}>{t('res.connectHint')}</p>
      </div>

      <footer className={ins.foot}>
        <span className={ui.grow} />
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.danger)}
          data-testid="wl-resource-delete"
          onClick={() => props.onRemove(node.id)}
        >
          <Icon name="trash" size={14} />
          {t('res.delete')}
        </button>
      </footer>
    </aside>
  )
}
