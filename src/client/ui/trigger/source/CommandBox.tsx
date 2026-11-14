/**
 * dsh-workflow-lite — 轮询、监听的命令框：像一块终端，顶上一条栏（「从模板开始」菜单、「试运行」），
 * 中间是命令，底下是试运行的结果（退出码、满足没有、用时、输出），再下面是跑着的那条命令最近的输出。
 *
 * 「试运行」跑的是草稿里的命令，在这张卡片「执行设置」选的工作区里（没选就用当前会话的）；
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
import { Icon } from '../../kit/Icon.tsx'
import { Popover } from '../../kit/Popover.tsx'
import { TextArea } from '../../kit/TextArea.tsx'
import ui from '../../kit/ui.module.css'
import { RecentOutput } from '../RecentOutput.tsx'
import type { TriggerEnv } from '../triggerEnv.ts'
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
}): React.JSX.Element {
  const { t, env } = props
  const [trial, setTrial] = useState<Trial>({ kind: 'idle' })
  const [menu, setMenu] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const confirm = useConfirm<HTMLButtonElement>()
  const workspace =
    env === null ? undefined : (env.triggers.view(props.node)?.workspace ?? env.here.cwd)
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

  return (
    <div className={css.box} data-testid="wl-trigger-command-box">
      <div className={css.bar}>
        <Icon name="terminal" size={13} />
        <span className={css.barTitle}>{t('trigger.command')}</span>
        <span className={ui.grow} />
        <Popover
          open={menu}
          onClose={() => {
            setMenu(false)
            menuButton.current?.focus()
          }}
          label={t('trigger.cmd.template')}
          align="end"
          className={css.menu}
          trigger={
            <button
              ref={menuButton}
              type="button"
              className={css.barButton}
              aria-haspopup="menu"
              aria-expanded={menu}
              data-testid="wl-trigger-template"
              onClick={() => setMenu(!menu)}
            >
              {t('trigger.cmd.template')}
              <Icon name="chevronDown" size={12} />
            </button>
          }
        >
          <div role="menu" aria-label={t('trigger.cmd.template')}>
            {props.templates.map((template) => (
              <button
                key={template.id}
                type="button"
                role="menuitem"
                className={cx(ui.menuItem, css.menuItem)}
                data-testid={`wl-trigger-template-${template.id}`}
                onClick={() => {
                  setMenu(false)
                  setTrial({ kind: 'idle' })
                  props.onTemplate(template)
                }}
              >
                <span className={css.menuName}>{t(template.label)}</span>
                <span className={css.menuDesc}>{t(template.desc)}</span>
              </button>
            ))}
          </div>
        </Popover>
        {env !== null && (
          <>
            <button
              ref={confirm.anchorRef}
              type="button"
              className={cx(css.barButton, css.try)}
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
      </div>
      <div className={css.code}>
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
          aria-invalid={empty}
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
    </div>
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
