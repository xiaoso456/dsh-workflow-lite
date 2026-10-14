/**
 * dsh-workflow-lite — 点开 Markdown 里的一张图：模态框里放大看。
 *
 * 缺省"适应窗口"：整张装得下，小图放大到两倍为止。滚轮以指针为中心缩放，拖动平移，双击在"适应"和"原大"之间切换。
 * 工具栏（− 比例 + ｜ 适应 1:1 ｜ 左转 右转）和键盘（+ − 0 1 R、方向键）做的是同一件事。
 * Esc、点空白处、✕ 都能关；叠在文档查看框上面时只关自己。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ImageZoom
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { T } from '../i18n.ts'
import {
  clampView,
  fitView,
  type ImageView,
  isPannable,
  ORIGIN,
  type Point,
  panView,
  relayout,
  type Size,
  wheelFactor,
  ZOOM_MAX,
  ZOOM_STEP,
  zoomView,
} from '../model/imageView.ts'
import { Icon } from './Icon.tsx'
import css from './imageZoom.module.css'
import { PickThumb, SwapText, useTrend } from './motion.tsx'
import overlay from './overlay.module.css'
import { cx, Modal } from './primitives.tsx'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'

type Backdrop = 'theme' | 'checker'

/**
 * 读取状态与视图。事件里要读最新的一份，所以 `commit` 同时写进 `live`。
 * 拖动时只改 `live` 和图的 transform，不进 state：读数、按钮只看缩放，平移不动它们。
 */
interface Viewer {
  /** 原图的像素宽高；还没读到为 null。 */
  natural: Size | null
  /** 舞台的宽高（量出来之前是 0）。 */
  frame: Size
  view: ImageView
  /** 适应窗口：舞台大小一变就跟着重新算。 */
  fitting: boolean
  failed: boolean
}

const START: Viewer = {
  natural: null,
  frame: { w: 0, h: 0 },
  view: { x: 0, y: 0, scale: 1, rot: 0 },
  fitting: true,
  failed: false,
}

/** 方向键平移的像素（按住 Shift 走大步）。 */
const NUDGE = 8
const NUDGE_BIG = 48
/** 放大到这个倍数以上，像素边界直接显出来，不做平滑。 */
const PIXEL_SCALE = 3
/** 缩放比例离 1 这么近，就算"原大"。 */
const ACTUAL_EPS = 1e-3
/** 读数占宽按最宽的一档定死（SwapText 的 reserve）：换字时工具栏不抖，旧字也不会被裁掉。 */
const READOUT_WIDEST = `${Math.round(ZOOM_MAX * 100)}%`

/** 指针在舞台上的位置，换成以舞台中心为原点的坐标（缩放以它为锚）。 */
function anchorOf(clientX: number, clientY: number, rect: DOMRect): Point {
  return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
}

/** 滚轮的 deltaY 统一成像素：Firefox 按行（1）或按页（2）报。 */
function wheelPixels(event: WheelEvent, height: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * height
  return event.deltaY
}

/** 图的变换：中心对齐舞台，再平移、缩放、旋转。 */
function transformOf(view: ImageView): string {
  return `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale}) rotate(${view.rot}deg)`
}

