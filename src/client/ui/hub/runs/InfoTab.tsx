/**
 * dsh-workflow-lite — 「运行实例」页的「信息」：和「触发」页「设置」同一种卡片，两列。
 *
 * - 来源：方式、触发器、触发时间、后来又触发了几次，触发说明、背景信息原文；
 * - 时间：建立、最近更新；
 * - 会话与工作区：会话、工作区（悬停看路径）、执行方式；不在本会话时右上角「移到本会话」（确认了才移）；
 * - 文件：编号、状态文件（能复制路径）。
 *
 * 只写记下了的；没记的写「未记录」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/InfoTab
 */

import type { InstanceSummary, InstanceView } from '../../../../shared/runState.ts'
import type { FireRecord } from '../../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { originChannelText } from '../../../model/originText.ts'
import { fullTime } from '../../../model/time.ts'
import hub from '../hub.module.css'
import { CopyButton } from '../pane/CopyButton.tsx'
import { InfoCard, InfoColumns, InfoRows, Mono, Muted, Quote } from '../pane/InfoCard.tsx'
import { RunMove } from './RunMove.tsx'
import { ORIGIN_ICON } from './runFace.ts'

export function InfoTab(props: {
  t: T
  item: InstanceSummary
  view: InstanceView | null
  fires: readonly FireRecord[]
  workspace: { name: string; path: string | undefined; here: boolean }
  session: { text: string; mine: boolean }
  /** 不在本会话、能移过来。 */
  canMove: boolean
  onMove(): void
}): React.JSX.Element {
  const { t, item } = props
  const origin = props.view?.origin ?? item.origin
  const joined = props.fires.filter((fire) => fire.joined === true).length
  const unknown = <Muted>{t('hub.runOriginUnknown')}</Muted>

  const left = (
    <>
      <InfoCard
        t={t}
        icon={origin === undefined ? 'history' : ORIGIN_ICON[origin.channel]}
        title={t('hub.runOrigin')}
        testId="wl-hub-run-info-origin"
      >
        <InfoRows
          rows={[
            [
              t('hub.runHow'),
              origin === undefined ? unknown : originChannelText(t, origin.channel),
            ],
            [t('hub.runTrigger'), origin?.trigger?.name],
            [
              t('hub.runFiredAt'),
              origin?.firedAt === undefined ? undefined : fullTime(origin.firedAt),
            ],
            [
              t('hub.runJoined'),
              joined === 0 ? undefined : t('hub.runJoinedCount').replace('{n}', String(joined)),
            ],
          ]}
        />
        {props.view?.origin?.note !== undefined && (
          <Note title={t('origin.note')}>{props.view.origin.note}</Note>
        )}
        {props.view?.origin?.info !== undefined && (
          <Note title={t('origin.info')}>{props.view.origin.info}</Note>
        )}
      </InfoCard>
      <InfoCard
        t={t}
        icon="file"
        title={t('hub.runFiles')}
        testId="wl-hub-run-info-files"
        action={
          item.statePath === undefined ? undefined : (
            <CopyButton t={t} text={item.statePath} testId="wl-hub-run-copy-state" />
          )
        }
      >
        <InfoRows
          rows={[
            [t('hub.runId'), <Mono key="id">{item.id}</Mono>],
            [
              t('hub.runStateFile'),
              item.statePath === undefined ? (
                <Muted key="path">{t('hub.runUntrackedShort')}</Muted>
              ) : (
                <Mono key="path">{item.statePath}</Mono>
              ),
            ],
          ]}
        />
      </InfoCard>
    </>
  )

  const right = (
    <>
      <InfoCard t={t} icon="clock" title={t('hub.runTimes')} testId="wl-hub-run-info-times">
        <InfoRows
          rows={[
            [t('hub.runCreated'), fullTime(item.createdAt)],
            [
              t('hub.runUpdated'),
              item.updatedAt === undefined ? unknown : fullTime(Date.parse(item.updatedAt)),
            ],
          ]}
        />
      </InfoCard>
      <InfoCard
        t={t}
        icon="chat"
        title={t('hub.runWhere')}
        testId="wl-hub-run-info-where"
        action={props.canMove ? <RunMove t={t} onMove={props.onMove} /> : undefined}
      >
        <InfoRows
          rows={[
            [
              t('hub.runSession'),
              <span key="session" data-tip={props.session.text}>
                {props.session.text}
                {props.session.mine && (
                  <>
                    {' '}
                    <span className={hub.tag} data-tone="plain">
                      {t('hub.thisSession')}
                    </span>
                  </>
                )}
              </span>,
            ],
            [
              t('hub.workspaces'),
              props.workspace.path === undefined ? (
                <Muted key="ws">{t('hub.noWorkspace')}</Muted>
              ) : (
                <span key="ws" data-tip={props.workspace.path}>
                  {props.workspace.name}
                  {props.workspace.here && (
                    <>
                      {' '}
                      <span className={hub.tag}>{t('hub.here')}</span>
                    </>
                  )}
                </span>
              ),
            ],
            [t('run.mode'), t(`settings.mode.${item.mode}` as LocaleKey)],
          ]}
        />
      </InfoCard>
    </>
  )

  return <InfoColumns left={left} right={right} testId="wl-hub-run-info" />
}

/** 卡片里的一段原文：小标题 + 引用块。 */
function Note(props: { title: string; children: string }): React.JSX.Element {
  return <InfoRows rows={[[props.title, <Quote key="quote">{props.children}</Quote>]]} />
}
