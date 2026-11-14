/**
 * dsh-workflow-lite — 「触发方式」对话框里 HTTP 的设置：接口卡（地址、令牌）、四种写法的调用示例，
 * 和「发一条测试请求」（带上令牌真的发一条，看收下了没有）。
 *
 * 地址、令牌是本机状态，打开过开关才有；实例视图里没有（只放说明）。
 * 令牌遮着的时候调用示例里也遮着（截图、共享屏幕不露出来），复制出去的是真的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/HttpStage
 */

import { useState } from 'react'
import type { TriggerEndpoint, TriggerPingResponse } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { SNIPPET_LANGS, type SnippetLang, snippetOf } from '../../../model/httpSnippets.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { Icon } from '../../kit/Icon.tsx'
import { FadeText } from '../../motion/marks.tsx'
import { PickThumb } from '../../motion/thumb.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import box from './commandBox.module.css'
import { CopyIcon, HttpEndpoint, TOKEN_MASK } from './HttpEndpoint.tsx'
import css from './http.module.css'
import stage from './sourceStage.module.css'

const LANG_NAME: Record<SnippetLang, string> = {
  curl: 'curl',
  powershell: 'PowerShell',
  javascript: 'JavaScript',
  python: 'Python',
}

export function HttpStage(props: {
  t: T
  node: string
  env: TriggerEnv | null
}): React.JSX.Element {
  const { t, env } = props
  const view = env?.triggers.view(props.node)
  const endpoint = view?.endpoint
  const [reveal, setReveal] = useState(false)
  return (
    <>
      {env === null ? null : endpoint === undefined ? (
        <div className={css.pending} data-testid="wl-trigger-http-pending">
          <span className={css.method}>POST</span>
          <span>{t('trigger.httpPending')}</span>
        </div>
      ) : (
        <>
          <HttpEndpoint
            t={t}
            node={props.node}
            env={env}
            endpoint={endpoint}
            reveal={reveal}
            onReveal={setReveal}
          />
          <Snippets
            t={t}
            env={env}
            node={props.node}
            endpoint={endpoint}
            reveal={reveal}
            live={view?.state === 'listening'}
          />
        </>
      )}
      <p className={stage.note}>
        <Icon name="info" size={13} />
        <span>{t('trigger.httpHint')}</span>
      </p>
    </>
  )
}

/** 调用示例：一排语言页签、示例、复制；底下「发一条测试请求」和它的结果。 */
function Snippets(props: {
  t: T
  env: TriggerEnv
  node: string
  endpoint: TriggerEndpoint
  /** 地址正在收请求（开关开着、由这里负责）。 */
  live: boolean
  /** 令牌露不露出来（和接口卡那一行一起）。 */
  reveal: boolean
}): React.JSX.Element {
  const { t, env, endpoint } = props
  const [lang, setLang] = useState<SnippetLang>('curl')
  const [ping, setPing] = useState<TriggerPingResponse | string | 'sending' | null>(null)
  const confirm = useConfirm<HTMLButtonElement>()
  const code = snippetOf(lang, endpoint)
  const shown = props.reveal ? code : snippetOf(lang, { url: endpoint.url, token: TOKEN_MASK })
  const send = (): void => {
    setPing('sending')
    void env.triggers.ping(props.node).then(setPing)
  }
  const accepted = typeof ping === 'object' && ping !== null && ping.status === 202
  return (
    <section className={stage.section}>
      <p className={stage.head}>{t('trigger.snippets')}</p>
      <div className={box.box}>
        <div className={css.tabs}>
          <div className={css.tabList} role="tablist" aria-label={t('trigger.snippets')}>
            <PickThumb layout={lang} item='[aria-selected="true"]' className={css.tabThumb} />
            {SNIPPET_LANGS.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={item === lang}
                className={css.tab}
                data-testid={`wl-trigger-snippet-${item}`}
                onClick={() => setLang(item)}
              >
                <FadeText text={LANG_NAME[item]} on={item === lang} />
              </button>
            ))}
          </div>
          <CopyIcon
            t={t}
            text={code}
            testId={lang === 'curl' ? 'wl-trigger-copy-curl' : `wl-trigger-copy-${lang}`}
          />
        </div>
        <pre className={css.code} data-testid="wl-trigger-snippet">
          {shown}
        </pre>
        <div className={css.ping}>
          <button
            ref={confirm.anchorRef}
            type="button"
            className={box.barButton}
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
        </div>
      </div>
    </section>
  )
}
