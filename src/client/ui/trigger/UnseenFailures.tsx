/**
 * dsh-workflow-lite — 画布触发卡片状态小标上的红点：这张卡片有还没看过的失败。
 *
 * 和工作流中心「时间线」页签上的红点是同一个记号（见 `app/fireSeen.ts`）：最近一次失败比本机记的「看到哪儿了」新就亮。
 * 亮着时悬停小标浮出一张小卡：最近几次没看过的失败（时刻 + 原因），「知道了」就地记成看过，
 * 「在工作流中心查看」去那张卡片（到了时间线也记成看过）。只是选中卡片、看到面板不算看过。
 *
 * 红点一直挂着，有没有只换属性（淡入弹出 / 缩回淡出），小标的宽度不变。没亮时悬停什么都不出。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/UnseenFailures
 */

import { useEffect, useState } from 'react'
import type { FireRecord } from '../../../shared/wire/trigger.ts'
import { hasUnseenFailure, useFireSeen } from '../../app/fireSeen.ts'
import type { T } from '../../i18n.ts'
import { fireWhy } from '../../model/fireView.ts'
import { momentText } from '../../model/triggerText.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { FLOAT_EXIT_MS, useFloat } from '../kit/useFloat.tsx'
import type { TriggerEnv } from './triggerEnv.ts'
import css from './unseenFailures.module.css'

/** 小卡里最多列几次；更多的写「还有 n 次」。 */
const SHOWN = 3
/** 读最近多少条记录来找没看过的失败。 */
const SCAN = 50

export function UnseenFailures(props: {
  t: T
  env: TriggerEnv
  node: string
  lastFailure: number | undefined
  /** 状态小标。 */
  children: React.ReactNode
}): React.JSX.Element {
  const { t, env, node, lastFailure } = props
  const [seen, markSeen] = useFireSeen(env.workflow, node)
  const unseen = hasUnseenFailure(lastFailure, seen)
  const float = useFloat<HTMLSpanElement>({
    openMs: 120,
    closeMs: 220,
    width: 300,
    exitMs: FLOAT_EXIT_MS,
  })
  const { setState } = float
  // 别处记成看过了（工作流中心看了时间线）：小卡跟着收。
  useEffect(() => {
    if (!unseen) setState('off')
  }, [unseen, setState])

  return (
    <span
      ref={float.anchorRef}
      className={css.anchor}
      data-testid="wl-trigger-unseen"
      data-on={unseen || undefined}
      {...(unseen ? float.hoverProps : {})}
    >
      {props.children}
      <span className={css.dot} aria-hidden="true" />
      {unseen &&
        float.render({
          className: ui.hintPanel,
          testId: 'wl-trigger-unseen-panel',
          role: 'dialog',
          label: t('trigger.unseen.title'),
          children: (
            <FailureCard
              t={t}
              env={env}
              node={node}
              seen={seen}
              onSeen={() => {
                setState('off')
                if (lastFailure !== undefined) markSeen(lastFailure)
              }}
              onOpen={() => {
                setState('off')
                env.openInHub(node)
              }}
            />
          ),
        })}
    </span>
  )
}

/** 小卡：打开时读最近的记录，挑出没看过的失败。 */
function FailureCard(props: {
  t: T
  env: TriggerEnv
  node: string
  seen: number
  onSeen(): void
  onOpen(): void
}): React.JSX.Element {
  const { t, env, node, seen } = props
  const [failures, setFailures] = useState<FireRecord[] | null>(null)
  useEffect(() => {
    let live = true
    void env.triggers.history(node, SCAN).then((records) => {
      if (live) setFailures(records.filter((r) => r.outcome === 'failed' && r.at > seen))
    })
    return () => {
      live = false
    }
  }, [env.triggers, node, seen])
  const rest = failures === null ? 0 : failures.length - SHOWN
  return (
    <div className={css.card}>
      <p className={ui.hintTitle}>{t('trigger.unseen.title')}</p>
      <ul className={css.rows}>
        {(failures ?? []).slice(0, SHOWN).map((record) => (
          <li key={record.id} className={css.row}>
            <time className={css.time}>{momentText(t, record.at)}</time>
            <span className={css.why}>{fireWhy(record) ?? t('trigger.unseen.noReason')}</span>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className={css.more}>{t('trigger.unseen.more').replace('{n}', String(rest))}</p>
      )}
      <div className={css.actions}>
        <button
          type="button"
          className={cx(ui.btn, ui.small)}
          data-testid="wl-trigger-unseen-dismiss"
          onClick={props.onSeen}
        >
          {t('trigger.unseen.dismiss')}
        </button>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          data-testid="wl-trigger-unseen-open"
          onClick={props.onOpen}
        >
          <Icon name="external" size={13} />
          {t('trigger.openInHub')}
        </button>
      </div>
    </div>
  )
}
