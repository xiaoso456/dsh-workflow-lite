/**
 * dsh-workflow-lite — 实例里点开一个文件夹资源：左边浏览、右边预览。
 *
 * 左边是这一层的内容（目录在前）：上面一个搜索框（只筛这一层的名字，命中的字标出来），下面是面包屑和列表；
 * 点目录进去、点文件在右边看它，面包屑和「返回」能退回任何一层。键盘也能用：↑ ↓ 选，→ / 回车进目录，
 * ← 退一层，直接打字就是搜索，Esc 先清掉搜索、再关框。右边按文件的样子预览：Markdown / HTML 可切源码，
 * 图片整张显示、点一下放大，其余文本原样；标题行有复制路径、用其他程序打开。
 *
 * 看的都是文件夹资源里面的东西：每次请求带着「资源 + 往下的相对路径」，由主机把关，走不出这个文件夹。
 * 动的只有 transform / opacity：换层和文件选择框一个做法——新一层读回来后，旧列表留个影子往外退、新列表从另一侧进来
 * （{@link useStage}），面包屑长出一级从前一级背后展开、缩短时收回去（{@link useTrail}）；选中块跟着光标上下滑。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FolderBrowser
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RunDirEntry, RunDirResponse, RunFileResponse } from '../../shared/wire.ts'
import type { Desktop } from '../app/desktop.ts'
import {
  type FileTarget,
  fileTargetKey,
  useRunDir,
  useRunFile,
  useRunImages,
} from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { extensionOf, fileBaseName, fileKindOf, formatBytes } from '../model/fileKind.ts'
import {
  crumbsOf,
  filterEntries,
  joinSub,
  parentSub,
  splitByRanges,
  stepCursor,
} from '../model/folderBrowse.ts'
import { shortTime } from '../model/time.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { FilterBar, PathBar, UpRow } from './DirParts.tsx'
import { CopyButton, type DocBody, DocContent, docFormat } from './DocViewer.tsx'
import { FileTag } from './FileTag.tsx'
import { fileBody } from './FileViewer.tsx'
import files from './files.module.css'
import css from './folder.module.css'
import { Icon } from './Icon.tsx'
import { type StageDir, SwapNode, SwapText, useStage, useTrail } from './motion.tsx'
import { OpenWith } from './OpenWith.tsx'
import picker from './picker.module.css'
import { cx } from './primitives.tsx'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'

/** 列表每行的高度（px）。CSS 里读的是同一个值（`--fb-row`）：选中块按「第几行 × 行高」摆。 */
const ROW = 28

/** 骨架行宽窄错开，像一串文件名。 */
const SKELETON_ROWS = ['58%', '72%', '44%', '66%', '52%', '78%']

type View = 'rendered' | 'source'

/** 不列 `.` 开头的项（搜索词本身以 `.` 开头、或打开了「隐藏项」时照列）。 */
function withoutHidden(
  entries: readonly RunDirEntry[],
  showHidden: boolean,
  query: string,
): readonly RunDirEntry[] {
  return showHidden || query.trim().startsWith('.')
    ? entries
    : entries.filter((entry) => !entry.name.startsWith('.'))
}

