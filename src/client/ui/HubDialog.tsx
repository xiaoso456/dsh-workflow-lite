/**
 * dsh-workflow-lite — 工作流中心：放所有**跨工作流、跨会话**的东西。
 *
 * 标题栏和「工作流设置」同一种样子，几页的切换放在标题栏里：
 * - **运行实例**（`HubRuns.tsx`）：所有会话的实例，按工作区分组，能搜、能按工作区 / 本会话筛；
 *   查看、移到本会话、删除记录（状态文件另外问要不要一起删）；
 * - **工作流**（`HubWorkflows.tsx`）：全部工作流，每一行能就地改名、删除；选一张看它的版本——存、切换、改说明、删除，不用先打开它；
 * - **存储**（`HubStorage.tsx`）：数据目录、各样东西的占用，清理已结束的实例与旧版本遗留文件；
 * - **设置**（`HubSettings.tsx`）：插件自己的几项设置（数据目录、步骤上限、自动保存等待……）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubDialog
 */

import { useState } from 'react'
import type { SessionRow } from '../app/sessions.ts'
import type { Runs } from '../app/useRuns.ts'
import type { T } from '../i18n.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { HubRuns } from './HubRuns.tsx'
import { HubSettings } from './HubSettings.tsx'
import { HubStorage } from './HubStorage.tsx'
import { HubWorkflows } from './HubWorkflows.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import overlay from './overlay.module.css'
import { cx, Modal, Segmented } from './primitives.tsx'
import ui from './ui.module.css'

type HubPage = 'runs' | 'workflows' | 'storage' | 'settings'

export function HubDialog(props: {
  t: T
  rpc: WorkflowLiteRpc
  session: string | undefined
  /** 宿主的会话列表（拿会话标题、本会话的工作区）；会话服务没接上时是空的。 */
  sessionRows: readonly SessionRow[]
  /** 会话服务接上了没有（没接上就不说"会话已不在"，只说"其他会话"）。 */
  sessionsReady: boolean
  runs: Runs
  onOpenRun(id: string): void
  /** 「工作流」页要的：编辑页正开着哪张、怎么把它的改动写下去 / 重新加载、怎么打开别的一张。 */
  workflows: {
    current: string | null
    flush(): Promise<boolean>
    onReload(): void
    onOpen(name: string): void
    rename(from: string, to: string): Promise<boolean>
    remove(name: string): Promise<boolean>
    onChanged(): void
  }
  onClose(): void
}): React.JSX.Element {
  const { t, runs } = props
  const [page, setPage] = useState<HubPage>('runs')
  return (
    <Modal label={t('hub.title')} onDismiss={props.onClose} className={hub.dialog} testId="wl-hub">
      <header className={hub.head}>
        <span className={overlay.sheetIcon}>
          <Icon name="hub" size={16} />
        </span>
        <div className={overlay.sheetTitles}>
          <p className={overlay.sheetTitle}>{t('hub.title')}</p>
          <p className={overlay.sheetSub}>{t('hub.sub')}</p>
        </div>
        <div className={hub.tabs}>
          <Segmented<HubPage>
            label={t('hub.title')}
            value={page}
            onChange={setPage}
            testId="wl-hub"
            options={[
              { value: 'runs', label: t('hub.runs') },
              { value: 'workflows', label: t('hub.wfPage') },
              { value: 'storage', label: t('hub.storage') },
              { value: 'settings', label: t('hub.settings') },
            ]}
          />
        </div>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small)}
          aria-label={t('common.close')}
          onClick={props.onClose}
        >
          <Icon name="x" size={15} />
        </button>
      </header>
      {page === 'runs' ? (
        <HubRuns
          t={t}
          session={props.session}
          sessionRows={props.sessionRows}
          sessionsReady={props.sessionsReady}
          runs={runs}
          onOpenRun={(id) => {
            props.onOpenRun(id)
            props.onClose()
          }}
        />
      ) : page === 'workflows' ? (
        <HubWorkflows
          t={t}
          rpc={props.rpc}
          {...props.workflows}
          onOpen={(name) => {
            props.workflows.onOpen(name)
            props.onClose()
          }}
        />
      ) : page === 'storage' ? (
        <HubStorage t={t} rpc={props.rpc} onChanged={runs.refresh} />
      ) : (
        <HubSettings t={t} rpc={props.rpc} onSaved={props.workflows.onChanged} />
      )}
    </Modal>
  )
}
