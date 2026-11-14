/**
 * dsh-workflow-lite — 「触发方式」对话框的左栏：五种方式按「主动 / 被动」分两组，每种一个图标块、名字和一句说明；
 * 底下是这张卡片在画布上的样子（跟着草稿变，和画布卡片中间那一行同一个组件）。
 *
 * 一组单选：选中的底块滑过去（PickThumb），不是这块灭、那块亮。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/SourceRail
 */

import type { TriggerSource, TriggerSourceKind } from '../../../../shared/types.ts'
import type { TriggerView } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { triggerGlance, triggerMode } from '../../../model/triggerGlance.ts'
import { FadeText } from '../../motion/marks.tsx'
import { PickThumb } from '../../motion/thumb.tsx'
import { TriggerGlanceRow } from '../TriggerGlanceRow.tsx'
import { ModeChip, TriggerMark, triggerTint } from '../TriggerMark.tsx'
import { KIND_DESC, SOURCE_KINDS } from './kinds.ts'
import css from './sourceRail.module.css'

const GROUPS = [
  { mode: 'active', title: 'trigger.mode.active', sub: 'trigger.rail.activeSub' },
  { mode: 'passive', title: 'trigger.mode.passive', sub: 'trigger.rail.passiveSub' },
] as const

export function SourceRail(props: {
  t: T
  /** 卡片名。 */
  name: string
  source: TriggerSource
  /** 现场（只在草稿没改过时给：最近一行、地址这些是图里那条规则的）。 */
  view: TriggerView | undefined
  onPick(kind: TriggerSourceKind): void
}): React.JSX.Element {
  const { t, source } = props
  return (
    <div className={css.rail}>
      <div
        className={css.kinds}
        role="radiogroup"
        aria-label={t('trigger.when')}
        data-testid="wl-trigger-source"
      >
        <PickThumb
          layout={source.kind}
          item='[aria-checked="true"]'
          className={css.thumb}
          tone={{
            list: SOURCE_KINDS.map((kind) => kind.value),
            on: source.kind,
            attr: 'data-kind',
          }}
        />
        {GROUPS.map((group) => (
          <div key={group.mode} className={css.group} role="presentation">
            <p className={css.groupTitle}>
              {t(group.title)}
              <span className={css.groupSub}>{t(group.sub)}</span>
            </p>
            {SOURCE_KINDS.filter((kind) => triggerMode(kind.value) === group.mode).map((kind) => {
              const on = kind.value === source.kind
              return (
                <button
                  key={kind.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={css.tile}
                  data-on={on}
                  data-testid={`wl-trigger-source-${kind.value}`}
                  onClick={() => {
                    if (!on) props.onPick(kind.value)
                  }}
                >
                  <TriggerMark kind={kind.value} size={15} className={css.mark} />
                  <span className={css.text}>
                    <FadeText text={t(kind.label)} on={on} className={css.name} />
                    <span className={css.desc}>{t(KIND_DESC[kind.value])}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <section className={css.preview} data-testid="wl-trigger-source-preview">
        <p className={css.groupTitle}>{t('trigger.onCard')}</p>
        <div
          className={css.card}
          style={{ '--wl-kind': triggerTint(source.kind) } as React.CSSProperties}
        >
          <p className={css.cardHead}>
            <TriggerMark kind={source.kind} size={12} className={css.cardMark} />
            <span className={css.cardName}>{props.name}</span>
          </p>
          <TriggerGlanceRow glance={triggerGlance(t, source)} view={props.view} />
          <span className={css.cardFoot}>
            <ModeChip t={t} kind={source.kind} />
          </span>
        </div>
      </section>
    </div>
  )
}
