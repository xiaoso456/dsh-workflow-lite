/**
 * dsh-workflow-lite — 步骤之间的线上的交接标记：气泡 / 「只管先后」，悬停弹出说明卡，可就地编辑说明。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/lines/HandoffMark
 */

import { useCallback, useEffect, useState } from 'react'
import { MAX_TEXT_CODEPOINTS } from '../../../../shared/limits.ts'
import { codepointLength } from '../../../../shared/naming.ts'
import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { useFloat } from '../../kit/useFloat.tsx'
import type { HandoffActs } from '../types.ts'
import css from './handoffMark.module.css'

/** 交接卡片：悬停多久才弹出（扫过画布不该一路弹）、离开多久才收。 */
const MARK_OPEN_MS = 220
const MARK_CLOSE_MS = 200
const MARK_CARD_W = 300

/**
 * 步骤之间的线上的交接标记——只在不是缺省时出现（缺省就是交执行结果，画出来只会满屏都是）：
 * 附了交接说明是一个对话气泡，只管先后是一个虚线框的「只管先后」。点它选中这条线。
 * 颜色跟着线走（父层给的 `--wl-chip`）。
 *
 * 悬停气泡弹出一张卡片看说明；卡片上的「编辑交接」把说明就地换成输入框并把卡片钉住（边打边存，
 * 同一次输入并成一条撤销步），Esc、点空白处、点「完成」收起。右栏的交接开关另在「在右栏打开」里。
 */
export function HandoffMark(props: {
  edgeId: string
  handoff: { note?: string; none: boolean }
  route: string
  t: T
  selected: boolean
  onPick: (id: string) => void
  acts: HandoffActs
}): React.JSX.Element {
  const { handoff, t, acts } = props
  const float = useFloat<HTMLButtonElement>({
    openMs: MARK_OPEN_MS,
    closeMs: MARK_CLOSE_MS,
    width: MARK_CARD_W,
  })
  const [editing, setEditing] = useState(false)
  /** 输入框里的字。说明清空时先不写进文档（写了这条线就不再有标记、卡片跟着没了），收起时才写。 */
  const [draft, setDraft] = useState('')
  const note = handoff.note ?? ''
  const finish = useCallback((): void => {
    setEditing(false)
    acts.seal()
  }, [acts])
  // 卡片收起（点空白处、Esc、滚轮缩放）= 这次编辑结束：把清空的说明也落下去。
  useEffect(() => {
    if (float.state !== 'off' || !editing) return
    if (draft.trim() === '' && note !== '') acts.note(props.edgeId, '')
    finish()
  }, [float.state, editing, draft, note, acts, props.edgeId, finish])
  const edit = (): void => {
    setDraft(note)
    setEditing(true)
    float.cancel()
    float.setState('pinned')
  }
  const type = (value: string): void => {
    setDraft(value)
    if (codepointLength(value) > MAX_TEXT_CODEPOINTS || value.trim() === '') return
    acts.note(props.edgeId, value)
  }
  const tooLong = codepointLength(draft) > MAX_TEXT_CODEPOINTS
  return (
    <>
      <button
        ref={float.anchorRef}
        type="button"
        className={css.mark}
        data-none={handoff.none}
        data-selected={props.selected}
        data-open={float.state !== 'off'}
        data-testid="wl-handoff-mark"
        data-edge={props.edgeId}
        aria-label={`${t('hand.title')} · ${props.route}`}
        {...(handoff.none ? {} : float.hoverProps)}
        onClick={() => {
          float.setState('off')
          props.onPick(props.edgeId)
        }}
        onKeyDown={float.onKeyDown}
      >
        {handoff.none ? (
          <span>{t('hand.flowOnly')}</span>
        ) : (
          <>
            <Icon name="result" size={12} />
            <span className={css.markDot} />
          </>
        )}
      </button>
      {float.render({
        className: css.card,
        testId: 'wl-handoff-card',
        label: t('hand.title'),
        role: editing ? 'dialog' : 'tooltip',
        children: (
          // 卡片挂在视图根里，但 React 的点击仍沿组件树冒到线上：不拦的话点卡片会把这条线选中、右栏跟着弹出来。
          // biome-ignore lint/a11y/noStaticElementInteractions: 只在这一层拦住冒上来的点击
          // biome-ignore lint/a11y/useKeyWithClickEvents: 同上，键盘走卡片里各个按钮自己的事件
          <div style={{ display: 'contents' }} onClick={(event) => event.stopPropagation()}>
            <div className={css.cardHead}>
              <span className={css.cardIcon}>
                <Icon name="result" size={14} />
              </span>
              <span className={css.cardTitle}>{t('hand.note')}</span>
              <span className={css.cardRoute}>{props.route}</span>
            </div>
            {editing ? (
              <textarea
                className={cx(ui.textarea, css.cardInput)}
                value={draft}
                rows={4}
                placeholder={t('hand.notePlaceholder')}
                aria-label={t('hand.note')}
                aria-invalid={tooLong}
                data-testid="wl-handoff-card-note"
                // biome-ignore lint/a11y/noAutofocus: 点了「编辑交接」就是要打字
                autoFocus
                onFocus={(event) => {
                  const end = event.currentTarget.value.length
                  event.currentTarget.setSelectionRange(end, end)
                }}
                onChange={(event) => type(event.currentTarget.value)}
                onKeyDown={(event) => {
                  const done =
                    event.key === 'Escape' ||
                    (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
                  if (!done) return
                  event.preventDefault()
                  event.stopPropagation()
                  float.setState('off')
                  float.anchorRef.current?.focus()
                }}
              />
            ) : (
              <button
                type="button"
                className={cx(css.detailNote, css.cardNote)}
                data-testid="wl-handoff-card-text"
                onClick={edit}
              >
                {note}
              </button>
            )}
            <div className={css.cardFoot}>
              {editing ? (
                <>
                  <span className={css.cardHint}>{t('hand.editHint')}</span>
                  <button
                    type="button"
                    className={css.cardAction}
                    data-testid="wl-handoff-card-done"
                    onClick={() => float.setState('off')}
                  >
                    <Icon name="check" size={13} />
                    {t('hand.editDone')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={css.cardAction}
                    data-testid="wl-handoff-card-edit"
                    onClick={edit}
                  >
                    <Icon name="pencil" size={13} />
                    {t('hand.edit')}
                  </button>
                  <button
                    type="button"
                    className={cx(css.cardAction, css.cardActionQuiet)}
                    data-testid="wl-handoff-card-open"
                    onClick={() => {
                      float.setState('off')
                      props.onPick(props.edgeId)
                    }}
                  >
                    {t('hand.openPanel')}
                  </button>
                </>
              )}
            </div>
          </div>
        ),
      })}
    </>
  )
}
