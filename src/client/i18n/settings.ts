/**
 * dsh-workflow-lite — 工作流设置与检查文案。
 *
 * 「设置」面板（根目录、执行方式、复用执行者、设定目标、运行状态）和「检查」面板。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n/settings
 */

/** 中文（默认）。 */
export const zh = {
  // ── 工作流设置 ──────────────────────────────────────────────
  'settings.title': '工作流设置',
  'settings.root': '产出根目录',
  'settings.rootPlaceholder': '留空 = 用默认目录；. = 工作区根目录',
  'settings.rootTipJoin': '每个步骤的产出文件都拼在这个目录下，组成最终写入的路径。',
  'settings.rootTipKinds': '相对路径以工作区为起点；也可以写绝对路径，例如 D:/artifacts。',
  'settings.rootTipNormalize':
    '保存时自动标准化：分隔符统一成 /，去掉多余的 //、./ 和末尾的 /。不支持 ~。',
  'settings.rootTipEmpty':
    '默认放在 .workflow-lite/runs/{instance}/out：和状态文件在一起，每个实例一份，不进版本库。',
  'settings.rootTipToken': '{instance} 执行时换成实例 id；写 . 就直接写在工作区根目录。',
  'settings.rootRelative': '相对工作区',
  'settings.rootAbsolute': '绝对路径',
  'settings.rootDefault': '默认',
  'settings.rootWorkspace': '工作区根目录',
  'settings.rootReset': '恢复默认',
  'settings.preview': '例如',
  'settings.mode': '执行方式',
  'settings.mode.auto': '自动',
  'settings.mode.autoDesc': '不做规定，由主 agent 自己决定怎么执行。',
  'settings.mode.serial': '串行',
  'settings.mode.serialDesc': '主 agent 本人按顺序一步一步做，不派子代理。',
  'settings.mode.subagent': '主 agent + 子代理',
  'settings.mode.subagentDesc': '主 agent 当 leader，每个步骤派一个子代理去做。',
  'settings.mode.team': 'Agent 团队',
  'settings.mode.teamDesc': '主 agent 当 Team Lead，给步骤建队员，队员之间能互相发消息。',
  'settings.leaderNote': '后两种方式里，主 agent 只负责派发、选分支、推进循环和最后汇报。',
  'settings.modeTipPlan': '执行方式会写进派发计划的开头，告诉主 agent 怎么组织这次执行。',
  'settings.modeTipTools':
    '子代理与 Agent 团队依赖 DSH 的对应工具；工具不可用时，计划会让主 agent 说明后改成自己逐个执行。',
  'settings.conflict': '工作流设置',
  'settings.reuse': '复用执行者',
  'settings.reuse.auto': '自动',
  'settings.reuse.autoDesc': '由主 agent 决定沿不沿用之前的子代理或队员。',
  'settings.reuse.reuse': '复用',
  'settings.reuse.reuseDesc': '同一步骤再次执行时交回上次那个，接着之前的上下文。',
  'settings.reuse.fresh': '新建',
  'settings.reuse.freshDesc': '每次都派新的，上下文干净，只靠交接和产出传递。',
  'settings.reuseSerial': '串行由主 agent 本人做，用不上。',
  'settings.reuseTipWhen': '「再次执行」指循环的下一轮、失败后重试、中断后继续。',
  'settings.reuseTipScope': '只在同一个步骤之间复用；不同步骤各有各的执行者。',
  'settings.reuseTipPick':
    '复用省得重读材料，还记得上一轮试过什么；新建不受上一轮影响，适合独立审查。',
  'settings.reuseTipTools':
    '复用靠 send_message 继续对话；工具不支持时，计划会让主 agent 改成新建。',
  'settings.goal': '设定目标',
  'settings.goalDesc': '开始前设为会话目标，没做完会接着做。',
  'settings.goalTipPlan':
    '写进派发计划的开头：主 agent 开始前用 create_goal 把这次执行设成会话目标，全部做完后标记完成。',
  'settings.goalTipWhy': '有目标时，主 agent 没做完就停下，DSH 会让它接着做，长流程不会停在一半。',
  'settings.goalTipSkip': '会话里已有进行中的目标时不再新建；没有目标工具就跳过。',
  'settings.during': '执行时',

  // ── 工作流设置：运行状态 ────────────────────────────────────
  'settings.runState': '运行状态',
  'settings.runStateOn': '记录运行状态',
  'settings.runStateDesc': '每次执行建一个实例，画布上能看进度、改状态。',
  'settings.runStateTipInstance':
    '打开后，模型每编译一次这张图，就建一个工作流实例：拍一份图的快照，在会话工作区的 .workflow-lite/runs/ 下建好一份 YAML 状态文件。',
  'settings.runStateTipWriter':
    '执行期间只有主 agent 改它（子代理、队员不碰）；计划末尾会多一段「运行状态」，写明什么时候改、怎么校验。',
  'settings.runStateTipView':
    '在画布上可以切到实例，按状态看那张图；也能改状态，改完确认后会通知模型。',

  // ── 检查 ────────────────────────────────────────────────────
  'issues.title': '检查',
  'issues.none': '没有问题',
  'issues.noneBody': '这条工作流可以直接交给模型执行。',
  'issues.noneBodyRun': '和模板用同一套规则检查过了，改完可以直接保存。',
  'issues.unit': '个问题',
  'issues.level.save': '错误',
  'issues.level.compile': '需修复',
  'issues.level.warning': '警告',
  'issues.level.hint': '建议',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  // ── 工作流设置 ──────────────────────────────────────────────
  'settings.title': 'Workflow settings',
  'settings.root': 'Output root',
  'settings.rootPlaceholder': 'Empty = default folder; . = workspace root',
  'settings.rootTipJoin': "Every step's output files go under this folder to form the final path.",
  'settings.rootTipKinds':
    'Relative paths start at the workspace; absolute paths such as D:/artifacts also work.',
  'settings.rootTipNormalize':
    'Normalized when saved: separators become /, extra //, ./ and the trailing / are removed. ~ is not supported.',
  'settings.rootTipEmpty':
    'By default outputs go to .workflow-lite/runs/{instance}/out: next to the state file, one per instance, ignored by git.',
  'settings.rootTipToken':
    '{instance} becomes the instance id at run time; write . to use the workspace root.',
  'settings.rootRelative': 'Relative to workspace',
  'settings.rootAbsolute': 'Absolute path',
  'settings.rootDefault': 'Default',
  'settings.rootWorkspace': 'Workspace root',
  'settings.rootReset': 'Reset to default',
  'settings.preview': 'e.g.',
  'settings.mode': 'Execution mode',
  'settings.mode.auto': 'Auto',
  'settings.mode.autoDesc': 'No rule; the main agent decides how to run it.',
  'settings.mode.serial': 'Serial',
  'settings.mode.serialDesc': 'The main agent does every step itself, one at a time.',
  'settings.mode.subagent': 'Main agent + subagents',
  'settings.mode.subagentDesc': 'The main agent leads and hands each step to a subagent.',
  'settings.mode.team': 'Agent team',
  'settings.mode.teamDesc':
    'The main agent is Team Lead; steps go to teammates who can message each other.',
  'settings.leaderNote':
    'In the last two modes the main agent only dispatches, picks branches, drives loops and reports.',
  'settings.modeTipPlan':
    'The mode is written at the top of the dispatch plan and tells the main agent how to run it.',
  'settings.modeTipTools':
    'Subagents and Agent teams rely on the matching DSH tools; if they are missing, the plan has the main agent say so and run the steps itself.',
  'settings.conflict': 'workflow settings',
  'settings.reuse': 'Reuse workers',
  'settings.reuse.auto': 'Auto',
  'settings.reuse.autoDesc':
    'The main agent decides whether to keep earlier subagents or teammates.',
  'settings.reuse.reuse': 'Reuse',
  'settings.reuse.reuseDesc':
    'A step that runs again goes back to the same worker, context intact.',
  'settings.reuse.fresh': 'Fresh',
  'settings.reuse.freshDesc': 'Every run gets a new worker; only handoffs and outputs carry over.',
  'settings.reuseSerial': 'Serial runs everything in the main agent; not used.',
  'settings.reuseTipWhen':
    '"Runs again" means the next loop round, a retry, or resuming after a break.',
  'settings.reuseTipScope': 'Reuse stays within one step; different steps never share a worker.',
  'settings.reuseTipPick':
    'Reuse skips re-reading and remembers the last attempt; fresh is unbiased, good for independent review.',
  'settings.reuseTipTools':
    'Reuse continues the chat via send_message; if the tools cannot, the plan has the main agent start a new one.',
  'settings.goal': 'Set a goal',
  'settings.goalDesc': 'Make the run a session goal so it keeps going until done.',
  'settings.goalTipPlan':
    'Written at the top of the plan: the main agent calls create_goal before starting and marks it complete when everything is done.',
  'settings.goalTipWhy':
    'With a goal, DSH nudges the main agent to continue if it stops early, so long workflows do not halt halfway.',
  'settings.goalTipSkip':
    'No new goal if one is already active in the session; skipped when the goal tools are missing.',
  'settings.during': 'While running',

  // ── 工作流设置：运行状态 ────────────────────────────────────
  'settings.runState': 'Run state',
  'settings.runStateOn': 'Record run state',
  'settings.runStateDesc': 'Each run gets an instance; follow or edit progress on the canvas.',
  'settings.runStateTipInstance':
    'Each time the model compiles this workflow, an instance is created: a snapshot of the graph plus a YAML state file under .workflow-lite/runs/ in the session workspace.',
  'settings.runStateTipWriter':
    'Only the main agent edits it during the run (subagents and teammates never do). The plan gains a "Run state" section saying when to update and how to validate.',
  'settings.runStateTipView':
    'Switch the canvas to the instance to see the graph by status; you can edit the state too, and the model is notified when you confirm.',

  // ── 检查 ────────────────────────────────────────────────────
  'issues.title': 'Checks',
  'issues.none': 'No problems',
  'issues.noneBody': 'This workflow is ready to hand to the model.',
  'issues.noneBodyRun': 'Checked with the same rules as templates; save when you are done.',
  'issues.unit': 'issues',
  'issues.level.save': 'Error',
  'issues.level.compile': 'Must fix',
  'issues.level.warning': 'Warning',
  'issues.level.hint': 'Suggestion',
}
