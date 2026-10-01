/**
 * dsh-workflow-lite — 属性面板（右侧，选中东西时才出现）。
 *
 * 选中步骤：名称、提示词、产出文件、连接，底部是复制 / 存为模板 / 删除。
 * 选中连线：两端、"什么时候走这条线"、删除。
 *
 * 文本框都是受控的：每敲一个字就改文档（合并成一条撤销步），失焦时封口。
 * 不合法的值（带竖线的名称、绝对路径的产出、带空格的判据）**不写进文档**，只在原地标红——
 * 文档里永远只有能保存的东西。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Inspector
 */

import { useEffect, useRef, useState } from 'react'
import type { GraphAnalysis } from '../../shared/graph.ts'
import { MAX_TEXT_CODEPOINTS } from '../../shared/limits.ts'
import { idKey } from '../../shared/model.ts'
import { checkText, checkWhen, isVerdictWhen } from '../../shared/naming.ts'
import type { NodeData, WorkflowDocument, WorkflowEdge, WorkflowNode } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { type Edit, findNode, type Selection, whenOf } from '../model/editor.ts'
import { kindOf } from '../model/library.ts'
import { Icon, kindIcon } from './Icon.tsx'
import css from './inspector.module.css'
import { OutputField, type OutputRequest } from './Outputs.tsx'
import { copyText, cx, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

export interface InspectorProps {
  t: T
  doc: WorkflowDocument
  analysis: GraphAnalysis
  selection: NonNullable<Selection>
  /** 刚加进来的空白步骤：面板一出来就把光标放进提示词。 */
  focusPrompt: boolean
  onEdit(edit: Edit): void
  onSelect(selection: Selection): void
  onSeal(): void
  onDuplicate(id: string): void
  onRemoveNode(id: string): void
  onSaveTemplate(name: string, data: NodeData): Promise<boolean>
  /** 画布卡片的产出浮窗里点了某个文件：打开它的编辑框。 */
  outputRequest: (OutputRequest & { node: string }) | null
  onOutputRequestDone(): void
}

function titleOf(node: WorkflowNode | undefined, fallback: string): string {
  if (node === undefined) return fallback
  return node.data.label === undefined || node.data.label === '' ? node.id : node.data.label
}

export function Inspector(props: InspectorProps): React.JSX.Element | null {
  const { doc, selection } = props
  if (selection.kind === 'node') {
    const node = findNode(doc, selection.id)
    // 换一个步骤就换一个面板实例：草稿、"存为模板"表单这些局部状态不该串到别的步骤上。
    return node === undefined ? null : <NodePanel key={idKey(node.id)} {...props} node={node} />
  }
  const edge = doc.edges.find((candidate) => candidate.id === selection.id)
  // 连线按两端认实例而不按 id：改判据会换 id，按 id 认的话每敲一个字面板都会重建、丢焦点。
  return edge === undefined ? null : (
    <EdgePanel key={`${idKey(edge.source)}->${idKey(edge.target)}`} {...props} edge={edge} />
  )
}

// ─────────────────────────────────────────────────────────────
// 步骤
// ─────────────────────────────────────────────────────────────

function NodePanel(props: InspectorProps & { node: WorkflowNode }): React.JSX.Element {
  const { t, node, doc, analysis, onEdit, onSelect } = props
  const merge = (field: string): string => `${idKey(node.id)}:${field}`
  const promptRef = useRef<HTMLTextAreaElement>(null)

  const [copied, setCopied] = useState(false)
  const [templating, setTemplating] = useState(false)
  const [templateName, setTemplateName] = useState(node.id)

  useEffect(() => {
    setTemplating(false)
    setTemplateName(node.id)
    setCopied(false)
    if (props.focusPrompt) promptRef.current?.focus()
  }, [node.id])

  const prompt = node.data.prompt ?? ''
  const key = idKey(node.id)
  const incoming = doc.edges.filter((edge) => idKey(edge.target) === key)
  const outgoing = doc.edges.filter((edge) => idKey(edge.source) === key)

  return (
    <aside
      className={cx(ui.panel, css.panel)}
      data-testid="wl-inspector"
      aria-label={t('ins.name')}
    >
      <header className={css.head}>
        <span className={ui.kind} data-kind={kindOf(node.id)}>
          <Icon name={kindIcon(kindOf(node.id))} size={16} />
        </span>
        <input
          className={css.titleInput}
          value={node.data.label ?? ''}
          placeholder={node.id}
          aria-label={t('ins.name')}
          data-testid="wl-ins-label"
          onChange={(event) => {
            // 名称会进计划里的表格：换行与竖线直接不让打进来。
            const value = event.currentTarget.value.replace(/[\r\n|]/gu, '')
            onEdit({
              type: 'patchNode',
              id: node.id,
              patch: { label: value === '' ? undefined : value },
              merge: merge('label'),
            })
          }}
          onBlur={props.onSeal}
        />
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={() => onSelect(null)}
        >
          <Icon name="x" size={15} />
        </button>
      </header>
      <button
        type="button"
        className={cx(css.idChip, ui.tip, ui.tipStart)}
        data-tip={copied ? t('common.copied') : t('ins.copyId')}
        onClick={() => {
          void copyText(node.id).then((ok) => setCopied(ok))
        }}
      >
        <span>ID</span>
        <code>{node.id}</code>
        <Icon name={copied ? 'check' : 'copy'} size={12} />
      </button>

      <div className={css.body}>
        <DescriptionField
          t={t}
          value={node.data.description ?? ''}
          onChange={(description) =>
            onEdit({
              type: 'patchNode',
              id: node.id,
              patch: { description: description === '' ? undefined : description },
              merge: merge('description'),
            })
          }
          onBlur={props.onSeal}
        />
        <section className={cx(css.field, css.fieldGrow)}>
          <div className={css.label}>
            <span>{t('ins.prompt')}</span>
            <span className={css.count}>
              {[...prompt].length} {t('ins.chars')}
            </span>
          </div>
          <textarea
            ref={promptRef}
            className={cx(ui.textarea, css.prompt)}
            value={prompt}
            placeholder={t('ins.promptPlaceholder')}
            aria-label={t('ins.prompt')}
            data-testid="wl-ins-prompt"
            spellCheck={false}
            onChange={(event) =>
              onEdit({
                type: 'patchNode',
                id: node.id,
                patch: { prompt: event.currentTarget.value },
                merge: merge('prompt'),
              })
            }
            onBlur={props.onSeal}
          />
          <p className={css.help}>{t('ins.promptHint')}</p>
        </section>

        <OutputField
          t={t}
          value={node.data.output}
          suggest={`${node.id}.md`}
          owner={titleOf(node, node.id)}
          onChange={(output) => onEdit({ type: 'patchNode', id: node.id, patch: { output } })}
          request={
            props.outputRequest !== null && idKey(props.outputRequest.node) === key
              ? props.outputRequest
              : null
          }
          onRequestDone={props.onOutputRequestDone}
        />

        <section className={css.field}>
          <div className={css.label}>
            <span>{t('ins.links')}</span>
          </div>
          {incoming.length === 0 && outgoing.length === 0 ? (
            <p className={css.help}>{t('ins.noLinks')}</p>
          ) : (
            <div className={css.links}>
              {incoming.map((edge) => (
                <LinkRow
                  key={edge.id}
                  t={t}
                  edge={edge}
                  direction="in"
                  other={titleOf(findNode(doc, edge.source), edge.source)}
                  back={analysis.backEdges.has(edge.id)}
                  onPick={() => onSelect({ kind: 'edge', id: edge.id })}
                />
              ))}
              {outgoing.map((edge) => (
                <LinkRow
                  key={edge.id}
                  t={t}
                  edge={edge}
                  direction="out"
                  other={titleOf(findNode(doc, edge.target), edge.target)}
                  back={analysis.backEdges.has(edge.id)}
                  onPick={() => onSelect({ kind: 'edge', id: edge.id })}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className={css.foot}>
        {templating ? (
          <form
            className={cx(css.templateForm, ui.rise)}
            onSubmit={(event) => {
              event.preventDefault()
              void props.onSaveTemplate(templateName, node.data).then((ok) => {
                if (ok) setTemplating(false)
              })
            }}
          >
            <input
              className={ui.input}
              value={templateName}
              placeholder={t('tpl.placeholder')}
              aria-label={t('tpl.name')}
              data-testid="wl-template-name"
              // biome-ignore lint/a11y/noAutofocus: 点了「存为模板」下一步就是起名
              autoFocus
              onChange={(event) => setTemplateName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.stopPropagation()
                setTemplating(false)
              }}
            />
            <button type="submit" className={cx(ui.btn, ui.primary)}>
              {t('tpl.save')}
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.icon)}
              aria-label={t('common.cancel')}
              onClick={() => setTemplating(false)}
            >
              <Icon name="x" size={15} />
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              className={cx(ui.btn, ui.soft, ui.small)}
              onClick={() => props.onDuplicate(node.id)}
            >
              <Icon name="copy" size={14} />
              {t('node.duplicate')}
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.soft, ui.small)}
              data-testid="wl-save-template"
              onClick={() => setTemplating(true)}
            >
              <Icon name="bookmark" size={14} />
              {t('node.saveTemplate')}
            </button>
            <span className={ui.grow} />
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small, ui.danger, ui.tip, ui.tipEnd, ui.tipUp)}
              data-tip={t('node.delete')}
              aria-label={t('node.delete')}
              data-testid="wl-delete-node"
              onClick={() => props.onRemoveNode(node.id)}
            >
              <Icon name="trash" size={15} />
            </button>
          </>
        )}
      </footer>
    </aside>
  )
}

