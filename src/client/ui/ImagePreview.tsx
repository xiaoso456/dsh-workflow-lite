/**
 * dsh-workflow-lite — 查看框里看一张本地图片：文件夹里点开的截图、产出里的图片文件。
 *
 * 图按 `run/image` 读回来（不带 `src`：文件自己就是那张图），装得下就整张显示，点一下在模态框里放大（{@link ImageZoom}）。
 * 读不出来（太大、不在了）就说明原因。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ImagePreview
 */

import { useState } from 'react'
import { type FileTarget, useRunImage } from '../app/useRunFile.ts'
import type { T } from '../i18n.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { DocContent } from './DocViewer.tsx'
import css from './files.module.css'
import { ImageZoom } from './ImageZoom.tsx'

export function ImagePreview(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: FileTarget
  /** 文件名（替代文字、放大框的标题）。 */
  name: string
  /** 放大框标题下面那一行。 */
  path: string
}): React.JSX.Element {
  const { t, name } = props
  const { url, error } = useRunImage(props.rpc, props.instance, props.target)
  const [zoom, setZoom] = useState(false)
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
      <button
        type="button"
        className={css.imageBox}
        data-tip={t('file.zoom')}
        aria-label={`${name} · ${t('file.zoom')}`}
        onClick={() => setZoom(true)}
      >
        <img src={url} alt={name} draggable={false} />
      </button>
      {zoom && (
        <ImageZoom t={t} src={url} alt={name} path={props.path} onClose={() => setZoom(false)} />
      )}
    </div>
  )
}
