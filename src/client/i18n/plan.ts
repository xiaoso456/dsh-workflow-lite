/**
 * dsh-workflow-lite — 计划预览、提示条与快捷键文案。
 *
 * 计划预览对话框、画布上方的提示条，以及快捷键说明。
 *
 * @module @xiaoso/dsh-workflow-lite/client/i18n/plan
 */

/** 中文（默认）。 */
export const zh = {
  // ── 计划预览 ────────────────────────────────────────────────
  'plan.title': '派发计划',
  'plan.forModel': '给模型',
  'plan.forHuman': '给人看',
  'plan.forModelHint':
    '和执行时模型拿到的一样：提示词以任务描述路径引用，执行到哪一步才去读哪一份；{instance} 执行时换成新建实例的 id。',
  'plan.forHumanHint': '提示词全部内联，适合通读、存档或贴给别人。',
  'plan.download': '下载',
  'plan.rendered': '预览',
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
  'keys.addCombo': '右键点空白处',
  'keys.undo': '撤销',
  'keys.redo': '重做',
  'keys.duplicate': '复制选中的步骤',
  'keys.delete': '删除选中项',
  'keys.deselect': '取消选中',
  'keys.fit': '看全图',
  'keys.tidy': '整理布局',
} as const

/** 英文。键与 `zh` 同构，少一个键或多一个键都过不了类型检查。 */
export const en: Record<keyof typeof zh, string> = {
  // ── 计划预览 ────────────────────────────────────────────────
  'plan.title': 'Dispatch plan',
  'plan.forModel': 'For the model',
  'plan.forHuman': 'For humans',
  'plan.forModelHint':
    'Exactly what the model gets at run time: step prompts are referenced by task file path and read only when the step runs; {instance} becomes the new instance id.',
  'plan.forHumanHint': 'All prompts inlined: good for reading through, archiving or sharing.',
  'plan.download': 'Download',
  'plan.rendered': 'Preview',
  'plan.source': 'Source',
  'plan.loading': 'Generating…',
  'plan.blocked': 'There are still problems to fix before a plan can be generated.',

  // ── 提示条 ──────────────────────────────────────────────────
  'banner.external': 'This file was changed elsewhere.',
  'banner.synced': 'Synced with the changes on disk',
  'banner.reload': 'Reload',
  'banner.conflict': 'The version on disk conflicts with your changes',
  'banner.keepMine': 'Keep mine',
  'banner.useDisk': 'Use disk',
  'broken.title': 'This workflow file cannot be opened',
  'broken.body':
    'The file has format problems, so the canvas will not write to it. Fix the file, then reload.',

  // ── 快捷键 ──────────────────────────────────────────────────
  'keys.title': 'Shortcuts',
  'keys.add': 'Add a step',
  'keys.addCombo': 'Right-click canvas',
  'keys.undo': 'Undo',
  'keys.redo': 'Redo',
  'keys.duplicate': 'Duplicate selected step',
  'keys.delete': 'Delete selection',
  'keys.deselect': 'Clear selection',
  'keys.fit': 'Fit view',
  'keys.tidy': 'Tidy up',
}
