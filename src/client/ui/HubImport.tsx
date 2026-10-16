/**
 * dsh-workflow-lite — 工作流中心「工作流」页右栏：导入一个工作流包。
 *
 * 选文件（或拖进来）→ 一块块传到主机暂存 → 主机解开、校验，回一份预览 → 用户看清单、做决定 → 确认卡 → 落盘。
 *
 * 预览把每样东西**落到哪**都写明：资料文件放进 `<dataDir>/assets/<名>/`，skill 装进 `~/.agents/skills/<名>/`；
 * 包里没带的引用逐条说本机有没有。要往 `~/.agents/skills` 里写东西时，得先勾「我确认」才能导入
 * （skill 里的脚本会被 agent 执行）。名字撞了：另存为新名字（缺省），或并入已有的那张——
 * 并入**不自动存**本机现在的内容，没存成版本就提醒一句。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubImport
 */

import { Fragment, useEffect, useRef, useState } from 'react'
import { PACK_SUFFIX, type PackImportPreview, type PackSkillAction } from '../../shared/pack.ts'
import { uploadPack } from '../app/packTransfer.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { formatBytes } from '../model/fileKind.ts'
import {
  actionOf,
  applyRequest,
  defaultImportChoice,
  type ImportChoice,
  importSummary,
  skillChoices,
  skillDestination,
} from '../model/pack.ts'
import { shortTime } from '../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { useConfirm } from './Confirm.tsx'
import type { PackScope } from './HubExport.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import { Checkbox } from './motion.tsx'
import { Callout, PackRow, PackSection } from './PackRow.tsx'
import css from './pack.module.css'
import { cx } from './primitives.tsx'
import { KIND_ICON } from './resourceUi.ts'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'

/** 资料文件一开始列几个（多了点「还有 N 个」展开）。 */
const ASSET_PREVIEW = 6

type Phase =
  | { kind: 'pick' }
  | { kind: 'busy'; text: string }
  | { kind: 'preview'; preview: PackImportPreview }

export function HubImport(props: {
  t: T
  rpc: WorkflowLiteRpc
  scope: PackScope
  /** 拖到页面上的那个文件：一进来就开始传。 */
  file: File | null
  /** 有文件正拖在这一页上（高亮拖放区）。 */
  over: boolean
  /** 已有的工作流名（小写，判断新名字撞没撞）。 */
  taken: ReadonlySet<string>
  /** 编辑页正开着的那张（并入它之前先把改动写下去）。 */
  current: string | null
  flush(): Promise<boolean>
  onBack(): void
  /** 导入完了：选中它、回版本页，带一句结果；`reload` = 编辑页正开着它，要按磁盘重新加载。 */
  onDone(name: string, text: string, reload: boolean): void
}): React.JSX.Element {
  const { t, rpc } = props
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 传上去还没导入的暂存：离开这一页时让主机删掉。 */
  const pending = useRef<string | null>(null)

  useEffect(
    () => () => {
      const token = pending.current
      if (token !== null) void rpc.call('pack/discard', { token }).catch(() => undefined)
    },
    [rpc],
  )

  const start = async (file: File): Promise<void> => {
    setError(null)
    setPhase({ kind: 'busy', text: t('pack.reading') })
    try {
      const token = await uploadPack(rpc, file, (done, total) =>
        setPhase({
          kind: 'busy',
          text: t('pack.uploading')
            .replace('{done}', formatBytes(done))
            .replace('{total}', formatBytes(total)),
        }),
      )
      pending.current = token
      setPhase({ kind: 'busy', text: t('pack.reading') })
      const preview = await rpc.call('pack/inspect', { token, ...props.scope })
      setPhase({ kind: 'preview', preview })
    } catch (caught) {
      setError(errorMessage(caught))
      setPhase({ kind: 'pick' })
    }
  }

  // 拖进来的文件：进页面就开始。
  const dropped = props.file
  useEffect(() => {
    if (dropped !== null) void start(dropped)
  }, [dropped])

  const cancel = (): void => {
    const token = pending.current
    pending.current = null
    if (token !== null) void rpc.call('pack/discard', { token }).catch(() => undefined)
    props.onBack()
  }

  return (
    <div className={cx(hub.wfDetail, hub.paneIn, css.page)} data-testid="wl-pack-import">
      <div className={hub.wfHead}>
        <div className={hub.wfHeadText}>
          <p className={hub.wfTitle}>{t('pack.importTitle')}</p>
          <p className={hub.wfSub}>{t('pack.importSub')}</p>
        </div>
        <button
          type="button"
          className={cx(ui.btn, ui.small)}
          disabled={phase.kind === 'busy'}
          data-testid="wl-pack-back"
          onClick={cancel}
        >
          <Icon name="chevronLeft" size={14} />
          {t('pack.back')}
        </button>
      </div>
      {error !== null && (
        <Callout tone="error" testId="wl-pack-error">
          {error}
        </Callout>
      )}
      {phase.kind === 'busy' ? (
        <div className={css.busy} data-testid="wl-pack-busy">
          <span className={hub.spinner} />
          {phase.text}
        </div>
      ) : phase.kind === 'pick' ? (
        <div className={css.drop} data-over={props.over}>
          <span className={css.dropIcon}>
            <Icon name="upload" size={20} />
          </span>
          <p className={css.dropTitle}>{t('pack.dropTitle')}</p>
          <p className={css.dropText}>{t('pack.dropText')}</p>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.primary)}
            data-testid="wl-pack-pick"
            onClick={() => inputRef.current?.click()}
          >
            {t('pack.pick')}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={`${PACK_SUFFIX},.zip,application/zip`}
            className={css.hidden}
            data-testid="wl-pack-file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file !== undefined) void start(file)
            }}
          />
        </div>
      ) : (
        <Preview
          t={t}
          preview={phase.preview}
          taken={props.taken}
          onCancel={cancel}
          onApply={async (choice) => {
            const preview = phase.preview
            setError(null)
            const target = choice.mode === 'merge' ? preview.name : choice.name.trim()
            if (target === props.current && !(await props.flush())) {
              setError(t('ver.flushFailed'))
              return
            }
            setPhase({ kind: 'busy', text: t('pack.importing') })
            try {
              const result = await rpc.call(
                'pack/apply',
                applyRequest(preview, choice, props.scope),
              )
              pending.current = null
              let text = t('pack.imported')
                .replace('{name}', result.name)
                .replace('{n}', String(result.versions.length))
              if (result.duplicates.length > 0) {
                text += t('pack.importedDup').replace('{n}', String(result.duplicates.length))
              }
              props.onDone(result.name, text, result.name === props.current)
            } catch (caught) {
              setError(errorMessage(caught))
              setPhase({ kind: 'preview', preview })
            }
          }}
        />
      )}
    </div>
  )
}

