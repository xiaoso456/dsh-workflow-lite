/**
 * dsh-workflow-lite — 左栏：节点库（筛选 / 折叠 / 拖源） + 校验面板。
 *
 * 节点库有两个来源，**分节展示不混**：内置 node（`presets.ts`）与自定义 node
 * （`templates/nodes/*.json`）。**两个分节都可折叠**；两节**内部都是平铺的一层**。
 * 自定义节点**不再按名字前缀分二级组**（用户明确说不要二级分类）——入参那边仍是
 * 「按前缀分好组」的形状，这里只把 items 摊平，于是内置与模板在界面上同处一个层级。
 *
 * 条目**拖**进画布落在指针处，**点**则落在视野中心——点不是拖的退化写法，它是键盘
 * 与触屏唯一的路径（`draggable` 只在指针设备上成立），所以两条都得留着。
 *
 * 折叠状态是**受控**的（`collapsed` / `onToggleGroup`）：谁持有那份 localStorage 读写
 * 谁就持有状态，这里只解释「分节键」与「此刻该不该展开」。分节键、折叠表解析、筛选匹配
 * 全是 `presets.ts` 里的纯函数（有单测）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/components/Palette
 */

import { Fragment, type ReactNode, useId, useRef, useState } from 'react'
import { checkName } from '../../shared/naming.ts'
import type { TemplateEntry, ValidationLevel, ValidationProblem } from '../../shared/types.ts'
import { DND_MIME, type DragPayload, encodeDragPayload } from '../core/dnd.ts'
import type { LocaleKey } from '../core/locales.ts'
import {
  isFiltering,
  isGroupExpanded,
  matchesFilter,
  type NodePreset,
  type PaletteSource,
  sectionKey,
} from '../core/presets.ts'
import css from './Palette.module.css'
import ui from './ui.module.css'

/** 一条校验问题在面板上的呈现。 */
export interface VerifyEntry {
  key: string
  level: ValidationLevel
  message: string
  /** 归属的节点 id（有归属时才能「定位」）。 */
  node?: string
}

/** 词典函数。 */
export type Translate = (key: LocaleKey) => string

/** 把 host 给的四级问题摊成面板条目（`key` 用于 React 列表，保持稳定）。 */
export function toVerifyEntries(problems: readonly ValidationProblem[]): VerifyEntry[] {
  return problems.map((problem, index) => ({
    key: `${problem.level}:${problem.code}:${problem.node ?? ''}:${problem.edge ?? ''}:${index}`,
    level: problem.level,
    message: problem.message,
    ...(problem.node === undefined ? {} : { node: problem.node }),
  }))
}

const LEVEL_ORDER: readonly ValidationLevel[] = ['save', 'compile', 'warning', 'hint']

const LEVEL_CLASS: Record<ValidationLevel, string> = {
  save: css.verifySave,
  compile: css.verifyCompile,
  warning: css.verifyWarning,
  hint: css.verifyHint,
}

/** 级别标签的词典键。 */
function levelKey(level: ValidationLevel): LocaleKey {
  switch (level) {
    case 'save':
      return 'verify.level.save'
    case 'compile':
      return 'verify.level.compile'
    case 'warning':
      return 'verify.level.warning'
    default:
      return 'verify.level.hint'
  }
}

/**
 * 校验面板：可折叠。折叠时只占一行（总数 + 各级别计数），展开时是四级列表。
 *
 * 有归属的问题点一下选中那个节点。展开态可以受控（`expanded` / `onToggle`），
 * 不传就自管——画布那边一直是不传的调法，别为了折叠逼它加状态。
 */
