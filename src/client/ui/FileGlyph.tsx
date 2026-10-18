/**
 * dsh-workflow-lite — 文件前面的类型图标：文档、表格、代码、图片、压缩包、音视频……各有各的形状和颜色，
 * 一眼分得出来（文件夹浏览、选择文件的对话框共用）。分类见 `fileGroupOf`。
 *
 * 颜色用步骤卡的那套色板（`--wl-c-*`），跟着主题走；认不出的类型是灰色的通用文件图标。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FileGlyph
 */

import { type FileGroup, fileGroupOf } from '../model/fileKind.ts'
import css from './fileGlyph.module.css'
import { Icon, type IconName } from './Icon.tsx'

type Tone = 'blue' | 'green' | 'amber' | 'coral' | 'teal' | 'pink' | 'olive' | 'violet' | 'slate'

const GLYPHS: Record<FileGroup, { icon: IconName; tone: Tone | null }> = {
  markdown: { icon: 'note', tone: 'blue' },
  text: { icon: 'note', tone: 'slate' },
  doc: { icon: 'note', tone: 'blue' },
  pdf: { icon: 'note', tone: 'coral' },
  sheet: { icon: 'table', tone: 'olive' },
  slides: { icon: 'slides', tone: 'violet' },
  data: { icon: 'braces', tone: 'amber' },
  config: { icon: 'gear', tone: 'slate' },
  code: { icon: 'code', tone: 'green' },
  web: { icon: 'globe', tone: 'teal' },
  shell: { icon: 'terminal', tone: 'teal' },
  database: { icon: 'database', tone: 'olive' },
  image: { icon: 'image', tone: 'pink' },
  audio: { icon: 'audio', tone: 'violet' },
  video: { icon: 'video', tone: 'coral' },
  archive: { icon: 'package', tone: 'amber' },
  font: { icon: 'font', tone: 'slate' },
  lock: { icon: 'lock', tone: 'amber' },
  binary: { icon: 'cube', tone: 'slate' },
  other: { icon: 'file', tone: null },
}

export function FileGlyph(props: { path: string; size?: number }): React.JSX.Element {
  const group = fileGroupOf(props.path)
  const glyph = GLYPHS[group]
  return (
    <span
      className={css.glyph}
      data-group={group}
      data-tone={glyph.tone ?? undefined}
      aria-hidden="true"
    >
      <Icon name={glyph.icon} size={props.size ?? 15} />
    </span>
  )
}
