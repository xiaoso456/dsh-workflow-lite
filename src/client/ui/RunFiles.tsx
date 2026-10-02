/**
 * dsh-workflow-lite — 实例视图里的文件：右栏的文件详情、步骤详情里的「产出 / 读取」。
 *
 * - {@link RunFileDetail}：选中一份文件时右栏的内容——生成没有、多大、什么时候改的、内容预览，
 *   查看 / 用其他程序打开，谁写它、谁读它（带各自的运行状态，点一下跳过去）。
 * - {@link StepFileList}：步骤详情里它写哪些、读哪些文件；悬停在画布上高亮那份文件，点一下选中它。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunFiles
 */

import { useMemo } from 'react'
import { fileGraph, stepFiles } from '../../shared/files.ts'
import { isFile, isStep } from '../../shared/model.ts'
import { outputKey, resolveOutputPath, rootOf } from '../../shared/outputPaths.ts'
import type { NodeStatus, RunState } from '../../shared/runState.ts'
import type { FileNode, WorkflowDocument } from '../../shared/types.ts'
import type { Desktop } from '../app/desktop.ts'
import { type FileTarget, useRunFile } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName, fileDirName, formatBytes } from '../model/fileKind.ts'
import { kindOf } from '../model/library.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { RUN_TEXT } from './Canvas.tsx'
import { FileTag } from './FileTag.tsx'
import css from './files.module.css'
import { Icon, kindIcon } from './Icon.tsx'
import { OpenWith } from './OpenWith.tsx'
import { cx } from './primitives.tsx'
import run from './run.module.css'
import ui from './ui.module.css'

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

