/**
 * dsh-workflow-lite — 「选择 Skill」：从会话里的 agent 能用的 skill 里挑。
 *
 * 一行一个 skill：左边是勾选区（勾选框、名字、一句话说明），点它选上 / 取消；右边是来源小签和
 * 一只「眼睛」，点它看 SKILL.md（{@link SkillPreview}，那里也能直接选上）。可以勾好几个一起加，
 * 已经在这个资源里的标成「已添加」。列不出来（没接上 skill 服务、一个都没有）时给一个「手写名字」
 * 的出口（`onManual`），平时不占地方。
 * `single`：编辑一项时换它的 skill——点一行就选定、直接关掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/SkillPicker
 */

import { useEffect, useMemo, useState } from 'react'
import type { HostSkillEntry, HostSkillsResponse } from '../../shared/wire.ts'
import type { HostAccess } from '../app/host.ts'
import type { T } from '../i18n.ts'
import { errorMessage } from '../rpc.ts'
import { Icon } from './Icon.tsx'
import overlay from './overlay.module.css'
import css from './picker.module.css'
import { cx, Modal } from './primitives.tsx'
import skill from './resource.module.css'
import { filterSkills, skillSource } from './resourceUi.ts'
import { SkillPreview } from './SkillPreview.tsx'
import ui from './ui.module.css'

export function SkillPicker(props: {
  t: T
  host: HostAccess
  /** 资源里已经有的 skill。 */
  existing: readonly string[]
  /** 只选一个：点一行就交出去。 */
  single?: boolean
  /** 列不出来时「手写一个名字」；不给就没有这个出口。 */
  onManual?: () => void
  onPick(names: string[]): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const [catalog, setCatalog] = useState<HostSkillsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [previewing, setPreviewing] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void props.host.skills().then(
      (next) => {
        if (alive) setCatalog(next)
      },
      (reason: unknown) => {
        if (alive) setError(errorMessage(reason))
      },
    )
    return () => {
      alive = false
    }
  }, [props.host])

  const all = useMemo(() => catalog?.skills ?? [], [catalog])
  const shown = useMemo(() => filterSkills(all, filter), [all, filter])
  const nothing =
    error !== null || catalog?.available === false || (catalog !== null && all.length === 0)

  /** 点一行（或预览里的按钮）：单选就交出去，多选就切换勾选。 */
  const choose = (name: string): void => {
    if (props.single === true) {
      props.onPick([name])
      return
    }
    setPicked((current) =>
      current.includes(name) ? current.filter((other) => other !== name) : [...current, name],
    )
  }

  const previewAdded = previewing !== null && props.existing.includes(previewing)
  const previewOn = previewing !== null && picked.includes(previewing)

  return (
    <Modal
      label={t('skill.title')}
      testId="wl-skill-picker"
      className={css.sheet}
      onDismiss={props.onClose}
    >
      <div className={overlay.sheetForm}>
        <header className={overlay.sheetHead}>
          <span className={cx(overlay.sheetIcon, skill.skillHeadIcon)}>
            <Icon name="sparkle" size={16} />
          </span>
          <div className={overlay.sheetTitles}>
            <p className={overlay.sheetTitle}>{t('skill.title')}</p>
            <p className={overlay.sheetSub}>{t('skill.sub')}</p>
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

        <div className={css.tools}>
          <span className={css.filterBox}>
            <Icon name="search" size={13} />
            <input
              className={css.filter}
              value={filter}
              placeholder={t('skill.filter')}
              aria-label={t('skill.filter')}
              data-testid="wl-skill-filter"
              // biome-ignore lint/a11y/noAutofocus: 打开就是为了找一个 skill
              autoFocus
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
          </span>
          {all.length > 0 && (
            <span className={css.count}>{t('skill.count').replace('{n}', String(all.length))}</span>
          )}
        </div>

        <ul
          className={cx(css.list, skill.skillList)}
          data-testid="wl-skill-list"
          data-loading={catalog === null && error === null}
        >
          {error !== null && <li className={css.error}>{error}</li>}
          {catalog?.available === false && <li className={css.empty}>{t('skill.unavailable')}</li>}
          {catalog?.available === true && shown.length === 0 && (
            <li className={css.empty}>
              {filter.trim() === '' ? t('skill.none') : t('pick.noMatch')}
            </li>
          )}
          {nothing && props.onManual !== undefined && (
            <li className={skill.skillManual}>
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.soft)}
                data-testid="wl-skill-manual"
                onClick={props.onManual}
              >
                <Icon name="pencil" size={12} />
                {t('skill.manualLink')}
              </button>
            </li>
          )}
          {shown.map((entry) => (
            <SkillRow
              key={entry.name}
              t={t}
              entry={entry}
              added={props.existing.includes(entry.name)}
              on={picked.includes(entry.name)}
              single={props.single === true}
              onChoose={() => choose(entry.name)}
              onPreview={() => setPreviewing(entry.name)}
            />
          ))}
        </ul>

        {props.single !== true && (
          <footer className={overlay.sheetFoot}>
            <span className={css.count}>
              {picked.length === 0 ? '' : t('pick.count').replace('{n}', String(picked.length))}
            </span>
            <span className={ui.grow} />
            <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={cx(ui.btn, ui.small, ui.primary)}
              disabled={picked.length === 0}
              data-testid="wl-skill-ok"
              onClick={() => props.onPick(picked)}
            >
              <Icon name="plus" size={13} />
              {t('pick.add')}
            </button>
          </footer>
        )}
      </div>

      {previewing !== null && (
        <SkillPreview
          t={t}
          host={props.host}
          name={previewing}
          action={
            props.single === true
              ? {
                  label: t('skill.use'),
                  icon: 'check',
                  primary: true,
                  onClick: () => choose(previewing),
                }
              : previewAdded
                ? {
                    label: t('skill.added'),
                    icon: 'check',
                    primary: false,
                    disabled: true,
                    onClick: () => {},
                  }
                : {
                    label: previewOn ? t('skill.unpick') : t('skill.pick'),
                    icon: previewOn ? 'x' : 'check',
                    primary: !previewOn,
                    onClick: () => {
                      choose(previewing)
                      setPreviewing(null)
                    },
                  }
          }
          onClose={() => setPreviewing(null)}
        />
      )}
    </Modal>
  )
}

