/**
 * dsh-workflow-lite — 文件夹的「只看」：按名字筛（`*.png, report-*`），打字停一下才生效。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/options/MatchField
 */

import { useEffect, useRef, useState } from 'react'
import { FOLDER_MATCH_MAX } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { Icon } from '../../kit/Icon.tsx'
import css from '../display.module.css'

/** 名字筛选框停手多久才生效。 */
const MATCH_DELAY = 320

/**
 * 文件夹的「只看」：按名字筛（`*.png, report-*`），打字停一下生效，回车立刻生效，Esc 撤回这次输入，× 清掉。
 */
export function MatchField(props: {
  t: T
  value: string | undefined
  onChange(match: string | undefined): void
}): React.JSX.Element {
  const { t } = props
  const [draft, setDraft] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const text = draft ?? props.value ?? ''
  const cancel = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const commit = (next: string): void => {
    cancel()
    setDraft(null)
    const value = next.trim() === '' ? undefined : next.trim()
    if (value !== props.value) props.onChange(value)
  }
  useEffect(() => cancel, [])
  return (
    <div className={css.optLine}>
      <span className={css.optLabel} data-tip={t('display.matchTip')}>
        {t('display.filter')}
      </span>
      <div className={css.filterBox}>
        <Icon name="search" size={13} />
        <input
          className={css.filterInput}
          value={text}
          placeholder={t('display.matchPlaceholder')}
          aria-label={t('display.filter')}
          spellCheck={false}
          maxLength={FOLDER_MATCH_MAX}
          data-testid="wl-display-match-input"
          onChange={(event) => {
            const next = event.currentTarget.value
            setDraft(next)
            cancel()
            timer.current = window.setTimeout(() => commit(next), MATCH_DELAY)
          }}
          onBlur={() => {
            if (draft !== null) commit(draft)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(text)
            if (event.key === 'Escape' && draft !== null) {
              event.stopPropagation()
              cancel()
              setDraft(null)
            }
          }}
        />
        {text !== '' && (
          <button
            type="button"
            className={css.clearFilter}
            aria-label={t('display.filter.clear')}
            data-tip={t('display.filter.clear')}
            onClick={() => commit('')}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
