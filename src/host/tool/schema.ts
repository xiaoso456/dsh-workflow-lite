/**
 * dsh-workflow-lite — `workflow_lite` 工具给模型看的那一面：工具说明（`DESCRIPTION`）与参数声明（`PARAMETERS`）。
 *
 * 这两段文字模型逐字读到，改措辞就是改工具的行为；参数的 TypeScript 形状在 `args.ts`，两边要同构。
 * @module @xiaoso/dsh-workflow-lite/host/tool/schema
 */

import { FOLDER_ORDER_CHOICES, LOOK_CHOICES, VIEW_SIZE_KEYS } from '../../shared/display.ts'
import { DEFAULT_OUTPUT_ROOT, WORKSPACE_ROOT } from '../../shared/outputPaths.ts'
import { INSTANCE_VAR } from '../../shared/pathVars.ts'
import { NODE_STATUSES, RUN_STATUSES } from '../../shared/runState.ts'
import {
  ACTIONS,
  EXECUTION_MODES,
  FOLDER_SHOWS,
  GALLERY_LAYOUTS,
  INPUT_KINDS,
  MEMORY_TYPES,
  RESOURCE_KINDS,
  REUSE_POLICIES,
  VIEW_FITS,
  VIEW_FROMS,
} from '../../shared/types.ts'

export const DESCRIPTION = [
  '管理轻量工作流的图文件：一张图 = 一个 JSON（React Flow 原生 nodes/edges/viewport），',
  '每个节点的提示词内联在 node.data.prompt 里。用 action 选动作：',
  'list 列出图与节点模板 / read 读图（不给 node 只回索引与 problems / warnings、绝不含正文；给 node 才回那一个节点的正文）/ ',
  'compile 编译成派发计划：建一个工作流实例，各步骤的任务描述写进工作区的 .workflow-lite/runs/<实例>/tasks/，只在真要执行时用（模型据此自己组织执行）；full=true 是整卷预览，不建实例、不写文件。',
  '检查图有没有问题用 read 和 compile full=true，不要用不带 full 的 compile——每调一次就多一个实例 / ',
  'create 新建一张空图 / write_node 新建或覆盖一个节点 / set_label 改显示名（id 不可改）/ ',
  'delete_node 删节点（连带删边）/ connect、disconnect 增删边 / rename_workflow、delete_workflow 改名删图 / ',
  'save_as_template 把一个步骤存成节点模板（画布步骤库的「我的步骤」）/ ',
  'configure 改工作流设置（output_root 产出根目录、mode 执行方式、reuse 复用执行者、set_goal 设定目标、run_state 记录运行状态）/ write_resource 新建或修改资源节点（带 memory 是加一张记忆卡）/ ',
  'runs 列工作流实例 / resume 拿一个实例的计划接着跑 / state 看或改实例的运行状态（开了 run_state 的图按计划末尾「运行状态」段用它记进度，不要直接编辑状态文件；插件补时间、轮次、流水并校验）。',
  '用户在画布上点「执行」时会发来一句带实例 id 的话：用 resume 拿那个实例的计划，照着执行。',
  '资源是独立的节点，一个资源里可以放好几项（file 文件、folder 文件夹、url 网址、skill、text 自定义）：',
  'connect 步骤 → 资源 = 写它（写其中的文件与文件夹；update 选在原文件上更新），资源 → 步骤 = 读它，一条线都没连的资源交给整个工作流；',
  'write_node 的 output/outputs 也会自动建好放着这个文件的资源并连上。步骤 → 步骤的线缺省交上游的执行结果（handoff / handoff_note 可改）。',
  '记忆是跨多次执行攒下来的做法（一份 skill 文件夹，放在插件的记忆库里）：工作流记忆整个流程共用，步骤记忆只给那一步。',
  'write_resource 带 memory 加记忆卡（引用 list 里已有的一条，或新建一条）。只给大型、复杂、会反复执行的工作流加，加之前读 skill workflow-authoring 的「记忆」一节。',
  '资源卡可以在画布上直接展示其中一项：write_resource 或 write_node 的 outputs 带 display（什么适合展示、各项怎么配见 skill workflow-authoring 的「在画布上展示」）。',
  '输入节点是执行前问用户的问题：write_node 带 input 新建或修改，connect 输入 → 步骤 = 把回答交给它。',
  '图里有输入节点时，compile 带 answers 给出用户的回答（没给的用默认值）；必填的没回答会回 problems，先问用户再编译。',
  '节点定位一律用 id。',
  '新建或修改图之前先读 skill workflow-authoring（步骤怎么拆、产物怎么传、资源说明怎么写、建完怎么自检）。',
].join('')

