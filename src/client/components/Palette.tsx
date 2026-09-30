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
import type { TemplateEntry, ValidationLevel, ValidationProblem } from '../../shared/types.ts'
import { DND_MIME, type DragPayload, encodeDragPayload } from '../core/dnd.ts'
import type { LocaleKey } from '../core/locales.ts'
import {
  isGroupExpanded,
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
  /**
   * 「自定义 node」末尾那枚「＋」：**新建一个节点模板**（开对话框，不在这里就地输入）。
   *
   * 这一条替换掉的正是原先那一行「节点 id，回车新建」：那个新建的是**图里的节点**，
   * 而"新建"在这个视图里真正该指的是一件更根本的事——造一个新的自定义节点类型。
   */
  onNewTemplate: () => void
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
  onToggleGroup: (key: string) => void
  children: ReactNode
}): React.JSX.Element {
  const key = sectionKey(props.source)
  const expanded = isGroupExpanded(key, props.collapsed)
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
  /*
   * 模板**直接平铺**（入参就已经是一列条目）：用户明确说不要二级分类，
   * 分组既不参与渲染，也不进折叠表。
   */
  const templateEntries = props.templates

  /** 项数文案；这一节没有项就不显示（写个 0 只是噪声）。 */
  const countText = (total: number): string | null => (total === 0 ? null : `${total}`)

  const dragGhostRef = useRef<HTMLDivElement | null>(null)

  /**
   * 把条目装进 dataTransfer。载荷的编解码归 `core/dnd.ts`，这里只负责装车；
   * 拖拽影像用那个常驻的空壳（`dragGhostRef`），`setDragImage` 只在拖拽开始那一瞬抓像素。
   */
  const startDrag = (
    event: React.DragEvent<HTMLElement>,
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

  const presetItem = (preset: NodePreset): React.JSX.Element => {
    const label = t(preset.labelKey)
    /*
     * 条目是**拖源**，不是按钮：`<div role="listitem">`，进不了 tab 序，键盘敲不出节点。
     *
     * 为什么不做成 `<button>`：按钮的语义就是"按下去会发生什么"，而这里按下去什么都不该
     * 发生（用户明确要求"只能拖进去"，随后把键盘回车那条也去掉了）。留一个按了没反应的
     * 按钮，比让键盘用户根本遇不到它更坏。
     *
     * `title` 与 `aria-label` 只说拖，机器 id 一起念出来。条目上**没有拖拽把手**——
     * "能拖"由光标与悬停的抬起表达，那个盲文字符只是一段噪声。
     */
    const hint = `${label}（${preset.id}），${t('palette.dragHint')}`
    return (
      <div
        /* 两列网格里的那一版条目：显示名要先留住，机器 id 先让位（见样式文件）。 */
        className={[css.item, css.itemPreset].join(' ')}
        data-testid={`wl-item-preset-${preset.id}`}
        role="listitem"
        draggable={!disabled}
        aria-disabled={disabled}
        title={`${label}，${t('palette.dragHint')}`}
        aria-label={hint}
        onDragStart={(event) => startDrag(event, { kind: 'preset', id: preset.id }, label)}
      >
        <span className={css.itemName}>{label}</span>
        {/* 两列网格的格子里放不下长 id（`implement` / `review` / `report` 会截成 `impl…`），
            所以截断这件事得能恢复：指到 id 上给全文。 */}
        <span className={css.itemId} title={preset.id}>
          {preset.id}
        </span>
      </div>
    )
  }

  const templateItem = (entry: TemplateEntry): React.JSX.Element => {
    // 坏模板拖不得也加不得：它的 data 本体读不出来，进去只能得到一个空节点。
    const invalid = entry.invalid === true
    const blocked = disabled || invalid
    const title = invalid ? (entry.reason ?? t('palette.invalid')) : entry.name
    const hint = invalid ? title : `${title}，${t('palette.dragHint')}`
    return (
      <div
        className={css.item}
        data-testid={`wl-item-template-${entry.name}`}
        role="listitem"
        draggable={!blocked}
        aria-disabled={blocked}
        title={hint}
        aria-label={hint}
        onDragStart={(event) =>
          startDrag(event, { kind: 'template', name: entry.name }, entry.name)
        }
      >
        <span className={css.itemName}>{entry.name}</span>
        {invalid && <span className={css.itemBad}>!</span>}
      </div>
    )
  }

  /**
   * 「自定义 node」末尾那枚「＋」：**新建一个节点模板**。
   *
   * 形状与别的条目**同列同高**（用户的要求："和 node 按钮一样，只不过样式不一样"），
   * 语气不同：虚线边 + 强调色的 ＋，一眼看出它不是一个模板而是一个动作。
   * 点它**开对话框**：模板有四个字段，塞进 28px 高的一行里没法用。
   */
  const addTemplateItem = (): React.JSX.Element => (
    <button
      type="button"
      className={[css.item, css.itemAdd].join(' ')}
      data-testid="wl-template-add"
      disabled={disabled}
      title={t('palette.newTemplate')}
      aria-label={t('palette.newTemplate')}
      onClick={props.onNewTemplate}
    >
      <span className={css.itemAddPlus} aria-hidden="true">
        ＋
      </span>
      <span className={css.itemName}>{t('palette.newTemplate')}</span>
    </button>
  )

  return (
    <section className={css.library} data-testid="wl-library">
      <div className={ui.panelHead}>
        <span>{t('palette.title')}</span>
      </div>

      {/*
        这一栏上面**没有说明行、没有筛选框、没有"新建"输入行**了。

        那三行是这一版的删项：常驻说明只是把"怎么连线"写两遍（画布容器上本来就有一条
        `title`），筛选在十来条目下没有意义，「节点 id，回车新建」新建的是图里的节点——
        而这一栏要建的其实是**节点模板**，那件事搬到了「自定义 node」末尾的「＋」里（开对话框）。
        省下的高度直接变成能看见的条目数，这一栏在窄窗只有一百来像素高。
      */}
      <PaletteSection
        t={t}
        source="builtin"
        labelKey="palette.builtin"
        count={countText(props.presets.length)}
        collapsed={props.collapsed}
        onToggleGroup={props.onToggleGroup}
      >
        {/*
          内置 node 节**内部**是**平铺**的：没有组头、没有二级折叠、没有按角色分堆。
          它本来就是一条主线的六个起点，分成五堆只会让人多跨一层折叠。
          可折叠的是整个分节，那个开关在分节头上。
        */}
        <div className={css.flatList} role="list" aria-label={t('palette.builtin')}>
          {props.presets.map((preset) => (
            <Fragment key={preset.id}>{presetItem(preset)}</Fragment>
          ))}
        </div>
      </PaletteSection>

      <PaletteSection
        t={t}
        source="disk"
        labelKey="palette.disk"
        count={countText(templateEntries.length)}
        collapsed={props.collapsed}
        onToggleGroup={props.onToggleGroup}
      >
        {/*
          自定义 node 节**内部也是平铺的一层**：没有前缀组、没有二级折叠
          （用户明确说不要二级分类）。模板名长短不一，所以这一列不排两列网格。

          模板那一格是 `role="list"`（条目都是 `listitem`），末尾那枚「＋」**在外面**：
          它是一个真按钮，而 `role="list"` 的孩子只允许 `listitem`，混进去就是无效结构。
          外面这层 `.templateStack` 只负责把两格的排布（内缩与行距）接起来。
        */}
        <div className={css.templateStack}>
          <div className={css.templateList} role="list" aria-label={t('palette.disk')}>
            {templateEntries.map((entry) => (
              <Fragment key={entry.name}>{templateItem(entry)}</Fragment>
            ))}
          </div>
          {addTemplateItem()}
        </div>
      </PaletteSection>

      {/* 拖拽影像的常驻空壳：移出视口、不接指针，只在 dragstart 时被 setDragImage 抓一次。 */}
      <div className={css.dragGhost} ref={dragGhostRef} aria-hidden="true" />
    </section>
  )
}
