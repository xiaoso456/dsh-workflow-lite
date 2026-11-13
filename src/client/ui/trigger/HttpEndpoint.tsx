/**
 * dsh-workflow-lite — HTTP 触发的地址、令牌和 curl（触发方式对话框里）。
 *
 * - 打开过开关才有地址和令牌（缺省地址用工作流名，令牌随机）；令牌默认遮住。
 * - 地址、令牌都能点铅笔改：就地换成输入框，Enter 保存、Esc 取消，写得不对当场说；
 *   改的是本机设置，保存即生效，不等对话框的「保存」，旧地址 / 旧令牌马上失效。
 * - 「换一个令牌」换成随机的，先问一句。
 *
 * 网址里的中文等是转义过的（复制出去哪里都能用），显示时解开给人看。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/HttpEndpoint
 */

import { useEffect, useRef, useState } from 'react'
import {
  HOOK_MAX_LENGTH,
  hookIssue,
  TOKEN_MAX_LENGTH,
  TOKEN_MIN_LENGTH,
  tokenIssue,
} from '../../../shared/triggerHttp.ts'
import type { TriggerEndpoint } from '../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { readableUrl } from '../../model/triggerGlance.ts'
import { useConfirm } from '../kit/Confirm.tsx'
import { copyText } from '../kit/clipboard.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { useCopied } from '../kit/useCopied.ts'
import { SwapIcon } from '../motion/swapText.tsx'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'
import type { TriggerEnv } from './triggerEnv.ts'

const HOOK_ISSUE = {
  empty: 'trigger.hookIssue.empty',
  chars: 'trigger.hookIssue.chars',
  long: 'trigger.hookIssue.long',
} as const satisfies Record<NonNullable<ReturnType<typeof hookIssue>>, LocaleKey>

const TOKEN_ISSUE = {
  short: 'trigger.tokenIssue.short',
  chars: 'trigger.tokenIssue.chars',
  long: 'trigger.tokenIssue.long',
} as const satisfies Record<NonNullable<ReturnType<typeof tokenIssue>>, LocaleKey>

/** 地址写得不对的一句话（界面语言）；能用是 `null`。 */
export function hookIssueText(t: T, hook: string): string | null {
  const issue = hookIssue(hook)
  return issue === null ? null : t(HOOK_ISSUE[issue]).replace('{n}', String(HOOK_MAX_LENGTH))
}

/** 令牌写得不对的一句话（界面语言）；能用是 `null`。 */
export function tokenIssueText(t: T, token: string): string | null {
  const issue = tokenIssue(token)
  if (issue === null) return null
  const n = issue === 'long' ? TOKEN_MAX_LENGTH : TOKEN_MIN_LENGTH
  return t(TOKEN_ISSUE[issue]).replace('{n}', String(n))
}

export function HttpEndpoint(props: {
  t: T
  node: string
  env: TriggerEnv | null
}): React.JSX.Element {
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
  const shown = readableUrl(endpoint.url)
  const base = shown.slice(0, shown.length - endpoint.hook.length)
  return (
    <>
      <div className={css.endpoint} data-testid="wl-trigger-endpoint">
        <EditableRow
          t={t}
          label={t('trigger.url')}
          value={endpoint.hook}
          prefix={endpoint.hook !== '' && shown.endsWith(endpoint.hook) ? base : undefined}
          help={t('trigger.hookHelp')}
          check={(text) => hookIssueText(t, text)}
          editLabel={t('trigger.editUrl')}
          testId="wl-trigger-hook"
          onSave={(hook) => env.triggers.set(props.node, { hook })}
          shown={
            <code className={css.endpointValue} data-tip={shown} data-testid="wl-trigger-url">
              {shown}
            </code>
          }
          tools={<CopyIcon t={t} text={endpoint.url} testId="wl-trigger-copy-url" />}
        />
        <EditableRow
          t={t}
          label={t('trigger.token')}
          value={endpoint.token}
          help={t('trigger.tokenHelp')}
          check={(text) => tokenIssueText(t, text)}
          editLabel={t('trigger.editToken')}
          testId="wl-trigger-token-edit"
          onSave={(token) => env.triggers.set(props.node, { token })}
          shown={
            <code
              className={css.endpointValue}
              data-testid="wl-trigger-token"
              data-masked={!reveal}
            >
              {reveal ? endpoint.token : '•'.repeat(16)}
            </code>
          }
          tools={
            <>
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
            </>
          }
        />
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
    </>
  )
}

/**
 * 端点框里的一行：名字、值、右边的小按钮和铅笔；点铅笔就地换成输入框。
 * 输入框在对话框的表单里：Enter 只保存这一项（不提交整个对话框），Esc 只收起这一项（不关对话框）。
 */
function EditableRow(props: {
  t: T
  label: string
  /** 改的时候输入框里的原值。 */
  value: string
  /** 输入框前面不能改的那一截（网址的前半）。 */
  prefix?: string | undefined
  help: string
  check(text: string): string | null
  editLabel: string
  testId: string
  /** 改不成回一句原因。 */
  onSave(text: string): Promise<string | null>
  shown: React.ReactNode
  tools: React.ReactNode
}): React.JSX.Element {
  const { t } = props
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const pencil = useRef<HTMLButtonElement>(null)
  const editing = text !== null

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const close = (): void => {
    setText(null)
    setError(null)
    // 等铅笔挂回来再还焦点。
    requestAnimationFrame(() => pencil.current?.focus({ preventScroll: true }))
  }
  const save = async (): Promise<void> => {
    if (text === null || busy) return
    const value = text.trim()
    const issue = props.check(value)
    if (issue !== null) {
      setError(issue)
      return
    }
    if (value === props.value) {
      close()
      return
    }
    setBusy(true)
    const refused = await props.onSave(value)
    setBusy(false)
    if (refused === null) close()
    else setError(refused)
  }

  return (
    <>
      <span className={css.rowLabel}>{props.label}</span>
      {editing ? (
        <span className={css.endpointEdit} data-invalid={error !== null || undefined}>
          {props.prefix !== undefined && (
            <span className={css.endpointPrefix} data-tip={props.prefix}>
              {props.prefix}
            </span>
          )}
          <input
            ref={input}
            className={css.endpointInput}
            value={text}
            spellCheck={false}
            autoComplete="off"
            aria-label={props.label}
            aria-invalid={error !== null}
            disabled={busy}
            data-testid={`${props.testId}-input`}
            onChange={(event) => {
              setText(event.currentTarget.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void save()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                close()
              }
            }}
          />
        </span>
      ) : (
        props.shown
      )}
      <span className={css.endpointTools}>
        {editing ? (
          <>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('trigger.applyEdit')}
              data-tip={t('trigger.applyEdit')}
              disabled={busy}
              data-testid={`${props.testId}-save`}
              onClick={() => void save()}
            >
              <Icon name="check" size={13} />
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('trigger.cancelEdit')}
              data-tip={t('trigger.cancelEdit')}
              data-testid={`${props.testId}-cancel`}
              onClick={close}
            >
              <Icon name="x" size={13} />
            </button>
          </>
        ) : (
          <>
            {props.tools}
            <button
              ref={pencil}
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={props.editLabel}
              data-tip={props.editLabel}
              data-testid={props.testId}
              onClick={() => setText(props.value)}
            >
              <Icon name="pencil" size={13} />
            </button>
          </>
        )}
      </span>
      {editing && (
        <p
          className={css.endpointNote}
          data-tone={error === null ? 'help' : 'error'}
          role={error === null ? undefined : 'alert'}
          data-testid={`${props.testId}-note`}
        >
          {error ?? props.help}
        </p>
      )}
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
