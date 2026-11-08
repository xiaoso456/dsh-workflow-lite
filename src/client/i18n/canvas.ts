/**
 * dsh-workflow-lite — 画布文案：空画布、快捷添加、步骤卡与线条图例。
 *
 * 画布本身的提示与步骤卡上的操作，快捷添加菜单，以及线条图例和连线提示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n/canvas
 */

/** 中文（默认）。 */
export const zh = {
  // ── 画布 ────────────────────────────────────────────────────
  'welcome.title': '用步骤搭一条工作流',
  'welcome.body': '每个步骤是一段交给 AI 执行的提示词，连线决定先后、分支与循环。',
  'canvas.emptyTitle': '从第一个步骤开始',
  'canvas.emptyBody': '把左侧的步骤拖进来，或者右键点空白处。',
  'canvas.starter': '插入示例流程',
  'quick.title': '添加步骤',
  'quick.output': '产出文件',
  'quick.outputDesc': '这一步写的文件，放在一张资源卡里',
  'quick.resource': '资源',
  'quick.resourceDesc': '一张空的资源卡：文件、网址、Skill…',
  'quick.input': '用户输入',
  'quick.inputDesc': '执行前问用户，回答交给这一步',
  'quick.looseInput': '用户输入',
  'quick.looseInputDesc': '执行前问用户一个问题',
  'quick.memory': '记忆',
  'quick.memoryDesc': '这一步的经验，下次先读',
  'quick.globalMemory': '全局记忆',
  'quick.globalMemoryDesc': '每一步都读的共用经验',

  // ── 步骤卡 ──────────────────────────────────────────────────
  'node.noPrompt': '还没写提示词',
  'node.noFile': '不产出文件',
  'node.add': '添加下一步',
  'node.duplicate': '复制',
  'node.delete': '删除步骤',
  'node.copySuffix': '副本',
  'node.copied': '已复制「{name}」，已选中新的副本',
  'node.removed': '已删除「{name}」，Ctrl+Z 可撤销',
  'node.saveTemplate': '存为我的步骤',

  // ── 线条图例 ────────────────────────────────────────────────
  'legend.title': '线条图例',
  'legend.short': '图例',
  'legend.groupFlow': '步骤 → 步骤（按条件）',
  'legend.groupFile': '步骤 ↔ 资源 / 输入',
  'legend.portsTip': '连接点：空心圈是入口，线从这里进来；实心点是出口，从这里拖出去连线。',
  'legend.flow': '流程',
  'legend.alwaysTip': '上一步做完就走，默认把执行结果交给下一步',
  'legend.passTip': '上一步判定通过才走',
  'legend.failTip': '上一步判定未通过才走，常用来回去返工',
  'legend.customTip': '满足你写的条件才走',
  'legend.produceTip': '步骤整份写出资源里的文件（会覆盖原内容）',
  'legend.updateTip': '步骤读了再在原文件上改，比如打钩',
  'legend.readTip': '步骤执行时用这个资源（读文件、看网址、加载 Skill…）',
  'legend.in': '入口',
  'legend.inTip': '空心圈：线从这里进来',
  'legend.out': '出口',
  'legend.outTip': '实心点：从这里拖出去连线',
  'link.hintFlow': '拖到步骤上：接成下一步',
  'link.hintWrite': '拖到资源卡上写它；松在空白处新建产出文件',
  'link.hintRead': '拖到步骤上：让它用这个资源',
  'link.hintBack': '拖到上游步骤或资源卡上',
  'link.hintWriteBack': '拖到步骤上：让它写这个资源',
  'link.exists': '已经连着',
  'link.hintReadBack': '拖到资源卡上：用这个资源',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  // ── 画布 ────────────────────────────────────────────────────
  'welcome.title': 'Build a workflow out of steps',
  'welcome.body':
    'Each step is a prompt handed to the AI; the lines decide order, branches and loops.',
  'canvas.emptyTitle': 'Start with a first step',
  'canvas.emptyBody': 'Drag a step in from the left, or right-click the empty canvas.',
  'canvas.starter': 'Insert an example flow',
  'quick.title': 'Add a step',
  'quick.output': 'Output file',
  'quick.outputDesc': 'A file this step writes, in a resource card',
  'quick.resource': 'Resource',
  'quick.resourceDesc': 'An empty resource card: files, URLs, skills…',
  'quick.input': 'User input',
  'quick.inputDesc': 'Ask before running; the answer goes to this step',
  'quick.looseInput': 'User input',
  'quick.looseInputDesc': 'Ask the user a question before running',
  'quick.memory': 'Memory',
  'quick.memoryDesc': 'Lessons read next run',
  'quick.globalMemory': 'Global memory',
  'quick.globalMemoryDesc': 'Lessons every step reads',

  // ── 步骤卡 ──────────────────────────────────────────────────
  'node.noPrompt': 'No prompt yet',
  'node.noFile': 'No file output',
  'node.add': 'Add next step',
  'node.duplicate': 'Duplicate',
  'node.delete': 'Delete step',
  'node.copySuffix': 'copy',
  'node.copied': 'Duplicated “{name}” and selected the copy',
  'node.removed': 'Deleted “{name}” · Ctrl+Z to undo',
  'node.saveTemplate': 'Save to my steps',

  // ── 线条图例 ────────────────────────────────────────────────
  'legend.title': 'Line legend',
  'legend.short': 'Legend',
  'legend.groupFlow': 'Step → step (by condition)',
  'legend.groupFile': 'Step ↔ resource / input',
  'legend.portsTip':
    'Ports: a hollow ring is an input where lines come in; a solid dot is an output you drag from to connect.',
  'legend.flow': 'Flow',
  'legend.alwaysTip': 'Taken once the step is done; passes the result on by default',
  'legend.passTip': 'Taken only when the step passes',
  'legend.failTip': 'Taken only when the step fails, usually to go back and redo',
  'legend.customTip': 'Taken when your own condition holds',
  'legend.produceTip': 'The step writes the files in the resource whole (overwrites them)',
  'legend.updateTip': 'The step reads, then edits the file in place',
  'legend.readTip': 'The step uses this resource (reads files, opens URLs, loads skills…)',
  'legend.in': 'In',
  'legend.inTip': 'Hollow ring: lines come in here',
  'legend.out': 'Out',
  'legend.outTip': 'Solid dot: drag from here to connect',
  'link.hintFlow': 'Drop on a step to make it the next one',
  'link.hintWrite': 'Drop on a resource card to write it, or on empty canvas for a new file',
  'link.hintRead': 'Drop on a step to let it use this resource',
  'link.hintBack': 'Drop on an upstream step or resource card',
  'link.hintWriteBack': 'Drop on a step to let it write this resource',
  'link.exists': 'Already connected',
  'link.hintReadBack': 'Drop on a resource card to use it',
}
