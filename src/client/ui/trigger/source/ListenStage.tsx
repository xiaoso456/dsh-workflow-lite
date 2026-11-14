/**
 * dsh-workflow-lite — 「触发方式」对话框里监听的设置：常驻的命令（模板、试运行跑 5 秒），
 * 跑着的话下面接着它最近的输出；再往下一条「它怎么运作」（打开即启动、每打一行执行一次、意外退出自动重启、关掉即结束）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/ListenStage
 */

import type { TriggerSource } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { LISTEN_TEMPLATES } from '../../../model/commandTemplates.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { CommandBox } from './CommandBox.tsx'
import life from './life.module.css'
import css from './sourceStage.module.css'

type Listen = Extract<TriggerSource, { kind: 'listen' }>

const STEPS: readonly { icon: IconName; title: LocaleKey; sub: LocaleKey; fire?: true }[] = [
  { icon: 'play', title: 'trigger.life.on', sub: 'trigger.life.onSub' },
  { icon: 'inputText', title: 'trigger.life.line', sub: 'trigger.life.lineSub' },
  { icon: 'bolt', title: 'trigger.life.fire', sub: 'trigger.life.fireSub', fire: true },
  { icon: 'reload', title: 'trigger.life.crash', sub: 'trigger.life.crashSub' },
  { icon: 'stop', title: 'trigger.life.off', sub: 'trigger.life.offSub' },
]

export function ListenStage(props: {
  t: T
  node: string
  source: Listen
  env: TriggerEnv | null
  /** 放不放最近的输出（草稿的命令和跑着的那条一样才放）。 */
  showOutput: boolean
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source, env } = props
  return (
    <>
      <CommandBox
        t={t}
        node={props.node}
        kind="listen"
        command={source.command}
        placeholder={'node "{workflow}/triggers/watch.mjs"'}
        templates={LISTEN_TEMPLATES}
        env={env}
        recent={props.showOutput}
        onChange={(command) => props.onChange({ ...source, command })}
        onTemplate={(template) => props.onChange({ ...source, command: template.command })}
      />
      <section className={css.section}>
        <p className={css.head}>{t('trigger.life')}</p>
        <ol className={life.steps}>
          {STEPS.map((step) => (
            <li key={step.title} className={life.step} data-fire={step.fire}>
              <span className={life.dot}>
                <Icon name={step.icon} size={14} />
              </span>
              <span className={life.title}>{t(step.title)}</span>
              <span className={life.sub}>{t(step.sub)}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className={css.note}>
        <Icon name="info" size={13} />
        <span>{t('trigger.commandHint')}</span>
      </p>
      <p className={css.note}>
        <Icon name="alert" size={13} />
        <span>{t('trigger.cmd.approveNote')}</span>
      </p>
    </>
  )
}