export function FolderBrowser(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  node: string
  index: number
  /** 文件夹本身叫什么（面包屑的根）。 */
  rootName: string
  desktop: Desktop | undefined
}): React.JSX.Element {
  const { t, rpc, instance, node, index } = props
  const [sub, setSub] = useState('')
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  /** 要不要列出 `.` 开头的项（和选择框一样，默认不列）。 */
  const [showHidden, setShowHidden] = useState(false)
  /** 窄屏时一次只看一栏：列表还是预览。 */
  const [pane, setPane] = useState<'list' | 'preview'>('list')
  const { dir: arrived, error } = useRunDir(rpc, instance, node, index, sub)
  /** 列表上摆着的那一层：新一层读回来之前它还是上一层，读回来后先让旧的退场，再换上新的（见下面的 effect）。 */
  const [dir, setDir] = useState<RunDirResponse | null>(null)
  /** 换层的方向：进去 1、退出来 -1（决定旧的往哪边退、新的从哪边进）。 */
  const heading = useRef<StageDir>(0)
  /** 换层后光标落在哪一项（退回上一层时落在刚离开的那个目录上）；新一层换上时才用。 */
  const landing = useRef<string | null>(null)
  const stage = useStage({ outMs: 90, delayMs: 80 })
  const crumbsFlip = useTrail()
  const uid = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const rowsRef = useCallback(
    (node: HTMLDivElement | null): void => {
      stage.body.current = node
    },
    [stage.body],
  )
  const searchRef = useRef<HTMLInputElement>(null)

  /** 列表是不是已经换成了 `sub` 这一层（读回来之前还是上一层的，那时不让点）。 */
  const fresh = dir !== null && dir.sub === sub
  const entries = useMemo(() => dir?.entries ?? [], [dir])
  const listed = useMemo(
    () => withoutHidden(entries, showHidden, query),
    [entries, showHidden, query],
  )
  const visible = useMemo(() => filterEntries(listed, query), [listed, query])
  const names = useMemo(() => visible.map((item) => item.entry.name), [visible])
  const at = cursor === null ? -1 : names.indexOf(cursor)
  const current = at < 0 ? null : (visible[at]?.entry ?? null)
  const dirs = useMemo(() => listed.filter((entry) => entry.dir).length, [listed])
  /** 列表上摆着的是哪一层（读回来之前还是上一层，「上一级」行、它右边写的名字都跟着它走，不跟目标层）。 */
  const shownSub = dir === null ? sub : dir.sub
  /** 列表第一行是「上一级」（不在根上时）：光标行、选中块都往下让一行。 */
  const lead = shownSub === '' ? 0 : 1

  // 打开就把焦点放在列表上：方向键、回车立刻能用，打字会转去搜索框。
  useEffect(() => {
    listRef.current?.focus({ preventScroll: true })
  }, [])

  // 新一层读回来了：旧的那一层留个影子往外退（要趁它还在页面上），再换上新的，新的从该来的一侧进来。
  useEffect(() => {
    if (arrived === null || arrived.sub !== sub || arrived === dir) return
    if (dir !== null && dir.sub !== arrived.sub) stage.leave(heading.current)
    // 搜索词、光标跟着新的一层一起换：读回来之前旧列表原样压暗在那儿，不跟着跳。
    if (dir === null || dir.sub !== arrived.sub) {
      setQuery('')
      setCursor(landing.current)
    }
    setDir(arrived)
  }, [arrived, dir, sub, stage])
  useLayoutEffect(() => {
    if (dir === null) return
    listRef.current?.scrollTo({ top: 0 })
    stage.enter(heading.current)
  }, [dir?.sub, stage])

  // 光标走出可视区时把它带回来（换层后先回到顶，再带光标；所以也跟着 dir 走）。
  useEffect(() => {
    const list = listRef.current
    const rows = stage.body.current
    if (list === null || rows === null || at < 0) return
    const top = rows.offsetTop + (at + lead) * ROW
    const bottom = top + ROW
    if (top - 4 < list.scrollTop) list.scrollTop = Math.max(0, top - 4)
    else if (bottom + 4 > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom + 4 - list.clientHeight
    }
  }, [at, lead, dir, stage.body])

  /** 去 `next` 那一层；`land` 是到了以后光标落在哪一项（退回上一层时落在刚离开的那个目录上）。 */
  const go = (next: string, move: 1 | -1, land: string | null = null): void => {
    if (next === sub) return
    heading.current = move
    landing.current = land
    setSub(next)
    setPane('list')
  }
  const up = (): void => {
    if (sub === '') return
    go(parentSub(sub), -1, sub.slice(sub.lastIndexOf('/') + 1))
  }
  const open = (entry: RunDirEntry): void => {
    if (!fresh) return
    if (entry.dir) go(joinSub(sub, entry.name), 1)
    else {
      setCursor(entry.name)
      setPane('preview')
    }
  }
  const search = (value: string): void => {
    setQuery(value)
    // 筛出来的第一项当光标：打完字回车就是它。
    setCursor(
      value.trim() === ''
        ? cursor
        : (filterEntries(withoutHidden(entries, showHidden, value), value)[0]?.entry.name ?? null),
    )
  }
  const move = (to: 'next' | 'prev' | 'first' | 'last'): void => {
    const next = stepCursor(names, current?.name ?? null, to)
    if (next !== null) setCursor(next)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const typing = event.target instanceof HTMLInputElement
    const handled = (): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    switch (event.key) {
      case 'ArrowDown':
        handled()
        move('next')
        return
      case 'ArrowUp':
        handled()
        move('prev')
        return
      case 'Home':
      case 'End':
        if (typing) return
        handled()
        move(event.key === 'Home' ? 'first' : 'last')
        return
      case 'Enter':
        if (current === null) return
        handled()
        open(current)
        return
      case 'ArrowRight':
        if (typing || current === null || !current.dir) return
        handled()
        open(current)
        return
      case 'ArrowLeft':
        if (typing || sub === '') return
        handled()
        up()
        return
      case 'Backspace':
        if (typing || sub === '') return
        handled()
        up()
        return
      case 'Escape':
        // 有搜索词先清掉它；没有就不拦，让框自己关。
        if (query === '') return
        handled()
        search('')
        searchRef.current?.blur()
        listRef.current?.focus({ preventScroll: true })
        return
      default:
        // 直接打字就是搜索：焦点转去搜索框，这个字符带过去。
        if (!typing && event.key.length === 1 && event.key !== ' ') {
          handled()
          search(query + event.key)
          searchRef.current?.focus({ preventScroll: true })
        }
    }
  }

  const crumbs = crumbsOf(props.rootName, sub)
  const filtering = query.trim() !== ''
  const count = filtering
    ? t('folder.countOf')
        .replace('{n}', String(visible.length))
        .replace('{total}', String(listed.length))
    : t('folder.count').replace('{n}', String(listed.length))
  const tally = t('folder.tally')
    .replace('{dirs}', String(dirs))
    .replace('{files}', String(listed.length - dirs))
  /** 「上一级」右边写的：上一级是哪儿。 */
  const parent = parentSub(shownSub)
  const parentLabel = parent === '' ? props.rootName : `${props.rootName}/${parent}`

  let rows: React.ReactNode
  if (error !== null && !fresh) {
    rows = (
      <p className={css.note}>
        <Icon name="alert" size={14} />
        {error}
      </p>
    )
  } else if (dir === null) {
    rows = (
      <div className={css.skeleton} role="status" aria-label={t('file.loading')}>
        {SKELETON_ROWS.map((width) => (
          <span key={width} style={{ width }} />
        ))}
      </div>
    )
  } else if (!dir.exists) rows = <p className={css.note}>{t('res.folderMissing')}</p>
  else {
    rows = (
      <>
        <div
          ref={rowsRef}
          className={css.rows}
          style={visible.length === 0 ? undefined : { minHeight: (visible.length + lead) * ROW }}
        >
          <span
            key={dir.sub}
            className={css.thumb}
            data-on={at >= 0}
            style={{ transform: `translateY(${(Math.max(at, 0) + lead) * ROW}px)` }}
            aria-hidden="true"
          />
          {lead > 0 && (
            <UpRow
              label={t('pick.up')}
              meta={parentLabel}
              tip={`${t('pick.up')}（${t('folder.upKeys')}）`}
              tabIndex={-1}
              testId="wl-folder-up"
              onClick={up}
            />
          )}
          {listed.length === 0 && <p className={css.note}>{t('res.folderEmpty')}</p>}
          {listed.length > 0 && visible.length === 0 && (
            <p className={css.note} data-testid="wl-folder-nomatch">
              {t('folder.noMatch').replace('{q}', query.trim())}
              <button type="button" className={css.link} onClick={() => search('')}>
                {t('folder.clear')}
              </button>
            </p>
          )}
          {visible.map(({ entry, ranges }, position) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘在列表（listbox）上统一处理：方向键、回车
            <div
              key={entry.name}
              id={`${uid}-${position}`}
              role="option"
              tabIndex={-1}
              aria-selected={position === at}
              className={css.row}
              data-dir={entry.dir}
              data-cursor={position === at}
              data-testid="wl-folder-entry"
              data-name={entry.name}
              onClick={() => open(entry)}
            >
              <span className={picker.entryIcon} data-dir={entry.dir}>
                <Icon name={entry.dir ? 'folder' : 'file'} size={15} />
              </span>
              <span className={css.name}>
                {splitByRanges(entry.name, ranges).map((part, partIndex) =>
                  part.hit ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 名字切出来的几块，只在这一行里按次序排
                    <mark key={partIndex} className={css.hit}>
                      {part.text}
                    </mark>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                    <span key={partIndex}>{part.text}</span>
                  ),
                )}
              </span>
              <span className={css.end}>
                {entry.dir ? <Icon name="chevronRight" size={12} /> : formatBytes(entry.size)}
              </span>
            </div>
          ))}
        </div>
        {dir.truncated && (
          <p className={css.more}>{t('folder.more').replace('{n}', String(entries.length))}</p>
        )}
      </>
    )
  }

  // 光标在文件上就看它（路径按列表上摆着的那一层拼，不按目标层：读回来之前光标还指着旧层的文件）。
  // 光标到了目录上、或换层清空了光标，右边不动，继续看最近看的那份：换层不会把整块预览卸掉再空一下。
  const live = current !== null && !current.dir ? joinSub(shownSub, current.name) : null
  const [sticky, setSticky] = useState<string | null>(null)
  useEffect(() => {
    if (live !== null) setSticky(live)
  }, [live])
  const previewPath = live ?? sticky

  return (
    <div className={css.frame}>
      <div className={css.browser} data-pane={pane} data-testid="wl-folder-browser">
        <section className={css.side}>
          {/* 顶上一条和右边标题行等高：路径栏（一级一个单元，见 PathBar）。 */}
          <div className={css.top}>
            <PathBar
              label={t('folder.list')}
              navRef={crumbsFlip}
              plain
              style={{ flex: '1 1 auto', margin: 0 }}
              testId="wl-folder-crumbs"
              crumbs={crumbs.map((crumb, position) => ({
                key: crumb.sub ?? '…',
                label: crumb.label,
                ...(crumb.sub === null
                  ? {}
                  : { onGo: () => go(crumb.sub ?? '', position === crumbs.length - 1 ? 1 : -1) }),
              }))}
            />
          </div>
          <FilterBar
            inputRef={searchRef}
            value={query}
            placeholder={t('folder.search')}
            onChange={search}
            hiddenLabel={t('pick.hidden')}
            hidden={showHidden}
            onHidden={() => setShowHidden((value) => !value)}
            onKeyDown={onKeyDown}
            plain
            testId="wl-folder-search"
            style={{ '--wl-sheet-inset': '12px' } as React.CSSProperties}
            trailing={
              dir?.exists === true && listed.length > 0 ? (
                <span className={css.count}>{count}</span>
              ) : undefined
            }
          />

          {/* 外面这层只管定位和裁切：换层时旧列表的影子在里面往外退（useStage），不能越出列表框。 */}
          <div
            className={css.listWrap}
            ref={stage.wrap}
            style={{ '--fb-row': `${ROW}px` } as React.CSSProperties}
          >
            <div
              ref={listRef}
              className={css.list}
              role="listbox"
              tabIndex={0}
              aria-label={t('folder.list')}
              aria-activedescendant={at >= 0 ? `${uid}-${at}` : undefined}
              onKeyDown={onKeyDown}
              data-stale={!fresh}
              data-testid="wl-folder-entries"
            >
              {rows}
            </div>
          </div>
          <p className={css.keys}>{t('folder.keys')}</p>
        </section>

        <section className={css.main} data-testid="wl-folder-preview">
          {previewPath === null ? (
            <div
              className={cx(css.empty, files.viewerReveal)}
              key={current?.dir === true ? 'dir' : 'none'}
            >
              <span className={css.emptyIcon}>
                <Icon name={current?.dir === true ? 'folderOpen' : 'file'} size={20} />
              </span>
              <p className={css.emptyTitle}>
                {current?.dir === true ? t('folder.dirHint') : t('folder.pick')}
              </p>
              {entries.length > 0 && <p className={css.emptySub}>{tally}</p>}
            </div>
          ) : (
            <FilePane
              t={t}
              rpc={rpc}
              instance={instance}
              target={{ node, item: index, sub: previewPath }}
              desktop={props.desktop}
              onBack={() => setPane('list')}
            />
          )}
        </section>
      </div>
    </div>
  )
}

