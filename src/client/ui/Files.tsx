/**
 * dsh-workflow-lite — 文件卡在属性面板里的样子。
 *
 * - {@link StepFilesField}：选中步骤时，"它写哪些文件、读哪些文件"，能新建产出文件、关联已有文件；
 * - {@link FilePanel}：选中文件卡时，改路径与生成规则，看谁写（整份写出 / 在原文件上更新）、谁读；
 * - {@link FileEdgeBody}：选中一条连着文件的线时，写入方式或读取说明。
 *
 * 行上悬停 = 画布高亮这份文件的上下游；点一行 = 选中那张卡。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Files
 */

import { useEffect, useRef, useState } from 'react'
import { type FileInfo, fileGraph, stepFiles } from '../../shared/files.ts'
import { MAX_TEXT_CODEPOINTS } from '../../shared/limits.ts'
import { idKey, isFile } from '../../shared/model.ts'
import { checkOutput, codepointLength } from '../../shared/naming.ts'
import { outputKey, resolveOutputPath } from '../../shared/outputPaths.ts'
import type {
  FileNode,
  StepNode,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { type Edit, findNode, type Selection } from '../model/editor.ts'
import { kindOf } from '../model/library.ts'
import type { FocusFile } from './Handoff.tsx'
import css from './handoff.module.css'
import { Icon, kindIcon } from './Icon.tsx'
import ins from './inspector.module.css'
import { OutputEditor } from './Outputs.tsx'
import { cx, Popover, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

/** 步骤的显示名。 */
export function stepName(node: WorkflowNode | undefined, fallback: string): string {
  if (node === undefined || isFile(node)) return fallback
  return node.data.label === undefined || node.data.label === '' ? node.id : node.data.label
}

/** 路径的最后一段（卡片标题里放不下整条路径）。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/u).filter((part) => part !== '' && part !== '.')
  return parts[parts.length - 1] ?? path
}

/** 图里没被占用的路径：`x.md` 被占了就 `x-2.md`、`x-3.md`… */
export function freeFilePath(doc: WorkflowDocument, want: string): string {
  const taken = new Set(
    doc.nodes.filter(isFile).map((node) => outputKey(node.data.path).toLowerCase()),
  )
  if (!taken.has(outputKey(want).toLowerCase())) return want
  const dot = want.lastIndexOf('.')
  const cut = dot > 0 ? dot : want.length
  for (let n = 2; ; n += 1) {
    const candidate = `${want.slice(0, cut)}-${n}${want.slice(cut)}`
    if (!taken.has(outputKey(candidate).toLowerCase())) return candidate
  }
}

// ─────────────────────────────────────────────────────────────
// 选中步骤：它写哪些、读哪些
// ─────────────────────────────────────────────────────────────

export function StepFilesField(props: {
  t: T
  doc: WorkflowDocument
  step: StepNode
  onEdit(edit: Edit): void
  onSelect(selection: Selection): void
  onFocusFile: FocusFile
}): React.JSX.Element {
  const { t, doc, step } = props
  const files = stepFiles(doc, step.id)
  const graph = fileGraph(doc)
  const [creating, setCreating] = useState(false)
  const [linking, setLinking] = useState(false)
  const linked = new Set([
    ...files.writes.map((item) => item.file.id),
    ...files.reads.map((item) => item.file.id),
  ])
  const others = doc.nodes.filter((node): node is FileNode => isFile(node) && !linked.has(node.id))

  const row = (
    file: FileNode,
    edge: WorkflowEdge,
    badge: React.ReactNode,
    meta: string,
  ): React.JSX.Element => (
    <div
      key={edge.id}
      className={css.fileRow}
      data-testid="wl-step-file"
      onPointerEnter={() => props.onFocusFile(file.id)}
      onPointerLeave={() => props.onFocusFile(null)}
    >
      <button
        type="button"
        className={css.fileRowMain}
        onClick={() => props.onSelect({ kind: 'node', id: file.id })}
      >
        <span className={css.fileIcon}>
          <Icon name="file" size={13} />
        </span>
        <span className={css.pickText}>
          <span className={css.detailPath}>{file.data.path}</span>
          <span className={css.detailMeta}>{meta}</span>
        </span>
        {badge}
      </button>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, css.fileRowRemove)}
        aria-label={t('file.unlink')}
        title={t('file.unlink')}
        onClick={() => props.onEdit({ type: 'removeEdge', id: edge.id })}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  )

  const writersOf = (info: FileInfo | undefined): string =>
    (info?.writers ?? [])
      .filter((writer) => idKey(writer.id) !== idKey(step.id))
      .map((writer) => stepName(findNode(doc, writer.id), writer.id))
      .join('、')

  return (
    <section className={ins.field} data-testid="wl-step-files">
      <div className={ins.label}>
        <span>{t('file.title')}</span>
      </div>
      {files.writes.length === 0 && files.reads.length === 0 && (
        <p className={ins.help}>{t('file.none')}</p>
      )}
      {files.writes.length > 0 && (
        <div className={css.fileGroup}>
          <p className={css.subLabel}>{t('file.writes')}</p>
          {files.writes.map(({ file, update, edge }) =>
            row(
              file,
              edge,
              <span className={css.access} data-access={update ? 'update' : 'produce'}>
                {update ? t('file.update') : t('file.produce')}
              </span>,
              file.data.rule?.replace(/\s+/gu, ' ') ?? t('file.noRule'),
            ),
          )}
        </div>
      )}
      {files.reads.length > 0 && (
        <div className={css.fileGroup}>
          <p className={css.subLabel}>{t('file.reads')}</p>
          {files.reads.map(({ file, edge }) => {
            const from = writersOf(graph.get(file.id))
            return row(
              file,
              edge,
              <span className={css.access} data-access="read">
                {t('file.read')}
              </span>,
              from === '' ? t('file.noWriters') : `${t('file.from')} ${from}`,
            )
          })}
        </div>
      )}
      <div className={css.fileActions}>
        <button
          type="button"
          className={css.outAddLike}
          data-testid="wl-file-new"
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={13} />
          {t('file.new')}
        </button>
        <Popover
          open={linking}
          onClose={() => setLinking(false)}
          align="end"
          up
          label={t('file.link')}
          className={css.linkMenu}
          trigger={
            <button
              type="button"
              className={css.outAddLike}
              data-testid="wl-file-link"
              aria-expanded={linking}
              onClick={() => setLinking((open) => !open)}
            >
              <Icon name="handoff" size={13} />
              {t('file.link')}
            </button>
          }
        >
          {others.length === 0 ? (
            <p className={css.empty}>{t('file.linkEmpty')}</p>
          ) : (
            others.map((file) => (
              <div key={file.id} className={css.linkItem} data-testid="wl-file-link-item">
                <span className={css.fileIcon}>
                  <Icon name="file" size={13} />
                </span>
                <span className={cx(css.detailPath, css.linkPath)}>{file.data.path}</span>
                <button
                  type="button"
                  className={css.linkAction}
                  data-testid="wl-file-link-read"
                  onClick={() => {
                    setLinking(false)
                    props.onEdit({ type: 'connect', source: file.id, target: step.id })
                    props.onSelect({ kind: 'node', id: step.id })
                  }}
                >
                  {t('file.linkRead')}
                </button>
                <button
                  type="button"
                  className={css.linkAction}
                  data-testid="wl-file-link-write"
                  onClick={() => {
                    setLinking(false)
                    props.onEdit({ type: 'connect', source: step.id, target: file.id })
                    props.onSelect({ kind: 'node', id: step.id })
                  }}
                >
                  {t('file.linkWrite')}
                </button>
              </div>
            ))
          )}
        </Popover>
      </div>
      {creating && (
        <OutputEditor
          t={t}
          title={t('file.newTitle')}
          owner={stepName(step, step.id)}
          root={doc.settings?.outputRoot}
          initial={null}
          suggest={freeFilePath(doc, `${step.id}.md`)}
          taken={doc.nodes.filter(isFile).map((node) => node.data.path)}
          canRemove={false}
          onSave={(spec) => {
            setCreating(false)
            props.onEdit({
              type: 'addFile',
              path: spec.path,
              ...(spec.rule === undefined ? {} : { rule: spec.rule }),
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

// ─────────────────────────────────────────────────────────────
// 选中文件卡
// ─────────────────────────────────────────────────────────────

/** 文件卡的属性面板：路径、生成规则、谁写、谁读。 */
export function FilePanel(props: {
  t: T
  doc: WorkflowDocument
  node: FileNode
  onEdit(edit: Edit): void
  onSelect(selection: Selection): void
  onSeal(): void
  onFocusFile: FocusFile
  onRemove(id: string): void
}): React.JSX.Element {
  const { t, doc, node } = props
  const info = fileGraph(doc).get(node.id)
  const merge = (field: string): string => `${idKey(node.id)}:${field}`
  const [path, setPath] = useState(node.data.path)
  const [rule, setRule] = useState(node.data.rule ?? '')
  /** 最近一次自己交出去的路径：文档里等于它就不回灌。 */
  const emittedPath = useRef(node.data.path)
  const emittedRule = useRef(node.data.rule ?? '')

  useEffect(() => {
    if (node.data.path === emittedPath.current) return
    emittedPath.current = node.data.path
    setPath(node.data.path)
  }, [node.data.path])
  useEffect(() => {
    const current = node.data.rule ?? ''
    if (current === emittedRule.current.trim() || current === emittedRule.current) return
    emittedRule.current = current
    setRule(current)
  }, [node.data.rule])

  const trimmed = path.trim()
  const taken = doc.nodes.some(
    (other) =>
      isFile(other) &&
      other.id !== node.id &&
      outputKey(other.data.path).toLowerCase() === outputKey(trimmed).toLowerCase(),
  )
  const pathError =
    trimmed === ''
      ? t('ins.output.empty')
      : checkOutput(trimmed) !== null
        ? t('ins.outputInvalid')
        : taken
          ? t('file.pathTaken')
          : null
  const root = doc.settings?.outputRoot

  const stepRow = (id: string, extra: React.ReactNode, edge: WorkflowEdge): React.JSX.Element => {
    const step = findNode(doc, id)
    return (
      <div key={edge.id} className={css.fileRow} data-testid="wl-file-user">
        <button
          type="button"
          className={css.fileRowMain}
          onClick={() => props.onSelect({ kind: 'node', id })}
        >
          <span className={ui.kind} data-kind={kindOf(id)}>
            <Icon name={kindIcon(kindOf(id))} size={13} />
          </span>
          <span className={cx(css.detailTitle, css.grow)}>{stepName(step, id)}</span>
        </button>
        {extra}
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, css.fileRowRemove)}
          aria-label={t('file.unlink')}
          title={t('file.unlink')}
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
      aria-label={t('file.title')}
      onPointerEnter={() => props.onFocusFile(node.id)}
      onPointerLeave={() => props.onFocusFile(null)}
    >
      <header className={ins.head}>
        <span className={css.fileBadge}>
          <Icon name="file" size={16} />
        </span>
        <span className={cx(ins.headTitle, css.fileTitle)} title={node.data.path}>
          {baseName(node.data.path)}
        </span>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={() => props.onSelect(null)}
        >
          <Icon name="x" size={15} />
        </button>
      </header>

      <div className={ins.body}>
        <section className={ins.field}>
          <label className={ins.label} htmlFor="wl-file-path">
            <span>{t('file.path')}</span>
          </label>
          <input
            id="wl-file-path"
            className={cx(ui.input, ui.mono)}
            value={path}
            aria-invalid={pathError !== null}
            data-testid="wl-file-path"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              const value = event.currentTarget.value
              setPath(value)
              const next = value.trim()
              const clash = doc.nodes.some(
                (other) =>
                  isFile(other) &&
                  other.id !== node.id &&
                  outputKey(other.data.path).toLowerCase() === outputKey(next).toLowerCase(),
              )
              // 不合法的值不写进文档，只在原地标红。
              if (next === '' || checkOutput(next) !== null || clash) return
              emittedPath.current = next
              props.onEdit({
                type: 'patchFile',
                id: node.id,
                patch: { path: next },
                merge: merge('path'),
              })
            }}
            onBlur={props.onSeal}
          />
          {pathError !== null ? (
            <p className={ins.error}>{pathError}</p>
          ) : root !== undefined ? (
            <div className={ins.rootPreview} data-testid="wl-file-final">
              <span className={ins.rootPreviewLabel}>{t('out.finalPath')}</span>
              <code className={ins.rootPreviewResult}>{resolveOutputPath(root, trimmed)}</code>
            </div>
          ) : (
            <p className={ins.help}>{t('file.pathHint')}</p>
          )}
        </section>

        <section className={ins.field}>
          <label className={ins.label} htmlFor="wl-file-rule">
            <span>
              {t('file.rule')}
              <span className={ins.optional}>{t('out.optional')}</span>
            </span>
            <span className={ins.count}>
              {codepointLength(rule)} / {MAX_TEXT_CODEPOINTS}
            </span>
          </label>
          <textarea
            id="wl-file-rule"
            className={cx(ui.textarea, css.ruleArea)}
            value={rule}
            placeholder={t('file.rulePlaceholder')}
            data-testid="wl-file-rule"
            onChange={(event) => {
              const value = event.currentTarget.value
              setRule(value)
              if (codepointLength(value) > MAX_TEXT_CODEPOINTS) return
              emittedRule.current = value
              props.onEdit({
                type: 'patchFile',
                id: node.id,
                patch: { rule: value.trim() === '' ? undefined : value },
                merge: merge('rule'),
              })
            }}
            onBlur={props.onSeal}
          />
          <p className={ins.help}>{t('file.ruleHint')}</p>
        </section>

        <section className={ins.field} data-testid="wl-file-writers">
          <div className={ins.label}>
            <span>{t('file.writers')}</span>
          </div>
          {(info?.writers ?? []).length === 0 ? (
            <p className={ins.help}>{t('file.noWriters')}</p>
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
                    onChange={(update) => props.onEdit({ type: 'setUpdate', id: edge.id, update })}
                  />,
                  edge,
                )
              })}
              <p className={ins.help}>{t('file.modeHint')}</p>
            </div>
          )}
        </section>

        <section className={ins.field} data-testid="wl-file-readers">
          <div className={ins.label}>
            <span>{t('file.readers')}</span>
          </div>
          {(info?.readers ?? []).length === 0 ? (
            <p className={ins.help}>{t('file.noReaders')}</p>
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
          <p className={ins.help}>{t('file.connectHint')}</p>
        </section>
      </div>

      <footer className={ins.foot}>
        <span className={ui.grow} />
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.danger)}
          data-testid="wl-file-delete"
          onClick={() => props.onRemove(node.id)}
        >
          <Icon name="trash" size={14} />
          {t('file.delete')}
        </button>
      </footer>
    </aside>
  )
}

/** 写入方式：整份写出 / 在原文件上更新（两格的小开关）。 */
function ModeToggle(props: {
  t: T
  update: boolean
  onChange(update: boolean): void
}): React.JSX.Element {
  const { t } = props
  return (
    <div className={css.accessSeg} role="radiogroup" aria-label={t('file.writers')}>
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
        data-testid="wl-file-mode-update"
        onClick={() => props.onChange(true)}
      >
        {t('file.update')}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 选中一条连着文件的线
// ─────────────────────────────────────────────────────────────

export function FileEdgeBody(props: {
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
        <p className={ins.help}>{t('file.readHint')}</p>
      </section>
    )
  }
  const update = edge.data?.update === true
  return (
    <section className={ins.field} data-testid="wl-file-mode">
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
      <p className={ins.help}>{t('file.modeHint')}</p>
    </section>
  )
}
