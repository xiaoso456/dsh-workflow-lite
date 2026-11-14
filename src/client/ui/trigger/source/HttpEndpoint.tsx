/**
 * dsh-workflow-lite — HTTP 触发的地址与令牌（「触发方式」对话框的两行设置）：一行「POST + 地址」，一行令牌。
 *
 * - 打开过开关才有地址和令牌（缺省地址用工作流名，令牌随机）；令牌默认遮住，遮不遮由外面管（调用示例跟着一起）。
 * - 地址、令牌都能点铅笔改：就地换成输入框，Enter 保存、Esc 取消，写得不对当场说；
 *   改的是本机设置，保存即生效，不等对话框的「保存」，旧地址 / 旧令牌马上失效。
 * - 令牌那一行的「换一个令牌」换成随机的，先问一句。
 * - 令牌可以设成「不需要」（先问一句，监听地址对局域网开放时多说一句）；令牌照样留着，换回「需要」还是它。
 *
 * 网址里的中文等是转义过的（复制出去哪里都能用），显示时解开给人看。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/HttpEndpoint
 */

import { useEffect, useRef, useState } from 'react'
import {
  HOOK_MAX_LENGTH,
  hookIssue,
  isLoopbackHost,
  TOKEN_MAX_LENGTH,
  TOKEN_MIN_LENGTH,
  tokenIssue,
} from '../../../../shared/triggerHttp.ts'
import type { TriggerEndpoint } from '../../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { readableUrl } from '../../../model/triggerGlance.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { copyText } from '../../kit/clipboard.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import ui from '../../kit/ui.module.css'
import { useCopied } from '../../kit/useCopied.ts'
import { SwapIcon } from '../../motion/swapText.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import css from './http.module.css'
import { StageRow } from './StageRow.tsx'
import stage from './sourceStage.module.css'

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

/** 遮住时令牌显示成这个。 */
export const TOKEN_MASK = '•'.repeat(16)

export function HttpEndpoint(props: {
  t: T
  node: string
  env: TriggerEnv
  endpoint: TriggerEndpoint
  /** 令牌露不露出来。 */
  reveal: boolean
  onReveal(reveal: boolean): void
}): React.JSX.Element {
  const { t, env, endpoint, reveal } = props
  const reset = useConfirm<HTMLButtonElement>()
  const open = useConfirm<HTMLSpanElement>()
  const shown = readableUrl(endpoint.url)
  const base = shown.slice(0, shown.length - endpoint.hook.length)
  const split = endpoint.hook !== '' && shown.endsWith(endpoint.hook)
  const noToken = endpoint.noToken === true
  const lan = !isLoopbackHost(urlHost(endpoint.url))
  const need = (
    <span ref={open.anchorRef} className={css.need}>
      <Segmented<'on' | 'off'>
        label={t('trigger.tokenNeed')}
        value={noToken ? 'off' : 'on'}
        testId="wl-trigger-token-need"
        options={[
          { value: 'on', label: t('trigger.tokenNeed.on') },
          { value: 'off', label: t('trigger.tokenNeed.off') },
        ]}
        onChange={(next) => {
          // 换回「需要」收得紧，直接改；放开要先问一句。
          if (next === 'on') void env.triggers.set(props.node, { noToken: false })
          else open.show()
        }}
      />
      {open.render({
        t,
        title: t('trigger.noTokenTitle'),
        desc: `${t('trigger.noTokenDesc')}${lan ? t('trigger.noTokenLan') : ''}`,
        confirmText: t('trigger.noTokenConfirm'),
        testId: 'wl-trigger-no-token-confirm',
        onConfirm: () => {
          void env.triggers.set(props.node, { noToken: true })
        },
      })}
    </span>
  )
  return (
    <>
      <EditableRow
        t={t}
        label={t('trigger.url')}
        value={endpoint.hook}
        prefix={split ? base : undefined}
        help={t('trigger.hookHelp')}
        check={(text) => hookIssueText(t, text)}
        editLabel={t('trigger.editUrl')}
        testId="wl-trigger-hook"
        onSave={(hook) => env.triggers.set(props.node, { hook })}
        shown={
          <span className={css.value} data-tip={shown}>
            <span className={css.method}>POST</span>
            <code className={css.url} data-testid="wl-trigger-url">
              {shown}
            </code>
          </span>
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
        lead={need}
        off={
          noToken ? (
            <span className={stage.fact} data-testid="wl-trigger-no-token">
              {t('trigger.noTokenNote')}
            </span>
          ) : undefined
        }
        onSave={(token) => env.triggers.set(props.node, { token })}
        shown={
          <code className={css.token} data-testid="wl-trigger-token" data-masked={!reveal}>
            {reveal ? endpoint.token : TOKEN_MASK}
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
              onClick={() => props.onReveal(!reveal)}
            >
              <SwapIcon name={reveal ? 'eyeOff' : 'eye'} size={13} />
            </button>
            <button
              ref={reset.anchorRef}
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('trigger.resetToken')}
              data-tip={t('trigger.resetToken')}
              data-testid="wl-trigger-reset-token"
              onClick={reset.toggle}
            >
              <Icon name="reload" size={13} />
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
            <CopyIcon t={t} text={endpoint.token} testId="wl-trigger-copy-token" />
          </>
        }
      />
    </>
  )
}

/** 网址里的主机名（IPv6 去掉方括号）；写得不对是空串。 */
function urlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^\[(.*)\]$/u, '$1')
  } catch {
    return ''
  }
}

/**
 * 地址、令牌的一行：名字、值、右边的小按钮和铅笔；点铅笔就地换成输入框。
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
  /** 值的框前面的东西（令牌的「需要 / 不需要」）。 */
  lead?: React.ReactNode
  /** 给了就不显示值的框，换成它（不需要令牌时的一句话）。 */
  off?: React.ReactNode | undefined
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
    <StageRow
      label={props.label}
      note={editing ? (error ?? props.help) : undefined}
      problem={error !== null}
      testId={`${props.testId}-row`}
      noteTestId={`${props.testId}-note`}
    >
      <div className={css.line}>
        {props.lead}
        {props.off ?? (
          <div
            className={css.field}
            data-editing={editing}
            data-invalid={error !== null || undefined}
          >
            {editing ? (
              <span className={css.edit}>
                {props.prefix !== undefined && (
                  <span className={css.prefix} data-tip={props.prefix}>
                    {props.prefix}
                  </span>
                )}
                <input
                  ref={input}
                  className={css.input}
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
            <span className={css.tools}>
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
          </div>
        )}
      </div>
    </StageRow>
  )
}

/** 复制一段文字的小按钮：复制好了图标换成对勾一会儿。 */
export function CopyIcon(props: { t: T; text: string; testId: string }): React.JSX.Element {
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
