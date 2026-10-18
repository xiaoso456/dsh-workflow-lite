/**
 * dsh-workflow-lite — 「选择文件 / 选择文件夹」：在主机上点着选，不用手敲路径。
 *
 * 模态框：上面是面包屑路径（每一级都能点，旁边的笔切成输入框直接敲路径）和几个常用位置
 * （工作区、主目录、各个盘符），中间是当前目录里的东西，下面是已选几项。
 * - 列表第一行永远是「上一级」（就在手边，不用回到顶上找按钮）；筛选框空着时按 Backspace、
 *   任何时候按 Alt+↑ 也是上一级；
 * - 一行：线条图标（文件夹琥珀色、文件灰色，不带底色）、名字，右边是进入箭头（文件夹）和圆形勾选
 *   （能选的才有；悬停或选上时才显出来）；
 * - 选文件：点文件这一行就选上 / 取消，双击直接添加；文件夹点了进去；
 * - 选文件夹：只列文件夹；点右边的圆圈选上，点这一行进去；一个都没勾时右下角的主按钮是「选当前文件夹」，勾了就变成「添加」；
 * - 筛选框只筛当前目录；隐藏项（`.` 开头）默认不列。
 * 动效（只动 transform / opacity）：进下一级、回上一级时整块目录横着换（往里走旧的往左退、新的从右进，往回走反过来，见 {@link useStage}）；
 * 面包屑长出一级时新的一级从前一级背后展开，缩短时收回去（见 {@link useTrail}）；
 * 筛选与「隐藏项」开关让行增减时，留下的行滑到新位置、新行淡入、去掉的行原地淡出（见 {@link useResizeFlip}）。
 * 选中的是绝对路径（分隔符 `/`），原样进资源。
 * `single`：编辑一项时换它的路径——只能选一个，选另一个就换过去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HostPicker
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { HostListResponse } from '../../shared/wire.ts'
import type { HostAccess } from '../app/host.ts'
import type { T } from '../i18n.ts'
import { crumbs } from '../model/hostPath.ts'
import { errorMessage } from '../rpc.ts'
import { FilterBar, PathBar, UpRow } from './DirParts.tsx'
import { FileGlyph } from './FileGlyph.tsx'
import { Icon } from './Icon.tsx'
import {
  CheckMark,
  FadeMark,
  FadeText,
  markSwap,
  PickThumb,
  Presence,
  type StageDir,
  useResizeFlip,
  useStage,
  useTrail,
} from './motion.tsx'
import overlay from './overlay.module.css'
import css from './picker.module.css'
import { cx, Modal } from './primitives.tsx'
import ui from './ui.module.css'

export type PickMode = 'file' | 'folder'

/** 从 `from` 走到 `to`：往里走（`to` 在 `from` 底下）1、往回走（`to` 是 `from` 的上级）-1，其余 0。 */
function direction(from: string | undefined, to: string): StageDir {
  if (from === undefined || from === to) return 0
  const base = (path: string): string => (path.endsWith('/') ? path : `${path}/`)
  if (to.startsWith(base(from))) return 1
  if (from.startsWith(base(to))) return -1
  return 0
}

