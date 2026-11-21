/**
 * dsh-workflow-lite — 导出清单里跟触发、新建会话有关的两类。
 *
 * - 「触发器」（{@link TriggerCategory}）：缺省关闭，打开后可逐张勾选。一张卡片一行（名字 + 触发方式），
 *   怎么触发、出现在哪几版放进悬浮提示。卡片目录里有密钥、脚本数据的，缩进挂在卡片下面、用树线连回卡片，
 *   各自勾选（缺省不带；勾上密钥时名字后面出一个告警三角，悬浮说明是明文进包，底栏也提一句）；
 *   末尾一行是触发脚本，亮着是带、灰着是不带，原因在图标的悬浮提示里。
 * - 「新建会话的设置」（{@link ChoiceCategory}）：模型、Agent 预设、运行权限三个总开关，
 *   每个下面列出图里哪几处设了它（工作流设置、哪张卡片、设成什么）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/ExportTriggers
 */

import { useCallback, useState } from 'react'
import { type PackScanResponse, type PackTrigger, packsScripts } from '../../../shared/pack.ts'
import type { ChoiceKeep } from '../../../shared/sessionChoice.ts'
import { agentCatalog, useAgentCatalog } from '../../app/agents.ts'
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
import { choiceSummary } from '../../model/sessionChoice.ts'
import { sourceText } from '../../model/triggerText.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'
import { Icon } from '../kit/Icon.tsx'
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
  /** 选了几个版本：多个时每张卡片写上出现在哪几版。 */
  multi: boolean
  onPick(pick: TriggerPick): void
}): React.JSX.Element {
  const { t, scan, pick } = props
  // 缺省关着、收起；打开开关时顺手展开。关着也能展开看看有哪几张，各行灰掉、勾不了（同文件、Skill 那几类）。
  const [open, setOpen] = useState(pick.enabled)
  const enabled = pick.enabled
  const kept = scan.triggers.filter((card) => pick.keep.has(card.node)).length
  const scripts = scan.triggerScripts
  const row = (card: PackTrigger): React.JSX.Element[] => {
    const name = cardName(t, card)
    const keep = pick.keep.has(card.node)
    const on = enabled && keep
    const rows = [
      <PackRow
        key={card.node}
        title={name}
        badge={
          <span className={hub.tag} data-tone="plain">
            {t(`trigger.source.${card.source.kind}` as LocaleKey)}
          </span>
        }
        tip={[
          sourceText(t, card.source),
          props.multi
            ? t('pack.inVersions').replace('{list}', card.versions.map((n) => `v${n}`).join('、'))
            : null,
        ]
          .filter((line) => line !== null)
          .join('\n')}
        checked={keep}
        disabled={!enabled}
        dim={!on}
        testId="wl-pack-trigger"
        onCheck={(next) => props.onPick(toggleTrigger(pick, 'keep', card.node, next))}
      />,
    ]
    const kids: React.JSX.Element[] = []
    if (card.secrets !== undefined) {
      const packed = enabled && packsSecrets(pick, card)
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
          dim={!(enabled && packsData(pick, card))}
          testId="wl-pack-trigger-data"
          onCheck={(next) => props.onPick(toggleTrigger(pick, 'data', card.node, next))}
        />,
      )
    }
    if (kids.length > 0) {
      rows.push(
        <div key={`${card.node}:kids`} className={css.trgKids}>
          {kids}
        </div>,
      )
    }
    return rows
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
      {scan.triggers.flatMap(row)}
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
  rpc: WorkflowLiteRpc
  session: string | undefined
  scan: PackScanResponse
  keep: ChoiceKeep
  onKeep(keep: ChoiceKeep): void
}): React.JSX.Element {
  const { t, scan, keep, rpc, session } = props
  const [open, setOpen] = useState(false)
  const read = useCallback(() => agentCatalog(rpc, session), [rpc, session])
  const catalog = useAgentCatalog(read)
  const parts = CHOICE_PARTS.filter((part) => choicePlaces(scan.choices, part).length > 0)
  const kept = parts.filter((part) => keep[part]).map((part) => t(`pack.choicePart.${part}`))
  return (
    <ExportCategory
      icon="cube"
      title={t('pack.choice')}
      stats={
        kept.length === 0
          ? t('pack.choiceStatsNone')
          : t('pack.choiceStats').replace('{list}', kept.join('、'))
      }
      empty={false}
      expanded={open}
      onExpand={setOpen}
      testId="wl-pack-cat-choice"
    >
      <p className={css.choiceLine}>{t('pack.choiceNote')}</p>
      {parts.map((part) => (
        <PackRow
          key={part}
          title={t(`pack.choicePart.${part}`)}
          meta={choicePlaces(scan.choices, part).map(({ spot, choice }) => {
            const where =
              spot.node === undefined
                ? t('pack.choiceWorkflow')
                : t('pack.choiceCard').replace('{name}', spot.label ?? spot.node)
            return `${where}：${choiceSummary(t, catalog, choice)}`
          })}
          checked={keep[part]}
          dim={!keep[part]}
          testId={`wl-pack-choice-${part}`}
          onCheck={(on) => props.onKeep({ ...keep, [part]: on })}
        />
      ))}
    </ExportCategory>
  )
}
