/**
 * dsh-workflow-lite — 触发卡片中间的速览那一行（样子见 model/triggerGlance）。
 *
 * 图里写着的部分来自卡片数据；本机现场从 `view` 读：监听的最近一行、HTTP 的地址、轮询到下一次检查的进度、
 * 接续等的那个工作流最新的实例的状态（名字前那颗点，和实例列表的状态色一样；执行中的一圈圈往外扩）。
 * 现场变了只换字和属性，不插拔元素（宿主的 `:has` 样式让任何插拔都整页重算）：
 * 监听的小绿点、轮询的进度条一直挂着，按属性显隐；进度条换一段时动画名在 a / b 间切，从头再放。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerGlanceRow
 */

import type { TriggerUpstream, TriggerView } from '../../../shared/wire/trigger.ts'
import type { T } from '../../i18n.ts'
import { endpointPath, readableUrl, type TriggerGlance } from '../../model/triggerGlance.ts'
import { momentText } from '../../model/triggerText.ts'
import { RUN_STATUS_TEXT } from '../chrome/RunStatusBadge.tsx'
import { Icon } from '../kit/Icon.tsx'
import { CountdownLine } from './CountdownLine.tsx'
import css from './triggerGlance.module.css'

export function TriggerGlanceRow(props: {
  t: T
  glance: TriggerGlance
  /** 本机现场；实例视图里没有。 */
  view: TriggerView | undefined
}): React.JSX.Element {
  const { t, glance, view } = props
  return (
    // span：画布卡片上它包在一个按钮里（点了打开「触发方式」）。
    <span className={css.glance} data-shape={glance.shape} data-testid="wl-trigger-glance">
      {renderShape(t, glance, view)}
    </span>
  )
}

function renderShape(t: T, glance: TriggerGlance, view: TriggerView | undefined): React.ReactNode {
  switch (glance.shape) {
    case 'days':
      return (
        <>
          <span className={css.days}>
            {glance.days.map((day) => (
              <i key={day.label} className={css.day} data-on={day.on}>
                {day.label}
              </i>
            ))}
          </span>
          <span className={css.strong}>{glance.time}</span>
        </>
      )
    case 'every':
      return <span className={css.strong}>{glance.text}</span>
    case 'cron':
      return (
        <>
          <span className={css.soft}>cron</span>
          <span className={css.code} data-tip={glance.expression}>
            {glance.expression}
          </span>
        </>
      )
    case 'check':
      return <CheckGlance glance={glance} view={view} />
    case 'listen': {
      const line = view?.line?.text
      return (
        <>
          <i className={css.live} data-on={line !== undefined} aria-hidden="true" />
          <span
            className={css.code}
            data-idle={line === undefined}
            data-tip={line ?? glance.command}
          >
            {line ?? glance.command}
          </span>
        </>
      )
    }
    case 'http': {
      const raw = view?.endpoint?.url
      const url = raw === undefined ? undefined : readableUrl(raw)
      return (
        <>
          <span className={css.tag}>POST</span>
          <span className={css.code} data-idle={url === undefined} data-tip={url}>
            {url === undefined ? glance.idle : endpointPath(url)}
          </span>
        </>
      )
    }
    case 'after':
      return <AfterGlance t={t} glance={glance} upstream={view?.upstream} />
    case 'empty':
      return <span className={css.empty}>{glance.text}</span>
  }
}

/** 定时检查：规则、什么时候算满足；「每隔」的开着时底边一条进度走到下一次检查。 */
function CheckGlance(props: {
  glance: Extract<TriggerGlance, { shape: 'check' }>
  view: TriggerView | undefined
}): React.JSX.Element {
  const { glance, view } = props
  const next = view?.state === 'waiting' ? view.next : undefined
  return (
    <>
      <span className={css.strong}>{glance.rule}</span>
      <span className={css.soft} data-push="true">
        {glance.when}
      </span>
      {glance.seconds !== undefined && <CountdownLine next={next} seconds={glance.seconds} />}
    </>
  )
}

/**
 * 接续：● 等的工作流 ┈ 结果 ┈→ [工作流图标]：那边成功 / 失败 / 结束了，就接着执行这个工作流。
 * 结果写在线上（和画布连线上写条件一个意思），箭头指着「这个工作流」，不指着结果。
 * 点是那个工作流最新的实例的状态，悬停名字看是哪一次。
 */
function AfterGlance(props: {
  t: T
  glance: Extract<TriggerGlance, { shape: 'after' }>
  upstream: TriggerUpstream | undefined
}): React.JSX.Element {
  const { t, glance, upstream } = props
  const status = upstream === undefined ? 'none' : (upstream.status ?? 'untracked')
  return (
    <>
      <i className={css.upstream} data-run-status={status} aria-hidden="true" />
      <span className={css.flowName} data-tip={`${glance.workflow} · ${upstreamText(t, upstream)}`}>
        {glance.workflow}
      </span>
      <span className={css.flowLine} data-outcome={glance.outcome} aria-hidden="true" />
      <span className={css.flowWhen} data-outcome={glance.outcome}>
        {glance.outcome !== 'any' && (
          <Icon name={glance.outcome === 'done' ? 'check' : 'x'} size={11} />
        )}
        {glance.when}
      </span>
      <span
        className={css.flowLine}
        data-outcome={glance.outcome}
        data-arrow="true"
        aria-hidden="true"
      />
      <span className={css.flowTarget} data-tip={t('trigger.afterTarget')}>
        <Icon name="hub" size={13} />
      </span>
    </>
  )
}

/** 等的那个工作流最新的实例：什么状态、什么时候。 */
function upstreamText(t: T, upstream: TriggerUpstream | undefined): string {
  if (upstream === undefined) return t('trigger.upstream.none')
  const time = momentText(t, upstream.at)
  if (upstream.status === undefined) return t('trigger.upstream.untracked').replace('{time}', time)
  return t('trigger.upstream.last')
    .replace('{status}', t(RUN_STATUS_TEXT[upstream.status]))
    .replace('{time}', time)
}
