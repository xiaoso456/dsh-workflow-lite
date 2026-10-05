/**
 * dsh-workflow-lite — 交接：步骤之间的线把上游这一次的执行结果交给下游。
 *
 * 文件不走这里（文件是独立的卡片，见 `Files.tsx`）。一条步骤间的线只有三种状态：
 * 交执行结果（缺省）/ 交执行结果并附一段交接说明 / 只管先后。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Handoff
 */

import { useEffect, useRef, useState } from 'react'
import { MAX_TEXT_CODEPOINTS } from '../../shared/limits.ts'
import { idKey } from '../../shared/model.ts'
import { codepointLength } from '../../shared/naming.ts'
import { resolveHandoff } from '../../shared/resources.ts'
import type { WorkflowEdge } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import type { Edit } from '../model/editor.ts'
import css from './handoff.module.css'
import { Icon } from './Icon.tsx'
import ins from './inspector.module.css'
import { cx, HelpTip } from './primitives.tsx'
import ui from './ui.module.css'

/** 悬停到一个文件卡（`null` = 离开）：视图据此在画布上高亮用到它的步骤。 */
export type FocusFile = (fileId: string | null) => void

/** 一条步骤间的线交了什么（属性面板的连接清单里用）。 */
export function HandoffChip(props: { t: T; edge: WorkflowEdge }): React.JSX.Element {
  const { t } = props
  const handoff = resolveHandoff(props.edge.data?.handoff)
  if (!handoff.result) {
    return <span className={cx(css.chip, css.chipMuted)}>{t('hand.flowOnly')}</span>
  }
  return (
    <span className={css.chips}>
      <span className={css.chip} data-result="true">
        <Icon name="result" size={11} />
        <span className={css.chipText}>{t('hand.resultShort')}</span>
      </span>
      {handoff.note !== undefined && (
        <span className={css.chip} data-tip={handoff.note}>
          <Icon name="pencil" size={11} />
          <span className={css.chipText}>{handoff.note}</span>
        </span>
      )}
    </span>
  )
}

/**
 * 交接：一个开关（交不交执行结果）+ 交接说明。开关关掉时说明先记着，再打开还在。
 * 说明里连续打字并成一条撤销步。
 */
export function HandoffField(props: {
  t: T
  edge: WorkflowEdge
  /** 上游的显示名。 */
  source: string
  onEdit(edit: Edit): void
  onSeal(): void
}): React.JSX.Element {
  const { t, edge } = props
  const stored = edge.data?.handoff
  const on = stored !== false
  const storedNote = stored === undefined || stored === false ? '' : stored.note
  const [note, setNote] = useState(storedNote)
  /** 最近一次自己交出去的说明：文档里等于它就不回灌（回灌会吃掉正在打的空白）。 */
  const emitted = useRef(storedNote)
  /** 关掉开关时记住说明，再打开时放回去。 */
  const remembered = useRef(storedNote)
  const merge = `${idKey(edge.source)}->${idKey(edge.target)}:handoff`

  useEffect(() => {
    const mine = emitted.current.trim() === '' ? '' : emitted.current
    if (storedNote === mine) return
    emitted.current = storedNote
    setNote(storedNote)
  }, [storedNote])

  const toggle = (next: boolean): void => {
    if (!next) remembered.current = note
    const text = next ? remembered.current : note
    if (next) setNote(text)
    emitted.current = next ? text : ''
    props.onEdit({
      type: 'setHandoff',
      id: edge.id,
      handoff: next ? (text.trim() === '' ? undefined : { note: text }) : false,
    })
  }

  const tooLong = codepointLength(note) > MAX_TEXT_CODEPOINTS

  return (
    <section className={ins.field} data-testid="wl-handoff">
      <div className={ins.label}>
        <span className={ins.labelMain}>
          {t('hand.title')}
          <HelpTip label={t('hand.title')} testId="wl-handoff-help">
            <p className={ui.hintTitle}>{t('hand.title')}</p>
            <ul className={ui.hintList}>
              <li>{t('hand.tipWhat')}</li>
              <li>{t('hand.tipFiles')}</li>
            </ul>
          </HelpTip>
        </span>
      </div>
      <label className={css.resultRow} data-checked={on}>
        <input
          type="checkbox"
          className={css.check}
          checked={on}
          data-testid="wl-handoff-result"
          onChange={(event) => toggle(event.currentTarget.checked)}
        />
        <span className={css.detailIcon} data-result={on}>
          <Icon name="result" size={13} />
        </span>
        <span className={css.pickText}>
          <span className={css.detailTitle}>{t('hand.result')}</span>
          <span className={css.detailMeta}>
            {on ? `${props.source}${t('hand.resultOf')}` : t('hand.flowOnlyHint')}
          </span>
        </span>
      </label>
      {on && (
        <>
          <p className={css.subLabel}>
            {t('hand.note')}
            <span className={ins.optional}>{t('out.optional')}</span>
          </p>
          <textarea
            className={cx(ui.textarea, css.note, ui.rise)}
            value={note}
            rows={3}
            placeholder={t('hand.notePlaceholder')}
            aria-label={t('hand.note')}
            aria-invalid={tooLong}
            data-testid="wl-handoff-note"
            onChange={(event) => {
              const value = event.currentTarget.value
              setNote(value)
              if (codepointLength(value) > MAX_TEXT_CODEPOINTS) return
              emitted.current = value
              props.onEdit({
                type: 'setHandoff',
                id: edge.id,
                handoff: value.trim() === '' ? undefined : { note: value },
                merge,
              })
            }}
            onBlur={props.onSeal}
          />
          <p className={ins.help}>{t('hand.noteHint')}</p>
        </>
      )}
      <p className={ins.help}>{t('hand.resultHint')}</p>
    </section>
  )
}
