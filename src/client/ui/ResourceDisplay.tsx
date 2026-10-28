/**
 * dsh-workflow-lite — 资源卡的展示区：把资源里的一项（图片、网页、Markdown、文本）直接摆在画布上。
 *
 * 从哪读由 {@link DisplayContext} 定：实例视图给出实例与每项的修改时间（`run/stat`，见 `app/useDisplayStats.ts`），
 * 修改时间变了才重读，读回来之前上一份原样留着，新的淡入；模板里文件还没生成，摆一个同样大小的占位，
 * 只有自定义文字能直接显示。
 *
 * 平时展示区不接鼠标（拖卡片、平移、缩放画布照旧）；卡片进了「交互」才能在里面滚动、点网页里的按钮。
 * 第一次进视野、而且画布停着时才挂内容（宿主页面插拔元素要整页重算样式，平移中间插就是一次卡顿）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ResourceDisplay
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ResourceItem } from '../../shared/types.ts'
import type { RunFileResponse } from '../../shared/wire.ts'
import { type DisplayStat, displayKey } from '../app/useDisplayStats.ts'
import { useRunFile } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import type { Display } from '../model/display.ts'
import { fileBaseName, formatBytes } from '../model/fileKind.ts'
import { withPreviewStyle } from '../model/htmlPreview.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import css from './display.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { useCanvasMoving } from './motion.tsx'

/** 展示区从哪读：实例视图给出实例与每项的样子；模板里是 `null`（文件还没生成）。 */
export interface DisplayEnv {
  t: T
  run: {
    rpc: WorkflowLiteRpc
    instance: string
    stats: Readonly<Record<string, DisplayStat>>
  } | null
  /** 双击展示区、点「打开」：在查看框里看这一项。不给就不能打开。 */
  open?: ((node: string, item: number) => void) | undefined
}

export const DisplayContext = createContext<DisplayEnv | null>(null)

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

/** 实例里的一张图，`version` 变了重读。 */
function useDisplayImage(
  rpc: WorkflowLiteRpc,
  instance: string,
  node: string,
  item: number,
  version: number | null,
): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({
    url: null,
    error: null,
  })
  useEffect(() => {
    if (version === null) return
    let alive = true
    rpc
      .call('run/image', { id: instance, node, item })
      .then(({ mime, data }) => {
        if (alive) setState({ url: `data:${mime};base64,${data}`, error: null })
      })
      .catch((reason: unknown) => {
        if (alive) setState({ url: null, error: errorMessage(reason) })
      })
    return () => {
      alive = false
    }
  }, [rpc, instance, node, item, version])
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

/** 网页：先按 `width / zoom` 宽排版，再整页缩进展示区。 */
function HtmlView(props: {
  name: string
  text: string
  display: Display
  interactive: boolean
}): React.JSX.Element {
  const scale = props.display.zoom / 100
  return (
    <iframe
      className={css.frame}
      title={props.name}
      srcDoc={withPreviewStyle(props.text)}
      // 只给脚本：没有 allow-same-origin，页面是个独立的源，读不到画布的存储与登录态，也跳不走顶层。
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={props.interactive ? 0 : -1}
      style={{
        width: props.display.width / scale,
        height: props.display.height / scale,
        transform: `scale(${scale})`,
      }}
      data-testid="wl-display-frame"
    />
  )
}

function ImageView(props: { name: string; url: string; display: Display }): React.JSX.Element {
  const { display } = props
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const actual = display.fit === 'actual'
  return (
    <div className={css.imageStage} data-fit={display.fit}>
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
  display: Display
  interactive: boolean
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
  return <Flow t={t} text={text} display={display} />
}

/** Markdown / 纯文本：按 `zoom` 放大缩小字号，超出展示区的部分在底边淡出。 */
function Flow(props: { t: T; text: string; display: Display }): React.JSX.Element {
  const { display } = props
  return (
    <div className={css.flow} style={{ zoom: display.zoom / 100 }} data-kind={display.kind}>
      {display.kind === 'markdown' ? (
        <Markdown t={props.t} text={props.text} className={css.md} />
      ) : (
        <pre className={css.pre}>{props.text}</pre>
      )}
    </div>
  )
}

/** 实例里的一份文件：在不在看 `stat`，修改时间变了重读。 */
function RunFileView(props: {
  t: T
  run: NonNullable<DisplayEnv['run']>
  node: string
  item: ResourceItem
  display: Display
  interactive: boolean
  writing: boolean
}): React.JSX.Element {
  const { t, run, node, display } = props
  const stat = run.stats[displayKey(node, display.item)]
  const version = stat?.exists === true ? stat.mtime : null
  const name = fileBaseName(props.item.value)
  const image = useDisplayImage(
    run.rpc,
    run.instance,
    node,
    display.item,
    display.kind === 'image' ? version : null,
  )
  const loaded = useRunFile(
    run.rpc,
    run.instance,
    display.kind === 'image' || version === null ? null : { node, item: display.item },
    version ?? 0,
  )
  const url = useHeld(image.url)
  const file = useHeld(loaded.file)

  if (stat === undefined) return <div className={css.loading} aria-busy="true" />
  if (!stat.exists) {
    return (
      <DisplayState
        icon={props.writing ? 'hourglass' : 'clock'}
        title={props.writing ? t('display.writing') : t('display.missing')}
        sub={name}
        busy={props.writing}
      />
    )
  }
  if (display.kind === 'image') {
    if (url !== null) {
      // 换了一版：新图淡入（按修改时间换一层）。
      return (
        <div key={version} className={css.fresh}>
          <ImageView name={name} url={url} display={display} />
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
  if (file?.exists) {
    return (
      <div key={file.mtime} className={css.fresh}>
        <TextView t={t} file={file} display={display} interactive={props.interactive} />
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
}): React.JSX.Element {
  const { display, item } = props
  const env = useContext(DisplayContext)
  if (env === null) throw new Error('DisplayBody 要放在 DisplayContext 里')
  const { t } = env
  const [ref, seen] = useSeen<HTMLDivElement>()
  let body: React.ReactNode
  if (!seen) body = <div className={css.loading} />
  else if (item.kind === 'text') {
    body =
      item.value.trim() === '' ? (
        <DisplayState icon="note" title={t('file.empty')} />
      ) : (
        <Flow t={t} text={item.value} display={display} />
      )
  } else if (env.run === null) {
    body = <DisplayState icon="eye" title={t('display.later')} sub={fileBaseName(item.value)} />
  } else {
    body = (
      <RunFileView
        t={t}
        run={env.run}
        node={props.node}
        item={item}
        display={display}
        interactive={props.interactive}
        writing={props.writing}
      />
    )
  }
  return (
    <div
      ref={ref}
      className={css.body}
      data-kind={display.kind}
      data-interactive={props.interactive || undefined}
      style={{ width: display.width, height: display.height }}
      data-testid="wl-display-body"
    >
      {body}
    </div>
  )
}
