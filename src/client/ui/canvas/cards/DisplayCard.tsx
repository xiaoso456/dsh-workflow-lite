/**
 * dsh-workflow-lite — 展示卡：资源卡开了画布展示，标题行加展示区，选中时可拖右下角改大小或缩放。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/DisplayCard
 */

import { Handle, type NodeProps, Position, useReactFlow } from '@xyflow/react'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ResourceView, TableView, ViewLook } from '../../../../shared/types.ts'
import { useDisplayLook } from '../../../app/displayLook.ts'
import { displayKey } from '../../../app/useDisplayStats.ts'
import {
  DEFAULT_ZOOM,
  type Display,
  displayFootprint,
  dragZoom,
  snapView,
} from '../../../model/display.ts'
import { shortTime } from '../../../model/time.ts'
import { DisplayOptions, useDisplayFloat } from '../../display/DisplaySettings.tsx'
import dcss from '../../display/display.module.css'
import { DisplayContext, HistorySlotContext } from '../../display/displayEnv.ts'
import { DisplayBody } from '../../display/ResourceDisplay.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { KIND_ICON } from '../../kit/resourceUi.ts'
import ui from '../../kit/ui.module.css'
import { useCanvasMoving } from '../../motion/canvasMoving.ts'
import { useCrossfade } from '../../motion/crossfade.ts'
import css from '../canvas.module.css'
import type { CardDisplay, ResourceFlowNode } from '../types.ts'
import { tintStyle } from './cardParts.ts'
import own from './displayCard.module.css'

/**
 * 展示卡：资源卡开了画布展示。上面一行和资源卡一样（类型签、名字、在不在），下面是展示区（见 ResourceDisplay）。
 * 选中时右下角出一个拖柄改大小（拖动中只在这张卡里记临时尺寸，松手才写进文档）；图片按拖之前的比例走，
 * 按住 Shift 自由拉。网页、长文能「交互」：进去之后展示区接鼠标（滚动、点按钮），Esc、取消选中都退出来。
 */
/** 换掉展示设置里的表格那组（`undefined` 是去掉）。 */
function withTable(view: ResourceView, table: TableView | undefined): ResourceView {
  const next: ResourceView = { ...view }
  if (table === undefined) delete next.table
  else next.table = table
  return next
}

