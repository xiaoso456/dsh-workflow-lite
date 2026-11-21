/**
 * dsh-workflow-lite — 轮询、监听设置行的最后一行「工作区」：新建会话的工作区，脚本经环境变量拿到它；
 * 就地下拉（和别处的下拉一样带搜索，每项是文件夹名、下面一行完整路径）。
 *
 * 和面板「执行设置」里的工作区是同一项（写在图里的卡片上）：这里改的是草稿，跟着对话框「保存」一起写。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/WorkspaceRow
 */

import type { T } from '../../../i18n.ts'
import { folderName } from '../../../model/hostPath.ts'
import { Select } from '../../kit/Select.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import type { LocalDraft } from './runDraft.ts'
import { StageRow } from './StageRow.tsx'
import stage from './sourceStage.module.css'

/** 试运行时交给脚本的会话工作区：选了的那个，没选是当前会话的。 */
export function runWorkspace(env: TriggerEnv | null, draft: LocalDraft): string | undefined {
  if (env === null) return undefined
  return draft.value === '' ? env.here.cwd : draft.value
}

export function WorkspaceRow(props: {
  t: T
  env: TriggerEnv
  /** 草稿里的工作区（`''` 是还没选）。 */
  value: string
  /** 存着的。 */
  saved: string
  onChange(path: string): void
}): React.JSX.Element {
  const { t, env } = props
  const paths = [...new Set([...env.workspaces, props.saved, props.value])]
  return (
    <StageRow label={t('trigger.workspace')} testId="wl-trigger-source-workspace-row">
      <Select<string>
        t={t}
        search
        className={stage.fill}
        label={t('trigger.workspace')}
        value={props.value}
        testId="wl-trigger-source-workspace"
        onChange={props.onChange}
        options={paths.map((path) =>
          path === ''
            ? { value: '', label: t('trigger.workspaceNone') }
            : {
                value: path,
                label:
                  path === env.here.cwd
                    ? t('trigger.workspaceHere').replace('{name}', folderName(path))
                    : folderName(path),
                desc: path,
              },
        )}
      />
    </StageRow>
  )
}
