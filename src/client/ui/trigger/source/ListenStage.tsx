/**
 * dsh-workflow-lite — 「触发方式」对话框里监听的设置。监听没有要选的规则：设置行写两句它怎么运作（每打一行执行一次；
 * 打开即启动、关掉即结束、意外退出自动重启、命令要先确认）和工作区，工作台是常驻的命令（模板、试运行 5 秒、最近的输出）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/ListenStage
 */

import type { TriggerSource } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { LISTEN_TEMPLATES } from '../../../model/commandTemplates.ts'
import { Icon } from '../../kit/Icon.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { CommandBox } from './CommandBox.tsx'
import { StageRow, StageRows } from './StageRow.tsx'
import css from './sourceStage.module.css'
import { runWorkspace, type WorkspaceDraft, WorkspaceRow } from './WorkspaceRow.tsx'

type Listen = Extract<TriggerSource, { kind: 'listen' }>

export function ListenStage(props: {
  t: T
  node: string
  source: Listen
  env: TriggerEnv | null
  workspace: WorkspaceDraft
  /** 放不放最近的输出（草稿的命令和跑着的那条一样才放）。 */
  showOutput: boolean
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source, env } = props
  return (
    <>
      <StageRows>
        <StageRow label={t('trigger.listen.fire')}>
          <p className={css.fact}>
            <Icon name="bolt" size={13} />
            {t('trigger.listen.fireFact')}
          </p>
        </StageRow>
        <StageRow label={t('trigger.listen.life')}>
          <p className={css.fact}>
            <Icon name="reload" size={13} />
            {t('trigger.listen.lifeFact')}
          </p>
        </StageRow>
        {env !== null && (
          <WorkspaceRow
            t={t}
            env={env}
            value={props.workspace.value}
            saved={props.workspace.saved}
            onChange={props.workspace.onChange}
          />
        )}
      </StageRows>
      <CommandBox
        t={t}
        node={props.node}
        kind="listen"
        title={t('trigger.listen.command')}
        command={source.command}
        placeholder={'node "{workflow}/triggers/watch.mjs"'}
        templates={LISTEN_TEMPLATES}
        env={env}
        workspace={runWorkspace(env, props.workspace)}
        recent={props.showOutput}
        onChange={(command) => props.onChange({ ...source, command })}
        onTemplate={(template) => props.onChange({ ...source, command: template.command })}
      />
    </>
  )
}
