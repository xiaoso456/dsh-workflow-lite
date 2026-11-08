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
 * 平时展示区不接鼠标（拖卡片、平移、缩放画布照旧）；卡片进了「交互」才能在里面滚动、点网页里的按钮。
 * 第一次进视野、而且画布停着时才挂内容（宿主页面插拔元素要整页重算样式，平移中间插就是一次卡顿）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/ResourceDisplay
 */

import { useContext, useEffect, useRef, useState } from 'react'
import type { ResourceItem, TableView } from '../../../shared/types.ts'
import { displayKey } from '../../app/useDisplayStats.ts'
import { type Display, displayFootprint } from '../../model/display.ts'
import { fileBaseName } from '../../model/fileKind.ts'
import { useCanvasMoving } from '../motion/canvasMoving.ts'
import { DisplaySketch } from './DisplaySketch.tsx'
import css from './display.module.css'
import { DisplayContext } from './displayEnv.ts'
import { DisplayState } from './views/DisplayState.tsx'
import { Flow } from './views/Flow.tsx'
import { LatestView } from './views/LatestView.tsx'
import { RunFileBody } from './views/RunFileBody.tsx'

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
