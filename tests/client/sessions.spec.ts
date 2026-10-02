/**
 * 「执行」的会话选择：本会话在最前，其余是同一工作区里说过话的主会话。
 */

import { describe, expect, it } from 'vitest'
import { pickable, type SessionRow } from '../../src/client/app/sessions.ts'

function row(id: string, patch: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    title: id,
    cwd: 'D:\\code\\app',
    running: false,
    updatedAt: 0,
    blank: false,
    subagent: false,
    ...patch,
  }
}

describe('pickable', () => {
  it('本会话在最前；同工作区（大小写、分隔符不同也算）按最近排；子代理、空白会话、别的工作区不列', () => {
    const rows = [
      row('old', { updatedAt: 1 }),
      row('self', { updatedAt: 0, blank: true }),
      row('new', { updatedAt: 9, cwd: 'd:/code/app/' }),
      row('child', { subagent: true, updatedAt: 5 }),
      row('fresh', { blank: true, updatedAt: 7 }),
      row('elsewhere', { cwd: 'D:\\code\\other', updatedAt: 8 }),
    ]
    expect(pickable(rows, 'self').map((item) => item.id)).toEqual(['self', 'new', 'old'])
  })

  it('不知道本会话的工作区时不按工作区筛', () => {
    const rows = [row('self', { cwd: undefined }), row('a', { cwd: 'X:\\y' })]
    expect(pickable(rows, 'self').map((item) => item.id)).toEqual(['self', 'a'])
  })
})
