/**
 * dsh-workflow-lite — 工作流中心「工作流」页右栏：导出一个工作流。
 *
 * 两步：① 选版本（只导出存成了版本的内容；现在的内容没存成版本就提醒一句，不自动存）；
 * ② 资源清单：按资源种类分类（Skill、文件、文件夹、网址、自定义、资料目录）。能打包的几类在分类标题右端
 * 各有一个开关，开着才列出逐项的勾选（能打包的缺省勾上）和其余各项不打包的原因；资料目录总是整个带上。
 * 点「导出」主机打好 zip，前端一块块取回来交给浏览器下载。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubExport
 */

import { Fragment, useEffect, useId, useState } from 'react'
import type { PackScanItem, PackScanResponse } from '../../shared/pack.ts'
import type { VersionEntry } from '../../shared/types.ts'
import { downloadPack, saveFile } from '../app/packTransfer.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { formatBytes } from '../model/fileKind.ts'
import {
  categoryItems,
  defaultVersions,
  effectivePack,
  isSwitchable,
  leftAbsolute,
  PACK_CATEGORIES,
  type PackSwitch,
  type PackSwitches,
  packedBytes,
} from '../model/pack.ts'
import { shortTime } from '../model/time.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import hub from './hub.module.css'
import { Icon, type IconName } from './Icon.tsx'
import { Callout, PackRow, PackSection, PackSteps } from './PackRow.tsx'
import css from './pack.module.css'
import { cx } from './primitives.tsx'
import { KIND_ICON, KIND_LABEL } from './resourceUi.ts'
import ui from './ui.module.css'

export interface PackScope {
  cwd?: string
  session?: string
}

