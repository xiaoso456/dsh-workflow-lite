/**
 * dsh-workflow-lite — 导出成 skill 的第三步「Skill 信息」：SKILL.md 头部（名称、描述、使用时机）、
 * 要提醒的事、整个包的预览（左边文件树、右边预览，同实例里看文件夹），底下「装到本机」「下载 zip」。
 *
 * 进来先让主机按选好的版本和打包项编一遍（`pack/skillPreview`）：有编译级问题就只列问题、导不出来；
 * 正文和头部分开，头部按填的字现拼，改名字不用再编。同名 skill 已经在 `~/.agents/skills` 里时，
 * 「装到本机」先浮出确认卡问覆不覆盖。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubSkillInfo
 */

import { useEffect, useState } from 'react'
import {
  checkSkillMeta,
  SKILL_NAME_MAX,
  SKILL_TEXT_MAX,
  type SkillMeta,
  type SkillMetaProblem,
  type SkillPreviewResponse,
} from '../../shared/skillPack.ts'
import { downloadPack, saveFile } from '../app/packTransfer.ts'
import { skillPackSource } from '../app/useBrowse.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { formatBytes } from '../model/fileKind.ts'
import { descriptionDraft, existingSkill } from '../model/pack.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { useConfirm } from './Confirm.tsx'
import { DocViewer } from './DocViewer.tsx'
import { FolderBrowser } from './FolderBrowser.tsx'
import folder from './folder.module.css'
import type { PackScope } from './HubExport.tsx'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'
import overlay from './overlay.module.css'
import { Callout, PackSection } from './PackRow.tsx'
import css from './pack.module.css'
import { cx } from './primitives.tsx'
import resource from './resource.module.css'
import ui from './ui.module.css'

/** 头部填的字（上一步、下一步来回切时留着）。 */
export interface SkillDraft {
  meta: SkillMeta
  /** 描述用户动过：不再拿预填的那句盖掉。 */
  touched: boolean
}

const PROBLEM_TEXT: Record<string, LocaleKey> = {
  'name:empty': 'skillExport.nameEmpty',
  'name:format': 'skillExport.nameFormat',
  'name:long': 'skillExport.nameLong',
  'description:empty': 'skillExport.descEmpty',
  'description:long': 'skillExport.textLong',
  'whenToUse:long': 'skillExport.textLong',
}

function problemText(t: T, problem: SkillMetaProblem | null, field: string): string | null {
  if (problem === null || problem.field !== field) return null
  const key = PROBLEM_TEXT[`${problem.field}:${problem.problem}`]
  return key === undefined ? null : t(key)
}

