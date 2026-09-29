/**
 * dsh-workflow-lite — 画布的 UI 文案。
 *
 * **客户端文案一律走 locale 词典**（硬编码会被 `verify-client-ui-i18n` 拦）。
 * 命名空间与设置命名空间同一个串：`workflow-lite`。
 *
 * 内置节点起点的**提示词正文也在这里**：它是插进文档、用户会看见并编辑的内容，
 * 与按钮文案一样属于"用户可见字符串"，不能硬编码进 bundle。
 *
 * @module @xiaoso/dsh-workflow-lite/client/core/locales
 */

export const NS = 'workflow-lite' as const

/** 中文（默认）。键名即契约，`en` 必须与之同构。 */
export const zh = {
  'tab.label': '工作流',

  // ── 顶栏：工作流 ────────────────────────────────────────────
  'picker.label': '图',
  'picker.empty': '还没有图，点「新建」开一张',
  'picker.new': '新建',
  'picker.fromTemplate': '从工作流模板新建',
  'picker.rename': '重命名',
  'picker.renameCommit': '确定',
  'picker.renameCancel': '取消',
  'picker.remove': '删除',
  'picker.reload': '重新加载',
  'picker.search': '搜索',
  'picker.noMatch': '没有匹配的图',
  'picker.more': '更多操作',
  'picker.nodeCount': '节点',
  'picker.templateTitle': '工作流模板',
  'confirm.remove': '删掉这张图？删了不可恢复。',
  'confirm.discard': '有未保存的改动，重新加载会丢掉它们。继续？',

  // ── 外部改动提示条 ──────────────────────────────────
  'external.changed': '文件已被外部修改，点此重新加载',
  'conflict.prompt': '写之前发现磁盘变过了，这些 id 双方都改过，选一个：',
  'conflict.keepMine': '保留我的',
  'conflict.useDisk': '用磁盘的',

  // ── 画布工具条 ──────────────────────────────────────────────
  'canvas.layout': '重新布局',
  'canvas.fit': '适应视图',
  'canvas.deleteNode': '删除选中节点',
  'canvas.deleteEdge': '断开',
  'canvas.hint': '拖拽移动、从节点右侧圆点拖到另一个节点即可连线。',
  'canvas.unplaced': '未布局',
  'canvas.noFitForHuge': '节点数超过上限，按网格假位摆放',

  // ── 节点库 ──────────────────────────────────────────────────
  'palette.title': '节点库',
  'palette.builtin': '内置 node',
  'palette.disk': '自定义 node',
  'palette.diskEmpty': '还没有自定义节点。把节点模板 JSON 放进 templates/nodes/ 就会出现在这里。',
  'palette.invalid': '模板坏了',
  'palette.added': '已加入',

  // ── 内置 node 的提示词 ──────────────────────────────────
  'preset.group.other': '其他',
  'preset.scan.label': '侦察',
  'preset.scan.prompt':
    '先把现状摸清楚：读相关代码/文档，把事实与假设分开列出来。\n产出：一份现状说明，含关键文件路径、现状行为、可疑点。\n不要修改任何文件。',
  'preset.plan.label': '拆解',
  'preset.plan.prompt':
    '基于上游产出（若有）拆解本次要做的事。\n产出：有序的任务清单，每条写清改哪个文件、验收标准是什么。\n不要开始实现。',
  'preset.implement.label': '实现',
  'preset.implement.prompt':
    '按上游的计划实现。\n产出：改动说明，含改了哪些文件、为什么这么改、如何验证。\n改完自己跑一遍验证命令并把结果贴出来。',
  'preset.review.label': '审查',
  'preset.review.prompt':
    '独立审查上游的产出：不要信任作者的自我评价，直接看代码与运行结果。\n产出：问题清单（每条给出位置与理由）+ 明确结论。\n最后一行必须写 `VERDICT: pass` 或 `VERDICT: fail`。',
  'preset.fix.label': '修复',
  'preset.fix.prompt':
    '按上游的审查结论逐条修复。\n产出：修复说明，逐条对应审查清单，写清改法与验证结果。\n不要顺手做审查里没提的重构。',
  'preset.report.label': '汇总',
  'preset.report.prompt':
    '汇总本次的全部产出，给出人读的结论。\n产出：一段结论 + 关键证据；说清哪些已验、哪些未验、哪些是环境所限。',

  // ── 属性面板 ────────────────────────────────────────────────
  'panel.title': '节点属性',
  'panel.empty': '未选中节点。点画布上的节点来编辑它。',
  'panel.label': '显示名',
  'panel.output': '产出',
  'panel.outputHint': '留空 = 未声明；填 false = 显式声明不产出文件',
  'panel.prompt': '提示词',
  'panel.promptHint': '这一整段就是执行者的载荷，会逐字物化到 .dispatch/',
  'panel.id': '节点 id（不可改）',
  'panel.counts': '上游 / 下游',
  'panel.edgesIn': '入边（前置）',
  'panel.tabNode': '节点',
  'panel.tabPlan': '计划',
  'panel.upstream': '上游',
  'panel.downstream': '下游',
  'panel.edgesShow': '展开边列表',
  'panel.edgesHide': '收起边列表',
  'panel.edgesOut': '出边',
  'panel.noEdges': '没有边',
  'panel.edgeTitle': '这条边',
  'panel.edgeEnds': '两端',
  'panel.whenCustom': '自定义…',
  'panel.when': 'when',
  'panel.whenLabel': '条件',
  'panel.whenNone': '无条件',
  'panel.edgeBack': '回边（循环中返回）',
  'panel.edgeBackShort': '回边',
  'panel.edgeFail': 'fail',
  'panel.edgePass': 'pass',

  // ── 编译预览 ────────────────────────────────────────────────
  'plan.title': '编译预览',
  'plan.dispatch': '引用路径',
  'plan.full': '内联全文',
  'plan.dispatchHint':
    '给**模型**用的版本：节点提示词不在计划里，表里给的是载荷文件的路径（.dispatch/…），执行者轮到哪个节点才去读那一份。',
  'plan.fullHint':
    '给**人**看的版本：同一份段结构，但把路径换成逐节点内联的提示词正文，可读、可存档、可贴给别人。',
  'plan.copy': '复制',
  'plan.copied': '已复制',
  'plan.export': '导出整卷版',
  'plan.blocked': '编译被编译级问题挡住，先修好图再看。',
  'plan.empty': '还没有可预览的计划。',
  'plan.planId': 'planId',

  // ── 校验面板 ─────────────────────────────────────────
  'verify.title': '校验',
  'verify.ok': '没有问题',
  'verify.level.save': '错误 · 保存级',
  'verify.level.compile': '错误 · 编译级',
  'verify.level.warning': '警告',
  'verify.level.hint': '提示',
  'verify.locate': '定位',

  // ── 状态 ────────────────────────────────────────────────────
  'status.idle': '就绪',
  'status.loading': '加载中…',
  'status.saving': '保存中…',
  'status.saved': '已保存',
  'status.dirty': '有未保存的改动',
  'status.error': '出错',
  'status.blocked': '只读（图不可加载）',

  // ── 错误与提示 ──────────────────────────────────────────────
  'error.conflict': '磁盘上的内容变过了，已自动合并；无法合并的节点需要你决定。',
  'error.generic': '操作失败',
  'error.duplicateId': '这个 id 已经用过了',
  'node.invalid': '此节点不合法',
  'node.missingPrompt': '缺提示词正文（编译级）',
  'blocked.readonly': '这张图有保存级问题，已进入只读错误态——不写盘。原文见下方。',

  // ── 交互改版新增 ────

  // 节点库
  'palette.filter': '筛选起点与节点',
  'palette.newPlaceholder': '节点 id，回车新建',
  'palette.newBlank': '新建空白节点',
  'palette.noMatch': '没有匹配的项',
  'palette.dragHint': '拖到画布放置；点击则放在视野中心',
  'palette.expandAll': '全部展开',
  'palette.collapseAll': '全部收起',
  'palette.addHint': '拖进画布，或直接点条目',
  'palette.connectHint': '从节点右侧圆点拖到另一个节点即可连线',
  'palette.collapseFiltering': '筛选时一律展开，清空筛选后再收起',

  // 画布空态与拖放
  'canvas.emptyTitle': '这张图还没有节点',
  'canvas.emptyBody': '从左侧节点库拖一个进来，或用左侧输入框新建一个。',
  'canvas.emptyAction': '新建空白节点',
  'canvas.dropHere': '松手放在这里',

  // 画布工具条
  'toolbar.undo': '撤销',
  'toolbar.redo': '重做',
  'toolbar.undoTitle': '撤销（Ctrl+Z）',
  'toolbar.redoTitle': '重做（Ctrl+Shift+Z）',
  'toolbar.shortcuts': '快捷键',

  // 节点卡操作簇
  'node.duplicate': '复制节点',
  'node.remove': '删除节点',
  'node.actions': '节点操作',

  // 属性面板
  'panel.copyId': '复制 id',
  'panel.idCopied': '已复制',
  'panel.charCount': '字',
  'panel.summary': '这张图',
  'panel.nodes': '节点',
  'panel.edges': '边',
  'panel.batches': '批次',

  // 校验面板折叠
  'verify.collapse': '收起校验',
  'verify.expand': '展开校验',
  'verify.errors': '错误',
  'verify.warnings': '警告',
  'verify.hints': '提示',

  // 快捷键说明
  'shortcut.title': '键盘快捷键',
  'shortcut.undo': '撤销',
  'shortcut.redo': '重做',
  'shortcut.delete': '删除选中的节点',
  'shortcut.escape': '取消选中',
  'shortcut.filter': '聚焦节点库筛选',
  'shortcut.fit': '适应视图',
  'shortcut.relayout': '重新布局',
  'shortcut.close': '关闭',
} as const

