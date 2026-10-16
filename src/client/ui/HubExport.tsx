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

import { type ComponentProps, useEffect, useState } from 'react'
import type { PackScanItem, PackScanResponse } from '../../shared/pack.ts'
import type { ResourceKind, VersionEntry } from '../../shared/types.ts'
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
import { Presence, useResizeFlip } from './motion.tsx'
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
    <div className={cx(hub.wfDetail, hub.paneIn, css.page)} data-testid="wl-pack-export">
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
      <Presence show={error !== null}>
        {error !== null && <Callout tone="error">{error}</Callout>}
      </Presence>

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
            <div className={cx(css.scroll, ui.scrollFade)}>
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
                    badge={
                      entry.current ? <span className={hub.tag}>{t('ver.current')}</span> : null
                    }
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
            </div>
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

/** 第二步：资源清单。按资源种类分类，每类可以展开收起；能打包的几类在标题右端各有一个打包开关。 */
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
  // 展开、收起：下面的分类滑到新位置，像版本列表那样。
  const listRef = useResizeFlip()
  const effective = effectivePack(scan, packed, switches)
  const total = packedBytes(scan, effective)
  const over = total > scan.limit
  const left = leftAbsolute(scan, effective)
  /** 展开着的分类：缺省有东西的都展开；和开关无关。 */
  const [expanded, setExpanded] = useState<ReadonlySet<ResourceKind>>(
    () =>
      new Set([
        ...PACK_CATEGORIES.filter(
          (kind) =>
            categoryItems(scan, kind).packable.length + categoryItems(scan, kind).others.length > 0,
        ),
      ]),
  )
  const expand = (key: ResourceKind, open: boolean): void => {
    const next = new Set(expanded)
    if (open) next.add(key)
    else next.delete(key)
    setExpanded(next)
  }
  const used = (item: PackScanItem): string | null =>
    multi ? t('pack.inVersions').replace('{list}', versionList(item)) : null

  /** 能打包的一项：一行，勾选框 + 名字 + 来源小标，右端是体积；路径、包内位置放悬停提示。 */
  const packRow = (item: PackScanItem, enabled: boolean): React.JSX.Element => {
    const on = enabled && packed.has(item.key)
    const skipped =
      item.skipped !== undefined ? t('pack.skipped').replace('{n}', String(item.skipped)) : null
    const where = item.kind === 'skill' ? `skills/${item.value}/` : (item.as ?? '')
    return (
      <PackRow
        key={item.key}
        title={item.kind === 'skill' ? item.value : pathTitle(item.value)}
        mono={item.kind !== 'skill'}
        badge={
          item.source !== undefined ? (
            <span className={hub.tag} data-tone="plain">
              {item.source}
            </span>
          ) : null
        }
        meta={[skipped, used(item)]}
        end={sizeOf(t, item)}
        tip={[item.kind === 'skill' ? item.location : item.value, on ? `→ ${where}` : null]
          .filter((part) => part !== null && part !== '')
          .join('  ')}
        checked={packed.has(item.key)}
        disabled={!enabled}
        dim={!on}
        testId="wl-pack-item"
        onCheck={(next) => props.onToggle(item.key, next)}
      />
    )
  }
  /** 不能勾的：一行，最左一格是状态图标（原因在它的悬停提示里），后面只有名字。 */
  const infoRow = (item: PackScanItem): React.JSX.Element => {
    const blocked = item.state === 'missing' || item.state === 'tooLarge'
    const reason = t(`pack.state.${item.state}` as LocaleKey)
    const lead: ComponentProps<typeof PackRow>['lead'] = blocked
      ? { icon: 'alert', tone: 'warn', tip: reason }
      : { icon: 'info', tip: reason }
    return (
      <PackRow
        key={item.key}
        title={item.kind === 'text' ? textPreview(item.value) : pathTitle(item.value)}
        mono={item.kind === 'file' || item.kind === 'folder'}
        meta={[used(item)]}
        lead={lead}
        tip={item.value}
      />
    )
  }

  return (
    <>
      <p className={css.sectionHint}>{t('pack.resourcesHint')}</p>
      {PACK_CATEGORIES.every(
        (kind) =>
          categoryItems(scan, kind).packable.length + categoryItems(scan, kind).others.length === 0,
      ) && <Callout>{t('pack.nothing')}</Callout>}
      <div className={cx(css.scroll, ui.scrollFade)}>
        <div ref={listRef} className={css.cats}>
          {PACK_CATEGORIES.map((kind) => {
            const { packable, others } = categoryItems(scan, kind)
            const count = packable.length + others.length
            const on = isSwitchable(kind) && switches[kind]
            const picked = packable.filter((item) => packed.has(item.key)).length
            return (
              <Category
                key={kind}
                icon={KIND_ICON[kind]}
                title={t(KIND_LABEL[kind])}
                stats={
                  count === 0
                    ? t('pack.catEmpty')
                    : packable.length === 0
                      ? t('pack.catCount').replace('{n}', String(count))
                      : on
                        ? t('pack.catPicked')
                            .replace('{n}', String(count))
                            .replace('{m}', String(picked))
                        : t('pack.catNone').replace('{n}', String(count))
                }
                empty={count === 0}
                expanded={expanded.has(kind)}
                onExpand={(open) => expand(kind, open)}
                {...(isSwitchable(kind)
                  ? {
                      switch: {
                        on: on && packable.length > 0,
                        disabled: packable.length === 0,
                        onChange: (next: boolean) => props.onSwitch(kind, next),
                      },
                    }
                  : {})}
                testId={`wl-pack-cat-${kind}`}
              >
                {packable.map((item) => packRow(item, on))}
                {others.map(infoRow)}
              </Category>
            )
          })}
        </div>
      </div>
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

/** 路径当标题：文件名在前，所在目录淡一档跟在后面；不是路径（网址、skill 名）原样返回。 */
function pathTitle(value: string): React.ReactNode {
  const cut = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  if (cut <= 0 || cut === value.length - 1 || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
  return (
    <>
      {value.slice(cut + 1)} <span className={css.dir}>{value.slice(0, cut)}</span>
    </>
  )
}

/** 自定义文本当标题：第一行，太长截断。 */
function textPreview(value: string): string {
  const line = value.split('\n', 1)[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

/**
 * 一类资源。标题行左边是一个按钮「[›] [图标] 名称 统计」，点它展开 / 收起下面的清单；
 * 右端是这类的打包开关（只有 Skill、文件、文件夹有），开关只管打不打包，不管展开。
 * 这类一项都没有时也照样摆出来，写「无」，不能展开。
 */
function Category(props: {
  icon: IconName
  title: string
  stats: string
  empty: boolean
  expanded: boolean
  onExpand(open: boolean): void
  /** 不给 = 这类没有可打包的说法（网址、自定义、资料目录），不放开关。 */
  switch?: { on: boolean; disabled: boolean; onChange(on: boolean): void }
  children: React.ReactNode
  testId: string
}): React.JSX.Element {
  const open = props.expanded && !props.empty
  const lit = props.switch === undefined ? !props.empty : props.switch.on
  return (
    <section className={css.section} data-testid={props.testId}>
      <div className={css.catHead}>
        <button
          type="button"
          className={css.catToggle}
          aria-expanded={open}
          disabled={props.empty}
          data-testid={`${props.testId}-toggle`}
          onClick={() => props.onExpand(!props.expanded)}
        >
          <span className={css.catChevron} data-open={open}>
            <Icon name="chevronRight" size={14} />
          </span>
          <span className={css.catIcon} data-on={lit}>
            <Icon name={props.icon} size={14} />
          </span>
          <span className={css.catTitle}>{props.title}</span>
          <span className={css.catStats}>{props.stats}</span>
        </button>
        {props.switch !== undefined && (
          <button
            type="button"
            role="switch"
            aria-checked={props.switch.on}
            aria-label={props.title}
            className={cx(ui.switch, css.catSwitch)}
            disabled={props.switch.disabled}
            data-testid={`${props.testId}-switch`}
            onClick={() => props.switch?.onChange(!props.switch.on)}
          >
            <span className={ui.knob} />
          </button>
        )}
      </div>
      <Presence show={open}>
        <div className={css.catBody}>{props.children}</div>
      </Presence>
    </section>
  )
}
