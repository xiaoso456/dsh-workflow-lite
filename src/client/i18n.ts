/**
 * dsh-workflow-lite — 画布的 UI 文案。
 *
 * **客户端文案一律走 locale 词典**，命名空间与设置命名空间同一个串：`workflow-lite`。
 * 内置步骤的提示词正文也在这里：它会被插进文档、用户看得见也会改，属于用户可见字符串。
 *
 * 措辞口径：界面上不出现「节点 / 边 / 图」这些实现词，统一叫「步骤 / 连线 / 工作流」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n
 */

export const NS = 'workflow-lite' as const

/** 中文（默认）。键名即契约，`en` 必须与之同构。 */
export const zh = {
  'tab.label': '工作流',

  // ── 通用 ────────────────────────────────────────────────────
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.delete': '删除',
  'common.retry': '重试',

  // ── 工作流切换 ──────────────────────────────────────────────
  'wf.pick': '选择工作流',
  'wf.search': '搜索工作流',
  'wf.none': '没有匹配的工作流',
  'wf.new': '新建空白工作流',
  'wf.fromTemplate': '从模板新建',
  'wf.defaultName': '新工作流',
  'wf.rename': '重命名',
  'wf.renameHint': '回车确认，Esc 取消',
  'wf.delete': '删除工作流',
  'wf.deleteConfirm': '删除后不可恢复',
  'wf.reload': '从磁盘重新加载',
  'wf.steps': '个步骤',
  'wf.broken': '文件有问题',

  // ── 保存状态 ────────────────────────────────────────────────
  'status.loading': '加载中',
  'status.saving': '保存中',
  'status.saved': '已保存',
  'status.dirty': '待保存',
  'status.error': '保存失败',

  // ── 工具条 ──────────────────────────────────────────────────
  'tool.undo': '撤销',
  'tool.redo': '重做',
  'tool.tidy': '整理布局',
  'tool.fit': '看全图',
  'tool.zoomIn': '放大',
  'tool.zoomOut': '缩小',
  'tool.keys': '快捷键',
  'tool.preview': '预览计划',
  'tool.library': '步骤库',

  // ── 检查 ────────────────────────────────────────────────────
  'issues.title': '检查',
  'issues.none': '没有问题',
  'issues.noneBody': '这条工作流可以直接交给模型执行。',
  'issues.unit': '个问题',
  'issues.level.save': '错误',
  'issues.level.compile': '需修复',
  'issues.level.warning': '警告',
  'issues.level.hint': '建议',

  // ── 步骤库 ──────────────────────────────────────────────────
  'lib.title': '步骤库',
  'lib.hint': '拖到画布上使用',
  'lib.builtin': '常用步骤',
  'lib.custom': '我的步骤',
  'lib.newCustom': '新建我的步骤',
  'lib.customEmpty': '点上面的「＋」新建一个，或选中画布上的步骤，点「存为我的步骤」。',
  'lib.broken': '模板文件有问题',
  'lib.blank': '空白步骤',
  'lib.blankDesc': '从零写提示词',
  'lib.collapse': '收起步骤库',

  'preset.scan.label': '侦察',
  'preset.scan.desc': '读代码，摸清现状',
  'preset.scan.prompt':
    '先把现状摸清楚：读相关代码/文档，把事实与假设分开列出来。\n产出：一份现状说明，含关键文件路径、现状行为、可疑点。\n不要修改任何文件。',
  'preset.plan.label': '拆解',
  'preset.plan.desc': '列出有序的任务清单',
  'preset.plan.prompt':
    '基于上游产出（若有）拆解本次要做的事。\n产出：有序的任务清单，每条写清改哪个文件、验收标准是什么。\n不要开始实现。',
  'preset.implement.label': '实现',
  'preset.implement.desc': '按计划动手改',
  'preset.implement.prompt':
    '按上游的计划实现。\n产出：改动说明，含改了哪些文件、为什么这么改、如何验证。\n改完自己跑一遍验证命令并把结果贴出来。',
  'preset.review.label': '审查',
  'preset.review.desc': '独立检查，给出通过与否',
  'preset.review.prompt':
    '独立审查上游的产出：不要信任作者的自我评价，直接看代码与运行结果。\n产出：问题清单（每条给出位置与理由）+ 明确结论。\n最后一行必须写 `VERDICT: pass` 或 `VERDICT: fail`。',
  'preset.fix.label': '修复',
  'preset.fix.desc': '按审查结论逐条修',
  'preset.fix.prompt':
    '按上游的审查结论逐条修复。\n产出：修复说明，逐条对应审查清单，写清改法与验证结果。\n不要顺手做审查里没提的重构。',
  'preset.report.label': '汇总',
  'preset.report.desc': '写给人看的结论',
  'preset.report.prompt':
    '汇总本次的全部产出，给出人读的结论。\n产出：一段结论 + 关键证据；说清哪些已验、哪些未验、哪些是环境所限。',

  // ── 画布 ────────────────────────────────────────────────────
  'welcome.title': '用步骤搭一条工作流',
  'welcome.body': '每个步骤是一段交给 AI 执行的提示词，连线决定先后、分支与循环。',
  'canvas.emptyTitle': '从第一个步骤开始',
  'canvas.emptyBody': '把左侧的步骤拖进来，或者双击空白处。',
  'canvas.starter': '插入示例流程',
  'canvas.drop': '松手放在这里',
  'quick.title': '添加步骤',

  // ── 步骤卡 ──────────────────────────────────────────────────
  'node.noPrompt': '还没写提示词',
  'node.noFile': '不产出文件',
  'node.add': '添加下一步',
  'node.duplicate': '复制',
  'node.delete': '删除步骤',
  'node.saveTemplate': '存为我的步骤',

  // ── 属性面板：步骤 ──────────────────────────────────────────
  'ins.name': '名称',
  'ins.prompt': '提示词',
  'ins.promptPlaceholder': '告诉执行者这一步要做什么、产出什么…',
  'ins.promptHint': '这段文字会逐字交给执行者。',
  'ins.chars': '字',
  'ins.output': '产出文件',
  'ins.output.unset': '不声明',
  'ins.output.file': '写入文件',
  'ins.output.none': '不产出',
  'ins.outputPlaceholder': '例如 plan.md',
  'ins.outputInvalid': '要写相对路径，不能是绝对路径或含 ..',
  'ins.links': '连接',
  'ins.from': '上游',
  'ins.to': '下游',
  'ins.noLinks': '还没有连接。从步骤右侧的圆点拖出一条线。',
  'ins.copyId': '复制步骤 ID',

  'tpl.name': '文件名',
  'tpl.placeholder': '例如 my-check',
  'tpl.save': '保存',
  'tpl.saved': '已存为我的步骤',

  // ── 步骤库条目的详情 ────────────────────────────────────────
  'step.builtin': '内置',
  'step.mine': '我的步骤',
  'step.readonlyNote':
    '内置步骤不能修改。拖到画布上之后，那一份可以随意改；想要自己的版本，就复制成「我的步骤」。',
  'step.addToCanvas': '添加到画布',
  'step.copyToMine': '复制为我的步骤',
  'step.save': '保存',
  'step.saving': '保存中…',
  'step.unsaved': '未保存',
  'step.saved': '已保存',
  'step.created': '已创建',
  'step.deleted': '已删除',
  'step.delete': '删除这个步骤',
  'step.deleteConfirm': '删除后不可恢复',
  'step.fileName': '文件名',
  'step.fileNameHint': '存为 templates/nodes/<文件名>.json，也是拖到画布上时的步骤 ID。',
  'step.labelPlaceholder': '步骤名称',
  'step.loading': '读取中…',
  'step.newTitle': '新建我的步骤',
  'step.noFile': '不产出文件',
  'step.noOutput': '未声明产出',

  // ── 属性面板：连线 ──────────────────────────────────────────
  'edge.title': '连线',
  'edge.when': '什么时候走这条线',
  'edge.always': '总是',
  'edge.pass': '通过',
  'edge.fail': '未通过',
  'edge.custom': '自定义',
  'edge.customPlaceholder': '判据，例如 retry',
  'edge.customInvalid': '只能用文字、数字、- 和 _',
  'edge.hintAlways': '上游完成后就执行下游。',
  'edge.hintVerdict': '上游的最后一行是下面这句时，走这条线：',
  'edge.loop': '这条线回到前面的步骤，形成循环。',
  'edge.remove': '删除连线',

  // ── 计划预览 ────────────────────────────────────────────────
  'plan.title': '派发计划',
  'plan.forModel': '给模型',
  'plan.forHuman': '给人看',
  'plan.forModelHint': '步骤的提示词以文件路径引用，执行到哪一步才去读哪一份。',
  'plan.forHumanHint': '提示词全部内联，适合通读、存档或贴给别人。',
  'plan.download': '下载',
  'plan.rendered': '排版',
  'plan.source': '源码',
  'plan.loading': '正在生成…',
  'plan.blocked': '还有问题没修完，计划暂时生成不了。',

  // ── 提示条 ──────────────────────────────────────────────────
  'banner.external': '这个文件在别处被改过。',
  'banner.synced': '已同步磁盘上的更新',
  'banner.reload': '重新加载',
  'banner.conflict': '磁盘上的版本和你的改动有冲突',
  'banner.keepMine': '保留我的',
  'banner.useDisk': '用磁盘的',
  'broken.title': '这个工作流文件打不开',
  'broken.body': '文件里有格式问题，画布不会写入它。修好文件后重新加载。',

  // ── 快捷键 ──────────────────────────────────────────────────
  'keys.title': '快捷键',
  'keys.add': '添加步骤',
  'keys.addCombo': '双击空白处',
  'keys.undo': '撤销',
  'keys.redo': '重做',
  'keys.duplicate': '复制选中的步骤',
  'keys.delete': '删除选中项',
  'keys.deselect': '取消选中',
  'keys.fit': '看全图',
  'keys.tidy': '整理布局',

  'error.generic': '操作失败',
} as const

