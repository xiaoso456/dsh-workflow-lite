/**
 * dsh-workflow-lite — 触发卡片面板最上面的「现在怎么样」：开关与状态、出了什么问题、确认要运行的命令、
 * 「立即触发一次」、最近的输出（轮询、监听），以及最近的触发记录。
 * 只在模板视图里出现（实例里的卡片是快照，没有现场）。
 *
 * 要在本机跑命令的卡片，打开前在开关旁边浮出一张确认卡，列出命令和工作区；
 * 画布上点卡片的开关也走这里（`env.ask`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerStatus
 */

import { useEffect, useState } from 'react'
import { commandOf } from '../../../shared/trigger.ts'
import type { TriggerData } from '../../../shared/types.ts'
import type { FireRecord } from '../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { shortTime } from '../../model/time.ts'
import { stateText } from '../../model/triggerText.ts'
import { useConfirm } from '../kit/Confirm.tsx'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { TextArea } from '../kit/TextArea.tsx'
import ui from '../kit/ui.module.css'
import { SwitchTrack } from '../motion/marks.tsx'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'
import type { TriggerEnv } from './triggerEnv.ts'

const CHANNEL_TEXT: Record<FireRecord['channel'], LocaleKey> = {
  schedule: 'trigger.channel.schedule',
  poll: 'trigger.channel.poll',
  listen: 'trigger.channel.listen',
  http: 'trigger.channel.http',
  now: 'trigger.channel.now',
}

/** 一条记录的结果：发出去了但模型判断不需要的，单独说。 */
function outcomeKey(record: FireRecord): LocaleKey {
  if (record.declined !== undefined) return 'trigger.outcome.declined'
  if (record.outcome === 'sent') return 'trigger.outcome.sent'
  return record.outcome === 'skipped' ? 'trigger.outcome.skipped' : 'trigger.outcome.failed'
}

/** 面板里列几条触发记录。 */
const SHOWN = 8

