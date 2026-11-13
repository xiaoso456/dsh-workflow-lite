/**
 * dsh-workflow-lite — 触发卡片中间的速览那一行（样子见 model/triggerGlance）。
 *
 * 图里写着的部分来自卡片数据；本机现场从 `view` 读：监听的最近一行、HTTP 的地址、轮询到下一次检查的进度。
 * 现场变了只换字和属性，不插拔元素（宿主的 `:has` 样式让任何插拔都整页重算）：
 * 监听的小绿点、轮询的进度条一直挂着，按属性显隐；进度条换一段时动画名在 a / b 间切，从头再放。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerGlanceRow
 */

import { useMemo } from 'react'
import type { TriggerView } from '../../../shared/wire/trigger.ts'
import {
  endpointPath,
  pollProgress,
  readableUrl,
  type TriggerGlance,
} from '../../model/triggerGlance.ts'
import { Icon } from '../kit/Icon.tsx'
import { useLast } from '../motion/swapText.tsx'
import css from './triggerGlance.module.css'

export function TriggerGlanceRow(props: {
  glance: TriggerGlance
  /** 本机现场；实例视图里没有。 */
  view: TriggerView | undefined
}): React.JSX.Element {
  const { glance, view } = props
  return (
    // span：画布卡片上它包在一个按钮里（点了打开「触发方式」）。
    <span className={css.glance} data-shape={glance.shape} data-testid="wl-trigger-glance">
      {renderShape(glance, view)}
    </span>
  )
}

function renderShape(glance: TriggerGlance, view: TriggerView | undefined): React.ReactNode {
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
    case 'poll':
      return <PollGlance glance={glance} view={view} />
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
      return (
        <>
          <span className={css.pill} data-tip={glance.workflow}>
            {glance.workflow}
          </span>
          <span className={css.arrow}>
            <Icon name="arrowRight" size={12} />
          </span>
          <span className={css.tag}>{glance.when}</span>
        </>
      )
    case 'empty':
      return <span className={css.empty}>{glance.text}</span>
  }
}

/** 轮询：每隔多久、什么时候算满足；开着时底边一条进度走到下一次检查。 */
function PollGlance(props: {
  glance: Extract<TriggerGlance, { shape: 'poll' }>
  view: TriggerView | undefined
}): React.JSX.Element {
  const { glance, view } = props
  const next = view?.state === 'waiting' ? view.next : undefined
  // 只在换了一段（下一次检查变了）时重算起点和时长：中途别的字段变了也不打断动画。
  const progress = useMemo(
    () => pollProgress(next, glance.seconds, Date.now()),
    [next, glance.seconds],
  )
  const { n } = useLast(next, 0)
  return (
    <>
      <span className={css.strong}>{glance.every}</span>
      <span className={css.soft} data-push="true">
        {glance.when}
      </span>
      <span className={css.track} data-run={progress !== null} aria-hidden="true">
        <span
          className={css.fill}
          data-cycle={n % 2 === 0 ? 'a' : 'b'}
          style={
            {
              '--from': progress?.from ?? 0,
              '--left': `${String(progress?.left ?? 0)}ms`,
            } as React.CSSProperties
          }
        />
      </span>
    </>
  )
}