const SKILL_STATE: Record<PackImportPreview['skills'][number]['state'], LocaleKey> = {
  new: 'pack.skill.new',
  same: 'pack.skill.same',
  different: 'pack.skill.different',
}

function actionLabel(action: PackSkillAction, isNew: boolean): LocaleKey {
  if (action === 'install') return 'pack.skill.install'
  if (action === 'skip') return isNew ? 'pack.skill.skip' : 'pack.skill.keep'
  return action === 'overwrite' ? 'pack.skill.overwrite' : 'pack.skill.rename'
}

/** 第二步：看清单、做决定。 */
function Preview(props: {
  t: T
  preview: PackImportPreview
  taken: ReadonlySet<string>
  onCancel(): void
  onApply(choice: ImportChoice): Promise<void>
}): React.JSX.Element {
  const { t, preview } = props
  const [choice, setChoice] = useState<ImportChoice>(() => defaultImportChoice(preview))
  const [trusted, setTrusted] = useState(false)
  const [allAssets, setAllAssets] = useState(false)
  const [openSkill, setOpenSkill] = useState<string | null>(null)
  const confirm = useConfirm<HTMLButtonElement>()

  const summary = importSummary(preview, choice)
  const trimmed = choice.name.trim()
  const nameProblem =
    choice.mode === 'merge'
      ? null
      : trimmed === ''
        ? t('pack.nameEmpty')
        : props.taken.has(trimmed.toLowerCase())
          ? t('pack.nameTaken')
          : null
  const target = choice.mode === 'merge' ? preview.name : trimmed || preview.name
  const assetsDir = `${preview.assetsRoot}/${target}/`
  const needsTrust = summary.skills > 0
  const ready = nameProblem === null && (!needsTrust || trusted)
  const shownAssets = allAssets ? preview.assets : preview.assets.slice(0, ASSET_PREVIEW)

  return (
    <>
      <div className={cx(css.scroll, ui.scrollFade)}>
        <PackSection
          title={t('pack.versionsIn')}
          note={t('pack.meta')
            .replace('{format}', String(preview.format))
            .replace('{plugin}', preview.plugin || '?')
            .replace('{time}', shortTime(preview.exportedAt))}
        >
          {[...preview.versions].reverse().map((version) => (
            <PackRow
              key={version.n}
              icon="bookmark"
              tone={version.n === preview.current ? 'accent' : undefined}
              title={
                <>
                  v{version.n}
                  <span className={hub.wfSub}>
                    {' '}
                    {version.note === '' ? t('ver.noNote') : version.note}
                  </span>
                </>
              }
              badge={
                version.n === preview.current ? (
                  <span className={hub.tag} data-tip={t('pack.contentIs')}>
                    {t('ver.current')}
                  </span>
                ) : null
              }
              meta={[
                shortTime(version.createdAt),
                t('ver.steps').replace('{n}', String(version.nodeCount)),
              ]}
            />
          ))}
        </PackSection>

        <PackSection title={t('pack.sectionName')} testId="wl-pack-target">
          {preview.exists && (
            <div className={css.field}>
              <span>{t('pack.exists').replace('{name}', preview.name)}</span>
              <div className={css.choice}>
                <Segmented<ImportChoice['mode']>
                  label={t('pack.sectionName')}
                  value={choice.mode}
                  testId="wl-pack-mode"
                  options={[
                    { value: 'new', label: t('pack.asNew') },
                    { value: 'merge', label: t('pack.merge') },
                  ]}
                  onChange={(mode) => setChoice({ ...choice, mode })}
                />
              </div>
            </div>
          )}
          {choice.mode === 'new' ? (
            <div className={css.field}>
              <label className={css.fieldRow}>
                <span className={hub.wfSub}>{t('pack.nameLabel')}</span>
                <input
                  className={ui.input}
                  value={choice.name}
                  maxLength={64}
                  aria-invalid={nameProblem !== null}
                  data-testid="wl-pack-name"
                  onChange={(event) => setChoice({ ...choice, name: event.currentTarget.value })}
                />
              </label>
              {nameProblem !== null && <span className={css.fieldError}>{nameProblem}</span>}
            </div>
          ) : (
            <div className={css.field}>
              <span className={hub.wfSub}>
                {t('pack.mergeHint').replace('{n}', String(preview.current))}
              </span>
              {preview.unsaved && (
                <Callout tone="warn" testId="wl-pack-merge-unsaved">
                  {t('pack.mergeUnsaved').replace('{name}', preview.name)}
                </Callout>
              )}
              {preview.clashes.length > 0 && (
                <div className={css.fieldRow}>
                  <span className={hub.wfSub}>
                    {t('pack.clashes').replace('{n}', String(preview.clashes.length))}
                  </span>
                  <div className={css.choice}>
                    <Segmented<ImportChoice['assets']>
                      label={t('pack.clashes').replace('{n}', String(preview.clashes.length))}
                      value={choice.assets}
                      options={[
                        { value: 'local', label: t('pack.keepLocal') },
                        { value: 'package', label: t('pack.usePackage') },
                      ]}
                      onChange={(assets) => setChoice({ ...choice, assets })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </PackSection>

        {preview.assets.length > 0 && (
          <PackSection
            title={t('pack.sectionAssets')}
            note={
              <>
                {`${t('pack.to')} `}
                <code className={css.path}>{assetsDir}</code>
              </>
            }
            testId="wl-pack-assets"
          >
            {shownAssets.map((file) => (
              <PackRow
                key={file.path}
                icon="file"
                title={file.path}
                mono
                end={formatBytes(file.bytes)}
                {...(choice.mode === 'merge' && preview.clashes.includes(file.path)
                  ? {
                      metaTone: 'warn' as const,
                      meta: [
                        choice.assets === 'local' ? t('pack.keepLocal') : t('pack.usePackage'),
                      ],
                      dim: choice.assets === 'local',
                    }
                  : {})}
              />
            ))}
            {preview.assets.length > ASSET_PREVIEW && (
              <div className={css.row}>
                <span />
                <button
                  type="button"
                  className={css.sectionLink}
                  onClick={() => setAllAssets(!allAssets)}
                >
                  {allAssets
                    ? t('pack.hideFiles')
                    : t('pack.more').replace('{n}', String(preview.assets.length - ASSET_PREVIEW))}
                </button>
                <span />
              </div>
            )}
          </PackSection>
        )}

        {preview.skills.length > 0 && (
          <PackSection
            title={t('pack.sectionSkills')}
            note={
              <>
                {`${t('pack.to')} `}
                <code className={css.path}>{preview.skillsRoot}/</code>
              </>
            }
            testId="wl-pack-skills"
          >
            {preview.skills.map((skill) => {
              const action = actionOf(choice, skill)
              const choices = skillChoices(skill)
              const destination = skillDestination(preview, skill, action)
              const open = openSkill === skill.name
              return (
                <PackRow
                  key={skill.name}
                  icon={KIND_ICON.skill}
                  tone={
                    skill.state === 'different' ? 'warn' : action === 'skip' ? undefined : 'accent'
                  }
                  title={skill.name}
                  badge={
                    <span
                      className={hub.tag}
                      data-tone={skill.state === 'new' ? undefined : 'plain'}
                    >
                      {t(SKILL_STATE[skill.state])}
                    </span>
                  }
                  meta={[
                    skill.source,
                    `${t('pack.files').replace('{n}', String(skill.files.length))} · ${formatBytes(skill.bytes)}`,
                    skill.existing !== undefined ? (
                      <Fragment key="existing">
                        {`${t('pack.skill.existing')} `}
                        <code>{skill.existing}</code>
                      </Fragment>
                    ) : null,
                  ]}
                  end={
                    <button
                      type="button"
                      className={css.sectionLink}
                      onClick={() => setOpenSkill(open ? null : skill.name)}
                    >
                      {open ? t('pack.hideFiles') : t('pack.showFiles')}
                    </button>
                  }
                  testId={`wl-pack-skill-${skill.name}`}
                >
                  {choices.length > 1 && (
                    <div className={css.choice}>
                      <Segmented<PackSkillAction>
                        label={skill.name}
                        value={action}
                        testId={`wl-pack-skill-${skill.name}`}
                        options={choices.map((value) => ({
                          value,
                          label: t(actionLabel(value, skill.state === 'new')),
                        }))}
                        onChange={(next) =>
                          setChoice({ ...choice, skills: { ...choice.skills, [skill.name]: next } })
                        }
                      />
                    </div>
                  )}
                  <span
                    className={css.rowMeta}
                    data-tone={action === 'overwrite' ? 'warn' : undefined}
                  >
                    {destination !== null ? (
                      <span>
                        {action === 'rename'
                          ? t('pack.skill.renameAs').replace('{name}', skill.rename)
                          : `${t('pack.to')} `}
                        {action !== 'rename' && <code>{destination}/</code>}
                      </span>
                    ) : (
                      <span>
                        {skill.state === 'new'
                          ? t('pack.skill.notInstalled')
                          : t('pack.skill.skipped')}
                      </span>
                    )}
                  </span>
                  {open && (
                    <ul className={css.files}>
                      {skill.files.map((file) => (
                        <li key={file.path}>
                          <span>{file.path}</span>
                          <span>{formatBytes(file.bytes)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </PackRow>
              )
            })}
          </PackSection>
        )}

        {preview.external.length > 0 && (
          <PackSection title={t('pack.sectionExternal')} testId="wl-pack-external">
            {preview.external.map((entry) => (
              <PackRow
                key={`${entry.kind}\n${entry.value}`}
                icon={entry.kind === 'root' ? 'folder' : KIND_ICON[entry.kind]}
                tone={entry.found === false ? 'warn' : undefined}
                title={entry.value}
                mono={entry.kind !== 'skill'}
                meta={[t(`pack.why.${entry.why}` as LocaleKey)]}
                end={
                  entry.found === null ? (
                    <span className={hub.tag} data-tone="plain">
                      {t('pack.relative')}
                    </span>
                  ) : entry.found ? (
                    <span className={hub.tag}>
                      <Icon name="check" size={11} />
                      {t('pack.found')}
                    </span>
                  ) : (
                    <span className={hub.tag} data-tone="plain">
                      {t('pack.notFound')}
                    </span>
                  )
                }
              />
            ))}
          </PackSection>
        )}

        {needsTrust && (
          <label className={css.trust}>
            <Checkbox
              className={css.trustCheck}
              checked={trusted}
              data-testid="wl-pack-trust"
              onChange={(event) => setTrusted(event.currentTarget.checked)}
            />
            <span>{t('pack.trust').replace('{dir}', preview.skillsRoot)}</span>
          </label>
        )}
      </div>
      <div className={css.foot}>
        <div className={css.footInfo}>
          {t('pack.confirmDesc')
            .replace('{v}', String(summary.versions))
            .replace('{a}', String(summary.assets))
            .replace('{s}', String(summary.skills))}
        </div>
        <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onCancel}>
          {t('common.cancel')}
        </button>
        <button
          ref={confirm.anchorRef}
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          disabled={!ready}
          aria-expanded={confirm.open}
          data-testid="wl-pack-do-import"
          onClick={confirm.toggle}
        >
          <Icon name="upload" size={14} />
          {t('pack.doImport')}
        </button>
        {confirm.render({
          t,
          title: t('pack.confirmTitle').replace('{name}', target),
          desc:
            t('pack.confirmDesc')
              .replace('{v}', String(summary.versions))
              .replace('{a}', String(summary.assets))
              .replace('{s}', String(summary.skills)) +
            (summary.overwrite > 0
              ? ` ${t('pack.confirmOverwrite').replace('{n}', String(summary.overwrite))}`
              : ''),
          confirmText: t('pack.doImport'),
          danger: summary.overwrite > 0,
          testId: 'wl-pack-confirm',
          onConfirm: () => void props.onApply(choice),
        })}
      </div>
    </>
  )
}
