/**
 * dsh-workflow-lite — 导出清单里跟触发、新建会话有关的两类。
 *
 * - 「工作流设置」（{@link ChoiceCategory}）：工作流自己写的模型、Agent 预设、运行权限。
 * - 「触发器」（{@link TriggerCategory}）：缺省关闭，打开后可逐张勾选。展开卡片后各自勾选会话设置、密钥和脚本数据。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/ExportTriggers
 */

import { Fragment, useState } from 'react'
import { type PackScanResponse, type PackTrigger, packsScripts } from '../../../shared/pack.ts'
import {
  type ChoiceKeep,
  type ChoiceSpot,
  DEFAULT_CHOICE_KEEP,
} from '../../../shared/sessionChoice.ts'
import type { HostAgentsResponse } from '../../../shared/wire/host.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { formatBytes } from '../../model/fileKind.ts'
import {
  CHOICE_PARTS,
  choicePlaces,
  packsData,
  packsSecrets,
  type TriggerPick,
  toggleTrigger,
} from '../../model/packTriggers.ts'
import { choiceSummary, modelText } from '../../model/sessionChoice.ts'
import { sourceText } from '../../model/triggerText.ts'
import { Icon } from '../kit/Icon.tsx'
import { Presence } from '../motion/exits.tsx'
import { ExportCategory } from './ExportCategory.tsx'
import hub from './hub.module.css'
import css from './hubExport.module.css'
import { PackRow } from './PackRow.tsx'

function cardName(t: T, card: { label: string }): string {
  return card.label === '' ? t('pack.trg.unnamed') : card.label
}

export function TriggerCategory(props: {
  t: T
  scan: PackScanResponse
  pick: TriggerPick
  catalog: HostAgentsResponse | null
  /** 选了几个版本：多个时每张卡片写上出现在哪几版。 */
  multi: boolean
  onPick(pick: TriggerPick): void
}): React.JSX.Element {
  const { t, scan, pick } = props
  // 缺省关着、收起；打开开关时顺手展开。关着也能展开看看有哪几张，各行灰掉、勾不了（同文件、Skill 那几类）。
  const [open, setOpen] = useState(pick.enabled)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const enabled = pick.enabled
  const kept = scan.triggers.filter((card) => pick.keep.has(card.node)).length
  const scripts = scan.triggerScripts
  const choices = new Map<string, ChoiceSpot[]>()
  for (const spot of scan.choices) {
    if (spot.node === undefined) continue
    const list = choices.get(spot.node)
    if (list === undefined) choices.set(spot.node, [spot])
    else list.push(spot)
  }
  const row = (card: PackTrigger): React.JSX.Element => {
    const name = cardName(t, card)
    const keep = pick.keep.has(card.node)
    const on = enabled && keep
    const spots = choices.get(card.node) ?? []
    const parts = choiceParts(spots)
    const choice = pick.choices.get(card.node) ?? DEFAULT_CHOICE_KEEP
    const packedSecrets = packsSecrets(pick, card)
    const packedData = packsData(pick, card)
    const attached =
      parts.filter((part) => choice[part]).length + Number(packedSecrets) + Number(packedData)
    const cardOpen = expanded.has(card.node)
    const kids: React.JSX.Element[] = []
    if (card.secrets !== undefined) {
      const packed = on && packedSecrets
      kids.push(
        <PackRow
          key="secrets"
          title={
            <>
              {t('pack.trg.secrets')}{' '}
              <span className={css.dir}>{card.secrets.names.join('、')}</span>
            </>
          }
          badge={
            packed && (
              <span
                className={css.plainMark}
                data-tip={t('pack.trg.plain')}
                data-testid="wl-pack-trigger-plain"
              >
                <Icon name="alert" size={13} />
              </span>
            )
          }
          {...(packed ? { metaTone: 'warn' as const } : {})}
          end={formatBytes(card.secrets.bytes)}
          tip={card.secrets.names.join('\n')}
          checked={pick.secrets.has(card.node)}
          disabled={!on}
          dim={!packed}
          testId="wl-pack-trigger-secrets"
          onCheck={(next) => props.onPick(toggleTrigger(pick, 'secrets', card.node, next))}
        />,
      )
    }
    if (card.data !== undefined) {
      kids.push(
        <PackRow
          key="data"
          title={t('pack.trg.data')}
          end={`${t('pack.files').replace('{n}', String(card.data.files))} · ${formatBytes(card.data.bytes)}`}
          checked={pick.data.has(card.node)}
          disabled={!on}
          dim={!(on && packedData)}
          testId="wl-pack-trigger-data"
          onCheck={(next) => props.onPick(toggleTrigger(pick, 'data', card.node, next))}
        />,
      )
    }
    const hasDetails = parts.length > 0 || kids.length > 0
    return (
      <Fragment key={card.node}>
        <PackRow
          title={name}
          badge={
            <>
              <span className={hub.tag} data-tone="plain">
                {t(`trigger.source.${card.source.kind}` as LocaleKey)}
              </span>
              <span className={css.trgState} data-on={card.enabled === true}>
                {t(card.enabled === true ? 'pack.trg.enabled' : 'pack.trg.disabled')}
              </span>
            </>
          }
          tip={[
            sourceText(t, card.source),
            props.multi
              ? t('pack.inVersions').replace('{list}', card.versions.map((n) => `v${n}`).join('、'))
              : null,
          ]
            .filter((line) => line !== null)
            .join('\n')}
          end={
            <span className={hasDetails ? undefined : css.trgSummaryWithoutArrow}>
              {on
                ? t('pack.trg.attached').replace('{n}', String(attached))
                : t('pack.trg.excluded')}
            </span>
          }
          checked={keep}
          disabled={!enabled}
          dim={!on}
          testId="wl-pack-trigger"
          onCheck={(next) => props.onPick(toggleTrigger(pick, 'keep', card.node, next))}
          disclosure={
            hasDetails
              ? {
                  checkLabel: t('pack.trg.include').replace('{name}', name),
                  expanded: cardOpen,
                  onToggle: () => {
                    const next = new Set(expanded)
                    if (cardOpen) next.delete(card.node)
                    else next.add(card.node)
                    setExpanded(next)
                  },
                }
              : undefined
          }
        />
        <Presence show={cardOpen}>
          <div className={css.trgKids}>
            <ChoiceRows
              t={t}
              catalog={props.catalog}
              spots={spots}
              parts={parts}
              keep={choice}
              disabled={!on}
              testId="wl-pack-trigger-choice"
              onKeep={(next) => {
                props.onPick({ ...pick, choices: new Map(pick.choices).set(card.node, next) })
              }}
            />
            {parts.length > 0 && <p className={css.choiceLine}>{t('pack.trg.choiceNote')}</p>}
            {kids}
          </div>
        </Presence>
      </Fragment>
    )
  }
  const scriptsOn = enabled && scripts !== null && packsScripts(scan.triggers, pick.keep)
  return (
    <ExportCategory
      icon="bolt"
      title={t('pack.trg.title')}
      stats={t(enabled ? 'pack.catPicked' : 'pack.catNone')
        .replace('{n}', String(scan.triggers.length))
        .replace('{m}', String(kept))}
      empty={false}
      expanded={open}
      onExpand={setOpen}
      switch={{
        on: pick.enabled,
        disabled: false,
        onChange: (next) => {
          if (next) setOpen(true)
          props.onPick({ ...pick, enabled: next })
        },
      }}
      testId="wl-pack-cat-triggers"
    >
      {scan.triggers.map(row)}
      {scripts !== null && (
        <PackRow
          title={t('pack.trg.scripts')}
          end={`${t('pack.files').replace('{n}', String(scripts.files))} · ${formatBytes(scripts.bytes)}`}
          lead={{
            icon: 'terminal',
            tip: t(
              !enabled
                ? 'pack.trg.scriptsNone'
                : scriptsOn
                  ? 'pack.trg.scriptsOn'
                  : 'pack.trg.scriptsOff',
            ),
          }}
          dim={!scriptsOn}
          testId="wl-pack-trigger-scripts"
        />
      )}
    </ExportCategory>
  )
}

