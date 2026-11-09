/**
 * dsh-workflow-lite — 线格式：`run/*` 端点形状：工作流实例、文件与产出浏览、存储统计。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/run
 */

import type { InstanceSummary, InstanceView, StateEdit } from '../runState.ts'
import type { InputAnswer, LineFilter, WorkflowDocument } from '../types.ts'

// ── 工作流实例 ─────────────────────

/** `run/list`：`session` 给了且 `all` 不为真时只列这个会话的。 */
export interface RunListRequest {
  session?: string
  all?: boolean
}
export interface RunListResponse {
  instances: InstanceSummary[]
  /** 请求方会话的当前实例。 */
  current?: string
}

/**
 * `run/latest`：模板画布上的展示卡要看「上次执行」的结果——这个工作流最近的几个实例里，
 * 同一个资源（id 相同）里同一个文件（路径原文相同）真的生成了的，取修改时间最新的那一份。
 */
export interface RunLatestRequest {
  workflow: string
  /** 最多 {@link RUN_STAT_MAX} 项；`value` 是模板里这一项的路径原文。 */
  targets: { node: string; value: string }[]
}
export interface RunLatestOutput {
  instance: string
  /** 这一项在那个实例的图里是第几项（读内容时用它）。 */
  item: number
  size: number
  mtime: number
}
export interface RunLatestResponse {
  /** 和 `targets` 一一对应；哪个实例里都没生成是 `null`。 */
  latest: (RunLatestOutput | null)[]
}

/** `run/latest` 往回看这个工作流最近建的几个实例。 */
export const RUN_LATEST_SCAN = 20

/** `run/load`：`since` = 上次拿到的 `mtime`，文件没变就只回 `unchanged`。 */
export interface RunLoadRequest {
  id: string
  session?: string
  since?: number
}
export type RunLoadResponse = InstanceView | { unchanged: true; mtime: number }

/** `run/bind`：设会话的当前实例（实例属于别的会话时转过来）。 */
export interface RunBindRequest {
  id: string
  session: string
}

/** `run/save`：保存用户在画布上攒的改动，并通知模型。 */
export interface RunSaveRequest {
  id: string
  session?: string
  edits: StateEdit[]
  /** 给模型的说明（可选）。 */
  note?: string
  /** `false` = 只保存、不通知模型（也不暂存通知）；缺省通知。 */
  notify?: boolean
  /** 改了图时：改之前那版的 planId 与改完的整张图（工作流设置不在实例里改，给了也不认）。 */
  graph?: { base: string; document: WorkflowDocument }
}
export interface RunSaveResponse {
  /** 通知送到模型了没有；没送到时模型下次调用工具会收到。 */
  notified: boolean
  mtime: number
  /** 改了图时：新图的 planId。 */
  planId?: string
  /** 没有通知模型：只改了不进计划的东西（挪卡片、描述），或者用户选了不通知。 */
  quiet?: true
}

/** `run/delete`：删实例记录与快照；`withState` 为真时连状态文件一起删。 */
export interface RunDeleteRequest {
  id: string
  withState?: boolean
}

/**
 * `run/start`：画布上的「执行」——用模板现在的样子建一个新实例，归到 `session`，
 * 回一句要发进那个会话的话（前端走会话输入框的标准发送流程发出去）。
 */
export interface RunStartRequest {
  workflow: string
  session: string
  /** 那个会话的工作区（状态文件建在这里、计划的「本次执行」也用它）。 */
  cwd?: string
  /** 用户在「执行」前对输入节点的回答（输入 id → 回答）；没回答的用默认值。 */
  answers?: Record<string, InputAnswer>
}
export interface RunStartResponse {
  instance: InstanceSummary
  prompt: string
}

/** `run/file` 整份带回正文的上限（字节）；再大只回元信息。 */
export const RUN_FILE_TEXT_MAX = 1024 * 1024

