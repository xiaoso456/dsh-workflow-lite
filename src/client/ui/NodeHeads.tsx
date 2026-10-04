/**
 * dsh-workflow-lite — 各种东西的右栏标题栏：步骤、资源、输入、连线、概览。
 *
 * 模板的属性面板、实例右栏的「运行」与「编辑」都用这几个，所以实例里两边切换时标题栏一点不动。
 * 右边的 `extra` 放在关闭按钮左边（实例里是「运行 / 编辑」的切换）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/NodeHeads
 */

import type { GraphAnalysis } from '../../shared/graph.ts'
import { inputKind } from '../../shared/inputs.ts'
import { idKey } from '../../shared/model.ts'
import { edgeKind, nodeIndex, resourceTitle } from '../../shared/resources.ts'
import type {
  InputNode,
  ResourceNode,
  StepNode,
  WorkflowDocument,
  WorkflowEdge,
} from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import type { Edit } from '../model/editor.ts'
import { inputKindLabel } from '../model/library.ts'
import { AppearancePicker } from './AppearancePicker.tsx'
import hand from './handoff.module.css'
import { Icon, type IconName } from './Icon.tsx'
import input from './input.module.css'
import css from './inspector.module.css'
import { PanelHead } from './PanelHead.tsx'
import { cx } from './primitives.tsx'
import res from './resource.module.css'
import run from './run.module.css'
import { lookOf } from './StepMark.tsx'

interface HeadProps {
  t: T
  /** 关闭按钮左边的东西。 */
  extra?: React.ReactNode
  onClose(): void
  closeTestId?: string
}

/** 名称会进计划里的表格：换行与竖线直接不让打进来。 */
function cleanName(value: string): string | undefined {
  const clean = value.replace(/[\r\n|]/gu, '')
  return clean === '' ? undefined : clean
}

export function StepHead(
  props: HeadProps & { node: StepNode; onEdit(edit: Edit): void; onSeal(): void },
): React.JSX.Element {
  const { t, node, onEdit } = props
  return (
    <PanelHead
      t={t}
      lead={
        <AppearancePicker
          t={t}
          look={lookOf(node.id, node.data)}
          custom={node.data.icon !== undefined || node.data.color !== undefined}
          onChange={(patch) => onEdit({ type: 'patchNode', id: node.id, patch })}
        />
      }
      title={
        <input
          className={css.titleInput}
          value={node.data.label ?? ''}
          placeholder={node.id}
          aria-label={t('ins.name')}
          data-testid="wl-ins-label"
          onChange={(event) =>
            onEdit({
              type: 'patchNode',
              id: node.id,
              patch: { label: cleanName(event.currentTarget.value) },
              merge: `${idKey(node.id)}:label`,
            })
          }
          onBlur={props.onSeal}
        />
      }
      id={node.id}
      extra={props.extra}
      onClose={props.onClose}
      closeTestId={props.closeTestId}
    />
  )
}

export function ResourceHead(
  props: HeadProps & { node: ResourceNode; onEdit(edit: Edit): void; onSeal(): void },
): React.JSX.Element {
  const { t, node } = props
  return (
    <PanelHead
      t={t}
      lead={
        <span className={res.headIcon}>
          <Icon name="layers" size={16} />
        </span>
      }
      title={
        <input
          className={css.titleInput}
          value={node.data.label ?? ''}
          placeholder={resourceTitle({ ...node, data: { ...node.data, label: '' } })}
          aria-label={t('res.name')}
          data-testid="wl-resource-label"
          onChange={(event) =>
            props.onEdit({
              type: 'patchResource',
              id: node.id,
              patch: { label: cleanName(event.currentTarget.value) },
              merge: `${idKey(node.id)}:label`,
            })
          }
          onBlur={props.onSeal}
        />
      }
      id={node.id}
      extra={props.extra}
      onClose={props.onClose}
      closeTestId={props.closeTestId}
    />
  )
}

export function InputHead(props: HeadProps & { node: InputNode }): React.JSX.Element {
  const { t, node } = props
  return (
    <PanelHead
      t={t}
      lead={
        <span className={cx(hand.askIcon, input.headIcon)}>
          <Icon name="ask" size={16} />
        </span>
      }
      title={<span className={css.headTitle}>{t('input.title')}</span>}
      id={node.id}
      extra={
        <>
          <span className={css.badge}>{t(inputKindLabel(inputKind(node.data)))}</span>
          {props.extra}
        </>
      }
      onClose={props.onClose}
      closeTestId={props.closeTestId}
    />
  )
}

/** 线的标题与图标（右栏标题栏、顶栏「在看什么」用）。 */
export function edgeHead(
  doc: WorkflowDocument,
  analysis: GraphAnalysis,
  edge: WorkflowEdge,
): { icon: IconName; title: LocaleKey } {
  const kind = edgeKind(nodeIndex(doc), edge)
  if (kind === 'write') return { icon: 'layers', title: 'edge.write' }
  if (kind === 'read') return { icon: 'layers', title: 'edge.read' }
  if (kind === 'ask') return { icon: 'ask', title: 'edge.askTitle' }
  return { icon: analysis.backEdges.has(edge.id) ? 'loop' : 'arrowRight', title: 'edge.title' }
}

export function EdgeHead(
  props: HeadProps & { doc: WorkflowDocument; analysis: GraphAnalysis; edge: WorkflowEdge },
): React.JSX.Element {
  const { t } = props
  const head = edgeHead(props.doc, props.analysis, props.edge)
  return (
    <PanelHead
      t={t}
      lead={
        <span className={css.edgeIcon}>
          <Icon name={head.icon} size={16} />
        </span>
      }
      title={<span className={css.headTitle}>{t(head.title)}</span>}
      extra={props.extra}
      onClose={props.onClose}
      closeTestId={props.closeTestId}
    />
  )
}

/** 概览的图标块（右栏标题栏与顶栏「在看什么」共用）。 */
export function OverviewMark(): React.JSX.Element {
  return (
    <span className={run.navOverview}>
      <Icon name="overview" size={15} />
    </span>
  )
}

export function OverviewHead(props: HeadProps): React.JSX.Element {
  const { t } = props
  return (
    <PanelHead
      t={t}
      lead={<OverviewMark />}
      title={<span className={css.headTitle}>{t('run.overview')}</span>}
      extra={props.extra}
      onClose={props.onClose}
      closeTestId={props.closeTestId}
    />
  )
}