/** `display`（write_resource 的 resource 里、write_node 的 outputs 每项里）：在画布上展示资源里的一项。 */
const DISPLAY_PARAMETER = {
  type: 'object',
  description:
    '在画布上展示这个资源里的一项（图片、HTML、Markdown、文本、文件夹），给了的字段才改。详见 skill workflow-authoring 的「在画布上展示」。',
  additionalProperties: false,
  properties: {
    show: { type: 'boolean', description: 'false = 关掉展示。' },
    size: {
      type: 'string',
      enum: [...VIEW_SIZE_KEYS],
      description: '预设尺寸，缺省 m；一般用 s 或 m。',
    },
    width: { type: 'number', description: '展示区宽（画布像素），优先于 size；一般用 size。' },
    height: { type: 'number', description: '展示区高（画布像素）。' },
    zoom: { type: 'number', description: '缩放百分比，缺省 100，一般不动。' },
    fit: { type: 'string', enum: [...VIEW_FITS], description: '图片怎么放，缺省 contain。' },
    item: { type: 'number', description: '展示第几项（从 0 数）。' },
    adapt: { type: 'boolean', description: '写它的步骤按卡片适配产出，缺省 true。' },
    look: { type: 'string', enum: [...LOOK_CHOICES], description: '卡片外观，不写跟着用户设置。' },
    hideTitle: { type: 'boolean', description: '不选中、不悬停时藏起标题。' },
    lines: {
      type: 'object',
      description: '日志、纯文本怎么看。',
      additionalProperties: false,
      properties: {
        from: {
          type: 'string',
          enum: [...VIEW_FROMS],
          description: '看末尾还是开头，不写 = 自动。',
        },
        filter: { type: 'string', description: '只显示含这段字的行，空串 = 不筛。' },
        regex: { type: 'boolean', description: 'filter 按正则。' },
        context: { type: 'number', description: '匹配前后各带几行。' },
      },
    },
    table: {
      type: 'object',
      description: 'CSV / TSV 怎么看。',
      additionalProperties: false,
      properties: {
        from: {
          type: 'string',
          enum: [...VIEW_FROMS],
          description: '看末尾还是开头，不写 = 自动。',
        },
        hide: { type: 'array', items: { type: 'string' }, description: '卡片里藏起的列名。' },
        sort: { type: 'string', description: '按哪列排，空串 = 不排。' },
        desc: { type: 'boolean', description: '从大到小。' },
        bars: { type: 'boolean', description: '数字列画浅条。' },
      },
    },
    folder: {
      type: 'object',
      description: '文件夹怎么展示。',
      additionalProperties: false,
      properties: {
        show: { type: 'string', enum: [...FOLDER_SHOWS], description: '图片墙或文件列表。' },
        layout: { type: 'string', enum: [...GALLERY_LAYOUTS], description: '图片墙的排法。' },
        order: {
          type: 'string',
          enum: [...FOLDER_ORDER_CHOICES],
          description: '排序，缺省 newest。',
        },
        match: { type: 'string', description: '只看名字对得上的，如 *.png。' },
      },
    },
  },
} as const

