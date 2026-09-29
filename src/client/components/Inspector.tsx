/**
 * dsh-workflow-lite — 右栏：整图概览 / 节点属性面板 + 边编辑；编译预览一段。
 *
 * 边是**独立对象**（有自己的 `edge.id`），所以属性面板里对每条入/出边单独给一个
 * `when` 输入框。改 `when` 等于「断开旧边 + 连上新边」——
 * 因为 `edge.id` 的构造式里带 `when`（`<source>-><target>#<when>`），这是宿主定的规则。
 *
 * 版式上，提示词是这张图的**载荷本体**，排在
 * id / 显示名 / 产出之前、占最大面积；未选中节点时展示整图概览，不再是一块死文案
 * 所以本模块的渲染顺序是刻意的，别按"字段重要性"重排回去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/components/Inspector
 */

import { useEffect, useState } from 'react'
import { displayName } from '../../shared/model.ts'
import { checkLabel, checkOutput, checkWhen } from '../../shared/naming.ts'
import type { ValidationProblem, WorkflowEdge, WorkflowNode } from '../../shared/types.ts'
import css from './Inspector.module.css'
import type { Translate } from './Palette.tsx'
import ui from './ui.module.css'

/** 一条边的呈现信息。 */
export interface EdgeView {
  edge: WorkflowEdge
  /** 另一端的节点 id。 */
  other: string
  /**
   * 另一端的**显示名**（`data.label`，没有就是空串）。
   *
   * 右栏这一行与画布卡片必须同一口径（`displayName()`）：同一个节点在画布上叫
   * 「修复（fix）」、在右栏里叫「fix」，人就得多做一次脑内映射。显示名在画布那边
   * 查一次顺手带上，比把整份文档传进右栏只为查一个 label 划算。
   */
  otherLabel: string
  back: boolean
}

/**
 * 选中一条边时右栏要给的东西。
 *
 * 与 `EdgeView` 的差别是**两端都要**：节点那张列表里"另一端"是唯一的（另一边就是当前
 * 节点），而边编辑区要写出 `甲（alpha） → 乙（beta）`。两份显示名同样在 `CanvasView`
 * 里查好，`Inspector` 不拿文档。
 */
export interface EdgeEditorView {
  edge: WorkflowEdge
  /** 源端显示名（`data.label`，没有就是空串）。 */
  sourceLabel: string
  /** 目标端显示名（同上）。 */
  targetLabel: string
  /** 是不是回边（循环里返回的那条），决定要不要写那句说明。 */
  back: boolean
}

/** 未选中节点时展示的整图概览（数据由 CanvasView 现算，**不存盘**）。 */
export interface GraphSummary {
  name: string
  nodes: number
  edges: number
  batches: number
  planId: string
}

