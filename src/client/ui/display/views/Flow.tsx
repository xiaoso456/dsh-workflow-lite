/**
 * dsh-workflow-lite — 展示区里的 Markdown / 纯文本：按 `zoom` 缩放字号，超出的一边淡出，新加的行亮一下。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/Flow
 */

import { Fragment, useMemo } from 'react'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import { formatBytes, stripAnsi } from '../../../model/fileKind.ts'
import { newLines, prettyJson } from '../../../model/textShape.ts'
import logCss from '../../files/logViewer.module.css'
import { type ImageSource, Markdown } from '../../files/Markdown.tsx'
import css from '../display.module.css'
import { useFollow, useMarks, useOverflow, WRAP_LINES } from './follow.ts'

/**
 * 逗号后面可以断行（`<wbr>`，复制出来不多字）：没有空格的一长行（JSON 记录）折在字段之间，
 * 不会在日期、字段名中间断开。
 */
export function softBreaks(line: string): React.ReactNode {
  if (!line.includes(',')) return line
  const parts = line.split(',')
  return parts.map((part, index) =>
    index === parts.length - 1 ? (
      part
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: 同一行里的第几段，内容一变整行重排
      <Fragment key={index}>
        {part},<wbr />
      </Fragment>
    ),
  )
}

/**
 * Markdown / 纯文本：按 `zoom` 放大缩小字号。
 * 外面一层（`flowClip`）和展示区一样大、负责裁：内容真的超出了才在那一边淡出——超出底边在底边、
 * 不折行的长行超出右边在右边。进了交互不裁，展示区自己滚。
 * Markdown 里相对路径的图按文档所在目录去实例里读（`image`；自定义文字没有目录，不给）。
 * 纯文本去掉终端颜色码，压成一行的 JSON 展开缩进；一行一块（行多时只排 {@link WRAP_LINES} 行），
 * 折行时续行悬挂缩进，看得出每一条从哪开始。文件更新了，新的几行亮一下再淡下去。
 * 日志（`follow`）停在末尾：排最后几行、超出的是上边、上边淡出，前面还有多少写在最上面。
 */
export function Flow(props: {
  t: T
  text: string
  path?: string
  display: Display
  image?: ImageSource | undefined
  wrap?: boolean | undefined
  follow?: boolean
  /** 只读了末尾：前面没读的字节数。 */
  cut?: number
  interactive?: boolean
}): React.JSX.Element {
  const { t, display } = props
  const follow = props.follow === true
  const interactive = props.interactive === true
  const [clip, over] = useOverflow(follow && !interactive)
  const plain = useMemo(() => {
    if (display.kind === 'markdown') return ''
    const text = stripAnsi(props.text)
    return (props.path === undefined ? null : prettyJson(props.path, text)) ?? text
  }, [display.kind, props.text, props.path])
  const lines = useMemo(() => {
    if (plain === '') return null
    const all = plain.split(/\r?\n/u)
    if (all[all.length - 1] === '') all.pop()
    const start = follow ? Math.max(0, all.length - WRAP_LINES) : 0
    const shown = all.slice(start, start + WRAP_LINES)
    return { shown, start, rest: all.length - shown.length }
  }, [plain, follow])
  const marks = useMarks(plain, newLines)
  useFollow(clip, follow, interactive, plain)
  const cut = props.cut ?? 0
  const earlier =
    follow && (cut > 0 || (lines?.rest ?? 0) > 0)
      ? cut > 0
        ? t('display.earlierBytes').replace('{size}', formatBytes(cut))
        : t('display.earlierLines').replace('{n}', (lines?.rest ?? 0).toLocaleString())
      : null
  return (
    <div
      ref={clip}
      className={css.flowClip}
      data-over-x={over.x || undefined}
      data-over-y={over.y || undefined}
      data-tail={follow || undefined}
    >
      <div className={css.flow} style={{ zoom: display.zoom / 100 }} data-kind={display.kind}>
        {display.kind === 'markdown' ? (
          <Markdown t={t} text={props.text} className={css.md} image={props.image} />
        ) : (
          lines !== null && (
            <>
              {earlier !== null && <p className={css.earlier}>{earlier}</p>}
              <pre className={logCss.pre} data-wrap={props.wrap || undefined}>
                {lines.shown.map((line, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: 第几行就是身份，内容一变整块重排
                    key={index}
                    className={logCss.line}
                    data-new={
                      marks?.items.has(lines.start + index) === true ? marks.parity : undefined
                    }
                  >
                    {props.wrap ? softBreaks(line) : line}
                  </span>
                ))}
              </pre>
              {!follow && lines.rest > 0 && (
                <p className={css.moreLines}>
                  {t('display.moreLines').replace('{n}', lines.rest.toLocaleString())}
                </p>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}