export function HubSkillInfo(props: {
  t: T
  rpc: WorkflowLiteRpc
  /** 工作流名。 */
  name: string
  version: number
  pack: readonly string[]
  scope: PackScope
  draft: SkillDraft
  onDraft(next: SkillDraft): void
  /** 打包 / 安装中的那句进度；`null` = 忙完了（出错时由这里报）。 */
  onBusy(text: string | null): void
  onError(text: string | null): void
  onPrev(): void
  onDone(text: string): void
}): React.JSX.Element {
  const { t, rpc, name, version, draft } = props
  const [preview, setPreview] = useState<SkillPreviewResponse | null>(null)
  const [viewing, setViewing] = useState(false)
  const confirm = useConfirm<HTMLButtonElement>()
  const packKey = props.pack.join('\n')

  // 只在版本、打包项变了时重编（packKey 代表 pack；填头部不用重编）。
  useEffect(() => {
    let live = true
    setPreview(null)
    rpc
      .call('pack/skillPreview', { name, version, pack: [...props.pack], ...props.scope })
      .then((result) => {
        if (!live) return
        setPreview(result)
        if (!props.draft.touched && props.draft.meta.description === '') {
          props.onDraft({
            ...props.draft,
            meta: { ...props.draft.meta, description: descriptionDraft(t, name, result.steps) },
          })
        }
      })
      .catch((caught: unknown) => {
        if (!live) return
        props.onError(errorMessage(caught))
        props.onPrev()
      })
    return () => {
      live = false
    }
  }, [rpc, name, version, packKey])

  // 暂存的那份包：换了一份、离开这一步时清掉（没清掉的暂存区一天后自己清）。
  const browse = preview?.browse
  useEffect(() => {
    if (browse === undefined) return
    return () => {
      void rpc.call('pack/discard', { token: browse }).catch(() => undefined)
    }
  }, [rpc, browse])

  if (preview === null) {
    return (
      <div className={css.busy}>
        <span className={hub.spinner} />
        {t('skillExport.building')}
      </div>
    )
  }

  const meta = draft.meta
  const problem = checkSkillMeta(meta)
  const blocked = preview.problems.length > 0
  const existing = existingSkill(preview, meta.name)
  const set = (patch: Partial<SkillMeta>, touched = draft.touched): void =>
    props.onDraft({ meta: { ...meta, ...patch }, touched })

  const run = async (target: 'zip' | 'install', replace = false): Promise<void> => {
    props.onError(null)
    props.onBusy(t(target === 'zip' ? 'pack.packing' : 'skillExport.installing'))
    try {
      const out = await rpc.call('pack/skillExport', {
        name,
        version,
        pack: [...props.pack],
        meta: {
          name: meta.name,
          description: meta.description.trim(),
          ...(meta.whenToUse?.trim() ? { whenToUse: meta.whenToUse.trim() } : {}),
        },
        target,
        ...(replace ? { replace: true } : {}),
        ...props.scope,
      })
      if (target === 'install') {
        props.onDone(t('skillExport.installed').replace('{path}', out.path ?? ''))
        return
      }
      const bytes = await downloadPack(rpc, out.token ?? '', out.bytes, (done, total) =>
        props.onBusy(
          t('pack.downloading')
            .replace('{done}', formatBytes(done))
            .replace('{total}', formatBytes(total)),
        ),
      )
      const file = out.fileName ?? `${meta.name}.zip`
      saveFile(bytes, file)
      props.onDone(
        t('pack.exported').replace('{file}', file).replace('{size}', formatBytes(out.bytes)),
      )
    } catch (caught) {
      props.onError(errorMessage(caught))
      props.onBusy(null)
    }
  }

  const notes: { key: string; tone: 'warn' | undefined; text: string }[] = []
  if (preview.runState) notes.push({ key: 'run', tone: undefined, text: t('skillExport.runState') })
  if (preview.writtenAssets.length > 0) {
    notes.push({
      key: 'assets',
      tone: 'warn',
      text: t('skillExport.writtenAssets').replace('{list}', preview.writtenAssets.join('、')),
    })
  }
  if (preview.roots.length > 0) {
    notes.push({
      key: 'roots',
      tone: 'warn',
      text: t('skillExport.roots').replace('{list}', preview.roots.join('、')),
    })
  }
  if (preview.needs.length > 0) {
    notes.push({
      key: 'needs',
      tone: undefined,
      text: t('skillExport.needs').replace('{list}', preview.needs.join('、')),
    })
  }

  const nameError = problemText(t, problem, 'name')
  const descError = problemText(t, problem, 'description')
  const whenError = problemText(t, problem, 'whenToUse')
  const ready = !blocked && problem === null
  /** 包（目录）叫什么：还没填名字时先用工作流名。 */
  const packName = meta.name === '' ? name : meta.name
  const stat = t('skillExport.contentStat')
    .replace('{steps}', String(preview.steps.length))
    .replace('{files}', String(preview.files + 1))
    .replace('{size}', formatBytes(preview.bytes))

  return (
    <>
      <div className={cx(css.scroll, ui.scrollFade)} data-testid="wl-skill-info">
        {blocked ? (
          <Callout tone="error" testId="wl-skill-blocked">
            {t('skillExport.blocked')}
            {preview.problems.map((item) => (
              <span key={`${item.code}:${item.node ?? ''}:${item.message}`} className={css.line}>
                {item.message}
              </span>
            ))}
          </Callout>
        ) : (
          notes.map((note) => (
            <Callout key={note.key} tone={note.tone} testId={`wl-skill-note-${note.key}`}>
              {note.text}
            </Callout>
          ))
        )}

        <PackSection title={t('skillExport.sectionMeta')} testId="wl-skill-meta-form">
          <div className={css.field}>
            <label className={css.fieldRow}>
              <span className={hub.wfSub}>{t('skillExport.name')}</span>
              <input
                className={ui.input}
                value={meta.name}
                maxLength={SKILL_NAME_MAX}
                spellCheck={false}
                placeholder="my-workflow"
                aria-invalid={nameError !== null}
                data-testid="wl-skill-name"
                onChange={(event) => set({ name: event.currentTarget.value.trim() })}
              />
            </label>
            {nameError !== null ? (
              <span className={css.fieldError}>{nameError}</span>
            ) : existing !== undefined ? (
              <span className={css.fieldWarn} data-testid="wl-skill-name-taken">
                {existing.path === undefined
                  ? t('skillExport.nameTakenBuiltin').replace('{name}', meta.name)
                  : t('skillExport.nameTaken')
                      .replace('{name}', meta.name)
                      .replace('{where}', existing.path)}
              </span>
            ) : (
              <span className={css.fieldHint}>{t('skillExport.nameHint')}</span>
            )}
          </div>
          <div className={css.field}>
            <span className={hub.wfSub}>{t('skillExport.description')}</span>
            <textarea
              className={cx(ui.textarea, css.fieldArea)}
              value={meta.description}
              maxLength={SKILL_TEXT_MAX}
              rows={3}
              aria-invalid={descError !== null}
              data-testid="wl-skill-desc"
              onChange={(event) => set({ description: event.currentTarget.value }, true)}
            />
            {descError !== null ? (
              <span className={css.fieldError}>{descError}</span>
            ) : (
              <span className={css.fieldHint}>{t('skillExport.descHint')}</span>
            )}
          </div>
          <div className={css.field}>
            <span className={hub.wfSub}>{t('skillExport.whenToUse')}</span>
            <textarea
              className={cx(ui.textarea, css.fieldArea)}
              value={meta.whenToUse ?? ''}
              maxLength={SKILL_TEXT_MAX}
              rows={2}
              placeholder={t('skillExport.whenHint')}
              data-testid="wl-skill-when"
              onChange={(event) => set({ whenToUse: event.currentTarget.value })}
            />
            {whenError !== null && <span className={css.fieldError}>{whenError}</span>}
          </div>
        </PackSection>

        {!blocked && (
          <PackSection title={t('skillExport.sectionContent')} testId="wl-skill-content">
            <div className={css.field}>
              <div className={css.fieldRow}>
                <span className={css.grow}>
                  <code>{packName}/</code>
                  <span className={hub.wfSub}>
                    {' · '}
                    {stat}
                  </span>
                </span>
                <button
                  type="button"
                  className={cx(ui.btn, ui.small)}
                  disabled={preview.browse === undefined}
                  data-testid="wl-skill-preview"
                  onClick={() => setViewing(true)}
                >
                  <Icon name="eye" size={14} />
                  {t('skillExport.preview')}
                </button>
              </div>
            </div>
          </PackSection>
        )}
      </div>
      <div className={css.foot}>
        <div className={css.footInfo}>
          {t('skillExport.installTip').replace('{root}', preview.skillsRoot)}
        </div>
        <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onPrev}>
          <Icon name="chevronLeft" size={14} />
          {t('pack.prev')}
        </button>
        <button
          ref={confirm.anchorRef}
          type="button"
          className={cx(ui.btn, ui.small)}
          disabled={!ready}
          data-testid="wl-skill-install"
          onClick={() => {
            if (existing?.overwritable === true) confirm.toggle()
            else void run('install')
          }}
        >
          <Icon name="sparkle" size={14} />
          {t('skillExport.install')}
        </button>
        {confirm.render({
          t,
          title: t('skillExport.overwriteTitle').replace('{name}', meta.name),
          desc: t('skillExport.overwriteDesc').replace('{path}', existing?.path ?? ''),
          confirmText: t('skillExport.overwrite'),
          testId: 'wl-skill-overwrite',
          onConfirm: () => void run('install', true),
        })}
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          disabled={!ready}
          data-testid="wl-skill-download"
          onClick={() => void run('zip')}
        >
          <Icon name="download" size={14} />
          {t('skillExport.download')}
        </button>
      </div>
      {viewing && preview.browse !== undefined && (
        <DocViewer
          t={t}
          name={packName}
          badge={
            <span className={cx(overlay.sheetIcon, resource.skillHeadIcon)}>
              <Icon name="sparkle" size={16} />
            </span>
          }
          meta={stat}
          body={{
            kind: 'node',
            node: (
              <FolderBrowser
                t={t}
                source={skillPackSource(rpc, preview.browse, meta)}
                rootName={packName}
                initial="SKILL.md"
                desktop={undefined}
              />
            ),
          }}
          copyPath={null}
          openPath={null}
          desktop={undefined}
          testId="wl-skill-doc"
          className={folder.dialog}
          onClose={() => setViewing(false)}
        />
      )}
    </>
  )
}
