/**
 * dsh-workflow-lite — 步骤库（左侧浮动面板）。
 *
 * 条目**只能拖**：拖到画布上哪里，步骤就落在哪里。单击条目不往图里加东西（落点不明确，
 * 容易误加），只轻轻晃一下并亮出"拖到画布上"的提示，告诉人该怎么用。
 * 想在某个具体位置加：双击画布空白处；想接在某一步后面：点那一步右侧的「＋」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Library
 */

import { useState } from 'react'
import type { TemplateEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { DND_MIME, encodeStepSource, PRESETS, type StepSource } from '../model/library.ts'
import { Icon, type IconName } from './Icon.tsx'
import css from './library.module.css'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

function Item(props: {
  source: StepSource
  icon: IconName
  kind: string
  title: string
  desc: string
  disabled?: boolean
  testId: string
  onNudge: () => void
}): React.JSX.Element {
  const [nudge, setNudge] = useState(0)
  return (
    <button
      type="button"
      className={css.item}
      draggable={props.disabled !== true}
      disabled={props.disabled}
      data-testid={props.testId}
      // 两个同样的晃动动画轮流用：同一个动画名不会因为再点一次就重新开始。
      data-nudge={nudge === 0 ? undefined : nudge % 2}
      onDragStart={(event) => {
        event.dataTransfer.setData(DND_MIME, encodeStepSource(props.source))
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => {
        setNudge((value) => value + 1)
        props.onNudge()
      }}
    >
      <span className={ui.kind} data-kind={props.kind}>
        <Icon name={props.icon} size={15} />
      </span>
      <span className={css.itemText}>
        <span className={css.itemTitle}>{props.title}</span>
        <span className={css.itemDesc}>{props.desc}</span>
      </span>
      <span className={css.grip} aria-hidden="true">
        ⋮⋮
      </span>
    </button>
  )
}

export function Library(props: {
  t: T
  templates: readonly TemplateEntry[]
  onClose: () => void
}): React.JSX.Element {
  const { t } = props
  const [hinting, setHinting] = useState(0)
  return (
    <section className={cx(ui.panel, css.library)} aria-label={t('lib.title')}>
      <header className={css.head}>
        <span className={css.title}>{t('lib.title')}</span>
        {/* 换 key 重新挂载 = 重播一次高亮。 */}
        <span className={css.hint} data-flash={hinting > 0} key={hinting}>
          {t('lib.hint')}
        </span>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
          data-tip={t('lib.collapse')}
          aria-label={t('lib.collapse')}
          onClick={props.onClose}
        >
          <Icon name="chevronLeft" size={15} />
        </button>
      </header>

      <div className={css.scroll}>
        <Item
          source={{ kind: 'blank' }}
          icon="blank"
          kind="blank"
          title={t('lib.blank')}
          desc={t('lib.blankDesc')}
          testId="wl-lib-blank"
          onNudge={() => setHinting((value) => value + 1)}
        />

        <p className={css.section}>{t('lib.builtin')}</p>
        {PRESETS.map((preset) => (
          <Item
            key={preset.id}
            source={{ kind: 'preset', id: preset.id }}
            icon={preset.kind}
            kind={preset.kind}
            title={t(preset.labelKey)}
            desc={t(preset.descKey)}
            testId={`wl-lib-preset-${preset.id}`}
            onNudge={() => setHinting((value) => value + 1)}
          />
        ))}

        <p className={css.section}>{t('lib.custom')}</p>
        {props.templates.length === 0 ? (
          <p className={css.emptyNote}>{t('lib.customEmpty')}</p>
        ) : (
          props.templates.map((entry) => (
            <Item
              key={entry.name}
              source={{ kind: 'template', name: entry.name }}
              icon="bookmark"
              kind="blank"
              title={entry.name}
              desc={entry.invalid === true ? (entry.reason ?? t('lib.broken')) : t('lib.hint')}
              disabled={entry.invalid === true}
              testId={`wl-lib-template-${entry.name}`}
              onNudge={() => setHinting((value) => value + 1)}
            />
          ))
        )}
      </div>
    </section>
  )
}
