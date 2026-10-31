/**
 * dsh-workflow-lite — 资源卡的展示区：把资源里的一项（图片、网页、Markdown、文本）直接摆在画布上。
 *
 * 从哪读由 {@link DisplayContext} 定：
 * - 实例视图给出实例与每项的修改时间（`run/stat`，见 `app/useDisplayStats.ts`），修改时间变了才重读，
 *   读回来之前上一份原样留着，新的淡入；还没生成时是草图（{@link DisplaySketch}），写它的步骤在跑时扫一道光。
 *   实例视图只看这个实例，从不拿别的实例的结果来填。
 * - 模板视图给出「上次执行」（`run/latest`）：这个工作流最近真的生成了它的那个实例，卡上显示那一份，
 *   右上角一枚「上次执行 · 时间」，点了打开那个实例；哪次都没生成就是草图「执行后显示」。
 * 自定义文字两边都直接显示。
 *
 * 实例视图里存过几版的（循环迭代时每一轮存一版，见 `host/runs/history.ts`），悬停卡片时底下出现一条时间线，
 * 标题行写出看的是哪一版（{@link HistoryBar}）：悬停预览、点一下钉住。钉住的那版只在这张卡上，不存进图里。
 *
 * 平时展示区不接鼠标（拖卡片、平移、缩放画布照旧）；卡片进了「交互」才能在里面滚动、点网页里的按钮。
 * 第一次进视野、而且画布停着时才挂内容（宿主页面插拔元素要整页重算样式，平移中间插就是一次卡顿）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ResourceDisplay
 */

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { usesBoardTheme } from '../../shared/board.ts'
import { GALLERY_GAP, galleryLayout, galleryTracks, textWraps } from '../../shared/display.ts'
import { extensionOf } from '../../shared/fileKind.ts'
import type {
  GalleryView as FolderSettings,
  LineFilter,
  ResourceItem,
  TableView,
} from '../../shared/types.ts'
import type {
  RunDirEntry,
  RunDirResponse,
  RunFileResponse,
  RunLatestOutput,
  RunLine,
} from '../../shared/wire.ts'
import { publishFolderFacts, publishTableHead } from '../app/cardFacts.ts'
import { type DisplayStat, displayKey } from '../app/useDisplayStats.ts'
import { useRunFile, useRunHistory, useRunImages } from '../app/useRunFile.ts'
import { useRunLines } from '../app/useRunLines.ts'
import type { T } from '../i18n.ts'
import { type Display, displayFootprint } from '../model/display.ts'
import { fileBaseName, fileKindOf, formatBytes, stripAnsi } from '../model/fileKind.ts'
import { folderOrder, nameMatcher } from '../model/folderView.ts'
import {
  activeFilter,
  type LineWindow,
  lineLevel,
  linesFrom,
  splitHits,
} from '../model/logLines.ts'
import { dotIndex, historyLine } from '../model/outputHistory.ts'
import {
  delimiterOf,
  newLines,
  parseDelimited,
  prettyJson,
  tableFormat,
} from '../model/textShape.ts'
import { shortTime } from '../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { useBoardFrame } from './boardFrame.ts'
import { DataTable } from './DataTable.tsx'
import { DisplaySketch } from './DisplaySketch.tsx'
import css from './display.module.css'
import { FileTag } from './FileTag.tsx'
import { HistoryBar } from './HistoryBar.tsx'
import { Icon, type IconName } from './Icon.tsx'
import { type ImageSource, Markdown } from './Markdown.tsx'
import { SlideSwap, useCanvasMoving, useTrend } from './motion.tsx'

/** 展示区从哪读：实例视图给出实例与每项的样子；模板里是 `null`（文件还没生成）。 */
export interface DisplayEnv {
  t: T
  run: {
    rpc: WorkflowLiteRpc
    instance: string
    stats: Readonly<Record<string, DisplayStat>>
    /** 步骤 id → 名字（各轮的点上写「改稿 · 第 2 轮」）。 */
    names?: Readonly<Record<string, string>>
  } | null
  /** 模板视图的「上次执行」（按模板里的 `displayKey`）；实例视图不给。 */
  latest?:
    | {
        rpc: WorkflowLiteRpc
        outputs: Readonly<Record<string, RunLatestOutput>>
        /** 点「上次执行」：打开那个实例。 */
        openRun(instance: string): void
      }
    | undefined
  /** 双击展示区、点「打开」：在查看框里看这一项（文件夹可以带 `sub`：直接看里面的那一份）。不给就不能打开。 */
  open?: ((node: string, item: number, sub?: string) => void) | undefined
}

export const DisplayContext = createContext<DisplayEnv | null>(null)

/**
 * 展示卡上留给展示区之外的几块位置：标题行里紧跟标题的状态（生成中、刚更新、筛出几行），标题行里写「看的是哪一版」，
 * 卡片底边外挂时间线（卡片不裁，挂在这里才露得出来）。状态不压在展示区上，免得挡住内容。
 */
export const HistorySlotContext = createContext<{
  status: HTMLElement | null
  slot: HTMLElement | null
  rail: HTMLElement | null
} | null>(null)

