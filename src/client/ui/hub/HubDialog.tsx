/**
 * dsh-workflow-lite — 工作流中心：放所有**跨工作流、跨会话**的东西。
 *
 * 标题栏和「工作流设置」同一种样子，几页的切换放在标题栏里：
 * - **运行实例**（`HubRuns.tsx`）：所有会话的实例，左边工作区（能搜）、右边它的实例；
 *   查看、改整体状态、移到本会话、删除记录（状态文件另外问要不要一起删）；
 * - **工作流**（`HubWorkflows.tsx`）：全部工作流，每一行能就地改名、删除；选一张看它的版本——存、切换、改说明、删除，不用先打开它；
 *   导入、导出工作流包也在这一页；
 * - **触发**（`triggers/HubTriggers.tsx`）：所有工作流里的触发卡片——左栏分组、筛选、行尾开关和「全部暂停」，
 *   右栏选中那张的状态、概览、时间线、按触发方式的那一页和设置（铅笔打开和画布面板同一个对话框）；
 * - **记忆**（`HubMemories.tsx`）：记忆库里的每一条——名称、描述、在用的工作流、文件和版本，删掉不用的；
 * - **存储**（`HubStorage.tsx`）：数据目录、各样东西的占用，清理已结束的实例与旧版本遗留文件；
 * - **设置**（`HubSettings.tsx`）：插件自己的几项设置（数据目录、步骤上限、自动保存等待……）。
 *
 * 换页时新的一页从点的那一侧滑进来（动效都只动 transform / opacity，见 `motion/` 里的各文件与 hubDialog.module.css）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/HubDialog
 */

import { useState } from 'react'
import type { HostAccess } from '../../app/host.ts'
import type { SessionRow } from '../../app/sessions.ts'
import type { Runs } from '../../app/useRuns.ts'
import type { T } from '../../i18n.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { Modal } from '../kit/Modal.tsx'
import overlay from '../kit/overlay.module.css'
import { Segmented } from '../kit/Segmented.tsx'
import ui from '../kit/ui.module.css'
import { HubMemories } from './HubMemories.tsx'
import { HubRuns } from './HubRuns.tsx'
import { HubSettings } from './HubSettings.tsx'
import { HubStorage } from './HubStorage.tsx'
import { HubWorkflows } from './HubWorkflows.tsx'
import css from './hubDialog.module.css'
import { HubTriggers } from './triggers/HubTriggers.tsx'

type HubPage = 'runs' | 'workflows' | 'triggers' | 'memories' | 'storage' | 'settings'
const PAGES: readonly HubPage[] = [
  'runs',
  'workflows',
  'triggers',
  'memories',
  'storage',
  'settings',
]

/** 工作流中心打开时停在哪。 */
export type HubFocus = { kind: 'export' } | { kind: 'trigger'; workflow: string; node: string }

export function HubDialog(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 记忆库、桌面能力（「记忆」页看文件用）。 */
  host: HostAccess
  session: string | undefined
  /** 宿主的会话列表（拿会话标题、本会话的工作区）；会话服务没接上时是空的。 */
  sessionRows: readonly SessionRow[]
  /** 会话服务接上了没有（没接上就不说"会话已不在"，只说"其他会话"）。 */
  sessionsReady: boolean
  runs: Runs
  onOpenRun(id: string): void
  /** 打开一个工作流、选中里面的一张卡片（「触发」页的「在画布上打开」）。 */
  onOpenCard(workflow: string, node: string): void
  /** 一句结果提示（改完实例状态之后）。 */
  onNotice(text: string, tone?: 'info' | 'error'): void
  /** 「工作流」页要的：编辑页正开着哪张、怎么把它的改动写下去 / 重新加载、怎么打开别的一张。 */
  workflows: {
    current: string | null
    /** 导入导出盘点 skill 时站在哪个会话、哪个工作区。 */
    scope: { cwd?: string; session?: string }
    flush(): Promise<boolean>
    onReload(): void
    onOpen(name: string): void
    rename(from: string, to: string): Promise<boolean>
    remove(name: string): Promise<boolean>
    onChanged(): void
  }
  /** 打开时停在哪：顶栏「导出」进来停在「工作流」页、右栏是导出；触发卡片「全部记录」进来停在「触发」页、选中那张。 */
  focus?: HubFocus
  onClose(): void
}): React.JSX.Element {
  const { t, runs } = props
  const [page, setPage] = useState<HubPage>(
    props.focus?.kind === 'export'
      ? 'workflows'
      : props.focus?.kind === 'trigger'
        ? 'triggers'
        : 'runs',
  )
  /** 新的一页从哪一侧进来：点了右边的页就从右边进；刚打开时不滑。 */
  const [from, setFrom] = useState<'left' | 'right' | undefined>(undefined)
  const turn = (next: HubPage): void => {
    if (next === page) return
    setFrom(PAGES.indexOf(next) > PAGES.indexOf(page) ? 'right' : 'left')
    setPage(next)
  }
  return (
    <Modal label={t('hub.title')} onDismiss={props.onClose} className={css.dialog} testId="wl-hub">
      <header className={css.head}>
        <span className={overlay.sheetIcon}>
          <Icon name="hub" size={16} />
        </span>
        <div className={overlay.sheetTitles}>
          <p className={overlay.sheetTitle}>{t('hub.title')}</p>
          <p className={overlay.sheetSub}>{t('hub.sub')}</p>
        </div>
        <div className={css.tabs}>
          <Segmented<HubPage>
            label={t('hub.title')}
            value={page}
            onChange={turn}
            testId="wl-hub"
            options={[
              { value: 'runs', label: t('hub.runs') },
              { value: 'workflows', label: t('hub.wfPage') },
              { value: 'triggers', label: t('hub.trgPage') },
              { value: 'memories', label: t('hub.memories') },
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
      {/* 换页：整页换一块，从点的那一侧滑进来。 */}
      <div key={page} className={css.pane} data-from={from}>
        {page === 'runs' ? (
          <HubRuns
            t={t}
            session={props.session}
            sessionRows={props.sessionRows}
            sessionsReady={props.sessionsReady}
            runs={runs}
            onNotice={props.onNotice}
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
            startExport={props.focus?.kind === 'export'}
            onOpen={(name) => {
              props.workflows.onOpen(name)
              props.onClose()
            }}
          />
        ) : page === 'triggers' ? (
          <HubTriggers
            t={t}
            rpc={props.rpc}
            {...(props.focus?.kind === 'trigger'
              ? { start: { workflow: props.focus.workflow, node: props.focus.node } }
              : {})}
            flush={props.workflows.flush}
            current={props.workflows.current}
            onReload={props.workflows.onReload}
            onChanged={props.workflows.onChanged}
            session={props.session}
            cwd={props.workflows.scope.cwd}
            sessionRows={props.sessionRows}
            onNotice={props.onNotice}
            onOpenWorkflow={(name) => {
              props.workflows.onOpen(name)
              props.onClose()
            }}
            onOpenCard={(workflow, node) => {
              props.onOpenCard(workflow, node)
              props.onClose()
            }}
            onOpenRun={(id) => {
              props.onOpenRun(id)
              props.onClose()
            }}
          />
        ) : page === 'memories' ? (
          <HubMemories
            t={t}
            rpc={props.rpc}
            store={props.host.memories}
            desktop={props.host.desktop}
            onNotice={props.onNotice}
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
      </div>
    </Modal>
  )
}
