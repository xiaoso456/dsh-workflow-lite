/**
 * dsh-workflow-lite — 轮询、监听的工作台（{@link Bench}）：顶上一条是名字、「从模板开始」菜单、「试运行」，
 * 中间是命令，下面是试运行的结果（退出码、满足没有、用时、输出），再下面是跑着的那条命令最近的输出；
 * 底栏写由什么 shell 运行、命令里能用的变量（「?」里细说）。
 *
 * 「从模板开始」和别处的下拉同一个菜单（{@link SelectMenu}：搜索框、名字下面一行说明）。
 * 「试运行」跑的是草稿里的命令，在对话框里选的工作区里（没选就用当前会话的）；
 * 点了先在按钮旁边问一句（命令以 DSH 进程的身份运行、不进沙箱），确认了才跑。不打开开关、不发进会话。
 * 改了命令，上一次的结果就收起来（那是旧命令的）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/CommandBox
 */

import { useRef, useState } from 'react'
import type { TriggerTryResponse } from '../../../../shared/wire/trigger.ts'
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
import { RecentOutput } from '../RecentOutput.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
import { Bench, benchButton, benchPrimary } from './Bench.tsx'
import css from './commandBox.module.css'

/** 试运行的样子：没跑过、正在跑、跑完了、请求本身失败。 */
type Trial =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: TriggerTryResponse }
  | { kind: 'error'; message: string }

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
  judge?: (result: TriggerTryResponse) => { tone: 'ok' | 'off'; text: string }
  onChange(command: string): void
  onTemplate(template: CommandTemplate): void
  /** 放不放最近的输出（草稿的命令和跑着的那条一样才放）。 */
  recent: boolean
  /** 工作台的名字。 */
  title: string
  /** 命令在哪个工作区跑（对话框里选的，没选是当前会话的）；实例视图里没有。 */
  workspace: string | undefined
}): React.JSX.Element {
  const { t, env } = props
  const [trial, setTrial] = useState<Trial>({ kind: 'idle' })
  const [menu, setMenu] = useState<MenuPlace | null>(null)
  /** 从模板换进来几次：每次让命令从下面浮上来一下（换属性重放 CSS 动画，不重挂输入框）。 */
  const [fresh, setFresh] = useState(0)
  const menuButton = useRef<HTMLButtonElement>(null)
  const confirm = useConfirm<HTMLButtonElement>()
  const workspace = env === null ? undefined : props.workspace
  const empty = props.command.trim() === ''

  const run = (): void => {
    if (env === null || workspace === undefined) return
    setTrial({ kind: 'running' })
    void env.triggers
      .tryCommand({ kind: props.kind, command: props.command, workspace })
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
            className={benchButton}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            data-testid="wl-trigger-template"
            onClick={() =>
              setMenu(
                menu === null
                  ? menuPlace(menuButton.current, props.templates.length, true, TWO_LINE_HEIGHT)
                  : null,
              )
            }
          >
            {t('trigger.cmd.template')}
            <Icon name="chevronDown" size={12} />
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
      {env !== null && (
        <>
          <button
            ref={confirm.anchorRef}
            type="button"
            className={cx(benchButton, benchPrimary)}
            disabled={empty || trial.kind === 'running'}
            data-tip={workspace === undefined ? t('trigger.cmd.tryNoWorkspace') : undefined}
            data-testid="wl-trigger-try"
            onClick={workspace === undefined ? undefined : confirm.toggle}
          >
            <Icon name="play" size={10} />
            {t(trial.kind === 'running' ? 'trigger.cmd.trying' : 'trigger.cmd.try')}
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
      <div className={css.code} data-fresh={fresh === 0 ? undefined : fresh % 2 === 1 ? 'a' : 'b'}>
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
      <TrialResult t={t} kind={props.kind} trial={trial} judge={props.judge} />
      {props.recent && env !== null && (
        <section className={css.recent} data-testid="wl-trigger-output">
          <p className={css.recentTitle}>{t('trigger.output')}</p>
          <RecentOutput t={t} env={env} node={props.node} className={css.recentText} />
        </section>
      )}
    </Bench>
  )
}

/** 底栏：由什么 shell 运行；命令里能写 `{workflow}`，「?」里说它换成什么、怎么用；脚本可以让模型代写。 */
function CommandFoot(props: { t: T }): React.JSX.Element {
  const { t } = props
  return (
    <>
      <span>{t('trigger.cmd.shell')}</span>
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

/** 试运行的结果栏：一行小结，下面是输出（太长时框里滚）。 */
function TrialResult(props: {
  t: T
  kind: 'poll' | 'listen'
  trial: Trial
  judge: ((result: TriggerTryResponse) => { tone: 'ok' | 'off'; text: string }) | undefined
}): React.JSX.Element | null {
  const { t, trial } = props
  if (trial.kind === 'idle') return null
  if (trial.kind === 'running') {
    return (
      <div className={css.result} data-tone="busy" data-testid="wl-trigger-try-result">
        <span className={css.spinner} aria-hidden="true" />
        {t('trigger.cmd.trying')}
      </div>
    )
  }
  if (trial.kind === 'error') {
    return (
      <div className={css.result} data-tone="bad" data-testid="wl-trigger-try-result">
        <span className={css.badge}>{t('trigger.try.failed')}</span>
        <span className={css.resultText}>{trial.message}</span>
      </div>
    )
  }
  const { result } = trial
  const seconds = (result.ms / 1000).toFixed(result.ms < 10_000 ? 1 : 0)
  const verdict =
    result.failure !== undefined
      ? { tone: 'bad' as const, badge: t('trigger.try.failed'), text: result.failure }
      : props.kind === 'listen'
        ? {
            tone: 'ok' as const,
            badge: t('trigger.try.lines')
              .replace('{n}', String(result.lines ?? 0))
              .replace('{s}', seconds),
            text: result.stopped === true ? '' : t('trigger.try.exited'),
          }
        : {
            tone: props.judge?.(result).tone ?? ('ok' as const),
            badge: t('trigger.try.code').replace('{code}', String(result.code)),
            text: [props.judge?.(result).text, t('trigger.try.took').replace('{s}', seconds)]
              .filter((part) => part !== undefined && part !== '')
              .join(' · '),
          }
  return (
    <>
      <div className={css.result} data-tone={verdict.tone} data-testid="wl-trigger-try-result">
        <span className={css.badge}>{verdict.badge}</span>
        <span className={css.resultText}>{verdict.text}</span>
      </div>
      <pre className={css.output} data-testid="wl-trigger-try-output">
        {result.output === '' ? t('trigger.try.noOutput') : result.output}
      </pre>
    </>
  )
}
