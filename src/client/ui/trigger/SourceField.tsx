/**
 * dsh-workflow-lite — 触发卡片的「何时触发」：先选触发源（定时 / 轮询 / 监听 / HTTP），下面是那一种的设置。
 *
 * - 定时：规则（`ScheduleField.tsx`）；
 * - 轮询：命令、间隔、判定方式；
 * - 监听：常驻的命令；
 * - HTTP：没有要写的，打开开关后这里给出地址、令牌和可复制的 curl（本机状态，实例视图里没有）。
 *
 * 换一种触发源就给那一种的常用值；命令写在图里，打开前要用户确认（见 `TriggerStatus.tsx`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/SourceField
 */

import { useEffect, useState } from 'react'
import {
  POLL_MAX_SECONDS,
  POLL_MIN_SECONDS,
  SOURCE_SEED,
  sourceProblem,
} from '../../../shared/trigger.ts'
import type { PollWhen, TriggerSource, TriggerSourceKind } from '../../../shared/types.ts'
import type { TriggerEndpoint } from '../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { useConfirm } from '../kit/Confirm.tsx'
import { copyText } from '../kit/clipboard.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { Segmented } from '../kit/Segmented.tsx'
import { Select } from '../kit/Select.tsx'
import { TextArea } from '../kit/TextArea.tsx'
import ui from '../kit/ui.module.css'
import { SwapIcon } from '../motion/swapText.tsx'
import ins from '../panel/panel.module.css'
import { ScheduleField } from './ScheduleField.tsx'
import css from './trigger.module.css'
import type { TriggerEnv } from './triggerEnv.ts'

const KINDS: readonly { value: TriggerSourceKind; label: LocaleKey }[] = [
  { value: 'schedule', label: 'trigger.source.schedule' },
  { value: 'poll', label: 'trigger.source.poll' },
  { value: 'listen', label: 'trigger.source.listen' },
  { value: 'http', label: 'trigger.source.http' },
]

const WHENS: readonly { value: PollWhen; label: LocaleKey; hint: LocaleKey }[] = [
  { value: 'success', label: 'trigger.pollWhen.success', hint: 'trigger.pollHint.success' },
  { value: 'change', label: 'trigger.pollWhen.change', hint: 'trigger.pollHint.change' },
]

type Unit = 'second' | 'minute' | 'hour'

const UNITS: readonly { value: Unit; label: LocaleKey; seconds: number }[] = [
  { value: 'second', label: 'trigger.unit.second', seconds: 1 },
  { value: 'minute', label: 'trigger.unit.minute', seconds: 60 },
  { value: 'hour', label: 'trigger.unit.hour', seconds: 3600 },
]

const sizeOf = (unit: Unit): number => UNITS.find((item) => item.value === unit)?.seconds ?? 1

function unitOf(seconds: number): Unit {
  if (seconds > 0 && seconds % 3600 === 0) return 'hour'
  if (seconds > 0 && seconds % 60 === 0) return 'minute'
  return 'second'
}

