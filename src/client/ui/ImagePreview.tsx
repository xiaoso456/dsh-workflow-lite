/**
 * dsh-workflow-lite — 查看框里看一张本地图片：文件夹里点开的截图、产出里的图片文件、skill 包里的图。
 *
 * 图读回来（文件自己就是那张图）后直接摆成放大看图的那一块（{@link ImageInline}）：
 * 工具条在上面，滚轮缩放、拖动平移、双击切换适应与原大，不用再点一下弹框。读不出来（太大、不在了）就说明原因。
 * 从哪读分两种：实例里的文件（{@link RunImagePreview}，走 `run/image`）、文件夹浏览的来源（{@link BrowseImagePreview}）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ImagePreview
 */

import { useEffect, useState } from 'react'
import { type BrowseSource, useBrowseImage } from '../app/useBrowse.ts'
import { type FileTarget, type RunImage, useRunImage } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { DocContent } from './DocViewer.tsx'
import css from './files.module.css'
import { ImageInline } from './ImageZoom.tsx'

/** 摆一张读回来的图。 */
export function ImagePreview(props: {
  t: T
  /** 文件名（替代文字）。 */
  name: string
  image: RunImage
}): React.JSX.Element {
  const { t, name } = props
  const { url: loaded, error } = props.image
  // 换另一张图读回来之前，画布（工具条、读数）和上一张图原样留着，读回来再换：不整块卸掉重挂。
  const [held, setHeld] = useState<string | null>(null)
  useEffect(() => {
    if (loaded !== null) setHeld(loaded)
  }, [loaded])
  const url = loaded ?? held
  if (error !== null) {
    return (
      <DocContent
        t={t}
        body={{ kind: 'state', icon: 'alert', text: error }}
        view="rendered"
        name={name}
      />
    )
  }
  if (url === null)
    return <DocContent t={t} body={{ kind: 'loading' }} view="rendered" name={name} />
  return (
    <div className={css.imageStage} data-testid="wl-image-preview">
      <ImageInline t={t} src={url} alt={name} />
    </div>
  )
}

/** 实例里的一份图片文件。 */
export function RunImagePreview(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: FileTarget
  name: string
}): React.JSX.Element {
  const image = useRunImage(props.rpc, props.instance, props.target)
  return <ImagePreview t={props.t} name={props.name} image={image} />
}

/** 文件夹浏览里的一张图。 */
export function BrowseImagePreview(props: {
  t: T
  source: BrowseSource
  sub: string
  name: string
}): React.JSX.Element {
  const image = useBrowseImage(props.source, props.sub)
  return <ImagePreview t={props.t} name={props.name} image={image} />
}
