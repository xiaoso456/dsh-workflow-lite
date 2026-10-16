/**
 * dsh-workflow-lite — 读取中的占位：几行灰条轻轻呼吸，读完换成真内容。
 *
 * 读得快的话还没出来（延迟 150ms 才淡入）就已经换成内容了，不闪一下。
 * `list`：一行一个小块 + 两行字（工作流、实例列表）；`form`：标题 + 一排排输入框（设置、存储页）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Skeleton
 */

import ui from './ui.module.css'

/** 每行字的宽度（百分比），错落着放才像字。 */
const LINES = [72, 54, 66, 48, 60, 40]

export function Skeleton(props: {
  label: string
  shape?: 'list' | 'form'
  rows?: number
}): React.JSX.Element {
  const shape = props.shape ?? 'list'
  const rows = props.rows ?? (shape === 'list' ? 5 : 4)
  return (
    <div className={ui.skeleton} role="status" aria-label={props.label} data-shape={shape}>
      {Array.from({ length: rows }, (_row, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: 占位行，顺序不变
          key={index}
          className={ui.skelRow}
          style={{ animationDelay: `${index * 90}ms` }}
        >
          {shape === 'list' && <span className={ui.skelDot} />}
          <span className={ui.skelLines}>
            <span className={ui.skelBar} style={{ width: `${LINES[index % LINES.length]}%` }} />
            <span
              className={ui.skelBar}
              style={{ width: `${(LINES[(index + 2) % LINES.length] ?? 50) * 0.7}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  )
}
