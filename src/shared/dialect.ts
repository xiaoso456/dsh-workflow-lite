/**
 * dsh-workflow-lite — 编译口径：计划里**跟执行环境有关**的那些话，各写两套。
 *
 * - **DSH 口径**（{@link DSH_DIALECT}）：插件里执行。可以点名 DSH 的工具和插件的动作——`subagent`、
 *   Agent Team 的 `spawn_teammate` / `send_message` / `wait_agent`、`create_goal` / `update_goal`、
 *   skill 工具、`workflow_lite` 的 `state` / `resume`。运行状态由插件建好、经 `state` 动作改。
 * - **通用口径**（{@link PORTABLE_DIALECT}）：导出成 skill，在哪个 agent 里跑都行。不点名任何工具和方法，
 *   只说要做成什么（"用你的环境里派子代理的方式"）；运行状态是工作区里的一份 YAML，由模型自己建、自己改。
 *
 * 编译器（`shared/compile.ts`）只管和环境无关的部分（图、流程、资源、交接），凡是要点名工具、方法、
 * 插件行为的句子都从这里取。加一条工作流设置或改一句措辞时，两套一起改；`tests/shared/dialect.spec.ts`
 * 把所有设置都打开、用通用口径编译，扫一遍计划和任务描述里有没有 {@link DSH_ONLY_TERMS}。
 *
 * 纯数据与纯函数，不碰磁盘、不 import DSH 包。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/dialect
 */

import { BOARD_ATTR, BOARD_SKILL, type BoardCardRoom } from './board.ts'
import { type DisplayBrief, IMAGE_MIN_FONT, IMAGE_MIN_STROKE } from './display.ts'
import { PLAN_SECTIONS } from './limits.ts'
import { INSTANCE_VAR } from './pathVars.ts'
import type { ExecutionMode, ReusePolicy } from './types.ts'

/** 「运行状态」段要的东西。 */
export interface RunStateFacts {
  /** 实例 id（DSH：建好的实例；预览与通用口径是 `{instance}`）。 */
  instance: string
  /** 工作流名。 */
  workflow: string
  /** 步骤 id，按执行顺序。 */
  steps: readonly string[]
  /** 串行：你本人逐个做、不派给别人，就不提子代理、队员。 */
  solo?: boolean
}

/** 谁来记状态：派给别人做时，交代他们把结论报回来、由你写。 */
function recorderLine(lead: string, tail: string, solo: boolean | undefined): string {
  return solo === true ? `- **${lead}**` : `- **${lead}** ${tail}`
}

export interface Dialect {
  id: 'dsh' | 'portable'
  /** 「怎么执行」的执行方式。 */
  mode: Record<ExecutionMode, string>
  /** 「怎么执行」的复用执行者（`auto` 不写）。 */
  reuse: Record<Exclude<ReusePolicy, 'auto'>, string>
  /** 「开始之前」：把这次执行设成要完成的目标（设置里「设定目标」开着时）。 */
  goalStep: (workflow: string) => string
  /** 「约定」：资源怎么用（包里没有带 skill 时）。 */
  resourceRule: string
  /** 资源里没打包的 Skill 后面那句括注。 */
  loadSkill: string
  /** 「开始之前」：要在本机装好的 skill（导出成 skill 才有）。 */
  needsStep: (names: string) => string
  /** 「开始之前」：这次要记运行状态。 */
  runStateStep: string
  /** 「运行状态」段，整段。 */
  runState: (facts: RunStateFacts) => string[]
  /**
   * 任务描述里写它的资源开了画布展示时，交代产出要适配卡片（DSH 才有画布；通用口径是 `null`）。
   * 编译器把它接在资源内容后面；资源里不止一项时 `target` 是展示的那个文件（已写成行内代码）。
   */
  display: (brief: DisplayBrief, target?: string) => string | null
}

function code(text: string): string {
  return `\`${text}\``
}

// ─────────────────────────────────────────────────────────────
// DSH 口径
// ─────────────────────────────────────────────────────────────

/** 派子代理 / 建团队的工具不在时的退路。 */
const DSH_MODE_FALLBACK = '这些工具不可用时，先告诉用户，再改成你本人逐个执行。'

