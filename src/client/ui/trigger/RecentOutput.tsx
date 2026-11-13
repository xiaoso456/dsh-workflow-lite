/**
 * dsh-workflow-lite — 轮询命令、监听程序最近的输出（「触发方式」对话框右栏里）。
 *
 * 挂上就读；卡片状态一变（又检查了一次、程序重启了、打出新的一行）就再读一次。只换文字，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/RecentOutput
 */

import { useEffect, useState } from 'react'
import type { T } from '../../i18n.ts'
import css from './trigger.module.css'
import type { TriggerEnv } from './triggerEnv.ts'

export function RecentOutput(props: { t: T; env: TriggerEnv; node: string }): React.JSX.Element {
  const { t, env, node } = props
  const [text, setText] = useState<string | null>(null)
  const view = env.triggers.view(node)
  const stamp = `${view?.state ?? ''}|${String(view?.checked?.at ?? '')}|${String(view?.since ?? '')}|${String(view?.next ?? '')}|${String(view?.line?.at ?? '')}`
  useEffect(() => {
    let alive = true
    void env.triggers.output(node).then((value) => {
      if (alive) setText(value)
    })
    return () => {
      alive = false
    }
  }, [env.triggers.output, node, stamp])
  return (
    <pre className={css.output} data-testid="wl-trigger-output-text" data-empty={text === ''}>
      {text === null ? '' : text === '' ? t('trigger.outputEmpty') : text}
    </pre>
  )
}