/** 工具的参数声明（隐式开放对象根；`required` 内联写）。导出供测试直接编译成 JSON Schema 校验。 */
export const PARAMETERS = {
  action: {
    type: 'string',
    enum: [...ACTIONS],
    required: true,
    description: '要做的动作。',
  },
  workflow: { type: 'string', description: '图名（不带 .json）。除 list 外都需要。' },
  node: {
    type: 'string',
    description: '节点 id（read / write_node / set_label / delete_node / save_as_template）。',
  },
  content: {
    type: 'string',
    description: 'write_node：节点提示词正文（允许空串，但空正文是编译级）。',
  },
  label: {
    type: 'string',
    description: 'write_node / set_label：显示名。不要求唯一；空串 = 清除（回落显示 id）。',
  },
  output: { type: 'string', description: 'write_node：产出契约（相对工作区根的路径）。' },
  outputs: {
    type: 'array',
    description:
      'write_node：一个或多个产出，每个可带生成规则（规则附在写它的步骤的任务描述里）。给了它就整份替换 output。',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', required: true, description: '相对工作区根的产出路径。' },
        rule: {
          type: 'string',
          description: '这份产出该怎么写：结构、必须包含什么、长度上限（进资源说明）。',
        },
        display: DISPLAY_PARAMETER,
      },
    },
  },
  description: {
    type: 'string',
    description: 'write_node：一句话说明这一步做什么（给人看，不进计划）；空串 = 清除。',
  },
  no_output: {
    type: 'boolean',
    description: 'write_node：true ⇒ 显式声明本节点不产出文件（写 output: false）。',
  },
  from_template: {
    type: 'string',
    description:
      'write_node：从 templates/nodes/<名>.json 取 data 本体（不复制它的 id 与 position）。',
  },
  to: {
    type: 'string',
    description: 'rename_workflow：新图名 / save_as_template：节点模板名（缺省 = 步骤 id）。',
  },
  source: { type: 'string', description: 'connect / disconnect：源节点 id。' },
  target: { type: 'string', description: 'connect / disconnect：目标节点 id。' },
  when: {
    type: 'string',
    description:
      'connect / disconnect：条件（缺省 = 无条件边）。短判定词（pass / fail）走 VERDICT 约定；也可以写一句自然语言条件，由执行者判断。',
  },
  handoff: {
    type: 'string',
    enum: ['result', 'none'],
    description:
      'connect（步骤 → 步骤）：result（缺省）把上游这一次的执行结果交给下游 / none 只管先后。边已存在时只改交接。',
  },
  handoff_note: {
    type: 'string',
    description:
      'connect（步骤 → 步骤）：交接说明——下游拿到执行结果之后怎么用（进派发计划）；空串 = 清除。',
  },
  update: {
    type: 'boolean',
    description:
      'connect（步骤 → 资源）：true = 在原文件上更新（先读再改，如修完在问题清单里打钩）；false = 整份写出。缺省：资源还没人写就是整份写出，已经有人写就是更新。',
  },
  memory: {
    type: 'object',
    description:
      'write_resource：加一张记忆卡（不带 node / resource）。给了 id 且库里有就引用那一条，否则新建一条；不给 id 就按工作流名起名。只给大型、复杂、会反复执行的工作流加。',
    additionalProperties: false,
    properties: {
      type: {
        type: 'string',
        enum: [...MEMORY_TYPES],
        description:
          'workflow 工作流记忆（整个流程共用，不连线）/ step 步骤记忆（只给 step 那一步）。缺省：给了 step 就是 step；引用已有的按库里的类型。',
      },
      id: {
        type: 'string',
        description: '记忆库里的 id（list 的 memories 里有）；库里没有就用它新建。',
      },
      step: { type: 'string', description: '步骤记忆挂在哪一步（步骤 id）。' },
      name: { type: 'string', description: '新建时的名称（给人看；缺省 = id）。' },
      description: { type: 'string', description: '新建时的一句话描述（给人看）。' },
    },
  },
  resource: {
    type: 'object',
    description:
      'write_resource：资源的内容（给了 node 就是修改那个资源，给了的字段才改；没给 node 就是新建）。',
    additionalProperties: false,
    properties: {
      label: { type: 'string', description: '名字（计划里称呼它）；空串 = 清除。' },
      description: { type: 'string', description: '一句话描述（给人看，不进计划）；空串 = 清除。' },
      items: {
        type: 'array',
        description:
          '全部内容（整份替换），按顺序。同类、读写关系相同的资料放进同一个资源的多项里，不要一项建一个资源。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              enum: [...RESOURCE_KINDS],
              required: true,
              description:
                'file 文件 / folder 文件夹（value 是路径：绝对路径原样用；相对路径有步骤写它时在产出根目录下，只被读时相对工作区）/ url 网址 / skill（value 是 skill 名）/ text 自定义（value 是用户自己写的一段提示词，原样交给读它的步骤）。',
            },
            value: {
              type: 'string',
              required: true,
              description: '路径 / 网址 / skill 名 / 正文。',
            },
            note: {
              type: 'string',
              description:
                '这一项怎么用。写入的文件写成规格：结构、长度上限；更新的再写明哪些部分就地改写、记录表每次加一行的格式。text 不用。',
            },
          },
        },
      },
      display: DISPLAY_PARAMETER,
    },
  },
  goal: {
    type: 'string',
    description: 'compile：本次目标（用户说了要做成什么时写，进计划的「本次执行」段）。',
  },
  full: {
    type: 'boolean',
    description: 'compile：true = 整卷预览（内联正文，不建实例、不写文件）；建图后自检用它。',
  },
  output_root: {
    type: 'string',
    description: `configure：产出根目录（相对工作区或绝对路径），编译时拼在每个产出文件前面；${INSTANCE_VAR} 换成实例 id。空串 = 清除（默认 ${DEFAULT_OUTPUT_ROOT}），${WORKSPACE_ROOT} = 工作区根目录。`,
  },
  run_state: {
    type: 'boolean',
    description:
      'configure：记录运行状态。打开后每个工作流实例都带一份运行状态，执行时按计划末尾「运行状态」段用 state 记进度。',
  },
  instance: {
    type: 'string',
    description: 'resume / state：实例 id（缺省 = 本会话当前的实例；用户从画布上执行时会给出）。',
  },
  status: {
    type: 'string',
    enum: [...RUN_STATUSES],
    description: 'state：整体状态。',
  },
  note: {
    type: 'string',
    description:
      'state：整体的一句说明（waiting 写等什么、failed / cancelled 写原因）；空串 = 清掉。',
  },
  nodes: {
    type: 'array',
    description:
      'state：要改的步骤，每项一个。改 status 时插件自动补轮次、开始 / 结束时间和流水；done 带 summary、outputs，有条件出边的带 verdict（取它出边的条件值）；failed 带 error。',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true, description: '步骤 id（大小写与图一致）。' },
        status: { type: 'string', enum: [...NODE_STATUSES], description: '步骤状态。' },
        summary: { type: 'string', description: '一两句结论（200 字以内）；空串 = 清掉。' },
        outputs: {
          type: 'array',
          items: { type: 'string' },
          description: '这一轮实际写出的文件路径（照计划里给的路径写）。',
        },
        verdict: { type: 'string', description: '判定：它出边的条件值之一（如 pass / fail）。' },
        error: { type: 'string', description: '失败原因。' },
        by: { type: 'string', description: '谁做的：self / subagent / 队员名。' },
      },
    },
  },
  log: { type: 'string', description: 'state：往流水追加一条说明。' },
  input: {
    type: 'object',
    description:
      'write_node：给了它就是新建或修改一个输入节点（执行前问用户的问题；问题与回答进计划，占位与说明只给填写的人看）。',
    additionalProperties: false,
    properties: {
      question: { type: 'string', description: '问题（一行）；新建时必填。' },
      kind: {
        type: 'string',
        enum: [...INPUT_KINDS],
        description: 'text 一句话（缺省）/ textarea 多行 / choice 单选 / multi 多选。',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '选项（choice / multi）。',
      },
      default: { type: 'string', description: '默认值（文字题的预填文字、单选的一个选项）。' },
      defaults: { type: 'array', items: { type: 'string' }, description: '多选的默认选项。' },
      placeholder: { type: 'string', description: '输入框里的灰字；空串 = 清除。' },
      hint: { type: 'string', description: '填写时显示的说明；空串 = 清除。' },
      required: { type: 'boolean', description: '必填。' },
      other: {
        type: 'boolean',
        description:
          '允许用户自己填写（choice / multi）：可以不选选项，改填自己的答案；计划里会注明是用户自填。',
      },
    },
  },
  answers: {
    type: 'array',
    description:
      'compile：用户对输入节点的回答，每项一个；没给的用默认值。用户在画布上点「执行」时已经填过，不用再给。',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true, description: '输入节点 id。' },
        value: { type: 'string', description: '文字题、单选的回答。' },
        values: { type: 'array', items: { type: 'string' }, description: '多选选中的项。' },
      },
    },
  },
  all: { type: 'boolean', description: 'runs：true = 列所有会话的实例（缺省只列本会话的）。' },
  mode: {
    type: 'string',
    enum: [...EXECUTION_MODES],
    description:
      'configure：执行方式。auto 由主 agent 决定 / serial 本人串行 / subagent 主 agent 派子代理 / team 主 agent 当 Agent Team 的 Lead。',
  },
  reuse: {
    type: 'string',
    enum: [...REUSE_POLICIES],
    description:
      'configure：复用执行者——同一个步骤再次执行（循环下一轮、重试、中断后继续）交给谁。auto 由主 agent 决定 / reuse 交回上次做它的子代理或队员，带着之前的上下文 / fresh 每次新派，上下文干净。serial 时不起作用。',
  },
  set_goal: {
    type: 'boolean',
    description:
      'configure：设定目标（缺省开）。开着时计划让主 agent 开始前用 create_goal 把这次执行设成会话目标，做完标记完成；长流程不会做一半就停。',
  },
} as const