export function HubExport(props: {
  t: T
  rpc: WorkflowLiteRpc
  name: string
  scope: PackScope
  onBack(): void
  /** 导出完了：回版本页，带一句结果。 */
  onDone(text: string): void
}): React.JSX.Element {
  const { t, rpc, name } = props
  const [step, setStep] = useState<0 | 1>(0)
  const [list, setList] = useState<VersionEntry[] | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const [scan, setScan] = useState<PackScanResponse | null>(null)
  const [packed, setPacked] = useState<ReadonlySet<string>>(new Set())
  /** 能打包的几类各一个开关：关着的那类整个不打包，下面的逐项勾选也收起来。 */
  const [switches, setSwitches] = useState<PackSwitches>({
    skill: true,
    file: true,
    folder: true,
  })
  const [error, setError] = useState<string | null>(null)
  /** 打包 / 下载中的那句进度；`null` = 没在忙。 */
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    rpc
      .call('graph/versions', { name })
      .then(({ versions }) => {
        if (!live) return
        setList(versions)
        setPicked(new Set(defaultVersions(versions)))
      })
      .catch((caught: unknown) => {
        if (!live) return
        setList([])
        setError(errorMessage(caught))
      })
    return () => {
      live = false
    }
  }, [rpc, name])

  const toResources = (): void => {
    setStep(1)
    setScan(null)
    setError(null)
    rpc
      .call('pack/scan', { name, versions: [...picked], ...props.scope })
      .then((result) => {
        setScan(result)
        setPacked(
          new Set(result.items.filter((item) => item.state === 'pack').map((item) => item.key)),
        )
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught))
        setStep(0)
      })
  }

  const doExport = async (): Promise<void> => {
    setError(null)
    setBusy(t('pack.packing'))
    try {
      const out = await rpc.call('pack/export', {
        name,
        versions: [...picked],
        pack: [...(scan === null ? [] : effectivePack(scan, packed, switches))],
        ...props.scope,
      })
      const bytes = await downloadPack(rpc, out.token, out.bytes, (done, total) =>
        setBusy(
          t('pack.downloading')
            .replace('{done}', formatBytes(done))
            .replace('{total}', formatBytes(total)),
        ),
      )
      saveFile(bytes, out.fileName)
      props.onDone(
        t('pack.exported')
          .replace('{file}', out.fileName)
          .replace('{size}', formatBytes(out.bytes)),
      )
    } catch (caught) {
      setError(errorMessage(caught))
      setBusy(null)
    }
  }

  const usable = (list ?? []).filter((entry) => entry.invalid !== true)
  const unsaved = list !== null && list.length > 0 && !list.some((entry) => entry.current)
  const multi = picked.size > 1

  return (
    <div className={cx(hub.wfDetail, hub.paneIn)} data-testid="wl-pack-export">
      <div className={hub.wfHead}>
        <div className={hub.wfHeadText}>
          <p className={hub.wfTitle}>{t('pack.exportTitle').replace('{name}', name)}</p>
          <p className={hub.wfSub}>{t('pack.versionsHint')}</p>
        </div>
        <button
          type="button"
          className={cx(ui.btn, ui.small)}
          disabled={busy !== null}
          data-testid="wl-pack-back"
          onClick={props.onBack}
        >
          <Icon name="chevronLeft" size={14} />
          {t('pack.back')}
        </button>
      </div>
      <PackSteps steps={[t('pack.stepVersions'), t('pack.stepResources')]} at={step} />
      {error !== null && <Callout tone="error">{error}</Callout>}

      {busy !== null ? (
        <div className={css.busy} data-testid="wl-pack-busy">
          <span className={hub.spinner} />
          {busy}
        </div>
      ) : step === 0 ? (
        list === null ? (
          <div className={css.busy}>
            <span className={hub.spinner} />
            {t('hub.loading')}
          </div>
        ) : usable.length === 0 ? (
          <div className={hub.empty}>
            <span className={hub.emptyIcon}>
              <Icon name="history" size={20} />
            </span>
            <p className={hub.emptyTitle}>{t('pack.noVersions')}</p>
            <p className={hub.emptyText}>{t('pack.noVersionsText')}</p>
          </div>
        ) : (
          <>
            {unsaved && (
              <Callout tone="warn" testId="wl-pack-unsaved">
                {t('pack.unsaved')}
              </Callout>
            )}
            <PackSection
              title={t('pack.stepVersions')}
              note={t('pack.picked').replace('{n}', String(picked.size))}
              action={{
                label: picked.size === usable.length ? t('pack.selectNone') : t('pack.selectAll'),
                onClick: () =>
                  setPicked(
                    picked.size === usable.length
                      ? new Set()
                      : new Set(usable.map((entry) => entry.n)),
                  ),
              }}
            >
              {usable.map((entry) => (
                <PackRow
                  key={entry.n}
                  icon="bookmark"
                  tone={entry.current ? 'accent' : undefined}
                  title={
                    <>
                      v{entry.n}
                      <span className={hub.wfSub}>
                        {' '}
                        {entry.note !== ''
                          ? entry.note
                          : entry.autoBefore !== undefined
                            ? t('ver.autoNote').replace('{n}', String(entry.autoBefore))
                            : t('ver.noNote')}
                      </span>
                    </>
                  }
                  badge={entry.current ? <span className={hub.tag}>{t('ver.current')}</span> : null}
                  meta={[
                    shortTime(entry.createdAt),
                    t('ver.steps').replace('{n}', String(entry.nodeCount)),
                  ]}
                  checked={picked.has(entry.n)}
                  dim={!picked.has(entry.n)}
                  testId={`wl-pack-ver-${entry.n}`}
                  onCheck={(on) => {
                    const next = new Set(picked)
                    if (on) next.add(entry.n)
                    else next.delete(entry.n)
                    setPicked(next)
                  }}
                />
              ))}
            </PackSection>
            <div className={css.foot}>
              <div className={css.footInfo}>
                {picked.size === 0
                  ? t('pack.pickOne')
                  : t('pack.picked').replace('{n}', String(picked.size))}
              </div>
              <button
                type="button"
                className={cx(ui.btn, ui.small, ui.primary)}
                disabled={picked.size === 0}
                data-testid="wl-pack-next"
                onClick={toResources}
              >
                {t('pack.next')}
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
          </>
        )
      ) : scan === null ? (
        <div className={css.busy}>
          <span className={hub.spinner} />
          {t('pack.scanning')}
        </div>
      ) : (
        <Resources
          t={t}
          scan={scan}
          packed={packed}
          switches={switches}
          multi={multi}
          onSwitch={(kind, on) => setSwitches({ ...switches, [kind]: on })}
          onToggle={(key, on) => {
            const next = new Set(packed)
            if (on) next.add(key)
            else next.delete(key)
            setPacked(next)
          }}
          onPrev={() => setStep(0)}
          onExport={() => void doExport()}
        />
      )}
    </div>
  )
}

