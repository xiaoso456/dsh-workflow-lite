/**
 * dsh-workflow-lite — 画布的配色主题：亮色、暗色各四套。
 *
 * 亮 / 暗跟着宿主设在 `<html>` 上的 `color-scheme` 走；人只挑「亮的时候用哪套、暗的时候用哪套」
 * （工作流中心「设置」页）。每套主题给出一份完整的基础色，视图根节点按选中的两套写成
 * `--wl-l-*`、`--wl-d-*` 两组变量，shell.module.css 再用 `light-dark()` 拼成界面用的 `--wl-*`。
 * 浅色的「淡」档（选中底、标签底）由基础色按固定比例调出来，这里不重复写。
 *
 * 主题不只是换底色：线色（也是光带、图例、线上牌子的颜色）、强调色、步骤图标色、状态色都是一整套。
 * 除了两套默认和晴白，每套照着一份成熟的配色方案来配：雾蓝 = Nord、林间 = Everforest、墨黑 = Geist 式高对比、
 * 深海 = Tokyo Night、暖夜 = Gruvbox；保留它们的色相和饱和，只按面板把亮度调到读得清。
 * 主干线（「总是」）就用强调色，选中框、按钮、主干线、上面跑的光带是同一个颜色，整套主题一个基调。
 *
 * 每套都要过同一套检查（tests/client/themes.spec.ts）：三级文字、强调色文字、语义色、
 * 七种线色、步骤图标色在面板上过 4.5:1，线色在画布上过 3:1，七种线两两的 OKLab 色差不小于 8。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/themes
 */

export type ThemeMode = 'light' | 'dark'

export const LIGHT_THEME_IDS = ['paper', 'white', 'mist', 'sage'] as const
export const DARK_THEME_IDS = ['slate', 'ink', 'ocean', 'umber'] as const
export type LightThemeId = (typeof LIGHT_THEME_IDS)[number]
export type DarkThemeId = (typeof DARK_THEME_IDS)[number]
export type ThemeId = LightThemeId | DarkThemeId

export const DEFAULT_LIGHT: LightThemeId = 'paper'
export const DEFAULT_DARK: DarkThemeId = 'slate'

export interface ThemeTokens {
  /** 面：画布、浮在上面的面板与卡片、输入框底、更深一档的底。 */
  canvas: string
  panel: string
  fill: string
  fillStrong: string
  /** 网格点、悬停底、描边用的墨色（`R G B`），各自配一档透明度（百分数）。 */
  ink: string
  dotAlpha: number
  hoverAlpha: number
  lineAlpha: number
  lineStrongAlpha: number
  /** 阴影的颜色（`R G B`）；透明度按亮 / 暗写在 CSS 里。 */
  shade: string
  scrim: string
  text: string
  text2: string
  text3: string
  accent: string
  accentStrong: string
  accentOn: string
  accentText: string
  danger: string
  warn: string
  ok: string
  /** 七种线：流程线按条件，读写线按读写（见 ui/lines.ts）。 */
  always: string
  pass: string
  fail: string
  custom: string
  produce: string
  update: string
  read: string
  /** 资源卡。 */
  file: string
  fileSurface: string
  fileBorder: string
  fileTab: string
  fileBack: string
  /** 步骤图标的色板（shared/appearance.ts 的 STEP_COLORS）。 */
  cBlue: string
  cGreen: string
  cAmber: string
  cCoral: string
  cTeal: string
  cPink: string
  cOlive: string
  cViolet: string
  cSlate: string
  /** 输入节点（交回答的线）的中性墨色。 */
  ask: string
  tip: string
  tipOn: string
}

/** 米色的线色与步骤色（别的亮色主题按自己的底色另调，见各自的注释）。 */
const LIGHT_LINES = {
  always: '#1d55c2',
  pass: '#18792a',
  fail: '#c42f20',
  custom: '#8848c4',
  produce: '#8b5e00',
  update: '#a8227f',
  read: '#00778a',
  cBlue: '#2a65cf',
  cGreen: '#127a51',
  cAmber: '#9a5b00',
  cCoral: '#b8432a',
  cTeal: '#0c7480',
  cPink: '#c2367a',
  cOlive: '#59730f',
  cViolet: '#6b5bd2',
} as const

