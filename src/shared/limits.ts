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

/** 派发计划的段标记（字节稳定的前缀契约）。 */
export const PLAN_SECTIONS = {
  protocol: '## 你拿到的是什么',
  facts: '## 图的事实',
  discipline: '## 分发纪律',
  contract: '## 交付契约',
  dynamic: '## 本次执行',
  notes: '## 图的注意事项',
  runState: '## 运行状态',
} as const
