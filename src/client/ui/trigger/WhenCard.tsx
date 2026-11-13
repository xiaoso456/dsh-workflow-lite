/**
 * dsh-workflow-lite — 面板里的「触发方式」：一张和画布上触发卡片同样子的卡。
 *
 * - 卡头：触发方式的图标块、「定时 ▾」（点开菜单换方式，直接换、能撤销，不弹窗）、主动 / 被动，右边「编辑」；
 * - 卡身：和画布卡片中间那一行同一个速览，下面一行补速览没说的（下一次、命令、怎么触发，见 `whenDetail`）。
 *
 * 详细设置在「编辑」打开的对话框里（{@link SourceDialog}）。换到还差东西的方式（轮询、监听没写命令，接续没选工作流），
 * 「编辑」变成「写命令」「选工作流」这样的主按钮：同一个按钮只换字和样子，不挪位置。
 * 画布上点选中卡片的速览时，面板接手打开对话框（`env.editSource` → `reveal: 'source'`）。
 *
 * 换过的方式各自填过的值，在这张面板开着时记着，换回来还在。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/WhenCard
 */

import { useEffect, useRef, useState } from 'react'
import { sourceIssue } from '../../../shared/trigger.ts'
import type { TriggerSource, TriggerSourceKind } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { triggerGlance } from '../../model/triggerGlance.ts'
import { whenActionKey, whenDetail } from '../../model/triggerSummary.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { FieldHead } from '../panel/FieldHead.tsx'
import ins from '../panel/panel.module.css'
import { SourceDialog } from './dialogs/SourceDialog.tsx'
import { KindMenu } from './KindMenu.tsx'
import { switchSource } from './SourceField.tsx'
import { TriggerGlanceRow } from './TriggerGlanceRow.tsx'
import { ModeChip, TriggerMark, triggerTint } from './TriggerMark.tsx'
import type { TriggerEnv } from './triggerEnv.ts'
import css from './whenCard.module.css'

const SOURCE_FIELD = ['source'] as const

export function WhenCard(props: {
  t: T
  node: string
  name: string
  source: TriggerSource
  env: TriggerEnv | null
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source, env } = props
  const [editing, setEditing] = useState(false)
  const kept = useRef(new Map<TriggerSourceKind, TriggerSource>())
  const view = env?.triggers.view(props.node)
  const missing = sourceIssue(source) !== null
  const live =
    view !== undefined && (view.state === 'waiting' || view.state === 'elsewhere')
      ? view.next
      : undefined
  const detail = whenDetail(t, source, { next: live, line: view?.line?.text }, new Date())

  // 画布上点了这张卡片的速览：接手，打开对话框。
  const request = env?.reveal
  const take = env?.takeReveal
  useEffect(() => {
    if (request === undefined || request === null || take === undefined) return
    if (take(props.node, SOURCE_FIELD) !== null) setEditing(true)
  }, [request, take, props.node])

  const pick = (kind: TriggerSourceKind): void => {
    kept.current.set(source.kind, source)
    props.onChange(switchSource(source, kind, kept.current))
  }

  return (
    <section className={ins.field} data-testid="wl-trigger-when-field" data-kind={source.kind}>
      <FieldHead title={t('trigger.when')} />
      <div
        className={css.card}
        style={{ '--wl-kind': triggerTint(source.kind) } as React.CSSProperties}
      >
        <div className={css.head}>
          <TriggerMark kind={source.kind} />
          <KindMenu t={t} value={source.kind} onPick={pick} />
          <ModeChip t={t} kind={source.kind} />
          <span className={ui.grow} />
          <button
            type="button"
            className={cx(ui.btn, ui.small, missing ? ui.primary : css.edit)}
            data-missing={missing || undefined}
            data-testid="wl-trigger-when-edit"
            onClick={() => setEditing(true)}
          >
            <Icon name="pencil" size={13} />
            {t(whenActionKey(source))}
          </button>
        </div>
        <div className={css.body}>
          <TriggerGlanceRow glance={triggerGlance(t, source)} view={view} />
          <p
            className={css.detail}
            data-tone={detail.tone}
            data-tip={detail.tone === 'code' ? detail.text : undefined}
            data-testid="wl-trigger-when-detail"
          >
            {detail.text}
          </p>
        </div>
      </div>
      {editing && (
        <SourceDialog
          t={t}
          node={props.node}
          name={props.name}
          source={source}
          env={env}
          onSave={(next) => {
            if (next.kind !== source.kind) kept.current.set(source.kind, source)
            props.onChange(next)
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  )
}