/** 石板的线色与步骤色（别的暗色主题按自己的底另调）。 */
const SLATE_LINES = {
  always: '#4f99f9',
  pass: '#5cdc78',
  fail: '#ff7865',
  custom: '#d3adff',
  produce: '#f7cc4b',
  update: '#ed62c1',
  read: '#50d9ef',
  cBlue: '#74aaff',
  cGreen: '#56d08e',
  cAmber: '#f0b955',
  cCoral: '#ff8e70',
  cTeal: '#55d2dd',
  cPink: '#f58cbd',
  cOlive: '#b4d65a',
  cViolet: '#a99cf5',
} as const

export const THEMES: Record<ThemeId, ThemeTokens> = {
  /** 米色：暖灰画布、米白卡面，墨色文字，描边和阴影带一点暖棕。默认的亮色。 */
  paper: {
    canvas: '#edebe6',
    panel: '#f6f5f1',
    fill: '#efede8',
    fillStrong: '#e5e2db',
    ink: '64 54 40',
    dotAlpha: 19,
    hoverAlpha: 6,
    lineAlpha: 11,
    lineStrongAlpha: 19,
    shade: '52 40 24',
    scrim: 'rgb(38 33 26 / 30%)',
    text: '#25221d',
    text2: '#55514a',
    text3: '#6b665d',
    accent: '#2f63c9',
    accentStrong: '#2853ad',
    accentOn: '#fbfaf7',
    accentText: '#2858b5',
    danger: '#bb372d',
    warn: '#8f560a',
    ok: '#157350',
    ...LIGHT_LINES,
    file: '#536178',
    fileSurface: '#f3f2ee',
    fileBorder: '#d5d0c6',
    fileTab: '#ebe8e1',
    fileBack: '#dedad1',
    cSlate: '#5c6475',
    ask: '#3d4452',
    tip: '#2a2722',
    tipOn: '#f5f3ee',
  },
  /** 晴白：最早那套，冷调的浅灰画布配纯白卡面，对比最清楚。 */
  white: {
    canvas: '#f2f4f7',
    panel: '#ffffff',
    fill: '#f1f3f6',
    fillStrong: '#e7eaf0',
    ink: '22 32 52',
    dotAlpha: 17,
    hoverAlpha: 6,
    lineAlpha: 9,
    lineStrongAlpha: 16,
    shade: '20 24 44',
    scrim: 'rgb(16 22 34 / 28%)',
    text: '#131820',
    text2: '#444c5a',
    text3: '#5e6676',
    accent: '#1f6feb',
    accentStrong: '#195dcc',
    accentOn: '#ffffff',
    accentText: '#1a5fd0',
    danger: '#c0392f',
    warn: '#94590a',
    ok: '#167a54',
    always: '#1e59cd',
    pass: '#1c882d',
    fail: '#d73626',
    custom: '#9251cf',
    produce: '#9d6b00',
    update: '#b2268b',
    read: '#008295',
    file: '#52627a',
    fileSurface: '#fafbfd',
    fileBorder: '#cdd5e0',
    fileTab: '#eaeff6',
    fileBack: '#dfe5ee',
    cBlue: '#2f6fde',
    cGreen: '#16875a',
    cAmber: '#a86400',
    cCoral: '#c84a2b',
    cTeal: '#0f7f8a',
    cPink: '#c2367a',
    cOlive: '#5f7a12',
    cViolet: '#6b5bd2',
    cSlate: '#5c6475',
    ask: '#3d4452',
    tip: '#1e2029',
    tipOn: '#f4f5f8',
  },
  /**
   * 雾蓝：底子是几乎不带色的冷白，蓝落在细节上——描边、网格点、悬停底、输入框底、卡片阴影都带一点蓝。
   * 彩色照 Nord：Frost 蓝作强调色和主干线，Aurora 的红、橙、黄、绿、紫给别的线和图标，都是灰调的低饱和色。
   */
  mist: {
    canvas: '#eff2f6',
    panel: '#fcfdff',
    fill: '#f0f3f8',
    fillStrong: '#e4eaf3',
    ink: '52 92 170',
    dotAlpha: 18,
    hoverAlpha: 6,
    lineAlpha: 11,
    lineStrongAlpha: 20,
    shade: '40 80 160',
    scrim: 'rgb(20 36 70 / 28%)',
    text: '#1b2230',
    text2: '#434d5f',
    text3: '#596476',
    accent: '#3a62a8',
    accentStrong: '#30528f',
    accentOn: '#f7faff',
    accentText: '#3a62a8',
    danger: '#b0545d',
    warn: '#956806',
    ok: '#5b7845',
    always: '#3a62a8',
    pass: '#4b7a36',
    fail: '#9e3340',
    custom: '#7b5a96',
    produce: '#866c00',
    update: '#b5532a',
    read: '#1f7787',
    cBlue: '#50739d',
    cGreen: '#5f7849',
    cAmber: '#896c2c',
    cCoral: '#a35e49',
    cTeal: '#4c7777',
    cPink: '#965f7a',
    cOlive: '#6f743d',
    cViolet: '#70699f',
    file: '#4a6188',
    fileSurface: '#f7f9fc',
    fileBorder: '#d0d9e6',
    fileTab: '#e9eef6',
    fileBack: '#d9e1ed',
    cSlate: '#4c566a',
    ask: '#33445f',
    tip: '#1b2230',
    tipOn: '#f6f9fe',
  },
  /**
   * 林间：底子是几乎不带色的暖白，绿落在细节上——描边、网格点、悬停底、输入框底、卡片阴影都带一点绿。
   * 彩色照 Everforest：水绿作强调色和主干线，橄榄绿、砖红、赭黄、陶橙、石青、紫红给别的线和图标。
   */
  sage: {
    canvas: '#f0f2ef',
    panel: '#fcfdfc',
    fill: '#eff3f0',
    fillStrong: '#e3ebe5',
    ink: '28 112 78',
    dotAlpha: 18,
    hoverAlpha: 6,
    lineAlpha: 11,
    lineStrongAlpha: 20,
    shade: '30 70 50',
    scrim: 'rgb(16 40 28 / 28%)',
    text: '#1e2621',
    text2: '#454f48',
    text3: '#5a655d',
    accent: '#087a5c',
    accentStrong: '#066449',
    accentOn: '#f4f8f0',
    accentText: '#087a5c',
    danger: '#c0302f',
    warn: '#926802',
    ok: '#687704',
    always: '#087a5c',
    pass: '#55780c',
    fail: '#b0262e',
    custom: '#a8418f',
    produce: '#7f6200',
    update: '#bb5200',
    read: '#1f6f9e',
    cBlue: '#1177a6',
    cGreen: '#687704',
    cAmber: '#926802',
    cCoral: '#b45503',
    cTeal: '#017f5a',
    cPink: '#b64394',
    cOlive: '#68762d',
    cViolet: '#7e63a7',
    file: '#4b6656',
    fileSurface: '#f7faf7',
    fileBorder: '#cfdcd2',
    fileTab: '#e7eee9',
    fileBack: '#d6e2d9',
    cSlate: '#657364',
    ask: '#344636',
    tip: '#1e2621',
    tipOn: '#f6faf6',
  },
  /** 石板：带一点冷调的深石板灰，不是纯黑。默认的暗色。 */
  slate: {
    canvas: '#0e1116',
    panel: '#181c23',
    fill: '#222730',
    fillStrong: '#2a303b',
    ink: '226 234 248',
    dotAlpha: 13,
    hoverAlpha: 7,
    lineAlpha: 9,
    lineStrongAlpha: 16,
    shade: '0 0 0',
    scrim: 'rgb(0 0 0 / 55%)',
    text: '#e9edf3',
    text2: '#b6bdc9',
    text3: '#9098a6',
    accent: '#4d94ff',
    accentStrong: '#6eaaff',
    accentOn: '#05132b',
    accentText: '#86b8ff',
    danger: '#ff7a70',
    warn: '#f0b955',
    ok: '#56d08e',
    ...SLATE_LINES,
    file: '#a7b4c8',
    fileSurface: '#1b2029',
    fileBorder: '#353f4f',
    fileTab: '#232a35',
    fileBack: '#2d3644',
    cSlate: '#a3aab8',
    ask: '#dfe3ea',
    tip: '#eceef3',
    tipOn: '#15171e',
  },
  /**
   * 墨黑：纯黑的底、几乎不发灰的面，配饱和更高的强调色和线色，黑底上最鲜亮；OLED 屏也最省电。
   * 彩色照 Geist 那类高对比方案：电光蓝作强调色和主干线，别的颜色干净饱满，黑底上一眼分得清。
   */
  ink: {
    canvas: '#000000',
    panel: '#0f0f11',
    fill: '#19191c',
    fillStrong: '#232327',
    ink: '255 255 255',
    dotAlpha: 13,
    hoverAlpha: 8,
    lineAlpha: 10,
    lineStrongAlpha: 18,
    shade: '0 0 0',
    scrim: 'rgb(0 0 0 / 66%)',
    text: '#f5f5f7',
    text2: '#bcbcc3',
    text3: '#909099',
    accent: '#06a7ff',
    accentStrong: '#5cc0ff',
    accentOn: '#001428',
    accentText: '#4db8ff',
    danger: '#ff6166',
    warn: '#ffb224',
    ok: '#62c073',
    always: '#06a7ff',
    pass: '#6fb971',
    fail: '#ff5143',
    custom: '#c07bfb',
    produce: '#f3b001',
    update: '#fb589d',
    read: '#29d7c4',
    file: '#a8adb8',
    fileSurface: '#141417',
    fileBorder: '#2e2e34',
    fileTab: '#1b1b1f',
    fileBack: '#28282d',
    cBlue: '#52a8ff',
    cGreen: '#62c073',
    cAmber: '#ffb224',
    cCoral: '#ff8c4b',
    cTeal: '#0ac7b4',
    cPink: '#f75f8f',
    cOlive: '#a3d65e',
    cViolet: '#8e8cf3',
    cSlate: '#a1a1aa',
    ask: '#ececf0',
    tip: '#f5f5f7',
    tipOn: '#0f0f11',
  },
  /**
   * 深海：带一点蓝的深色底（不是浓重的藏青），蓝色主要落在强调色、主干线和细节上。
   * 彩色照 Tokyo Night：长春花蓝作强调色和主干线，青柠绿、樱粉红、薰衣草紫、琥珀、橘、天青给别的线和图标。
   */
  ocean: {
    canvas: '#0d1420',
    panel: '#151d2b',
    fill: '#1c2636',
    fillStrong: '#243042',
    ink: '180 210 255',
    dotAlpha: 14,
    hoverAlpha: 8,
    lineAlpha: 11,
    lineStrongAlpha: 19,
    shade: '0 6 20',
    scrim: 'rgb(2 8 20 / 62%)',
    text: '#e6efff',
    text2: '#b1c2df',
    text3: '#8ea3c6',
    accent: '#759cf3',
    accentStrong: '#98b8ff',
    accentOn: '#0b1530',
    accentText: '#8eb3fe',
    danger: '#f7768e',
    warn: '#e0af68',
    ok: '#9ece6a',
    always: '#759cf3',
    pass: '#8cd57e',
    fail: '#ef7c99',
    custom: '#caafff',
    produce: '#edbe72',
    update: '#f18b3b',
    read: '#7acbfc',
    file: '#a2b6d4',
    fileSurface: '#18202f',
    fileBorder: '#2d3a4f',
    fileTab: '#1e2838',
    fileBack: '#283447',
    cBlue: '#7aa2f7',
    cGreen: '#9ece6a',
    cAmber: '#e0af68',
    cCoral: '#ff9e64',
    cTeal: '#73daca',
    cPink: '#f39ac5',
    cOlive: '#b9d36a',
    cViolet: '#bb9af7',
    cSlate: '#a9b1d6',
    ask: '#dde8fa',
    tip: '#e6efff',
    tipOn: '#151d2b',
  },
  /**
   * 暖夜：带一点暖褐的深色底，强调色换成一支琥珀橙，文字是米白——台灯下的书桌。
   * 彩色照 Gruvbox：橙作强调色和主干线，红、黄、黄绿、水绿、灰蓝、豆沙粉给别的线和图标，复古暖调。
   */
  umber: {
    canvas: '#171310',
    panel: '#221c17',
    fill: '#2c251f',
    fillStrong: '#372f27',
    ink: '255 222 186',
    dotAlpha: 13,
    hoverAlpha: 8,
    lineAlpha: 11,
    lineStrongAlpha: 19,
    shade: '0 0 0',
    scrim: 'rgb(10 6 2 / 62%)',
    text: '#f6e8d5',
    text2: '#d3bea3',
    text3: '#ad977e',
    accent: '#e27d00',
    accentStrong: '#f79a3a',
    accentOn: '#1f1206',
    accentText: '#f39a45',
    danger: '#fb4934',
    warn: '#fabd2f',
    ok: '#b8bb26',
    always: '#e27d00',
    pass: '#a5aa01',
    fail: '#f7422d',
    custom: '#7f9c8e',
    produce: '#fec064',
    update: '#dc8398',
    read: '#9fd090',
    file: '#c9b49a',
    fileSurface: '#251f19',
    fileBorder: '#443a30',
    fileTab: '#2d2620',
    fileBack: '#3a3129',
    cBlue: '#83a598',
    cGreen: '#b8bb26',
    cAmber: '#fabd2f',
    cCoral: '#fe8019',
    cTeal: '#8ec07c',
    cPink: '#d3869b',
    cOlive: '#98971a',
    cViolet: '#bd6d91',
    cSlate: '#a89984',
    ask: '#f1e3d0',
    tip: '#f6e8d5',
    tipOn: '#221c17',
  },
}

