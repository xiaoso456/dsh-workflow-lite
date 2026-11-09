/**
 * dsh-workflow-lite — 展示区里整份读回来的文本类内容：按类型分给网页、表格、Markdown / 纯文本。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/TextView
 */

import { textWraps } from '../../../../shared/display.ts'
import { extensionOf } from '../../../../shared/fileKind.ts'
import type { RunFileResponse } from '../../../../shared/wire/run.ts'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import { fileBaseName, formatBytes } from '../../../model/fileKind.ts'
import { tableFormat } from '../../../model/textShape.ts'
import type { ImageSource } from '../../files/Markdown.tsx'
import { DisplayState } from './DisplayState.tsx'
import { Flow } from './Flow.tsx'
import { HtmlView } from './HtmlView.tsx'
import { type TableEnv, TableFlow } from './TableView.tsx'

/** 读回来的文本类内容怎么摆。 */
export function TextView(props: {
  t: T
  file: RunFileResponse
  /** 资源里写的路径（按扩展名定排成表、展开 JSON、折行）。 */
  path: string
  display: Display
  interactive: boolean
  image?: ImageSource
  /** 写它的步骤正在跑：日志停在末尾跟着往下走。 */
  writing: boolean
  table?: TableEnv | undefined
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
  const table = display.kind === 'text' ? tableFormat(props.path) : null
  if (table !== null) {
    return (
      <TableFlow
        t={t}
        text={text}
        format={table}
        display={display}
        interactive={props.interactive}
        env={props.table}
      />
    )
  }
  const wrap = display.kind === 'text' && textWraps(props.path)
  // 日志停在末尾：写的时候、只读了末尾一截时、本来就是 .log 时（要看的多半是最后几行：报错、结果）。
  const cut = file.cut ?? 0
  const follow = wrap && (props.writing || cut > 0 || extensionOf(props.path) === 'log')
  return (
    <Flow
      t={t}
      text={text}
      path={props.path}
      display={display}
      image={props.image}
      wrap={wrap}
      follow={follow}
      cut={cut}
      interactive={props.interactive}
    />
  )
}
