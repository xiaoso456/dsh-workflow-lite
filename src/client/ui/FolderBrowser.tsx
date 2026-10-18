/**
 * dsh-workflow-lite — 实例里点开一个文件夹资源：左边浏览、右边预览。
 *
 * 左边是这一层的内容（目录在前）：上面一个搜索框（只筛这一层的名字，命中的字标出来），下面是面包屑和列表；
 * 点目录进去、点文件在右边看它，面包屑和「返回」能退回任何一层。键盘也能用：↑ ↓ 选，→ / 回车进目录，
 * ← 退一层，直接打字就是搜索，Esc 先清掉搜索、再关框。右边按文件的样子预览：Markdown / HTML 可切源码，
 * 图片整张显示、点一下放大，其余文本原样；标题行有复制路径、用其他程序打开。
 *
 * 看的都是文件夹资源里面的东西：每次请求带着「资源 + 往下的相对路径」，由主机把关，走不出这个文件夹。
 * 动的只有 transform / opacity：换层时列表朝进入的方向滑入，选中块跟着光标上下滑。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FolderBrowser
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RunDirEntry } from '../../shared/wire.ts'
import type { Desktop } from '../app/desktop.ts'
import { type FileTarget, useRunDir, useRunFile, useRunImages } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import { fileBaseName, formatBytes } from '../model/fileKind.ts'
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
import { CopyButton, DocContent, docFormat } from './DocViewer.tsx'
import { FileTag } from './FileTag.tsx'
import { fileBody } from './FileViewer.tsx'
import files from './files.module.css'
import css from './folder.module.css'
import { Icon } from './Icon.tsx'
import { OpenWith } from './OpenWith.tsx'
import { cx } from './primitives.tsx'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'

/** 列表每行的高度（px）。CSS 里读的是同一个值（`--fb-row`）：选中块按「第几行 × 行高」摆。 */
const ROW = 36

/** 骨架行宽窄错开，像一串文件名。 */
const SKELETON_ROWS = ['58%', '72%', '44%', '66%', '52%', '78%']

