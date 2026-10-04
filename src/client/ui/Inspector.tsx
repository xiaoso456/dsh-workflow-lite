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
import { canonicalOutput, idKey, isInput, isResource } from '../../shared/model.ts'
import { checkText, checkWhen, isVerdictWhen } from '../../shared/naming.ts'
import { edgeKind, flowEdges, nodeIndex, outputsOf } from '../../shared/resources.ts'
import type {
  NodeData,
  StepNode,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from '../../shared/types.ts'
import type { HostAccess } from '../app/host.ts'
import type { T } from '../i18n.ts'
import { type Edit, findNode, type Selection, whenOf } from '../model/editor.ts'
import { type FocusFile, HandoffField } from './Handoff.tsx'
import hand from './handoff.module.css'
import { Icon } from './Icon.tsx'
import { InputPanel, StepInputsField } from './InputPanel.tsx'
import css from './inspector.module.css'
import { LinkRow } from './LinkRow.tsx'
import { WHEN_COLOR, type WhenKind, whenKind } from './lines.ts'
import { EdgeHead, StepHead } from './NodeHeads.tsx'
import { PreviewCard } from './PreviewCard.tsx'
import { cx, Segmented } from './primitives.tsx'
import { ResourcePanel } from './ResourcePanel.tsx'
import { ResourceEdgeBody, ResourceIcon, StepResourcesField } from './Resources.tsx'
import { stepName } from './resourceUi.ts'
import { lookOf, StepMark } from './StepMark.tsx'
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
  /** 悬停到一个资源：画布高亮用到它的步骤。 */
  onFocusFile: FocusFile
  /** 给资源选文件、文件夹、Skill 时看主机。 */
  host: HostAccess
  /** 标题栏里关闭按钮左边的切换（实例视图里「运行 / 编辑」）；模板编辑不给。 */
  tabs?: React.ReactNode
}

function titleOf(node: WorkflowNode | undefined, fallback: string): string {
  return stepName(node, fallback)
}

