/**
 * dsh-workflow-lite — 实例视图里的资源：右栏的资源详情、步骤详情里的「产出 / 读取」。
 *
 * - {@link RunResourceDetail}：选中一张资源卡时右栏的内容——名字与描述、里面的每一项（文件与文件夹带
 *   在不在，点文件看预览）、选中那个文件的预览与查看 / 用其他程序打开，谁写它、谁读它
 *   （带各自的运行状态，点一下跳过去）。
 * - {@link StepResourceList}：步骤详情里它写哪些、读哪些资源；悬停在画布上高亮那张卡，点一下选中它。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunFiles
 */

import { useMemo, useState } from 'react'
import { isResource, isStep } from '../../shared/model.ts'
import { outputKey, resolveItemPath, rootOf } from '../../shared/outputPaths.ts'
import { resourceGraph, resourceTitle, stepResources } from '../../shared/resources.ts'
import type { NodeStatus, RunState } from '../../shared/runState.ts'
import type { ResourceNode, WorkflowDocument } from '../../shared/types.ts'
import type { Desktop } from '../app/desktop.ts'
import { type FileTarget, useRunFile } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName, formatBytes } from '../model/fileKind.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { RUN_TEXT } from './Canvas.tsx'
import { FileTag } from './FileTag.tsx'
import css from './files.module.css'
import { Icon } from './Icon.tsx'
import { OpenWith } from './OpenWith.tsx'
import { cx } from './primitives.tsx'
import { ResourceIcon, resourceSummary } from './Resources.tsx'
import res from './resource.module.css'
import { itemText, KIND_ICON, KIND_LABEL } from './resourceUi.ts'
import run from './run.module.css'
import { lookOf, StepMark } from './StepMark.tsx'
import ui from './ui.module.css'

/** 快照里一个步骤的样子。 */
function stepLook(doc: WorkflowDocument, id: string) {
  const node = doc.nodes.find((candidate) => candidate.id === id)
  return lookOf(id, node !== undefined && isStep(node) ? node.data : undefined)
}

/** 预览里最多放几行。 */
const PREVIEW_LINES = 14

function stepLabel(doc: WorkflowDocument, id: string): string {
  const node = doc.nodes.find((candidate) => candidate.id === id)
  return node !== undefined &&
    isStep(node) &&
    node.data.label !== undefined &&
    node.data.label !== ''
    ? node.data.label
    : id
}

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
      title={props.made ? props.t('file.generated') : props.t('file.notGenerated')}
    >
      <Icon name={props.made ? 'check' : 'circle'} size={props.made ? 14 : 11} />
    </span>
  )
}

