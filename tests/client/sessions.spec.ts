/**
 * 「执行」的会话选择：本会话在最前，其余是同一工作区里说过话的主会话。
 */

import { describe, expect, it } from 'vitest'
import {
  type ConversationService,
  createSessionBridge,
  pickable,
  type SessionRow,
  type SessionsService,
} from '../../src/client/app/sessions.ts'

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

describe('新建会话执行', () => {
  function bridgeWith(created: { workspaceId?: string; cwd?: string }[]) {
    const list = { ids: [], byId: {} }
    const sessions: SessionsService = {
      list: { getSnapshot: () => list, subscribe: () => () => {} },
      create: async (opts) => {
        created.push(opts ?? {})
        return 'new-session'
      },
      using: async () => {
        throw new Error('unused')
      },
    }
    const conversation: ConversationService = {
      input: {
        for: () => {
          throw new Error('unused')
        },
      },
    }
    const bridge = createSessionBridge()
    bridge.attach(sessions, conversation)
    return bridge
  }

  it('新会话建在本会话所在的工作区里（归同一组）；找不到工作区就按目录建', async () => {
    const created: { workspaceId?: string; cwd?: string }[] = []
    const bridge = bridgeWith(created)
    const opened: string[] = []
    bridge.attachWorkspaces(
      {
        list: {
          getSnapshot: () => ({
            items: [
              { workspaceId: 'w-other', path: 'D:\\other', sessionIds: ['x'] },
              { workspaceId: 'w-app', path: 'D:\\code\\app', sessionIds: ['self'] },
            ],
          }),
          subscribe: () => () => {},
        },
      },
      { openSession: (id) => opened.push(id) },
    )
    expect(bridge.canCreate()).toBe(true)
    expect(await bridge.create('self', 'D:\\code\\app')).toBe('new-session')
    expect(await bridge.create('orphan', 'd:/code/app/')).toBe('new-session')
    expect(created).toEqual([{ workspaceId: 'w-app' }, { workspaceId: 'w-app' }])
    expect(bridge.open('new-session')).toBe(true)
    expect(opened).toEqual(['new-session'])

    bridge.attachWorkspaces(undefined, undefined)
    expect(await bridge.create('self', 'D:\\code\\app')).toBe('new-session')
    expect(created.at(-1)).toEqual({ cwd: 'D:\\code\\app' })
    expect(bridge.open('new-session')).toBe(false)
  })
})
