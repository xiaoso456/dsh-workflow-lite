/**
 * dsh-workflow-lite — 画布卡片、连线上用到的全部文案（一次翻好，节点与连线的构建函数共用）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/flow/buildTexts
 */

import type { MemoryType } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { KIND_LABEL } from '../../kit/resourceUi.ts'
import type { Access } from '../lines/lines.ts'

const ACCESS_TEXT: Record<Access, LocaleKey> = {
  produce: 'file.produce',
  update: 'file.update',
  read: 'file.read',
  ask: 'file.ask',
}

export function buildTexts(t: T) {
  return {
    noPromptText: t('node.noPrompt'),
    addText: t('node.add'),
    fileText: t('node.fileHandle'),
    readText: t('res.connectHint'),
    askText: t('input.connectHint'),
    emptyQuestion: t('input.questionEmpty'),
    required: t('input.required'),
    inputKinds: {
      text: t('input.kind.text'),
      textarea: t('input.kind.textarea'),
      choice: t('input.kind.choice'),
      multi: t('input.kind.multi'),
    },
    optionsCount: t('input.optionsCount'),
    otherTag: t('input.otherTag'),
    resEmpty: t('res.cardEmpty'),
    resEmptySub: t('res.cardEmptySub'),
    resShared: t('res.sharedTip'),
    resCount: t('res.itemCount'),
    resMore: t('res.moreItems'),
    kinds: {
      file: t(KIND_LABEL.file),
      folder: t(KIND_LABEL.folder),
      url: t(KIND_LABEL.url),
      skill: t(KIND_LABEL.skill),
      text: t(KIND_LABEL.text),
    },
    pass: t('edge.pass'),
    fail: t('edge.fail'),
    generated: t('run.fileMade'),
    memOn: t('mem.on'),
    memOff: t('mem.off'),
    memTypes: {
      workflow: t('mem.type.workflow'),
      step: t('mem.type.step'),
    } satisfies Record<MemoryType, string>,
    memShared: t('mem.alsoUsed'),
    produce: t(ACCESS_TEXT.produce),
    update: t(ACCESS_TEXT.update),
    read: t(ACCESS_TEXT.read),
    ask: t(ACCESS_TEXT.ask),
    displayOpen: t('display.open'),
    displayInteract: t('display.interact'),
    displayLeave: t('display.leave'),
    displayResize: t('display.resize'),
    displayZoomTag: t('display.zoomTag'),
  }
}

export type CanvasTexts = ReturnType<typeof buildTexts>
