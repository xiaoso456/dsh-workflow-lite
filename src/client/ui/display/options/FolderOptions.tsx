/**
 * dsh-workflow-lite — 「内容」一组里文件夹的那几项。
 * 排法、张数（自动或固定几列几行）、顺序、最新一张放大。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/options/FolderOptions
 */

import { galleryGrid } from '../../../../shared/display.ts'
import {
  type FolderShow,
  GALLERY_GRID_MAX,
  type GalleryLayoutKind,
  type GalleryView,
  type ViewFit,
} from '../../../../shared/types.ts'
import { useFolderFacts } from '../../../app/cardFacts.ts'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import css from '../display.module.css'
import { GridPicker } from './GridPicker.tsx'
import { MatchField } from './MatchField.tsx'
import { OptSwitch, SegLine } from './optionParts.tsx'

type FolderShowChoice = FolderShow | 'auto'
type FolderOrder = NonNullable<GalleryView['order']> | 'newest'

/**
 * 文件夹的那几项。先挑「展示」：自动（有图片就排成图片墙，没有就列文件；下面一句说现在是哪种）、图片墙、文件列表；
 * 下面只出这一种用得上的：
 * - 图片墙：排法（图墙 / 大图 + 胶片 / 最新一张）、图墙的张数（自动或固定几列几行）、每格怎么摆、第一张放大；
 * - 文件列表：一行一项还是格子、带不带修改时间。
 * 两种都有的：只看（按名字筛）、顺序（最新 / 名字 / 大小）。
 * 张数从「自动」换到「固定」时，先定在现在自动排出来的那个格子上（看到的不跳）。
 */
export function FolderOptions(props: {
  t: T
  display: Display
  value: GalleryView
  headKey: string
  onChange(gallery: GalleryView | undefined): void
  onFit(fit: ViewFit | undefined): void
}): React.JSX.Element {
  const { t, value, display } = props
  const facts = useFolderFacts(props.headKey)
  const set = (patch: Partial<GalleryView>): void => {
    const next: GalleryView = { ...value, ...patch }
    for (const key of Object.keys(patch) as (keyof GalleryView)[]) {
      if (patch[key] === undefined) delete next[key]
    }
    props.onChange(Object.keys(next).length === 0 ? undefined : next)
  }
  const shows =
    value.show ?? (facts === null || facts.images > 0 ? ('images' as const) : ('files' as const))
  const layout = value.layout ?? 'wall'
  const { grid: _fixed, ...rest } = value
  const auto = galleryGrid(display.width, display.height, rest)
  const autoNote =
    facts === null
      ? t('display.showAutoTip')
      : facts.images > 0
        ? t('display.showAutoImages').replace('{n}', facts.images.toLocaleString())
        : t('display.showAutoFiles').replace('{n}', facts.entries.toLocaleString())
  return (
    <>
      <SegLine<FolderShowChoice>
        label={t('display.show')}
        value={value.show ?? 'auto'}
        options={[
          { value: 'auto', label: t('display.show.auto') },
          { value: 'images', label: t('display.show.images') },
          { value: 'files', label: t('display.show.files') },
        ]}
        testId="wl-display-show"
        onChange={(show) => set({ show: show === 'auto' ? undefined : show })}
      />
      {value.show === undefined && (
        <div className={css.optIndent}>
          <span className={css.optNote} data-testid="wl-display-show-note">
            {autoNote}
          </span>
        </div>
      )}
      <MatchField t={t} value={value.match} onChange={(match) => set({ match })} />
      {shows === 'images' ? (
        <>
          <SegLine<GalleryLayoutKind>
            label={t('display.layout')}
            value={layout}
            options={(['wall', 'strip', 'single'] as const).map((kind) => ({
              value: kind,
              label: t(`display.layout.${kind}`),
            }))}
            testId="wl-display-layout"
            onChange={(next) => set({ layout: next === 'wall' ? undefined : next })}
          />
          {layout === 'wall' && (
            <>
              <SegLine<'auto' | 'fixed'>
                label={t('display.count')}
                tip={t('display.countTip')}
                value={value.grid === undefined ? 'auto' : 'fixed'}
                options={[
                  { value: 'auto', label: t('display.count.auto') },
                  { value: 'fixed', label: t('display.count.fixed') },
                ]}
                testId="wl-display-count"
                onChange={(mode) =>
                  set({
                    grid:
                      mode === 'auto'
                        ? undefined
                        : {
                            columns: Math.min(GALLERY_GRID_MAX.columns, auto.columns),
                            rows: Math.min(GALLERY_GRID_MAX.rows, auto.rows),
                          },
                  })
                }
              />
              <div className={css.optIndent}>
                {value.grid === undefined ? (
                  <span className={css.optNote}>
                    {t('display.countAuto').replace('{n}', String(auto.slots))}
                  </span>
                ) : (
                  <GridPicker
                    t={t}
                    value={value.grid}
                    hero={value.hero !== false}
                    onChange={(grid) => set({ grid })}
                  />
                )}
              </div>
            </>
          )}
          <SegLine<'contain' | 'cover'>
            label={t('display.fit')}
            value={display.fit === 'contain' ? 'contain' : 'cover'}
            options={[
              { value: 'contain', label: t('display.fit.contain') },
              { value: 'cover', label: t('display.fit.cover') },
            ]}
            testId="wl-display-fit"
            onChange={(fit) => props.onFit(fit === 'cover' ? undefined : fit)}
          />
        </>
      ) : (
        <SegLine<'rows' | 'grid'>
          label={t('display.layout')}
          value={value.list === 'grid' ? 'grid' : 'rows'}
          options={[
            { value: 'rows', label: t('display.list.rows') },
            { value: 'grid', label: t('display.list.grid') },
          ]}
          testId="wl-display-list"
          onChange={(list) => set({ list: list === 'grid' ? 'grid' : undefined })}
        />
      )}
      <SegLine<FolderOrder>
        label={t('display.order')}
        value={value.order ?? 'newest'}
        options={[
          { value: 'newest', label: t('display.order.newest') },
          { value: 'name', label: t('display.order.name') },
          { value: 'size', label: t('display.order.size') },
        ]}
        testId="wl-display-order"
        onChange={(order) => set({ order: order === 'newest' ? undefined : order })}
      />
      {shows === 'images' && layout === 'wall' && (
        <OptSwitch
          on={value.hero !== false}
          label={t('display.hero')}
          tip={t('display.heroTip')}
          testId="wl-display-hero"
          onToggle={() => set({ hero: value.hero === false ? undefined : false })}
        />
      )}
      {shows === 'files' && (
        <OptSwitch
          on={value.time === true}
          label={t('display.time')}
          testId="wl-display-time"
          onToggle={() => set({ time: value.time === true ? undefined : true })}
        />
      )}
    </>
  )
}
