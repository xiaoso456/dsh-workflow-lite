/**
 * dsh-workflow-lite — 看一个 skill 的 SKILL.md。
 *
 * 框子是 {@link DocViewer}：正文默认排版、可切源码；标题行能复制路径、用其他程序打开
 * SKILL.md 或在文件管理器里显示它所在的文件夹（插件运行时注册的 skill 没有文件，这两样不出现）。
 * 正文前是它的一句话说明和「什么时候用」。从选择框里点开时，底部带一个「选上 / 用这个」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/resources/SkillPreview
 */

import { useEffect, useState } from 'react'
import type { HostSkillResponse } from '../../../shared/wire/host.ts'
import type { HostAccess } from '../../app/host.ts'
import type { T } from '../../i18n.ts'
import { errorMessage } from '../../rpc.ts'
import { type DocBody, DocViewer } from '../files/DocViewer.tsx'
import { metaText, SkillMetaList } from '../files/SkillMetaList.tsx'
import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import overlay from '../kit/overlay.module.css'
import { fileMetadata, skillSource } from '../kit/resourceUi.ts'
import ui from '../kit/ui.module.css'
import shared from './resource.module.css'
import css from './skillPreview.module.css'

/** 底部的那个按钮（不给就没有底部）。 */
export interface SkillPreviewAction {
  label: string
  icon: IconName
  primary: boolean
  disabled?: boolean
  onClick(): void
}

/**
 * 正文前的元数据：SKILL.md 头部能读到的字段。`name` 一定有；`description`、`whenToUse` 没有就不显示；
 * 头部的其余键值（宿主解析出的 `metadata`）接在后面，有几条显示几条。
 * 每块一个色点（按排位循环换色）+ 等宽的字段名，前三个字段另带中文名，下面是值。
 */
function SkillMeta(props: { t: T; skill: HostSkillResponse }): React.JSX.Element {
  const { t, skill } = props
  const fields: { key: string; label?: string; value: string }[] = [
    { key: 'name', label: t('skill.fieldName'), value: skill.name },
  ]
  if (skill.description.trim() !== '') {
    fields.push({ key: 'description', label: t('skill.fieldDesc'), value: skill.description })
  }
  if (skill.whenToUse !== undefined && skill.whenToUse.trim() !== '') {
    fields.push({ key: 'whenToUse', label: t('skill.whenToUse'), value: skill.whenToUse })
  }
  for (const [key, value] of fileMetadata(skill.metadata)) {
    const text = metaText(value)
    if (value !== null && value !== undefined && text.trim() !== '')
      fields.push({ key, value: text })
  }
  return <SkillMetaList t={t} fields={fields} />
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
        <span className={cx(overlay.sheetIcon, shared.skillHeadIcon)}>
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
      lead={skill === null ? undefined : <SkillMeta t={t} skill={skill} />}
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
