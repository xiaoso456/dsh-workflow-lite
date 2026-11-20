/**
 * dsh-workflow-lite — 工作流中心：放所有**跨工作流、跨会话**的东西。
 *
 * 标题栏和「工作流设置」同一种样子，几页的切换放在标题栏里：前四页是一组分段（按字宽排、带图标），
 * 「存储」「设置」用得少，是右边关闭旁的两个图标按钮（悬停有名字）：
 * 前四页左栏同一个样子（`list/`）：搜索框旁「视图选项」（分组、排序、筛选，记在本机浏览器里），
 * 分组标题可折叠、滚动时钉在顶上，一项可以出现在几组里。
 * - **运行实例**（`runs/HubRuns.tsx`）：所有会话的实例，左边按工作区 / 工作流 / 状态 / 会话分组，右边选中那个的全貌；
 *   查看、改整体状态、移到本会话、删除记录（状态文件另外问要不要一起删）；
 * - **工作流**（`workflows/HubWorkflows.tsx`）：全部工作流，按标签 / 触发 / 修改时间分组；每一行能打标签、就地改名、删除，
 *   标签的改名、删除在组标题上；选一张看它的标签和版本——存、切换、改说明、删除，不用先打开它；
 *   导入、导出工作流包也在这一页；
 * - **触发**（`triggers/HubTriggers.tsx`）：所有工作流里的触发器——左栏分组、筛选和「全部暂停」，
 *   右栏选中那个的状态、概览、时间线、按触发方式的那一页和设置（铅笔打开和画布面板同一个对话框）；
 * - **记忆**（`HubMemories.tsx`）：记忆库里的每一条——按类型 / 使用 / 工作流分组；名称、描述、在用的工作流、文件和版本，删掉不用的；
 * - **存储**（`HubStorage.tsx`）：数据目录、各样东西的占用，清理已结束的实例与旧版本遗留文件；
 * - **设置**（`HubSettings.tsx`）：插件自己的几项设置（数据目录、步骤上限、自动保存等待……）。
 *
 * 换页时标题栏不动，内容区沿页签方向轻移交接。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/HubDialog
 */

import { useState } from 'react'
import type { StepColor } from '../../../shared/appearance.ts'
import type { HostAccess } from '../../app/host.ts'
import type { SessionRow } from '../../app/sessions.ts'
import type { Runs } from '../../app/useRuns.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'
import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import { Modal } from '../kit/Modal.tsx'
import overlay from '../kit/overlay.module.css'
import { Segmented } from '../kit/Segmented.tsx'
import ui from '../kit/ui.module.css'
import { FadeMark } from '../motion/marks.tsx'
import motion from '../motion/paneTransition.module.css'
import { tabDirection, usePaneTransition } from '../motion/paneTransition.ts'
import { HubMemories } from './HubMemories.tsx'
import { HubSettings, type SettingsJump } from './HubSettings.tsx'
import { HubStorage } from './HubStorage.tsx'
import css from './hubDialog.module.css'
import { HubRuns } from './runs/HubRuns.tsx'
import { HubTriggers } from './triggers/HubTriggers.tsx'
import { HubWorkflows } from './workflows/HubWorkflows.tsx'

type HubPage = 'runs' | 'workflows' | 'triggers' | 'memories' | 'storage' | 'settings'
const PAGES: readonly HubPage[] = [
  'runs',
  'workflows',
  'triggers',
  'memories',
  'storage',
  'settings',
]

/** 分段里的四页（各带图标）、关闭旁边的两页（只有图标）。 */
/**
 * 前四页：各带一个颜色（页签上的图标一直是这个色，没选中时淡一些），扫一眼按颜色认页。
 * 实例绿（在跑、跑完），工作流是主色蓝，触发琥珀（各处的闪电同色），记忆青（和步骤库里的记忆卡同色）；四色两两分得开。
 */
