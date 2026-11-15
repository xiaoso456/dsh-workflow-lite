/**
 * dsh-workflow-lite — 轮询、监听的工作台（{@link Bench}）：顶上一条是名字、「从模板开始」菜单、用哪个 shell、「试运行」；
 * 中间上半是编辑区（亮一档的底：`$` 加命令，换了 shell 时底边一条提示），下半是输出台（{@link TrialConsole}：
 * 「试运行 / 最近的输出」两页）；底栏写命令里能用的变量（「?」里细说）。
 *
 * 「从模板开始」和别处的下拉同一个菜单（{@link SelectMenu}：搜索框、名字下面一行说明）。
 * 命令和哪个模板一字不差，按钮上就写那个模板的名字；改了命令回到「从模板开始」。
 * 按钮上的字一换（模板名、shell 名），宽度跟着滑（{@link BenchFace}），不跳。
 * 「试运行」跑的是草稿里的命令，在对话框里选的工作区里（没选就用当前会话的）、用选的 shell；
 * 点了先在按钮旁边问一句（命令以 DSH 进程的身份运行、不进沙箱），确认了才跑。不打开开关、不发进会话。
 * 改了命令，上一次的结果就收起来（那是旧命令的）。跑着时按钮上的字不变、图标换成转圈，宽度不变，左边的按钮不挪。
 * 换了 shell（草稿，跟着对话框「保存」写）、或自己挑的程序用不了，编辑区底边一条提示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/CommandBox
 */

import { useRef, useState } from 'react'
import type { T } from '../../../i18n.ts'
import type { CommandTemplate } from '../../../model/commandTemplates.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { HelpTip } from '../../kit/HelpTip.tsx'
import { Icon } from '../../kit/Icon.tsx'
import { Popover } from '../../kit/Popover.tsx'
import { type MenuPlace, menuPlace, TWO_LINE_HEIGHT } from '../../kit/Select.tsx'
import { SelectMenu } from '../../kit/SelectMenu.tsx'
import { TextArea } from '../../kit/TextArea.tsx'
import { Presence } from '../../motion/exits.tsx'
import { ShellButton } from '../ShellSelect.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { Bench, BenchFace, benchButton, benchMenu, benchPrimary } from './Bench.tsx'
import css from './commandBox.module.css'
import type { LocalDraft } from './runDraft.ts'
import { type ConsoleTab, type Trial, TrialConsole, type TrialJudge } from './TrialConsole.tsx'