export function isLightTheme(id: unknown): id is LightThemeId {
  return typeof id === 'string' && (LIGHT_THEME_IDS as readonly string[]).includes(id)
}

export function isDarkTheme(id: unknown): id is DarkThemeId {
  return typeof id === 'string' && (DARK_THEME_IDS as readonly string[]).includes(id)
}

/** `cBlue` → `c-blue`、`text2` → `text2`。 */
function kebab(key: string): string {
  return key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)
}

const ALPHA_KEYS = new Set<keyof ThemeTokens>([
  'dotAlpha',
  'hoverAlpha',
  'lineAlpha',
  'lineStrongAlpha',
])

/** 一套主题写成一组 CSS 变量：亮色档写 `--wl-l-*`，暗色档写 `--wl-d-*`。 */
export function themeVars(mode: ThemeMode, id: ThemeId): Record<string, string> {
  const prefix = mode === 'light' ? '--wl-l-' : '--wl-d-'
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(THEMES[id])) {
    out[prefix + kebab(key)] = ALPHA_KEYS.has(key as keyof ThemeTokens)
      ? `${value}%`
      : String(value)
  }
  return out
}

/** 视图根节点的内联样式：亮、暗各一套。 */
export function themeStyle(light: LightThemeId, dark: DarkThemeId): Record<string, string> {
  return { ...themeVars('light', light), ...themeVars('dark', dark) }
}
