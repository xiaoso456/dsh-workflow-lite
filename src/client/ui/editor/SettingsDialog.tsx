/**
 * dsh-workflow-lite — 「工作流设置」对话框：整张工作流的全局配置。
 *
 * 分三页（页签在标题行右边，打开总在「执行」页），一项一行，不堆说明——细节收在各自的「?」里：
 * - **执行**（`SettingsFields.tsx`）：执行方式（四张卡）+ 复用执行者；执行时的设定目标、记录运行状态两个开关。
 * - **会话**（`SessionFields.tsx`）：新建会话时用哪个 agent 预设、模型、思考强度（不编译进计划，插件建会话时用）。
 *   清单从 DSH 读；设了但这台机器上用不了的，这一页的页签上亮一个黄点（只提醒，不挡保存，执行时回退默认）。
 * - **产出**：产出根目录，每个步骤的产出文件编译时都拼在它下面；保存成默认值 = 不写这个键。
 *   写错了存不了：按「完成」时跳到这一页、焦点落到输入框。
 *
 * 三页一样高、填了的都留着；「完成」时一次交出去（一次改动 = 一条撤销步）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/editor/SettingsDialog
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { readSettings } from '../../../shared/model.ts'
import { rootOf } from '../../../shared/outputPaths.ts'
import { sameModelChoice } from '../../../shared/sessionChoice.ts'
import type {
  ExecutionMode,
  ModelChoice,
  ReusePolicy,
  WorkflowSettings,
} from '../../../shared/types.ts'
import { agentCatalog, useAgentCatalog } from '../../app/agents.ts'
import type { T } from '../../i18n.ts'
import { choiceIssues } from '../../model/sessionChoice.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { Modal } from '../kit/Modal.tsx'
import overlay from '../kit/overlay.module.css'
import { Segmented } from '../kit/Segmented.tsx'
import ui from '../kit/ui.module.css'
import { SessionGroup } from './SessionFields.tsx'
import { DuringGroup, ModeGroup, RootGroup, rootStatus } from './SettingsFields.tsx'
import s from './settings.module.css'

type Tab = 'run' | 'session' | 'output'

const TABS: readonly Tab[] = ['run', 'session', 'output']

export function SettingsDialog(props: {
  t: T
  name: string
  settings: WorkflowSettings | undefined
  /** 预览用的示例产出（图里第一个产出文件；没有就是 `plan.md`）。 */
  sample: string
  /** 读 DSH 里能选的预设、模型；不给（没有连接）时下拉里只有「跟随默认」和已经设了的。 */
  rpc?: WorkflowLiteRpc | undefined
  /** 画布所在的会话（拿它试一下这个 DSH 能不能只给一个会话换模型）。 */
  session?: string | undefined
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
    preset: string | undefined
    model: ModelChoice | undefined
    permission: string | undefined
  } = {
    root: rootOf(props.settings),
    mode: props.settings?.mode ?? 'auto',
    reuse: props.settings?.reuse ?? 'auto',
    setGoal: props.settings?.setGoal !== false,
    runState: props.settings?.runState === true,
    preset: props.settings?.preset,
    model: props.settings?.model,
    permission: props.settings?.permission,
  }
  const [tab, setTab] = useState<Tab>('run')
  const [root, setRoot] = useState(initial.root)
  const [mode, setMode] = useState<ExecutionMode>(initial.mode)
  const [reuse, setReuse] = useState<ReusePolicy>(initial.reuse)
  const [setGoal, setSetGoal] = useState(initial.setGoal)
  const [runState, setRunState] = useState(initial.runState)
  const [preset, setPreset] = useState(initial.preset)
  const [model, setModel] = useState(initial.model)
  const [permission, setPermission] = useState(initial.permission)
  const rootRef = useRef<HTMLInputElement>(null)
  const { rpc, session } = props
  const catalog = useAgentCatalog(
    useMemo(
      () => (rpc === undefined ? undefined : () => agentCatalog(rpc, session)),
      [rpc, session],
    ),
  )
  // 按「完成」时根目录写错了：跳到「产出」页，等它看得见了再把焦点放进输入框。
  const [focusRoot, setFocusRoot] = useState(0)
  useEffect(() => {
    if (focusRoot > 0) rootRef.current?.focus()
  }, [focusRoot])

  const { problem, isDefault } = rootStatus(root)
  const sessionIssues = choiceIssues(catalog, {
    ...(preset === undefined ? {} : { preset }),
    ...(model === undefined ? {} : { model }),
    ...(permission === undefined ? {} : { permission }),
  })
  const dirty =
    root !== initial.root ||
    mode !== initial.mode ||
    reuse !== initial.reuse ||
    setGoal !== initial.setGoal ||
    runState !== initial.runState ||
    preset !== initial.preset ||
    !sameModelChoice(model, initial.model) ||
    permission !== initial.permission

  const submit = (): void => {
    if (problem !== null) {
      setTab('output')
      setFocusRoot((n) => n + 1)
      return
    }
    props.onSave(
      readSettings({
        outputRoot: isDefault ? '' : root,
        mode,
        reuse,
        setGoal,
        runState,
        preset,
        model,
        permission,
      }),
    )
  }

  const tabText: Record<Tab, string> = {
    run: t('settings.tab.run'),
    session: t('settings.tab.session'),
    output: t('settings.tab.output'),
  }
  // 会话、产出两页随时可能有要留意的事：黄点一直挂着（null = 眼下没有），有没有只淡入淡出。
  const warnOf: Record<Tab, string | null | undefined> = {
    run: undefined,
    session: sessionIssues.length > 0 ? t('settings.tab.warn') : null,
    output: problem?.message ?? null,
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
          <div className={s.tabs}>
            <Segmented<Tab>
              label={t('settings.title')}
              value={tab}
              testId="wl-settings-tab"
              onChange={setTab}
              options={TABS.map((value) => {
                const warn = warnOf[value]
                return { value, label: tabText[value], ...(warn === undefined ? {} : { warn }) }
              })}
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

        <div className={overlay.sheetBody}>
          <div className={s.pages}>
            <div className={s.page} data-hidden={tab !== 'run' || undefined}>
              <ModeGroup t={t} mode={mode} reuse={reuse} onMode={setMode} onReuse={setReuse} />
              <DuringGroup
                t={t}
                setGoal={setGoal}
                runState={runState}
                onSetGoal={setSetGoal}
                onRunState={setRunState}
              />
            </div>
            <div className={s.page} data-hidden={tab !== 'session' || undefined}>
              <SessionGroup
                t={t}
                catalog={catalog}
                preset={preset}
                model={model}
                permission={permission}
                onPreset={setPreset}
                onModel={setModel}
                onPermission={setPermission}
              />
            </div>
            <div className={s.page} data-hidden={tab !== 'output' || undefined}>
              <RootGroup
                t={t}
                root={root}
                sample={props.sample}
                inputRef={rootRef}
                onChange={setRoot}
              />
            </div>
          </div>
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