export type LocaleKey = keyof typeof zh

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

  'picker.label': 'Graph',
  'picker.empty': 'No graphs yet. Hit New to start one.',
  'picker.new': 'New',
  'picker.fromTemplate': 'New from workflow template',
  'picker.rename': 'Rename',
  'picker.renameCommit': 'OK',
  'picker.renameCancel': 'Cancel',
  'picker.remove': 'Delete',
  'picker.reload': 'Reload',
  'picker.search': 'Search',
  'picker.noMatch': 'No matching graph',
  'picker.more': 'More actions',
  'picker.nodeCount': 'nodes',
  'picker.templateTitle': 'Workflow templates',
  'confirm.remove': 'Delete this graph? This cannot be undone.',
  'confirm.discard': 'There are unsaved changes; reloading discards them. Continue?',

  'external.changed': 'File changed outside the canvas. Click to reload.',
  'conflict.prompt': 'The file changed on disk and these ids were edited on both sides:',
  'conflict.keepMine': 'Keep mine',
  'conflict.useDisk': 'Use disk',

  'canvas.layout': 'Re-layout',
  'canvas.fit': 'Fit view',
  'canvas.deleteNode': 'Delete selected node',
  'canvas.deleteEdge': 'Disconnect',
  'canvas.hint': 'Drag to move; drag from a node handle to another node to connect.',
  'canvas.unplaced': 'Not laid out',
  'canvas.noFitForHuge': 'Over the node limit. Placed on a fallback grid.',

  'palette.title': 'Node palette',
  'palette.builtin': 'Built-in nodes',
  'palette.disk': 'Custom nodes',
  'palette.diskEmpty':
    'No custom nodes yet. Drop a node template JSON into templates/nodes/ and it shows up here.',
  'palette.invalid': 'Broken template',
  'palette.added': 'Added',

  'preset.group.other': 'Other',
  'preset.scan.label': 'Recon',
  'preset.scan.prompt':
    'Establish the current state first: read the relevant code and docs, and list facts separately from assumptions.\nOutput: a state-of-play note with key file paths, current behaviour, and suspicious spots.\nDo not modify any file.',
  'preset.plan.label': 'Break down',
  'preset.plan.prompt':
    'Break the work down, building on the upstream output if there is one.\nOutput: an ordered task list; each task names the file to change and its acceptance criterion.\nDo not start implementing.',
  'preset.implement.label': 'Implement',
  'preset.implement.prompt':
    'Implement per the upstream plan.\nOutput: a change note listing which files changed, why, and how to verify.\nRun the verification command yourself and paste the result.',
  'preset.review.label': 'Review',
  'preset.review.prompt':
    "Review the upstream work independently: do not trust the author's self-assessment; read the code and run things yourself.\nOutput: a problem list (each with location and reasoning) plus a clear conclusion.\nThe last line must be `VERDICT: pass` or `VERDICT: fail`.",
  'preset.fix.label': 'Fix',
  'preset.fix.prompt':
    'Fix each item from the upstream review.\nOutput: a fix note mapping item by item to the review list, with the change and the verification result.\nDo not refactor anything the review did not raise.',
  'preset.report.label': 'Summarise',
  'preset.report.prompt':
    'Summarise all the output of this run for a human reader.\nOutput: one conclusion plus the key evidence; state plainly what was verified, what was not, and what the environment prevented.',

  'panel.title': 'Node',
  'panel.empty': 'No node selected. Click a node on the canvas to edit it.',
  'panel.label': 'Display name',
  'panel.output': 'Output',
  'panel.outputHint': 'Blank = undeclared; `false` = explicitly produces no file',
  'panel.prompt': 'Prompt',
  'panel.promptHint':
    'This whole block is the executor payload, materialised verbatim into .dispatch/',
  'panel.id': 'Node id (immutable)',
  'panel.counts': 'Upstream / downstream',
  'panel.edgesIn': 'Incoming (prerequisites)',
  'panel.tabNode': 'Node',
  'panel.tabPlan': 'Plan',
  'panel.upstream': 'Upstream',
  'panel.downstream': 'Downstream',
  'panel.edgesShow': 'Show edge list',
  'panel.edgesHide': 'Hide edge list',
  'panel.edgesOut': 'Outgoing',
  'panel.noEdges': 'No edges',
  'panel.edgeTitle': 'This edge',
  'panel.edgeEnds': 'Endpoints',
  'panel.whenCustom': 'Custom...',
  'panel.when': 'when',
  'panel.whenLabel': 'Condition',
  'panel.whenNone': 'unconditional',
  'panel.edgeBack': 'Back edge (loop return)',
  'panel.edgeBackShort': 'loop',
  'panel.edgeFail': 'fail',
  'panel.edgePass': 'pass',

  'plan.title': 'Compiled preview',
  'plan.dispatch': 'References',
  'plan.full': 'Inlined',
  'plan.dispatchHint':
    'The version for the **model**: node prompts are not in the plan; the table gives the path to each payload file (.dispatch/...), and the executor reads one when it reaches that node.',
  'plan.fullHint':
    "The version for a **human**: the same section structure, but paths are replaced by each node's prompt inlined verbatim. Readable, archivable, pasteable.",
  'plan.copy': 'Copy',
  'plan.copied': 'Copied',
  'plan.export': 'Export full text',
  'plan.blocked': 'Compilation is blocked by compile-level problems; fix the graph first.',
  'plan.empty': 'Nothing to preview yet.',
  'plan.planId': 'planId',

  'verify.title': 'Validation',
  'verify.ok': 'No problems',
  'verify.level.save': 'Error · save-level',
  'verify.level.compile': 'Error · compile-level',
  'verify.level.warning': 'Warning',
  'verify.level.hint': 'Hint',
  'verify.locate': 'Locate',

  'status.idle': 'Ready',
  'status.loading': 'Loading…',
  'status.saving': 'Saving…',
  'status.saved': 'Saved',
  'status.dirty': 'Unsaved changes',
  'status.error': 'Error',
  'status.blocked': 'Read-only (graph cannot load)',

  'error.conflict': 'The file changed on disk; changes were merged. Some nodes need your call.',
  'error.generic': 'Operation failed',
  'error.duplicateId': 'That id is already taken',
  'node.invalid': 'This node is invalid',
  'node.missingPrompt': 'Missing prompt body (compile-level)',
  'blocked.readonly':
    'This graph has save-level problems and is now read-only. The raw text is below.',

  // ── Interaction redesign additions ──

  'palette.filter': 'Filter starters and nodes',
  'palette.newPlaceholder': 'Node id, Enter to create',
  'palette.newBlank': 'New blank node',
  'palette.noMatch': 'Nothing matches',
  'palette.dragHint': 'Drag onto the canvas to place; click to drop it in the middle',
  'palette.expandAll': 'Expand all',
  'palette.collapseAll': 'Collapse all',
  'palette.addHint': 'Drag it in, or click the entry',
  'palette.connectHint': 'Drag from the dot on a node edge onto another node to connect',
  'palette.collapseFiltering': 'Filtering keeps every group open; clear the filter to collapse',

  'canvas.emptyTitle': 'This graph has no nodes yet',
  'canvas.emptyBody':
    'Drag one in from the palette on the left, or create one with the field there.',
  'canvas.emptyAction': 'New blank node',
  'canvas.dropHere': 'Drop it here',

  'toolbar.undo': 'Undo',
  'toolbar.redo': 'Redo',
  'toolbar.undoTitle': 'Undo (Ctrl+Z)',
  'toolbar.redoTitle': 'Redo (Ctrl+Shift+Z)',
  'toolbar.shortcuts': 'Shortcuts',

  'node.duplicate': 'Duplicate node',
  'node.remove': 'Delete node',
  'node.actions': 'Node actions',

  'panel.copyId': 'Copy id',
  'panel.idCopied': 'Copied',
  'panel.charCount': 'chars',
  'panel.summary': 'This graph',
  'panel.nodes': 'Nodes',
  'panel.edges': 'Edges',
  'panel.batches': 'Batches',

  'verify.collapse': 'Collapse validation',
  'verify.expand': 'Expand validation',
  'verify.errors': 'Errors',
  'verify.warnings': 'Warnings',
  'verify.hints': 'Hints',

  'shortcut.title': 'Keyboard shortcuts',
  'shortcut.undo': 'Undo',
  'shortcut.redo': 'Redo',
  'shortcut.delete': 'Delete selected node',
  'shortcut.escape': 'Clear selection',
  'shortcut.filter': 'Focus the palette filter',
  'shortcut.fit': 'Fit view',
  'shortcut.relayout': 'Re-layout',
  'shortcut.close': 'Close',
}