/** 右边摆着的那一份：哪个目标、读回来的结果（文件或错误）。 */
interface Shown {
  key: string
  target: Extract<FileTarget, { node: string }>
  file: RunFileResponse | null
  error: string | null
  /** 从一张图换到另一张图：画布留着、只换图，不整块交接（见 FilePane）。 */
  calm: boolean
}

/** 读回来的是不是一张图。 */
const isImageFile = (file: RunFileResponse | null): boolean =>
  file !== null && file.kind !== 'missing' && fileKindOf(file.display) === 'image'

/**
 * 右边：一份文件的预览（标题行 + 正文）。
 *
 * 换文件时这块不重挂：新文件读回来之前，旧的原样摆着（读得慢才淡下去示意在等）；读回来的那一刻，
 * 标题行换字，正文和左边的列表一个做法——旧正文留个影子很快淡掉，新正文随后进来（{@link useStage}）。
 * 切「预览 / 源码」也走同一套。
 */
function FilePane(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: Extract<FileTarget, { node: string }>
  desktop: Desktop | undefined
  onBack(): void
}): React.JSX.Element {
  const { t, rpc, instance, target } = props
  const want = fileTargetKey(target)
  const { file, error, settled } = useRunFile(rpc, instance, target)
  const [shown, setShown] = useState<Shown | null>(null)
  const [view, setView] = useState<View>('rendered')
  const [failure, setFailure] = useState<string | null>(null)
  const stage = useStage({ outMs: 90, delayMs: 70 })
  const bodyRef = useCallback(
    (node: HTMLDivElement | null): void => {
      stage.body.current = node
    },
    [stage.body],
  )

  // 新文件读回来了：旧正文留个影子（要趁它还在页面上），再换上新的。
  useEffect(() => {
    if (settled !== want || (file === null && error === null) || shown?.key === want) return
    // 图换图：画布（工具条、读数）留着，图自己换，不把整块正文淡出再淡入。
    const calm = isImageFile(shown?.file ?? null) && isImageFile(file)
    if (shown !== null && !calm) stage.leave(0)
    setShown({ key: want, target, file, error, calm })
    setView('rendered')
    setFailure(null)
  }, [settled, want, file, error, shown, target, stage])
  useLayoutEffect(() => {
    if (shown === null) return
    if (shown.calm) return
    stage.body.current?.scrollTo({ top: 0 })
    stage.enter(0)
  }, [shown?.key, view, stage])

  const showing = shown?.target ?? target
  const name = fileBaseName(showing.sub ?? '')
  const body: DocBody =
    shown === null
      ? { kind: 'loading' }
      : fileBody({
          t,
          rpc,
          instance,
          target: shown.target,
          file: shown.file,
          error: shown.error,
          loading: false,
        })
  const image = useRunImages(rpc, instance, showing)
  const switchable = docFormat(body) !== 'plain'
  const info = shown?.file ?? null

  return (
    <div className={css.pane} data-waiting={shown !== null && shown.key !== want}>
      <header className={css.paneHead}>
        <button
          type="button"
          className={cx(css.paneBack, ui.btn, ui.icon, ui.small)}
          aria-label={t('folder.back')}
          data-tip={t('folder.back')}
          onClick={props.onBack}
        >
          <Icon name="chevronLeft" size={15} />
        </button>
        {/* 类型签、文件名、大小行都不跳：换了就原地换（签换色换字、字上浮），同类型的签不动。 */}
        <SwapNode
          id={extensionOf(name)}
          render={(ext) => <FileTag path={ext === '' ? name : `x.${ext}`} large />}
        />
        <div className={css.paneTitle}>
          <span className={css.paneName}>
            <SwapText text={name} />
          </span>
          <span className={css.paneMeta}>
            <SwapText
              text={
                info?.exists === true
                  ? `${formatBytes(info.size)} · ${t('file.modified')} ${shortTime(info.mtime)}`
                  : ' '
              }
            />
          </span>
        </div>
        {/* 位置一直占着：能切（Markdown / HTML）时淡入归位，不能切时淡出让开，标题宽度不随文件类型变。 */}
        <div className={css.paneViews} data-on={switchable}>
          <Segmented<View>
            label={t('file.rendered')}
            value={view}
            onChange={(next) => {
              stage.leave(0)
              setView(next)
            }}
            options={[
              { value: 'rendered', label: t('file.rendered') },
              { value: 'source', label: t('file.source') },
            ]}
          />
        </div>
        <CopyButton t={t} text={info?.path ?? null} />
        <OpenWith
          t={t}
          desktop={props.desktop}
          path={info?.exists === true ? info.path : null}
          compact
          onError={setFailure}
        />
      </header>
      {failure !== null && <p className={css.paneFailure}>{failure}</p>}
      {/* 外面这层只管定位和裁切：旧正文的影子在里面退（useStage），不能越出预览区。 */}
      <div className={css.paneStage} ref={stage.wrap}>
        <div className={css.paneBody} ref={bodyRef} data-testid="wl-folder-file">
          <DocContent t={t} body={body} view={view} name={name} image={image} />
        </div>
      </div>
    </div>
  )
}
