/**
 * dsh-workflow-lite — 定时检查、监听设置行里的「脚本目录」：命令在哪个目录里跑，就地下拉。
 *
 * 缺省是这张卡片自己的目录（`{workflow}/triggers/<卡片>/`，脚本就放在那里）；也可以选会话工作区、
 * 工作流目录，或在主机上另选一个文件夹。写在图里的卡片上，和对话框里别的设置一样是草稿，「保存」才写。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/CwdRow
 */

import { useState } from 'react'
import { WORKFLOW_VAR, WORKSPACE_VAR } from '../../../../shared/pathVars.ts'
import type { T } from '../../../i18n.ts'
import { folderName } from '../../../model/hostPath.ts'
import { Select, type SelectOption } from '../../kit/Select.tsx'
import { HostPicker } from '../../resources/HostPicker.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import type { LocalDraft } from './runDraft.ts'
import { StageRow } from './StageRow.tsx'
import stage from './sourceStage.module.css'

/** 「选择其他文件夹」那一项的值（路径不会以冒号开头）。 */
const PICK = ':pick'

export function CwdRow(props: {
  t: T
  env: TriggerEnv
  node: string
  /** 草稿（`''` = 卡片目录）。 */
  draft: LocalDraft
  /** 会话工作区的草稿（选文件夹时从它开始翻）。 */
  workspace: string
}): React.JSX.Element {
  const { t, env, draft } = props
  const [picking, setPicking] = useState(false)
  const options: SelectOption<string>[] = [
    {
      value: '',
      label: t('trigger.cwd.card'),
      desc: `${WORKFLOW_VAR}/triggers/${props.node}`,
    },
    { value: WORKSPACE_VAR, label: t('trigger.cwd.workspace'), desc: WORKSPACE_VAR },
    { value: WORKFLOW_VAR, label: t('trigger.cwd.workflow'), desc: WORKFLOW_VAR },
  ]
  for (const path of new Set([draft.saved, draft.value])) {
    if (options.some((option) => option.value === path)) continue
    options.push({ value: path, label: folderName(path), desc: path })
  }
  options.push({ value: PICK, label: t('trigger.cwd.pick') })
  return (
    <StageRow label={t('trigger.cwd')} testId="wl-trigger-source-cwd-row">
      <Select<string>
        t={t}
        search
        className={stage.fill}
        label={t('trigger.cwd')}
        value={draft.value}
        testId="wl-trigger-source-cwd"
        onChange={(value) => {
          if (value === PICK) setPicking(true)
          else draft.onChange(value)
        }}
        options={options}
      />
      {picking && (
        <HostPicker
          t={t}
          host={env.shells.host}
          mode="folder"
          single
          {...(props.workspace === '' ? {} : { start: props.workspace })}
          onPick={(paths) => {
            setPicking(false)
            const path = paths[0]
            if (path !== undefined) draft.onChange(path)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </StageRow>
  )
}
