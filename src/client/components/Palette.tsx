/**
 * dsh-workflow-lite — 左栏：节点库（筛选 / 折叠 / 拖源） + 校验面板。
 *
 * 节点库有两个来源，**分节展示不混**：内置 node（`presets.ts`，节内**平铺**）与自定义 node
 * （`templates/nodes/*.json`，**按前缀分组**）。**两个分节本身都可折叠**，自定义节点各自的
 * 前缀组还能再折一层；内置那一节内部刻意不再分角色组。
 *
 * 条目**拖**进画布落在指针处，**点**则落在视野中心——点不是拖的退化写法，它是键盘
 * 与触屏唯一的路径（`draggable` 只在指针设备上成立），所以两条都得留着。
 *
 * 折叠状态是**受控**的（`collapsed` / `onToggleGroup`）：谁持有那份 localStorage 读写
 * 谁就持有状态，这里只解释「组键」与「此刻该不该展开」。组键、折叠表解析、筛选匹配
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
  type FilteredGroup,
  filterGroups,
  groupKey,
  groupLabel,
  isFiltering,
  isGroupExpanded,
  matchesFilter,
  type NodePreset,
  type PaletteGroup,
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

/** 节点库的 props。 */
export interface PaletteProps {
  t: Translate
  disabled: boolean
  /** 内置 node：**平铺列表**（节内不再按角色分组，但整节本身可折叠）。 */
  presets: readonly NodePreset[]
  /** 自定义 node：按模板名前缀分的组（组本身可折叠，整节也可折叠）。 */
  templates: readonly PaletteGroup<TemplateEntry>[]
  /** 已折叠的键（两个分节键 + 自定义组键，受控）。 */
  collapsed: readonly string[]
  onToggleGroup: (groupKey: string) => void
  filter: string
  onFilter: (value: string) => void
  /** 点击条目：在视野中心加一个。 */
  onAddPreset: (preset: NodePreset) => void
  onAddTemplate: (entry: TemplateEntry) => void
  /** 空白节点：id 由面板内输入框给出。 */
  onCreateBlank: (id: string) => void
  /**
   * 一次性把折叠状态整份换掉（「全部展开 / 全部收起」用）。
   *
   * 刻意不拆成"逐个 `onToggleGroup`"：逐个会发出 N 次状态更新、写 N 次 localStorage，
   * 中间态还会被渲染出来。组键清单在面板这层才知道，所以由面板算好整份交出去。
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

/** 一个可折叠组：组头（chevron + 组名 + 项数）与组体（条目）。只给自定义节点用。 */
function PaletteGroupSection<T>(props: {
  t: Translate
  source: PaletteSource
  group: FilteredGroup<T>
  collapsed: readonly string[]
  filtering: boolean
  /** 条目在 React 列表里的稳定键。 */
  keyOf: (item: T) => string
  /** 该组里坏模板的条数（0 = 不显示徽标）。 */
  badCount: number
  onToggleGroup: (key: string) => void
  renderItem: (item: T) => React.JSX.Element
}): React.JSX.Element {
  const key = groupKey(props.source, props.group.group)
  const expanded = isGroupExpanded(key, props.collapsed, props.filtering)
  // 折起来时条目**从 DOM 里消失**（而不是 `hidden`）：否则 tab 顺序里还留着一串
  // 看不见的按钮。外层那个 div 留着，好让 `aria-controls` 永远指得到东西。
  const bodyId = `wl-group-body-${props.source}-${props.group.group}`
  return (
    <div className={css.group} data-testid={`wl-group-${key}`}>
      <button
        type="button"
        className={css.groupHead}
        data-testid={`wl-group-toggle-${key}`}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => props.onToggleGroup(key)}
      >
        <span className={css.chevron} aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className={css.itemName}>{groupLabel(props.group.group, props.t)}</span>
        <span className={css.groupCount}>
          {props.badCount > 0 && (
            <>
              <span className={ui.badge}>{props.badCount}</span>{' '}
            </>
          )}
          {props.filtering ? `${props.group.hits} / ${props.group.total}` : props.group.total}
        </span>
      </button>
      <div id={bodyId}>
        {expanded &&
          props.group.items.map((item) => (
            <Fragment key={props.keyOf(item)}>{props.renderItem(item)}</Fragment>
          ))}
      </div>
    </div>
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
  const templateGroups = filterGroups(props.templates, props.filter, (entry) => entry.name)
  const noMatch = filtering && presetHits.length === 0 && templateGroups.length === 0

  /**
   * 项数文案：不筛时是总数，筛的时候是「命中数 / 总数」，与组头同一个口径，
   * 用户要能看出这一节还有多少没显示出来。总数是 0 就整格不显示。
   */
  const countText = (hits: number, total: number): string | null => {
    if (total === 0) return null
    return filtering ? `${hits} / ${total}` : `${total}`
  }
  const presetTotal = props.presets.length
  const templateTotal = props.templates.reduce((sum, group) => sum + group.items.length, 0)
  const templateHits = templateGroups.reduce((sum, group) => sum + group.hits, 0)

  /**
   * 全部折叠键：**两个分节键 + 所有自定义组键**。
   *
   * 分节键走 `section:` 命名空间、组键走 `<来源>:<组名>`，两套不重叠（见 `sectionKey`）。
   * 内置那一节**内部**没有组（平铺），它的折叠对象只有分节键这一个。
   */
  const everyGroupKey = [
    sectionKey('builtin'),
    sectionKey('disk'),
    ...props.templates.map((group) => groupKey('disk', group.group)),
  ]
  /*
   * 「全都折起来了」这件事只在**没在筛选**时才可能成立：筛选态下 `isGroupExpanded`
   * 一律返回 true（命中的组必须当场可见）。原来不看 `filtering`，于是筛出结果时两个
   * 分节明明都是 ▾、按钮却写着「全部展开」——文案在陈述一件与眼前事实相反的事。
   */
  const allCollapsed = !filtering && everyGroupKey.every((key) => props.collapsed.includes(key))

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
     * 条目同时是可拖源和按钮：`title` 补全「拖或点」，`aria-label` 再把可读名与
     * 机器 id 一起念出来（`⠿` 是 aria-hidden，读屏原先只能听到"侦察scan 按钮"）。
     */
    const hint = `${label}（${preset.id}），${t('palette.addHint')}`
    return (
      <button
        type="button"
        className={css.item}
        data-testid={`wl-item-preset-${preset.id}`}
        draggable={!disabled}
        disabled={disabled}
        title={`${label}，${t('palette.dragHint')}`}
        aria-label={hint}
        onClick={() => props.onAddPreset(preset)}
        onDragStart={(event) => startDrag(event, { kind: 'preset', id: preset.id }, label)}
      >
        <span className={css.itemGrip} aria-hidden="true">
          ⠿
        </span>
        <span className={css.itemName}>{label}</span>
        <span className={css.itemId}>{preset.id}</span>
      </button>
    )
  }