/** 目录里的一项拼成绝对路径。 */
function join(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

export function HostPicker(props: {
  t: T
  host: HostAccess
  mode: PickMode
  /** 从哪儿开始看（缺省 = 工作区）。 */
  start?: string
  /** 只选一个。 */
  single?: boolean
  onPick(paths: string[]): void
  onClose(): void
}): React.JSX.Element {
  const { t, host, mode } = props
  const [listing, setListing] = useState<HostListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [typing, setTyping] = useState(false)
  const [address, setAddress] = useState('')
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const crumbRef = useRef<HTMLElement | null>(null)
  const seq = useRef(0)
  const stage = useStage()
  /** 这次换目录往哪个方向走（`go` 里算好，内容换上之后的 layout effect 用）。 */
  const heading = useRef<StageDir>(0)
  const shown = useRef<string | undefined>(undefined)
  const rowsFlip = useResizeFlip({ exit: true, enter: true })
  const crumbsFlip = useTrail()
  const rowsRef = useCallback(
    (node: HTMLDivElement | null): void => {
      stage.body.current = node
      rowsFlip(node)
    },
    [rowsFlip, stage.body],
  )
  const crumbsRef = useCallback(
    (node: HTMLElement | null): void => {
      crumbRef.current = node
      crumbsFlip(node)
    },
    [crumbsFlip],
  )

  const go = useCallback(
    (path?: string): void => {
      const mine = ++seq.current
      setLoading(true)
      setError(null)
      void host.list(path).then(
        (next) => {
          if (mine !== seq.current) return
          // 换目录：旧内容留个影子往外走，整批行换进来时不逐行放退场（见 markSwap）。
          const dir = direction(shown.current, next.path)
          heading.current = dir
          if (shown.current !== undefined) stage.leave(dir)
          markSwap()
          shown.current = next.path
          setListing(next)
          setAddress(next.path)
          setTyping(false)
          setFilter('')
          setLoading(false)
          listRef.current?.scrollTo({ top: 0 })
        },
        (reason: unknown) => {
          if (mine !== seq.current) return
          setError(errorMessage(reason))
          setLoading(false)
        },
      )
    },
    [host, stage],
  )

  useEffect(() => {
    go(props.start)
  }, [])

  // 新目录的内容换上了：从该来的一侧进来。
  useLayoutEffect(() => {
    if (listing !== null) stage.enter(heading.current)
  }, [listing?.path])

  // 路径长了：面包屑滚到最右，露出当前这一级（第一次直接到位，之后顺着滑过去）。
  const crumbsSeen = useRef(false)
  useLayoutEffect(() => {
    const bar = crumbRef.current
    if (bar === null) return
    const smooth = crumbsSeen.current && !typing
    if (listing !== null) crumbsSeen.current = true
    bar.scrollTo({ left: bar.scrollWidth, behavior: smooth ? 'smooth' : 'auto' })
  }, [listing?.path, typing])

  const parent = listing?.parent ?? null
  const up = (): void => {
    if (parent !== null) go(parent)
  }

  const entries = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (listing?.entries ?? []).filter(
      (entry) =>
        // 选文件夹：文件不列出来（选不了，列着只添乱）。
        (mode === 'file' || entry.dir) &&
        (hidden || !entry.name.startsWith('.') || needle.startsWith('.')) &&
        (needle === '' || entry.name.toLowerCase().includes(needle)),
    )
  }, [listing, filter, hidden, mode])

  const toggle = (path: string): void => {
    setPicked((current) =>
      current.includes(path)
        ? current.filter((value) => value !== path)
        : props.single === true
          ? [path]
          : [...current, path],
    )
  }

  /** 选文件夹、还没勾任何一个：右下角的主按钮就是「选当前文件夹」。 */
  const here = mode === 'folder' && picked.length === 0
  const title = mode === 'file' ? t('pick.fileTitle') : t('pick.folderTitle')
  return (
    <Modal label={title} testId="wl-picker" className={css.sheet} onDismiss={props.onClose}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Alt+↑ 是整个选择框的快捷键 */}
      <div
        className={overlay.sheetForm}
        onKeyDown={(event) => {
          if (event.altKey && event.key === 'ArrowUp') {
            event.preventDefault()
            up()
          }
        }}
      >
        <header className={overlay.sheetHead}>
          <span className={cx(overlay.sheetIcon, css.headIcon)}>
            <Icon name={mode === 'file' ? 'file' : 'folder'} size={16} />
          </span>
          <div className={overlay.sheetTitles}>
            <p className={overlay.sheetTitle}>{title}</p>
            <p className={overlay.sheetSub}>
              {mode === 'file' ? t('pick.fileSub') : t('pick.folderSub')}
            </p>
          </div>
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t('common.close')}
            onClick={props.onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        <PathBar
          label={t('pick.address')}
          navRef={crumbsRef}
          crumbs={crumbs(listing?.path ?? '').map((crumb) => ({
            key: crumb.path,
            label: crumb.label,
            onGo: () => go(crumb.path),
          }))}
          editor={
            typing ? (
              <form
                className={css.addressForm}
                onSubmit={(event) => {
                  event.preventDefault()
                  if (address.trim() !== '') go(address.trim())
                }}
              >
                <input
                  className={cx(ui.input, ui.mono, css.address)}
                  value={address}
                  aria-label={t('pick.address')}
                  data-testid="wl-picker-address"
                  spellCheck={false}
                  autoComplete="off"
                  // biome-ignore lint/a11y/noAutofocus: 点了「输入路径」就是要敲
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.stopPropagation()
                    setTyping(false)
                    setAddress(listing?.path ?? '')
                  }}
                  onChange={(event) => setAddress(event.currentTarget.value)}
                />
              </form>
            ) : undefined
          }
          action={
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              data-tip={t('pick.typePath')}
              aria-label={t('pick.typePath')}
              aria-pressed={typing}
              data-testid="wl-picker-type"
              onClick={() => {
                setAddress(listing?.path ?? '')
                setTyping((value) => !value)
              }}
            >
              <Icon name="pencil" size={13} />
            </button>
          }
        />

        {(listing?.places.length ?? 0) > 0 && (
          <div className={css.places}>
            {/* 当前所在的那个：选中块滑过去，图标、字的颜色交叉淡过去（同单选组，见 PickThumb）。 */}
            <PickThumb
              layout={`${listing?.path ?? ''}|${listing?.places.map((place) => place.path).join(',') ?? ''}`}
              item=':scope > [aria-current="true"]'
              className={css.placeThumb}
            />
            {listing?.places.map((place) => {
              const text =
                place.label === 'workspace'
                  ? t('pick.workspace')
                  : place.label === 'home'
                    ? t('pick.home')
                    : place.label
              const icon =
                place.label === 'workspace'
                  ? 'folderOpen'
                  : place.label === 'home'
                    ? 'pin'
                    : 'storage'
              return (
                <button
                  key={`${place.label}:${place.path}`}
                  type="button"
                  className={css.place}
                  aria-current={place.path === listing.path ? 'true' : undefined}
                  data-tip={place.path}
                  onClick={() => go(place.path)}
                >
                  <FadeMark on={place.path === listing.path}>
                    <Icon name={icon} size={12} />
                  </FadeMark>
                  <FadeText text={text} on={place.path === listing.path} />
                </button>
              )
            })}
          </div>
        )}

        <FilterBar
          value={filter}
          placeholder={t('pick.filter')}
          onChange={setFilter}
          hiddenLabel={t('pick.hidden')}
          hidden={hidden}
          onHidden={() => setHidden((value) => !value)}
          testId="wl-picker-filter"
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && filter === '' && parent !== null) {
              event.preventDefault()
              up()
            }
          }}
        />

        <div className={css.listWrap} ref={stage.wrap}>
          <div
            className={cx(css.list, ui.scrollFade)}
            ref={listRef}
            data-testid="wl-picker-list"
            data-loading={loading}
          >
            <div className={css.listBody} ref={rowsRef}>
              {parent !== null && (
                <UpRow
                  label={t('pick.up')}
                  meta={parent}
                  tip={`${t('pick.up')}（${t('pick.upKeys')}）`}
                  testId="wl-picker-up"
                  onClick={up}
                />
              )}
              <Presence show={error !== null}>
                {error !== null && <p className={css.error}>{error}</p>}
              </Presence>
              {error === null && listing !== null && entries.length === 0 && (
                <p className={css.empty}>
                  {filter.trim() === '' ? t('pick.emptyDir') : t('pick.noMatch')}
                </p>
              )}
              {listing !== null &&
                entries.map((entry) => {
                  const path = join(listing.path, entry.name)
                  return (
                    <PickRow
                      key={entry.name}
                      name={entry.name}
                      dir={entry.dir}
                      selectable={mode === 'file' ? !entry.dir : entry.dir}
                      on={picked.includes(path)}
                      // 选文件：点文件 = 勾选；文件夹一律是「进去」。
                      onOpen={() => (entry.dir ? go(path) : toggle(path))}
                      onToggle={() => toggle(path)}
                      onAdd={() => {
                        if (!entry.dir && mode === 'file') props.onPick([path])
                      }}
                    />
                  )
                })}
              {listing?.truncated === true && <p className={css.empty}>{t('pick.truncated')}</p>}
            </div>
          </div>
        </div>

        <footer className={overlay.sheetFoot}>
          <span className={css.count}>
            {picked.length === 0 ? '' : t('pick.count').replace('{n}', String(picked.length))}
          </span>
          <span className={ui.grow} />
          <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.primary)}
            disabled={here ? listing === null : picked.length === 0}
            data-testid={here ? 'wl-picker-here' : 'wl-picker-ok'}
            onClick={() => props.onPick(here && listing !== null ? [listing.path] : picked)}
          >
            <Icon name={here ? 'folderOpen' : props.single === true ? 'check' : 'plus'} size={13} />
            {here ? t('pick.here') : props.single === true ? t('pick.choose') : t('pick.add')}
          </button>
        </footer>
      </div>
    </Modal>
  )
}