function versionList(item: PackScanItem): string {
  return item.versions.map((n) => `v${n}`).join('、')
}

function sizeOf(t: T, item: PackScanItem): string | null {
  if (item.bytes === undefined) return null
  const files = item.files ?? 0
  return item.kind === 'file'
    ? formatBytes(item.bytes)
    : `${t('pack.files').replace('{n}', String(files))} · ${formatBytes(item.bytes)}`
}

/** 第二步：资源清单。按资源种类分类，能打包的几类在分类标题右端各有一个开关，开着才列出逐项的勾选。 */
function Resources(props: {
  t: T
  scan: PackScanResponse
  packed: ReadonlySet<string>
  switches: PackSwitches
  multi: boolean
  onToggle(key: string, on: boolean): void
  onSwitch(kind: PackSwitch, on: boolean): void
  onPrev(): void
  onExport(): void
}): React.JSX.Element {
  const { t, scan, packed, switches, multi } = props
  const effective = effectivePack(scan, packed, switches)
  const total = packedBytes(scan, effective)
  const over = total > scan.limit
  const left = leftAbsolute(scan, effective)
  const used = (item: PackScanItem): string | null =>
    multi ? t('pack.inVersions').replace('{list}', versionList(item)) : null

  const packRow = (item: PackScanItem): React.JSX.Element => {
    const on = packed.has(item.key)
    return (
      <PackRow
        key={item.key}
        icon={KIND_ICON[item.kind]}
        tone={on ? 'accent' : undefined}
        title={item.value}
        mono={item.kind !== 'skill'}
        badge={
          item.source !== undefined ? (
            <span className={hub.tag} data-tone="plain">
              {item.source}
            </span>
          ) : null
        }
        meta={[
          item.kind === 'skill' ? <code key="location">{item.location}</code> : null,
          sizeOf(t, item),
          item.skipped !== undefined
            ? t('pack.skipped').replace('{n}', String(item.skipped))
            : null,
          on ? (
            item.kind === 'skill' ? (
              t('pack.skillAs').replace('{name}', item.value)
            ) : (
              <Fragment key="as">
                {t('pack.as')} <code>{item.as}</code>
              </Fragment>
            )
          ) : (
            t('pack.groupKept')
          ),
          used(item),
        ]}
        checked={on}
        dim={!on}
        testId="wl-pack-item"
        onCheck={(next) => props.onToggle(item.key, next)}
      />
    )
  }
  /** 不能勾的：只说明原因（找不到、太大、内置、相对路径、产出、已在资料目录、原样保留）。 */
  const infoRow = (item: PackScanItem): React.JSX.Element => {
    const blocked = item.state === 'missing' || item.state === 'tooLarge'
    return (
      <PackRow
        key={item.key}
        icon={KIND_ICON[item.kind]}
        tone={blocked ? 'warn' : undefined}
        title={item.kind === 'text' ? textPreview(item.value) : item.value}
        mono={item.kind === 'file' || item.kind === 'folder'}
        metaTone={blocked ? 'warn' : undefined}
        meta={[
          t(`pack.state.${item.state}` as LocaleKey),
          blocked ? sizeOf(t, item) : null,
          used(item),
        ]}
      />
    )
  }

  return (
    <>
      {scan.items.length === 0 && scan.assets === null && <Callout>{t('pack.nothing')}</Callout>}
      {PACK_CATEGORIES.map((kind) => {
        const { packable, others } = categoryItems(scan, kind)
        const roots = kind === 'folder' ? scan.roots : []
        const count = packable.length + others.length + roots.length
        if (count === 0) return null
        const switchable = isSwitchable(kind) && packable.length > 0
        const on = !switchable || switches[kind as PackSwitch]
        const picked = packable.filter((item) => packed.has(item.key)).length
        return (
          <Category
            key={kind}
            icon={KIND_ICON[kind]}
            title={t(KIND_LABEL[kind])}
            stats={
              !switchable
                ? t('pack.catCount').replace('{n}', String(count))
                : on
                  ? t('pack.catPicked').replace('{n}', String(count)).replace('{m}', String(picked))
                  : t('pack.catNone').replace('{n}', String(count))
            }
            on={on}
            onSwitch={switchable ? (next) => props.onSwitch(kind as PackSwitch, next) : undefined}
            testId={`wl-pack-cat-${kind}`}
          >
            {packable.map(packRow)}
            {others.map(infoRow)}
            {roots.map((root) => (
              <PackRow key={root} icon="folder" title={root} mono meta={[t('pack.root')]} />
            ))}
          </Category>
        )
      })}
      {scan.assets !== null && (
        <Category
          icon="folderOpen"
          title={t('pack.groupAssets')}
          stats={`${t('pack.files').replace('{n}', String(scan.assets.files))} · ${formatBytes(scan.assets.bytes)}`}
          on
          testId="wl-pack-cat-assets"
        >
          <PackRow
            icon="folderOpen"
            tone="accent"
            title={scan.assets.location}
            mono
            meta={[t('pack.groupAssetsHint')]}
          />
        </Category>
      )}
      <div className={css.foot}>
        <div className={css.footInfo} data-tone={over ? 'error' : left > 0 ? 'warn' : undefined}>
          <span data-testid="wl-pack-total">
            {t('pack.total').replace('{size}', formatBytes(total))}
          </span>
          {over ? (
            <span>{t('pack.limit').replace('{size}', formatBytes(scan.limit))}</span>
          ) : (
            left > 0 && <span>{t('pack.leftAbsolute').replace('{n}', String(left))}</span>
          )}
        </div>
        <button type="button" className={cx(ui.btn, ui.small)} onClick={props.onPrev}>
          <Icon name="chevronLeft" size={14} />
          {t('pack.prev')}
        </button>
        <button
          type="button"
          className={cx(ui.btn, ui.small, ui.primary)}
          disabled={over}
          data-testid="wl-pack-do-export"
          onClick={props.onExport}
        >
          <Icon name="download" size={14} />
          {t('pack.doExport')}
        </button>
      </div>
    </>
  )
}

