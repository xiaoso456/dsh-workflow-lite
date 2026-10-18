/**
 * dsh-workflow-lite — 查看框里看一张本地图片：文件夹里点开的截图、产出里的图片文件。
 *
 * 图按 `run/image` 读回来（不带 `src`：文件自己就是那张图），直接摆成放大看图的那一块（{@link ImageInline}）：
 * 工具条在上面，滚轮缩放、拖动平移、双击切换适应与原大，不用再点一下弹框。读不出来（太大、不在了）就说明原因。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ImagePreview
 */

import { type FileTarget, useRunImage } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { DocContent } from './DocViewer.tsx'
import css from './files.module.css'
import { ImageInline } from './ImageZoom.tsx'

export function ImagePreview(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: FileTarget
  /** 文件名（替代文字）。 */
  name: string
}): React.JSX.Element {
  const { t, name } = props
  const { url, error } = useRunImage(props.rpc, props.instance, props.target)
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