function StatusChip(props: { t: T; status: NodeStatus | undefined }): React.JSX.Element | null {
  if (props.status === undefined) return null
  return (
    <span className={run.status} data-run-status={props.status}>
      <span className={run.dot} />
      {props.t(RUN_TEXT[props.status])}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// 右栏：选中一张资源卡
// ─────────────────────────────────────────────────────────────

export function RunResourceDetail(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  snapshot: WorkflowDocument
  resource: ResourceNode
  /** 每一项在不在（不是路径的项为 `null`）。 */
  made: readonly (boolean | null)[]
  state: RunState | null
  /** 状态文件的修改时间：变了就重读预览（模型写完文件通常也会更新状态）。 */
  version: number
  desktop: Desktop | undefined
  onSelectStep(id: string): void
  onFocusFile(id: string | null): void
  onView(target: FileTarget, title: string): void
  onError(text: string): void
}): React.JSX.Element {
  const { t, snapshot, resource } = props
  const info = useMemo(() => resourceGraph(snapshot).get(resource.id), [snapshot, resource.id])
  const items = resource.data.items
  // 预览哪个文件：缺省是第一个文件项。
  const firstFile = items.findIndex((item) => item.kind === 'file' && item.value.trim() !== '')
  const [active, setActive] = useState(firstFile)
  const activeItem = active >= 0 ? items[active] : undefined

  const stepRow = (id: string, mode: 'produce' | 'update' | 'read'): React.JSX.Element => (
    <li key={`${mode}:${id}`}>
      <button
        type="button"
        className={css.row}
        data-testid="wl-run-file-step"
        data-id={id}
        onClick={() => props.onSelectStep(id)}
      >
        <StepMark look={stepLook(snapshot, id)} size={13} />
        <span className={css.rowText}>
          <span className={css.rowName}>{stepLabel(snapshot, id)}</span>
        </span>
        <span className={css.rowEnd}>
          <span className={css.mode} data-mode={mode}>
            {t(
              mode === 'produce' ? 'file.produce' : mode === 'update' ? 'file.update' : 'file.read',
            )}
          </span>
          <StatusChip t={t} status={props.state?.nodes[id]?.status} />
        </span>
      </button>
    </li>
  )

  return (
    <div
      className={css.detail}
      data-testid="wl-run-resource"
      onPointerEnter={() => props.onFocusFile(resource.id)}
      onPointerLeave={() => props.onFocusFile(null)}
    >
      <section className={css.head}>
        <div className={css.hero}>
          <ResourceIcon resource={resource} size={16} />
          <div className={css.heroText}>
            <span className={css.heroName}>{resourceTitle(resource)}</span>
            {resource.data.description !== undefined && (
              <span className={css.heroPath}>{resource.data.description}</span>
            )}
          </div>
        </div>
      </section>

      <section className={run.section} data-testid="wl-run-resource-items">
        <p className={css.groupTitle}>
          {t('res.items')}
          <span className={css.groupCount}>{items.length}</span>
        </p>
        <ul className={css.list}>
          {items.map((item, index) => {
            const pathLike = item.kind === 'file' || item.kind === 'folder'
            const made = props.made[index] ?? null
            const display = pathLike ? itemDisplayPath(snapshot, resource, index) : ''
            const content = (
              <>
                {item.kind === 'file' ? (
                  <FileTag path={display} />
                ) : (
                  <span className={res.kindIcon} data-kind={item.kind}>
                    <Icon name={KIND_ICON[item.kind]} size={13} />
                  </span>
                )}
                <span className={css.rowText} title={pathLike ? display : item.value}>
                  <span className={css.rowName}>{itemText(item) || '—'}</span>
                  <span className={css.rowSub}>
                    {pathLike ? display : (item.note ?? t(KIND_LABEL[item.kind]))}
                  </span>
                </span>
                <span className={css.rowEnd}>{made !== null && <Made t={t} made={made} />}</span>
              </>
            )
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: 资源里的一项没有自己的身份
              <li key={index}>
                {item.kind === 'file' ? (
                  <button
                    type="button"
                    className={css.row}
                    data-on={index === active}
                    data-testid="wl-run-resource-item"
                    onClick={() => setActive(index)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={css.row} data-testid="wl-run-resource-item">
                    {content}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {activeItem !== undefined && activeItem.kind === 'file' && (
        <ItemPreview
          key={active}
          t={t}
          rpc={props.rpc}
          instance={props.instance}
          node={resource.id}
          index={active}
          display={itemDisplayPath(snapshot, resource, active)}
          made={props.made[active] === true}
          version={props.version}
          desktop={props.desktop}
          note={activeItem.note}
          onView={props.onView}
          onError={props.onError}
        />
      )}

      <section className={run.section}>
        <p className={css.groupTitle}>
          {t('res.writers')}
          <span className={css.groupCount}>{info?.writers.length ?? 0}</span>
        </p>
        {(info?.writers.length ?? 0) === 0 ? (
          <p className={css.previewNote} style={{ padding: 0 }}>
            {t('res.noWritersRun')}
          </p>
        ) : (
          <ul className={css.list}>
            {info?.writers.map((writer) =>
              stepRow(writer.id, writer.update ? 'update' : 'produce'),
            )}
          </ul>
        )}
      </section>

      <section className={run.section}>
        <p className={css.groupTitle}>
          {t('res.readers')}
          <span className={css.groupCount}>{info?.readers.length ?? 0}</span>
        </p>
        {(info?.readers.length ?? 0) === 0 ? (
          <p className={css.previewNote} style={{ padding: 0 }}>
            {info !== undefined && info.writers.length === 0
              ? t('res.sharedHint')
              : t('res.noReadersRun')}
          </p>
        ) : (
          <ul className={css.list}>{info?.readers.map((reader) => stepRow(reader, 'read'))}</ul>
        )}
      </section>
    </div>
  )
}

/** 一个文件项的预览：在不在、多大、什么时候改的、前几行，查看 / 用其他程序打开。 */
function ItemPreview(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  node: string
  index: number
  display: string
  made: boolean
  version: number
  desktop: Desktop | undefined
  note: string | undefined
  onView(target: FileTarget, title: string): void
  onError(text: string): void
}): React.JSX.Element {
  const { t, display } = props
  const target = useMemo<FileTarget>(
    () => ({ node: props.node, item: props.index }),
    [props.node, props.index],
  )
  const loaded = useRunFile(props.rpc, props.instance, target, `${props.made}:${props.version}`)
  const meta = loaded.file
  // 刚读回来的文件信息比实例视图的轮询新：以它为准。
  const made = meta?.exists ?? props.made
  const view = (): void => props.onView(target, fileBaseName(display))

  const lines = meta?.text?.split('\n') ?? []
  const clipped = lines.length > PREVIEW_LINES
  let preview: React.ReactNode = null
  if (meta?.exists === true) {
    if (meta.kind === 'markdown' || meta.kind === 'text') {
      preview =
        lines.join('').trim() === '' ? (
          <p className={css.previewNote}>{t('file.empty')}</p>
        ) : (
          <pre className={css.previewText}>{lines.slice(0, PREVIEW_LINES).join('\n')}</pre>
        )
    } else if (meta.kind === 'tooLarge') {
      preview = (
        <p className={css.previewNote}>
          {t('file.tooLarge')
            .replace('{size}', formatBytes(meta.size))
            .replace('{limit}', formatBytes(meta.limit))}
        </p>
      )
    } else if (meta.kind === 'binary') {
      preview = <p className={css.previewNote}>{t('file.binary')}</p>
    }
  }

  return (
    <section className={run.section} data-testid="wl-run-file">
      <div className={css.hero}>
        <FileTag path={display} large />
        <div className={css.heroText}>
          <span className={css.heroName}>{fileBaseName(display)}</span>
          <span className={css.heroPath} title={display} data-testid="wl-run-file-path">
            {display}
          </span>
        </div>
        <div className={css.heroActions}>
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
            data-tip={t('file.view')}
            aria-label={t('file.view')}
            data-testid="wl-file-view"
            onClick={view}
          >
            <Icon name="eye" size={15} />
          </button>
          <OpenWith
            t={t}
            desktop={props.desktop}
            path={meta?.exists === true ? meta.path : null}
            compact
            onError={props.onError}
          />
        </div>
      </div>
      <div className={css.meta}>
        <span className={css.state} data-made={made} data-testid="wl-run-file-state">
          <Icon name={made ? 'check' : 'clock'} size={11} />
          {made ? t('file.generated') : t('file.notGenerated')}
        </span>
        {meta?.exists === true && (
          <>
            <span className={css.metaItem}>{formatBytes(meta.size)}</span>
            <span className={css.metaItem}>
              {t('file.modifiedAt').replace('{time}', shortTime(meta.mtime))}
            </span>
          </>
        )}
      </div>
      {props.note !== undefined && props.note !== '' && (
        <p className={css.previewNote} style={{ padding: 0 }}>
          {props.note}
        </p>
      )}
      {preview !== null && (
        <div
          className={css.preview}
          data-clipped={clipped}
          role="button"
          tabIndex={0}
          data-testid="wl-run-file-preview"
          onClick={view}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              view()
            }
          }}
        >
          {preview}
        </div>
      )}
      {clipped && (
        <button type="button" className={cx(ui.btn, ui.small)} onClick={view}>
          {t('file.previewMore')}
        </button>
      )}
    </section>
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
      <p className={css.previewNote} style={{ padding: 0 }}>
        {t('run.noFiles')}
      </p>
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
                  title={t('run.outputsReported')}
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
