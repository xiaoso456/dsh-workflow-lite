/**
 * dsh-workflow-lite — 属性面板文案：步骤、产出文件、连线、交接，以及图标与颜色。
 *
 * 选中步骤或连线时右栏显示的内容。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n/inspector
 */

/** 中文（默认）。 */
export const zh = {
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
  'ins.output.add': '添加产出文件',
  'ins.output.rule': '生成规则',
  'ins.output.rulePlaceholder': '这份产出怎么写：格式、必须包含什么、给谁看…',
  'ins.output.empty': '文件名不能为空',
  'ins.output.duplicate': '这个文件已经在上面声明过了',
  'ins.description': '描述',
  'ins.descriptionPlaceholder': '一句话说明这一步做什么（给人看，不进计划）',
  'ins.links': '连接',
  'ins.from': '上游',
  'ins.to': '下游',
  'ins.noLinks': '还没有连接。从步骤右侧的圆点拖出一条线。',
  'ins.copyId': '复制步骤 ID',
  'tpl.name': 'ID',
  'tpl.placeholder': '例如 my-check',
  'tpl.save': '保存',
  'tpl.saved': '已存为我的步骤',

  // ── 产出文件 ────────────────────────────────────────────────
  'out.files': '个文件',
  'out.remove': '删除这个产出',
  'out.noneHint': '这一步只做事、不留文件（比如直接改代码）。',
  'out.unsetHint': '没说产出什么。下游需要读它的结果时，改成「写入文件」。',
  'out.addRuleCta': '还没写生成规则，点这里补上',
  'out.noRule': '没有生成规则',
  'out.newTitle': '添加产出文件',
  'out.editTitle': '编辑产出文件',
  'out.viewTitle': '产出文件',
  'out.path': '文件路径',
  'out.pathHint': '相对于工作目录的路径；下游步骤从这里读取它。',
  'out.optional': '可选',
  'out.ruleHint': '会写进计划的「产出要求」，派发这一步时连同提示词一起交给执行者。',
  'out.submitKeys': 'Ctrl+Enter 完成',
  'out.done': '完成',
  'out.peekTitle': '产出',
  'out.peekHint': '点文件查看或编辑',
  'out.finalPath': '最终写入',

  // ── 属性面板：连线 ──────────────────────────────────────────
  'edge.title': '连线',
  'edge.when': '流转条件',
  'edge.always': '总是',
  'edge.pass': '通过',
  'edge.fail': '未通过',
  'edge.custom': '自定义',
  'edge.customPlaceholder': '写下走这条线的条件，例如：测试全部通过，且没有新增警告',
  'edge.hintAlways': '上游完成后就执行下游。',
  'edge.hintVerdict': '上游的最后一行是下面这句时，走这条线：',
  'edge.hintJudge': '执行者会读上游的产出，自己判断这句话是否成立，成立就走这条线。',
  'edge.loop': '这条线回到前面的步骤，形成循环。',
  'edge.remove': '删除连线',

  // ── 交接（步骤 → 步骤：上游这一次的执行结果）────────────────
  'hand.title': '交接',
  'hand.result': '把上游的执行结果交给下游',
  'hand.resultHint': '回复里的结论与要点（不是全文）。文件不走这里——连到资源卡上。',
  'hand.resultShort': '执行结果',
  'hand.resultOf': ' 的执行结果',
  'hand.flowOnly': '只管先后',
  'hand.flowOnlyHint': '下游等上游做完才开始，但不拿上游的执行结果。',
  'hand.note': '交接说明',
  'hand.notePlaceholder':
    '例如：按 review.md 逐条修复；修好的在对应条目前打钩 [x]，修不了的写明原因。',
  'hand.noteHint': '写进派发计划，下游拿到执行结果时一起看到。',
  'hand.edit': '编辑交接',
  'hand.editDone': '完成',
  'hand.editHint': 'Esc 或点空白处完成',
  'hand.openPanel': '在右栏打开',
  'hand.tipWhat':
    '执行结果是上游这一次运行的回复（结论与要点），沿步骤之间的线交给下游；缺省就交。',
  'hand.tipFiles':
    '资源是独立的卡片：步骤连到资源 = 写它，资源连到步骤 = 读它。几个步骤连同一个资源，它就是共用的一份。',

  // ── 图标与颜色 ──────────────────────────────────────────────
  'look.title': '图标与颜色',
  'look.change': '换图标和颜色',
  'look.reset': '恢复默认',
  'look.color': '颜色',
  'look.icon': '图标',
  'look.c.blue': '蓝',
  'look.c.green': '绿',
  'look.c.amber': '琥珀',
  'look.c.coral': '珊瑚',
  'look.c.teal': '青',
  'look.c.pink': '粉',
  'look.c.olive': '橄榄',
  'look.c.violet': '紫',
  'look.c.slate': '石板灰',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  // ── 属性面板：步骤 ──────────────────────────────────────────
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
  'ins.output.add': 'Add an output file',
  'ins.output.rule': 'Generation rule',
  'ins.output.rulePlaceholder':
    'How to write this output: format, what it must contain, who reads it…',
  'ins.output.empty': 'File name cannot be empty',
  'ins.output.duplicate': 'This file is already declared above',
  'ins.description': 'Description',
  'ins.descriptionPlaceholder': 'One line on what this step does (for people; not in the plan)',
  'ins.links': 'Connections',
  'ins.from': 'Upstream',
  'ins.to': 'Downstream',
  'ins.noLinks': 'No connections yet. Drag a line out of the dot on the right of a step.',
  'ins.copyId': 'Copy step ID',
  'tpl.name': 'ID',
  'tpl.placeholder': 'e.g. my-check',
  'tpl.save': 'Save',
  'tpl.saved': 'Saved to my steps',

  // ── 产出文件 ────────────────────────────────────────────────
  'out.files': 'files',
  'out.remove': 'Remove this output',
  'out.noneHint': 'This step only acts and leaves no file behind (e.g. it edits code directly).',
  'out.unsetHint':
    'Nothing declared. If a later step needs to read the result, switch to "Write a file".',
  'out.addRuleCta': 'No generation rule yet. Click to add one',
  'out.noRule': 'No generation rule',
  'out.newTitle': 'Add an output file',
  'out.editTitle': 'Edit output file',
  'out.viewTitle': 'Output file',
  'out.path': 'File path',
  'out.pathHint': 'Relative to the working directory; later steps read it from here.',
  'out.optional': 'optional',
  'out.ruleHint':
    "Goes into the plan's output requirements and is handed to the executor along with the prompt.",
  'out.submitKeys': 'Ctrl+Enter to finish',
  'out.done': 'Done',
  'out.peekTitle': 'Outputs',
  'out.peekHint': 'Click a file to view or edit',
  'out.finalPath': 'Written to',

  // ── 属性面板：连线 ──────────────────────────────────────────
  'edge.title': 'Connection',
  'edge.when': 'Condition',
  'edge.always': 'Always',
  'edge.pass': 'Pass',
  'edge.fail': 'Fail',
  'edge.custom': 'Custom',
  'edge.customPlaceholder':
    'Describe when to follow this line, e.g. all tests pass and no new warnings',
  'edge.hintAlways': 'The downstream step runs once the upstream one finishes.',
  'edge.hintVerdict': 'Followed when the last line of the upstream output is:',
  'edge.hintJudge':
    'The executor reads the upstream output and judges whether this holds; if it does, this line is followed.',
  'edge.loop': 'This line goes back to an earlier step and forms a loop.',
  'edge.remove': 'Delete connection',

  // ── 交接（步骤 → 步骤：上游这一次的执行结果）────────────────
  'hand.title': 'Handoff',
  'hand.result': 'Pass the upstream result downstream',
  'hand.resultHint':
    'The conclusions and key points of its reply, not the full text. Files do not go here — connect them as resource cards.',
  'hand.resultShort': 'Result',
  'hand.resultOf': ' — result',
  'hand.flowOnly': 'Order only',
  'hand.flowOnlyHint':
    'The downstream step waits for the upstream one but does not receive its result.',
  'hand.note': 'Handoff note',
  'hand.notePlaceholder':
    'e.g. Fix review.md item by item; tick [x] each fixed item and explain the ones you could not fix.',
  'hand.noteHint': 'Goes into the dispatch plan; the downstream step sees it with the result.',
  'hand.edit': 'Edit handoff',
  'hand.editDone': 'Done',
  'hand.editHint': 'Esc or click away to finish',
  'hand.openPanel': 'Open in side panel',
  'hand.tipWhat':
    "The result is the upstream step's reply for this run (conclusions and key points), passed along step-to-step lines; it is passed by default.",
  'hand.tipFiles':
    'Resources are separate cards: step → resource means it writes it, resource → step means it reads it. Several steps on one resource share it.',

  // ── 图标与颜色 ──────────────────────────────────────────────
  'look.title': 'Icon and color',
  'look.change': 'Change icon and color',
  'look.reset': 'Reset',
  'look.color': 'Color',
  'look.icon': 'Icon',
  'look.c.blue': 'Blue',
  'look.c.green': 'Green',
  'look.c.amber': 'Amber',
  'look.c.coral': 'Coral',
  'look.c.teal': 'Teal',
  'look.c.pink': 'Pink',
  'look.c.olive': 'Olive',
  'look.c.violet': 'Violet',
  'look.c.slate': 'Slate',
}