export function SourceField(props: {
  t: T
  node: string
  source: TriggerSource
  /** 模板视图的现场；实例视图是 `null`（没有 HTTP 地址）。 */
  env: TriggerEnv | null
  /** `typing` = 正在连续输入（并成一条撤销步）。 */
  onChange(source: TriggerSource, typing?: boolean): void
  onSeal(): void
}): React.JSX.Element {
  const { t, source } = props
  // 定时的报错与预告由 ScheduleField 自己说；这里只说命令、间隔的问题。
  const problem = source.kind === 'schedule' ? null : sourceProblem(source)
  return (
    <section className={ins.field} data-testid="wl-trigger-when" data-kind={source.kind}>
      <div className={ins.label}>
        <span>{t('trigger.when')}</span>
      </div>
      <Segmented<TriggerSourceKind>
        label={t('trigger.when')}
        value={source.kind}
        testId="wl-trigger-source"
        onChange={(kind) => {
          if (kind !== source.kind) props.onChange(SOURCE_SEED[kind])
        }}
        options={KINDS.map((kind) => ({ value: kind.value, label: t(kind.label) }))}
      />
      {source.kind === 'schedule' && (
        <ScheduleField
          t={t}
          schedule={source.schedule}
          onChange={(schedule, typing) => props.onChange({ kind: 'schedule', schedule }, typing)}
          onSeal={props.onSeal}
        />
      )}
      {(source.kind === 'poll' || source.kind === 'listen') && (
        <>
          <TextArea
            className={cx(ui.textarea, ui.mono, css.command)}
            value={source.command}
            rows={2}
            spellCheck={false}
            placeholder={
              source.kind === 'poll'
                ? 'git ls-remote origin -h refs/heads/main'
                : 'node "{workflow}/triggers/watch.mjs"'
            }
            aria-label={t('trigger.command')}
            aria-invalid={source.command.trim() === ''}
            data-testid="wl-trigger-command"
            onChange={(event) =>
              props.onChange({ ...source, command: event.currentTarget.value }, true)
            }
            onBlur={props.onSeal}
          />
          <p className={ins.help}>{t('trigger.commandHint')}</p>
        </>
      )}
      {source.kind === 'poll' && (
        <>
          <IntervalRow
            t={t}
            seconds={source.seconds}
            onChange={(seconds) => props.onChange({ ...source, seconds }, true)}
            onSeal={props.onSeal}
          />
          <div className={css.row}>
            <span className={css.rowLabel}>{t('trigger.pollWhen')}</span>
            <Segmented<PollWhen>
              label={t('trigger.pollWhen')}
              value={source.when ?? 'success'}
              testId="wl-trigger-poll-when"
              onChange={(when) => {
                const { when: _old, ...rest } = source
                props.onChange(when === 'change' ? { ...rest, when } : rest)
              }}
              options={WHENS.map((item) => ({ value: item.value, label: t(item.label) }))}
            />
          </div>
          <p className={ins.help}>
            {t(
              WHENS.find((item) => item.value === (source.when ?? 'success'))?.hint ??
                'trigger.pollHint.success',
            )}
          </p>
        </>
      )}
      {source.kind === 'listen' && <p className={ins.help}>{t('trigger.listenHint')}</p>}
      {source.kind === 'http' && <HttpEndpoint t={t} node={props.node} env={props.env} />}
      {/* 命令、间隔的问题：一直挂着，没问题时是空的。 */}
      <p className={ins.error} hidden={problem === null} data-testid="wl-trigger-source-problem">
        {problem ?? ''}
      </p>
    </section>
  )
}

/** 轮询间隔：一个数加一个单位（秒 / 分钟 / 小时）。打得出一个合法的数才写进图。 */
function IntervalRow(props: {
  t: T
  seconds: number
  onChange(seconds: number): void
  onSeal(): void
}): React.JSX.Element {
  const { t, seconds } = props
  const [unit, setUnit] = useState<Unit>(() => unitOf(seconds))
  const [draft, setDraft] = useState<string | null>(null)
  const shown = seconds % sizeOf(unit) === 0 ? unit : 'second'
  const amount = seconds / sizeOf(shown)
  const clamp = (value: number): number =>
    Math.min(POLL_MAX_SECONDS, Math.max(POLL_MIN_SECONDS, value))
  return (
    <div className={css.row}>
      <span className={css.rowLabel}>{t('trigger.every')}</span>
      <input
        className={cx(ui.input, css.number)}
        inputMode="numeric"
        value={draft ?? String(amount)}
        aria-label={t('trigger.every')}
        data-testid="wl-trigger-poll-every"
        onChange={(event) => {
          const text = event.currentTarget.value.replace(/[^\d]/gu, '')
          setDraft(text)
          const value = Number.parseInt(text, 10)
          if (Number.isFinite(value) && value > 0) props.onChange(clamp(value * sizeOf(shown)))
        }}
        onBlur={() => {
          setDraft(null)
          props.onSeal()
        }}
      />
      <Select<Unit>
        label={t('trigger.every')}
        value={shown}
        className={css.unit}
        testId="wl-trigger-poll-unit"
        onChange={(next) => {
          setUnit(next)
          setDraft(null)
          props.onChange(clamp(amount * sizeOf(next)))
        }}
        options={UNITS.map((item) => ({ value: item.value, label: t(item.label) }))}
      />
    </div>
  )
}