/** HTML 的上限单独放宽：报告、看板这类产出常有几 MB。 */
export const RUN_FILE_HTML_MAX = 8 * 1024 * 1024

/** 文件能怎么看：Markdown / HTML / 纯文本带正文；二进制、太大、不在、是个文件夹只有元信息。 */
export type RunFileKind =
  | 'markdown'
  | 'html'
  | 'text'
  | 'binary'
  | 'tooLarge'
  | 'missing'
  | 'folder'

/**
 * `run/file`：看实例里的一份文件。`node` + `item` = 快照里某个资源的第几项（文件）；
 * `path` = 实例工作区里的相对路径（状态文件 `outputs` 里写的）。工作区外的随手路径一律拒绝。
 */
export interface RunFileRequest {
  id: string
  node?: string
  item?: number
  path?: string
  /**
   * `node` + `item` 指向文件夹时，看文件夹里的哪一份：相对那个文件夹的路径（`/` 分隔，只能往下走，
   * 不许 `..`、不许落到文件夹外面——软链指出去的也不行）。
   */
  sub?: string
  /** `node` + `item` 指向文件时，看存下的第几版（{@link RunVersion.v}）；不给就是现在的文件。 */
  version?: number
  /** 纯文本太大时读最后一段（日志看最新的）而不是只回「太大」，见 {@link RunFileResponse.cut}。 */
  tail?: boolean
}
export interface RunFileResponse {
  /** 绝对路径（交给系统程序打开用）。 */
  path: string
  /** 给人看的路径（相对工作区）。 */
  display: string
  exists: boolean
  size: number
  mtime: number
  kind: RunFileKind
  /** `markdown` / `html` / `text` 时才有。 */
  text?: string
  limit: number
  /** 带 `tail` 读、文件太大时：前面没读的字节数（`text` 是从这之后到末尾）。 */
  cut?: number
}

/** `run/lines` 的筛选（和展示设置里存的是同一个形状）。 */
export type { LineFilter }

/** `run/lines` 一次最多要多少行。 */
export const RUN_LINES_MAX = 2000
/** 不筛时一次最多读多少字节（凑不够行数也停）。 */
export const RUN_LINES_PLAIN_BYTES = 1024 * 1024
/** 筛的时候最多扫多少字节、多久（扫到就停，回的结果说清楚只扫了多少）。 */
export const RUN_LINES_FILTER_BYTES = 64 * 1024 * 1024
export const RUN_LINES_FILTER_MS = 300

/**
 * `run/lines`：日志、纯文本按行读（画布上只拿要显示的那几行，不整份读）。定位同 {@link RunFileRequest}（`node` + `item`，
 * 文件夹里的一份带 `sub`，存下的一版带 `version`）。
 * - `tail`：从末尾往前要 `limit` 行；给了 `before`（上一回的 `start`）就是接着往上翻。
 * - `head`：从 `from`（缺省 0）往后要 `limit` 行。
 * - `follow`：从上一回的 `end` 起读新追加的（`tag` 是上一回给的指纹，对不上——文件被重写、截短过——就当 `tail` 重读，
 *   回答里没有 `appended`）。
 */
export interface RunLinesRequest {
  id: string
  node: string
  item?: number
  sub?: string
  version?: number
  mode: 'tail' | 'head' | 'follow'
  limit: number
  before?: number
  from?: number
  tag?: string
  /** `follow` + 带上下文筛：上一回最后一处匹配还欠几行下文（上一回的 `owed`）。 */
  owed?: number
  filter?: LineFilter
}

/** 一行。 */
export interface RunLine {
  /** 行首在文件里的字节位置。 */
  at: number
  /** 去掉了行尾换行、终端颜色码；太长的截到 4096 个字（`long`）。 */
  text: string
  /** 命中的几段：`[起, 止, 起, 止, …]`（字的下标）。 */
  hits?: number[]
  /** 是匹配行的上下文，自己不匹配。 */
  ctx?: true
  long?: true
  /** 和前一行（这一回的第一行：和读的起点）之间跳过了几行（筛掉的）。 */
  skip?: number
}

