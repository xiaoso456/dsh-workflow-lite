/**
 * dsh-workflow-lite — 字面约束与默认值。
 *
 * 这里放**格式契约里写死的字面量**（字符集、长度上限、键序之外的那些数）。
 * 随部署变化的取值**不在这里**——那些一律是 Config 字段（见 `shared/config.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/limits
 */

/** 工具名（唯一工具）。 */
export const TOOL_NAME = 'workflow_lite'

/** 派发目录名。写死、不做配置键；启动时**不**创建，编译时才建。 */
export const DISPATCH_DIR = '.dispatch'

/** 图目录名（`dataDir` 下的固定子目录）。 */
export const WORKFLOWS_DIR = 'workflows'

/** 模板目录名。 */
export const TEMPLATES_DIR = 'templates'

/** 工作流版本目录名：`versions/<图名>/<序号>.json`（不在 `workflows/` 下——那里的子目录算旧结构）。 */
export const VERSIONS_DIR = 'versions'

/**
 * 工作流资料目录：`assets/<图名>/`。图里写 `{assets}/…` 的文件就放在这里，导出时整个目录打进包、
 * 导入时解压回来；改名、删除工作流时跟着走。
 */
export const ASSETS_DIR = 'assets'

/** 导入导出的暂存区（以 `.` 开头，一切扫描天然忽略）：`.pack/<token>/`。 */
export const PACK_DIR = '.pack'

/** 一个工作流最多留几个版本（到了就先删掉旧的再存）。 */
export const MAX_VERSIONS = 100

/** 版本说明的长度上限（码点）。 */
export const MAX_VERSION_NOTE_CODEPOINTS = 500

/** 自动布局 / 归一化后的坐标小数位。 */
export const COORD_DECIMALS = 2

/** 名字长度上限（码点）。适用于图名 / 模板名 / `node.id`。 */
export const MAX_NAME_CODEPOINTS = 64

/**
 * `when` 值长度上限（码点）。
 *
 * 这是软编排：条件可以是一句、一段自然语言（"测试全绿且没有新增警告"），由执行者自己判断。
 * 上限只防病态输入。
 */
export const MAX_WHEN_CODEPOINTS = 2000

/**
 * 判定词（走 `VERDICT: <值>` 约定的那种）的长度上限。短标识（pass / fail / retry）是判定词，
 * 其余的是自然语言条件——编译器对两者的写法不同，见 `isVerdictWhen`。
 */
export const MAX_VERDICT_CODEPOINTS = 32

/** 一个节点的描述 / 一条产出规则的长度上限（码点）——同样只防病态输入。 */
export const MAX_TEXT_CODEPOINTS = 2000

/** 工作流设置里「产出根目录」的长度上限（码点）。 */
export const MAX_ROOT_CODEPOINTS = 1024

/** `label` 长度上限（码点）——只防病态输入，不参与任何判定。 */
export const MAX_LABEL_CODEPOINTS = 200

/** 一个资源最多放几项。 */
export const MAX_RESOURCE_ITEMS = 50

/** 资源里一条路径 / 网址的长度上限（码点）。 */
export const MAX_VALUE_CODEPOINTS = 2048

/** 资源里一段自定义提示词的长度上限（码点）——它本身就是一段提示词，给得宽一些。 */
export const MAX_RESOURCE_TEXT_CODEPOINTS = 20000

/** 一个选择题最多几个选项（再多就不是执行前顺手点一下的事了）。 */
export const MAX_OPTIONS = 30

/**
 * Windows 文件名非法字符。`node.id` / 图名 / 模板名共用这一套（它们都要落成文件名）。
 * 注意：`|` 也在这里——它同时会打断计划里的 markdown 表格，`label` 另有单列规则。
 */
export const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*]/

/** 控制字符（含 DEL）。**这里就是要匹配它们**——它们是名字里必须被拒的字符类。 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 本条正则的用途正是识别控制字符
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** Windows 保留名（**大小写不敏感**）；带扩展名的形式也算，如 `con.json`。 */
export const WINDOWS_RESERVED = new Set(
  [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
  ].map((n) => n.toLowerCase()),
)

/** 原子写的临时文件前缀——以 `.` 开头，一切扫描天然忽略。 */
export const TMP_PREFIX = '.tmp-'

/** 预置的分支判定值（自由文本 `when` 也允许，只是无法推断穷尽性）。 */
export const WELL_KNOWN_WHEN = ['pass', 'fail'] as const

/** `VERDICT` 约定的固定形态：`VERDICT: <值>`（顶格、大写、半角冒号 + 一个空格）。 */
export const VERDICT_PREFIX = 'VERDICT: '

/** 派发计划的段标题，按出现顺序（没有内容的段不出现）。 */
export const PLAN_SECTIONS = {
  overview: '## 概览',
  run: '## 本次执行',
  /** 动手前要做的事：设目标、（skill）问用户、查依赖、记进度。 */
  before: '## 开始之前',
  execution: '## 怎么执行',
  /** 路径、产出写到哪、资源怎么用、「产出 / 更新」的定义。 */
  conventions: '## 约定',
  flow: '## 流程',
  resources: '## 资源',
  notes: '## 注意事项',
  runState: '## 运行状态',
  /** 只在整卷版里有：逐步骤内联的提示词原文。 */
  bodies: '## 步骤正文',
} as const

/** 任务描述末尾各段的标题（提示词原文之后）。 */
export const TASK_SECTIONS = {
  /** 连到这一步（或没连、交给所有步骤）的输入节点：问题与回答。 */
  inputs: '## 用户输入',
  /** 交给所有步骤的资源。 */
  global: '## 通用约定',
  resources: '## 这一步的资源',
  reply: '## 回复',
} as const