/** HTTP 触发的地址、令牌和 curl：打开过开关才有；令牌默认遮住。 */
function HttpEndpoint(props: { t: T; node: string; env: TriggerEnv | null }): React.JSX.Element {
  const { t, env } = props
  const endpoint = env?.triggers.view(props.node)?.endpoint
  const [reveal, setReveal] = useState(false)
  const reset = useConfirm<HTMLButtonElement>()
  if (env === null || endpoint === undefined) {
    return (
      <p className={ins.help} data-testid="wl-trigger-http-pending">
        {t('trigger.httpHint')} {env === null ? '' : t('trigger.httpPending')}
      </p>
    )
  }
  return (
    <>
      <div className={css.endpoint} data-testid="wl-trigger-endpoint">
        <span className={css.rowLabel}>{t('trigger.url')}</span>
        <code className={css.endpointValue} data-testid="wl-trigger-url">
          {endpoint.url}
        </code>
        <CopyIcon t={t} text={endpoint.url} testId="wl-trigger-copy-url" />
        <span className={css.rowLabel}>{t('trigger.token')}</span>
        <code className={css.endpointValue} data-testid="wl-trigger-token" data-masked={!reveal}>
          {reveal ? endpoint.token : '•'.repeat(16)}
        </code>
        <span className={css.endpointTools}>
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t(reveal ? 'trigger.hideToken' : 'trigger.showToken')}
            data-tip={t(reveal ? 'trigger.hideToken' : 'trigger.showToken')}
            data-testid="wl-trigger-reveal"
            onClick={() => setReveal((value) => !value)}
          >
            <Icon name="eye" size={13} />
          </button>
          <CopyIcon t={t} text={endpoint.token} testId="wl-trigger-copy-token" />
        </span>
      </div>
      <div className={css.fireRow}>
        <CopyButton t={t} endpoint={endpoint} />
        <span className={ui.grow} />
        <button
          ref={reset.anchorRef}
          type="button"
          className={cx(ui.btn, ui.small)}
          data-testid="wl-trigger-reset-token"
          onClick={reset.toggle}
        >
          {t('trigger.resetToken')}
        </button>
        {reset.render({
          t,
          title: t('trigger.resetTokenTitle'),
          desc: t('trigger.resetTokenDesc'),
          confirmText: t('trigger.resetTokenConfirm'),
          testId: 'wl-trigger-reset-confirm',
          onConfirm: () => {
            void env.triggers.set(props.node, { resetToken: true })
          },
        })}
      </div>
      <p className={ins.help}>{t('trigger.httpHint')}</p>
    </>
  )
}

/** 复制给别的程序用的 curl 命令（带上令牌）。 */
export function curlOf(endpoint: TriggerEndpoint): string {
  return `curl -X POST ${endpoint.url} -H "Authorization: Bearer ${endpoint.token}" -d "..."`
}

function CopyButton(props: { t: T; endpoint: TriggerEndpoint }): React.JSX.Element {
  const { t } = props
  const [copied, setCopied] = useCopied(curlOf(props.endpoint))
  return (
    <button
      type="button"
      className={cx(ui.btn, ui.small, ui.soft)}
      data-testid="wl-trigger-copy-curl"
      onClick={() => void copyText(curlOf(props.endpoint)).then(setCopied)}
    >
      <SwapIcon name={copied ? 'check' : 'copy'} size={13} />
      {t('trigger.copyCurl')}
    </button>
  )
}

function CopyIcon(props: { t: T; text: string; testId: string }): React.JSX.Element {
  const { t } = props
  const [copied, setCopied] = useCopied(props.text)
  return (
    <button
      type="button"
      className={cx(ui.btn, ui.icon, ui.small)}
      aria-label={t('trigger.copy')}
      data-tip={t(copied ? 'trigger.copied' : 'trigger.copy')}
      data-testid={props.testId}
      onClick={() => void copyText(props.text).then(setCopied)}
    >
      <SwapIcon name={copied ? 'check' : 'copy'} size={13} />
    </button>
  )
}

/** 「已复制」：复制的东西换了就回到没复制。 */
function useCopied(text: string): [boolean, (ok: boolean) => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setCopied(false)
  }, [text])
  return [copied, setCopied]
}
