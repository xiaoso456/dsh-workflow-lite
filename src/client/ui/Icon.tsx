/**
 * dsh-workflow-lite — 图标（内联 SVG，24 栅格、描边风格、跟随文字颜色）。
 *
 * 自带一小套而不是引图标库：模块加载器只认冻结的平台 externals，引进来的库要整个打进
 * bundle，而这里总共只用到二十来个。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Icon
 */

import type { StepKind } from '../model/library.ts'

const PATHS = {
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  tidy: 'M4 5h6v5H4zM14 5h6v5h-6zM9 14h6v5H9zM7 10v2h10v-2M12 12v2',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  play: 'M7 5l12 7-12 7z',
  alert:
    'M12 8v5M12 16.5v.5M10.3 4l-7.4 13a2 2 0 001.7 3h14.8a2 2 0 001.7-3L13.7 4a2 2 0 00-3.4 0z',
  info: 'M12 11v6M12 7.5v.5M12 21a9 9 0 100-18 9 9 0 000 18z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pencil: 'M4 20l4-1L19 8l-3-3L5 16l-1 4zM14 7l3 3',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4',
  loop: 'M17 3l3 3-3 3M20 6H8a4 4 0 00-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 004-4v-1',
  keyboard: 'M3 7h18v10H3zM7 11h.5M11 11h.5M15 11h.5M8 14h8',
  library: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM16.5 13v6M13.5 16h6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  reload: 'M20 12a8 8 0 11-2.4-5.7M20 4v5h-5',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  folder: 'M3 7h6l2 2h10v10H3z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  // 执行方式
  modeAuto:
    'M12 3v3M12 18v3M3 12h3M18 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1',
  modeSerial: 'M3 10h5v4H3zM16 10h5v4h-5zM8 12h8M13 9.5l3 2.5-3 2.5',
  modeSubagent: 'M9 3h6v5H9zM3 16h5v5H3zM16 16h5v5h-5zM12 8v4M5.5 16v-4h13v4',
  modeTeam:
    'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M16 5.5a3 3 0 010 5.5M18 15c1.8.6 3 2.4 3 5',
  // 步骤种类
  scan: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4M8.5 11h5',
  plan: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
  implement: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14',
  review: 'M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6zM9 12l2 2 4-4',
  fix: 'M14.5 6.5a4 4 0 005 5L10 21l-3.5-3.5L16 8M14.5 6.5L17 4M6.5 17.5L9 20',
  report: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  blank: 'M5 5h14v14H5zM9 12h6M12 9v6',
} as const

export type IconName = keyof typeof PATHS

export function Icon(props: { name: IconName; size?: number }): React.JSX.Element {
  const size = props.size ?? 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[props.name]} />
    </svg>
  )
}

/** 步骤种类对应的图标（种类名恰好就是图标名）。 */
export function kindIcon(kind: StepKind): IconName {
  return kind
}
