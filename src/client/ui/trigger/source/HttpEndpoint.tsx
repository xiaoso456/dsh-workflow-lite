/**
 * dsh-workflow-lite — HTTP 触发的地址与令牌（「触发方式」对话框的两行设置）：一行「POST + 地址」，一行令牌。
 *
 * - 地址和令牌写在触发源里，是对话框的草稿：「保存」才写进图，那之后旧地址 / 旧令牌失效。
 *   换到 HTTP 时先补上缺省的（地址用工作流名，令牌随机）；令牌默认遮住，遮不遮由外面管（调用示例跟着一起）。
 * - 地址、令牌都能点铅笔改：就地换成输入框，Enter 收下、Esc 取消，写得不对、地址和别的卡片重了当场说。
 * - 令牌那一行的「换一个令牌」换成随机的，先问一句。
 * - 令牌可以设成「不需要」（先问一句，监听地址对局域网开放时多说一句）；令牌照样留着，换回「需要」还是它。
 *
 * 网址里的中文等是转义过的（复制出去哪里都能用），显示时解开给人看。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/HttpEndpoint
 */

import { useEffect, useRef, useState } from 'react'
import { hookIssue, isLoopbackHost, tokenIssue } from '../../../../shared/triggerHttp.ts'
import type { T } from '../../../i18n.ts'
import { type Endpoint, randomToken } from '../../../model/httpEndpoint.ts'
import { readableUrl } from '../../../model/triggerGlance.ts'
import { hookIssueText, tokenIssueText } from '../../../model/triggerText.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { copyText } from '../../kit/clipboard.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import ui from '../../kit/ui.module.css'
import { useCopied } from '../../kit/useCopied.ts'
import { FadeStack } from '../../motion/stage.tsx'
import { SwapIcon, SwapText } from '../../motion/swapText.tsx'
import css from './http.module.css'
import { StageRow } from './StageRow.tsx'
import stage from './sourceStage.module.css'

/** 对话框里改地址、令牌：给了哪项改哪项。 */
export interface EndpointChange {
  hook?: string
  token?: string
  noToken?: boolean
}

/** 遮住时令牌显示成这个。 */
export const TOKEN_MASK = '•'.repeat(16)

export function HttpEndpoint(props: {
  t: T
  endpoint: Endpoint
  /** 别的卡片已经用了的地址。 */
  taken: ReadonlySet<string>
  /** 令牌露不露出来。 */
  reveal: boolean
  onReveal(reveal: boolean): void
  onChange(change: EndpointChange): void
}): React.JSX.Element {
  const { t, endpoint, reveal, onChange } = props
  const reset = useConfirm<HTMLButtonElement>()
  const open = useConfirm<HTMLSpanElement>()
  const shown = readableUrl(endpoint.url)
  const base = shown.slice(0, shown.length - endpoint.hook.length)
  const split = endpoint.hook !== '' && shown.endsWith(endpoint.hook)
  const noToken = endpoint.noToken
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
          if (next === 'on') onChange({ noToken: false })
          else open.show()
        }}
      />
      {open.render({
        t,
        title: t('trigger.noTokenTitle'),
        desc: `${t('trigger.noTokenDesc')}${lan ? t('trigger.noTokenLan') : ''}`,
        confirmText: t('trigger.noTokenConfirm'),
        testId: 'wl-trigger-no-token-confirm',
        onConfirm: () => onChange({ noToken: true }),
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
        check={(text) => {
          const issue = hookIssue(text.normalize('NFC'))
          if (issue !== null) return hookIssueText(t, issue)
          return props.taken.has(text.normalize('NFC'))
            ? t('trigger.hookTaken').replace('{hook}', text)
            : null
        }}
        editLabel={t('trigger.editUrl')}
        testId="wl-trigger-hook"
        onSave={(hook) => onChange({ hook: hook.normalize('NFC') })}
        before={<span className={css.method}>POST</span>}
        shown={
          <code className={css.url} data-tip={shown} data-testid="wl-trigger-url">
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
        check={(text) => {
          const issue = tokenIssue(text)
          return issue === null ? null : tokenIssueText(t, issue)
        }}
        editLabel={t('trigger.editToken')}
        testId="wl-trigger-token-edit"
        lead={need}
        offShown={noToken}
        off={
          <span className={stage.fact} data-testid="wl-trigger-no-token">
            {t('trigger.noTokenNote')}
          </span>
        }
        onSave={(token) => onChange({ token })}
        shown={
          <code className={css.token} data-testid="wl-trigger-token" data-masked={!reveal}>
            <SwapText text={reveal ? endpoint.token : TOKEN_MASK} />
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
              onConfirm: () => onChange({ token: randomToken() }),
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
  /** 收下这一项（已经过了 `check`）。 */
  onSave(text: string): void
  shown: React.ReactNode
  tools: React.ReactNode
  /** 值的框前面的东西（令牌的「需要 / 不需要」）。 */
  lead?: React.ReactNode
  /** 框里、值前面的东西（「POST」）：改的时候也留着，网址的前半截原地不动。 */
  before?: React.ReactNode
  /** 换掉值的框的一句话（不需要令牌）；`offShown` 时显示它，两边叠在同一格里交叉淡。 */
  off?: React.ReactNode
  offShown?: boolean
}): React.JSX.Element {
  const { t } = props
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
  const save = (): void => {
    if (text === null) return
    const value = text.trim()
    const issue = props.check(value)
    if (issue !== null) {
      setError(issue)
      return
    }
    if (value !== props.value) props.onSave(value)
    close()
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
        <OffSwap off={props.off} shown={props.offShown === true}>
          <div
            className={css.field}
            data-editing={editing}
            data-invalid={error !== null || undefined}
          >
            {props.before}
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
                  data-testid={`${props.testId}-input`}
                  onChange={(event) => {
                    setText(event.currentTarget.value)
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      save()
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
                    data-testid={`${props.testId}-save`}
                    onClick={save}
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
        </OffSwap>
      </div>
    </StageRow>
  )
}

/** 值的框和换掉它的一句话叠在同一格：换的时候交叉淡，行高、宽度不变；没有那句话就只有框。 */
function OffSwap(props: {
  off: React.ReactNode | undefined
  shown: boolean
  children: React.ReactNode
}): React.JSX.Element {
  if (props.off === undefined) return <>{props.children}</>
  return (
    <FadeStack
      className={css.offSwap}
      at={props.shown ? 'off' : 'on'}
      items={[
        { key: 'on', node: props.children },
        { key: 'off', node: props.off },
      ]}
    />
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
