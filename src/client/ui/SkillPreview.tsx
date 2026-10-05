/**
 * dsh-workflow-lite — 看一个 skill 的 SKILL.md。
 *
 * 框子是 {@link DocViewer}：正文默认排版、可切源码；标题行能复制路径、用其他程序打开
 * SKILL.md 或在文件管理器里显示它所在的文件夹（插件运行时注册的 skill 没有文件，这两样不出现）。
 * 正文前是它的一句话说明和「什么时候用」。从选择框里点开时，底部带一个「选上 / 用这个」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/SkillPreview
 */

import { useEffect, useState } from 'react'
import type { HostSkillResponse } from '../../shared/wire.ts'
import type { HostAccess } from '../app/host.ts'
import type { T } from '../i18n.ts'
import { errorMessage } from '../rpc.ts'
import { type DocBody, DocViewer } from './DocViewer.tsx'
import { Icon, type IconName } from './Icon.tsx'
import overlay from './overlay.module.css'
import { cx } from './primitives.tsx'
import css from './resource.module.css'
import { skillSource } from './resourceUi.ts'
import ui from './ui.module.css'

/** 底部的那个按钮（不给就没有底部）。 */
export interface SkillPreviewAction {
  label: string
  icon: IconName
  primary: boolean
  disabled?: boolean
  onClick(): void
}

export function SkillPreview(props: {
  t: T
  host: HostAccess
  name: string
  action?: SkillPreviewAction
  onClose(): void
}): React.JSX.Element {
  const { t, host, name } = props
  const [skill, setSkill] = useState<HostSkillResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSkill(null)
    setError(null)
    void host.skill(name).then(
      (next) => {
        if (alive) setSkill(next)
      },
      (reason: unknown) => {
        if (alive) setError(errorMessage(reason))
      },
    )
    return () => {
      alive = false
    }
  }, [host, name])

  const body: DocBody =
    error !== null
      ? { kind: 'state', icon: 'alert', text: error }
      : skill === null
        ? { kind: 'loading' }
        : { kind: 'text', text: skill.content, format: 'markdown' }
  const source = skill === null ? null : skillSource(skill.source, t)
  const action = props.action

  return (
    <DocViewer
      t={t}
      name={name}
      badge={
        <span className={cx(overlay.sheetIcon, css.skillHeadIcon)}>
          <Icon name="sparkle" size={16} />
        </span>
      }
      meta={
        source === null ? (
          ' '
        ) : (
          <span data-tip={source.full}>
            {source.short}
            {' · '}
            {skill?.path === undefined ? t('skill.virtual') : <code>{skill.path}</code>}
          </span>
        )
      }
      body={body}
      copyPath={skill?.path ?? null}
      openPath={skill?.path ?? null}
      desktop={host.desktop}
      testId="wl-skill-preview"
      className={css.skillViewer}
      lead={
        skill !== null && (skill.description !== '' || skill.whenToUse !== undefined) ? (
          <div className={css.skillLead}>
            {skill.description !== '' && <p className={css.skillLeadDesc}>{skill.description}</p>}
            {skill.whenToUse !== undefined && (
              <p className={css.skillLeadWhen}>
                <span>{t('skill.whenToUse')}</span>
                {skill.whenToUse}
              </p>
            )}
          </div>
        ) : undefined
      }
      footer={
        action === undefined ? undefined : (
          <footer className={css.skillViewerFoot}>
            <span className={ui.grow} />
            <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.small, action.primary && ui.primary)}
              disabled={action.disabled === true}
              data-testid="wl-skill-preview-action"
              onClick={action.onClick}
            >
              <Icon name={action.icon} size={13} />
              {action.label}
            </button>
          </footer>
        )
      }
      onClose={props.onClose}
    />
  )
}
