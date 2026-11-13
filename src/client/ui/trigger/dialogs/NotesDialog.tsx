/**
 * dsh-workflow-lite — 「触发条件与说明」对话框：每次触发交给模型的两段话（草稿，「保存」才写进图）。
 *
 * - 触发条件：模型先按它判断这次要不要执行，不要就不开始工作流；
 * - 触发说明：每次触发原样交给模型。
 *
 * 面板上两行摘要点哪一行，打开后焦点就落在哪一段。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/NotesDialog
 */

import { useEffect, useRef, useState } from 'react'
import type { TriggerData } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { TextArea } from '../../kit/TextArea.tsx'
import ui from '../../kit/ui.module.css'
import ins from '../../panel/panel.module.css'
import { TriggerMark } from '../TriggerMark.tsx'
import css from '../trigger.module.css'
import { TriggerSheet } from './TriggerSheet.tsx'

export type NotesField = 'condition' | 'note'

export function NotesDialog(props: {
  t: T
  name: string
  data: TriggerData
  /** 打开后焦点落在哪一段。 */
  focus: NotesField
  onSave(change: { condition: string | undefined; note: string | undefined }): void
  onClose(): void
}): React.JSX.Element {
  const { t, data } = props
  const [condition, setCondition] = useState(data.condition ?? '')
  const [note, setNote] = useState(data.note ?? '')
  const dirty = condition !== (data.condition ?? '') || note !== (data.note ?? '')
  const conditionRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // 弹窗自己先拿焦点（Modal），这里再交给点开的那一段，光标放到末尾。
  useEffect(() => {
    const box = (props.focus === 'condition' ? conditionRef : noteRef).current
    if (box === null) return
    box.focus({ preventScroll: true })
    box.setSelectionRange(box.value.length, box.value.length)
  }, [props.focus])

  const blank = (text: string): string | undefined => (text.trim() === '' ? undefined : text)
  return (
    <TriggerSheet
      t={t}
      title={t('trigger.notes')}
      sub={props.name}
      mark={<TriggerMark kind={data.source.kind} size={16} />}
      testId="wl-trigger-notes-dialog"
      dirty={dirty}
      canSave
      onSave={() => {
        if (dirty) props.onSave({ condition: blank(condition), note: blank(note) })
        props.onClose()
      }}
      onClose={props.onClose}
    >
      <label className={css.stack}>
        <span className={css.rowLabel}>{t('trigger.condition')}</span>
        <TextArea
          ref={conditionRef}
          className={cx(ui.textarea, css.note)}
          value={condition}
          rows={4}
          placeholder={t('trigger.conditionPlaceholder')}
          aria-label={t('trigger.condition')}
          data-testid="wl-trigger-condition"
          onChange={(event) => setCondition(event.currentTarget.value)}
        />
        <span className={ins.help}>{t('trigger.conditionHint')}</span>
      </label>
      <label className={css.stack}>
        <span className={css.rowLabel}>{t('trigger.note')}</span>
        <TextArea
          ref={noteRef}
          className={cx(ui.textarea, css.note)}
          value={note}
          rows={6}
          placeholder={t('trigger.notePlaceholder')}
          aria-label={t('trigger.note')}
          data-testid="wl-trigger-note"
          onChange={(event) => setNote(event.currentTarget.value)}
        />
        <span className={ins.help}>{t('trigger.noteHint')}</span>
      </label>
    </TriggerSheet>
  )
}