export type LocaleKey = keyof typeof zh

/** 组件拿到的翻译函数（槽位注入的 `t` 收窄到本插件的键）。 */
export type T = (key: LocaleKey) => string

/**
 * 把本插件的命名空间声明进槽位的 locale 表（官方范式）。
 * 少了这一段，`locale: NS` 与 `PropsLocale<typeof NS>` 都拿不到类型。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'workflow-lite': LocaleKey
  }
}

export const en: Record<LocaleKey, string> = {
  'tab.label': 'Workflow',

  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.delete': 'Delete',
  'common.retry': 'Retry',

  'wf.pick': 'Choose a workflow',
  'wf.search': 'Search workflows',
  'wf.none': 'No matching workflow',
  'wf.new': 'New blank workflow',
  'wf.fromTemplate': 'New from template',
  'wf.defaultName': 'untitled',
  'wf.rename': 'Rename',
  'wf.renameHint': 'Enter to confirm, Esc to cancel',
  'wf.delete': 'Delete workflow',
  'wf.deleteConfirm': 'This cannot be undone',
  'wf.reload': 'Reload from disk',
  'wf.steps': 'steps',
  'wf.broken': 'File has problems',

  'status.loading': 'Loading',
  'status.saving': 'Saving',
  'status.saved': 'Saved',
  'status.dirty': 'Unsaved',
  'status.error': 'Save failed',

  'tool.undo': 'Undo',
  'tool.redo': 'Redo',
  'tool.tidy': 'Tidy up',
  'tool.fit': 'Fit view',
  'tool.zoomIn': 'Zoom in',
  'tool.zoomOut': 'Zoom out',
  'tool.keys': 'Shortcuts',
  'tool.preview': 'Preview plan',
  'tool.library': 'Step library',

  'issues.title': 'Checks',
  'issues.none': 'No problems',
  'issues.noneBody': 'This workflow is ready to hand to the model.',
  'issues.unit': 'issues',
  'issues.level.save': 'Error',
  'issues.level.compile': 'Must fix',
  'issues.level.warning': 'Warning',
  'issues.level.hint': 'Suggestion',

  'lib.title': 'Step library',
  'lib.hint': 'Drag onto the canvas to use',
  'lib.builtin': 'Common steps',
  'lib.custom': 'My steps',
  'lib.newCustom': 'New step of my own',
  'lib.customEmpty':
    'Use the + above to create one, or select a step on the canvas and choose "Save to my steps".',
  'lib.broken': 'Template file has problems',
  'lib.blank': 'Blank step',
  'lib.blankDesc': 'Write a prompt from scratch',
  'lib.collapse': 'Collapse library',

  'preset.scan.label': 'Recon',
  'preset.scan.desc': 'Read the code, map the current state',
  'preset.scan.prompt':
    'Establish the current state first: read the relevant code and docs, and list facts separately from assumptions.\nOutput: a state-of-play note with key file paths, current behaviour, and suspicious spots.\nDo not modify any file.',
  'preset.plan.label': 'Break down',
  'preset.plan.desc': 'Produce an ordered task list',
  'preset.plan.prompt':
    'Break the work down, building on the upstream output if there is one.\nOutput: an ordered task list; each task names the file to change and its acceptance criterion.\nDo not start implementing.',
  'preset.implement.label': 'Implement',
  'preset.implement.desc': 'Make the changes per the plan',
  'preset.implement.prompt':
    'Implement per the upstream plan.\nOutput: a change note listing which files changed, why, and how to verify.\nRun the verification command yourself and paste the result.',
  'preset.review.label': 'Review',
  'preset.review.desc': 'Check independently, give a verdict',
  'preset.review.prompt':
    "Review the upstream work independently: do not trust the author's self-assessment; read the code and run things yourself.\nOutput: a problem list (each with location and reasoning) plus a clear conclusion.\nThe last line must be `VERDICT: pass` or `VERDICT: fail`.",
  'preset.fix.label': 'Fix',
  'preset.fix.desc': 'Fix each review finding',
  'preset.fix.prompt':
    'Fix each item from the upstream review.\nOutput: a fix note mapping item by item to the review list, with the change and the verification result.\nDo not refactor anything the review did not raise.',
  'preset.report.label': 'Summarise',
  'preset.report.desc': 'Write the conclusion for a human',
  'preset.report.prompt':
    'Summarise all the output of this run for a human reader.\nOutput: one conclusion plus the key evidence; state plainly what was verified, what was not, and what the environment prevented.',

  'welcome.title': 'Build a workflow out of steps',
  'welcome.body':
    'Each step is a prompt handed to the AI; the lines decide order, branches and loops.',
  'canvas.emptyTitle': 'Start with a first step',
  'canvas.emptyBody': 'Drag a step in from the left, or double-click the empty canvas.',
  'canvas.starter': 'Insert an example flow',
  'canvas.drop': 'Drop it here',
  'quick.title': 'Add a step',

  'node.noPrompt': 'No prompt yet',
  'node.noFile': 'No file output',
  'node.add': 'Add next step',
  'node.duplicate': 'Duplicate',
  'node.delete': 'Delete step',
  'node.saveTemplate': 'Save to my steps',

  'ins.name': 'Name',
  'ins.prompt': 'Prompt',
  'ins.promptPlaceholder': 'Tell the executor what this step does and what it produces…',
  'ins.promptHint': 'This text is handed to the executor verbatim.',
  'ins.chars': 'chars',
  'ins.output': 'Output file',
  'ins.output.unset': 'Undeclared',
  'ins.output.file': 'Write a file',
  'ins.output.none': 'No file',
  'ins.outputPlaceholder': 'e.g. plan.md',
  'ins.outputInvalid': 'Use a relative path; no absolute paths or ..',
  'ins.links': 'Connections',
  'ins.from': 'Upstream',
  'ins.to': 'Downstream',
  'ins.noLinks': 'No connections yet. Drag a line out of the dot on the right of a step.',
  'ins.copyId': 'Copy step ID',

  'tpl.name': 'File name',
  'tpl.placeholder': 'e.g. my-check',
  'tpl.save': 'Save',
  'tpl.saved': 'Saved to my steps',

  'step.builtin': 'Built-in',
  'step.mine': 'My step',
  'step.readonlyNote':
    'Built-in steps cannot be edited. Once dropped on the canvas, that copy is yours to change; for your own reusable version, copy it to My steps.',
  'step.addToCanvas': 'Add to canvas',
  'step.copyToMine': 'Copy to my steps',
  'step.save': 'Save',
  'step.saving': 'Saving…',
  'step.unsaved': 'Unsaved',
  'step.saved': 'Saved',
  'step.created': 'Created',
  'step.deleted': 'Deleted',
  'step.delete': 'Delete this step',
  'step.deleteConfirm': 'This cannot be undone',
  'step.fileName': 'File name',
  'step.fileNameHint':
    'Stored as templates/nodes/<file name>.json; also the step ID when dropped on the canvas.',
  'step.labelPlaceholder': 'Step name',
  'step.loading': 'Loading…',
  'step.newTitle': 'New step of my own',
  'step.noFile': 'No file output',
  'step.noOutput': 'Output undeclared',

  'edge.title': 'Connection',
  'edge.when': 'When to follow this line',
  'edge.always': 'Always',
  'edge.pass': 'Pass',
  'edge.fail': 'Fail',
  'edge.custom': 'Custom',
  'edge.customPlaceholder': 'Criterion, e.g. retry',
  'edge.customInvalid': 'Letters, digits, - and _ only',
  'edge.hintAlways': 'The downstream step runs once the upstream one finishes.',
  'edge.hintVerdict': 'Followed when the last line of the upstream output is:',
  'edge.loop': 'This line goes back to an earlier step and forms a loop.',
  'edge.remove': 'Delete connection',

  'plan.title': 'Dispatch plan',
  'plan.forModel': 'For the model',
  'plan.forHuman': 'For humans',
  'plan.forModelHint':
    'Step prompts are referenced by file path; each is read only when its step runs.',
  'plan.forHumanHint': 'All prompts inlined: good for reading through, archiving or sharing.',
  'plan.download': 'Download',
  'plan.rendered': 'Formatted',
  'plan.source': 'Source',
  'plan.loading': 'Generating…',
  'plan.blocked': 'There are still problems to fix before a plan can be generated.',

  'banner.external': 'This file was changed elsewhere.',
  'banner.synced': 'Synced with the changes on disk',
  'banner.reload': 'Reload',
  'banner.conflict': 'The version on disk conflicts with your changes',
  'banner.keepMine': 'Keep mine',
  'banner.useDisk': 'Use disk',
  'broken.title': 'This workflow file cannot be opened',
  'broken.body':
    'The file has format problems, so the canvas will not write to it. Fix the file, then reload.',

  'keys.title': 'Shortcuts',
  'keys.add': 'Add a step',
  'keys.addCombo': 'Double-click canvas',
  'keys.undo': 'Undo',
  'keys.redo': 'Redo',
  'keys.duplicate': 'Duplicate selected step',
  'keys.delete': 'Delete selection',
  'keys.deselect': 'Clear selection',
  'keys.fit': 'Fit view',
  'keys.tidy': 'Tidy up',

  'error.generic': 'Something went wrong',
}
