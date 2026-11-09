/**
 * dsh-workflow-lite — 展示区里文件夹的图片墙：最新一张占大格，图少时按张数重排，没有图时列出文件。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/GalleryView
 */

import { useEffect, useMemo, useState } from 'react'
import { GALLERY_GAP, galleryLayout, galleryTracks } from '../../../../shared/display.ts'
import type { RunDirEntry, RunDirResponse } from '../../../../shared/wire/run.ts'
import { publishFolderFacts } from '../../../app/cardFacts.ts'
import { readCache } from '../../../app/readCache.ts'
import { displayKey } from '../../../app/useDisplayStats.ts'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import { fileKindOf } from '../../../model/fileKind.ts'
import { folderOrder, nameMatcher } from '../../../model/folderView.ts'
import { errorMessage, type WorkflowLiteRpc } from '../../../rpc.ts'
import { Icon } from '../../kit/Icon.tsx'
import css from '../display.module.css'
import type { DisplayEnv } from '../displayEnv.ts'
import { DisplayState } from './DisplayState.tsx'
import { FolderList } from './FolderList.tsx'
import { useMarks } from './follow.ts'

/** 图墙里读过的图：按「实例 | 资源#项 / 文件名」和修改时间记着，文件没改就不重读（base64 的，按字符数封顶）。 */
const tiles = readCache<string>({ entries: 48, budget: 24_000_000, weigh: (url) => url.length })

/** 列出来的文件夹：按文件夹的修改时间记，展示卡被摘下再挂回来（大图平移）时直接用。 */
const listings = readCache<RunDirResponse>({ entries: 32 })

/**
 * 图墙露出来的那几张：名字 → 图（`null` = 读不出来）。一张改了，新的读回来之前旧的那张留着；不再露出的扔掉。
 */
function useGalleryImages(
  rpc: WorkflowLiteRpc,
  instance: string,
  node: string,
  item: number,
  entries: readonly RunDirEntry[],
): Readonly<Record<string, string | null>> {
  const keyOf = (entry: RunDirEntry): string => `${instance}|${node}#${item}/${entry.name}`
  const [urls, setUrls] = useState<Record<string, string | null>>(() => {
    const kept: Record<string, string | null> = {}
    for (const entry of entries) {
      const hit = tiles.get(keyOf(entry), entry.mtime)
      if (hit !== undefined) kept[entry.name] = hit
    }
    return kept
  })
  const want = entries.map((entry) => `${entry.name}@${entry.mtime}`).join('\n')
  // `want` 就是 `entries` 的身份：内容没变不重来。
  useEffect(() => {
    let alive = true
    setUrls((last) => {
      const next: Record<string, string | null> = {}
      for (const entry of entries) {
        const hit = tiles.get(keyOf(entry), entry.mtime) ?? last[entry.name]
        if (hit !== undefined) next[entry.name] = hit
      }
      return next
    })
    for (const entry of entries) {
      const key = keyOf(entry)
      if (tiles.get(key, entry.mtime) !== undefined) continue
      rpc
        .call('run/image', { id: instance, node, item, sub: entry.name })
        .then(({ mime, data }) => {
          const url = `data:${mime};base64,${data}`
          tiles.put(key, entry.mtime, url)
          if (alive) setUrls((last) => ({ ...last, [entry.name]: url }))
        })
        .catch(() => {
          if (alive) setUrls((last) => ({ ...last, [entry.name]: null }))
        })
    }
    return () => {
      alive = false
    }
  }, [rpc, instance, node, item, want])
  return urls
}

/** 图墙的这一份和上一份比：新加的、改过的那几张（按现在的排序，第几张）。第一次列出来不标。 */
function newTiles(before: string | null, after: string | null): ReadonlySet<number> {
  const marked = new Set<number>()
  if (before === null || after === null) return marked
  const seen = new Set(before.split('\n'))
  after.split('\n').forEach((key, index) => {
    if (key !== '' && !seen.has(key)) marked.add(index)
  })
  return marked
}

/**
 * 文件夹排成图墙：里面的图从新到旧，最新的一张占左上角的大格（格子够多时），露不下的写在最后一格「+N」里。
 * 图少时按张数重排，最后一行摊开占满、不留空格（见 `galleryLayout`）。每格按「摆放方式」铺满或完整放进去；进了交互点一格打开文件夹、
 * 直接看那一张。新加、改过的那几张描一圈亮边再淡下去。文件夹里没有图时列出里面的文件。
 */