/** 第一次进视野（且画布停着）才为真，之后一直为真：挂上了就不再摘。 */
function useSeen<E extends Element>(): [React.RefObject<E>, boolean] {
  const ref = useRef<E>(null)
  const [visible, setVisible] = useState(false)
  const [seen, setSeen] = useState(false)
  const moving = useCanvasMoving()
  useEffect(() => {
    const element = ref.current
    if (element === null || seen) return
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [seen])
  useEffect(() => {
    if (visible && !moving) setSeen(true)
  }, [visible, moving])
  return [ref, seen]
}

/** 读回来的一份内容：读新的时上一份留着（不闪空），`version` 变了才重读。 */
function useHeld<V>(value: V | null): V | null {
  const [held, setHeld] = useState<V | null>(value)
  useEffect(() => {
    if (value !== null) setHeld(value)
  }, [value])
  return value ?? held
}

/** 存下的旧版图不会再变：悬停扫过各轮时读过的直接用（base64 的，别存太多）。 */
const KEPT_IMAGES = 12
const keptImages = new Map<string, string>()

/** 读回来的一张图，连同它是哪一次读的（`at`：换一版就换一层、淡入）。 */
interface LoadedImage {
  url: string | null
  error: string | null
  at: string | number | null
}

/**
 * 实例里的一张图：`signal` 变了重读（现在的文件拿修改时间，`null` 不读）；`kept` 给了就读存下的那一版。
 */
function useDisplayImage(
  rpc: WorkflowLiteRpc,
  instance: string,
  node: string,
  item: number,
  kept: number | null,
  signal: string | number | null,
): LoadedImage {
  const [state, setState] = useState<LoadedImage>({ url: null, error: null, at: null })
  useEffect(() => {
    if (signal === null) return
    const cacheKey = `${instance}|${node}#${item}@${kept}`
    const hit = kept === null ? undefined : keptImages.get(cacheKey)
    if (hit !== undefined) {
      setState({ url: hit, error: null, at: signal })
      return
    }
    let alive = true
    rpc
      .call('run/image', { id: instance, node, item, ...(kept === null ? {} : { version: kept }) })
      .then(({ mime, data }) => {
        const url = `data:${mime};base64,${data}`
        if (kept !== null) {
          keptImages.set(cacheKey, url)
          const oldest = keptImages.size > KEPT_IMAGES ? keptImages.keys().next().value : undefined
          if (oldest !== undefined) keptImages.delete(oldest)
        }
        if (alive) setState({ url, error: null, at: signal })
      })
      .catch((reason: unknown) => {
        if (alive) setState({ url: null, error: errorMessage(reason), at: signal })
      })
    return () => {
      alive = false
    }
  }, [rpc, instance, node, item, kept, signal])
  return state
}

/** 占位与读不了的说明：居中一枚图标、一两行字。 */
function DisplayState(props: {
  icon: IconName
  title: string
  sub?: string
  tone?: 'wait' | 'error'
  /** 写它的步骤正在跑：边上有一道光在走。 */
  busy?: boolean
}): React.JSX.Element {
  return (
    <div
      className={css.state}
      data-tone={props.tone ?? 'wait'}
      data-busy={props.busy === true || undefined}
      data-testid="wl-display-state"
    >
      <span className={css.stateIcon}>
        <Icon name={props.icon} size={18} />
      </span>
      <span className={css.stateTitle}>{props.title}</span>
      {props.sub !== undefined && props.sub !== '' && (
        <span className={css.stateSub}>{props.sub}</span>
      )}
    </div>
  )
}

/** 网页：按「大小」排版，再按缩放整张等比缩放（像图片一样，排版不变）。页面是看板的卡片版（`data-board="card"`），带画布主题。 */
function HtmlView(props: {
  name: string
  text: string
  display: Display
  interactive: boolean
}): React.JSX.Element {
  const scale = props.display.zoom / 100
  const frame = useRef<HTMLIFrameElement>(null)
  // 透明只给看板：用了 `--board-*` 变量的页面跟着画布配色；别的网页多半写死了白底黑字（或者黑底白字），
  // 透出画布来就看不清了，留着自己的底。
  const clear =
    props.display.adapt &&
    props.display.look !== undefined &&
    props.display.look !== 'card' &&
    usesBoardTheme(props.text)
  // 没进交互时不画滚动条：卡片是静止的一张图，滚动条只是噪音；进了交互（能滚了）再显示。
  const board = useBoardFrame(frame, props.text, 'card', clear, !props.interactive)
  return (
    <iframe
      ref={frame}
      className={css.frame}
      title={props.name}
      srcDoc={board.srcDoc}
      onLoad={board.onLoad}
      // 只给脚本：没有 allow-same-origin，页面是个独立的源，读不到画布的存储与登录态，也跳不走顶层。
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={props.interactive ? 0 : -1}
      style={{
        width: props.display.width,
        height: props.display.height,
        transform: `scale(${scale})`,
        colorScheme: board.scheme,
      }}
      data-clear={clear || undefined}
      data-testid="wl-display-frame"
    />
  )
}

function ImageView(props: { name: string; url: string; display: Display }): React.JSX.Element {
  const { display } = props
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const actual = display.fit === 'actual'
  return (
    <div
      className={css.imageStage}
      data-fit={display.fit}
      data-vector={props.url.startsWith('data:image/svg+xml') || undefined}
    >
      <img
        className={css.image}
        src={props.url}
        alt={props.name}
        draggable={false}
        decoding="async"
        onLoad={(event) =>
          setNatural({
            w: event.currentTarget.naturalWidth,
            h: event.currentTarget.naturalHeight,
          })
        }
        style={
          actual && natural !== null
            ? {
                width: (natural.w * display.zoom) / 100,
                height: (natural.h * display.zoom) / 100,
              }
            : undefined
        }
        data-testid="wl-display-image"
      />
    </div>
  )
}

/** 读回来的文本类内容怎么摆。 */
function TextView(props: {
  t: T
  file: RunFileResponse
  /** 资源里写的路径（按扩展名定排成表、展开 JSON、折行）。 */
  path: string
  display: Display
  interactive: boolean
  image?: ImageSource
  /** 写它的步骤正在跑：日志停在末尾跟着往下走。 */
  writing: boolean
  table?: TableEnv | undefined
}): React.JSX.Element {
  const { t, file, display } = props
  if (file.kind === 'tooLarge') {
    return (
      <DisplayState
        icon="file"
        title={t('display.tooLarge')}
        sub={`${formatBytes(file.size)} / ${formatBytes(file.limit)}`}
        tone="error"
      />
    )
  }
  if (file.kind === 'binary') {
    return <DisplayState icon="file" title={t('file.binary')} tone="error" />
  }
  const text = file.text ?? ''
  if (text.trim() === '') return <DisplayState icon="file" title={t('file.empty')} />
  if (display.kind === 'html') {
    return (
      <HtmlView
        name={fileBaseName(file.display)}
        text={text}
        display={display}
        interactive={props.interactive}
      />
    )
  }
  const table = display.kind === 'text' ? tableFormat(props.path) : null
  if (table !== null) {
    return (
      <TableFlow
        t={t}
        text={text}
        format={table}
        display={display}
        interactive={props.interactive}
        env={props.table}
      />
    )
  }
  const wrap = display.kind === 'text' && textWraps(props.path)
  // 日志停在末尾：写的时候、只读了末尾一截时、本来就是 .log 时（要看的多半是最后几行：报错、结果）。
  const cut = file.cut ?? 0
  const follow = wrap && (props.writing || cut > 0 || extensionOf(props.path) === 'log')
  return (
    <Flow
      t={t}
      text={text}
      path={props.path}
      display={display}
      image={props.image}
      wrap={wrap}
      follow={follow}
      cut={cut}
      interactive={props.interactive}
    />
  )
}

/**
 * 逗号后面可以断行（`<wbr>`，复制出来不多字）：没有空格的一长行（JSON 记录）折在字段之间，
 * 不会在日期、字段名中间断开。
 */
function softBreaks(line: string): React.ReactNode {
  if (!line.includes(',')) return line
  const parts = line.split(',')
  return parts.map((part, index) =>
    index === parts.length - 1 ? (
      part
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: 同一行里的第几段，内容一变整行重排
      <Fragment key={index}>
        {part},<wbr />
      </Fragment>
    ),
  )
}

/** 纯文本在卡片里最多排多少行：卡片是预览，一屏只看得到几十行；整份在「打开」里看。表格同理。 */
const WRAP_LINES = 1000

/**
 * 裁内容的那层（和展示区一样大）：量内容是不是真的超出了、超出的是哪一边（内容、字号、卡片大小变了都重量）。
 * `pin` 为真时停在最底下（日志跟着末尾）：没进交互时裁的就是这层，量完顺手拉到底。
 */
function useOverflow(pin: boolean): [React.RefObject<HTMLDivElement>, { x: boolean; y: boolean }] {
  const clip = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState({ x: false, y: false })
  const pinned = useRef(pin)
  pinned.current = pin
  useLayoutEffect(() => {
    const element = clip.current
    if (element === null) return
    const measure = (): void => {
      const x = element.scrollWidth > element.clientWidth + 1
      const y = element.scrollHeight > element.clientHeight + 1
      setOver((last) => (last.x === x && last.y === y ? last : { x, y }))
      if (pinned.current) element.scrollTop = element.scrollHeight
    }
    measure()
    // 量自己（卡片大小、进出交互）和里面那层（字号、图片加载完撑高）。
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild !== null) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [])
  return [clip, over]
}

/**
 * 跟着末尾走（日志）：没进交互时裁的那层停在底下；进了交互展示区自己滚——一进来先到底，
 * 之后人还在底下（差一点也算）才跟着新内容往下走，往上翻着看时不拽回来。
 */
function useFollow(
  clip: React.RefObject<HTMLDivElement>,
  follow: boolean,
  interactive: boolean,
  content: unknown,
): void {
  const atBottom = useRef(true)
  const scroller = (): HTMLElement | null =>
    interactive ? (clip.current?.closest<HTMLElement>(`.${css.body}`) ?? null) : clip.current
  // 记住人在不在底下（进了交互才会自己滚）。
  useEffect(() => {
    if (!follow || !interactive) return
    const element = scroller()
    if (element === null) return
    const onScroll = (): void => {
      atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  })
  // 进出交互、开始跟随：回到底下。
  useLayoutEffect(() => {
    atBottom.current = true
    const element = scroller()
    if (follow && element !== null) element.scrollTop = element.scrollHeight
  }, [follow, interactive])
  // 新内容来了（`content` 只是「变了」的信号）：人在底下才跟。
  useLayoutEffect(() => {
    const element = scroller()
    if (follow && element !== null && atBottom.current) element.scrollTop = element.scrollHeight
  }, [content])
}

/** 这一份比上一份新加了什么：哪几项（行号或表格行号），连同一个交替的记号（每次更新换一个，高亮从头再淡一次）。 */
interface Marks {
  items: ReadonlySet<number>
  parity: 0 | 1
}

/**
 * 内容变了（现在的文件更新了）：和上一份比出新的几项。比在渲染里做（不是等画完再补），新的行一出现就带着高亮，不闪一下。
 * 第一份不标；看旧版时卡片整个换一层（见 {@link RunFileView}），也不标。
 */
function useMarks<V>(value: V, diff: (before: V, after: V) => ReadonlySet<number>): Marks | null {
  const [seen, setSeen] = useState<{ value: V; marks: Marks | null }>({ value, marks: null })
  if (seen.value !== value) {
    const items = diff(seen.value, value)
    const parity: 0 | 1 = seen.marks?.parity === 0 ? 1 : 0
    const next = { value, marks: items.size === 0 ? null : { items, parity } }
    setSeen(next)
    return next.marks
  }
  return seen.marks
}

/**
 * Markdown / 纯文本：按 `zoom` 放大缩小字号。
 * 外面一层（`flowClip`）和展示区一样大、负责裁：内容真的超出了才在那一边淡出——超出底边在底边、
 * 不折行的长行超出右边在右边。进了交互不裁，展示区自己滚。
 * Markdown 里相对路径的图按文档所在目录去实例里读（`image`；自定义文字没有目录，不给）。
 * 纯文本去掉终端颜色码，压成一行的 JSON 展开缩进；一行一块（行多时只排 {@link WRAP_LINES} 行），
 * 折行时续行悬挂缩进，看得出每一条从哪开始。文件更新了，新的几行亮一下再淡下去。
 * 日志（`follow`）停在末尾：排最后几行、超出的是上边、上边淡出，前面还有多少写在最上面。
 */
function Flow(props: {
  t: T
  text: string
  path?: string
  display: Display
  image?: ImageSource | undefined
  wrap?: boolean | undefined
  follow?: boolean
  /** 只读了末尾：前面没读的字节数。 */
  cut?: number
  interactive?: boolean
}): React.JSX.Element {
  const { t, display } = props
  const follow = props.follow === true
  const interactive = props.interactive === true
  const [clip, over] = useOverflow(follow && !interactive)
  const plain = useMemo(() => {
    if (display.kind === 'markdown') return ''
    const text = stripAnsi(props.text)
    return (props.path === undefined ? null : prettyJson(props.path, text)) ?? text
  }, [display.kind, props.text, props.path])
  const lines = useMemo(() => {
    if (plain === '') return null
    const all = plain.split(/\r?\n/u)
    if (all[all.length - 1] === '') all.pop()
    const start = follow ? Math.max(0, all.length - WRAP_LINES) : 0
    const shown = all.slice(start, start + WRAP_LINES)
    return { shown, start, rest: all.length - shown.length }
  }, [plain, follow])
  const marks = useMarks(plain, newLines)
  useFollow(clip, follow, interactive, plain)
  const cut = props.cut ?? 0
  const earlier =
    follow && (cut > 0 || (lines?.rest ?? 0) > 0)
      ? cut > 0
        ? t('display.earlierBytes').replace('{size}', formatBytes(cut))
        : t('display.earlierLines').replace('{n}', (lines?.rest ?? 0).toLocaleString())
      : null
  return (
    <div
      ref={clip}
      className={css.flowClip}
      data-over-x={over.x || undefined}
      data-over-y={over.y || undefined}
      data-tail={follow || undefined}
    >
      <div className={css.flow} style={{ zoom: display.zoom / 100 }} data-kind={display.kind}>
        {display.kind === 'markdown' ? (
          <Markdown t={t} text={props.text} className={css.md} image={props.image} />
        ) : (
          lines !== null && (
            <>
              {earlier !== null && <p className={css.earlier}>{earlier}</p>}
              <pre className={css.pre} data-wrap={props.wrap || undefined}>
                {lines.shown.map((line, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: 第几行就是身份，内容一变整块重排
                    key={index}
                    className={css.line}
                    data-new={
                      marks?.items.has(lines.start + index) === true ? marks.parity : undefined
                    }
                  >
                    {props.wrap ? softBreaks(line) : line}
                  </span>
                ))}
              </pre>
              {!follow && lines.rest > 0 && (
                <p className={css.moreLines}>
                  {t('display.moreLines').replace('{n}', lines.rest.toLocaleString())}
                </p>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}

/** 展示卡按行读时要多少行：一屏看得到几十行，留些余量（筛的时候是匹配的行数）。 */
export const CARD_LINES = 200

/** 一行日志：命中的几段垫一层强调色，错误、警告行着色；太长被截掉的末尾带个省略号。 */
function LogLine(props: {
  line: RunLine
  wrap: boolean
  levels: boolean
  fresh: 0 | 1 | undefined
  pending?: boolean
}): React.JSX.Element {
  const { line } = props
  const level = props.levels ? lineLevel(line.text) : null
  const parts = splitHits(line.text, line.hits)
  return (
    <span
      className={css.line}
      data-level={level ?? undefined}
      data-ctx={line.ctx || undefined}
      data-new={props.fresh}
      data-pending={props.pending || undefined}
    >
      {parts.map(([text, hit], index) =>
        hit ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 一行里的第几段，内容一变整行重排
          <mark key={index} className={css.hit}>
            {text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同上
          <Fragment key={index}>{props.wrap ? softBreaks(text) : text}</Fragment>
        ),
      )}
      {line.long && <span className={css.longMark}>…</span>}
    </span>
  )
}

/**
 * 日志、纯文本按行看（`run/lines` 读回来的窗口）：只排读回来的那几百行。
 * 停在末尾时上边淡出、最上面写前面还有多少；从头看时写后面还有多少。筛的时候只有匹配的行（带上下文时
 * 不挨着的两段之间一道「跳过 N 行」），命中的字垫一层强调色。新追加的行亮一下再淡。
 * 进了交互、停在末尾的：往上翻着看时新内容不拽人回去，底下浮出「回到最新」（来了几行新的也写上）。
 */
function LogFlow(props: {
  t: T
  win: LineWindow
  display: Display
  interactive: boolean
  /** 停在末尾（跟着往下走）。 */
  tail: boolean
  wrap: boolean
  filter: LineFilter | undefined
}): React.JSX.Element {
  const { t, win, display } = props
  const interactive = props.interactive
  const [clip, over] = useOverflow(props.tail && !interactive)
  const filtered = props.filter !== undefined
  const context = (props.filter?.context ?? 0) > 0
  const levels = display.lines.levels !== false
  const fresh = win.fresh
  const away = useFollowAway(clip, props.tail, interactive, win)
  const earlier =
    props.tail && win.before && !filtered
      ? t('display.earlierBytes').replace('{size}', formatBytes(win.start))
      : null
  const later =
    !props.tail && win.after
      ? t('display.laterBytes').replace('{size}', formatBytes(Math.max(0, win.size - win.end)))
      : null
  return (
    <div
      ref={clip}
      className={css.flowClip}
      data-over-x={over.x || undefined}
      data-over-y={over.y || undefined}
      data-tail={props.tail || undefined}
    >
      <div className={css.flow} style={{ zoom: display.zoom / 100 }} data-kind="text">
        {earlier !== null && <p className={css.earlier}>{earlier}</p>}
        <pre className={css.pre} data-wrap={props.wrap || undefined} data-testid="wl-display-lines">
          {win.lines.map((line, index) => (
            <Fragment key={line.at}>
              {context && index > 0 && (line.skip ?? 0) > 0 && (
                <span className={css.skip}>
                  {t('display.skipped').replace('{n}', (line.skip ?? 0).toLocaleString())}
                </span>
              )}
              <LogLine
                line={line}
                wrap={props.wrap}
                levels={levels}
                fresh={fresh?.has(line.at) === true ? win.parity : undefined}
              />
            </Fragment>
          ))}
          {win.pending !== undefined && (
            <LogLine
              line={win.pending}
              wrap={props.wrap}
              levels={levels}
              fresh={fresh?.has(win.pending.at) === true ? win.parity : undefined}
              pending
            />
          )}
        </pre>
        {later !== null && <p className={css.moreLines}>{later}</p>}
        {away.count !== null && (
          <div className={css.jump}>
            <button
              type="button"
              className={css.jumpButton}
              onClick={away.jump}
              data-testid="wl-display-jump"
            >
              <Icon name="chevronDown" size={12} />
              {away.count > 0
                ? t('display.jumpNew').replace('{n}', away.count.toLocaleString())
                : t('display.jumpLatest')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 进了交互、停在末尾的日志：人往上翻了（离底超过一点）就不再跟着走，`count` 是那之后来了几行新的
 * （没翻上去是 `null`，不显示「回到最新」）；`jump` 滚回底下、接着跟。
 */
function useFollowAway(
  clip: React.RefObject<HTMLDivElement>,
  tail: boolean,
  interactive: boolean,
  win: LineWindow,
): { count: number | null; jump(): void } {
  const [away, setAway] = useState(false)
  const awayRef = useRef(false)
  awayRef.current = away
  const [missed, setMissed] = useState(0)
  const scroller = (): HTMLElement | null =>
    interactive ? (clip.current?.closest<HTMLElement>(`.${css.body}`) ?? null) : clip.current
  useEffect(() => {
    if (!tail || !interactive) {
      setAway(false)
      return
    }
    const element = scroller()
    if (element === null) return
    const onScroll = (): void => {
      const far = element.scrollHeight - element.scrollTop - element.clientHeight > 24
      if (far !== awayRef.current) {
        setAway(far)
        if (!far) setMissed(0)
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [tail, interactive])
  // 进出交互、开始跟随：回到底下。
  useLayoutEffect(() => {
    const element = scroller()
    if (tail && element !== null) element.scrollTop = element.scrollHeight
    setMissed(0)
  }, [tail, interactive])
  // 新内容来了：人在底下就跟，翻上去了就记一笔。
  useLayoutEffect(() => {
    const element = scroller()
    if (!tail || element === null) return
    if (!awayRef.current) element.scrollTop = element.scrollHeight
    else if (win.fresh !== null) setMissed((count) => count + (win.fresh?.size ?? 0))
  }, [win])
  return {
    count: tail && interactive && away ? missed : null,
    jump: () => {
      const element = scroller()
      if (element === null) return
      // 直接到底（几千像素的平滑滚动又慢、中途还会被新内容打断）。
      element.scrollTop = element.scrollHeight
      setMissed(0)
    },
  }
}

/** 表格多了几行：新加的是后面那几行（中间改了的不细究——那种更新卡片右上角还是会说「刚更新」）。 */
function addedRows(before: string, after: string, format: 'csv' | 'tsv'): ReadonlySet<number> {
  const count = (text: string): number => parseDelimited(text, delimiterOf(format, text), 0).total
  const from = count(before)
  const to = count(after)
  const added = new Set<number>()
  for (let row = from; row < Math.min(to, WRAP_LINES); row += 1) added.add(row)
  return added
}

/** 卡片上的表：读到的列名记在哪（设置浮层挑列用），进了交互点表头排序写回哪。 */
export interface TableEnv {
  headKey: string
  onTable?: ((table: TableView | undefined) => void) | undefined
}

/** 改表格设置里的一项（`undefined` 是去掉）；全去掉了就是 `undefined`。 */
export function patchTable(view: TableView, patch: Partial<TableView>): TableView | undefined {
  const next: TableView = { ...view, ...patch }
  for (const key of Object.keys(patch) as (keyof TableView)[]) {
    if (patch[key] === undefined) delete next[key]
  }
  return Object.keys(next).length === 0 ? undefined : next
}

/**
 * CSV / TSV 排成表：表头钉在上面（进了交互滚着看也在），超出的那边淡出，新加的行亮一下。
 * 按设置隐藏几列、按一列排、数字列画条；进了交互点表头排序（写回设置）。
 * 只读了末尾一截的（`tail`）：没有行号（不知道是第几行），停在最底下跟着新加的行走；排了序就不跟。
 */
function TableFlow(props: {
  t: T
  text: string
  format: 'csv' | 'tsv'
  display: Display
  interactive: boolean
  env: TableEnv | undefined
  /** 按行读的：新加的几行外面比好了给进来；不给就和上一份文字比。 */
  marks?: Marks | null
  tail?: boolean
  /** 表格下面那句（按行读的：前面 / 后面还有多少）；不给就数没排出来的行。 */
  note?: string | null
}): React.JSX.Element {
  const view = props.display.table
  const pin = props.tail === true && view.sort === undefined
  const [clip, over] = useOverflow(pin && !props.interactive)
  const own = useMarks(props.text, (before, after) => addedRows(before, after, props.format))
  useFollow(clip, pin, props.interactive, props.text)
  const headKey = props.env?.headKey
  const onHead = useCallback(
    (names: readonly string[]) => {
      if (headKey !== undefined) publishTableHead(headKey, names)
    },
    [headKey],
  )
  const onTable = props.env?.onTable
  return (
    <div
      ref={clip}
      className={css.flowClip}
      data-over-x={over.x || undefined}
      // 停在最底下的不淡上边：表头钉在那儿，上面滚走的行在表头后面。
      data-over-y={(over.y && !pin) || undefined}
    >
      <div className={css.sheet} style={{ zoom: props.display.zoom / 100 }}>
        <DataTable
          t={props.t}
          text={props.text}
          format={props.format}
          maxRows={WRAP_LINES}
          compact
          marks={props.marks !== undefined ? props.marks : own}
          moreText={props.t('display.moreLines')}
          {...(props.note === undefined ? {} : { note: props.note })}
          numbers={props.tail !== true}
          hide={view.hide}
          sort={view.sort}
          bars={view.bars}
          onSort={
            props.interactive && onTable !== undefined
              ? (sort) => onTable(patchTable(view, { sort }))
              : undefined
          }
          onHead={onHead}
        />
      </div>
    </div>
  )
}

/**
 * 按行读回来的表（`run/lines`）：表头是文件第一行（从头看时就是窗口第一行，看末尾时另读一行），
 * 表体是窗口里其余的行。新加的行 = 这一回窗口里多出来的行首位置（都在末尾）。
 */
function TableLines(props: {
  t: T
  win: LineWindow
  /** 文件第一行（看末尾时另读的）。 */
  head: RunLine | null
  format: 'csv' | 'tsv'
  display: Display
  interactive: boolean
  tail: boolean
  env: TableEnv | undefined
}): React.JSX.Element {
  const { t, win } = props
  const body = win.lines.filter((line) => line.at !== 0)
  const head = props.tail ? props.head : (win.lines.find((line) => line.at === 0) ?? null)
  const text = useMemo(
    () => [head?.text ?? '', ...body.map((line) => line.text)].join('\n'),
    // 窗口就是内容的身份。
    [win, head?.text],
  )
  const marks = useMarks(win, (before, after) => {
    const seen = new Set(before.lines.map((line) => line.at))
    const rows = after.lines.filter((line) => line.at !== 0)
    const added = rows.filter((line) => !seen.has(line.at)).length
    // 整个换了（换了看的位置、文件被重写）不标。
    if (added === 0 || added >= rows.length) return new Set<number>()
    return new Set(Array.from({ length: added }, (_, index) => rows.length - added + index))
  })
  const more = props.tail ? win.before : win.after
  const bytes = props.tail
    ? t('display.earlierBytes').replace('{size}', formatBytes(win.start))
    : t('display.laterBytes').replace('{size}', formatBytes(Math.max(0, win.size - win.end)))
  const sorted =
    props.display.table.sort !== undefined
      ? t('table.sortedLoaded').replace('{n}', body.length.toLocaleString())
      : null
  const note = more ? [sorted, bytes].filter(Boolean).join(' · ') : null
  return (
    <TableFlow
      t={t}
      text={text}
      format={props.format}
      display={props.display}
      interactive={props.interactive}
      env={props.env}
      marks={marks}
      tail={props.tail}
      note={note}
    />
  )
}

// ── 文件夹：图墙 ────────────────────────────────────────────

/** 图墙里读过的图：按「实例 | 资源#项 / 文件名 @ 修改时间」记着，文件没改就不重读（base64 的，别存太多）。 */
const GALLERY_CACHE = 32
const galleryCache = new Map<string, string>()

function rememberTile(key: string, url: string): void {
  galleryCache.set(key, url)
  const oldest = galleryCache.size > GALLERY_CACHE ? galleryCache.keys().next().value : undefined
  if (oldest !== undefined) galleryCache.delete(oldest)
}

/**
 * 图墙露出来的那几张：名字 → 图（`null` = 读不出来）。一张改了，新的读回来之前旧的那张留着；不再露出的扔掉。
 */
function useGalleryImages(
  rpc: WorkflowLiteRpc,
  instance: string,
  node: string,
  item: number,
  entries: readonly RunDirEntry[],
): Readonly<Record<string, string | null>> {
  const [urls, setUrls] = useState<Record<string, string | null>>({})
  const want = entries.map((entry) => `${entry.name}@${entry.mtime}`).join('\n')
  // `want` 就是 `entries` 的身份：内容没变不重来。
  useEffect(() => {
    let alive = true
    const keyOf = (entry: RunDirEntry): string =>
      `${instance}|${node}#${item}/${entry.name}@${entry.mtime}`
    setUrls((last) => {
      const next: Record<string, string | null> = {}
      for (const entry of entries) {
        const hit = galleryCache.get(keyOf(entry)) ?? last[entry.name]
        if (hit !== undefined) next[entry.name] = hit
      }
      return next
    })
    for (const entry of entries) {
      const key = keyOf(entry)
      if (galleryCache.has(key)) continue
      rpc
        .call('run/image', { id: instance, node, item, sub: entry.name })
        .then(({ mime, data }) => {
          const url = `data:${mime};base64,${data}`
          rememberTile(key, url)
          if (alive) setUrls((last) => ({ ...last, [entry.name]: url }))
        })
        .catch(() => {
          if (alive) setUrls((last) => ({ ...last, [entry.name]: null }))
        })
    }
    return () => {
      alive = false
    }
  }, [rpc, instance, node, item, want])
  return urls
}

/** 图墙的这一份和上一份比：新加的、改过的那几张（按现在的排序，第几张）。第一次列出来不标。 */
function newTiles(before: string | null, after: string | null): ReadonlySet<number> {
  const marked = new Set<number>()
  if (before === null || after === null) return marked
  const seen = new Set(before.split('\n'))
  after.split('\n').forEach((key, index) => {
    if (key !== '' && !seen.has(key)) marked.add(index)
  })
  return marked
}

/**
 * 文件夹排成图墙：里面的图从新到旧，最新的一张占左上角的大格（格子够多时），露不下的写在最后一格「+N」里。
 * 图少时按张数重排，最后一行摊开占满、不留空格（见 `galleryLayout`）。每格按「摆放方式」铺满或完整放进去；进了交互点一格打开文件夹、
 * 直接看那一张。新加、改过的那几张描一圈亮边再淡下去。文件夹里没有图时列出里面的文件。
 */
function GalleryView(props: {
  t: T
  run: NonNullable<DisplayEnv['run']>
  node: string
  display: Display
  interactive: boolean
  /** 文件夹变了（修改时间）就重列。 */
  signal: number
  /** 点一格：打开文件夹看这一张。 */
  onOpen?: ((sub: string) => void) | undefined
}): React.JSX.Element {
  const { t, run, node, display } = props
  const [listing, setListing] = useState<{ dir: RunDirResponse | null; error: string | null }>({
    dir: null,
    error: null,
  })
  useEffect(() => {
    let alive = true
    run.rpc
      .call('run/dir', { id: run.instance, node, item: display.item })
      .then((dir) => {
        if (alive) setListing({ dir, error: null })
      })
      .catch((reason: unknown) => {
        if (alive) setListing((last) => ({ dir: last.dir, error: errorMessage(reason) }))
      })
    return () => {
      alive = false
    }
  }, [run.rpc, run.instance, node, display.item, props.signal])
  const dir = listing.dir
  const view = display.gallery
  // 「只看」先筛，图片墙、文件列表都只排筛剩下的。
  const entries = useMemo(() => {
    const keep = nameMatcher(view.match)
    return (dir?.entries ?? []).filter((entry) => keep(entry.name))
  }, [dir, view.match])
  const images = useMemo(
    () =>
      entries
        .filter((entry) => !entry.dir && fileKindOf(entry.name) === 'image')
        .sort(folderOrder(view.order)),
    [entries, view.order],
  )
  // 有几张图、几项交给设置浮层（「自动」现在是哪种）。
  const factsKey = displayKey(node, display.item)
  useEffect(() => {
    if (dir !== null) {
      publishFolderFacts(factsKey, { images: images.length, entries: entries.length })
    }
  }, [dir, factsKey, images.length, entries.length])
  const asImages = (view.show ?? 'images') === 'images' && images.length > 0
  const layout = galleryLayout(display.width, display.height, images.length, view)
  const tracks = galleryTracks(layout)
  const single = layout.slots === 1
  // 列文件时一张图都不读。
  const shown = asImages ? images.slice(0, layout.slots) : []
  const urls = useGalleryImages(run.rpc, run.instance, node, display.item, shown)
  const marks = useMarks(
    dir === null ? null : images.map((entry) => `${entry.name}@${entry.mtime}`).join('\n'),
    newTiles,
  )

  if (dir === null) {
    return listing.error === null ? (
      <div className={css.loading} aria-busy="true" />
    ) : (
      <DisplayState icon="alert" title={t('display.failed')} sub={listing.error} tone="error" />
    )
  }
  if (!asImages) {
    if (entries.length === 0 && view.match !== undefined) {
      return (
        <DisplayState icon="search" title={t('display.matchNone').replace('{match}', view.match)} />
      )
    }
    return <FolderList t={t} entries={entries} view={view} />
  }
  const hidden = images.length - shown.length
  return (
    <div
      className={css.gallery}
      data-fit={display.fit === 'cover' ? 'cover' : 'contain'}
      style={{
        gridTemplateColumns: tracks.columns,
        gridTemplateRows: tracks.rows,
        gap: GALLERY_GAP,
      }}
      data-testid="wl-display-gallery"
    >
      {shown.map((entry, index) => {
        const hero = layout.hero && index === 0
        const last = index === shown.length - 1
        // 只露一张的不盖「+N」（盖住了就看不到那张了），张数写在名字后面。
        const more = last && hidden > 0 && !single ? hidden + 1 : 0
        // 最后一行不满：那几张摊开占满。
        const span = layout.spans[index - (shown.length - layout.spans.length)] ?? 1
        const url = urls[entry.name]
        const Tile = props.interactive && props.onOpen !== undefined ? 'button' : 'div'
        return (
          <Tile
            key={entry.name}
            {...(Tile === 'button'
              ? { type: 'button' as const, onClick: () => props.onOpen?.(entry.name) }
              : {})}
            className={css.tile}
            data-hero={hero || undefined}
            data-new={marks?.items.has(index) === true ? marks.parity : undefined}
            data-tip={props.interactive && !hero ? entry.name : undefined}
            aria-label={entry.name}
            style={
              hero
                ? {
                    gridColumn: `span ${layout.heroSpan.columns}`,
                    gridRow: `span ${layout.heroSpan.rows}`,
                  }
                : span > 1
                  ? { gridColumn: `span ${span}` }
                  : undefined
            }
            data-testid="wl-display-tile"
          >
            {url === null ? (
              <Icon name="alert" size={14} />
            ) : (
              url !== undefined && (
                <img
                  key={url}
                  className={css.tileImage}
                  src={url}
                  alt=""
                  draggable={false}
                  decoding="async"
                />
              )
            )}
            {hero && (
              <span className={css.tileName}>
                {single && hidden > 0
                  ? t('display.galleryOf')
                      .replace('{name}', entry.name)
                      .replace('{n}', images.length.toLocaleString())
                  : entry.name}
              </span>
            )}
            {more > 0 && (
              <span className={css.tileMore} data-testid="wl-display-more">
                +{more.toLocaleString()}
              </span>
            )}
          </Tile>
        )
      })}
    </div>
  )
}

/** 列表最多排几项（再多写「还有 N 项」）。 */
const FOLDER_ROWS = 40

/**
 * 文件夹按文件列出（没有图片、或设成「文件列表」）：文件夹在前，其余按设置排。
 * 一行一项（右边大小，可带修改时间），或排成格子（大一号的类型标记、名字两行、大小）。
 */
function FolderList(props: {
  t: T
  entries: readonly RunDirEntry[]
  view: FolderSettings
}): React.JSX.Element {
  const { t, view } = props
  if (props.entries.length === 0) {
    return <DisplayState icon="folder" title={t('display.folderEmpty')} />
  }
  const order = folderOrder(view.order)
  const sorted = [...props.entries].sort((a, b) => (a.dir === b.dir ? order(a, b) : a.dir ? -1 : 1))
  const rest = sorted.length - FOLDER_ROWS
  const grid = view.list === 'grid'
  const mark = (entry: RunDirEntry, large: boolean): React.JSX.Element =>
    entry.dir ? (
      <Icon name="folder" size={large ? 16 : 12} />
    ) : (
      <FileTag path={entry.name} large={large} />
    )
  return (
    <div className={css.flowClip}>
      <ul
        className={grid ? css.folderGrid : css.folderList}
        data-testid="wl-display-folder"
        data-layout={grid ? 'grid' : 'rows'}
      >
        {sorted.slice(0, FOLDER_ROWS).map((entry) =>
          grid ? (
            <li key={entry.name} className={css.folderCell}>
              <span className={css.folderCellIcon}>{mark(entry, true)}</span>
              <span className={css.folderCellName}>{entry.name}</span>
              {!entry.dir && <span className={css.folderCellMeta}>{formatBytes(entry.size)}</span>}
              {view.time === true && (
                <span className={css.folderCellMeta}>{shortTime(entry.mtime)}</span>
              )}
            </li>
          ) : (
            <li key={entry.name} className={css.folderRow}>
              <span className={css.folderIcon}>{mark(entry, false)}</span>
              <span className={css.folderName}>{entry.name}</span>
              {view.time === true && (
                <span className={css.folderTime}>{shortTime(entry.mtime)}</span>
              )}
              {!entry.dir && <span className={css.folderSize}>{formatBytes(entry.size)}</span>}
            </li>
          ),
        )}
        {rest > 0 && (
          <li className={css.folderMore}>
            {t('display.folderMore').replace('{n}', rest.toLocaleString())}
          </li>
        )}
      </ul>
    </div>
  )
}

/** 筛着看时卡片左上角那句：「23 行匹配」「200+ 行匹配」「最近 64 MB 里 3 行匹配」；反选时是「显示 N 行」。 */
function matchSummary(t: T, win: LineWindow, filter: LineFilter, from: 'end' | 'start'): string {
  const count = win.matched.toLocaleString()
  const more = from === 'end' ? win.before : win.after
  if (win.stopped !== undefined && from === 'end') {
    return t(filter.invert ? 'display.shownRecent' : 'display.matchRecent')
      .replace('{size}', formatBytes(win.end - win.start))
      .replace('{n}', count)
  }
  return t(filter.invert ? 'display.shown' : 'display.matched').replace(
    '{n}',
    more ? `${count}+` : count,
  )
}

/**
 * 实例里的一份文件：在不在看 `stat`，修改时间变了重读。`kept` 给了就显示存下的那一版（不看现在的文件在不在）。
 * 现在的文件更新了（读回来的修改时间变了）告诉外面一声（`onFresh`：卡片右上角说「刚更新」）。
 */
function RunFileView(props: {
  t: T
  run: NonNullable<DisplayEnv['run']>
  node: string
  item: ResourceItem
  display: Display
  interactive: boolean
  writing: boolean
  kept?: number | null
  onFresh?: () => void
  /** 打开这一项（文件夹的话直接看里面的某一份）。 */
  onOpen?: ((sub: string) => void) | undefined
  /** 日志筛着看时匹配了多少（卡片左上角写出来）；不筛是 `null`。 */
  onMatch?: (text: string | null) => void
  /** 进了交互点表头排序：写回设置。 */
  onTable?: ((table: TableView | undefined) => void) | undefined
}): React.JSX.Element {
  const { t, run, node, display } = props
  const kept = props.kept ?? null
  const stat = run.stats[displayKey(node, display.item)]
  const live = stat?.exists === true ? stat.mtime : null
  // 什么时候重读：旧版只读一次（它不会再变），现在的文件跟着修改时间。
  const signal = kept === null ? live : `v${kept}`
  const name = fileBaseName(props.item.value)
  // 日志、纯文本（.log、.txt、.jsonl）和 CSV / TSV 按行读：只拿要显示的那几百行，文件变了只续读新追加的。
  // UTF-16 的不按行读，退回整份读（太大时读最后一截）。
  const table = display.kind === 'text' ? tableFormat(props.item.value) : null
  const tail = display.kind === 'text' && (table !== null || textWraps(props.item.value))
  const filter = table === null ? activeFilter(display.lines.filter) : undefined
  const from = linesFrom(table === null ? display.lines : display.table, {
    log: extensionOf(props.item.value) === 'log',
    writing: props.writing && kept === null,
    size: stat?.size ?? 0,
  })
  const target = tail
    ? { node, item: display.item, ...(kept === null ? {} : { version: kept }) }
    : null
  // 表格从头看时表头就是第一行，多要一行。
  const limit = table !== null && from === 'start' ? CARD_LINES + 1 : CARD_LINES
  const lines = useRunLines(run.rpc, run.instance, target, { from, limit, filter }, signal)
  // 表格看末尾：表头（文件第一行）另读。
  const headLine = useRunLines(
    run.rpc,
    run.instance,
    table !== null && from === 'end' ? target : null,
    { from: 'start', limit: 1, filter: undefined },
    signal,
  )
  const byLines = tail && lines.kind !== 'utf16'
  const tableEnv: TableEnv = { headKey: displayKey(node, display.item), onTable: props.onTable }
  const image = useDisplayImage(
    run.rpc,
    run.instance,
    node,
    display.item,
    kept,
    display.kind === 'image' ? signal : null,
  )
  const loaded = useRunFile(
    run.rpc,
    run.instance,
    display.kind === 'image' || display.kind === 'gallery' || byLines || signal === null
      ? null
      : {
          node,
          item: display.item,
          ...(kept === null ? {} : { version: kept }),
          ...(tail && table === null ? { tail: true } : {}),
        },
    signal ?? 0,
  )
  const shot = useHeld(image.url === null ? null : image)
  const file = useHeld(loaded.file)
  const images = useRunImages(run.rpc, run.instance, { node, item: display.item })

  // 现在的文件读回来一份新的（不是第一份、不是从旧版切回来）：告诉外面。
  const fresh =
    kept !== null
      ? null
      : display.kind === 'image'
        ? image.at
        : display.kind === 'gallery'
          ? live
          : byLines
            ? lines.win?.mtime
            : loaded.file?.mtime
  const lastFresh = useRef<unknown>(null)
  const onFresh = useRef(props.onFresh)
  onFresh.current = props.onFresh
  useEffect(() => {
    if (fresh == null) {
      lastFresh.current = null
      return
    }
    if (lastFresh.current !== null && lastFresh.current !== fresh) onFresh.current?.()
    lastFresh.current = fresh
  }, [fresh])

  // 筛着看：匹配了多少交给外面（写在卡片左上角）。
  const matchText =
    byLines && filter !== undefined && lines.win !== null
      ? matchSummary(t, lines.win, filter, from)
      : null
  const onMatch = useRef(props.onMatch)
  onMatch.current = props.onMatch
  useEffect(() => {
    onMatch.current?.(matchText)
  }, [matchText])
  useEffect(() => () => onMatch.current?.(null), [])

  if (kept === null && stat === undefined) return <div className={css.loading} aria-busy="true" />
  if (kept === null && stat?.exists !== true) {
    return (
      <DisplaySketch
        display={display}
        icon={props.writing ? 'hourglass' : 'clock'}
        title={props.writing ? t('display.writing') : t('display.missing')}
        sub={name}
        busy={props.writing}
      />
    )
  }
  if (display.kind === 'gallery') {
    return (
      <GalleryView
        t={t}
        run={run}
        node={node}
        display={display}
        interactive={props.interactive}
        signal={live ?? 0}
        onOpen={props.onOpen}
      />
    )
  }
  if (display.kind === 'image') {
    if (shot?.url != null) {
      // 图更新了：新图读回来再换一层、淡入（读的时候上一张留着）。
      return (
        <div key={shot.at} className={css.fresh}>
          <ImageView name={name} url={shot.url} display={display} />
        </div>
      )
    }
    if (image.error !== null) {
      return (
        <DisplayState icon="alert" title={t('display.failed')} sub={image.error} tone="error" />
      )
    }
    return <div className={css.loading} aria-busy="true" />
  }
  if (byLines) {
    if (lines.error !== null) {
      return (
        <DisplayState icon="alert" title={t('display.failed')} sub={lines.error} tone="error" />
      )
    }
    if (lines.kind === 'binary')
      return <DisplayState icon="file" title={t('file.binary')} tone="error" />
    const win = lines.win
    if (win === null) return <div className={css.loading} aria-busy="true" />
    if (table !== null) {
      const head = from === 'end' ? (headLine.win?.lines[0] ?? null) : null
      if (from === 'end' && headLine.win === null) {
        return <div className={css.loading} aria-busy="true" />
      }
      if (win.lines.length === 0) return <DisplayState icon="file" title={t('file.empty')} />
      return (
        <div className={css.fresh}>
          <TableLines
            t={t}
            win={win}
            head={head}
            format={table}
            display={display}
            interactive={props.interactive}
            tail={from === 'end'}
            env={tableEnv}
          />
        </div>
      )
    }
    if (win.lines.length === 0 && win.pending === undefined) {
      if (filter === undefined) return <DisplayState icon="file" title={t('file.empty')} />
      return (
        <DisplayState
          icon="search"
          title={t('display.noMatch')}
          sub={
            win.stopped !== undefined
              ? t('display.noMatchRecent').replace('{size}', formatBytes(win.end - win.start))
              : filter.pattern
          }
        />
      )
    }
    return (
      <div className={css.fresh}>
        <LogFlow
          t={t}
          win={win}
          display={display}
          interactive={props.interactive}
          tail={from === 'end'}
          wrap
          filter={filter}
        />
      </div>
    )
  }
  if (file?.exists) {
    // 网页更新是重新载入一个页面：换一层、淡入。文字原地换（新的几行亮一下）。换一版由外面滑着换（SlideSwap）。
    const layer = display.kind === 'html' ? file.mtime : 'text'
    return (
      <div key={layer} className={css.fresh}>
        <TextView
          t={t}
          file={file}
          path={props.item.value}
          display={display}
          interactive={props.interactive}
          image={images}
          writing={props.writing && kept === null}
          table={tableEnv}
        />
      </div>
    )
  }
  if (loaded.error !== null) {
    return <DisplayState icon="alert" title={t('display.failed')} sub={loaded.error} tone="error" />
  }
  return <div className={css.loading} aria-busy="true" />
}

/**
 * 展示区本体。`interactive` 时接鼠标（网页能点、长文能滚）；平时整块透明于鼠标，双击交给卡片。
 */
export function DisplayBody(props: {
  node: string
  item: ResourceItem
  display: Display
  interactive: boolean
  /** 写它的步骤正在跑。 */
  writing: boolean
  /** 表格卡进了交互点表头排序：写回设置。 */
  onTable?: ((table: TableView | undefined) => void) | undefined
}): React.JSX.Element {
  const { display, item } = props
  const env = useContext(DisplayContext)
  if (env === null) throw new Error('DisplayBody 要放在 DisplayContext 里')
  const { t } = env
  const [ref, seen] = useSeen<HTMLDivElement>()
  const latest = env.run === null ? env.latest : undefined
  const found = latest?.outputs[displayKey(props.node, display.item)]
  const frame = {
    ref,
    className: css.body,
    'data-kind': display.kind,
    'data-interactive': props.interactive || undefined,
    style: displayFootprint(display),
    'data-testid': 'wl-display-body',
  }
  // 实例里的文件：可能存过几版，卡片底下带一条时间线（读之前也是这个组件，展示区不换一个元素）。
  if (env.run !== null && item.kind !== 'text') {
    const open = env.open
    return (
      <RunFileBody
        t={t}
        run={env.run}
        frame={frame}
        seen={seen}
        onOpen={open === undefined ? undefined : (sub) => open(props.node, display.item, sub)}
        {...props}
      />
    )
  }
  let body: React.ReactNode
  if (!seen) body = <div className={css.loading} />
  else if (item.kind === 'text') {
    body =
      item.value.trim() === '' ? (
        <DisplayState icon="note" title={t('file.empty')} />
      ) : (
        <Flow t={t} text={item.value} display={display} />
      )
  } else if (env.run === null && latest !== undefined && found !== undefined) {
    body = <LatestView t={t} rpc={latest.rpc} found={found} {...props} />
  } else {
    body = (
      <DisplaySketch
        display={display}
        icon="eye"
        title={t('display.later')}
        sub={fileBaseName(item.value)}
      />
    )
  }
  return <div {...frame}>{body}</div>
}

/** 「刚更新」亮多久（淡入、停留、淡出一共）。 */
const FRESH_MS = 4000

/**
 * 实例视图里的一份文件，连同它存下的各版：至少两版时卡片底下一条时间线、标题行写出看的是哪一版（{@link HistoryBar}）。
 * 悬停预览的那版优先，其次钉住的那版，都没有就是现在的文件。
 * 右上角一枚小签：写它的步骤在跑时「生成中」，现在的文件更新了「刚更新」（几秒后淡出）。
 */
function RunFileBody(props: {
  t: T
  run: NonNullable<DisplayEnv['run']>
  frame: React.ComponentProps<'div'> & { ref: React.RefObject<HTMLDivElement> }
  seen: boolean
  node: string
  item: ResourceItem
  display: Display
  interactive: boolean
  writing: boolean
  onOpen?: ((sub: string) => void) | undefined
  onTable?: ((table: TableView | undefined) => void) | undefined
}): React.JSX.Element {
  const { t, run, node, display } = props
  const slot = useContext(HistorySlotContext)
  // 状态签：卡片标题行里有位置就挂过去（不压在展示区上），没有（查看框之类）才浮在展示区右上角。
  const chips = (content: React.ReactNode): React.ReactNode =>
    slot?.status ? createPortal(<span className={css.chips}>{content}</span>, slot.status) : content
  const stat = run.stats[displayKey(node, display.item)]
  const history = useRunHistory(
    run.rpc,
    run.instance,
    props.seen ? { node, item: display.item } : null,
    stat?.revision ?? 0,
  )
  const line = historyLine(history, stat)
  /** 钉住的那版，连同钉住时最新的是哪一点（之后又来了新的，最新那点上亮个小点）。 */
  const [pinned, setPinned] = useState<{ v: number; latest: string } | null>(null)
  const [preview, setPreview] = useState<number | null | undefined>(undefined)
  const latestKey = line.dots.at(-1)?.key ?? ''
  // 钉住的那版被删了（超了上限从中间删掉的、存储页清空了）：回到最新。
  const lost =
    pinned !== null &&
    history !== null &&
    !line.dots.some((dot) => dot.version?.v === pinned.v && dot.v !== null)
  useEffect(() => {
    if (lost) setPinned(null)
  }, [lost])
  const pinnedV = pinned === null || lost ? null : pinned.v
  const shown = line.dots.length < 2 ? null : preview !== undefined ? preview : pinnedV
  // 显示的是最新那点：读现在的文件（最新那点也可能就是存下的最后一版，读哪个都一样，读现在的）。
  const kept = shown === null ? null : (line.dots[dotIndex(line, shown)]?.v ?? null)
  // 换一版：新的从行进方向滑进来（往后的版从右边进）。
  const layer = kept === null ? 'live' : `v${kept}`
  const dir = useTrend(line.dots.length < 2 ? 0 : dotIndex(line, shown))
  const showing = useRef(layer)
  showing.current = layer
  // 现在的文件刚更新：右上角「刚更新」亮一会儿（每次更新从头来）；写它的步骤在跑时一直是「生成中」。
  const [fresh, setFresh] = useState(0)
  useEffect(() => {
    if (fresh === 0) return
    const timer = window.setTimeout(() => setFresh(0), FRESH_MS)
    return () => window.clearTimeout(timer)
  }, [fresh])
  const live = props.writing && kept === null && stat?.exists === true
  const [match, setMatch] = useState<string | null>(null)
  const filter = props.display.lines.filter

  return (
    <>
      <div {...props.frame}>
        {props.seen ? (
          <SlideSwap id={layer} dir={dir}>
            {(id) => (
              <RunFileView
                t={t}
                run={run}
                node={node}
                item={props.item}
                display={display}
                interactive={props.interactive}
                writing={props.writing}
                kept={id === 'live' ? null : Number(id.slice(1))}
                onFresh={() => setFresh(Date.now())}
                onOpen={props.onOpen}
                // 只听要显示的那一版（滑走的那层卸下时会报个空）。
                onMatch={(text) => {
                  if (id === showing.current) setMatch(text)
                }}
                onTable={props.onTable}
              />
            )}
          </SlideSwap>
        ) : (
          <div className={css.loading} />
        )}
      </div>
      {chips(
        <>
          {match !== null && filter !== undefined && (
            <span
              className={css.chip}
              data-side="left"
              data-tip={t('display.filterTip').replace('{pattern}', filter.pattern)}
              data-testid="wl-display-match"
            >
              <Icon name="search" size={11} />
              {match}
            </span>
          )}
          {live ? (
            <span className={css.chip} data-live data-testid="wl-display-live">
              <span className={css.chipDot} />
              {t('display.live')}
            </span>
          ) : (
            fresh !== 0 && (
              <span key={fresh} className={css.chip} data-fresh data-testid="wl-display-fresh">
                <span className={css.chipDot} />
                {t('display.updated')}
              </span>
            )
          )}
        </>,
      )}
      {line.dots.length >= 2 && (
        <HistoryBar
          t={t}
          slot={slot?.slot ?? null}
          rail={slot?.rail ?? null}
          line={line}
          names={run.names ?? {}}
          shown={shown}
          previewing={preview !== undefined}
          pinned={pinnedV}
          newer={pinned !== null && pinned.latest !== latestKey}
          onPreview={setPreview}
          onPin={(v) => {
            setPreview(undefined)
            setPinned(v === null ? null : { v, latest: latestKey })
          }}
        />
      )}
    </>
  )
}

/** 模板里的「上次执行」：那个实例里那一份，读法和实例视图一样（那边的项号、修改时间）。 */
function LatestView(props: {
  t: T
  rpc: WorkflowLiteRpc
  found: RunLatestOutput
  node: string
  item: ResourceItem
  display: Display
  interactive: boolean
  onTable?: ((table: TableView | undefined) => void) | undefined
}): React.JSX.Element {
  const { found } = props
  const run = useMemo(
    () => ({
      rpc: props.rpc,
      instance: found.instance,
      stats: {
        [displayKey(props.node, found.item)]: {
          exists: true,
          size: found.size,
          mtime: found.mtime,
          versions: 0,
          revision: 0,
        },
      },
    }),
    [props.rpc, props.node, found.instance, found.item, found.size, found.mtime],
  )
  return (
    <RunFileView
      t={props.t}
      run={run}
      node={props.node}
      item={props.item}
      display={{ ...props.display, item: found.item }}
      interactive={props.interactive}
      writing={false}
      onTable={props.onTable}
    />
  )
}