/**
 * 「运行状态」段（DSH）：用 `state` 动作记进度、谁记、什么时候记、怎么接着跑。
 * 字段全表与例子在 skill `workflow-run-state`，这里只放执行时离不开的规矩。
 */
export function dshRunStateLines(facts: Pick<RunStateFacts, 'instance' | 'solo'>): string[] {
  const id = facts.instance
  return [
    PLAN_SECTIONS.runState,
    `这次执行要记进度：实例 ${code(id)} 的状态插件已经按初始状态建好，用户在画布上实时看着它。`,
    '',
    `- **用 \`workflow_lite\` 的 \`state\` 动作记，不要直接编辑状态文件。** 插件替你补时间、轮次和流水，改动当场校验，不合法会被拒绝并说明原因；不带改动调用就是查看当前状态。`,
    recorderLine(
      '由你来记。',
      '子代理、队员不调用它——派发时告诉他们做完把结论、判定和产出路径报给你。',
      facts.solo,
    ),
    '- **什么时候记**：开始执行时整体 `status: running`；派发一个步骤之前把它改成 `running`；它做完改成 `done`（带 `summary`、实际写出的 `outputs`（照计划里给的路径写），有条件出边的带 `verdict`）或 `failed`（带 `error`）；分支没走到的改成 `skipped`；要等用户回答时改成 `waiting` 并在 `note` 写等什么；全部走完整体 `status: done`。同一批次并行派出的几个步骤可以一次改。',
    `- 例：\`{"action":"state","instance":"${id}","nodes":[{"id":"scan","status":"done","summary":"找到 3 处问题"}]}\``,
    `- **核对位置**：\`state\` 每次都回 \`last\`（最后执行的步骤）和 \`next\`（接下来该做的步骤，带第几轮）——插件按图、判定和流水推出来，循环回到哪一步、第几轮都算好了；用户指定了下一步时（reason 是 \`pinned\`）先做指定的。你要做的和 \`next\` 对不上时，先停下核对。`,
    `- **中断后继续**：调用 \`resume\`（instance=${id}）拿回计划和进度，**照进度里的 \`next\` 接着做**（\`hint\` 是一句话的说明），不要按清单顺序找第一个没完成的步骤——循环里每步都做过、都是 \`done\`，那样会跳出环。停在 \`running\` 的步骤视为被打断，重做这一轮。`,
    '- **用户改了状态**：会收到一条「用户修改了运行状态」的通知，列出改了什么。照最新的状态调整：改回 `pending` 的步骤要重新执行，`skipped` 的不再执行，整体是 `waiting` 就停下来问用户、`cancelled` 就结束。',
    '- 字段的完整含义与更多例子在 skill `workflow-run-state` 里，拿不准时去读。',
  ]
}

/**
 * 画布展示（DSH）：卡片里看得到多少，以及产出要怎么写才能在卡片里和单独打开时都好看。
 * 网页的几条硬限制来自卡片的渲染方式：页面用 `srcdoc` 放进只开了脚本的沙箱，没有自己的源——
 * 相对路径的文件读不到、localStorage / cookie 一碰就抛错；CDN 上的脚本能加载。
 */
/** 图片缩进卡片后还看得清：少画、字大线粗（按两倍分辨率出图时的像素）。 */
const IMAGE_FIT = `卡片很小，一张图只讲一件事（一组对比或一条趋势），标注、刻度从简，细节写进文字产出；文字不小于 ${IMAGE_MIN_FONT} px、线条不细于 ${IMAGE_MIN_STROKE} px。`

/** 这张卡的卡片版放得下多少，写给模型照着定量（数是按模板的版式估的）。 */
function boardRoomText(room: BoardCardRoom): string {
  const rows = `约 ${room.stats} 行指标行或 ${room.list} 行列表（对比条 ${room.bars} 行）`
  if (room.small)
    return `这是小卡，只显示标题行和 \`.main\`（\`.side\` 隐藏）：主体约 ${room.width}×${room.height} px，放得下${rows}；`
  if (room.columns === 2)
    return `标题行下面的主体约 ${room.height} px 高、分左右两栏，右栏约 ${room.width} px 宽，一栏放得下${rows}；`
  return `标题行下面的主体约 ${room.width}×${room.height} px、单栏，主组件和次要的上下排，一共放得下${rows}，主组件占的高度要扣掉；`
}

