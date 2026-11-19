/**
 * dsh-workflow-lite — 选中画布上的触发卡片时，卡片上方浮出的一条小工具条：
 * 「在工作流中心查看」（带字的主按钮）+ ⚡ 立即触发一次（只有图标，和面板里那个同一个动作）。
 *
 * 没有红点也一样在：这是从画布去工作流中心这张卡片的入口。贴着卡片上方、左边对齐，
 * 不跟画布缩放（缩小了字也看得清、点得到）。只在选中一张触发卡片时挂上（选中是一次点击，不在热路径上），
 * 出现时淡入、上浮一点；点工具条不改选中、不拖卡片（它不在卡片里）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerToolbar
 */

import { NodeToolbar, Position } from '@xyflow/react'
import type { T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { useFireNow } from './FireNow.tsx'
import type { TriggerEnv } from './triggerEnv.ts'
import css from './triggerToolbar.module.css'

/** 工具条离卡片上沿多远。 */
const GAP = 6

export function TriggerToolbar(props: { t: T; env: TriggerEnv; node: string }): React.JSX.Element {
  const { t, env, node } = props
  const fireNow = useFireNow({
    t,
    testId: 'wl-trigger-bar',
    look: 'icon',
    className: css.icon,
    fire: (info) => env.triggers.fire(node, info),
  })
  return (
    <NodeToolbar isVisible position={Position.Top} align="start" offset={GAP}>
      <div className={css.bar} data-testid="wl-trigger-bar">
        <button
          type="button"
          className={cx(ui.btn, ui.small, css.main)}
          data-testid="wl-trigger-bar-hub"
          onClick={() => env.openInHub(node)}
        >
          <Icon name="external" size={13} />
          {t('trigger.openInHub')}
        </button>
        <span className={css.sep} aria-hidden="true" />
        {fireNow.button}
      </div>
    </NodeToolbar>
  )
}
