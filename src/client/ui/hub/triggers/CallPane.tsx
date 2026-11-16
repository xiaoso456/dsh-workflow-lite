/**
 * dsh-workflow-lite — 「触发」页 HTTP 的「调用」：地址、令牌（遮着，可以露出来、复制），四种写法的调用示例，发一条测试请求。
 *
 * 改地址、换令牌在「设置」里「触发方式」的对话框里；这里只看、只拿去用。还没有地址时说一句怎么才有。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/CallPane
 */

import { useState } from 'react'
import type { TriggerEntry, TriggerPingResponse } from '../../../../shared/wire/trigger.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { T } from '../../../i18n.ts'
import {
  SNIPPET_LANGS,
  SNIPPET_NAME,
  type SnippetLang,
  snippetOf,
} from '../../../model/httpSnippets.ts'
import { readableUrl } from '../../../model/triggerGlance.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import ui from '../../kit/ui.module.css'
import { SwapIcon } from '../../motion/swapText.tsx'
import { TOKEN_MASK } from '../../trigger/source/HttpEndpoint.tsx'
import { CopyButton } from '../pane/CopyButton.tsx'
import css from './live.module.css'

export function CallPane(props: { t: T; hub: TriggerHub; entry: TriggerEntry }): React.JSX.Element {
  const { t, hub, entry } = props
  const { view } = entry
  const endpoint = view.endpoint
  const [lang, setLang] = useState<SnippetLang>('curl')
  const [reveal, setReveal] = useState(false)
  const [ping, setPing] = useState<TriggerPingResponse | string | 'sending' | null>(null)
  const confirm = useConfirm<HTMLButtonElement>()
  if (endpoint === undefined) {
    return (
      <div className={css.empty}>
        <span className={css.emptyIcon}>
          <Icon name="globe" size={20} />
        </span>
        <p className={css.emptyTitle}>{t('hub.trgNoUrl')}</p>
        <p className={css.emptyText}>{t('hub.trgNoUrlHint')}</p>
      </div>
    )
  }
  const token = endpoint.noToken === true ? null : endpoint.token
  const code = snippetOf(lang, { url: endpoint.url, token })
  const shown =
    reveal || token === null ? code : snippetOf(lang, { url: endpoint.url, token: TOKEN_MASK })
  const live = view.state === 'listening'
  const accepted = typeof ping === 'object' && ping !== null && ping.status === 202
  const send = (): void => {
    setPing('sending')
    void hub.ping(entry.workflow, view.node).then(setPing)
  }
  return (
    <div className={css.stack} data-testid="wl-hub-trg-call">
      <div className={css.box}>
        <div className={css.field}>
          <span className={css.key}>{t('trigger.url')}</span>
          <code className={css.value} data-tip={readableUrl(endpoint.url)}>
            {readableUrl(endpoint.url)}
          </code>
          <CopyButton t={t} text={endpoint.url} testId="wl-hub-trg-copy-url" />
        </div>
        <div className={css.field}>
          <span className={css.key}>{t('trigger.token')}</span>
          {token === null ? (
            <span className={css.muted}>{t('hub.trgNoToken')}</span>
          ) : (
            <code className={css.value}>{reveal ? token : TOKEN_MASK}</code>
          )}
          <span className={css.fieldTools}>
            {token !== null && (
              <button
                type="button"
                className={cx(ui.btn, ui.small, css.ghost)}
                aria-pressed={reveal}
                data-testid="wl-hub-trg-reveal"
                onClick={() => setReveal(!reveal)}
              >
                <SwapIcon name={reveal ? 'eyeOff' : 'eye'} size={12} />
                {t(reveal ? 'trigger.hideToken' : 'trigger.showToken')}
              </button>
            )}
            {token !== null && <CopyButton t={t} text={token} testId="wl-hub-trg-copy-token" />}
          </span>
        </div>
      </div>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>{t('trigger.snippets')}</span>
          <Segmented<SnippetLang>
            label={t('trigger.snippets')}
            value={lang}
            options={SNIPPET_LANGS.map((item) => ({ value: item, label: SNIPPET_NAME[item] }))}
            testId="wl-hub-trg-snippet"
            onChange={setLang}
          />
        </div>
        <div className={css.box}>
          <pre className={css.snippet} data-testid="wl-hub-trg-snippet-code">
            {shown}
          </pre>
          <div className={cx(css.field, css.snippetFoot)}>
            <span className={css.pingResult} data-ok={accepted}>
              {ping === null || ping === 'sending'
                ? live
                  ? ''
                  : t('trigger.httpOff')
                : typeof ping === 'string'
                  ? ping
                  : accepted
                    ? t('trigger.pingOk')
                    : `${t('trigger.pingBad')} ${String(ping.status)} ${ping.text}`}
            </span>
            <span className={css.fieldTools}>
              <CopyButton t={t} text={code} testId="wl-hub-trg-copy-snippet" />
              <button
                ref={confirm.anchorRef}
                type="button"
                className={cx(ui.btn, ui.small)}
                disabled={!live || ping === 'sending'}
                data-tip={live ? undefined : t('trigger.pingOff')}
                data-testid="wl-hub-trg-ping"
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
                testId: 'wl-hub-trg-ping-confirm',
                onConfirm: send,
              })}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
