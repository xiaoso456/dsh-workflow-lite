/**
 * dsh-workflow-lite — 「工作流设置」对话框：整张工作流的全局配置，都会编译进派发计划。
 *
 * 三块（画在 `SettingsFields.tsx`），一项一行，不堆说明——细节收在各自的「?」里：
 * - **执行方式**：自动 / 串行 / 主 agent + 子代理 / Agent 团队（四张卡），下面一行**复用执行者**：
 *   同一步骤再次执行时交回上次的子代理或队员、每次新建，或不规定；串行时用不上。
 * - **执行时**：**设定目标**（缺省开，开始前用 `create_goal` 设成会话目标）与**记录运行状态**两个开关。
 * - **产出根目录**：每个步骤的产出文件编译时都拼在它下面；说明里的拼接示例跟着输入实时变，
 *   拼接与标准化走 `shared/outputPaths.ts`（和编译器同一份）。保存成默认值 = 不写这个键。
 *
 * 「完成」时一次交出去（一次改动 = 一条撤销步）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/SettingsDialog
 */

import { useRef, useState } from 'react'
import { readSettings } from '../../shared/model.ts'
import { rootOf } from '../../shared/outputPaths.ts'
import type { ExecutionMode, ReusePolicy, WorkflowSettings } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import overlay from './overlay.module.css'
import { cx, Modal } from './primitives.tsx'
import { DuringGroup, ModeGroup, RootGroup, rootStatus } from './SettingsFields.tsx'
import ui from './ui.module.css'

export function SettingsDialog(props: {
  t: T
  name: string
  settings: WorkflowSettings | undefined
  /** 预览用的示例产出（图里第一个产出文件；没有就是 `plan.md`）。 */
  sample: string
  onSave(settings: WorkflowSettings | undefined): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const initial: {
    root: string
    mode: ExecutionMode
    reuse: ReusePolicy
    setGoal: boolean
    runState: boolean
  } = {
    root: rootOf(props.settings),
    mode: props.settings?.mode ?? 'auto',
    reuse: props.settings?.reuse ?? 'auto',
    setGoal: props.settings?.setGoal !== false,
    runState: props.settings?.runState === true,
  }
  const [root, setRoot] = useState(initial.root)
  const [mode, setMode] = useState<ExecutionMode>(initial.mode)
  const [reuse, setReuse] = useState<ReusePolicy>(initial.reuse)
  const [setGoal, setSetGoal] = useState(initial.setGoal)
  const [runState, setRunState] = useState(initial.runState)
  const rootRef = useRef<HTMLInputElement>(null)

  const { problem, isDefault } = rootStatus(root)
  const dirty =
    root !== initial.root ||
    mode !== initial.mode ||
    reuse !== initial.reuse ||
    setGoal !== initial.setGoal ||
    runState !== initial.runState

  const submit = (): void => {
    if (problem !== null) return
    props.onSave(
      readSettings({ outputRoot: isDefault ? '' : root, mode, reuse, setGoal, runState }),
    )
  }

  return (
    <Modal
      label={t('settings.title')}
      testId="wl-settings"
      className={overlay.sheetSettings}
      onDismiss={() => {
        if (!dirty) props.onClose()
      }}
    >
      <form
        className={overlay.sheetForm}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            props.onClose()
            return
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      >
        <header className={overlay.sheetHead}>
          <span className={overlay.sheetIcon}>
            <Icon name="sliders" size={16} />
          </span>
          <div className={overlay.sheetTitles}>
            <p className={overlay.sheetTitle}>{t('settings.title')}</p>
            <p className={overlay.sheetSub}>{props.name}</p>
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

        <div className={overlay.sheetBody}>
          <ModeGroup t={t} mode={mode} reuse={reuse} onMode={setMode} onReuse={setReuse} />
          <DuringGroup
            t={t}
            setGoal={setGoal}
            runState={runState}
            onSetGoal={setSetGoal}
            onRunState={setRunState}
          />
          <RootGroup
            t={t}
            root={root}
            sample={props.sample}
            inputRef={rootRef}
            onChange={setRoot}
          />
        </div>

        <footer className={overlay.sheetFoot}>
          <span className={ui.grow} />
          <span className={overlay.sheetKeys}>{t('out.submitKeys')}</span>
          <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className={cx(ui.btn, ui.small, ui.primary)}
            disabled={problem !== null}
            data-testid="wl-settings-done"
          >
            <Icon name="check" size={14} />
            {t('out.done')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
