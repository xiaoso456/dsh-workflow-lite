/**
 * dsh-workflow-lite — 设置页文案：配色主题与插件设置。
 *
 * 工作流中心「设置」页：外观里的配色主题，以及插件设置项。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n/config
 */

/** 中文（默认）。 */
export const zh = {
  // ── 配色主题 ────────────────────────────────────────────────
  'theme.group': '外观',
  'theme.lead': '亮色、暗色各选一套，画布跟着 DSH 的亮暗模式自动切换。只在这台设备上生效。',
  'theme.light': '亮色主题',
  'theme.dark': '暗色主题',
  'theme.inUse': '正在用',
  'theme.default': '默认',
  'theme.swiss': '瑞士',
  'theme.swissDesc': '国际主义风格：中性灰、纯白卡面、直角细线、Helvetica 字体',
  'theme.white': '晴白',
  'theme.whiteDesc': '浅灰画布、纯白卡面，对比最清楚',
  'theme.mist': '雾蓝',
  'theme.mistDesc': '冷白底，蓝色落在描边、悬停和按钮上',
  'theme.sage': '林间',
  'theme.sageDesc': '暖白底，绿色落在描边、悬停和按钮上',
  'theme.slate': '石板',
  'theme.slateDesc': '冷调的深石板灰',
  'theme.ink': '墨黑',
  'theme.inkDesc': '纯黑底、更鲜亮的颜色，OLED 屏更省电',
  'theme.ocean': '深海',
  'theme.oceanDesc': '带一点蓝的深色底，配长春花蓝',
  'theme.board': '画布上的展示',
  'theme.boardDesc':
    '在画布上展示的看板、图片、文档的样子，默认柔边镂空。卡片带边框和标题行；柔边镂空不画卡片，内容下面的画布淡出；纯镂空连画布的点也透过来；毛玻璃是半透明卡面，后面的画布模糊着透出来。单张卡片可以在「画布展示」里另选。',
  'theme.board.card': '卡片',
  'theme.board.clear': '柔边镂空',
  'theme.board.bare': '纯镂空',
  'theme.board.glass': '毛玻璃',
  'theme.umber': '暖夜',
  'theme.umberDesc': '带一点暖褐的深色底、琥珀橙强调色',

  // ── 插件设置 ────────────────────────────────────────────────
  'cfg.groupStorage': '存储',
  'cfg.groupCanvas': '画布',
  'cfg.groupModel': '模型',
  'cfg.dataDir': '数据目录',
  'cfg.dataDirDesc': '工作流、版本和实例记录都存在这里。原来目录里的东西不会自动搬过去。',
  'cfg.maxNodes': '单张工作流最多步骤',
  'cfg.maxNodesDesc': '超出后画布不再自动整理，也不能执行。',
  'cfg.saveDebounce': '自动保存等待',
  'cfg.saveDebounceDesc': '在画布上停手多久后写盘。',
  'cfg.maxResult': '模型单次读取上限',
  'cfg.maxResultDesc': '模型读一张工作流、一份运行状态最多拿这么多；很大的工作流读不出来时调大。',
  'cfg.skill': '给模型的使用指南',
  'cfg.skillDesc':
    '注册三份模型按需读的指南：怎么设计工作流、怎么记录运行状态、怎么写画布上的看板。',
  'cfg.ms': '毫秒',
  'cfg.steps': '步',
  'cfg.kb': 'KB',
  'cfg.restart': '重启后生效',
  'cfg.reset': '恢复默认（{v}）',
  'cfg.dirty': '有 {n} 处改动还没保存',
  'cfg.discard': '放弃',
  'cfg.save': '保存',
  'cfg.saved': '已保存，马上生效',
  'cfg.savedRestart': '已保存。{keys}要重启 DSH 才生效',
  'cfg.unavailable': '这个 DSH 没有设置服务，这里只能看。要改请编辑 profile 配置文件。',
  'cfg.readonly': '当前 profile 不允许在这里改设置。',
  'cfg.int': '要填整数',
  'cfg.min': '不能小于 {n}',
  'cfg.required': '不能为空',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  // ── 配色主题 ────────────────────────────────────────────────
  'theme.group': 'Appearance',
  'theme.lead':
    'Pick one light and one dark theme; the canvas follows DSH light or dark mode. Applies to this device only.',
  'theme.light': 'Light theme',
  'theme.dark': 'Dark theme',
  'theme.inUse': 'In use',
  'theme.default': 'Default',
  'theme.swiss': 'Swiss',
  'theme.swissDesc':
    'International Typographic Style: neutral gray, white cards, square corners, hairlines, Helvetica',
  'theme.white': 'Daylight',
  'theme.whiteDesc': 'Light gray canvas, pure white cards, highest contrast',
  'theme.mist': 'Mist',
  'theme.mistDesc': 'Cool white base; blue shows in borders, hovers and buttons',
  'theme.sage': 'Sage',
  'theme.sageDesc': 'Warm white base; green shows in borders, hovers and buttons',
  'theme.slate': 'Slate',
  'theme.slateDesc': 'Cool dark slate gray',
  'theme.ink': 'Ink',
  'theme.inkDesc': 'True black with vivid colors, saves power on OLED',
  'theme.ocean': 'Ocean',
  'theme.oceanDesc': 'Dark base with a hint of blue and periwinkle accents',
  'theme.board': 'Displays on the canvas',
  'theme.boardDesc':
    'How boards, images and documents shown on the canvas look; Soft cut-out by default. Card has a border and title row; Soft cut-out drops the card and fades the canvas out under the content; Cut-out lets the canvas dots show through; Frosted glass is a translucent card with the canvas blurred behind it. Each card can pick its own under On the canvas.',
  'theme.board.card': 'Card',
  'theme.board.clear': 'Soft cut-out',
  'theme.board.bare': 'Cut-out',
  'theme.board.glass': 'Frosted glass',
  'theme.umber': 'Umber',
  'theme.umberDesc': 'Dark base with a hint of brown and an amber accent',

  // ── 插件设置 ────────────────────────────────────────────────
  'cfg.groupStorage': 'Storage',
  'cfg.groupCanvas': 'Canvas',
  'cfg.groupModel': 'Model',
  'cfg.dataDir': 'Data folder',
  'cfg.dataDirDesc':
    'Workflows, versions and instance records live here. Existing files are not moved for you.',
  'cfg.maxNodes': 'Max steps per workflow',
  'cfg.maxNodesDesc': 'Beyond this the canvas stops auto-arranging and the workflow cannot run.',
  'cfg.saveDebounce': 'Autosave delay',
  'cfg.saveDebounceDesc': 'How long the canvas waits after you stop before writing to disk.',
  'cfg.maxResult': 'Model read limit',
  'cfg.maxResultDesc':
    'The most the model gets from one read of a workflow or run state; raise it if a big workflow cannot be read.',
  'cfg.skill': 'Guides for the model',
  'cfg.skillDesc':
    'Registers three on-demand guides: designing workflows, recording run state, and writing canvas dashboards.',
  'cfg.ms': 'ms',
  'cfg.steps': 'steps',
  'cfg.kb': 'KB',
  'cfg.restart': 'After restart',
  'cfg.reset': 'Reset to default ({v})',
  'cfg.dirty': '{n} unsaved change(s)',
  'cfg.discard': 'Discard',
  'cfg.save': 'Save',
  'cfg.saved': 'Saved, in effect now',
  'cfg.savedRestart': 'Saved. Restart DSH for {keys} to take effect',
  'cfg.unavailable':
    'This DSH has no settings service, so this page is read-only. Edit the profile config file instead.',
  'cfg.readonly': 'This profile does not allow editing settings here.',
  'cfg.int': 'Enter a whole number',
  'cfg.min': 'Must be at least {n}',
  'cfg.required': 'Required',
}
