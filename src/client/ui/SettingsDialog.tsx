/**
 * dsh-workflow-lite — 「工作流设置」对话框：整张工作流的全局配置。
 *
 * 两项：
 * - **产出根目录**：每个步骤的产出文件编译时都拼在它下面。边打字边预览拼出来的样子，
 *   拼接与标准化走 `shared/outputPaths.ts`（和编译器同一份），这里看到的就是计划里写的。
 * - **执行方式**：自动 / 串行 / 主 agent + 子代理 / Agent 团队。后两种主 agent 当 leader。
 *
 * 「完成」时一次交出去（一次改动 = 一条撤销步）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/SettingsDialog
 */

import { useEffect, useRef, useState } from 'react'
import { readSettings } from '../../shared/model.ts'
import {
  checkOutputRoot,
  isAbsoluteRoot,
  normalizeRoot,
  resolveOutputPath,
} from '../../shared/outputPaths.ts'
import { EXECUTION_MODES, type ExecutionMode, type WorkflowSettings } from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { Icon, type IconName } from './Icon.tsx'
import css from './inspector.module.css'
import overlay from './overlay.module.css'
import { cx, HelpTip, Modal } from './primitives.tsx'
import ui from './ui.module.css'

const MODE_TEXT: Record<ExecutionMode, { icon: IconName; title: LocaleKey; desc: LocaleKey }> = {
  auto: { icon: 'modeAuto', title: 'settings.mode.auto', desc: 'settings.mode.autoDesc' },
  serial: { icon: 'modeSerial', title: 'settings.mode.serial', desc: 'settings.mode.serialDesc' },
  subagent: {
    icon: 'modeSubagent',
    title: 'settings.mode.subagent',
    desc: 'settings.mode.subagentDesc',
  },
  team: { icon: 'modeTeam', title: 'settings.mode.team', desc: 'settings.mode.teamDesc' },
}

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
  const [root, setRoot] = useState(props.settings?.outputRoot ?? '')
  const [mode, setMode] = useState<ExecutionMode>(props.settings?.mode ?? 'auto')
  const rootRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  const problem = checkOutputRoot(root)
  const normalized = problem === null ? normalizeRoot(root) : undefined
  const dirty =
    root !== (props.settings?.outputRoot ?? '') || mode !== (props.settings?.mode ?? 'auto')

  const submit = (): void => {
    if (problem !== null) return
    props.onSave(readSettings({ outputRoot: root, mode }))
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
          <section className={css.field}>
            <div className={css.label}>
              <span className={css.labelMain}>
                {t('settings.root')}
                <HelpTip label={t('settings.root')} testId="wl-settings-root-help">
                  <p className={ui.hintTitle}>{t('settings.root')}</p>
                  <ul className={ui.hintList}>
                    <li>{t('settings.rootTipJoin')}</li>
                    <li>{t('settings.rootTipKinds')}</li>
                    <li>{t('settings.rootTipNormalize')}</li>
                    <li>{t('settings.rootTipEmpty')}</li>
                  </ul>
                  {/* 示例跟着输入框实时变：拼接与标准化和编译器是同一份。 */}
                  <p className={ui.hintExample} data-testid="wl-settings-preview">
                    <span>{t('settings.preview')}</span>
                    <code>{props.sample}</code>
                    <span aria-hidden="true">→</span>
                    <code>{resolveOutputPath(normalized, props.sample)}</code>
                  </p>
                </HelpTip>
              </span>
              {normalized !== undefined && (
                <span className={css.rootKind} data-absolute={isAbsoluteRoot(normalized)}>
                  {isAbsoluteRoot(normalized)
                    ? t('settings.rootAbsolute')
                    : t('settings.rootRelative')}
                </span>
              )}
            </div>
            <input
              ref={rootRef}
              className={cx(ui.input, ui.mono)}
              value={root}
              placeholder={t('settings.rootPlaceholder')}
              aria-label={t('settings.root')}
              aria-invalid={problem !== null}
              data-testid="wl-settings-root"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setRoot(event.currentTarget.value)}
            />
            {problem !== null && <p className={css.error}>{problem.message}</p>}
          </section>

          <section className={css.field}>
            <div className={css.label}>
              <span className={css.labelMain}>
                {t('settings.mode')}
                <HelpTip label={t('settings.mode')} testId="wl-settings-mode-help">
                  <p className={ui.hintTitle}>{t('settings.mode')}</p>
                  <ul className={ui.hintList}>
                    <li>{t('settings.modeTipPlan')}</li>
                    <li>{t('settings.leaderNote')}</li>
                    <li>{t('settings.modeTipTools')}</li>
                  </ul>
                </HelpTip>
              </span>
            </div>
            <div className={css.modes} role="radiogroup" aria-label={t('settings.mode')}>
              {EXECUTION_MODES.map((value) => {
                const text = MODE_TEXT[value]
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    className={css.mode}
                    data-testid={`wl-settings-mode-${value}`}
                    onClick={() => setMode(value)}
                  >
                    <span className={css.modeIcon}>
                      <Icon name={text.icon} size={16} />
                    </span>
                    <span className={css.modeTitle}>{t(text.title)}</span>
                    <span className={css.modeDesc}>{t(text.desc)}</span>
                    <span className={css.modeCheck} aria-hidden="true">
                      <Icon name="check" size={12} />
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
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
