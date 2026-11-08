/**
 * dsh-workflow-lite — 展示区里的图片：按「适应」铺满或完整放进去，原尺寸时按缩放放大缩小。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/ImageView
 */

import { useState } from 'react'
import type { Display } from '../../../model/display.ts'
import css from '../display.module.css'

export function ImageView(props: {
  name: string
  url: string
  display: Display
}): React.JSX.Element {
  const { display } = props
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const actual = display.fit === 'actual'
  return (
    <div
      className={css.imageStage}
      data-fit={display.fit}
      data-vector={props.url.startsWith('data:image/svg+xml') || undefined}
    >
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
