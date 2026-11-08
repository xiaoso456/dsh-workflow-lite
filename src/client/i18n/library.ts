/**
 * dsh-workflow-lite — 步骤库文案：内置步骤、自定义步骤与它们的详情。
 *
 * 左侧步骤库的列表、预设提示词与起手步骤，以及单个步骤库条目的详情页。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n/library
 */

/** 中文（默认）。 */
export const zh = {
  // ── 步骤库 ──────────────────────────────────────────────────
  'lib.title': '步骤库',
  'lib.hint': '拖到画布上使用',
  'lib.builtin': '常用步骤',
  'lib.custom': '我的步骤',
  'lib.newCustom': '新建我的步骤',
  'lib.customEmpty': '点上面的「＋」新建一个，或选中画布上的步骤，点「存为我的步骤」。',
  'lib.broken': '模板文件有问题',
  'lib.noDescription': '还没写描述',
  'lib.blank': '空白步骤',
  'lib.blankDesc': '从零写提示词',
  'lib.collapse': '收起步骤库',
  'lib.basic': '基础',
  'lib.memory': '记忆',
  'lib.memoryDesc': '新建一条，或选已有的',
  'preset.scan.label': '侦察',
  'preset.scan.desc': '读代码，摸清现状',
  'preset.scan.prompt':
    '先把现状摸清楚：读相关代码/文档，把事实与假设分开列出来。\n不要修改任何文件。',
  'preset.scan.rule': '一份现状说明：关键文件路径、现状行为、可疑点；事实与假设分开写。',
  'preset.implement.label': '实现',
  'preset.implement.desc': '按计划动手改',
  'preset.implement.prompt': '按上游的计划实现。\n改完自己跑一遍验证命令并把结果贴出来。',
  'preset.implement.rule': '改动说明：改了哪些文件、为什么这么改、如何验证，附上验证命令的输出。',
  'preset.review.label': '审查',
  'preset.review.desc': '独立检查，给出通过与否',
  'preset.review.prompt':
    '独立审查上游的产出：不要信任作者的自我评价，直接看代码与运行结果。\n最后一行必须写 `VERDICT: pass` 或 `VERDICT: fail`。',
  'preset.review.rule': '问题清单（每条给出位置与理由）+ 明确结论。',
  'preset.fix.label': '修复',
  'preset.fix.desc': '按审查结论逐条修',
  'preset.fix.prompt': '按上游的审查结论逐条修复。\n不要顺手做审查里没提的重构。',
  'preset.fix.rule': '修复说明：逐条对应审查清单，写清改法与验证结果。',
  'starter.fixNote':
    '按 review.md 的问题清单逐条修复：修好的条目在原文件里打钩 [x]，修不了的在条目下写明原因；改法与验证结果写进 fix-notes.md。',
  'starter.recheckNote': '重新审查时对照 review.md 里的勾选与 fix-notes.md，逐条确认真的修好了。',
  'starter.askGoal': '这次要做什么？',
  'starter.askGoalHint': '一两句话说清目标和范围，侦察和实现都照着它来。',
  'starter.askGoalPlaceholder': '比如：给导出功能加上 CSV 格式',
  'starter.askStrict': '审查要多严格？',
  'starter.askStrictHint': '严格 = 小问题也记成未通过。',
  'starter.strict.loose': '宽松',
  'starter.strict.normal': '标准',
  'starter.strict.strict': '严格',
  'starter.rulesLabel': '团队约定',
  'starter.rulesDesc': '没连线：交给每一步',
  'starter.rulesText':
    '- 文档和说明用中文写\n- 改代码前先读懂相关测试，改完跑一遍\n- 不改公共接口；非改不可时在计划里写明原因',
  'starter.contextLabel': '项目资料',
  'starter.contextDesc': '侦察和实现时参考',
  'starter.contextSrc': '主要代码在这里，先看目录结构',
  'starter.contextReadme': '项目是做什么的、怎么跑起来',
  'starter.contextUrl': '提交信息按这个规范写',
  'preset.report.label': '汇总',
  'preset.report.desc': '写给人看的结论',
  'preset.report.prompt':
    '汇总本次的全部产出，给出人读的结论。\n产出：一段结论 + 关键证据；说清哪些已验、哪些未验、哪些是环境所限。',
  'lib.input': '用户输入',
  'lib.inputDesc': '执行前问用户一个问题，填空或选项',
  'lib.resource': '资源',
  'lib.resourceDesc': '文件、文件夹、网址、Skill 或一段自定义提示词，连到步骤上',

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
  'step.deleteTitle': '删除「{name}」这个我的步骤？',
  'step.id': 'ID',
  'step.idHint': '拖到画布上时就是这个步骤的 ID，也是文件名：templates/nodes/<ID>.json。',
  'step.labelPlaceholder': '步骤名称',
  'step.loading': '读取中…',
  'step.newTitle': '新建我的步骤',
  'step.noFile': '不产出文件',
  'step.noOutput': '未声明产出',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  // ── 步骤库 ──────────────────────────────────────────────────
  'lib.title': 'Step library',
  'lib.hint': 'Drag onto the canvas to use',
  'lib.builtin': 'Common steps',
  'lib.custom': 'My steps',
  'lib.newCustom': 'New step of my own',
  'lib.customEmpty':
    'Use the + above to create one, or select a step on the canvas and choose "Save to my steps".',
  'lib.broken': 'Template file has problems',
  'lib.noDescription': 'No description yet',
  'lib.blank': 'Blank step',
  'lib.blankDesc': 'Write a prompt from scratch',
  'lib.collapse': 'Collapse library',
  'lib.basic': 'Basics',
  'lib.memory': 'Memory',
  'lib.memoryDesc': 'New, or pick an existing one',
  'preset.scan.label': 'Recon',
  'preset.scan.desc': 'Read the code, map the current state',
  'preset.scan.prompt':
    'Establish the current state first: read the relevant code and docs, and list facts separately from assumptions.\nDo not modify any file.',
  'preset.scan.rule':
    'A state-of-play note: key file paths, current behaviour, suspicious spots; facts kept apart from assumptions.',
  'preset.implement.label': 'Implement',
  'preset.implement.desc': 'Make the changes per the plan',
  'preset.implement.prompt':
    'Implement per the upstream plan.\nRun the verification command yourself and paste the result.',
  'preset.implement.rule':
    'A change note: which files changed, why, and how to verify, with the verification output attached.',
  'preset.review.label': 'Review',
  'preset.review.desc': 'Check independently, give a verdict',
  'preset.review.prompt':
    "Review the upstream work independently: do not trust the author's self-assessment; read the code and run things yourself.\nThe last line must be `VERDICT: pass` or `VERDICT: fail`.",
  'preset.review.rule':
    'A problem list (each with location and reasoning) plus a clear conclusion.',
  'preset.fix.label': 'Fix',
  'preset.fix.desc': 'Fix each review finding',
  'preset.fix.prompt':
    'Fix each item from the upstream review.\nDo not refactor anything the review did not raise.',
  'preset.fix.rule':
    'A fix note mapping item by item to the review list, with the change and the verification result.',
  'starter.fixNote':
    'Fix review.md item by item: tick [x] each fixed item in the file itself and explain under any item you could not fix; record how you fixed and verified each one in fix-notes.md.',
  'starter.recheckNote':
    'When re-reviewing, check the ticks in review.md against fix-notes.md and confirm each fix for real.',
  'starter.askGoal': 'What should this run do?',
  'starter.askGoalHint':
    'One or two sentences on goal and scope; scouting and implementing follow it.',
  'starter.askGoalPlaceholder': 'e.g. add CSV to the export feature',
  'starter.askStrict': 'How strict should the review be?',
  'starter.askStrictHint': 'Strict = even small issues fail the review.',
  'starter.strict.loose': 'Lenient',
  'starter.strict.normal': 'Standard',
  'starter.strict.strict': 'Strict',
  'starter.rulesLabel': 'Team rules',
  'starter.rulesDesc': 'Not linked: handed to every step',
  'starter.rulesText':
    '- Write docs and notes in English\n- Read the related tests before changing code, run them afterwards\n- Do not change public interfaces; if you must, say why in the plan',
  'starter.contextLabel': 'Project context',
  'starter.contextDesc': 'Reference for scouting and implementing',
  'starter.contextSrc': 'Main code lives here; skim the layout first',
  'starter.contextReadme': 'What the project does and how to run it',
  'starter.contextUrl': 'Write commit messages to this spec',
  'preset.report.label': 'Summarise',
  'preset.report.desc': 'Write the conclusion for a human',
  'preset.report.prompt':
    'Summarise all the output of this run for a human reader.\nOutput: one conclusion plus the key evidence; state plainly what was verified, what was not, and what the environment prevented.',
  'lib.input': 'User input',
  'lib.inputDesc': 'A question asked before running: text or options',
  'lib.resource': 'Resource',
  'lib.resourceDesc': 'Files, folders, URLs, skills or custom text, linked to steps',

  // ── 步骤库条目的详情 ────────────────────────────────────────
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
  'step.deleteTitle': 'Delete your step "{name}"?',
  'step.id': 'ID',
  'step.idHint':
    'The step ID once dropped on the canvas, and the file name: templates/nodes/<ID>.json.',
  'step.labelPlaceholder': 'Step name',
  'step.loading': 'Loading…',
  'step.newTitle': 'New step of my own',
  'step.noFile': 'No file output',
  'step.noOutput': 'Output undeclared',
}