export function DisplayCard(
  props: NodeProps<ResourceFlowNode> & { display: CardDisplay },
): React.JSX.Element {
  const { data, id, selected, display } = props
  const env = useContext(DisplayContext)
  const flow = useReactFlow()
  // 拖动中的临时样子：改大小时是排版尺寸，按住 Ctrl 缩放时多一个 `zoom`（尺寸不变）。
  const [live, setLive] = useState<{ width: number; height: number; zoom?: number } | null>(null)
  const [interactive, setInteractive] = useState(false)
  const fallbackLook = useDisplayLook()
  const moving = useCanvasMoving()
  const cardRef = useRef<HTMLDivElement>(null)
  // 齿轮打开的细项浮层摆在卡片旁边（见 DisplaySettings）。
  const settings = useDisplayFloat<HTMLButtonElement>(cardRef)
  /** 各轮产出：标题行里写看的是哪一版、底边外挂时间线。 */
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [rail, setRail] = useState<HTMLElement | null>(null)
  const [status, setStatus] = useState<HTMLElement | null>(null)
  const history = useMemo(() => ({ status, slot, rail }), [status, slot, rail])
  const settingsOpen = settings.state !== 'off'
  // 视口一动（平移、缩放、适应画布）浮层就和卡片错开了：收起。
  const closeSettings = settings.setState
  useEffect(() => {
    if (moving) closeSettings('off')
  }, [moving, closeSettings])
  // 浮层开着时这张卡一直是「在看的那张」（连线高亮）：换外观的过渡会让指针短暂地「离开」卡片，别跟着熄掉。
  // 收起时指针已经不在卡上了才熄。
  const onFocusFile = data.onFocusFile
  const wasOpen = useRef(false)
  useEffect(() => {
    const closed = wasOpen.current && !settingsOpen
    wasOpen.current = settingsOpen
    if (closed && cardRef.current?.matches(':hover') !== true) onFocusFile(null)
  }, [settingsOpen, onFocusFile])
  const canInteract = display.info.kind !== 'image'
  const canOpen = env?.open !== undefined && (display.item.kind === 'text' || display.made === true)
  // 模板画布上，展示的是最近一次执行生成的：标题行悬停时多一个钟，点了打开那个实例。
  const latest = env?.run === null ? env.latest : undefined
  const found =
    display.item.kind === 'file' || display.item.kind === 'folder'
      ? latest?.outputs[displayKey(id, display.info.item)]
      : undefined
  // 有内容了才换成卡片以外的样子：草图、读不了的说明还是放在卡面上。
  const filled =
    display.item.kind === 'text' ||
    (env?.run === null ? found !== undefined : display.made === true)
  // 换外观（这张卡自己改了、设置里改了默认、内容刚生成出来）时新旧两个样子交叉淡。
  const look = useCrossfade<ViewLook>(
    filled ? (display.info.look ?? fallbackLook) : 'card',
    cardRef,
  )
  const shown: Display = { ...display.info, ...live, look }

  useEffect(() => {
    if (!selected) setInteractive(false)
  }, [selected])
  useEffect(() => {
    if (!interactive) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setInteractive(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [interactive])

  /**
   * 拖右下角：平时改大小，按住 Ctrl（Mac 上 ⌘）是缩放——卡片里的一切跟着放大缩小，排版不变（见 dragZoom）。
   * 拖到一半按下、松开 Ctrl 当场换过去：两种都从开始拖的那一刻算，换过去就是另一种从头量，不叠加。
   * 缩放只给能缩放的（图片要是「原大」）；Markdown、文本的缩放是字号，卡片不跟着变大。
   * Esc 取消这次拖动（回到拖之前，不写进文档，也不连带取消选中）。松手、取消都在 window 上听：
   * 拖柄跟着选中走，中途被卸掉（取消选中）时它身上的事件就收不到了。
   */
  const startResize = (event: React.PointerEvent<HTMLSpanElement>): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const zoom = flow.getZoom()
    const info = display.info
    // 拖的是卡片在画布上的大小；网页整张按缩放显示，记下来的是排版尺寸（画布上的大小 ÷ 缩放）。
    const scale = info.kind === 'html' ? info.zoom / 100 : 1
    const area = displayFootprint(shown)
    const start = { x: event.clientX, y: event.clientY, w: area.width, h: area.height }
    const ratio = info.kind === 'image' ? start.w / start.h : null
    const canZoom = info.kind !== 'image' || info.fit === 'actual'
    const handle = event.currentTarget
    const pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    let last: { width: number; height: number; zoom?: number } | null = null
    let pointer = { x: event.clientX, y: event.clientY, shift: event.shiftKey }
    let scaling = canZoom && (event.ctrlKey || event.metaKey)
    const update = (): void => {
      const w = start.w + (pointer.x - start.x) / zoom
      const h = start.h + (pointer.y - start.y) / zoom
      last = scaling
        ? {
            width: info.width,
            height: info.height,
            zoom: dragZoom(info.zoom, { width: start.w, height: start.h }, { width: w, height: h }),
          }
        : snapView(w / scale, (ratio !== null && !pointer.shift ? w / ratio : h) / scale)
      setLive(last)
    }
    const move = (next: PointerEvent): void => {
      pointer = { x: next.clientX, y: next.clientY, shift: next.shiftKey }
      scaling = canZoom && (next.ctrlKey || next.metaKey)
      update()
    }
    const key = (next: KeyboardEvent): void => {
      if (next.key === 'Escape') {
        next.stopPropagation()
        next.preventDefault()
        finish(false)
        return
      }
      if (next.key !== 'Control' && next.key !== 'Meta' && next.key !== 'Shift') return
      pointer = { ...pointer, shift: next.shiftKey }
      scaling = canZoom && (next.ctrlKey || next.metaKey)
      update()
    }
    const finish = (keep: boolean): void => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', done, true)
      window.removeEventListener('pointercancel', cancel, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
      const end = keep ? (last as { width: number; height: number; zoom?: number } | null) : null
      if (end?.zoom !== undefined) {
        if (end.zoom !== info.zoom) {
          const next: ResourceView = { ...display.view, zoom: end.zoom }
          if (end.zoom === DEFAULT_ZOOM[info.kind]) delete next.zoom
          data.onView(id, next)
        }
      } else if (end !== null && (end.width !== shown.width || end.height !== shown.height)) {
        data.onView(id, { ...display.view, width: end.width, height: end.height })
      }
      setLive(null)
    }
    const done = (): void => finish(true)
    const cancel = (): void => finish(false)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', done, true)
    window.addEventListener('pointercancel', cancel, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
  }

  return (
    <div
      ref={cardRef}
      className={cx(css.resCard, dcss.card, selected && css.cardSelected)}
      data-display={display.info.kind}
      data-board-look={look === 'card' ? undefined : look}
      // 「隐藏标题」：还没内容（显示草图、读不了的说明）时不藏，不然认不出是哪张。
      data-hide-title={(shown.hideTitle && filled) || undefined}
      // 毛玻璃在视口动的时候先换成同色的实底：模糊每帧都要重算，平移、缩放会卡。
      data-moving={(look === 'glass' && moving) || undefined}
      data-focused={data.focused}
      data-dim={data.dim}
      data-tone={data.tone}
      data-resizing={live !== null || undefined}
      data-interactive={interactive || undefined}
      data-settings={settingsOpen || undefined}
      data-testid="wl-resource"
      onPointerEnter={() => data.onFocusFile(id)}
      onPointerLeave={() => {
        if (!settingsOpen) data.onFocusFile(null)
      }}
    >
      <span className={dcss.head} data-tip={data.note === '' ? undefined : data.note}>
        <span
          className={dcss.tab}
          data-kind={display.item.kind}
          data-tinted={data.tint !== null}
          style={tintStyle(data.tint)}
          aria-hidden="true"
        >
          {display.ext !== '' ? (
            display.ext
          ) : (
            <Icon name={KIND_ICON[display.item.kind]} size={12} />
          )}
        </span>
        <span className={own.titleLine}>
          <span className={dcss.title}>{data.title}</span>
          <span ref={setStatus} className={own.statusSlot} />
        </span>
        <span ref={setSlot} className={own.historySlot} />
        {data.tone !== 'ok' && (
          <span className={css.cardFlag} data-tone={data.tone}>
            <Icon name="alert" size={12} />
          </span>
        )}
        {/* 生成了没有看展示区就知道，标题行不再打钩。 */}
        <span className={dcss.actions}>
          {env !== null && (
            <button
              ref={settings.anchorRef}
              type="button"
              className={cx(own.action, 'nodrag')}
              aria-pressed={settingsOpen}
              aria-haspopup="dialog"
              data-tip={settingsOpen ? undefined : env.t('display.settings')}
              aria-label={env.t('display.settings')}
              data-testid="wl-display-settings-open"
              onClick={(event) => {
                event.stopPropagation()
                settings.setState(settingsOpen ? 'off' : 'pinned')
              }}
              onKeyDown={settings.onKeyDown}
            >
              <Icon name="sliders" size={13} />
            </button>
          )}
          {canInteract && (
            <button
              type="button"
              className={cx(own.action, 'nodrag')}
              aria-pressed={interactive}
              data-tip={interactive ? display.leaveText : display.interactText}
              aria-label={interactive ? display.leaveText : display.interactText}
              data-testid="wl-display-interact"
              onClick={(event) => {
                event.stopPropagation()
                setInteractive((on) => !on)
              }}
            >
              <Icon name="pointer" size={13} />
            </button>
          )}
          {latest !== undefined && found !== undefined && env !== null && (
            <button
              type="button"
              className={cx(own.action, 'nodrag')}
              data-tip={env.t('display.lastRunTip').replace('{time}', shortTime(found.mtime))}
              aria-label={env.t('display.lastRun').replace('{time}', shortTime(found.mtime))}
              data-testid="wl-display-last-run"
              onClick={(event) => {
                event.stopPropagation()
                latest.openRun(found.instance)
              }}
            >
              <Icon name="history" size={13} />
            </button>
          )}
          {canOpen && (
            <button
              type="button"
              className={cx(own.action, 'nodrag')}
              data-tip={display.openText}
              aria-label={display.openText}
              data-testid="wl-display-open"
              onClick={(event) => {
                event.stopPropagation()
                env?.open?.(id, display.info.item)
              }}
            >
              <Icon name="expand" size={13} />
            </button>
          )}
        </span>
      </span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 双击展示区 = 点标题行的「打开」 */}
      <div
        className={cx(dcss.window, interactive && 'nowheel nodrag nopan')}
        onDoubleClick={(event) => {
          if (interactive || !canOpen) return
          event.stopPropagation()
          env?.open?.(id, display.info.item)
        }}
      >
        <HistorySlotContext.Provider value={history}>
          <DisplayBody
            node={id}
            item={display.item}
            display={shown}
            interactive={interactive}
            writing={display.writing}
            onTable={(table) => data.onView(id, withTable(display.view, table))}
          />
        </HistorySlotContext.Provider>
      </div>
      <span ref={setRail} className={own.historyRail} />
      {data.shared && (
        <span
          className={css.resShared}
          data-tip={data.sharedText}
          data-testid="wl-resource-shared-tag"
        >
          <Icon name="shared" size={11} />
        </span>
      )}
      {selected && !interactive && (
        <span
          className={cx(own.grip, 'nodrag nopan')}
          data-tip={display.resizeText}
          aria-hidden="true"
          data-testid="wl-display-resize"
          onPointerDown={startResize}
        />
      )}
      {env !== null &&
        settings.render({
          className: cx(ui.confirmPop, dcss.optionsPop),
          role: 'dialog',
          label: env.t('display.settings'),
          testId: 'wl-display-pop',
          children: (
            // 浮层挂在视图根，但 React 的事件顺着组件树冒泡：方向键、点击别冒到节点上（会挪卡片、改选中）。
            // biome-ignore lint/a11y/noStaticElementInteractions: 只是截住冒泡
            <div
              onKeyDown={(event) => {
                const save = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
                if (event.key !== 'Escape' && !save) event.stopPropagation()
              }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <DisplayOptions
                t={env.t}
                view={display.view}
                display={display.info}
                file={display.item.kind === 'file'}
                path={display.item.value}
                headKey={displayKey(id, display.info.item)}
                onChange={(view) => data.onView(id, view)}
              />
            </div>
          ),
        })}
      {live !== null && (
        <span className={own.sizeTag} data-testid="wl-display-size-tag">
          {live.zoom !== undefined
            ? display.zoomText.replace('{zoom}', String(live.zoom))
            : `${live.width} × ${live.height}${
                display.info.kind === 'html' && display.info.zoom !== 100
                  ? ` · ${display.info.zoom}%`
                  : ''
              }`}
        </span>
      )}
      {/*
        两个连接点排在展示区后面：展示区是定位的，排在它前面的点会被图盖住一半（看着像半个圈、也只有外半边点得中），
        拖线时扩到整张卡的命中区也会被它挡住。
      */}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        className={cx(css.handle, css.hResIn)}
      />
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={cx(css.handle, css.handleOut, css.handleRead)}
        data-tip={data.readText}
      />
    </div>
  )
}
