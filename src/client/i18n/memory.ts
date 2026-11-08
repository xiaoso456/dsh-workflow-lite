/**
 * dsh-workflow-lite — 记忆文案：记忆节点与记忆库。
 *
 * 记忆节点的属性面板、记忆的选择与新建，以及记忆内容的查看。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n/memory
 */

/** 中文（默认）。 */
export const zh = {
  // ── 记忆 ────────────────────────────────────────────────────
  'preset.title': '颜色与类型',
  'preset.type': '类型',
  'preset.change': '换颜色与类型',
  'preset.noneDesc': '文件、网址、Skill 等，按连线读写',
  'preset.memoryDesc': '引用记忆库里的一条：跨多次执行沉淀做法的一份 skill',
  'preset.refused.memoryItems': '只有空的资源卡能换成记忆（记忆引用记忆库里的一条）',
  'preset.refused.memoryRef': '先选一条记忆',
  'preset.none': '资源',
  'preset.memory': '记忆',
  'mem.title': '记忆',
  'mem.type.workflow': '工作流记忆',
  'mem.type.step': '步骤记忆',
  'mem.tag.workflow': '全局',
  'mem.tag.step': '步骤',
  'mem.libLabel': '记忆库',
  'mem.name': '记忆名称',
  'mem.descPlaceholder': '这条记忆攒的是什么（在记忆库里，用到它的地方都看得到）',
  'mem.usedBy': '{n} 个工作流在用',
  'mem.unused': '没被用',
  'mem.alsoUsed': '另有 {n} 个工作流在用，改动对它们都生效',
  'mem.onlyHere': '只有这个工作流在用',
  'mem.missing': '记忆库里没有这一条（删掉了？）：换一条或新建一条；不换的话，执行时从空的开始攒。',
  'mem.rebind': '换一条',
  'mem.relink': '换一条或新建',
  'mem.pick.step': '给这一步加记忆',
  'mem.pick.workflow': '加工作流记忆',
  'mem.pick.newStep': '新建一条步骤记忆',
  'mem.pick.newWorkflow': '新建一条工作流记忆',
  'mem.createFailed': '新建记忆失败：{error}',
  'mem.on': '开启记忆：这一步把摸清的做法写成一份 skill，下次执行照着做',
  'mem.off': '关闭记忆（记忆库里那条留着）',
  'mem.prompt': '记忆说明',
  'mem.promptPlaceholder': '怎么读、什么时候改、SKILL.md 写成什么样（空着就用默认的）',
  'mem.hint': '附在这一步的任务描述里，执行者照它读、改这份 skill。',
  'mem.globalHint':
    '每一步都读、只读不改，把通用的经验写在回复里；整个工作流结束时，主 agent 照它整理进去。',
  'mem.dir': '记忆目录',
  'mem.view': '查看',
  'mem.statFiles': '文件',
  'mem.statSize': '大小',
  'mem.statUpdated': '最近修改',
  'hub.memRenameTip': '点一下改名',
  'hub.memUnusedHint': '还没有工作流用到它：在编辑页给步骤开记忆、或加工作流记忆时选它。',
  'mem.files': '{n} 个文件',
  'mem.viewEmpty': '还没有内容：第一次跑通、攒下做法之后会写在这里。',
  'mem.dirHint':
    '一份 skill，放在插件的记忆库里：SKILL.md 写做法，scripts/、templates/、references/ 放配套的东西。每次执行读写的都是同一份，别的工作流也能选用。',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  // ── 记忆 ────────────────────────────────────────────────────
  'preset.title': 'Color and type',
  'preset.type': 'Type',
  'preset.change': 'Change color and type',
  'preset.noneDesc': 'Files, URLs, skills…; read and written through links',
  'preset.memoryDesc':
    'Points to an entry in the memory library: a skill that keeps how the work is done across runs',
  'preset.refused.memoryItems':
    'Only an empty resource card can become memory (memory points to an entry in the memory library)',
  'preset.refused.memoryRef': 'Pick a memory first',
  'preset.none': 'Resource',
  'preset.memory': 'Memory',
  'mem.title': 'Memory',
  'mem.type.workflow': 'Workflow memory',
  'mem.type.step': 'Step memory',
  'mem.tag.workflow': 'Global',
  'mem.tag.step': 'Step',
  'mem.libLabel': 'Library',
  'mem.name': 'Memory name',
  'mem.descPlaceholder':
    'What this memory collects (kept in the library, shown wherever it is used)',
  'mem.usedBy': 'Used by {n} workflows',
  'mem.unused': 'Not used',
  'mem.alsoUsed': 'Also used by {n} other workflows; changes apply to them too',
  'mem.onlyHere': 'Only this workflow uses it',
  'mem.missing':
    "This entry isn't in the memory library (deleted?): switch to another or create one; otherwise the run starts from an empty one.",
  'mem.rebind': 'Switch',
  'mem.relink': 'Switch or create',
  'mem.pick.step': 'Add memory to this step',
  'mem.pick.workflow': 'Add workflow memory',
  'mem.pick.newStep': 'New step memory',
  'mem.pick.newWorkflow': 'New workflow memory',
  'mem.createFailed': "Couldn't create the memory: {error}",
  'mem.on':
    'Turn on memory: this step writes down how it got the work done as a skill and follows it next run',
  'mem.off': 'Turn off memory (the library entry stays)',
  'mem.prompt': 'Memory instructions',
  'mem.promptPlaceholder':
    'How to read it, when to update it, what SKILL.md should look like (leave empty for the default)',
  'mem.hint': "Attached to this step's task; the executor reads and updates the skill by it.",
  'mem.globalHint':
    'Every step reads it without changing it and reports general lessons in its reply; when the workflow ends, the main agent folds them in by these instructions.',
  'mem.dir': 'Memory folder',
  'mem.view': 'View',
  'mem.statFiles': 'Files',
  'mem.statSize': 'Size',
  'mem.statUpdated': 'Modified',
  'hub.memRenameTip': 'Click to rename',
  'hub.memUnusedHint':
    'No workflow uses it yet: pick it when adding memory to a step, or a workflow memory, in the editor.',
  'mem.files': '{n} files',
  'mem.viewEmpty':
    'Nothing here yet: it is written after the first run that works out a procedure.',
  'mem.dirHint':
    'A skill kept in the plugin memory library: SKILL.md holds the procedure; scripts/, templates/ and references/ hold what goes with it. Every run reads and writes the same one, and other workflows can use it too.',
}