/** 文件夹只显示名字对得上的那些时，告诉写它的步骤文件名要对得上。 */
function matchText(match: string | undefined): string {
  return match === undefined ? '' : `（卡片只显示名字对得上 ${code(match)} 的，文件名照这个起）`
}

export function dshDisplayLine(brief: DisplayBrief, target?: string): string {
  const lead = target === undefined ? '**画布展示**：' : `**画布展示**（${target}）：`
  switch (brief.kind) {
    case 'html':
      return `${lead}这个文件是一张看板，直接显示在画布的卡片里（卡片里页面的视口约 ${brief.layoutWidth}×${brief.firstScreen} px），用户也会点开、在浏览器里单独打开它。先用 skill 工具加载 \`${BOARD_SKILL}\`，照里面的模板写（样式和末尾的脚本照抄）。要点：在卡片里 \`<html>\` 带 \`${BOARD_ATTR}="card"\`，这时只显示卡片版——一张卡只回答一个问题，正好铺满这一屏、不滚动：一行淡字标题（写哪一期、哪一个）、写着结论的徽标、一个主组件（主数字、进度环、对比条、状态格……），旁边放次要的（指标行、短列表）。${boardRoomText(brief.room)}照这个量写满，再多写一两行标 \`data-drop\`（放不下时脚本会收起），别在底下留一截空白；字号照模板，和画布上的步骤卡片一样大（只有主数字随卡片变大），卡片大了多放内容、不放大字；其余情况显示完整版（全部指标、图表、明细，宽度自适应）。颜色、圆角、字体一律用 \`--board-*\` 变量（插件按画布主题注入，\`:root\` 里写后备值），不要写死颜色；图用模板里的迷你走势、走势图或内联 SVG，颜色写在 CSS 里。写成一个自包含的文件：样式、脚本、数据都写进页面（卡片里读不到相对路径的文件），图表库可以从 CDN 引入；不要读写 localStorage、cookie（卡片里会报错）。`
    case 'image': {
      const size = `${brief.width}×${brief.height}`
      const double = `${brief.width * 2}×${brief.height * 2}`
      if (brief.fit === 'actual' && brief.visible !== undefined) {
        return `${lead}这张图会按原始像素显示在画布的卡片里，卡片里只露出图片中间约 ${brief.visible.width}×${brief.visible.height} px，用户点开才看整张。要看的内容集中在中间这一块，整张图照常画完整。`
      }
      if (brief.fit === 'cover') {
        return `${lead}这张图会在画布的卡片里按 ${brief.ratio} 铺满显示（卡片 ${size}），超出这个比例的边会被裁掉，用户也会点开看原图。出图时尽量用 ${brief.ratio} 的宽高比、分辨率至少是卡片的两倍（比如 ${double}）；${IMAGE_FIT}主体和文字放在中间，别贴着四边。`
      }
      return `${lead}这张图会在画布的卡片里按 ${brief.ratio} 的框完整缩放显示（卡片 ${size}），用户也会点开看原图。出图时尽量用 ${brief.ratio} 的宽高比、分辨率至少是卡片的两倍（比如 ${double}）；${IMAGE_FIT}`
    }
    case 'gallery': {
      const hero =
        brief.hero === undefined
          ? ''
          : `最新的一张占大格（约 ${brief.hero.width}×${brief.hero.height}），`
      const fit = brief.fit === 'cover' ? '每格铺满、超出的边裁掉' : '每格完整缩放、不裁'
      return `${lead}这个文件夹会在画布的卡片里排成图墙：里面的图片按修改时间从新到旧排，${hero}一次露出 ${brief.tiles} 张（${fit}），用户点开才看全部。往里放图片（PNG、JPG、WebP、SVG），一张一件事、主体放在中间，文件名写清是什么${matchText(brief.match)}；${IMAGE_FIT}`
    }
    case 'files':
      return `${lead}这个文件夹会在画布的卡片里列出里面的文件（最新的在前），用户点开文件看内容。文件名写清是什么（比如带上轮次或日期），一眼分得出哪个是哪个${matchText(brief.match)}。`
    case 'log': {
      const where =
        brief.from === 'start'
          ? `只露出开头约 ${brief.lines} 行`
          : brief.from === 'end'
            ? `停在末尾、跟着新写的内容走，露出最后约 ${brief.lines} 行`
            : `在你写的时候停在末尾、跟着新内容走，露出最后约 ${brief.lines} 行`
      const filter =
        brief.filter === undefined
          ? ''
          : `卡片里只显示能对上 ${code(brief.filter)} 的行，要让人看到的行写进这段字。`
      return `${lead}这个文件会显示在画布的卡片里，${where}，用户点开才看全文。一行写一条、往后追加，写过的行不再改；每行开头带时间和级别（INFO / WARN / ERROR，卡片按级别给错误、警告行着色），后面是一句单独能看懂的话；不画进度条、不输出终端颜色码。${filter}`
    }
    case 'table': {
      const order =
        brief.from === 'start'
          ? '最要紧的行排在前面。'
          : '新的行追加在末尾（写的时候卡片看最后几行）。'
      return `${lead}这个表会在画布的卡片里排成表格（卡片约 ${brief.width} px 宽，列多了要横着滚），用户点开看全部。第一行是表头、列名写短；列控制在几列，格子里写短值，数字列只写数（单位写进表头），长说明另放文件；${order}`
    }
    case 'markdown':
      return `${lead}这个文件会显示在画布的卡片里，只露出开头约 ${brief.lines} 行（往下淡出），用户点开才看全文。先写结论和关键数字，细节放后面；开头不要放长目录和大段背景。全文照常写完整。`
    default:
      return `${lead}这个文件会显示在画布的卡片里，只露出开头约 ${brief.lines} 行，用户点开才看全文。格式照常；能调整顺序的地方，把最重要的内容放在最前面。`
  }
}

