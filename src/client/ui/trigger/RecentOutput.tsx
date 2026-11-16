/**
 * dsh-workflow-lite — 定时检查命令、监听程序最近的输出（「触发方式」对话框里输出台的「最近的输出」一页）。
 *
 * 和工作流中心「触发」页的「输出」同一个列表（一次检查或程序的一次运行一行，点开看输出），不带工具条；
 * 换行、错误输出照那边记下的看法。卡片状态一变就再读一次。只换文字，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/RecentOutput
 */

import { useOutputView } from '../../app/outputView.ts'
import type { T } from '../../i18n.ts'
import { OutputList } from './output/OutputList.tsx'
import { outputStamp } from './output/outputStamp.ts'
import { useOutputLog } from './output/useOutputLog.ts'
import type { TriggerEnv } from './triggerEnv.ts'

export function RecentOutput(props: {
  t: T
  env: TriggerEnv
  node: string
  kind: 'check' | 'listen'
  className?: string
}): React.JSX.Element {
  const { t, env, node } = props
  const [view] = useOutputView(props.kind)
  const model = useOutputLog({
    access: env.triggers.output,
    node,
    stamp: outputStamp(env.triggers.view(node)),
    filter: 'all',
  })
  return (
    <OutputList
      t={t}
      model={model}
      view={view}
      filter="all"
      {...(props.className === undefined ? {} : { className: props.className })}
      testId="wl-trigger-output-list"
    />
  )
}