/**
 * 列表里的一行：主体（类型签 + 名字 + 文件夹的进入箭头）是一个按钮，右边能选的再挂一个圆形勾选。
 * 两个按钮并排、互不嵌套。
 */
function PickRow(props: {
  name: string
  dir: boolean
  selectable: boolean
  on: boolean
  onOpen(): void
  onToggle(): void
  onAdd(): void
}): React.JSX.Element {
  return (
    <div
      className={cx(css.row, ui.fillOn)}
      data-dir={props.dir}
      data-on={props.on}
      data-testid="wl-picker-row"
      data-name={props.name}
    >
      <button
        type="button"
        className={css.entry}
        onClick={props.onOpen}
        onDoubleClick={props.onAdd}
      >
        {props.dir ? (
          <span className={css.entryIcon} data-dir="true">
            <Icon name="folder" size={15} />
          </span>
        ) : (
          <FileGlyph path={props.name} />
        )}
        <span className={css.entryName}>{props.name}</span>
        {props.dir && (
          <span className={css.enter}>
            <Icon name="chevronRight" size={14} />
          </span>
        )}
      </button>
      {props.selectable && (
        <button
          type="button"
          className={cx(ui.check, css.check)}
          role="checkbox"
          aria-checked={props.on}
          aria-label={props.name}
          data-testid="wl-picker-check"
          onClick={props.onToggle}
        >
          <CheckMark />
        </button>
      )}
    </div>
  )
}