const MAIN: readonly { page: HubPage; label: LocaleKey; icon: IconName; tint: StepColor }[] = [
  { page: 'runs', label: 'hub.runs', icon: 'runs', tint: 'green' },
  { page: 'workflows', label: 'hub.wfPage', icon: 'hub', tint: 'blue' },
  { page: 'triggers', label: 'hub.trgPage', icon: 'bolt', tint: 'amber' },
  { page: 'memories', label: 'hub.memories', icon: 'memory', tint: 'teal' },
]
const SIDE: readonly { page: HubPage; label: LocaleKey; icon: IconName }[] = [
  { page: 'storage', label: 'hub.storage', icon: 'storage' },
  { page: 'settings', label: 'hub.settings', icon: 'gear' },
]

/** 打开时停在哪一页：没给 `focus` 是「运行实例」。 */
const FOCUS_PAGE: Record<HubFocus['kind'] | 'none', HubPage> = {
  export: 'workflows',
  trigger: 'triggers',
  settings: 'settings',
  none: 'runs',
}

/** 工作流中心打开时停在哪。 */
export type HubFocus =
  | { kind: 'export' }
  | { kind: 'trigger'; workflow: string; node: string }
  | { kind: 'settings'; jump?: SettingsJump }

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
  /** 打开实例；给了 `node` 就选中那一步。 */
  onOpenRun(id: string, node?: string): void
  /** 跳到一个会话；跳不了回 `false`。 */
  onOpenSession(id: string): boolean
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
  const [page, setPage] = useState<HubPage>(FOCUS_PAGE[props.focus?.kind ?? 'none'])
  /** 「设置」页打开后滚到哪一组：从链接进来时给，自己点顶栏的齿轮不给。 */
  const [jump, setJump] = useState<SettingsJump | undefined>(
    props.focus?.kind === 'settings' ? props.focus.jump : undefined,
  )
  const pane = usePaneTransition()
  const turn = (next: HubPage, to?: SettingsJump): void => {
    pane.change(
      () => {
        setPage(next)
        setJump(to)
      },
      tabDirection(PAGES, page, next),
    )
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
          {/* 在「存储」「设置」页时分段里没有选中的，滑块原地淡掉。 */}
          <Segmented<HubPage>
            label={t('hub.title')}
            value={page}
            onChange={turn}
            testId="wl-hub"
            fit
            options={MAIN.map((item) => ({
              value: item.page,
              label: t(item.label),
              icon: item.icon,
              tint: `var(--wl-c-${item.tint})`,
            }))}
          />
        </div>
        <span className={css.divider} aria-hidden="true" />
        <div className={css.tools}>
          {SIDE.map((item) => (
            <button
              key={item.page}
              type="button"
              className={cx(ui.btn, ui.icon, ui.small, css.sidePage)}
              aria-pressed={page === item.page}
              aria-label={t(item.label)}
              data-tip={t(item.label)}
              data-testid={`wl-hub-${item.page}`}
              onClick={() => turn(item.page)}
            >
              <FadeMark on={page === item.page}>
                <Icon name={item.icon} size={15} />
              </FadeMark>
            </button>
          ))}
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            aria-label={t('common.close')}
            onClick={props.onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      </header>
      <div ref={pane.scope} className={cx(css.pane, motion.scope)}>
        {page === 'runs' ? (
          <HubRuns
            t={t}
            rpc={props.rpc}
            session={props.session}
            sessionRows={props.sessionRows}
            sessionsReady={props.sessionsReady}
            runs={runs}
            onNotice={props.onNotice}
            onOpenRun={(id, node) => {
              props.onOpenRun(id, node)
              props.onClose()
            }}
          />
        ) : page === 'workflows' ? (
          <HubWorkflows
            t={t}
            rpc={props.rpc}
            {...props.workflows}
            startExport={props.focus?.kind === 'export'}
            onNotice={props.onNotice}
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
            onSettings={() => turn('settings', 'trigger')}
            onOpenCard={(workflow, node) => {
              props.onOpenCard(workflow, node)
              props.onClose()
            }}
            onOpenRun={(id) => {
              props.onOpenRun(id)
              props.onClose()
            }}
            onOpenSession={(id) => {
              if (!props.onOpenSession(id)) return false
              props.onClose()
              return true
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
          <HubSettings
            t={t}
            rpc={props.rpc}
            {...(jump === undefined ? {} : { jump })}
            onSaved={props.workflows.onChanged}
          />
        )}
      </div>
    </Modal>
  )
}