/** 文件节点在工作区里的路径（加上产出根目录；实例的快照里根目录已换上实例 id）。 */
export function fileDisplayPath(doc: WorkflowDocument, node: FileNode): string {
  return resolveOutputPath(rootOf(doc.settings), node.data.path)
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
// 右栏：选中一份文件
// ─────────────────────────────────────────────────────────────

export function RunFileDetail(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  snapshot: WorkflowDocument
  file: FileNode
  /** 快照里每个文件节点对应的文件在不在。 */
  made: boolean
  state: RunState | null
  /** 状态文件的修改时间：变了就重读预览（模型写完文件通常也会更新状态）。 */
  version: number
  desktop: Desktop | undefined
  onSelectStep(id: string): void
  onFocusFile(id: string | null): void
  onView(target: FileTarget, title: string): void
  onError(text: string): void
}): React.JSX.Element {
  const { t, snapshot, file } = props
  const display = fileDisplayPath(snapshot, file)
  const info = useMemo(() => fileGraph(snapshot).get(file.id), [snapshot, file.id])
  const target = useMemo<FileTarget>(() => ({ node: file.id }), [file.id])
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
          <p className={css.previewNote}>{props.t('file.empty')}</p>
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

  const stepRow = (id: string, mode: 'produce' | 'update' | 'read'): React.JSX.Element => (
    <li key={`${mode}:${id}`}>
      <button
        type="button"
        className={css.row}
        data-testid="wl-run-file-step"
        data-id={id}
        onClick={() => props.onSelectStep(id)}
      >
        <span className={ui.kind} data-kind={kindOf(id)}>
          <Icon name={kindIcon(kindOf(id))} size={13} />
        </span>
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
      data-testid="wl-run-file"
      onPointerEnter={() => props.onFocusFile(file.id)}
      onPointerLeave={() => props.onFocusFile(null)}
    >
      {/* 标题行：类型签、名字与路径，右边两个图标按钮（查看、用其他程序打开）；下面一行是状态与大小、时间。 */}
      <section className={css.head}>
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
      </section>

      {preview !== null && (
        <section className={run.section}>
          <p className={run.sectionTitle}>
            <span>{t('file.previewTitle')}</span>
            {clipped && (
              <button type="button" className={cx(ui.btn, ui.small)} onClick={view}>
                {t('file.previewMore')}
              </button>
            )}
          </p>
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
        </section>
      )}

      {file.data.rule !== undefined && file.data.rule !== '' && (
        <section className={run.section}>
          <p className={run.sectionTitle}>{t('file.rule')}</p>
          <p className={css.previewNote} style={{ padding: 0 }}>
            {file.data.rule}
          </p>
        </section>
      )}

      <section className={run.section}>
        <p className={css.groupTitle}>
          {t('file.writers')}
          <span className={css.groupCount}>{info?.writers.length ?? 0}</span>
        </p>
        {(info?.writers.length ?? 0) === 0 ? (
          <p className={css.previewNote} style={{ padding: 0 }}>
            {t('file.noWriters')}
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
          {t('file.readers')}
          <span className={css.groupCount}>{info?.readers.length ?? 0}</span>
        </p>
        {(info?.readers.length ?? 0) === 0 ? (
          <p className={css.previewNote} style={{ padding: 0 }}>
            {t('file.noReaders')}
          </p>
        ) : (
          <ul className={css.list}>{info?.readers.map((reader) => stepRow(reader, 'read'))}</ul>
        )}
      </section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 步骤详情：它写哪些、读哪些
// ─────────────────────────────────────────────────────────────

export function StepFileList(props: {
  t: T
  snapshot: WorkflowDocument
  step: string
  /** 模型在状态文件里报告的产出（可能有图里没画出来的）。 */
  reported: readonly string[]
  made: Readonly<Record<string, boolean>>
  onSelectFile(id: string): void
  onFocusFile(id: string | null): void
  onViewPath(path: string): void
}): React.JSX.Element {
  const { t, snapshot } = props
  const files = useMemo(() => stepFiles(snapshot, props.step), [snapshot, props.step])
  // 模型报告产出时可能写完整路径，也可能只写相对产出根目录的那段：两种都算图里有的。
  const known = new Set(
    snapshot.nodes
      .filter(isFile)
      .flatMap((node) => [fileDisplayPath(snapshot, node), node.data.path])
      .map((path) => outputKey(path).toLowerCase()),
  )
  const extra = props.reported.filter((path) => !known.has(outputKey(path).toLowerCase()))

  const fileRow = (file: FileNode, mode: 'produce' | 'update' | 'read'): React.JSX.Element => {
    const display = fileDisplayPath(snapshot, file)
    return (
      <li key={`${mode}:${file.id}`}>
        <button
          type="button"
          className={css.row}
          data-testid="wl-run-step-file"
          data-id={file.id}
          onClick={() => props.onSelectFile(file.id)}
          onPointerEnter={() => props.onFocusFile(file.id)}
          onPointerLeave={() => props.onFocusFile(null)}
          onFocus={() => props.onFocusFile(file.id)}
          onBlur={() => props.onFocusFile(null)}
        >
          <FileTag path={display} />
          {/* 行里只写产出根目录下的那段（根目录对每份文件都一样，完整路径在文件面板里）。 */}
          <span className={css.rowText} title={display}>
            <span className={css.rowName}>{fileBaseName(file.data.path)}</span>
            {fileDirName(file.data.path) !== '' && (
              <span className={css.rowSub}>{fileDirName(file.data.path)}</span>
            )}
          </span>
          <span className={css.rowEnd}>
            {mode === 'update' && (
              <span className={css.mode} data-mode="update">
                {t('file.update')}
              </span>
            )}
            <Made t={t} made={props.made[file.id] === true} />
            <Icon name="chevronRight" size={13} />
          </span>
        </button>
      </li>
    )
  }

  if (files.writes.length === 0 && files.reads.length === 0 && extra.length === 0) {
    return (
      <p className={css.previewNote} style={{ padding: 0 }}>
        {t('run.noFiles')}
      </p>
    )
  }
  return (
    <>
      {(files.writes.length > 0 || extra.length > 0) && (
        <section className={run.section} data-testid="wl-run-step-outputs">
          <p className={css.groupTitle}>
            {t('run.outputs')}
            <span className={css.groupCount}>{files.writes.length + extra.length}</span>
          </p>
          <ul className={css.list}>
            {files.writes.map((write) => fileRow(write.file, write.update ? 'update' : 'produce'))}
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
      {files.reads.length > 0 && (
        <section className={run.section} data-testid="wl-run-step-inputs">
          <p className={css.groupTitle}>
            {t('run.inputs')}
            <span className={css.groupCount}>{files.reads.length}</span>
          </p>
          <ul className={css.list}>{files.reads.map((read) => fileRow(read.file, 'read'))}</ul>
        </section>
      )}
    </>
  )
}