/**
 * 一行：勾选区（勾选框 + 名字 + 说明）是一个按钮；右边是来源（纯文字）和一个小眼睛按钮，点开看 SKILL.md。
 * 两个按钮并排、互不嵌套。
 */
function SkillRow(props: {
  t: T
  entry: HostSkillEntry
  added: boolean
  on: boolean
  single: boolean
  onChoose(): void
  onPreview(): void
}): React.JSX.Element {
  const { t, entry } = props
  const source = skillSource(entry.source, t)
  const checked = props.on || props.added
  return (
    <li
      className={skill.skillRow}
      data-on={props.on}
      data-added={props.added}
      data-testid="wl-skill-row"
      data-name={entry.name}
    >
      <button
        type="button"
        className={skill.skillPick}
        // 多选时是勾选框；单选时就是个普通按钮（点了就选定）。
        {...(props.single ? {} : { role: 'checkbox', 'aria-checked': checked })}
        disabled={props.added}
        title={entry.description}
        onClick={props.onChoose}
      >
        {!props.single && (
          <span className={skill.skillCheck} aria-hidden="true" data-on={checked}>
            <Icon name="check" size={10} />
          </span>
        )}
        <span className={skill.skillText}>
          <span className={skill.skillName}>
            {entry.name}
            {props.added && <span className={skill.skillTag}>{t('skill.added')}</span>}
          </span>
          <span className={skill.skillDesc}>{entry.description}</span>
        </span>
      </button>
      <span className={skill.skillSide}>
        <span className={skill.skillSource} title={source.full}>
          {source.short}
        </span>
        <button
          type="button"
          className={cx(skill.skillPeek, ui.tip, ui.tipEnd)}
          data-tip={t('skill.preview')}
          aria-label={`${t('skill.preview')}：${entry.name}`}
          data-testid="wl-skill-preview-open"
          onClick={props.onPreview}
        >
          <Icon name="eye" size={14} />
        </button>
      </span>
    </li>
  )
}
