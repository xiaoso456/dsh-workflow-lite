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
 * - 选文件夹：点右边的圆圈选上，点这一行进去，也可以「选当前文件夹」；
 * - 筛选框只筛当前目录；隐藏项（`.` 开头）默认不列。
 * 选中的是绝对路径（分隔符 `/`），原样进资源。
 * `single`：编辑一项时换它的路径——只能选一个，选另一个就换过去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HostPicker
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { HostListResponse } from '../../shared/wire.ts'
import type { HostAccess } from '../app/host.ts'
import type { T } from '../i18n.ts'
import { crumbs } from '../model/hostPath.ts'
import { errorMessage } from '../rpc.ts'
import { Icon } from './Icon.tsx'
import overlay from './overlay.module.css'
import css from './picker.module.css'
import { cx, Modal } from './primitives.tsx'
import ui from './ui.module.css'

export type PickMode = 'file' | 'folder'

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
  const crumbRef = useRef<HTMLElement>(null)
  const seq = useRef(0)

  const go = useCallback(
    (path?: string): void => {
      const mine = ++seq.current
      setLoading(true)
      setError(null)
      void host.list(path).then(
        (next) => {
          if (mine !== seq.current) return
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
    [host],
  )

  useEffect(() => {
    go(props.start)
  }, [])

  // 路径长了：面包屑滚到最右，露出当前这一级。
  useLayoutEffect(() => {
    const bar = crumbRef.current
    if (bar !== null) bar.scrollLeft = bar.scrollWidth
  }, [listing?.path, typing])

  const parent = listing?.parent ?? null
  const up = (): void => {
    if (parent !== null) go(parent)
  }

  const entries = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (listing?.entries ?? []).filter(
      (entry) =>
        (hidden || !entry.name.startsWith('.') || needle.startsWith('.')) &&
        (needle === '' || entry.name.toLowerCase().includes(needle)),
    )
  }, [listing, filter, hidden])

  const toggle = (path: string): void => {
    setPicked((current) =>
      current.includes(path)
        ? current.filter((value) => value !== path)
        : props.single === true
          ? [path]
          : [...current, path],
    )
  }

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

        <div className={css.bar}>
          {typing ? (
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
          ) : (
            <nav className={css.crumbs} ref={crumbRef} aria-label={t('pick.address')}>
              {crumbs(listing?.path ?? '').map((crumb, index, all) => (
                <Fragment key={crumb.path}>
                  {index > 0 && (
                    <span className={css.crumbSep} aria-hidden="true">
                      <Icon name="chevronRight" size={12} />
                    </span>
                  )}
                  <button
                    type="button"
                    className={css.crumb}
                    aria-current={index === all.length - 1 ? 'location' : undefined}
                    onClick={() => go(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </Fragment>
              ))}
            </nav>
          )}
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
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
        </div>

        {(listing?.places.length ?? 0) > 0 && (
          <div className={css.places}>
            {listing?.places.map((place) => (
              <button
                key={`${place.label}:${place.path}`}
                type="button"
                className={css.place}
                data-on={place.path === listing.path}
                title={place.path}
                onClick={() => go(place.path)}
              >
                <Icon
                  name={
                    place.label === 'workspace'
                      ? 'folderOpen'
                      : place.label === 'home'
                        ? 'pin'
                        : 'storage'
                  }
                  size={12}
                />
                {place.label === 'workspace'
                  ? t('pick.workspace')
                  : place.label === 'home'
                    ? t('pick.home')
                    : place.label}
              </button>
            ))}
          </div>
        )}

        <div className={css.tools}>
          <span className={css.filterBox}>
            <Icon name="search" size={13} />
            <input
              className={css.filter}
              value={filter}
              placeholder={t('pick.filter')}
              aria-label={t('pick.filter')}
              data-testid="wl-picker-filter"
              onKeyDown={(event) => {
                if (event.key === 'Backspace' && filter === '' && parent !== null) {
                  event.preventDefault()
                  up()
                }
              }}
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
          </span>
          <button
            type="button"
            className={css.hiddenToggle}
            aria-pressed={hidden}
            onClick={() => setHidden((value) => !value)}
          >
            {t('pick.hidden')}
          </button>
        </div>

        <div className={css.list} ref={listRef} data-testid="wl-picker-list" data-loading={loading}>
          {parent !== null && (
            <button
              type="button"
              className={cx(css.row, css.upRow)}
              data-testid="wl-picker-up"
              title={`${t('pick.up')}（${t('pick.upKeys')}）`}
              onClick={up}
            >
              <span className={cx(css.entryIcon, css.upIcon)}>
                <Icon name="arrowRight" size={14} />
              </span>
              <span className={css.upName}>{t('pick.up')}</span>
              <span className={css.rowMeta}>{parent}</span>
            </button>
          )}
          {error !== null && <p className={css.error}>{error}</p>}
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

        <footer className={overlay.sheetFoot}>
          {mode === 'folder' && listing !== null && (
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.soft)}
              data-testid="wl-picker-here"
              onClick={() => props.onPick([listing.path])}
            >
              <Icon name="folderOpen" size={13} />
              {t('pick.here')}
            </button>
          )}
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
            disabled={picked.length === 0}
            data-testid="wl-picker-ok"
            onClick={() => props.onPick(picked)}
          >
            <Icon name={props.single === true ? 'check' : 'plus'} size={13} />
            {props.single === true ? t('pick.choose') : t('pick.add')}
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
      className={css.row}
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
        <span className={css.entryIcon} data-dir={props.dir}>
          <Icon name={props.dir ? 'folder' : 'file'} size={15} />
        </span>
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
          className={css.check}
          role="checkbox"
          aria-checked={props.on}
          aria-label={props.name}
          data-testid="wl-picker-check"
          onClick={props.onToggle}
        >
          <Icon name="check" size={10} />
        </button>
      )}
    </div>
  )
}