  const templateItem = (entry: TemplateEntry): React.JSX.Element => {
    // 坏模板拖不得也点不得：它的 data 本体读不出来，拖进去只能得到一个空节点。
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
        aria-label={invalid ? title : `${title}，${t('palette.addHint')}`}
        onClick={() => props.onAddTemplate(entry)}
        onDragStart={(event) =>
          startDrag(event, { kind: 'template', name: entry.name }, entry.name)
        }
      >
        <span className={css.itemGrip} aria-hidden="true">
          ⠿
        </span>
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
        条目能拖也能点、连线要从卡片侧面的圆点拖出——这两件事原先只写在条目的 `title` 里，
        触屏与键盘用户永远看不到（`title` 对它们不弹）。做成常驻小字：宽窗一行放得下两句，
        窄窗自行折行。
      */}
      <p className={css.panelHint} data-testid="wl-palette-hint">
        <span>{t('palette.addHint')}</span>
        <span>{t('palette.connectHint')}</span>
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
            一个按钮两种文案：全都收起了就提示"能展开"，否则提示"能收起"。
            比并排两个按钮省一半横向空间，而且当下该做哪件事永远是它自己。
            **常驻**：折叠对象里有那两个分节（内置那一节也有），永远有东西可收，
            不再按"有没有自定义组"决定渲不渲染。

            筛选态下它没有可做的事：命中的组必须当场可见，`isGroupExpanded` 在
            `filtering` 时一律回 true。既然按了也不会有任何变化，就灰掉并用 title 说清。
          */}
          <button
            type="button"
            className={[ui.button, ui.buttonGhost, css.collapseAll].join(' ')}
            data-testid="wl-collapse-all"
            disabled={filtering}
            title={
              filtering
                ? t('palette.collapseFiltering')
                : t(allCollapsed ? 'palette.expandAll' : 'palette.collapseAll')
            }
            onClick={() => props.onSetCollapsed(allCollapsed ? [] : everyGroupKey)}
          >
            {t(allCollapsed ? 'palette.expandAll' : 'palette.collapseAll')}
          </button>
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
            count={countText(templateHits, templateTotal)}
            collapsed={props.collapsed}
            filtering={filtering}
            onToggleGroup={props.onToggleGroup}
          >
            {props.templates.length === 0 ? (
              <p className={css.empty}>{t('palette.diskEmpty')}</p>
            ) : (
              templateGroups.map((group) => (
                <PaletteGroupSection
                  key={groupKey('disk', group.group)}
                  t={t}
                  source="disk"
                  group={group}
                  collapsed={props.collapsed}
                  filtering={filtering}
                  keyOf={(entry) => entry.name}
                  badCount={group.items.filter((entry) => entry.invalid === true).length}
                  onToggleGroup={props.onToggleGroup}
                  renderItem={templateItem}
                />
              ))
            )}
          </PaletteSection>
        </>
      )}

      {/* 拖拽影像的常驻空壳：移出视口、不接指针，只在 dragstart 时被 setDragImage 抓一次。 */}
      <div className={css.dragGhost} ref={dragGhostRef} aria-hidden="true" />
    </section>
  )
}