export function ChoiceCategory(props: {
  t: T
  catalog: HostAgentsResponse | null
  spots: readonly ChoiceSpot[]
  keep: ChoiceKeep
  onKeep(keep: ChoiceKeep): void
}): React.JSX.Element {
  const { t, spots, keep } = props
  const [open, setOpen] = useState(true)
  const parts = choiceParts(spots)
  const kept = parts.filter((part) => keep[part]).map((part) => t(`pack.choicePart.${part}`))
  const empty = parts.length === 0
  const stats =
    kept.length === 0
      ? t(empty ? 'pack.catEmpty' : 'pack.choiceStatsNone')
      : t('pack.choiceStats').replace('{list}', kept.join('、'))
  return (
    <ExportCategory
      icon="cube"
      title={t('pack.choice')}
      stats={stats}
      empty={empty}
      expanded={open}
      onExpand={setOpen}
      testId="wl-pack-cat-choice"
    >
      <ChoiceRows {...props} parts={parts} testId="wl-pack-choice" />
    </ExportCategory>
  )
}

function choiceParts(spots: readonly ChoiceSpot[]): (keyof ChoiceKeep)[] {
  return CHOICE_PARTS.filter((part) => spots.some(({ choice }) => choice[part] !== undefined))
}

function ChoiceRows(props: {
  t: T
  catalog: HostAgentsResponse | null
  spots: readonly ChoiceSpot[]
  parts: readonly (keyof ChoiceKeep)[]
  keep: ChoiceKeep
  disabled?: boolean
  testId: string
  onKeep(keep: ChoiceKeep): void
}): React.JSX.Element {
  const { t, catalog, keep } = props
  return (
    <>
      {props.parts.map((part) => {
        const values = choicePlaces(props.spots, part).map(({ spot, choice }) => {
          const model = choice.model
          let text: string
          if (model === undefined) {
            text = choiceSummary(t, catalog, choice)
          } else {
            const provider = catalog?.providers.find(({ id }) => id === model.provider)
            text = `${provider?.name ?? model.provider} · ${modelText(t, catalog, model)}`
            if (model.effort === undefined) {
              text += ` · ${t('session.effortOf').replace('{name}', t('session.effortDefault'))}`
            }
          }
          return spot.version === undefined ? text : `v${spot.version} · ${text}`
        })
        return (
          <PackRow
            key={part}
            title={
              <>
                {t(`pack.choicePart.${part}`)} <span className={css.dir}>{values.join('、')}</span>
              </>
            }
            tip={values.join('\n')}
            checked={keep[part]}
            disabled={props.disabled}
            dim={props.disabled === true || !keep[part]}
            testId={`${props.testId}-${part}`}
            onCheck={(on) => props.onKeep({ ...keep, [part]: on })}
          />
        )
      })}
    </>
  )
}