export const DSH_DIALECT: Dialect = {
  id: 'dsh',
  mode: {
    auto: '不限定——你可以派子代理、可以用 workflow 工具编排、也可以自己直接做。',
    serial:
      '串行。由你本人按批次顺序一次做一个步骤，不派子代理、不建团队；同一批次也逐个做完再做下一个。',
    subagent: `主 agent + 子代理。你是 leader，不亲自做步骤的活：每个步骤交给一个子代理（\`subagent\` 工具），prompt 里写明它的任务描述路径、产出路径、产出要求与交接内容；等结果回来、核对产出，再推进。同一批次里互不依赖的步骤可以一起派。选分支、推进循环、最后汇报都由你负责。${DSH_MODE_FALLBACK}`,
    team: `Agent Team。用户为这张工作流指定了 Agent Team，你是 Team Lead：用 \`spawn_teammate\` 给步骤建队员（一个步骤一名），用 \`send_message\` 派活（附上交接内容）、\`wait_agent\` 等回报，要求队员做完把产出路径发回给你。选分支、推进循环、最后汇报都由你负责；必需的队员回报之前不要给最终答复。${DSH_MODE_FALLBACK}`,
  },
  reuse: {
    reuse:
      '优先复用。把步骤交给子代理或队员时，同一个步骤再次执行（循环的下一轮、重试、中断后继续）交回给上次做它的那一个——用 `send_message` 发这一轮的任务和交接内容，它带着之前的上下文接着做；只有第一次执行才新建。不同步骤不共用执行者。上次那个已经不在、或工具不支持继续对话时，再新建一个。',
    fresh:
      '每次新建。把步骤交给子代理或队员时，每次执行（包括循环的每一轮、重试）都新派一个，不沿用之前的执行者；上一轮的情况只通过交接内容和产出文件带过去。',
  },
  goalStep: (workflow) =>
    `用 \`create_goal\` 把这次执行设成会话目标：objective 写「按派发计划执行完工作流 ${code(workflow)}」，用户说了这次要做成什么，就接在后面；会话里已经有进行中的目标时不再新建。全部步骤走完、产出核对过之后，用 \`update_goal\` 标记 \`complete\`；卡在只有用户能解决的问题上时标记 \`blocked\` 并写明原因，没做完不要标记完成。没有这些工具就跳过这一条。`,
  resourceRule:
    '**资源**：文件、文件夹按给定路径读写，网址打开查看，Skill 先用 skill 工具加载再干活，自定义内容原样转交。',
  loadSkill: '先用 skill 工具加载',
  needsStep: (names) =>
    `确认这些 skill 已在本机装好（不在包里，用 skill 工具加载）：${names}。没有的话先告诉用户。`,
  runStateStep: '这次要记运行进度，怎么记见「运行状态」。',
  runState: dshRunStateLines,
  display: dshDisplayLine,
}