export function GalleryView(props: {
  t: T
  run: NonNullable<DisplayEnv['run']>
  node: string
  display: Display
  interactive: boolean
  /** 文件夹变了（修改时间）就重列。 */
  signal: number
  /** 点一格：打开文件夹看这一张。 */
  onOpen?: ((sub: string) => void) | undefined
}): React.JSX.Element {
  const { t, run, node, display } = props
  const listKey = `${run.instance}|${node}#${display.item}`
  const [listing, setListing] = useState<{ dir: RunDirResponse | null; error: string | null }>(
    () => ({ dir: listings.get(listKey, props.signal) ?? null, error: null }),
  )
  useEffect(() => {
    const hit = listings.get(listKey, props.signal)
    if (hit !== undefined) {
      setListing((last) => (last.dir === hit ? last : { dir: hit, error: null }))
      return
    }
    let alive = true
    run.rpc
      .call('run/dir', { id: run.instance, node, item: display.item })
      .then((dir) => {
        listings.put(listKey, props.signal, dir)
        if (alive) setListing({ dir, error: null })
      })
      .catch((reason: unknown) => {
        if (alive) setListing((last) => ({ dir: last.dir, error: errorMessage(reason) }))
      })
    return () => {
      alive = false
    }
  }, [run.rpc, run.instance, node, display.item, props.signal])
  const dir = listing.dir
  const view = display.gallery
  // 「只看」先筛，图片墙、文件列表都只排筛剩下的。
  const entries = useMemo(() => {
    const keep = nameMatcher(view.match)
    return (dir?.entries ?? []).filter((entry) => keep(entry.name))
  }, [dir, view.match])
  const images = useMemo(
    () =>
      entries
        .filter((entry) => !entry.dir && fileKindOf(entry.name) === 'image')
        .sort(folderOrder(view.order)),
    [entries, view.order],
  )
  // 有几张图、几项交给设置浮层（「自动」现在是哪种）。
  const factsKey = displayKey(node, display.item)
  useEffect(() => {
    if (dir !== null) {
      publishFolderFacts(factsKey, { images: images.length, entries: entries.length })
    }
  }, [dir, factsKey, images.length, entries.length])
  const asImages = (view.show ?? 'images') === 'images' && images.length > 0
  const layout = galleryLayout(display.width, display.height, images.length, view)
  const tracks = galleryTracks(layout)
  const single = layout.slots === 1
  // 列文件时一张图都不读。
  const shown = asImages ? images.slice(0, layout.slots) : []
  const urls = useGalleryImages(run.rpc, run.instance, node, display.item, shown)
  const marks = useMarks(
    dir === null ? null : images.map((entry) => `${entry.name}@${entry.mtime}`).join('\n'),
    newTiles,
  )

  if (dir === null) {
    return listing.error === null ? (
      <div className={css.loading} aria-busy="true" />
    ) : (
      <DisplayState icon="alert" title={t('display.failed')} sub={listing.error} tone="error" />
    )
  }
  if (!asImages) {
    if (entries.length === 0 && view.match !== undefined) {
      return (
        <DisplayState icon="search" title={t('display.matchNone').replace('{match}', view.match)} />
      )
    }
    return <FolderList t={t} entries={entries} view={view} />
  }
  const hidden = images.length - shown.length
  return (
    <div
      className={css.gallery}
      data-fit={display.fit === 'cover' ? 'cover' : 'contain'}
      style={{
        gridTemplateColumns: tracks.columns,
        gridTemplateRows: tracks.rows,
        gap: GALLERY_GAP,
      }}
      data-testid="wl-display-gallery"
    >
      {shown.map((entry, index) => {
        const hero = layout.hero && index === 0
        const last = index === shown.length - 1
        // 只露一张的不盖「+N」（盖住了就看不到那张了），张数写在名字后面。
        const more = last && hidden > 0 && !single ? hidden + 1 : 0
        // 最后一行不满：那几张摊开占满。
        const span = layout.spans[index - (shown.length - layout.spans.length)] ?? 1
        const url = urls[entry.name]
        const Tile = props.interactive && props.onOpen !== undefined ? 'button' : 'div'
        return (
          <Tile
            key={entry.name}
            {...(Tile === 'button'
              ? { type: 'button' as const, onClick: () => props.onOpen?.(entry.name) }
              : {})}
            className={css.tile}
            data-hero={hero || undefined}
            data-new={marks?.items.has(index) === true ? marks.parity : undefined}
            data-tip={props.interactive && !hero ? entry.name : undefined}
            aria-label={entry.name}
            style={
              hero
                ? {
                    gridColumn: `span ${layout.heroSpan.columns}`,
                    gridRow: `span ${layout.heroSpan.rows}`,
                  }
                : span > 1
                  ? { gridColumn: `span ${span}` }
                  : undefined
            }
            data-testid="wl-display-tile"
          >
            {url === null ? (
              <Icon name="alert" size={14} />
            ) : (
              url !== undefined && (
                <img
                  key={url}
                  className={css.tileImage}
                  src={url}
                  alt=""
                  draggable={false}
                  decoding="async"
                />
              )
            )}
            {hero && (
              <span className={css.tileName}>
                {single && hidden > 0
                  ? t('display.galleryOf')
                      .replace('{name}', entry.name)
                      .replace('{n}', images.length.toLocaleString())
                  : entry.name}
              </span>
            )}
            {more > 0 && (
              <span className={css.tileMore} data-testid="wl-display-more">
                +{more.toLocaleString()}
              </span>
            )}
          </Tile>
        )
      })}
    </div>
  )
}
