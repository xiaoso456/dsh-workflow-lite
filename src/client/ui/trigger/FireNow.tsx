/**
 * dsh-workflow-lite — 「立即触发一次」：点按钮在旁边浮出一张小卡，可以写一段这一次附带的背景信息，再点「触发」。
 * 结果是一句话：发出去了几秒后自己消失；没发出去的一直留着，直到下一次。
 *
 * - {@link useFireNow}：按钮（连同浮出的小卡）和结果分开给，结果写在哪由用的地方定
 *   （画布面板写进开关那个框的状态行和下面的问题行）；
 * - {@link FireNow}：按钮右边跟着结果（工作流中心「触发」页）；
 * - `look: 'icon'`：只有一个 ⚡ 图标（画布卡片上的工具条），结果就写在它身上：发出去了换成 ✓、没发出去换成 ⚠，
 *   悬停提示换成那句话。
 *
 * 背景信息不常驻在面板里：它只在手动触发时用得上。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/FireNow
 */

import { useEffect, useRef, useState } from 'react'
import type { FireRecord } from '../../../shared/wire/trigger.ts'
import type { T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { TextArea } from '../kit/TextArea.tsx'
import ui from '../kit/ui.module.css'
import { FLOAT_EXIT_MS, useFloat } from '../kit/useFloat.tsx'
import { SwapIcon } from '../motion/swapText.tsx'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'

/** 发出去了的那句话留多久。 */
const SENT_MS = 4000
/** 发得慢时，过这么久才说「正在发」（快的时候看不见）。 */
const SLOW_MS = 300

/** 这一次的结果：`pending` 正在发（发得慢才有）、`ok` 发出去了（几秒后没有）、`bad` 没发出去。 */
export interface FireNowResult {
  tone: 'pending' | 'ok' | 'bad'
  text: string
}

export interface FireNowProps {
  t: T
  /** 触发一次：回这次的记录；请求本身失败回一句原因。 */
  fire(info: string): Promise<FireRecord | string>
  /** `data-testid` 的前缀：按钮 `-fire`、输入框 `-info`、卡片里的按钮 `-fire-send`、结果 `-fire-result`。 */
  testId: string
  /** 按钮的样子：缺省带字；`'icon'` 只有图标，结果写在图标和悬停提示上。 */
  look?: 'text' | 'icon'
  /** 按钮外加的类（工具条里的按钮样子）。 */
  className?: string
}

export function useFireNow(props: FireNowProps): {
  /** 按钮和它浮出的小卡。 */
  button: React.JSX.Element
  result: FireNowResult | null
} {
  const { t, testId } = props
  const float = useFloat<HTMLButtonElement>({
    openMs: 0,
    closeMs: 0,
    width: 300,
    align: 'auto',
    gap: 8,
    exitMs: FLOAT_EXIT_MS,
    // 打开时焦点落在输入框里。
    initialFocus: 'textarea',
  })
  const { state, setState, anchorRef } = float
  const open = state !== 'off'
  const [info, setInfo] = useState('')
  const [firing, setFiring] = useState(false)
  const [slow, setSlow] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  // 发出去了：几秒后收掉那句话。
  useEffect(() => {
    if (result?.ok !== true) return
    const timer = window.setTimeout(() => setResult(null), SENT_MS)
    return () => window.clearTimeout(timer)
  }, [result])

  // 发得慢才说「正在发」。
  useEffect(() => {
    if (!firing) {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(timer)
  }, [firing])

  const close = (): void => {
    setState('off')
    anchorRef.current?.focus({ preventScroll: true })
  }

  const send = async (): Promise<void> => {
    if (firing) return
    close()
    setFiring(true)
    setResult(null)
    const record = await props.fire(info)
    if (!alive.current) return
    setFiring(false)
    if (typeof record === 'string') {
      setResult({ ok: false, text: t('trigger.fireFailed').replace('{reason}', record) })
      return
    }
    if (record.outcome === 'sent') {
      setInfo('')
      setResult({ ok: true, text: t('trigger.fired') })
      return
    }
    setResult({ ok: false, text: t('trigger.fireFailed').replace('{reason}', record.reason ?? '') })
  }

  const shown: FireNowResult | null = slow
    ? { tone: 'pending', text: t('trigger.firing') }
    : result === null
      ? null
      : { tone: result.ok ? 'ok' : 'bad', text: result.text }
  const iconOnly = props.look === 'icon'
  const button = (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={cx(
          ui.btn,
          ui.small,
          iconOnly ? ui.icon : cx(ui.soft, css.fireText),
          props.className,
        )}
        disabled={firing}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={iconOnly ? t('trigger.fireNow') : undefined}
        data-tip={iconOnly ? (shown?.text ?? t('trigger.fireNow')) : undefined}
        data-tone={iconOnly ? shown?.tone : undefined}
        data-testid={`${testId}-fire`}
        onClick={() => (open ? close() : setState('pinned'))}
      >
        {iconOnly ? (
          <SwapIcon
            name={shown?.tone === 'ok' ? 'check' : shown?.tone === 'bad' ? 'alert' : 'bolt'}
            size={14}
          />
        ) : (
          <>
            <Icon name="bolt" size={13} />
            {t('trigger.fireNow')}
          </>
        )}
      </button>
      {float.render({
        className: ui.confirmPop,
        role: 'dialog',
        label: t('trigger.fireNow'),
        testId: `${testId}-fire-pop`,
        children: (
          // biome-ignore lint/a11y/noStaticElementInteractions: 只在这一层截住卡片里的按键
          <div
            className={css.firePop}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void send()
              }
              // Esc 留给外层收起；别的键不再往视图根冒（不会删到画布上选中的东西）。
              if (event.key !== 'Escape') event.stopPropagation()
            }}
          >
            <TextArea
              className={cx(ui.textarea, css.info)}
              value={info}
              rows={3}
              placeholder={t('trigger.infoPlaceholder')}
              aria-label={t('trigger.infoPlaceholder')}
              data-testid={`${testId}-info`}
              onChange={(event) => setInfo(event.currentTarget.value)}
            />
            <p className={ins.help}>{t('trigger.fireHint')}</p>
            <div className={css.fireActions}>
              <button type="button" className={cx(ui.btn, ui.small)} onClick={close}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.primary)}
                data-tip={t('trigger.fireSendTip')}
                data-testid={`${testId}-fire-send`}
                onClick={() => void send()}
              >
                <Icon name="bolt" size={13} />
                {t('trigger.fireSend')}
              </button>
            </div>
          </div>
        ),
      })}
    </>
  )
  return { button, result: shown }
}

export function FireNow(props: FireNowProps): React.JSX.Element {
  const { button, result } = useFireNow(props)
  return (
    <div className={css.fireRow}>
      {button}
      {/* 一直挂着，只换字。 */}
      <span
        className={css.fireResult}
        data-ok={result === null || result.tone === 'pending' ? undefined : result.tone === 'ok'}
        data-pending={result?.tone === 'pending' || undefined}
        data-testid={`${props.testId}-fire-result`}
      >
        {result?.text ?? ''}
      </span>
    </div>
  )
}
