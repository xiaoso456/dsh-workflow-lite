/**
 * dsh-workflow-lite — 「触发方式」对话框里 HTTP 的设置：设置行是地址和令牌，
 * 工作台是四种写法的调用示例，顶上一条右边「发一条测试请求」（带上令牌真的发一条，结果写在底栏）。
 *
 * 地址、令牌是本机状态：换到 HTTP 就先生成（不打开开关、不用先保存），打开前就能看、改、复制调用示例；
 * 开关关着时地址还不收请求，底栏写一句。实例视图里没有本机状态，只写说明。
 * 令牌遮着的时候调用示例里也遮着（截图、共享屏幕不露出来），复制出去的是真的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/HttpStage
 */

import { useEffect, useState } from 'react'
import type { TriggerEndpoint, TriggerPingResponse } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import {
  SNIPPET_LANGS,
  SNIPPET_NAME,
  type SnippetLang,
  snippetOf,
} from '../../../model/httpSnippets.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Staged } from '../../motion/stage.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { Bench, BenchTabs, benchButton, benchPrimary } from './Bench.tsx'
import { CopyIcon, HttpEndpoint, TOKEN_MASK } from './HttpEndpoint.tsx'
import css from './http.module.css'
import { StageRow, StageRows } from './StageRow.tsx'
import stage from './sourceStage.module.css'

export function HttpStage(props: {
  t: T
  node: string
  env: TriggerEnv | null
}): React.JSX.Element {
  const { t, env } = props
  const view = env?.triggers.view(props.node)
  const endpoint = view?.endpoint
  const [reveal, setReveal] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const missing = env !== null && endpoint === undefined
  const prepare = env?.triggers.set
  // 还没有地址、令牌：先生成一份（不打开开关），列表随之带回来。
  useEffect(() => {
    if (!missing || prepare === undefined) return
    let alive = true
    void prepare(props.node, { prepareEndpoint: true }).then((error) => {
      if (alive) setProblem(error)
    })
    return () => {
      alive = false
    }
  }, [missing, prepare, props.node])
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
          node={props.node}
          env={env}
          endpoint={endpoint}
          reveal={reveal}
          onReveal={setReveal}
        />
      </StageRows>
      <Snippets
        t={t}
        env={env}
        node={props.node}
        endpoint={endpoint}
        reveal={reveal}
        live={view?.state === 'listening'}
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
  endpoint: TriggerEndpoint
  /** 地址正在收请求（开关开着、由这里负责）。 */
  live: boolean
  /** 令牌露不露出来（和设置行那一行一起）。 */
  reveal: boolean
}): React.JSX.Element {
  const { t, env, endpoint } = props
  const [lang, setLang] = useState<SnippetLang>('curl')
  const [ping, setPing] = useState<TriggerPingResponse | string | 'sending' | null>(null)
  const confirm = useConfirm<HTMLButtonElement>()
  const token = endpoint.noToken === true ? null : endpoint.token
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
            disabled={!props.live || ping === 'sending'}
            data-tip={props.live ? undefined : t('trigger.pingOff')}
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
          <span className={css.offNote} hidden={props.live} data-testid="wl-trigger-http-off">
            {t('trigger.httpOff')}
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