export function Inspector(props: InspectorProps): React.JSX.Element | null {
  const { doc, selection } = props
  if (selection.kind === 'node') {
    const node = findNode(doc, selection.id)
    if (node === undefined) return null
    // 换一个节点就换一个面板实例：草稿、"存为模板"表单这些局部状态不该串到别的节点上。
    if (isResource(node)) {
      return (
        <ResourcePanel
          key={idKey(node.id)}
          t={props.t}
          doc={doc}
          node={node}
          host={props.host}
          onEdit={props.onEdit}
          onSelect={props.onSelect}
          onSeal={props.onSeal}
          onFocusFile={props.onFocusFile}
          onRemove={props.onRemoveNode}
          tabs={props.tabs}
        />
      )
    }
    if (isInput(node)) {
      return (
        <InputPanel
          key={idKey(node.id)}
          t={props.t}
          doc={doc}
          node={node}
          onEdit={props.onEdit}
          onSelect={props.onSelect}
          onSeal={props.onSeal}
          onRemove={props.onRemoveNode}
          tabs={props.tabs}
        />
      )
    }
    return <NodePanel key={idKey(node.id)} {...props} node={node} />
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

function NodePanel(props: InspectorProps & { node: StepNode }): React.JSX.Element {
  const { t, node, doc, analysis, onEdit, onSelect } = props
  const merge = (field: string): string => `${idKey(node.id)}:${field}`
  const [templating, setTemplating] = useState(false)
  const [templateName, setTemplateName] = useState(node.id)

  useEffect(() => {
    setTemplating(false)
    setTemplateName(node.id)
  }, [node.id])

  const prompt = node.data.prompt ?? ''
  const key = idKey(node.id)
  // 连接清单只列步骤之间的线；连着资源的线在上面的「资源」里。
  const flow = flowEdges(doc)
  const incoming = flow.filter((edge) => idKey(edge.target) === key)
  const outgoing = flow.filter((edge) => idKey(edge.source) === key)

  return (
    <aside
      className={cx(ui.panel, css.panel)}
      data-testid="wl-inspector"
      aria-label={t('ins.name')}
    >
      <StepHead
        t={t}
        node={node}
        onEdit={onEdit}
        onSeal={props.onSeal}
        extra={props.tabs}
        onClose={() => onSelect(null)}
      />

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
        <PreviewCard
          t={t}
          label={t('ins.prompt')}
          text={prompt}
          name={titleOf(node, node.id)}
          badge={<StepMark look={lookOf(node.id, node.data)} size={15} />}
          meta={`${t('ins.prompt')} · ${[...prompt].length} ${t('ins.chars')}`}
          copyLabel={t('run.copyPrompt')}
          desktop={undefined}
          testId="wl-ins-prompt-card"
          lines={6}
          help={t('ins.promptHint')}
          autoEdit={props.focusPrompt}
          edit={{
            placeholder: t('ins.promptPlaceholder'),
            testId: 'wl-ins-prompt',
            onChange: (value) =>
              onEdit({
                type: 'patchNode',
                id: node.id,
                patch: { prompt: value },
                merge: merge('prompt'),
              }),
            onSeal: props.onSeal,
          }}
        />

        <StepResourcesField
          t={t}
          doc={doc}
          step={node}
          onEdit={onEdit}
          onSelect={onSelect}
          onFocusFile={props.onFocusFile}
        />

        <StepInputsField t={t} doc={doc} step={node} onSelect={onSelect} />

        <section className={css.field} data-testid="wl-links">
          <div className={css.label}>
            <span>{t('ins.links')}</span>
          </div>
          {incoming.length === 0 && outgoing.length === 0 ? (
            <p className={css.help}>{t('ins.noLinks')}</p>
          ) : (
            <>
              {incoming.length > 0 && (
                <div className={css.links}>
                  <p className={css.linkGroup}>{t('ins.from')}</p>
                  {incoming.map((edge) => (
                    <LinkRow
                      key={edge.id}
                      t={t}
                      edge={edge}
                      direction="in"
                      other={findNode(doc, edge.source)}
                      otherId={edge.source}
                      back={analysis.backEdges.has(edge.id)}
                      testId="wl-link-row"
                      onPick={() => onSelect({ kind: 'edge', id: edge.id })}
                    />
                  ))}
                </div>
              )}
              {outgoing.length > 0 && (
                <div className={css.links}>
                  <p className={css.linkGroup}>{t('ins.to')}</p>
                  {outgoing.map((edge) => (
                    <LinkRow
                      key={edge.id}
                      t={t}
                      edge={edge}
                      direction="out"
                      other={findNode(doc, edge.target)}
                      otherId={edge.target}
                      back={analysis.backEdges.has(edge.id)}
                      testId="wl-link-row"
                      onPick={() => onSelect({ kind: 'edge', id: edge.id })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <footer className={css.foot}>
        {templating ? (
          <form
            className={cx(css.templateForm, ui.rise)}
            onSubmit={(event) => {
              event.preventDefault()
              // 模板 = 步骤的 `data` + 它写的文件（作为产出清单，放回画布时再展开成资源卡）。
              const outputs = outputsOf(doc, node.id)
              const data =
                outputs.length === 0
                  ? node.data
                  : { ...node.data, output: canonicalOutput(outputs) }
              void props.onSaveTemplate(templateName, data).then((ok) => {
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

/** 连线两端的小图标：步骤用它的图标，资源用资源图标。 */
export function EndIcon(props: { node: WorkflowNode | undefined; id: string }): React.JSX.Element {
  if (props.node !== undefined && isInput(props.node)) {
    return (
      <span className={hand.askIcon}>
        <Icon name="ask" size={13} />
      </span>
    )
  }
  if (props.node !== undefined && isResource(props.node)) {
    return <ResourceIcon resource={props.node} />
  }
  const step = props.node !== undefined && !isResource(props.node) ? props.node : undefined
  return <StepMark look={lookOf(props.id, step?.data)} size={14} />
}

// ─────────────────────────────────────────────────────────────
// 连线
// ─────────────────────────────────────────────────────────────

function EdgePanel(props: InspectorProps & { edge: WorkflowEdge }): React.JSX.Element {
  const { t, edge, doc, analysis, onEdit, onSelect } = props
  const when = whenOf(edge)
  const [mode, setMode] = useState<WhenKind>(whenKind(when))
  const [draft, setDraft] = useState(mode === 'custom' ? (when ?? '') : '')
  const source = findNode(doc, edge.source)
  const target = findNode(doc, edge.target)
  const back = analysis.backEdges.has(edge.id)
  const kind = edgeKind(nodeIndex(doc), edge)
  /** 最近一次自己交出去的条件：外面的值等于它就不回灌（回灌会吃掉正在打的尾部空格）。 */
  const emitted = useRef(when)
  const merge = `${idKey(edge.source)}->${idKey(edge.target)}:when`

  // 撤销、或在画布上换了一条线：从文档重新取模式与草稿。
  useEffect(() => {
    if (when === emitted.current) return
    emitted.current = when
    const next = whenKind(when)
    setMode((current) => (current === 'custom' && next === 'always' ? current : next))
    if (next === 'custom') setDraft(when ?? '')
  }, [when])

  const setWhen = (value: string | undefined, typing = false): void => {
    emitted.current = value
    onEdit({ type: 'setWhen', id: edge.id, when: value, ...(typing ? { merge } : {}) })
  }

  const condition = draft.trim()
  const customError = mode === 'custom' && condition !== '' ? checkWhen(condition) : null

  const choose = (next: WhenKind): void => {
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
      <EdgeHead
        t={t}
        doc={doc}
        analysis={analysis}
        edge={edge}
        extra={props.tabs}
        onClose={() => onSelect(null)}
      />
      <div className={css.body}>
        <div className={css.ends}>
          <button
            type="button"
            className={css.end}
            onClick={() => onSelect({ kind: 'node', id: edge.source })}
          >
            <EndIcon node={source} id={edge.source} />
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
            <EndIcon node={target} id={edge.target} />
            <span className={css.endName}>{titleOf(target, edge.target)}</span>
          </button>
        </div>

        {kind === 'ask' ? (
          <p className={css.help} data-testid="wl-edge-ask">
            {t('edge.askHint')}
          </p>
        ) : kind === 'write' || kind === 'read' ? (
          <ResourceEdgeBody t={t} edge={edge} kind={kind} onEdit={onEdit} />
        ) : (
          <>
            <section className={css.field}>
              <div className={css.label}>
                <span>{t('edge.when')}</span>
              </div>
              <Segmented<WhenKind>
                label={t('edge.when')}
                value={mode}
                onChange={choose}
                options={[
                  { value: 'always', label: t('edge.always'), color: WHEN_COLOR.always },
                  { value: 'pass', label: t('edge.pass'), color: WHEN_COLOR.pass },
                  { value: 'fail', label: t('edge.fail'), color: WHEN_COLOR.fail },
                  { value: 'custom', label: t('edge.custom'), color: WHEN_COLOR.custom },
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

            <HandoffField
              t={t}
              edge={edge}
              source={titleOf(source, edge.source)}
              onEdit={onEdit}
              onSeal={props.onSeal}
            />
          </>
        )}
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