export function TriggerStatus(props: {
  t: T
  env: TriggerEnv
  node: string
  data: TriggerData
}): React.JSX.Element {
  const { t, env, node, data } = props
  const view = env.triggers.view(node)
  const on = view?.enabled === true
  const state = view?.state ?? 'off'
  const command = commandOf(data.source)
  const [info, setInfo] = useState('')
  const [firing, setFiring] = useState(false)
  /** 刚才那次「立即触发」的结果（一句话）。 */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [fires, setFires] = useState<FireRecord[]>([])
  const [failed, setFailed] = useState('')
  const confirm = useConfirm<HTMLButtonElement>()

  // 记录跟着最近一次触发走：有新的一次、它对上了实例、模型判断了不需要，就重新读。
  const lastId = view?.last?.id
  const lastInstance = view?.last?.instance
  const lastDeclined = view?.last?.declined
  useEffect(() => {
    let alive = true
    void env.triggers.history(node).then((list) => {
      if (alive) setFires(list.slice(0, SHOWN))
    })
    return () => {
      alive = false
    }
  }, [env.triggers.history, node, lastId, lastInstance, lastDeclined])

  // 画布上点了开关、命令还没确认：在这里弹出确认卡。
  const asked = env.ask?.node === node ? env.ask.seq : 0
  useEffect(() => {
    if (asked > 0) confirm.show()
  }, [asked])

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

  /** 开关：要跑命令、还没确认的，先确认；别的直接开关。 */
  const onSwitch = (): void => {
    if (!on && command !== undefined && view?.approved !== true) {
      confirm.toggle()
      return
    }
    env.toggle(node, !on)
  }

  const approve = async (): Promise<void> => {
    if (command === undefined) return
    setFailed((await env.triggers.set(node, { approve: command, enabled: true })) ?? '')
  }

  const problem =
    failed !== ''
      ? failed
      : state === 'elsewhere' && env.triggers.owner !== undefined
        ? t('trigger.ownerOther').replace('{pid}', String(env.triggers.owner.pid))
        : state === 'stopped'
          ? `${view?.problem ?? ''} ${t('trigger.stoppedHint')}`
          : (view?.problem ?? '')
  const calm = state === 'elsewhere' || state === 'waiting' || state === 'listening'

  return (
    <>
      <section className={ins.field} data-testid="wl-trigger-status" data-state={state}>
        <button
          ref={confirm.anchorRef}
          type="button"
          role="switch"
          aria-checked={on}
          className={ins.required}
          data-testid="wl-trigger-enable"
          onClick={onSwitch}
        >
          <SwitchTrack on={on} />
          <span className={ins.requiredText}>
            <span className={ins.requiredTitle}>{t('trigger.switch')}</span>
            <span className={ins.requiredDesc} data-testid="wl-trigger-state-text">
              {stateText(t, view, data.source.kind)}
            </span>
          </span>
        </button>
        {confirm.render({
          t,
          title: t('trigger.confirmTitle'),
          desc: t('trigger.confirmDesc'),
          confirmText: t('trigger.confirmOk'),
          testId: 'wl-trigger-approve',
          disabled: view?.workspace === undefined,
          onConfirm: () => void approve(),
          children: (
            <div className={css.confirmCommand}>
              <code className={css.confirmCode} data-testid="wl-trigger-approve-command">
                {command ?? ''}
              </code>
              <span className={view?.workspace === undefined ? ins.error : ins.help}>
                {view?.workspace === undefined
                  ? t('trigger.confirmNoCwd')
                  : t('trigger.confirmCwd').replace('{path}', view.workspace)}
              </span>
            </div>
          ),
        })}
        {/* 一直挂着：没问题时是空的，出了问题只换字。 */}
        <p
          className={calm ? ins.help : ins.error}
          data-testid="wl-trigger-problem"
          hidden={problem.trim() === ''}
        >
          {problem}
        </p>
        {state === 'confirm' && (
          <button
            type="button"
            className={cx(ui.btn, ui.small)}
            data-testid="wl-trigger-confirm-again"
            onClick={() => confirm.show()}
          >
            {t('trigger.confirmAgain')}
          </button>
        )}
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

      {command !== undefined && <RecentOutput t={t} env={env} node={node} />}

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
              <li
                key={record.id}
                className={css.fire}
                data-outcome={record.declined === undefined ? record.outcome : 'declined'}
              >
                <span className={css.fireTop}>
                  <span className={css.fireTime}>{shortTime(record.at)}</span>
                  <span className={css.fireChannel}>{t(CHANNEL_TEXT[record.channel])}</span>
                  <span className={css.fireOutcome}>{t(outcomeKey(record))}</span>
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
                {(record.declined ?? record.reason) !== undefined && (
                  <span className={css.fireReason}>{record.declined ?? record.reason}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/**
 * 轮询命令、监听程序最近的输出：点开才读；开着时卡片状态一变（又检查了一次、程序重启了）就再读一次。
 * 只换文字，不插拔元素。
 */
function RecentOutput(props: { t: T; env: TriggerEnv; node: string }): React.JSX.Element {
  const { t, env, node } = props
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const view = env.triggers.view(node)
  const stamp = `${view?.state ?? ''}|${String(view?.checked?.at ?? '')}|${String(view?.since ?? '')}|${String(view?.next ?? '')}`
  useEffect(() => {
    if (!open) return
    let alive = true
    void env.triggers.output(node).then((value) => {
      if (alive) setText(value)
    })
    return () => {
      alive = false
    }
  }, [open, env.triggers.output, node, stamp])
  return (
    <section className={ins.field} data-testid="wl-trigger-output">
      <button
        type="button"
        className={cx(ui.btn, ui.small)}
        aria-expanded={open}
        data-testid="wl-trigger-output-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} />
        {t(open ? 'trigger.outputHide' : 'trigger.outputShow')}
      </button>
      {open && (
        <pre className={css.output} data-testid="wl-trigger-output-text">
          {text === '' ? t('trigger.outputEmpty') : text}
        </pre>
      )}
    </section>
  )
}