export function ImageZoom(props: {
  t: T
  src: string
  alt: string
  /** 文档里写的路径，标题下面那一行看；网上的图就是网址。 */
  path?: string
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const [viewer, setViewer] = useState<Viewer>(START)
  const [dragging, setDragging] = useState(false)
  const [backdrop, setBackdrop] = useState<Backdrop>('theme')
  const live = useRef(START)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  /** 正在拖：指针编号与上一个位置。 */
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)

  /**
   * 把视图写到图上。直接改 DOM、不等 React：拖动、滚轮每动一下都当场跟上，不落后半拍。
   * `animate` 为真时过渡（按钮、键盘）；否则跟手（滚轮、拖动、第一次排版）。
   */
  const paint = useCallback((view: ImageView, animate: boolean): void => {
    const img = image.current
    if (img === null) return
    img.toggleAttribute('data-instant', !animate)
    img.style.transform = transformOf(view)
  }, [])

  /** 写进 `live` 和图，再交给 React 更新读数、按钮与"适应"状态。 */
  const commit = useCallback(
    (next: Viewer, animate: boolean): void => {
      live.current = next
      paint(next.view, animate)
      setViewer(next)
    },
    [paint],
  )

  /** 以 `anchor` 为中心乘上 `factor`（滚轮、按钮、键盘共用）。 */
  const zoomAt = useCallback(
    (factor: number, anchor: Point, animate: boolean): void => {
      const cur = live.current
      if (cur.natural === null) return
      const view = zoomView(cur.view, cur.view.scale * factor, anchor, cur.frame, cur.natural)
      commit({ ...cur, view, fitting: false }, animate)
    },
    [commit],
  )

  const pan = (dx: number, dy: number): void => {
    const cur = live.current
    if (cur.natural === null) return
    const view = panView(cur.view, dx, dy, cur.frame, cur.natural)
    // 已经到边了：不动，也不退出"适应窗口"。
    if (view.x === cur.view.x && view.y === cur.view.y) return
    // 拖动每动一下都走这里，只写图、不进 React（否则整个框重算一遍）。"适应窗口"要摘掉时才提交一次。
    if (cur.fitting) {
      commit({ ...cur, view, fitting: false }, false)
    } else {
      live.current = { ...cur, view }
      paint(view, false)
    }
  }

  const fitWindow = (): void => {
    const cur = live.current
    if (cur.natural === null) return
    const view = fitView(cur.frame, cur.natural, cur.view.rot)
    commit({ ...cur, view, fitting: true }, true)
  }

  /** 原大（1:1），居中。 */
  const actual = (): void => {
    const cur = live.current
    if (cur.natural === null) return
    const view = clampView({ ...cur.view, x: 0, y: 0, scale: 1 }, cur.frame, cur.natural)
    commit({ ...cur, view, fitting: false }, true)
  }

  /** 转 90 度：适应窗口的重新算，否则保持比例，只把平移限回范围里。 */
  const turn = (step: number): void => {
    const cur = live.current
    if (cur.natural === null) return
    const rot = cur.view.rot + step
    const view = relayout({ ...cur.view, rot }, cur.frame, cur.natural, cur.fitting)
    commit({ ...cur, view }, true)
  }

  const onLoad = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    const img = event.currentTarget
    const cur = live.current
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      commit({ ...cur, failed: true }, false)
      return
    }
    const natural = { w: img.naturalWidth, h: img.naturalHeight }
    const view = fitView(cur.frame, natural, 0)
    // 第一次排版不过渡，不然图会从左上角滑进来。
    commit({ ...cur, natural, view, fitting: true }, false)
  }

  const onError = (): void => {
    commit({ ...live.current, failed: true }, false)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || live.current.natural === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    setDragging(true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const at = drag.current
    if (at === null || at.id !== event.pointerId) return
    drag.current = { id: at.id, x: event.clientX, y: event.clientY }
    pan(event.clientX - at.x, event.clientY - at.y)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    setDragging(false)
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const cur = live.current
    if (cur.natural === null) return
    if (Math.abs(cur.view.scale - 1) < ACTUAL_EPS) {
      fitWindow()
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const anchor = anchorOf(event.clientX, event.clientY, rect)
    const view = zoomView(cur.view, 1, anchor, cur.frame, cur.natural)
    commit({ ...cur, view, fitting: false }, true)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    const step = event.shiftKey ? NUDGE_BIG : NUDGE
    switch (event.key) {
      case '+':
      case '=':
        zoomAt(ZOOM_STEP, ORIGIN, true)
        break
      case '-':
      case '_':
        zoomAt(1 / ZOOM_STEP, ORIGIN, true)
        break
      case '0':
        fitWindow()
        break
      case '1':
        actual()
        break
      case 'r':
        turn(90)
        break
      case 'R':
        turn(-90)
        break
      case 'ArrowLeft':
        pan(-step, 0)
        break
      case 'ArrowRight':
        pan(step, 0)
        break
      case 'ArrowUp':
        pan(0, -step)
        break
      case 'ArrowDown':
        pan(0, step)
        break
      default:
        return
    }
    event.preventDefault()
  }

  // 焦点落到框上，键盘（+ − 0 1 R、方向键）才有用。
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
  }, [])

  // 滚轮要自己接：React 的 onWheel 是被动监听，里面 preventDefault 不生效，页面会跟着滚。
  useEffect(() => {
    const el = stage.current
    if (el === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const factor = wheelFactor(wheelPixels(event, rect.height))
      zoomAt(factor, anchorOf(event.clientX, event.clientY, rect), false)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // 舞台尺寸变了（窗口缩放、框的大小变了）：适应窗口的重新算，否则只把平移限回范围里。
  useEffect(() => {
    const el = stage.current
    if (el === null) return
    const observer = new ResizeObserver(() => {
      const cur = live.current
      const frame = { w: el.clientWidth, h: el.clientHeight }
      if (frame.w === cur.frame.w && frame.h === cur.frame.h) return
      const view =
        cur.natural === null ? cur.view : relayout(cur.view, frame, cur.natural, cur.fitting)
      commit({ ...cur, frame, view }, false)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [commit])

  const { natural, frame, view, fitting, failed } = viewer
  const name = props.alt.trim() === '' ? t('image.untitled') : props.alt.trim()
  const size = natural === null ? '' : `${natural.w} × ${natural.h}`
  const sub = [props.path ?? '', size].filter(Boolean).join(' · ')
  const ready = natural !== null && frame.w > 0
  const pannable = natural !== null && isPannable(view, frame, natural)
  const actualOn = !fitting && Math.abs(view.scale - 1) < ACTUAL_EPS
  const percent = Math.round(view.scale * 100)
  // 数字是变大还是变小：读数往上滚还是往下滚（和步骤「轮次」的加减一样）。
  const trend = useTrend(percent)

  return (
    <Modal
      label={name}
      onDismiss={props.onClose}
      className={overlay.sheetZoom}
      testId="wl-image-zoom"
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 键盘快捷键挂在框上（焦点落在这里），不是给这块静态区域用的 */}
      <div ref={root} className={css.root} tabIndex={-1} onKeyDown={onKeyDown}>
        <header className={overlay.sheetHead}>
          <span className={overlay.sheetIcon}>
            <Icon name="image" size={16} />
          </span>
          <div className={overlay.sheetTitles}>
            <p className={cx(overlay.sheetTitle, css.name)}>{name}</p>
            {sub !== '' && <p className={overlay.sheetSub}>{sub}</p>}
          </div>
          <div className={css.tools} role="group" aria-label={t('image.tools')}>
            <button
              type="button"
              className={css.tool}
              aria-label={t('image.zoomOut')}
              data-tip={t('image.zoomOut')}
              data-testid="wl-image-zoom-out"
              disabled={natural === null}
              onClick={() => zoomAt(1 / ZOOM_STEP, ORIGIN, true)}
            >
              <Icon name="zoomOut" size={16} />
            </button>
            <output
              className={css.readout}
              aria-label={t('image.zoomLevel')}
              data-testid="wl-image-zoom-readout"
            >
              {natural === null ? (
                '–'
              ) : (
                <SwapText text={`${percent}%`} dir={trend} reserve={[READOUT_WIDEST]} />
              )}
            </output>
            <button
              type="button"
              className={css.tool}
              aria-label={t('image.zoomIn')}
              data-tip={t('image.zoomIn')}
              data-testid="wl-image-zoom-in"
              disabled={natural === null}
              onClick={() => zoomAt(ZOOM_STEP, ORIGIN, true)}
            >
              <Icon name="zoomIn" size={16} />
            </button>
            <span className={css.sep} aria-hidden="true" />
            <div className={css.pick}>
              <PickThumb
                layout={`${natural === null}|${fitting}|${actualOn}`}
                item='[aria-pressed="true"]:not(:disabled)'
                className={css.pickThumb}
              />
              <button
                type="button"
                className={css.tool}
                aria-label={t('image.fit')}
                aria-pressed={fitting}
                data-tip={t('image.fit')}
                data-testid="wl-image-zoom-fit"
                disabled={natural === null}
                onClick={fitWindow}
              >
                <Icon name="fit" size={16} />
              </button>
              <button
                type="button"
                className={cx(css.tool, css.actual)}
                aria-pressed={actualOn}
                data-tip={t('image.actual')}
                data-testid="wl-image-zoom-actual"
                disabled={natural === null}
                onClick={actual}
              >
                1:1
              </button>
            </div>
            <span className={css.sep} aria-hidden="true" />
            <button
              type="button"
              className={css.tool}
              aria-label={t('image.rotateLeft')}
              data-tip={t('image.rotateLeft')}
              data-testid="wl-image-zoom-rotate-left"
              disabled={natural === null}
              onClick={() => turn(-90)}
            >
              <Icon name="rotateLeft" size={16} />
            </button>
            <button
              type="button"
              className={css.tool}
              aria-label={t('image.rotateRight')}
              data-tip={t('image.rotateRight')}
              data-testid="wl-image-zoom-rotate-right"
              disabled={natural === null}
              onClick={() => turn(90)}
            >
              <Icon name="rotateRight" size={16} />
            </button>
          </div>
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t('common.close')}
            data-tip={t('common.close')}
            onClick={props.onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </header>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: 画布接指针（拖动、双击、滚轮），键盘操作走上面的工具栏与快捷键 */}
        <div
          ref={stage}
          className={cx(css.stage, backdrop === 'checker' && css.checker)}
          data-testid="wl-image-zoom-stage"
          data-pannable={pannable || undefined}
          data-dragging={dragging || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          {failed ? (
            <p className={css.failed} role="alert">
              {t('image.failed')}
            </p>
          ) : (
            <img
              ref={image}
              className={cx(css.image, view.scale >= PIXEL_SCALE && css.pixel)}
              src={props.src}
              alt={props.alt}
              draggable={false}
              data-testid="wl-image-zoom-img"
              data-ready={ready || undefined}
              style={natural === null ? undefined : { width: natural.w, height: natural.h }}
              onLoad={onLoad}
              onError={onError}
            />
          )}
          {!ready && !failed && (
            <span className={css.spinner} role="status" aria-label={t('file.loading')} />
          )}
        </div>

        <footer className={overlay.sheetFoot}>
          <span className={overlay.sheetKeys}>{t('image.hint')}</span>
          <span className={ui.grow} />
          <Segmented
            label={t('image.background')}
            value={backdrop}
            options={[
              { value: 'theme', label: t('image.bgTheme') },
              { value: 'checker', label: t('image.bgChecker') },
            ]}
            onChange={setBackdrop}
            testId="wl-image-zoom-bg"
          />
        </footer>
      </div>
    </Modal>
  )
}
