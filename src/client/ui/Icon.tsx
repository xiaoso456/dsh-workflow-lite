/**
 * dsh-workflow-lite — 图标（内联 SVG，24 栅格、描边风格、跟随文字颜色）。
 *
 * 自带一小套而不是引图标库：模块加载器只认冻结的平台 externals，引进来的库要整个打进
 * bundle，而这里总共只用到二十来个。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Icon
 */

import type { StepIcon } from '../../shared/appearance.ts'
import { STEP_ICON_PATHS } from './stepIcons.ts'

const BASE_PATHS = {
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
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
  // 步骤库：左边一栏的面板（开关左侧的步骤库）
  library: 'M6 4.5h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2v-11a2 2 0 012-2zM9.5 4.5v15',
  // 详情面板：右边一栏（实例视图开关右栏）
  panel: 'M6 4.5h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2v-11a2 2 0 012-2zM14.5 4.5v15',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  reload: 'M20 12a8 8 0 11-2.4-5.7M20 4v5h-5',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  folder: 'M3 7h6l2 2h10v10H3z',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  // 交接
  handoff: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  result: 'M5 5h14v10h-8l-4 4v-4H5zM9 9.5h6M9 12h4',
  // 读写线
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z',
  // 执行方式
  modeAuto:
    'M12 3v3M12 18v3M3 12h3M18 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1',
  modeSerial: 'M3 10h5v4H3zM16 10h5v4h-5zM8 12h8M13 9.5l3 2.5-3 2.5',
  modeSubagent: 'M9 3h6v5H9zM3 16h5v5H3zM16 16h5v5h-5zM12 8v4M5.5 16v-4h13v4',
  modeTeam:
    'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 2.7-5 6-5s6 2 6 5M16 5.5a3 3 0 010 5.5M18 15c1.8.6 3 2.4 3 5',
  // 输入节点：问用户（提问气泡），四种交互方式
  ask: 'M5 5h14v10H10l-4 4v-4H5zM10 8.6a2 2 0 113 1.7c-.6.4-1 .8-1 1.4M12 12.9v.2',
  inputText: 'M4 7h16v10H4zM8 10v4',
  inputArea: 'M4 5h16v14H4zM8 9h8M8 12h8M8 15h5',
  inputChoice:
    'M7 9.5a2 2 0 100-4 2 2 0 000 4zM7 18.5a2 2 0 100-4 2 2 0 000 4zM12 7.5h8M12 16.5h8M7 8.2v-1.4',
  inputMulti: 'M4 5h5v5H4zM5.4 7.6l1 1 1.6-2M4 14h5v5H4zM12 7.5h8M12 16.5h8',
  palette:
    'M12 3a9 9 0 000 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5c0-4-4-7.4-9-7.4zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  // 运行状态
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3 2',
  pause: 'M9 5v14M15 5v14',
  stop: 'M7 7h10v10H7z',
  skip: 'M5 6l8 6-8 6zM17 6v12',
  hourglass: 'M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9',
  // 工作流中心：两个步骤块由一条折线连起来
  hub: 'M5 3h4a2 2 0 012 2v4a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM7 11v4a2 2 0 002 2h4M15 13h4a2 2 0 012 2v4a2 2 0 01-2 2h-4a2 2 0 01-2-2v-4a2 2 0 012-2z',
  // 交给整个工作流：一个点向两边发散
  shared:
    'M12 13.6a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2zM8.3 8.3a5.2 5.2 0 000 7.4M15.7 8.3a5.2 5.2 0 010 7.4M5.4 5.4a9.3 9.3 0 000 13.2M18.6 5.4a9.3 9.3 0 010 13.2',
  runs: 'M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10',
  storage:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  // 文件与实例
  pin: 'M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9zM12 12.5V21',
  flag: 'M5 21V4M5 4h12l-2.5 4.5L17 13H5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  folderOpen: 'M3 7V5h6l2 2h8v3M3 7v12h15l3-9H6.5L3 19',
  circle: 'M12 20a8 8 0 100-16 8 8 0 000 16z',
  // 资源里的自定义：一张写了几行字的便签
  note: 'M5 4h10l4 4v12H5zM15 4v4h4M8.5 12h7M8.5 15.5h7M8.5 8.5h3',
  // 实例右栏的概览：大小不一的四块看板
  overview: 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z',
  // 版本：表盘加一道往回转的箭头；切换到某一版：只有往回转的箭头。
  history: 'M4 12a8 8 0 102.3-5.7L4 8.5M4 4v4.5h4.5M12 8v4l2.8 1.8',
  restore: 'M4 12a8 8 0 102.3-5.7L4 8.5M4 4v4.5h4.5',
  /** 运行状态：一段脉搏线。 */
  activity: 'M3 12h4l3-7 4 14 3-7h4',
} as const

const PATHS: Record<keyof typeof BASE_PATHS | StepIcon, string> = {
  ...BASE_PATHS,
  ...STEP_ICON_PATHS,
}

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