type View = 'rendered' | 'source'

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
  /** 窄屏时一次只看一栏：列表还是预览。 */
  const [pane, setPane] = useState<'list' | 'preview'>('list')
  /** 换层的方向：进去 1、退出来 -1（决定列表从哪边滑进来）。 */
  const [heading, setHeading] = useState<1 | -1>(1)
  const { dir, error } = useRunDir(rpc, instance, node, index, sub)
  const uid = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  /** 列表是不是已经换成了 `sub` 这一层（读回来之前还是上一层的，那时不让点）。 */
  const fresh = dir !== null && dir.sub === sub
  const entries = useMemo(() => dir?.entries ?? [], [dir])
  const visible = useMemo(() => filterEntries(entries, query), [entries, query])
  const names = useMemo(() => visible.map((item) => item.entry.name), [visible])
  const at = cursor === null ? -1 : names.indexOf(cursor)
  const current = at < 0 ? null : (visible[at]?.entry ?? null)
  const dirs = useMemo(() => entries.filter((entry) => entry.dir).length, [entries])

  // 打开就把焦点放在列表上：方向键、回车立刻能用，打字会转去搜索框。
  useEffect(() => {
    listRef.current?.focus({ preventScroll: true })
  }, [])

  // 光标走出可视区时把它带回来。
  useEffect(() => {
    const list = listRef.current
    const rows = rowsRef.current
    if (list === null || rows === null || at < 0) return
    const top = rows.offsetTop + at * ROW
    const bottom = top + ROW
    if (top - 4 < list.scrollTop) list.scrollTop = Math.max(0, top - 4)
    else if (bottom + 4 > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom + 4 - list.clientHeight
    }
  }, [at])

  /** 去 `next` 那一层；`land` 是到了以后光标落在哪一项（退回上一层时落在刚离开的那个目录上）。 */
  const go = (next: string, move: 1 | -1, land: string | null = null): void => {
    if (next === sub) return
    setHeading(move)
    setSub(next)
    setQuery('')
    setCursor(land)
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
    setCursor(value.trim() === '' ? cursor : (filterEntries(entries, value)[0]?.entry.name ?? null))
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
        .replace('{total}', String(entries.length))
    : t('folder.count').replace('{n}', String(entries.length))
  const tally = t('folder.tally')
    .replace('{dirs}', String(dirs))
    .replace('{files}', String(entries.length - dirs))

  let rows: React.ReactNode
  if (error !== null && dir === null) {
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
  else if (entries.length === 0) rows = <p className={css.note}>{t('res.folderEmpty')}</p>
  else if (visible.length === 0) {
    rows = (
      <p className={css.note} data-testid="wl-folder-nomatch">
        {t('folder.noMatch').replace('{q}', query.trim())}
        <button type="button" className={css.link} onClick={() => search('')}>
          {t('folder.clear')}
        </button>
      </p>
    )
  } else {
    rows = (
      <>
        <div
          ref={rowsRef}
          key={dir.sub}
          className={css.rows}
          data-stale={!fresh}
          data-heading={heading}
          style={{ height: visible.length * ROW }}
        >
          <span
            className={css.thumb}
            data-on={at >= 0}
            style={{ transform: `translateY(${Math.max(at, 0) * ROW}px)` }}
            aria-hidden="true"
          />
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
              <span className={css.glyph}>
                {entry.dir ? (
                  <span className={css.dirGlyph}>
                    <Icon name="folder" size={13} />
                  </span>
                ) : (
                  <FileTag path={entry.name} />
                )}
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

  const previewPath = current !== null && !current.dir ? joinSub(sub, current.name) : null

  return (
    <div className={css.frame}>
      <div className={css.browser} data-pane={pane} data-testid="wl-folder-browser">
        <section className={css.side}>
          <div className={css.tools}>
            <span className={css.search}>
              <Icon name="search" size={13} />
              <input
                ref={searchRef}
                className={css.searchInput}
                value={query}
                placeholder={t('folder.search')}
                aria-label={t('folder.search')}
                spellCheck={false}
                data-testid="wl-folder-search"
                onKeyDown={onKeyDown}
                onChange={(event) => search(event.currentTarget.value)}
              />
              {dir?.exists === true && entries.length > 0 && (
                <span className={css.count}>{count}</span>
              )}
            </span>
          </div>

          <nav className={css.crumbs} aria-label={t('folder.list')} data-testid="wl-folder-crumbs">
            <button
              type="button"
              className={css.crumbBack}
              data-tip={t('folder.up')}
              aria-label={t('folder.up')}
              disabled={sub === ''}
              data-testid="wl-folder-up"
              onClick={up}
            >
              <Icon name={sub === '' ? 'folder' : 'chevronLeft'} size={14} />
            </button>
            {crumbs.map((crumb, position) => {
              const last = position === crumbs.length - 1
              return (
                <span key={crumb.sub ?? '…'} className={css.crumbItem}>
                  {position > 0 && <Icon name="chevronRight" size={10} />}
                  {crumb.sub === null || last ? (
                    <span
                      className={css.crumbHere}
                      data-last={last}
                      aria-current={last ? 'page' : undefined}
                    >
                      {crumb.label}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={css.crumb}
                      onClick={() => go(crumb.sub ?? '', -1, null)}
                    >
                      {crumb.label}
                    </button>
                  )}
                </span>
              )
            })}
          </nav>

          <div
            ref={listRef}
            className={css.list}
            role="listbox"
            tabIndex={0}
            aria-label={t('folder.list')}
            aria-activedescendant={at >= 0 ? `${uid}-${at}` : undefined}
            onKeyDown={onKeyDown}
            style={{ '--fb-row': `${ROW}px` } as React.CSSProperties}
            data-testid="wl-folder-entries"
          >
            {rows}
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
              key={previewPath}
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

/** 右边：一份文件的预览（标题行 + 正文）。换文件就整块重挂，视图回到「预览」。 */
function FilePane(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: Extract<FileTarget, { node: string }>
  desktop: Desktop | undefined
  onBack(): void
}): React.JSX.Element {
  const { t, rpc, instance, target } = props
  const { file, error, loading } = useRunFile(rpc, instance, target)
  const image = useRunImages(rpc, instance, target)
  const [view, setView] = useState<View>('rendered')
  const [failure, setFailure] = useState<string | null>(null)
  const name = fileBaseName(target.sub ?? '')
  const body = fileBody({ t, rpc, instance, target, file, error, loading })
  const switchable = docFormat(body) !== 'plain'

  return (
    <div className={css.pane}>
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
        <FileTag path={name} large />
        <div className={css.paneTitle}>
          <span className={css.paneName}>{name}</span>
          <span className={css.paneMeta}>
            {file?.exists === true
              ? `${formatBytes(file.size)} · ${t('file.modified')} ${shortTime(file.mtime)}`
              : ' '}
          </span>
        </div>
        {switchable && (
          <div className={css.paneViews}>
            <Segmented<View>
              label={t('file.rendered')}
              value={view}
              onChange={setView}
              options={[
                { value: 'rendered', label: t('file.rendered') },
                { value: 'source', label: t('file.source') },
              ]}
            />
          </div>
        )}
        <CopyButton t={t} text={file?.path ?? null} />
        <OpenWith
          t={t}
          desktop={props.desktop}
          path={file?.exists === true ? file.path : null}
          compact
          onError={setFailure}
        />
      </header>
      {failure !== null && <p className={css.paneFailure}>{failure}</p>}
      <div
        className={cx(css.paneBody, body.kind === 'loading' ? undefined : files.viewerReveal)}
        key={`${view}:${body.kind === 'loading'}`}
        data-testid="wl-folder-file"
      >
        <DocContent t={t} body={body} view={view} name={name} image={image} />
      </div>
    </div>
  )
}
