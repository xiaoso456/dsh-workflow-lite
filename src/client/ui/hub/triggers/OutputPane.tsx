/**
 * dsh-workflow-lite — 「触发」页轮询、监听的「输出」：要跑的命令、上一次检查（轮询）或最近一行（监听），以及最近的输出。
 *
 * 挂上就读；卡片状态一变（又检查了一次、程序重启了、打出新的一行）再读一次。只换文字，不插拔元素。
 * 像终端一样停在最新的一行：人在底下就跟着新内容走，往上翻了就不动。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/OutputPane
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { commandOf } from '../../../../shared/trigger.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { T } from '../../../i18n.ts'
import { momentText } from '../../../model/triggerText.ts'
import { Icon } from '../../kit/Icon.tsx'
import { CopyButton } from './CopyButton.tsx'
import css from './live.module.css'

/** 离底边多近（像素）还算「在底下」。 */
const FOLLOW = 24

export function OutputPane(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
}): React.JSX.Element {
  const { t, hub, entry } = props
  const { view } = entry
  const command = commandOf(entry.data.source) ?? ''
  const [text, setText] = useState<string | null>(null)
  const stamp = `${view.state}|${String(view.checked?.at ?? '')}|${String(view.since ?? '')}|${String(view.next ?? '')}|${String(view.line?.at ?? '')}`
  const read = hub.output
  useEffect(() => {
    let alive = true
    void read(entry.workflow, view.node).then((value) => {
      if (alive) setText(value)
    })
    return () => {
      alive = false
    }
  }, [read, entry.workflow, view.node, stamp])

  // 人在底下（差不到一行）就跟着最新的走；刚挂上时直接到底。
  const box = useRef<HTMLPreElement>(null)
  const stuck = useRef(true)
  useLayoutEffect(() => {
    const element = box.current
    if (element !== null && stuck.current) element.scrollTop = element.scrollHeight
  }, [text])

  const now = Date.now()
  const lead =
    entry.data.source.kind === 'poll'
      ? view.checked === undefined
        ? ''
        : t(view.checked.met ? 'trigger.checkedMet' : 'trigger.checkedUnmet').replace(
            '{time}',
            momentText(t, view.checked.at, now),
          )
      : view.line === undefined
        ? ''
        : `${t('hub.trgLastLine')} ${momentText(t, view.line.at, now)}`
  const detail = entry.data.source.kind === 'listen' ? (view.line?.text ?? '') : ''

  return (
    <div className={css.console} data-testid="wl-hub-trg-output">
      <div className={css.cmdline}>
        <code className={css.cmd}>{command}</code>
      </div>
      <div className={css.consoleBar}>
        <span className={css.barLead}>{lead}</span>
        <span className={css.barText} hidden={detail === ''} data-tip={detail || undefined}>
          {detail}
        </span>
        <CopyButton t={t} text={text ?? ''} disabled={!text} testId="wl-hub-trg-output-copy" />
      </div>
      {/* 两样都挂着，按有没有输出显隐（轮询时只换字，不插拔）。 */}
      <div className={css.consoleEmpty} hidden={text !== ''}>
        <Icon name="terminal" size={18} />
        <span className={css.emptyTitle}>{t('trigger.outputEmpty')}</span>
        <span>{t('hub.trgNoOutputHint')}</span>
      </div>
      <pre
        ref={box}
        className={css.output}
        hidden={text === ''}
        data-testid="wl-hub-trg-output-text"
        onScroll={(event) => {
          const element = event.currentTarget
          stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW
        }}
      >
        {text ?? ''}
      </pre>
    </div>
  )
}