// ─────────────────────────────────────────────────────────────
// 通用口径（导出成 skill）
// ─────────────────────────────────────────────────────────────

/** 通用口径的状态文件（相对工作区）：和默认的产出根目录 `.workflow-lite/runs/{instance}/out` 放在一起。 */
export const PORTABLE_STATE_FILE = `.workflow-lite/runs/${INSTANCE_VAR}/state.yaml`

/** 状态文件所在的那一层（找上次没走完的状态文件时看这里）。 */
const PORTABLE_RUNS_DIR = '.workflow-lite/runs/'

/** 派子代理 / 组团队的能力不在时的退路。 */
const PORTABLE_MODE_FALLBACK = '你的环境做不到时，先告诉用户，再改成你本人逐个执行。'

/**
 * 「运行状态」段（通用）：没有插件替你记，状态就是工作区里的一份 YAML，由你自己建、自己改。
 * 初始内容按图写好（每个步骤一项），字段、时机、接着跑的办法都在这一段里说完。
 */
export function portableRunStateLines(facts: RunStateFacts): string[] {
  const file = PORTABLE_STATE_FILE
  const initial = [
    '```yaml',
    `workflow: ${facts.workflow}`,
    `instance: "${INSTANCE_VAR}"`,
    'status: pending',
    'updatedAt: ""',
    'note: ""',
    'nodes:',
    ...facts.steps.map((id) => `  ${yamlKey(id)}: { status: pending }`),
    'log: []',
    '```',
  ]
  return [
    PLAN_SECTIONS.runState,
    `这次执行要把进度记在一份状态文件里：${code(file)}（相对工作区，${code(INSTANCE_VAR)} 换成这次的编号）。中断之后靠它接着做，用户也靠它看进度。`,
    '',
    recorderLine(
      '由你来记，直接编辑这份文件。',
      '子代理、队员不碰它——派发时告诉他们做完把结论、判定和产出路径报给你，你来写。',
      facts.solo,
    ),
    `- **开始时**：先看 ${code(PORTABLE_RUNS_DIR)} 下有没有这个工作流没走完的状态文件（${code(`workflow: ${facts.workflow}`)}，${code('status')} 是 ${code('running')} 或 ${code('waiting')}）。有就问用户是接着那一次跑，还是重新开始；接着跑就沿用那个编号和那份文件。没有就按下面的内容新建：`,
    '',
    ...initial,
    '',
    '- **字段**：',
    `  - 整体 ${code('status')}：${code('pending')} / ${code('running')} / ${code('waiting')} / ${code('done')} / ${code('failed')} / ${code('cancelled')}；${code('note')} 在 ${code('waiting')} 时写等什么，${code('failed')} / ${code('cancelled')} 时写原因；${code('updatedAt')} 是最后一次改动的时间（ISO 8601，带时区）。`,
    `  - 每个步骤：${code('status')}（${code('pending')} / ${code('running')} / ${code('waiting')} / ${code('done')} / ${code('failed')} / ${code('skipped')}）、${code('round')}（第几轮，从 1 起，循环每回到这一步加 1）、${code('verdict')}（有条件出边的步骤做完必填，取「分支」里列出的值）、${code('summary')}（一两句结论，别贴原文）、${code('outputs')}（这一轮实际写出的文件，照任务描述里的路径写）、${code('error')}（${code('failed')} 时写原因）。`,
    `  - ${code('log')}：流水，只往末尾加，不删不改。每次改状态加一条 ${code('{ at, node, event, round, verdict }')}，${code('event')} 取 ${code('start')} / ${code('done')} / ${code('failed')} / ${code('waiting')} / ${code('skipped')} / ${code('note')}；整次执行的事件不写 ${code('node')}。`,
    `- **什么时候改**：开始执行时整体改成 ${code('running')}；派发一个步骤之前把它改成 ${code('running')}（写上 ${code('round')}）；它做完改成 ${code('done')}，写 ${code('summary')}、${code('outputs')}，有条件出边的写 ${code('verdict')}，失败改成 ${code('failed')} 写 ${code('error')}；分支没走到的改成 ${code('skipped')}；要等用户回答时改成 ${code('waiting')} 并在 ${code('note')} 写等什么；全部走完整体改成 ${code('done')}。每次改都更新 ${code('updatedAt')}、加一条 ${code('log')}。`,
    `- **中断后接着做**：读这份文件，从流水最后几条和各步骤的 ${code('verdict')} 按「流程」推下一步：停在 ${code('running')} 的步骤视为被打断，重做这一轮；做完的步骤按它的 ${code('verdict')} 走对应的分支。不要按步骤顺序找第一个没做完的——循环里每步都做过、都是 ${code('done')}，那样会跳出环。`,
    `- **用户改了这份文件**：以文件里最新的内容为准——改回 ${code('pending')} 的步骤重新执行，${code('skipped')} 的不再执行，整体是 ${code('waiting')} 就停下来问用户、${code('cancelled')} 就结束。`,
  ]
}