/** 属性面板的完整入参（接口冻结）。 */
export interface InspectorProps {
  t: Translate
  node: WorkflowNode | undefined
  /**
   * 选中的那条边。给了它、又没给节点时，右栏整体换成边编辑区（`wl-edge-inspector`）。
   *
   * 这是**新增项**：已有的项一个没改。选中态由画布发起（点节点 / 点边 / 点空白），
   * 右栏只反映，不自己发起导航。
   */
  edge?: EdgeEditorView
  /** 未选中节点时展示的整图概览。 */
  summary: GraphSummary
  /** 当前图上全部四级问题，用来给这个节点挑出属于自己的那几条。 */
  problems: readonly ValidationProblem[]
  incoming: readonly EdgeView[]
  outgoing: readonly EdgeView[]
  onLabel: (value: string) => void
  onOutput: (value: string) => void
  onPrompt: (value: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onSetWhen: (view: EdgeView, to: string) => void
  onDisconnect: (view: EdgeView) => void
}

/** 复制 id 之后显示「已复制」的时长（与编译预览的复制按钮一致）。 */
const COPIED_MS = 1600

/** 属性面板。 */
export function Inspector(props: InspectorProps): React.JSX.Element {
  const { t, node } = props
  const [idCopied, setIdCopied] = useState(false)
  const nodeId = node?.id ?? null

  // 换节点就把「已复制」收起来：否则切到另一个节点，按钮还挂着上一个节点的结果。
  useEffect(() => {
    setIdCopied(false)
  }, [nodeId])

  useEffect(() => {
    if (!idCopied) return
    const timer = setTimeout(() => setIdCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [idCopied])

  if (node === undefined) {
    /*
     * 没选节点时右栏只有一个入口：选中的边 → 边编辑区，什么都没选 → 整图概览。
     *
     * `key` 用 `source->target`（**不含 `when`**）：`when` 是边 id 的一部分，拿它当 key
     * 的话，用户点一下「fail」就会把这一块整个重挂载，正在自定义输入框里的草稿、
     * 以及输入框的焦点都会没（那个"只能敲进一个字符"的 bug 就是同一个根因）。
     */
    if (props.edge === undefined) {
      return <GraphSummaryBlock t={t} summary={props.summary} />
    }
    const view = props.edge
    return (
      <EdgeInspector
        key={`${view.edge.source}->${view.edge.target}`}
        t={t}
        view={view}
        onSetWhen={props.onSetWhen}
        onDisconnect={props.onDisconnect}
      />
    )
  }

  const mine = props.problems.filter((problem) => problem.node === node.id)
  const label = node.data.label ?? ''
  const name = label === '' ? node.id : label
  const output = node.data.output === false ? 'false' : (node.data.output ?? '')
  const prompt = node.data.prompt ?? ''
  const labelProblem = label === '' ? null : checkLabel(label)
  const outputProblem = output === '' || output === 'false' ? null : checkOutput(output)

  /** 复制失败（无剪贴板权限 / 非安全上下文）就静默不动，不把 reject 漏成未捕获。 */
  const copyId = (): void => {
    void navigator.clipboard.writeText(node.id).then(
      () => setIdCopied(true),
      () => undefined,
    )
  }

  return (
    <>
      <section className={css.panel}>
        <div className={ui.panelHead}>
          {/*
            tooltip 给的是**被省略号吃掉的那段文本**：标题栏放的是用户内容（显示名），
            长起来会被截断，而 id 恰恰不是被截的那一项。显示名为空时标题回落到 id，
            这时 tooltip 跟着写 id，别让它空着。
          */}
          <span title={name}>{name}</span>
          <span className={ui.panelHeadSub}>
            {t('panel.counts')} {props.incoming.length} / {props.outgoing.length}
          </span>
        </div>

        <div className={css.form}>
          <label className={ui.field}>
            <span>{t('panel.prompt')}</span>
            <div className={css.promptField}>
              <textarea
                className={ui.textarea}
                data-testid="wl-prompt"
                value={prompt}
                onChange={(event) => props.onPrompt(event.target.value)}
              />
              <span className={css.charCount}>
                {prompt.length} {t('panel.charCount')}
              </span>
            </div>
          </label>
          <p className={ui.muted}>{t('panel.promptHint')}</p>
          {prompt === '' && <p className={ui.problem}>{t('node.missingPrompt')}</p>}

          <div className={ui.field}>
            <span>{t('panel.id')}</span>
            <div className={css.summaryRow}>
              <input
                className={[ui.input, ui.readonly, css.summaryValue].join(' ')}
                value={node.id}
                readOnly
              />
              <button type="button" className={ui.button} onClick={copyId}>
                {idCopied ? t('panel.idCopied') : t('panel.copyId')}
              </button>
            </div>
          </div>

          <label className={ui.field}>
            <span>{t('panel.label')}</span>
            <input
              className={ui.input}
              data-testid="wl-label"
              value={label}
              placeholder={node.id}
              onChange={(event) => props.onLabel(event.target.value)}
            />
          </label>
          {labelProblem !== null && <p className={ui.problem}>{labelProblem.message}</p>}

          <label className={ui.field}>
            <span>{t('panel.output')}</span>
            <input
              className={ui.input}
              data-testid="wl-output"
              value={output}
              placeholder={t('panel.outputHint')}
              onChange={(event) => props.onOutput(event.target.value)}
            />
          </label>
          {outputProblem !== null && <p className={ui.problem}>{outputProblem.message}</p>}

          {mine.map((problem) => (
            <p
              key={`${problem.code}:${problem.message}`}
              className={[
                ui.problem,
                problem.level === 'warning' ? ui.problemWarn : '',
                problem.level === 'hint' ? ui.problemHint : '',
              ].join(' ')}
            >
              {problem.message}
            </p>
          ))}

          <div className={css.nodeActions}>
            <button type="button" className={ui.button} onClick={props.onDuplicate}>
              {t('node.duplicate')}
            </button>
            <button
              type="button"
              className={[ui.button, ui.buttonDanger].join(' ')}
              onClick={props.onDelete}
            >
              {t('node.remove')}
            </button>
          </div>
        </div>
      </section>

      <section>
        <div className={ui.panelHead}>
          <span>{t('panel.edgesIn')}</span>
          <span className={ui.panelHeadSub}>{props.incoming.length}</span>
        </div>
        <EdgeList t={t} views={props.incoming} dir="in" />
      </section>

      <section>
        <div className={ui.panelHead}>
          <span>{t('panel.edgesOut')}</span>
          <span className={ui.panelHeadSub}>{props.outgoing.length}</span>
        </div>
        <EdgeList t={t} views={props.outgoing} dir="out" />
      </section>
    </>
  )
}

/**
 * 整图概览（未选中节点时）。
 *
 * 这一块取代原来的死文案：右栏在"没选节点"时也该回答"我现在看的是哪张图、
 * 有多大、编译出来是哪个 planId"。`planId` 取当前编译结果，没编译过就没有值。
 */
function GraphSummaryBlock(props: { t: Translate; summary: GraphSummary }): React.JSX.Element {
  const { t, summary } = props
  const named = summary.name !== ''
  return (
    <section className={css.panel} data-testid="wl-graph-summary">
      <div className={ui.panelHead}>
        <span>{t('panel.summary')}</span>
      </div>
      <div className={css.graphSummary}>
        <SummaryRow
          label={t('picker.label')}
          value={named ? summary.name : t('picker.empty')}
          empty={!named}
        />
        <SummaryRow label={t('panel.nodes')} value={String(summary.nodes)} />
        <SummaryRow label={t('panel.edges')} value={String(summary.edges)} />
        <SummaryRow label={t('panel.batches')} value={String(summary.batches)} />
        <SummaryRow
          label={t('plan.planId')}
          // 没编译过就没有 id。占位刻意用 ASCII 连字符：本仓库源码禁 em-dash。
          value={summary.planId === '' ? '-' : summary.planId}
        />
      </div>
    </section>
  )
}

/**
 * 概览里的一行：左键右值。
 *
 * `.summaryRow` / `.summaryValue` 是**通用的一行 / 一格**，节点 id 那一行也复用它们
 * （类名就这几个，不再自造新类）。
 */
function SummaryRow(props: { label: string; value: string; empty?: boolean }): React.JSX.Element {
  return (
    <div className={css.summaryRow}>
      <span className={css.summaryKey}>{props.label}</span>
      <span
        className={[css.summaryValue, props.empty === true ? css.empty : ''].join(' ')}
        title={props.value}
      >
        {props.value}
      </span>
    </div>
  )
}

/**
 * 一条边的列表组（**只读信息**）。
 *
 * 用户看过这一块之后定的规矩："点击入边出边的时候，不要切换节点啊。点击图中的时候切换就好"。
 * 所以这些行不再是按钮、没有 click handler、没有 hover 态——它们是给人看的边清单，
 * 选中哪条边只能在画布上点那条边。真正能改这条边的地方在边编辑区（`EdgeInspector`）。
 */
function EdgeList(props: {
  t: Translate
  views: readonly EdgeView[]
  dir: 'in' | 'out'
}): React.JSX.Element {
  if (props.views.length === 0) return <p className={ui.muted}>{props.t('panel.noEdges')}</p>
  return (
    <ul className={css.edgeList}>
      {props.views.map((view) => (
        <li key={`${view.edge.id}|${view.other}`}>
          <EdgeInfoRow t={props.t} view={view} dir={props.dir} />
        </li>
      ))}
    </ul>
  )
}

/**
 * 一行边的**只读信息**：方向 + 另一端「显示名（id）」+ `条件 <值>` + 回边小标。
 *
 * 三个字段都不能截断（"不许出现省略号"）：最宽的 `显示名（id）` 取**自然宽度**
 * （`flex: 0 0 auto`），宁可让整行溢出也不把字吃掉。320px 右栏里算下来约 210px，放得下；
 * 放不下的情形应该去改排布，而不是靠截断掩盖。
 */
function EdgeInfoRow(props: {
  t: Translate
  view: EdgeView
  dir: 'in' | 'out'
}): React.JSX.Element {
  const when = props.view.edge.data?.when ?? ''
  // 与画布卡片同一口径：有显示名就写「显示名（id）」，没有就只剩 id。
  const name = displayName(props.view.other, props.view.otherLabel)
  return (
    <div className={[css.edgeRow, props.view.back ? css.edgeRowBack : ''].join(' ')}>
      {/* 方向是给眼睛的：所在的那一段标题已经说了入边/出边，别再让读屏软件念一遍。 */}
      <span className={props.dir === 'in' ? css.dirIn : css.dirOut} aria-hidden="true">
        {props.dir === 'in' ? '←' : '→'}
      </span>
      <span className={css.edgeName} title={name}>
        {name}
      </span>
      {/*
        条件是**可见文字**，不再是一个输入框：值的含义（空串 = 无条件）写在同一个格子里，
        不用靠 `placeholder` / `title` 猜。
      */}
      <span className={css.whenLabel}>
        {props.t('panel.whenLabel')} {when === '' ? props.t('panel.whenNone') : when}
      </span>
      {props.view.back && (
        <span className={css.tagBack} title={props.t('panel.edgeBack')}>
          {props.t('panel.edgeBackShort')}
        </span>
      )}
    </div>
  )
}

/**
 * 边编辑区（选中一条边时占满右栏）。
 *
 * 三件事：两端各是谁（带方向）、条件怎么定、把这条边断开。
 *
 * 条件是**点选式**的（无条件 / pass / fail / 自定义…）：改 `when` 等于**换一条边**
 * （`when` 是边 id 的一部分），所以它不能是"每敲一个字就提交一次"的输入框——
 * 那样列表按 id 重排、整块重挂载、输入框当场失焦，只能敲进一个字符（实测的 bug）。
 * 自定义那一路改成**失焦 / 回车才提交**，并且本组件的 `key` 不含 `when`。
 */
function EdgeInspector(props: {
  t: Translate
  view: EdgeEditorView
  onSetWhen: (view: EdgeView, to: string) => void
  onDisconnect: (view: EdgeView) => void
}): React.JSX.Element {
  const { t, view } = props
  const edge = view.edge
  const committed = edge.data?.when ?? ''
  /*
   * 自定义编辑态：`null` = 还没进编辑（显示点选格），字符串 = 正在编辑的草稿。
   * 空串是合法草稿（＝无条件），所以不能用空串表示"不在编辑"。
   */
  const [draft, setDraft] = useState<string | null>(null)
  const draftProblem = draft === null || draft === '' ? null : checkWhen(draft)

  /*
   * `onSetWhen` / `onDisconnect` 沿用既有的 `EdgeView` 契约（语义不改），
   * 这里就地拼一份：边编辑区只有一个"另一端"，取目标端。
   */
  const asView: EdgeView = {
    edge,
    other: edge.target,
    otherLabel: view.targetLabel,
    back: view.back,
  }

  /** 改成一个固定值（无条件 / pass / fail）：点一下立即生效。 */
  const commitFixed = (value: string): void => {
    setDraft(null)
    if (value !== committed) props.onSetWhen(asView, value)
  }

  /** 自定义值：回车或失焦时提交。非法值**绝不写进图**（那会造出保存级破损），就地报红。 */
  const commitDraft = (): void => {
    if (draft === null) return
    if (draft !== '' && checkWhen(draft) !== null) return
    setDraft(null)
    if (draft !== committed) props.onSetWhen(asView, draft)
  }

  /** 失焦：合法就提交；非法就放弃这次编辑（退回点选态），不留一个卡住的红框。 */
  const blurDraft = (): void => {
    if (draft === null) return
    if (draft !== '' && checkWhen(draft) !== null) {
      setDraft(null)
      return
    }
    commitDraft()
  }

  /* 三个固定值之外的非空值就是"自定义"：这时那一格显示**当前值**并高亮。 */
  const isCustom = committed !== '' && committed !== 'pass' && committed !== 'fail'
  /* 点选格复用站点统一按钮样式，只给"当前值"那一格叠一层强调色（全站唯一的 `--wl-accent`）。 */
  const optionClass = (active: boolean): string =>
    [ui.button, active ? css.condActive : ''].filter((name) => name !== '').join(' ')

  return (
    <section className={css.panel} data-testid="wl-edge-inspector">
      <div className={ui.panelHead}>
        <span>{t('panel.edgeTitle')}</span>
      </div>

      <div className={css.form}>
        <div className={ui.field}>
          <span>{t('panel.edgeEnds')}</span>
          {/* 两端带方向：`甲（alpha） → 乙（beta）`，显示名与画布卡片同一口径。 */}
          <div className={css.edgeEnds}>
            <span className={css.edgeEnd}>{displayName(edge.source, view.sourceLabel)}</span>
            <span className={css.edgeArrow} aria-hidden="true">
              →
            </span>
            <span className={css.edgeEnd}>{displayName(edge.target, view.targetLabel)}</span>
          </div>
        </div>

        {view.back && <p className={ui.muted}>{t('panel.edgeBack')}</p>}

        <div className={ui.field}>
          <span>{t('panel.whenLabel')}</span>
          <div className={css.condRow} data-testid="wl-edge-condition">
            <button
              type="button"
              className={optionClass(committed === '')}
              data-testid="wl-edge-condition-none"
              onClick={() => commitFixed('')}
            >
              {t('panel.whenNone')}
            </button>
            <button
              type="button"
              className={optionClass(committed === 'pass')}
              data-testid="wl-edge-condition-pass"
              onClick={() => commitFixed('pass')}
            >
              {t('panel.edgePass')}
            </button>
            <button
              type="button"
              className={optionClass(committed === 'fail')}
              data-testid="wl-edge-condition-fail"
              onClick={() => commitFixed('fail')}
            >
              {t('panel.edgeFail')}
            </button>
            {draft === null ? (
              <button
                type="button"
                className={optionClass(isCustom)}
                data-testid="wl-edge-condition-custom"
                title={t('panel.when')}
                onClick={() => setDraft(isCustom ? committed : '')}
              >
                {isCustom ? committed : t('panel.whenCustom')}
              </button>
            ) : (
              <input
                className={[ui.input, css.condInput].join(' ')}
                data-testid="wl-edge-custom-input"
                list="workflow-lite-when"
                // biome-ignore lint/a11y/noAutofocus: 点「自定义…」就是在要求输入，光标就该落在这里
                autoFocus
                value={draft}
                placeholder={t('panel.whenCustom')}
                title={draftProblem === null ? t('panel.when') : draftProblem.message}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={blurDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitDraft()
                    return
                  }
                  // Esc 放弃这次编辑：不动文档，退回点选态。
                  if (event.key === 'Escape') setDraft(null)
                }}
              />
            )}
          </div>
        </div>
        {draftProblem !== null && <p className={ui.problem}>{draftProblem.message}</p>}

        <div className={css.nodeActions}>
          <button
            type="button"
            className={[ui.button, ui.buttonDanger].join(' ')}
            data-testid="wl-edge-disconnect"
            aria-label={t('canvas.deleteEdge')}
            onClick={() => props.onDisconnect(asView)}
          >
            {t('canvas.deleteEdge')}
          </button>
        </div>
      </div>
    </section>
  )
}

/**
 * 编译预览（右栏一段）。
 *
 * **刻意不做底部抽屉**：会话页底部浮着输入框，抽屉一展开就被它盖住。放在右栏里
 * 跟着列一起滚动，既不会被盖，也让"这一个节点 / 这一张图的东西"都在同一条竖线上。
 */
export function PlanBlock(props: {
  t: Translate
  plan: { text: string; blocked: boolean; id: string } | null
  tab: 'dispatch' | 'full'
  onTab: (tab: 'dispatch' | 'full') => void
}): React.JSX.Element {
  const { t, plan } = props
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  /** planId 复制成功后的短暂反馈（与整份计划的 `copied` 各管各的）。 */
  const [planIdCopied, setPlanIdCopied] = useState(false)
  useEffect(() => {
    if (!planIdCopied) return
    const timer = setTimeout(() => setPlanIdCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [planIdCopied])

  /** 导出 = 触发浏览器下载，插件自己不写盘。只给整卷版。 */
  const exportFull = (): void => {
    if (plan === null || plan.blocked) return
    const blob = new Blob([plan.text], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `workflow-plan-${plan.id === '' ? 'latest' : plan.id}.md`
    link.click()
    // 撤销要等浏览器真的把下载接过去；同步撤销会掐断下载。
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <section className={css.planBlock}>
      <div className={ui.panelHead}>
        <span>{t('plan.title')}</span>
        <div className={css.summaryRow}>
          {/*
            planId 是内容哈希，也是用户去 `.dispatch/<图名>/<planId>/<节点id>.md` 找载荷的
            **唯一坐标**——以前它只是块灰色死文本，只能手抄（独立审计 A18）。
            现在点一下写进剪贴板，并用节点 id 那套同一句 `panel.idCopied` 给 1.6s 反馈。
          */}
          {plan !== null && plan.id !== '' && (
            <button
              type="button"
              className={[ui.button, ui.buttonGhost, css.planMeta].join(' ')}
              data-testid="wl-plan-id"
              title={`${t('plan.planId')} ${plan.id}`}
              onClick={() => {
                void navigator.clipboard.writeText(plan.id).then(
                  () => setPlanIdCopied(true),
                  () => undefined,
                )
              }}
            >
              <span className={ui.srOnly}>{t('plan.planId')} </span>
              {planIdCopied ? t('panel.idCopied') : plan.id}
            </button>
          )}
          {/*
            `role="tablist"` / `role="tab"` / `aria-selected`：这两格在视觉上一直是
            二选一的页签，但读屏软件以前只看到两个无名按钮，读不出"当前选的是哪一版"。
            `data-testid` 是给测试与语料脚本的锚点：以前只能按中文文案定位，
            改一个字就打断它们。
          */}
          <div className={ui.tabs} role="tablist">
            {/*
              两个 tab 的差别（路径 vs 正文）只写在这两个词里，光看标题分不出来，
              所以各挂一条 `title` 说明；文案在 locales 里，别在这里另写一份。
            */}
            <button
              type="button"
              role="tab"
              aria-selected={props.tab === 'dispatch'}
              data-testid="wl-plan-tab-dispatch"
              className={props.tab === 'dispatch' ? ui.tabActive : ui.tab}
              title={t('plan.dispatchHint')}
              onClick={() => props.onTab('dispatch')}
            >
              {t('plan.dispatch')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={props.tab === 'full'}
              data-testid="wl-plan-tab-full"
              className={props.tab === 'full' ? ui.tabActive : ui.tab}
              title={t('plan.fullHint')}
              onClick={() => props.onTab('full')}
            >
              {t('plan.full')}
            </button>
          </div>
        </div>
      </div>

      {plan !== null && !plan.blocked && (
        <div className={css.planActions}>
          <button
            type="button"
            className={ui.button}
            data-testid="wl-plan-copy"
            onClick={() => {
              // 复制失败（无剪贴板权限 / 非安全上下文）就静默不动：
              // 漏出去的 reject 会变成控制台里的一条未捕获错误。
              void navigator.clipboard.writeText(plan.text).then(
                () => setCopied(true),
                () => undefined,
              )
            }}
          >
            {copied ? t('plan.copied') : t('plan.copy')}
          </button>
          {props.tab === 'full' && (
            <button type="button" className={ui.button} onClick={exportFull}>
              {t('plan.export')}
            </button>
          )}
        </div>
      )}

      {plan === null ? (
        <p className={ui.muted}>{t('plan.empty')}</p>
      ) : plan.blocked ? (
        <p className={ui.problem}>{t('plan.blocked')}</p>
      ) : (
        <pre className={css.plan} data-testid="wl-plan">
          {plan.text}
        </pre>
      )}
    </section>
  )
}
