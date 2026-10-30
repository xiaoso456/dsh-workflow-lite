/**
 * dsh-workflow-lite — 展示卡还没有内容时的草图：按内容种类画一张淡淡的线框，底下一枚说明签。
 *
 * - 网页：一张看板的样子（标题行、一排指标卡、一块折线图）；
 * - 图片：一座山和太阳，标出展示框的比例和建议的出图尺寸；
 * - Markdown：标题、几行正文、一张小表；
 * - 纯文本 / 代码：行号和长短不一的几行；
 * - 文件夹（图墙）：和真的一样排的格子，最新那张的大格里一座山。
 *
 * 线框只是「这里会出现什么」的示意，颜色压得很低，一眼就看得出不是真内容；尺寸跟着展示区走
 * （窄、矮的卡片上收掉放不下的部分，见 `display.module.css` 的容器查询）。全是静态的，不读文件、不动；
 * 写它的步骤正在跑时，上面扫一道光。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DisplaySketch
 */

import { GALLERY_GAP, galleryGrid, galleryTracks, ratioText } from '../../shared/display.ts'
import type { Display } from '../model/display.ts'
import css from './display.module.css'
import { Icon, type IconName } from './Icon.tsx'

/** 几行的长短（百分比）：固定的一组，每张卡都一样，不随机。 */
const PROSE = [92, 78, 86, 64]
const CODE = [46, 72, 58, 84, 38, 66, 52, 76, 44, 62]

function Bar(props: { width: number; tone?: 'tint' }): React.JSX.Element {
  return <span className={css.skBar} data-tone={props.tone} style={{ width: `${props.width}%` }} />
}

function HtmlSketch(): React.JSX.Element {
  return (
    <>
      <span className={css.skHead}>
        <Bar width={38} tone="tint" />
        <span className={css.skDots}>
          <span />
          <span />
        </span>
      </span>
      <span className={css.skTiles}>
        {[0, 1, 2].map((index) => (
          <span key={index} className={css.skTile}>
            <Bar width={46} />
            <Bar width={72} tone="tint" />
          </span>
        ))}
      </span>
      <span className={css.skChart}>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="0,30 18,24 34,27 52,14 70,18 86,8 100,11" />
        </svg>
      </span>
    </>
  )
}

function ImageSketch(props: { display: Display }): React.JSX.Element {
  const { width, height } = props.display
  return (
    <span className={css.skImage}>
      <Mountain />
      <span className={css.skRatio}>
        {ratioText(width, height)} · {width * 2}×{height * 2}
      </span>
    </span>
  )
}

/** 山和太阳（图片、图墙的大格共用）。 */
function Mountain(): React.JSX.Element {
  return (
    <svg viewBox="0 0 48 32" aria-hidden="true">
      <circle cx="35" cy="9" r="4" />
      <path d="M2 30 L16 13 L25 23 L31 17 L46 30 Z" />
    </svg>
  )
}

function GallerySketch(props: { display: Display }): React.JSX.Element {
  const grid = galleryGrid(props.display.width, props.display.height, props.display.gallery)
  const tracks = galleryTracks(grid)
  return (
    <span
      className={css.skGallery}
      style={{
        gridTemplateColumns: tracks.columns,
        gridTemplateRows: tracks.rows,
        gap: GALLERY_GAP,
      }}
    >
      {Array.from({ length: grid.slots }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 固定的几格占位
          key={index}
          className={css.skCell}
          style={
            index === 0 && grid.hero
              ? {
                  gridColumn: `span ${grid.heroSpan.columns}`,
                  gridRow: `span ${grid.heroSpan.rows}`,
                }
              : undefined
          }
        >
          {index === 0 && <Mountain />}
        </span>
      ))}
    </span>
  )
}

function MarkdownSketch(): React.JSX.Element {
  return (
    <>
      <Bar width={48} tone="tint" />
      {PROSE.slice(0, 3).map((width) => (
        <Bar key={`above-${width}`} width={width} />
      ))}
      <span className={css.skTable}>
        {[0, 1, 2].map((row) => (
          <span key={row} className={css.skRow}>
            <Bar width={row === 0 ? 70 : 54} tone={row === 0 ? 'tint' : undefined} />
            <Bar width={row === 0 ? 60 : 40} tone={row === 0 ? 'tint' : undefined} />
          </span>
        ))}
      </span>
      {PROSE.slice(1).map((width) => (
        <Bar key={`below-${width}`} width={width} />
      ))}
    </>
  )
}

function TextSketch(): React.JSX.Element {
  return (
    <>
      {CODE.map((width, index) => (
        <span key={width} className={css.skLine}>
          <span className={css.skNo}>{index + 1}</span>
          <Bar width={width} tone={index === 0 ? 'tint' : undefined} />
        </span>
      ))}
    </>
  )
}

export function DisplaySketch(props: {
  display: Display
  icon: IconName
  title: string
  /** 说明签上跟在标题后面的文件名。 */
  sub?: string
  /** 写它的步骤正在跑。 */
  busy?: boolean
}): React.JSX.Element {
  const { display } = props
  return (
    <div
      className={css.sketch}
      data-kind={display.kind}
      data-busy={props.busy === true || undefined}
      data-testid="wl-display-sketch"
    >
      <span className={css.skBody} aria-hidden="true">
        {display.kind === 'html' ? (
          <HtmlSketch />
        ) : display.kind === 'image' ? (
          <ImageSketch display={display} />
        ) : display.kind === 'gallery' ? (
          <GallerySketch display={display} />
        ) : display.kind === 'markdown' ? (
          <MarkdownSketch />
        ) : (
          <TextSketch />
        )}
      </span>
      <span className={css.skCaption} data-testid="wl-display-state">
        <Icon name={props.icon} size={12} />
        <span className={css.skCaptionTitle}>{props.title}</span>
        {props.sub !== undefined && props.sub !== '' && (
          <span className={css.skCaptionSub}>{props.sub}</span>
        )}
      </span>
    </div>
  )
}
