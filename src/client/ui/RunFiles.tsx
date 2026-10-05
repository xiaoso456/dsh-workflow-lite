/**
 * dsh-workflow-lite — 实例视图里步骤详情的「产出 / 读取」：它写哪些、读哪些资源；
 * 悬停在画布上高亮那张卡，点一下选中它（选中资源卡后的右栏见 `RunResource.tsx`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunFiles
 */

import { useMemo } from 'react'
import { isResource } from '../../shared/model.ts'
import { outputKey, resolveItemPath, rootOf } from '../../shared/outputPaths.ts'
import { resourceGraph, resourceTitle, stepResources } from '../../shared/resources.ts'
import type { ResourceNode, WorkflowDocument } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { fileBaseName } from '../model/fileKind.ts'
import { FileTag } from './FileTag.tsx'
import css from './files.module.css'
import { Icon } from './Icon.tsx'
import { ResourceIcon, resourceSummary } from './Resources.tsx'
import run from './run.module.css'

/**
 * 资源里一个文件 / 文件夹在工作区里的路径（实例的快照里产出根目录已换上实例 id）：
 * 有步骤写它时相对路径拼上产出根目录，只被读时相对工作区。
 */
export function itemDisplayPath(doc: WorkflowDocument, node: ResourceNode, index: number): string {
  const item = node.data.items[index]
  if (item === undefined) return ''
  const written = (resourceGraph(doc).get(node.id)?.writers.length ?? 0) > 0
  return resolveItemPath(rootOf(doc.settings), item.value, written)
}

function Made(props: { t: T; made: boolean }): React.JSX.Element {
  return (
    <span
      className={css.made}
      data-made={props.made}
      data-tip={props.made ? props.t('file.generated') : props.t('file.notGenerated')}
    >
      <Icon name={props.made ? 'check' : 'circle'} size={props.made ? 14 : 11} />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// 步骤详情：它写哪些、读哪些
// ─────────────────────────────────────────────────────────────

export function StepResourceList(props: {
  t: T
  snapshot: WorkflowDocument
  step: string
  /** 模型在状态文件里报告的产出（可能有图里没画出来的）。 */
  reported: readonly string[]
  made: Readonly<Record<string, readonly (boolean | null)[]>>
  onSelectResource(id: string): void
  onFocusFile(id: string | null): void
  onViewPath(path: string): void
}): React.JSX.Element {
  const { t, snapshot } = props
  const linked = useMemo(() => stepResources(snapshot, props.step), [snapshot, props.step])
  // 模型报告产出时可能写完整路径，也可能只写相对产出根目录的那段：两种都算图里有的。
  const known = new Set(
    snapshot.nodes
      .filter(isResource)
      .flatMap((node) =>
        node.data.items.flatMap((item, index) =>
          item.kind === 'file' || item.kind === 'folder'
            ? [itemDisplayPath(snapshot, node, index), item.value]
            : [],
        ),
      )
      .map((path) => outputKey(path).toLowerCase()),
  )
  const extra = props.reported.filter((path) => !known.has(outputKey(path).toLowerCase()))

  const row = (resource: ResourceNode, mode: 'produce' | 'update' | 'read'): React.JSX.Element => {
    const made = (props.made[resource.id] ?? []).filter((value) => value !== null)
    return (
      <li key={`${mode}:${resource.id}`}>
        <button
          type="button"
          className={css.row}
          data-testid="wl-run-step-file"
          data-id={resource.id}
          onClick={() => props.onSelectResource(resource.id)}
          onPointerEnter={() => props.onFocusFile(resource.id)}
          onPointerLeave={() => props.onFocusFile(null)}
          onFocus={() => props.onFocusFile(resource.id)}
          onBlur={() => props.onFocusFile(null)}
        >
          <ResourceIcon resource={resource} />
          <span className={css.rowText}>
            <span className={css.rowName}>{resourceTitle(resource)}</span>
            <span className={css.rowSub}>{resourceSummary(t, resource)}</span>
          </span>
          <span className={css.rowEnd}>
            {mode === 'update' && (
              <span className={css.mode} data-mode="update">
                {t('file.update')}
              </span>
            )}
            {mode !== 'read' && made.length > 0 && (
              <Made t={t} made={made.every((value) => value === true)} />
            )}
            <Icon name="chevronRight" size={13} />
          </span>
        </button>
      </li>
    )
  }

  if (linked.writes.length === 0 && linked.reads.length === 0 && extra.length === 0) {
    return (
      <section className={run.section}>
        <p className={css.groupTitle}>{t('res.title')}</p>
        <p className={css.previewNote} style={{ padding: 0 }}>
          {t('run.noFiles')}
        </p>
      </section>
    )
  }
  return (
    <>
      {(linked.writes.length > 0 || extra.length > 0) && (
        <section className={run.section} data-testid="wl-run-step-outputs">
          <p className={css.groupTitle}>
            {t('run.outputs')}
            <span className={css.groupCount}>{linked.writes.length + extra.length}</span>
          </p>
          <ul className={css.list}>
            {linked.writes.map((write) => row(write.resource, write.update ? 'update' : 'produce'))}
            {extra.map((path) => (
              <li key={`extra:${path}`}>
                <button
                  type="button"
                  className={css.row}
                  data-tip={t('run.outputsReported')}
                  onClick={() => props.onViewPath(path)}
                >
                  <FileTag path={path} />
                  <span className={css.rowText}>
                    <span className={css.rowName}>{fileBaseName(path)}</span>
                    <span className={css.rowSub}>{t('run.outputsReported')}</span>
                  </span>
                  <span className={css.rowEnd}>
                    <Icon name="eye" size={13} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {linked.reads.length > 0 && (
        <section className={run.section} data-testid="wl-run-step-inputs">
          <p className={css.groupTitle}>
            {t('run.inputs')}
            <span className={css.groupCount}>{linked.reads.length}</span>
          </p>
          <ul className={css.list}>{linked.reads.map((read) => row(read.resource, 'read'))}</ul>
        </section>
      )}
    </>
  )
}
