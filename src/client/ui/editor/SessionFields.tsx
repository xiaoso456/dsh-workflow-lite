/**
 * dsh-workflow-lite — 「工作流设置」的「会话」页：新建会话时用哪个 agent 预设、哪个模型、哪档思考强度。
 *
 * 和「复用执行者」同样的行：左图标、中间名字加一句说明、右边控件。两个下拉第一项都是「跟随默认」，
 * 后面小字写现在跟随的是什么；模型按服务商分组、可搜索。思考强度只在选了分档的模型时出现，档位按这个模型给。
 * 设了但这台机器上用不了的：名字后面一个告警图标，和「?」同样的浮层写原因和支持的 DSH 版本（执行时回退默认，不挡保存）。
 * 状态在对话框里，这里只画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/editor/SessionFields
 */

import type { ModelChoice, SessionChoice } from '../../../shared/types.ts'
import type { HostAgentsResponse } from '../../../shared/wire/host.ts'
import type { T } from '../../i18n.ts'
import {
  type ChoiceIssue,
  choiceIssues,
  effortOptions,
  FOLLOW,
  issueLines,
  modelKey,
  modelOptions,
  pickModel,
  presetOptions,
  withEffort,
} from '../../model/sessionChoice.ts'
import { cx } from '../kit/cx.ts'
import { HelpList } from '../kit/HelpTip.tsx'
import { Icon, type IconName } from '../kit/Icon.tsx'
import { Segmented } from '../kit/Segmented.tsx'
import { Select } from '../kit/Select.tsx'
import { WarnMark } from '../kit/WarnMark.tsx'
import { FieldHead } from '../panel/FieldHead.tsx'
import s from './settings.module.css'

/** 一行：图标、名字（用不了时后面一个告警图标，悬停看原因）、一句说明、右边的控件。 */
function ChoiceRow(props: {
  icon: IconName
  title: string
  desc: string
  issue: string[] | undefined
  testId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={s.row} data-testid={props.testId}>
      <span className={s.rowIcon}>
        <Icon name={props.icon} size={15} />
      </span>
      <span className={s.rowText}>
        <span className={s.rowTitle}>
          {props.title}
          <WarnMark title={props.title} lines={props.issue} testId={`${props.testId}-warn`} />
        </span>
        <span className={s.rowDesc}>{props.desc}</span>
      </span>
      <span className={s.rowPick}>{props.children}</span>
    </div>
  )
}

export function SessionGroup(props: {
  t: T
  catalog: HostAgentsResponse | null
  preset: string | undefined
  model: ModelChoice | undefined
  onPreset(preset: string | undefined): void
  onModel(model: ModelChoice | undefined): void
}): React.JSX.Element {
  const { t, catalog, model } = props
  const choice: SessionChoice = {
    ...(props.preset === undefined ? {} : { preset: props.preset }),
    ...(model === undefined ? {} : { model }),
  }
  const issues = choiceIssues(catalog, choice)
  const issueOf = (kind: ChoiceIssue['kind']): string[] | undefined => {
    const found = issues.find((issue) => issue.kind === kind)
    return found === undefined ? undefined : issueLines(t, catalog, found)
  }
  const modelIssue = issueOf('model') ?? issueOf('unsupported')
  const efforts = model === undefined ? [] : effortOptions(t, catalog, model)
  return (
    <section className={s.group}>
      <FieldHead
        title={t('session.group')}
        helpTestId="wl-settings-session-help"
        help={
          <HelpList t={t} keys={['session.groupTip1', 'session.groupTip2', 'session.groupTip3']} />
        }
      />
      <div className={cx(s.rows, s.loose)}>
        <ChoiceRow
          icon="user"
          title={t('session.preset')}
          desc={t('session.presetDesc')}
          issue={issueOf('preset')}
          testId="wl-settings-row-preset"
        >
          <Select<string>
            t={t}
            label={t('session.preset')}
            value={props.preset ?? FOLLOW}
            proseDesc
            testId="wl-settings-preset"
            options={presetOptions(t, catalog, props.preset, 'default', undefined)}
            onChange={(value) => props.onPreset(value === FOLLOW ? undefined : value)}
          />
        </ChoiceRow>
        <ChoiceRow
          icon="cube"
          title={t('session.model')}
          desc={t('session.modelDesc')}
          issue={modelIssue}
          testId="wl-settings-row-model"
        >
          <Select<string>
            t={t}
            search
            label={t('session.model')}
            value={modelKey(model)}
            proseDesc
            testId="wl-settings-model"
            options={modelOptions(t, catalog, model, 'default', undefined)}
            onChange={(value) => props.onModel(pickModel(catalog, value, model))}
          />
        </ChoiceRow>
        {model !== undefined && efforts.length > 0 && (
          <ChoiceRow
            icon="bolt"
            title={t('session.effort')}
            desc={t('session.effortDesc')}
            issue={issueOf('effort')}
            testId="wl-settings-row-effort"
          >
            <Segmented
              fit
              label={t('session.effort')}
              value={model.effort ?? FOLLOW}
              testId="wl-settings-effort"
              options={efforts}
              onChange={(value) => props.onModel(withEffort(model, value))}
            />
          </ChoiceRow>
        )}
      </div>
    </section>
  )
}