export interface RunLinesResponse {
  path: string
  display: string
  exists: boolean
  size: number
  mtime: number
  /** `lines` 才有行；二进制、UTF-16（不按行读，改用 `run/file`）、不在的只有元信息。 */
  kind: 'lines' | 'binary' | 'utf16' | 'missing'
  /** 按文件里的顺序。 */
  lines: RunLine[]
  /** 末尾还没写完（没有换行）的那一行：显示，但不算进 `end`，续读时写完了再给。 */
  pending?: RunLine
  /** 这一回扫过的范围（字节）：`start` 起、`end` 止（`end` 在行首）。往上翻带 `start`，往下、续读带 `end`。 */
  start: number
  end: number
  /** `end` 处的指纹（续读时带回来）。 */
  tag: string
  /** 最后一行之后、`end` 之前还扫过几行（筛掉的）。 */
  trail: number
  /** 扫过的范围里匹配了几行（不筛时 = 行数）。 */
  matched: number
  /** 这一回的方向上还有没扫的：`tail` = `start` 前面还有，`head` = `end` 后面还有。 */
  more: boolean
  /** 最后一处匹配还欠几行下文（续读时带回来）。 */
  owed?: number
  /** 扫到上限停下了：`bytes` 字节、`time` 时间。 */
  stopped?: 'bytes' | 'time'
  /** 续读时一下子多出太多，只给了最后那些：和上一回接不上。 */
  gap?: true
  /** 续读成功：这些行接在上一回后面。 */
  appended?: true
}

/** `run/image` 一张图的上限（字节）。 */
export const RUN_IMAGE_MAX = 8 * 1024 * 1024

/**
 * `run/image`：实例里一份 Markdown 引用的本地图片。文档用 `run/file` 的同一套定位（`node` + `item`
 * 或 `path`），`src` 是文档里写的相对路径，按文档所在目录解析。只认图片扩展名；解析出来的位置
 * 必须在实例工作区里，或在文档自己的目录下（产出根目录是工作区外的绝对路径时）。
 */
export interface RunImageRequest extends RunFileRequest {
  /** 不给就是目标文件自己（它得是张图）：文件夹里点开一张图用的。 */
  src?: string
}
export interface RunImageResponse {
  mime: string
  /** 图片字节的 base64。 */
  data: string
}

/** `run/stat` 一次最多问几份。 */
export const RUN_STAT_MAX = 64

/**
 * `run/stat`：快照里几个资源项（文件）现在的样子，只看在不在、大小、修改时间，不读内容。
 * 画布上展示着的卡隔一会儿问一次，变了才重读内容。
 */
export interface RunStatRequest {
  id: string
  targets: { node: string; item: number }[]
}
export interface RunStatResponse {
  /**
   * 按 `targets` 的顺序；定位不到（项不在快照里、越界）的当作不在。
   * `versions`：这一项存下了几版（见 {@link RunHistoryResponse}）；`revision`：各版每变一次（多存一版、
   * 记了一条判定）加一，变了再去问 `run/history`。
   */
  stats: { exists: boolean; size: number; mtime: number; versions: number; revision: number }[]
}

/**
 * 一份产出存下的一版。写它的步骤每一轮做完（完成或失败）存一版；在原文件上更新的、开始前就在的，
 * 第一次开始前先存一份原样（`phase: 'before'`）。和上一版一样的不存。
 */
