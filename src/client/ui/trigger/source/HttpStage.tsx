/**
 * dsh-workflow-lite — 「触发方式」对话框里 HTTP 的设置：设置行是地址和令牌，
 * 工作台是四种写法的调用示例，顶上一条右边「发一条测试请求」（带上令牌真的发一条，结果写在底栏）。
 *
 * 地址、令牌写在触发源里，和对话框里别的设置一样是草稿：换到 HTTP 时先向宿主要一份缺省的补上
 * （地址用工作流名、不和别的卡片重，令牌随机），「保存」才写进图。打开前就能看、改、复制调用示例；
 * 测试请求发的是保存着的那个地址，开关关着或草稿改过时不能发，底栏写一句。实例视图里没有现场，只写说明。
 * 令牌遮着的时候调用示例里也遮着（截图、共享屏幕不露出来），复制出去的是真的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/HttpStage
 */

import { useEffect, useRef, useState } from 'react'
import type { TriggerSource } from '../../../../shared/types.ts'
import type { TriggerPingResponse, TriggerView } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { type Endpoint, endpointOf } from '../../../model/httpEndpoint.ts'
import {
  SNIPPET_LANGS,
  SNIPPET_NAME,
  type SnippetLang,
  snippetOf,
} from '../../../model/httpSnippets.ts'
import { stateText } from '../../../model/triggerText.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Staged } from '../../motion/stage.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { Bench, BenchTabs, benchButton, benchPrimary } from './Bench.tsx'
import { CopyIcon, type EndpointChange, HttpEndpoint, TOKEN_MASK } from './HttpEndpoint.tsx'
import css from './http.module.css'
import { StageRow, StageRows } from './StageRow.tsx'
import stage from './sourceStage.module.css'

type HttpSource = Extract<TriggerSource, { kind: 'http' }>

const NO_HOOKS: ReadonlySet<string> = new Set()

/** 草稿里改地址、令牌。 */
function withEndpoint(source: HttpSource, change: EndpointChange): HttpSource {
  const { noToken: _noToken, ...rest } = source
  const noToken = change.noToken ?? source.noToken === true
  return {
    ...rest,
    ...(change.hook === undefined ? {} : { hook: change.hook }),
    ...(change.token === undefined ? {} : { token: change.token }),
    ...(noToken ? { noToken: true as const } : {}),
  }
}

/** 测试请求发往已保存且正在接收请求的地址。 */
function pingBlockOf(
  t: T,
  view: TriggerView | undefined,
  sourceDirty: boolean,
): string | undefined {
  if (sourceDirty) return t('trigger.pingSave')
  if (view?.state === 'listening') return undefined
  if (view?.state === 'off') return t('trigger.pingOff')
  if (view === undefined || view.state === 'waiting') return t('trigger.pingWaiting')
  return view.problem ?? stateText(t, view, 'http')
}

export function HttpStage(props: {
  t: T
  node: string
  env: TriggerEnv | null
  source: HttpSource
  view: TriggerView | undefined
  sourceDirty: boolean
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, env, source } = props
  const [reveal, setReveal] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [taken, setTaken] = useState<ReadonlySet<string>>(NO_HOOKS)
  const latest = useRef(props)
  latest.current = props
  const hasEnv = env !== null
  // 问一次宿主：别的卡片用了哪些地址；草稿里还没有地址、令牌就用它给的缺省补上。
  useEffect(() => {
    const ask = latest.current.env?.triggers.endpoint
    if (ask === undefined) return
    let alive = true
    void ask(props.node).then((result) => {
      if (!alive) return
      if (typeof result === 'string') {
        setProblem(result)
        return
      }
      setTaken(new Set(result.taken))
      const current = latest.current.source
      if (current.hook === undefined || current.token === undefined) {
        latest.current.onChange({
          ...current,
          hook: current.hook ?? result.hook,
          token: current.token ?? result.token,
        })
      }
    })
    return () => {
      alive = false
    }
  }, [props.node, hasEnv])
  const endpoint = env === null ? undefined : endpointOf(source, env.triggers.hookOrigin)
  if (env === null || endpoint === undefined) {
    return (
      <>
        <StageRows>
          <StageRow label={t('trigger.url')}>
            <p className={stage.fact} data-testid="wl-trigger-http-pending">
              <span className={css.method}>POST</span>
              {env === null ? t('trigger.httpPending') : (problem ?? t('trigger.httpPreparing'))}
            </p>
          </StageRow>
        </StageRows>
        <Bench icon="braces" title={t('trigger.snippets')} foot={<ListenNote t={t} env={env} />}>
          <p className={css.empty}>{t('trigger.snippetsPending')}</p>
        </Bench>
      </>
    )
  }
  return (
    <>
      <StageRows>
        <HttpEndpoint
          t={t}
          endpoint={endpoint}
          taken={taken}
          reveal={reveal}
          onReveal={setReveal}
          onChange={(change) => props.onChange(withEndpoint(source, change))}
        />
      </StageRows>
      <Snippets
        t={t}
        env={env}
        node={props.node}
        endpoint={endpoint}
        reveal={reveal}
        pingBlocked={pingBlockOf(t, props.view, props.sourceDirty)}
      />
    </>
  )
}