export function CommandBox(props: {
  t: T
  node: string
  kind: 'poll' | 'listen'
  command: string
  placeholder: string
  templates: readonly CommandTemplate[]
  /** 模板视图的现场；实例视图是 `null`（不能试运行）。 */
  env: TriggerEnv | null
  /** 轮询：怎么读试运行的结果（满足没有）。 */
  judge?: TrialJudge
  onChange(command: string): void
  onTemplate(template: CommandTemplate): void
  /** 「最近的输出」有没有内容（草稿的命令和保存着的那条一样才有）。 */
  recent: boolean
  /** 工作台的名字。 */
  title: string
  /** 命令在哪个工作区跑（对话框里选的，没选是当前会话的）；实例视图里没有。 */
  workspace: string | undefined
  /** 用哪个 shell 跑（对话框里选的草稿；空串是跟随默认）；实例视图里没有。 */
  shell: LocalDraft | undefined
}): React.JSX.Element {
  const { t, env } = props
  const [trial, setTrial] = useState<Trial>({ kind: 'idle' })
  /** 输出台选的页签：有最近的输出就先看它；点了试运行换到试运行。 */
  const [tab, setTab] = useState<ConsoleTab>(props.recent ? 'recent' : 'try')
  const [menu, setMenu] = useState<MenuPlace | null>(null)
  /** 从模板换进来几次：每次让命令从下面浮上来一下（换属性重放 CSS 动画，不重挂输入框）。 */
  const [fresh, setFresh] = useState(0)
  const menuButton = useRef<HTMLButtonElement>(null)
  const confirm = useConfirm<HTMLButtonElement>()
  const workspace = env === null ? undefined : props.workspace
  const empty = props.command.trim() === ''
  /** 命令就是哪个模板（一字不差）；改过就不算。 */
  const template = props.templates.find((item) => item.command === props.command)
  const shell = env === null ? undefined : props.shell
  /** 自己挑的 shell 程序用不了时的原因。 */
  const [shellProblem, setShellProblem] = useState<string | null>(null)
  const shellNote =
    shellProblem ??
    (shell !== undefined && shell.value !== shell.saved ? t('trigger.shellChanged') : null)

  const run = (): void => {
    if (env === null || workspace === undefined) return
    setTrial({ kind: 'running' })
    setTab('try')
    void env.triggers
      .tryCommand({
        kind: props.kind,
        command: props.command,
        workspace,
        ...(shell === undefined || shell.value === '' ? {} : { shell: shell.value }),
      })
      .then((result) =>
        setTrial(
          typeof result === 'string'
            ? { kind: 'error', message: result }
            : { kind: 'done', result },
        ),
      )
  }

  const tools = (
    <>
      <Popover
        open={menu !== null}
        onClose={() => {
          setMenu(null)
          menuButton.current?.focus()
        }}
        label={t('trigger.cmd.template')}
        align="end"
        up={menu?.up === true}
        className={css.menu}
        trigger={
          <button
            ref={menuButton}
            type="button"
            className={cx(benchButton, benchMenu)}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            data-tip={template === undefined ? undefined : t(template.desc)}
            data-testid="wl-trigger-template"
            onClick={() =>
              setMenu(
                menu === null
                  ? menuPlace(menuButton.current, props.templates.length, true, TWO_LINE_HEIGHT)
                  : null,
              )
            }
          >
            <BenchFace text={t(template === undefined ? 'trigger.cmd.template' : template.label)} />
          </button>
        }
      >
        <SelectMenu<string>
          open={menu !== null}
          label={t('trigger.cmd.template')}
          options={props.templates.map((template) => ({
            value: template.id,
            label: t(template.label),
            desc: t(template.desc),
          }))}
          searchable
          t={t}
          testId="wl-trigger-template"
          listMax={menu?.list ?? 320}
          onPick={(id) => {
            const template = props.templates.find((item) => item.id === id)
            setMenu(null)
            menuButton.current?.focus()
            if (template === undefined) return
            setTrial({ kind: 'idle' })
            setFresh((count) => count + 1)
            props.onTemplate(template)
          }}
        />
      </Popover>
      {env !== null && shell !== undefined && (
        <ShellButton
          t={t}
          access={env.shells}
          value={shell.value}
          mode="card"
          changed={shell.value !== shell.saved}
          className={cx(benchButton, benchMenu)}
          face={(name) => <BenchFace icon="terminal" text={name} />}
          menuClassName={css.shellMenu}
          testId="wl-trigger-shell"
          onChange={shell.onChange}
          onProblem={setShellProblem}
        />
      )}
      {env !== null && (
        <>
          <button
            ref={confirm.anchorRef}
            type="button"
            className={cx(benchButton, benchPrimary)}
            disabled={empty || trial.kind === 'running'}
            aria-busy={trial.kind === 'running'}
            data-tip={workspace === undefined ? t('trigger.cmd.tryNoWorkspace') : undefined}
            data-testid="wl-trigger-try"
            onClick={workspace === undefined ? undefined : confirm.toggle}
          >
            {trial.kind === 'running' ? (
              <span className={css.trySpin} aria-hidden="true" />
            ) : (
              <Icon name="play" size={10} />
            )}
            {t('trigger.cmd.try')}
          </button>
          {workspace !== undefined &&
            confirm.render({
              t,
              title: t('trigger.cmd.tryTitle'),
              desc: t(
                props.kind === 'listen' ? 'trigger.cmd.tryListenDesc' : 'trigger.cmd.tryDesc',
              ).replace('{dir}', workspace),
              confirmText: t('trigger.cmd.tryConfirm'),
              danger: false,
              testId: 'wl-trigger-try-confirm',
              onConfirm: run,
            })}
        </>
      )}
    </>
  )

  return (
    <Bench
      icon="terminal"
      title={props.title}
      tools={tools}
      foot={<CommandFoot t={t} />}
      testId="wl-trigger-command-box"
      split
    >
      <div className={css.editor} data-alone={env === null || undefined}>
        <div
          className={css.code}
          data-fresh={fresh === 0 ? undefined : fresh % 2 === 1 ? 'a' : 'b'}
        >
          <span className={css.prompt} aria-hidden="true">
            $
          </span>
          <TextArea
            className={css.input}
            value={props.command}
            rows={2}
            spellCheck={false}
            placeholder={props.placeholder}
            aria-label={t('trigger.command')}
            aria-required="true"
            data-testid="wl-trigger-command"
            onChange={(event) => {
              if (trial.kind !== 'idle' && trial.kind !== 'running') setTrial({ kind: 'idle' })
              props.onChange(event.currentTarget.value)
            }}
          />
        </div>
        <Presence show={shellNote !== null}>
          <p
            className={css.notice}
            data-problem={shellProblem !== null}
            role={shellProblem === null ? undefined : 'alert'}
            data-testid="wl-trigger-shell-note"
          >
            <Icon name={shellProblem === null ? 'info' : 'alert'} size={13} />
            <span>{shellNote}</span>
          </p>
        </Presence>
      </div>
      {env !== null && (
        <TrialConsole
          t={t}
          env={env}
          node={props.node}
          kind={props.kind}
          trial={trial}
          judge={props.judge}
          recent={props.recent}
          tab={tab}
          onTab={setTab}
        />
      )}
    </Bench>
  )
}

/** 底栏：命令里能写 `{workflow}`，「?」里说它换成什么、怎么用；脚本可以让模型代写。 */
function CommandFoot(props: { t: T }): React.JSX.Element {
  const { t } = props
  return (
    <>
      <span className={css.variable}>
        {t('trigger.cmd.variable')}
        <code className={css.token}>{'{workflow}'}</code>
        <HelpTip label={t('trigger.cmd.variableHelp')} testId="wl-trigger-variable-help">
          {t('trigger.cmd.variableTip')}
        </HelpTip>
      </span>
      <span>{t('trigger.cmd.byModel')}</span>
    </>
  )
}