/** 自定义文本当标题：第一行，太长截断。 */
function textPreview(value: string): string {
  const line = value.split('\n', 1)[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

/**
 * 一类资源：标题行是「[图标] 名称 统计 …… [开关]」，开关和分类名在同一行；
 * 开着（或这类不需要开关）才在下面的圆角框里列出各项。
 */
function Category(props: {
  icon: IconName
  title: string
  stats: string
  on: boolean
  /** 不给 = 这类没有可选的，不放开关。 */
  onSwitch?: (on: boolean) => void
  children: React.ReactNode
  testId: string
}): React.JSX.Element {
  const id = useId()
  const switchable = props.onSwitch !== undefined
  const head = (
    <>
      <span className={css.catIcon} data-on={props.on}>
        <Icon name={props.icon} size={14} />
      </span>
      <span className={css.catTitle}>{props.title}</span>
      <span className={css.catStats}>{props.stats}</span>
    </>
  )
  return (
    <section className={css.section} data-testid={props.testId}>
      {switchable ? (
        <label className={css.catHead} htmlFor={id} data-switch="true">
          {head}
          <button
            id={id}
            type="button"
            role="switch"
            aria-checked={props.on}
            aria-label={props.title}
            className={cx(ui.switch, css.catSwitch)}
            data-testid={`${props.testId}-switch`}
            onClick={() => props.onSwitch?.(!props.on)}
          >
            <span className={ui.knob} />
          </button>
        </label>
      ) : (
        <div className={css.catHead}>{head}</div>
      )}
      {props.on && <div className={cx(hub.box, ui.rise)}>{props.children}</div>}
    </section>
  )
}
