import { describe, expect, it } from 'vitest'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import {
  workflowTriggerMarks,
  workflowTriggerTip,
} from '../../src/client/model/workflowTriggerMarks.ts'
import type { TriggerAllResponse, TriggerEntry } from '../../src/shared/wire/trigger.ts'

const t = (key: LocaleKey): string => zh[key]

function entry(
  workflow: string,
  node: string,
  enabled: boolean,
  lastFailure?: number,
): TriggerEntry {
  return {
    workflow,
    name: node,
    data: { source: { kind: 'http' } } as TriggerEntry['data'],
    view: {
      node,
      enabled,
      state: enabled ? 'waiting' : 'off',
      ...(lastFailure === undefined ? {} : { lastFailure }),
    },
  }
}

describe('切换工作流下拉里的小闪电', () => {
  it('按工作流数开着几张；都关着、没有触发卡片的不标', () => {
    const list: TriggerAllResponse = {
      triggers: [
        entry('巡检', 'a', true),
        entry('巡检', 'b', true),
        entry('巡检', 'c', false),
        entry('发版', 'a', false),
      ],
      hookOrigin: '',
    }
    const marks = workflowTriggerMarks(list, {})
    expect(marks.get('巡检')).toEqual({ on: 2, paused: false, unseen: false })
    expect(marks.has('发版')).toBe(false)
    expect(workflowTriggerTip(t, { on: 2, paused: false, unseen: false })).toBe('2 个触发开着')
  })

  it('全部暂停时照样标（褪色）；有没看过的失败亮红点，看过了就灭', () => {
    const list: TriggerAllResponse = {
      triggers: [entry('巡检', 'a', true, 100), entry('发版', 'a', false, 50)],
      paused: 1,
      hookOrigin: '',
    }
    const unseen = workflowTriggerMarks(list, {})
    expect(unseen.get('巡检')).toEqual({ on: 1, paused: true, unseen: true })
    // 连续失败被停用（开关关了）：没有开着的也标出来，只为了红点。
    expect(unseen.get('发版')).toEqual({ on: 0, paused: true, unseen: true })
    expect(workflowTriggerTip(t, { on: 1, paused: true, unseen: true })).toBe(
      '1 个触发开着 · 已全部暂停 · 有还没看过的失败',
    )
    expect(workflowTriggerTip(t, { on: 0, paused: true, unseen: true })).toBe(
      '触发都关着 · 有还没看过的失败',
    )

    const seen = workflowTriggerMarks(list, { '巡检\na': 100, '发版\na': 50 })
    expect(seen.get('巡检')).toEqual({ on: 1, paused: true, unseen: false })
    expect(seen.has('发版')).toBe(false)
  })
})