export function ValidationPanel(props: {
  t: Translate
  problems: readonly ValidationProblem[]
  onLocate: (node: string) => void
  /** 受控展开态；不传则自管，默认「有 save / compile 级问题就展开」。 */
  expanded?: boolean
  onToggle?: (expanded: boolean) => void
}): React.JSX.Element {
  const { t } = props
  const entries = toVerifyEntries(props.problems).sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  )
  const errors = entries.filter(
    (entry) => entry.level === 'save' || entry.level === 'compile',
  ).length
  const warnings = entries.filter((entry) => entry.level === 'warning').length
  const hints = entries.filter((entry) => entry.level === 'hint').length
  // 阻塞级问题（保存级 / 编译级）在不在，决定这块默认是展开还是收起。
  const blocking = errors > 0
  // 用户手动拨过就以他的选择为准，**但**「有没有阻塞级问题」一变就作废：
  // 一次收起不该把后来才冒出来的错误永久藏住（新错误出现时必须自己弹开）。
  const [manual, setManual] = useState<{ blocking: boolean; expanded: boolean } | null>(null)
  const expanded =
    props.expanded ?? (manual !== null && manual.blocking === blocking ? manual.expanded : blocking)
  // id 由 React 生成：同一个文档里多挂一个校验面板也不会撞 aria-controls。
  const bodyId = useId()
  const toggle = (): void => {
    if (props.onToggle !== undefined) props.onToggle(!expanded)
    else setManual({ blocking, expanded: !expanded })
  }
  return (
    <section data-testid="wl-verify">
      <div className={ui.panelHead}>
        <button
          type="button"
          className={css.verifyToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          title={t(expanded ? 'verify.collapse' : 'verify.expand')}
          onClick={toggle}
        >
          <span className={css.chevron} aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          <span>{t('verify.title')}</span>
        </button>
        <span className={[ui.panelHeadSub, css.verifyMeta].join(' ')}>
          <span data-testid="wl-verify-count">{entries.length}</span>
          {!expanded && errors > 0 && (
            <span className={[css.verifyLevel, css.verifySave].join(' ')}>
              {t('verify.errors')} {errors}
            </span>
          )}
          {!expanded && warnings > 0 && (
            <span className={[css.verifyLevel, css.verifyWarning].join(' ')}>
              {t('verify.warnings')} {warnings}
            </span>
          )}
          {!expanded && hints > 0 && (
            <span className={[css.verifyLevel, css.verifyHint].join(' ')}>
              {t('verify.hints')} {hints}
            </span>
          )}
          {!expanded && entries.length === 0 && <span>{t('verify.ok')}</span>}
        </span>
      </div>
      <div id={bodyId} hidden={!expanded}>
        {entries.length === 0 ? (
          <p className={css.empty}>{t('verify.ok')}</p>
        ) : (
          <ul className={css.verifyList}>
            {entries.map((entry) => (
              <li key={entry.key}>
                {entry.node === undefined ? (
                  <span className={css.verifyItem}>
                    <span className={[css.verifyLevel, LEVEL_CLASS[entry.level]].join(' ')}>
                      {t(levelKey(entry.level))}
                    </span>
                    <span className={css.verifyText}>{entry.message}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className={[css.verifyItem, css.verifyItemClickable].join(' ')}
                    title={t('verify.locate')}
                    onClick={() => props.onLocate(entry.node ?? '')}
                  >
                    <span className={[css.verifyLevel, LEVEL_CLASS[entry.level]].join(' ')}>
                      {t(levelKey(entry.level))}
                    </span>
                    <span className={css.verifyText}>
                      <code>{entry.node}</code> {entry.message}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/**
 * 键盘激活一个节点库条目：`Enter` / `Space` 走"加一个"这条路。
 *
 * **鼠标点击不加节点。** 用户明确要求过「节点模板应当拖动进画布，而不是点击进画布」，
 * 所以这些条目没有 `click` handler——拖是给指针的那条路，而键盘没有拖，于是把同一个
 * 加节点动作挂在按键上（`preventDefault` 顺带吃掉浏览器由按键合成的那次 `click`）。
 */
function activateByKeyboard(add: () => void) {
  return (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    add()
  }
}

/** 节点库的 props。 */
export interface PaletteProps {
  t: Translate
  disabled: boolean
  /** 内置 node：**平铺列表**（节内不再按角色分组，但整节本身可折叠）。 */
  presets: readonly NodePreset[]
  /**
   * 自定义 node：**平铺的条目列表**（一层，不再有二级分类）。
   *
   * 从前这里是「按模板名前缀分好组」的形状，面板拿到后还得自己摊平——那层分组是用户明确
   * 说不想要的东西，所以分组本身连同它的工具一起删了，上一层的入参也改成平铺。
   */
  templates: readonly TemplateEntry[]
  /** 已折叠的键：只有两个分节键（二级分组的组键已不再产生）。 */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  filter: string
  onFilter: (value: string) => void
  /**
   * 加一个到图里（拖放的落点由调用方给；缺省落在视口中心）。
   *
   * 只有**拖放**与**键盘激活**会走到这里：条目本身没有 `click` handler。
   */
  onAddPreset: (preset: NodePreset) => void
  onAddTemplate: (entry: TemplateEntry) => void
  /** 空白节点：id 由面板内输入框给出。 */
  onCreateBlank: (id: string) => void
  /**
   * 一次性把折叠状态整份换掉（「全部展开 / 全部收起」用）。
   *
   * 刻意不拆成"逐个 `onToggleGroup`"：逐个会发出 N 次状态更新、写 N 次 localStorage，
   * 中间态还会被渲染出来。键清单在面板这层才知道，所以由面板算好整份交出去。
   */
  onSetCollapsed: (collapsed: readonly string[]) => void
}

/**
 * 一个可折叠分节：分节头（chevron + 分节名 + 项数）与分节体。内置与自定义两节共用。
 *
 * 分节头是**原生 button**（整行可点），不是一行不可点的标签。上一版这一节除了一行文字
 * 什么都没有，点哪儿都没反应，用户因此问「怎么不支持展开收起」。
 */
function PaletteSection(props: {
  t: Translate
  source: PaletteSource
  /** 分节名的词典键（`palette.builtin` / `palette.disk`）。 */
  labelKey: LocaleKey
  /** 项数文案；`null` = 这一节没有项，项数不显示（写个 0 只是噪声）。 */
  count: string | null
  collapsed: readonly string[]
  filtering: boolean
  onToggleGroup: (key: string) => void
  children: ReactNode
}): React.JSX.Element {
  const key = sectionKey(props.source)
  const expanded = isGroupExpanded(key, props.collapsed, props.filtering)
  // 折起来时内容**从 DOM 里消失**（而不是 `hidden`）：否则 tab 顺序里还留着一串
  // 看不见的按钮。外层那个 div 留着，好让 `aria-controls` 永远指得到东西。
  const bodyId = `wl-section-body-${props.source}`
  return (
    <>
      <button
        type="button"
        className={css.sectionHead}
        data-testid={`wl-section-toggle-${props.source}`}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => props.onToggleGroup(key)}
      >
        <span className={css.chevron} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        {/*
          分节名单独一格：`wl-section-*` 钩子挂在这个 span 上，它的 `textContent` 必须
          **恰好**是分节名。项数在**另一个** span 里，别并进来。
        */}
        <span className={css.sectionLabel} data-testid={`wl-section-${props.source}`}>
          {props.t(props.labelKey)}
        </span>
        {props.count !== null && <span className={css.sectionCount}>{props.count}</span>}
      </button>
      <div id={bodyId}>{expanded && props.children}</div>
    </>
  )
}

/** 节点库。 */
export function Palette(props: PaletteProps): React.JSX.Element {
  const { t, disabled } = props
  const filtering = isFiltering(props.filter)
  /*
   * 筛选词打**显示名与机器 id**两样：内置 node 是词典里的显示名 + preset id
   *（条目上也确实把这个 id 等宽显示出来了，用户看得到就会照着敲），
   * 自定义 node 是模板名。
   */
  const presetHits = props.presets.filter((preset) =>
    matchesFilter(`${t(preset.labelKey)} ${preset.id}`, props.filter),
  )
  /*
   * 模板**直接平铺**（入参就已经是一列条目）：用户明确说不要二级分类，
   * 分组既不参与渲染，也不进折叠表。
   */
  const templateHits = props.templates.filter((entry) => matchesFilter(entry.name, props.filter))
  const noMatch = filtering && presetHits.length === 0 && templateHits.length === 0

  /**
   * 项数文案：不筛时是总数，筛的时候是「命中数 / 总数」，口径与从前一致（用户要能看出
   * 这一节还有多少没显示出来）。总数是 0 就整格不显示（写个 0 只是噪声）。
   */
  const countText = (hits: number, total: number): string | null => {
    if (total === 0) return null
    return filtering ? `${hits} / ${total}` : `${total}`
  }
  const presetTotal = props.presets.length
  const templateTotal = props.templates.length

  /**
   * 「全部收起 / 全部展开」的折叠对象：**只剩两个分节键**。
   *
   * 二级分组去掉之后就没有组键了（前缀组不再渲染）；折叠表里可能还留着上一版写下的
   * `disk:exec` 一类的旧键，它们不再对应任何东西，自然也不会生效。
   */
  const sectionKeys = [sectionKey('builtin'), sectionKey('disk')]
  /*
   * 「全都折起来了」这件事只在**没在筛选**时才可能成立：筛选态下 `isGroupExpanded`
   * 一律返回 true（命中的必须当场可见）。原来不看 `filtering`，于是筛出结果时两个
   * 分节明明都是 ▾、按钮却写着「全部展开」——文案在陈述一件与眼前事实相反的事。
   */
  const allCollapsed = !filtering && sectionKeys.every((key) => props.collapsed.includes(key))

  const dragGhostRef = useRef<HTMLDivElement | null>(null)
  const blankInputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)

  /**
   * 把条目装进 dataTransfer。载荷的编解码归 `core/dnd.ts`，这里只负责装车；
   * 拖拽影像用那个常驻的空壳（`dragGhostRef`），`setDragImage` 只在拖拽开始那一瞬抓像素。
   */
  const startDrag = (
    event: React.DragEvent<HTMLButtonElement>,
    payload: DragPayload,
    label: string,
  ): void => {
    const transfer = event.dataTransfer
    transfer.setData(DND_MIME, encodeDragPayload(payload))
    // 自定义 MIME 只有本插件认；text/plain 是给外部（别的应用、手写脚本）的回落。
    transfer.setData('text/plain', label)
    transfer.effectAllowed = 'copy'
    const ghost = dragGhostRef.current
    if (ghost !== null) {
      ghost.textContent = label
      transfer.setDragImage(ghost, 12, 16)
    }
  }

  /** 新建空白节点：id 先过 `checkName`，不合法就地红字，绝不让坏 id 进文档。 */
  const submitBlank = (): void => {
    const id = draft.trim()
    if (id === '') return
    const problem = checkName(id)
    if (problem !== null) {
      setNameError(problem.message)
      return
    }
    setNameError(null)
    setDraft('')
    props.onCreateBlank(id)
  }

  const presetItem = (preset: NodePreset): React.JSX.Element => {
    const label = t(preset.labelKey)
    /*
     * 条目是**拖源**，不是"点一下就加进来"的按钮：`title` 与 `aria-label` 只说拖，
     * 机器 id 让 `aria-label` 一起念出来。条目上**没有拖拽把手**——"能拖"由光标与
     * 悬停的抬起表达，那个盲文字符只是一段噪声。
     */
    const hint = `${label}（${preset.id}），${t('palette.dragHint')}`
    return (
      <button
        type="button"
        /* 两列网格里的那一版条目：显示名要先留住，机器 id 先让位（见样式文件）。 */
        className={[css.item, css.itemPreset].join(' ')}
        data-testid={`wl-item-preset-${preset.id}`}
        draggable={!disabled}
        disabled={disabled}
        title={`${label}，${t('palette.dragHint')}`}
        aria-label={hint}
        onKeyDown={activateByKeyboard(() => props.onAddPreset(preset))}
        onDragStart={(event) => startDrag(event, { kind: 'preset', id: preset.id }, label)}
      >
        <span className={css.itemName}>{label}</span>
        {/* 两列网格的格子里放不下长 id（`implement` / `review` / `report` 会截成 `impl…`），
            所以截断这件事得能恢复：指到 id 上给全文。 */}
        <span className={css.itemId} title={preset.id}>
          {preset.id}
        </span>
      </button>
    )
  }

  const templateItem = (entry: TemplateEntry): React.JSX.Element => {
    // 坏模板拖不得也加不得：它的 data 本体读不出来，进去只能得到一个空节点。
    const invalid = entry.invalid === true
    const blocked = disabled || invalid
    const title = invalid ? (entry.reason ?? t('palette.invalid')) : entry.name
    const hint = invalid ? title : `${title}，${t('palette.dragHint')}`
    return (
      <button
        type="button"
        className={css.item}
        data-testid={`wl-item-template-${entry.name}`}
        draggable={!blocked}
        disabled={blocked}
        title={hint}
        aria-label={hint}
        onKeyDown={activateByKeyboard(() => props.onAddTemplate(entry))}
        onDragStart={(event) =>
          startDrag(event, { kind: 'template', name: entry.name }, entry.name)
        }
      >
        <span className={css.itemName}>{entry.name}</span>
        {invalid && <span className={css.itemBad}>!</span>}
      </button>
    )
  }

  return (
    <section className={css.library} data-testid="wl-library">
      <div className={ui.panelHead}>
        <span>{t('palette.title')}</span>
      </div>
      {/*
        常驻说明收成一句：面板头下面这行每多一行，条目就少露一行，而这一栏在窄窗只有
        一百来像素高。留下的这句是「怎么连线」——它别处再没有可见的家（原先只写在画布容器的
        `title` 里，而 `title` 对触屏与键盘用户不弹）；「拖到画布放置」那句仍在每个条目的
        `aria-label` 与 `title` 里。
      */}
      <p className={css.panelHint} data-testid="wl-palette-hint">
        {t('palette.connectHint')}
      </p>

      {/*
        筛选行与「节点 id 新建」行的共同外壳：宽窗下两行各占一行（普通块级容器，
        不改变任何既有布局），窄窗下并成一行，见样式文件末尾的媒体查询。
      */}
      <div className={css.shell}>
        <div className={css.filterRow}>
          <input
            type="text"
            className={ui.input}
            data-testid="wl-library-filter"
            value={props.filter}
            placeholder={t('palette.filter')}
            aria-label={t('palette.filter')}
            onChange={(event) => props.onFilter(event.target.value)}
          />
          {/*
            一个按钮两种含义：全都收起了就提示"能展开"，否则提示"能收起"。
            **常驻**：折叠对象里有那两个分节（内置那一节也有），永远有东西可收。

            这一行现在要和筛选框、新建输入框、＋ 挤在同一条线上，四个字的文案会把两个
            输入框压到不可用，所以它在**面上**是一枚 26px 宽、跟输入框同高的图标按钮
            （箭头由样式文件画），可读名由 aria-label 给出。字面文案仍留在 DOM 里：
            它是这个控件的可读名的一部分，验收脚本也按 `textContent` 读它。

            筛选态下它没有可做的事：命中的组必须当场可见，`isGroupExpanded` 在
            `filtering` 时一律回 true。既然按了也不会有任何变化，就灰掉并用 title 说清。
          */}
          <button
            type="button"
            className={[ui.iconButton, css.collapseAll].join(' ')}
            data-testid="wl-collapse-all"
            disabled={filtering}
            aria-label={t(allCollapsed ? 'palette.expandAll' : 'palette.collapseAll')}
            title={
              filtering
                ? t('palette.collapseFiltering')
                : t(allCollapsed ? 'palette.expandAll' : 'palette.collapseAll')
            }
            onClick={() => props.onSetCollapsed(allCollapsed ? [] : sectionKeys)}
            /*
             * 无字图标按钮：箭头由 `.collapseAll::before` 画（装饰，不进无障碍树），
             * 可读名走上面的 `aria-label` / `title`。
             * 以前这里塞着一份 0 号字的文案，只为迁就验收第 20 步读 `textContent`——
             * 那条断言已改成读 `aria-label`，这里就不用再演了。
             */
          />
        </div>

        <div className={css.newNode}>
          <input
            type="text"
            className={ui.input}
            data-testid="wl-new-node-input"
            ref={blankInputRef}
            value={draft}
            placeholder={t('palette.newPlaceholder')}
            aria-label={t('palette.newBlank')}
            aria-invalid={nameError !== null}
            disabled={disabled}
            onFocus={() => {
              /*
                空图那枚 CTA（画布正中唯一能点的东西）点下去只做一件事：把焦点扔进这里。
                窄窗下节点库与画布不在同一屏，焦点飞进来而这一格还在视野外，
                用户看到的仍然是"什么都没发生"，所以把这一格滚进视野。
                jsdom 里没有 `scrollIntoView`，先判一下再调。
              */
              const input = blankInputRef.current
              if (input !== null && typeof input.scrollIntoView === 'function') {
                input.scrollIntoView({ block: 'nearest' })
              }
            }}
            onChange={(event) => {
              setDraft(event.target.value)
              // 边打边把上一次的红字撤掉：留着它就是在骂一个已经改过的输入。
              if (nameError !== null) setNameError(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              submitBlank()
            }}
          />
          <button
            type="button"
            className={[ui.button, ui.buttonPrimary].join(' ')}
            data-testid="wl-new-node-submit"
            disabled={disabled || draft.trim() === ''}
            aria-label={t('palette.newBlank')}
            title={t('palette.newBlank')}
            onClick={submitBlank}
          >
            ＋
          </button>
        </div>
      </div>
      {nameError !== null && (
        <p className={[ui.problem, css.formProblem].join(' ')} role="alert">
          {nameError}
        </p>
      )}

      {noMatch ? (
        <p className={css.empty}>{t('palette.noMatch')}</p>
      ) : (
        <>
          <PaletteSection
            t={t}
            source="builtin"
            labelKey="palette.builtin"
            count={countText(presetHits.length, presetTotal)}
            collapsed={props.collapsed}
            filtering={filtering}
            onToggleGroup={props.onToggleGroup}
          >
            {/*
              内置 node 节**内部**是**平铺**的：没有组头、没有二级折叠、没有按角色分堆。
              它本来就是一条主线的六个起点，分成五堆只会让人多跨一层折叠。
              可折叠的是整个分节，那个开关在分节头上。
            */}
            <div className={css.flatList}>
              {presetHits.map((preset) => (
                <Fragment key={preset.id}>{presetItem(preset)}</Fragment>
              ))}
            </div>
          </PaletteSection>

          <PaletteSection
            t={t}
            source="disk"
            labelKey="palette.disk"
            count={countText(templateHits.length, templateTotal)}
            collapsed={props.collapsed}
            filtering={filtering}
            onToggleGroup={props.onToggleGroup}
          >
            {/*
              自定义 node 节**内部也是平铺的一层**：没有前缀组、没有二级折叠
              （用户明确说不要二级分类）。模板名长短不一，所以这一列不排两列网格。
            */}
            {props.templates.length === 0 ? (
              <p className={css.empty}>{t('palette.diskEmpty')}</p>
            ) : (
              <div className={css.templateList}>
                {templateHits.map((entry) => (
                  <Fragment key={entry.name}>{templateItem(entry)}</Fragment>
                ))}
              </div>
            )}
          </PaletteSection>
        </>
      )}

      {/* 拖拽影像的常驻空壳：移出视口、不接指针，只在 dragstart 时被 setDragImage 抓一次。 */}
      <div className={css.dragGhost} ref={dragGhostRef} aria-hidden="true" />
    </section>
  )
}