/** YAML 的键：普通的 id 原样写，带特殊字符的加引号。 */
function yamlKey(id: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(id) ? id : JSON.stringify(id)
}

export const PORTABLE_DIALECT: Dialect = {
  id: 'portable',
  mode: {
    auto: '不限定——你可以自己逐个做，也可以把步骤交给子代理或其他 agent 去做（如果你的环境支持）。',
    serial: DSH_DIALECT.mode.serial,
    subagent: `主 agent + 子代理。你是 leader，不亲自做步骤的活：每个步骤交给一个子代理（用你的环境里派子代理、子任务的方式），交代时写明它的任务描述路径、产出路径、产出要求与交接内容；等结果回来、核对产出，再推进。同一批次里互不依赖的步骤可以一起派。选分支、推进循环、最后汇报都由你负责。${PORTABLE_MODE_FALLBACK}`,
    team: `Agent 团队。你是负责人：给每个步骤安排一名队员（用你的环境里建队员、发消息、等回报的方式），派活时附上交接内容，要求队员做完把产出路径报给你。选分支、推进循环、最后汇报都由你负责；必需的队员回报之前不要给最终答复。${PORTABLE_MODE_FALLBACK}`,
  },
  reuse: {
    reuse:
      '优先复用。把步骤交给子代理或队员时，同一个步骤再次执行（循环的下一轮、重试、中断后继续）交回给上次做它的那一个——把这一轮的任务和交接内容发给它，它带着之前的上下文接着做；只有第一次执行才新建。不同步骤不共用执行者。上次那个已经不在、或你的环境不支持接着对话时，再新建一个。',
    fresh: DSH_DIALECT.reuse.fresh,
  },
  goalStep: (workflow) =>
    `把这次执行当成一个要做完的目标：按这份计划执行完工作流 ${code(workflow)}，用户说了这次要做成什么，也算进去。全部步骤走完、产出核对过才算完成；卡在只有用户能解决的问题上就停下来，说清卡在哪、为什么；没做完不要说做完了。你的环境里有会话目标、待办清单这类功能时，用它把这个目标记下来。`,
  resourceRule:
    '**资源**：文件、文件夹按给定路径读写，网址打开查看，Skill 先加载（照你的环境加载 skill 的方式）再干活，自定义内容原样转交。',
  loadSkill: '先加载这个 skill',
  needsStep: (names) => `确认这些 skill 在本机能加载（不在包里）：${names}。没有的话先告诉用户。`,
  runStateStep: '这次要记运行进度：按「运行状态」先找回或新建状态文件。',
  runState: portableRunStateLines,
  // 导出成 skill 就没有画布：产出照资源说明写，不提卡片。
  display: () => null,
}

/**
 * 只该出现在 DSH 口径里的词：工具名、插件动作、插件里的 skill 名、插件的数据目录。
 * 通用口径的计划与任务描述里一个都不能有（`tests/shared/dialect.spec.ts` 守着）。
 */
export const DSH_ONLY_TERMS = [
  'workflow_lite',
  'workflow-run-state',
  'workflow-board',
  '--board-',
  'data-board',
  'create_goal',
  'update_goal',
  '`subagent`',
  'spawn_teammate',
  'send_message',
  'wait_agent',
  '`state`',
  '`resume`',
  'resume`',
  'skill 工具',
  'workflow 工具',
  'dataDir',
  '插件',
  '画布',
] as const