export interface RunVersion {
  /** 版本号：这份文件里从 1 递增，删掉中间的也不重排。读这一版时带上它。 */
  v: number
  /** 写它的步骤。 */
  step: string
  /** 那个步骤的第几轮。 */
  round: number
  phase: 'before' | 'done' | 'failed'
  /** 存下的时间（毫秒）。 */
  at: number
  size: number
  /** 存的时候原文件的修改时间：和现在的文件对得上 = 现在就是这一版。 */
  mtime: number
  /** 读过（或写了）这一版之后给出的判定；`again` = 这个判定把流程领回去重做。 */
  verdicts?: { step: string; value: string; again: boolean }[]
}

/** `run/history`：快照里一个资源项（文件）存下的各版，旧的在前。 */
export interface RunHistoryRequest {
  id: string
  node: string
  item?: number
}
export interface RunHistoryResponse {
  versions: RunVersion[]
  /** 超了上限、从中间删掉的版数（第一版和最近的留着）。 */
  dropped: number
}

/** 一份产出最多存几版（超了删中间的，第一版留着）。 */
export const RUN_HISTORY_VERSIONS_MAX = 20

/** 一份文件超过这么大就不存了（反正也只能这么大才看得了）。 */
export const RUN_HISTORY_FILE_MAX = 8 * 1024 * 1024

/** 一个实例存的各版加起来最多这么大（超了从版数最多的那份删中间的）。 */
export const RUN_HISTORY_INSTANCE_MAX = 100 * 1024 * 1024

/** `run/dir` 一次最多列多少项。 */
export const RUN_DIR_MAX = 3000

/**
 * `run/dir`：看资源里一个文件夹（及它下面的子文件夹）里有什么。`node` + `item` 定位文件夹项，
 * `sub` 是往下走的相对路径（缺省 = 文件夹本身），规矩同 {@link RunFileRequest.sub}。
 */
export interface RunDirRequest {
  id: string
  node: string
  item?: number
  sub?: string
}

export interface RunDirEntry {
  name: string
  dir: boolean
  /** 字节数；文件夹是 0。 */
  size: number
  mtime: number
  /** 子文件夹里有几项、其中几张图（只数一层；子文件夹多时只数前 {@link RUN_DIR_COUNTED} 个）。 */
  items?: number
  images?: number
}

/** 一层里最多数几个子文件夹的项数。 */
export const RUN_DIR_COUNTED = 64
export interface RunDirResponse {
  /** 这一层的绝对路径。 */
  path: string
  /** 给人看的路径。 */
  display: string
  /** 整理过的 `sub`（`/` 分隔、没有首尾斜杠；根是空串）。 */
  sub: string
  /** 目录在不在（不在时 `entries` 为空）。 */
  exists: boolean
  /** 目录在前、各自按名字排（数字按大小）；`.` 开头的也列。 */
  entries: RunDirEntry[]
  /** 条目太多只列了一部分。 */
  truncated: boolean
}

/** `run/storage`：存储统计与清理。 */
export interface RunStorageRequest {
  action?: 'stats' | 'clearDispatch' | 'clearFinished' | 'clearHistory'
}
export interface StorageStats {
  dataDir: string
  /** `workflows/` 下的文件数与字节数。 */
  workflows: number
  workflowBytes: number
  /** 我的步骤（`templates/nodes/`）。 */
  templates: number
  templateBytes: number
  /** 工作流版本（`versions/`）。 */
  versions: number
  versionBytes: number
  /** 记忆库里几条；占用连同记忆的版本（`memories/` + `memory-versions/`）。 */
  memories: number
  memoryBytes: number
  instances: number
  /** 已结束（完成 / 已取消）的实例数。 */
  finished: number
  /** 实例在数据目录里的占用（`runs/` 下的图快照与回答；工作区里的实例目录不算）。 */
  instanceBytes: number
  /** 其中各实例存下的产出各版（`runs/<实例>/history/`）占多少。 */
  historyBytes: number
  /** 旧版本遗留的任务描述（`.dispatch/`），现在已不再读写。 */
  dispatchFiles: number
  dispatchBytes: number
  /** 这次清理删掉了几项（只在清理动作里有）。 */
  cleared?: number
}