/** 一句话描述（给人看：步骤库条目、画布卡片），不进计划。 */
export function DescriptionField(props: {
  t: T
  value: string
  onChange(value: string): void
  onBlur?: () => void
}): React.JSX.Element {
  const { t } = props
  const problem = checkText(props.value, t('ins.description'))
  return (
    <section className={css.field}>
      <div className={css.label}>
        <span>{t('ins.description')}</span>
      </div>
      <input
        className={ui.input}
        value={props.value}
        placeholder={t('ins.descriptionPlaceholder')}
        aria-label={t('ins.description')}
        aria-invalid={problem !== null}
        maxLength={MAX_TEXT_CODEPOINTS}
        data-testid="wl-description"
        // 描述是一行字：换行直接不让打进来。
        onChange={(event) => props.onChange(event.currentTarget.value.replace(/[\r\n]+/gu, ' '))}
        onBlur={props.onBlur}
      />
      {problem !== null && <p className={css.error}>{problem.message}</p>}
    </section>
  )
}

function LinkRow(props: {
  t: T
  edge: WorkflowEdge
  direction: 'in' | 'out'
  other: string
  back: boolean
  onPick: () => void
}): React.JSX.Element {
  const { t, edge } = props
  const when = whenOf(edge)
  return (
    <button type="button" className={css.link} onClick={props.onPick}>
      <span className={css.linkDir}>{props.direction === 'in' ? t('ins.from') : t('ins.to')}</span>
      <span className={css.linkName}>{props.other}</span>
      {props.back && <Icon name="loop" size={12} />}
      {when !== undefined && (
        <span className={css.whenChip} data-when={when} title={when}>
          {when === 'pass' ? t('edge.pass') : when === 'fail' ? t('edge.fail') : when}
        </span>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// 连线
// ─────────────────────────────────────────────────────────────

type WhenMode = 'always' | 'pass' | 'fail' | 'custom'

function whenMode(when: string | undefined): WhenMode {
  if (when === undefined) return 'always'
  return when === 'pass' || when === 'fail' ? when : 'custom'
}

function EdgePanel(props: InspectorProps & { edge: WorkflowEdge }): React.JSX.Element {
  const { t, edge, doc, analysis, onEdit, onSelect } = props
  const when = whenOf(edge)
  const [mode, setMode] = useState<WhenMode>(whenMode(when))
  const [draft, setDraft] = useState(mode === 'custom' ? (when ?? '') : '')
  const source = findNode(doc, edge.source)
  const target = findNode(doc, edge.target)
  const back = analysis.backEdges.has(edge.id)
  /** 最近一次自己交出去的条件：外面的值等于它就不回灌（回灌会吃掉正在打的尾部空格）。 */
  const emitted = useRef(when)
  const merge = `${idKey(edge.source)}->${idKey(edge.target)}:when`

  // 撤销、或在画布上换了一条线：从文档重新取模式与草稿。
  useEffect(() => {
    if (when === emitted.current) return
    emitted.current = when
    const next = whenMode(when)
    setMode((current) => (current === 'custom' && next === 'always' ? current : next))
    if (next === 'custom') setDraft(when ?? '')
  }, [when])

  const setWhen = (value: string | undefined, typing = false): void => {
    emitted.current = value
    onEdit({ type: 'setWhen', id: edge.id, when: value, ...(typing ? { merge } : {}) })
  }

  const condition = draft.trim()
  const customError = mode === 'custom' && condition !== '' ? checkWhen(condition) : null

  const choose = (next: WhenMode): void => {
    setMode(next)
    if (next === 'always') setWhen(undefined)
    if (next === 'pass' || next === 'fail') setWhen(next)
    if (next === 'custom' && condition !== '' && checkWhen(condition) === null) setWhen(condition)
  }

  const verdict = mode === 'custom' ? condition : mode
  return (
    <aside
      className={cx(ui.panel, css.panel)}
      data-testid="wl-inspector"
      aria-label={t('edge.title')}
    >
      <header className={css.head}>
        <span className={css.edgeIcon}>
          <Icon name={back ? 'loop' : 'arrowRight'} size={16} />
        </span>
        <span className={css.headTitle}>{t('edge.title')}</span>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={() => onSelect(null)}
        >
          <Icon name="x" size={15} />
        </button>
      </header>

      <div className={css.body}>
        <div className={css.ends}>
          <button
            type="button"
            className={css.end}
            onClick={() => onSelect({ kind: 'node', id: edge.source })}
          >
            <span className={ui.kind} data-kind={kindOf(edge.source)}>
              <Icon name={kindIcon(kindOf(edge.source))} size={14} />
            </span>
            <span className={css.endName}>{titleOf(source, edge.source)}</span>
          </button>
          <span className={css.endArrow}>
            <Icon name="arrowRight" size={14} />
          </span>
          <button
            type="button"
            className={css.end}
            onClick={() => onSelect({ kind: 'node', id: edge.target })}
          >
            <span className={ui.kind} data-kind={kindOf(edge.target)}>
              <Icon name={kindIcon(kindOf(edge.target))} size={14} />
            </span>
            <span className={css.endName}>{titleOf(target, edge.target)}</span>
          </button>
        </div>

        <section className={css.field}>
          <div className={css.label}>
            <span>{t('edge.when')}</span>
          </div>
          <Segmented<WhenMode>
            label={t('edge.when')}
            value={mode}
            onChange={choose}
            options={[
              { value: 'always', label: t('edge.always') },
              { value: 'pass', label: t('edge.pass') },
              { value: 'fail', label: t('edge.fail') },
              { value: 'custom', label: t('edge.custom') },
            ]}
          />
          {mode === 'custom' && (
            <>
              <textarea
                className={cx(ui.textarea, css.condition, ui.rise)}
                value={draft}
                rows={3}
                placeholder={t('edge.customPlaceholder')}
                aria-label={t('edge.custom')}
                aria-invalid={customError !== null}
                data-testid="wl-edge-custom"
                onChange={(event) => {
                  // 条件要能写进计划里的一句话：换行就地换成空格。
                  const value = event.currentTarget.value.replace(/[\r\n]+/gu, ' ')
                  setDraft(value)
                  const trimmed = value.trim()
                  if (trimmed !== '' && checkWhen(trimmed) === null) setWhen(trimmed, true)
                }}
                onBlur={props.onSeal}
              />
              {customError !== null && <p className={css.error}>{customError.message}</p>}
            </>
          )}
          {mode === 'always' ? (
            <p className={css.help}>{t('edge.hintAlways')}</p>
          ) : verdict === '' ? null : isVerdictWhen(verdict) ? (
            <div className={css.verdict}>
              <p className={css.help}>{t('edge.hintVerdict')}</p>
              <code className={css.verdictCode}>VERDICT: {verdict}</code>
            </div>
          ) : (
            <p className={css.help}>{t('edge.hintJudge')}</p>
          )}
          {back && (
            <p className={css.note}>
              <Icon name="loop" size={13} />
              {t('edge.loop')}
            </p>
          )}
        </section>
      </div>

      <footer className={css.foot}>
        <span className={ui.grow} />
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.danger)}
          data-testid="wl-delete-edge"
          onClick={() => onEdit({ type: 'removeEdge', id: edge.id })}
        >
          <Icon name="trash" size={14} />
          {t('edge.remove')}
        </button>
      </footer>
    </aside>
  )
}