/** 底栏监听地址那句：画布上「设置」能点，点了在对话框上面打开工作流中心的「设置」页。 */
function ListenNote(props: { t: T; env: TriggerEnv | null }): React.JSX.Element {
  const { t } = props
  const open = props.env?.openSettings ?? null
  const [before = '', after = ''] = t('trigger.httpFoot').split('{settings}')
  const label = t('hub.settings')
  return (
    <span className={css.footNote}>
      {before}
      {open === null ? (
        label
      ) : (
        <button
          type="button"
          className={css.footLink}
          data-testid="wl-trigger-http-settings"
          onClick={open}
        >
          {label}
        </button>
      )}
      {after}
    </span>
  )
}

/** 调用示例的工作台：顶上页签、复制、发测试请求；中间示例；底栏测试请求的结果和监听地址的说明。 */
function Snippets(props: {
  t: T
  env: TriggerEnv
  node: string
  endpoint: Endpoint
  pingBlocked: string | undefined
  /** 令牌露不露出来（和设置行那一行一起）。 */
  reveal: boolean
}): React.JSX.Element {
  const { t, env, endpoint } = props
  const [lang, setLang] = useState<SnippetLang>('curl')
  const [ping, setPing] = useState<TriggerPingResponse | string | 'sending' | null>(null)
  const blocked = ping === 'sending' ? t('trigger.pingSending') : props.pingBlocked
  const confirm = useConfirm<HTMLButtonElement>()
  const token = endpoint.noToken ? null : endpoint.token
  const code = snippetOf(lang, { url: endpoint.url, token })
  const shown =
    props.reveal || token === null
      ? code
      : snippetOf(lang, { url: endpoint.url, token: TOKEN_MASK })
  const send = (): void => {
    setPing('sending')
    void env.triggers.ping(props.node).then(setPing)
  }
  const accepted = typeof ping === 'object' && ping !== null && ping.status === 202
  return (
    <Bench
      icon="braces"
      title={t('trigger.snippets')}
      testId="wl-trigger-snippets"
      middle={
        <BenchTabs<SnippetLang>
          label={t('trigger.snippets')}
          value={lang}
          options={SNIPPET_LANGS.map((item) => ({
            value: item,
            label: SNIPPET_NAME[item],
            testId: `wl-trigger-snippet-${item}`,
          }))}
          onChange={setLang}
        />
      }
      tools={
        <>
          <CopyIcon
            t={t}
            text={code}
            testId={lang === 'curl' ? 'wl-trigger-copy-curl' : `wl-trigger-copy-${lang}`}
          />
          <button
            ref={confirm.anchorRef}
            type="button"
            className={cx(benchButton, benchPrimary)}
            disabled={blocked !== undefined}
            data-tip={blocked}
            data-testid="wl-trigger-ping"
            onClick={confirm.toggle}
          >
            <Icon name="arrowRight" size={12} />
            {t('trigger.ping')}
          </button>
          {confirm.render({
            t,
            title: t('trigger.pingTitle'),
            desc: t('trigger.pingDesc'),
            confirmText: t('trigger.pingConfirm'),
            danger: false,
            testId: 'wl-trigger-ping-confirm',
            onConfirm: send,
          })}
        </>
      }
      foot={
        <>
          <span className={css.pingResult} data-testid="wl-trigger-ping-result" data-ok={accepted}>
            {ping === null || ping === 'sending' ? (
              ''
            ) : typeof ping === 'string' ? (
              ping
            ) : (
              <>
                <span className={css.status}>{ping.status}</span>
                {accepted ? t('trigger.pingOk') : `${t('trigger.pingBad')} ${ping.text}`}
              </>
            )}
          </span>
          <span
            className={css.offNote}
            hidden={props.pingBlocked === undefined}
            data-testid="wl-trigger-http-off"
          >
            {props.pingBlocked}
          </span>
          <ListenNote t={t} env={env} />
        </>
      }
    >
      {/* 换语言从页签那一侧进来；露出 / 遮住令牌、要不要令牌只淡一下。 */}
      <Staged
        at={`${lang}|${token === null}|${props.reveal}`}
        order={SNIPPET_LANGS.indexOf(lang)}
        className={css.snippetStage}
      >
        <pre className={css.code} data-testid="wl-trigger-snippet">
          {shown}
        </pre>
      </Staged>
    </Bench>
  )
}
