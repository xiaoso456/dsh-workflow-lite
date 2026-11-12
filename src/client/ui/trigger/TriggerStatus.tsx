/**
 * dsh-workflow-lite — 触发卡片面板最上面的「现在怎么样」：开关与状态、出了什么问题、
 * 「立即触发一次」，以及最近的触发记录。只在模板视图里出现（实例里的卡片是快照，没有现场）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerStatus
 */

import { useEffect, useState } from 'react'
import type { FireRecord } from '../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { shortTime } from '../../model/time.ts'
import { stateText } from '../../model/triggerText.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { TextArea } from '../kit/TextArea.tsx'
import ui from '../kit/ui.module.css'
import { SwitchTrack } from '../motion/marks.tsx'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'
import type { TriggerEnv } from './triggerEnv.ts'

const OUTCOME_TEXT: Record<FireRecord['outcome'], LocaleKey> = {
  sent: 'trigger.outcome.sent',
  skipped: 'trigger.outcome.skipped',
  failed: 'trigger.outcome.failed',
}

const CHANNEL_TEXT: Record<FireRecord['channel'], LocaleKey> = {
  schedule: 'trigger.channel.schedule',
  now: 'trigger.channel.now',
}

/** 面板里列几条触发记录。 */
const SHOWN = 8

export function TriggerStatus(props: { t: T; env: TriggerEnv; node: string }): React.JSX.Element {
  const { t, env, node } = props
  const view = env.triggers.view(node)
  const on = view?.enabled === true
  const state = view?.state ?? 'off'
  const [info, setInfo] = useState('')
  const [firing, setFiring] = useState(false)
  /** 刚才那次「立即触发」的结果（一句话）。 */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [fires, setFires] = useState<FireRecord[]>([])

  // 记录跟着最近一次触发走：有新的一次、或它对上了实例，就重新读。
  const lastId = view?.last?.id
  const lastInstance = view?.last?.instance
  useEffect(() => {
    let alive = true
    void env.triggers.history(node).then((list) => {
      if (alive) setFires(list.slice(0, SHOWN))
    })
    return () => {
      alive = false
    }
  }, [env.triggers.history, node, lastId, lastInstance])

  const fire = async (): Promise<void> => {
    setFiring(true)
    const record = await env.triggers.fire(node, info)
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
    setResult({
      ok: false,
      text: t('trigger.fireFailed').replace('{reason}', record.reason ?? ''),
    })
  }

  const problem =
    state === 'elsewhere' && env.triggers.owner !== undefined
      ? t('trigger.ownerOther').replace('{pid}', String(env.triggers.owner.pid))
      : state === 'stopped'
        ? `${view?.problem ?? ''} ${t('trigger.stoppedHint')}`
        : (view?.problem ?? '')

  return (
    <>
      <section className={ins.field} data-testid="wl-trigger-status" data-state={state}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={ins.required}
          data-testid="wl-trigger-enable"
          onClick={() => env.toggle(node, !on)}
        >
          <SwitchTrack on={on} />
          <span className={ins.requiredText}>
            <span className={ins.requiredTitle}>{t('trigger.switch')}</span>
            <span className={ins.requiredDesc} data-testid="wl-trigger-state-text">
              {stateText(t, view)}
            </span>
          </span>
        </button>
        {/* 一直挂着：没问题时是空的，出了问题只换字。 */}
        <p
          className={state === 'elsewhere' ? ins.help : ins.error}
          data-testid="wl-trigger-problem"
          hidden={problem === ''}
        >
          {problem}
        </p>
        <TextArea
          className={cx(ui.textarea, css.info)}
          value={info}
          rows={2}
          placeholder={t('trigger.infoPlaceholder')}
          aria-label={t('trigger.infoPlaceholder')}
          data-testid="wl-trigger-info"
          onChange={(event) => setInfo(event.currentTarget.value)}
        />
        <div className={css.fireRow}>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            disabled={firing}
            data-testid="wl-trigger-fire"
            onClick={() => void fire()}
          >
            <Icon name="bolt" size={13} />
            {t('trigger.fireNow')}
          </button>
          <span
            className={css.fireResult}
            data-ok={result?.ok ?? undefined}
            data-testid="wl-trigger-fire-result"
          >
            {result?.text ?? ''}
          </span>
        </div>
      </section>

      <section className={ins.field} data-testid="wl-trigger-history">
        <div className={ins.label}>
          <span>{t('trigger.history')}</span>
          <span className={ins.count}>{fires.length === 0 ? '' : fires.length}</span>
        </div>
        {fires.length === 0 ? (
          <p className={ins.help}>{t('trigger.historyEmpty')}</p>
        ) : (
          <ul className={css.fires}>
            {fires.map((record) => (
              <li key={record.id} className={css.fire} data-outcome={record.outcome}>
                <span className={css.fireTop}>
                  <span className={css.fireTime}>{shortTime(record.at)}</span>
                  <span className={css.fireChannel}>{t(CHANNEL_TEXT[record.channel])}</span>
                  <span className={css.fireOutcome}>{t(OUTCOME_TEXT[record.outcome])}</span>
                  {record.instance !== undefined && (
                    <button
                      type="button"
                      className={cx(ui.btn, ui.icon, ui.small, css.fireOpen)}
                      aria-label={t('trigger.openRun')}
                      data-tip={t('trigger.openRun')}
                      data-testid="wl-trigger-open-run"
                      onClick={() => env.openRun(record.instance as string)}
                    >
                      <Icon name="arrowRight" size={13} />
                    </button>
                  )}
                </span>
                {record.reason !== undefined && (
                  <span className={css.fireReason}>{record.reason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
