/**
 * `src/shared/trigger.ts`：触发节点的读入与规范写法、定时规则的下一次触发时刻。
 */

import { describe, expect, it } from 'vitest'
import { readDocument, writeDocument } from '../../src/shared/model.ts'
import { nextFire, parseCron, scheduleIssue, scheduleProblem } from '../../src/shared/schedule.ts'
import {
  canonicalTrigger,
  commandOf,
  endpointMissing,
  launchMissing,
  launchOf,
  readTriggerData,
  sourceIssue,
  sourceProblem,
  sourceText,
  usesWorkspace,
} from '../../src/shared/trigger.ts'
import type { TriggerSchedule, WorkflowDocument } from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'

/** 本机时区的一个时刻。 */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi)

describe('触发节点的读入', () => {
  it('缺省值不留在对象里，形状不对的字段丢掉', () => {
    expect(readTriggerData(undefined)).toEqual({
      source: { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } },
    })
    const data = readTriggerData({
      label: '  ',
      note: '分支用 main',
      source: {
        kind: 'schedule',
        schedule: { kind: 'daily', time: '18:30', weekdays: [5, 1, 1, 9] },
      },
      launch: { session: 'new', overlap: 'skip', catchUp: false, maxPerHour: 60, maxFailures: 5 },
    })
    expect(data).toEqual({
      note: '分支用 main',
      source: { kind: 'schedule', schedule: { kind: 'daily', time: '18:30', weekdays: [1, 5] } },
      launch: { maxFailures: 5 },
    })
    expect(launchOf(data)).toEqual({
      session: 'new',
      overlap: 'skip',
      queueMax: 10,
      catchUp: false,
      maxPerHour: 60,
      maxFailures: 5,
    })
  })

  it('排队：选项和最多排几个都留在图里（缺省 10 不写），0 是不限制', () => {
    const data = readTriggerData({ launch: { overlap: 'queue', queueMax: 10 } })
    expect(data.launch).toEqual({ overlap: 'queue' })
    expect(launchOf(data)).toMatchObject({ overlap: 'queue', queueMax: 10 })
    expect(readTriggerData({ launch: { overlap: 'queue', queueMax: 0 } }).launch).toEqual({
      overlap: 'queue',
      queueMax: 0,
    })
    expect(readTriggerData({ launch: { overlap: 'wait', queueMax: -2 } }).launch).toBeUndefined()
  })

  it('两个上限写 0 是不限制，留在图里，多大都行；负数、小数丢掉回缺省', () => {
    const open = readTriggerData({ launch: { maxPerHour: 0, maxFailures: 0 } })
    expect(open.launch).toEqual({ maxPerHour: 0, maxFailures: 0 })
    expect(launchOf(open)).toMatchObject({ maxPerHour: 0, maxFailures: 0 })
    expect(readTriggerData({ launch: { maxPerHour: 50_000 } }).launch).toEqual({
      maxPerHour: 50_000,
    })
    const bad = readTriggerData({ launch: { maxPerHour: -1, maxFailures: 1.5 } })
    expect(launchOf(bad)).toMatchObject({ maxPerHour: 60, maxFailures: 3 })
  })

  it('七天全选和不写是一回事', () => {
    const data = readTriggerData({
      source: { schedule: { kind: 'daily', time: '08:00', weekdays: [1, 2, 3, 4, 5, 6, 7] } },
    })
    expect(data.source).toEqual({ kind: 'schedule', schedule: { kind: 'daily', time: '08:00' } })
  })

  it('写盘再读回来不变，键序固定', () => {
    const data = canonicalTrigger({
      launch: { catchUp: true, session: 'fixed' },
      note: '只看 src/',
      source: { kind: 'schedule', schedule: { kind: 'cron', expression: '*/15 9-17 * * 1-5' } },
      label: '工作时间巡检',
    })
    expect(Object.keys(data)).toEqual(['label', 'source', 'note', 'launch'])
    const document: WorkflowDocument = {
      nodes: [{ id: 'patrol', type: 'wfTrigger', position: { x: 0, y: 0 }, data }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const text = writeDocument(document)
    const parsed = readDocument(text)
    expect(parsed.document?.nodes[0]).toEqual(document.nodes[0])
    expect(writeDocument(parsed.document as WorkflowDocument)).toBe(text)
  })
})

describe('定时检查、监听程序、HTTP', () => {
  it('触发源按形状读入：命令原样保留，判定认不出按每次成功，认不出的回落到定时', () => {
    const every = { kind: 'every', seconds: 60 }
    expect(
      readTriggerData({
        source: {
          kind: 'schedule',
          schedule: every,
          check: { command: ' git ls-remote ', when: 'success' },
        },
      }).source,
    ).toEqual({
      kind: 'schedule',
      schedule: every,
      check: { command: ' git ls-remote ', when: 'success' },
    })
    expect(
      readTriggerData({ source: { kind: 'schedule', schedule: every, check: { when: 'change' } } })
        .source,
    ).toEqual({ kind: 'schedule', schedule: every, check: { command: '', when: 'change' } })
    expect(
      readTriggerData({ source: { kind: 'schedule', schedule: every, check: { when: 'often' } } })
        .source,
    ).toMatchObject({ check: { when: 'every' } })
    expect(
      readTriggerData({ source: { kind: 'schedule', schedule: every, check: 'x' } }).source,
    ).not.toHaveProperty('check')
    expect(readTriggerData({ source: { kind: 'poll', command: 'x' } }).source.kind).toBe('schedule')
    expect(readTriggerData({ source: { kind: 'listen', command: 1 } }).source).toEqual({
      kind: 'listen',
      command: '',
    })
    expect(readTriggerData({ source: { kind: 'http', command: 'x' } }).source).toEqual({
      kind: 'http',
    })
    expect(readTriggerData({ source: { kind: 'webhook' } }).source.kind).toBe('schedule')
  })

  it('过滤：等于缺省的不留，关键字去空去重；定时不要过滤', () => {
    const data = readTriggerData({
      source: { kind: 'listen', command: 'node tail.mjs' },
      condition: '只管支付模块',
      filter: { merge: 5, dedupe: 0, include: [' ERROR ', 'ERROR', ''], exclude: 'x' },
    })
    expect(data).toEqual({
      source: { kind: 'listen', command: 'node tail.mjs' },
      condition: '只管支付模块',
      filter: { include: ['ERROR'] },
    })
    expect(
      readTriggerData({
        source: {
          kind: 'schedule',
          schedule: { kind: 'every', seconds: 300 },
          check: { command: 'x', when: 'every' },
        },
        filter: { merge: 5 },
      }).filter,
    ).toEqual({ merge: 5 })
    expect(
      readTriggerData({
        source: { kind: 'schedule', schedule: { kind: 'every', seconds: 300 } },
        filter: { merge: 5 },
      }),
    ).not.toHaveProperty('filter')
    expect(readTriggerData({ filter: { include: ['ERROR'] } })).not.toHaveProperty('filter')
    expect(
      readTriggerData({ source: { kind: 'http' }, filter: { merge: 99_999, dedupe: -1 } }),
    ).not.toHaveProperty('filter')
  })

  it('写盘再读回来不变，键序固定', () => {
    const data = canonicalTrigger({
      filter: { exclude: ['health'], merge: 0 },
      condition: '只管支付',
      source: {
        check: { when: 'change', command: 'node check.mjs' },
        schedule: { seconds: 600, kind: 'every' },
        kind: 'schedule',
      },
      label: '网页变了',
    })
    expect(Object.keys(data)).toEqual(['label', 'source', 'condition', 'filter'])
    expect(Object.keys(data.source)).toEqual(['kind', 'schedule', 'check'])
    expect(data.source).toMatchObject({ check: { command: 'node check.mjs', when: 'change' } })
    expect(canonicalTrigger(readTriggerData(JSON.parse(JSON.stringify(data))))).toEqual(data)
  })

  it('设置不对的说出来；要跑的命令与一句话说法', () => {
    expect(sourceProblem({ kind: 'listen', command: '  ' })).toBe('还没写要运行的命令')
    const checked = (seconds: number, command = 'x') =>
      ({
        kind: 'schedule',
        schedule: { kind: 'every', seconds },
        check: { command, when: 'every' },
      }) as const
    expect(sourceProblem(checked(5))).toContain('10 秒')
    expect(sourceProblem(checked(10))).toBeNull()
    expect(sourceProblem(checked(60, ' '))).toBe('还没写要运行的命令')
    expect(sourceProblem({ kind: 'schedule', schedule: { kind: 'every', seconds: 30 } })).toContain(
      '1 分钟',
    )
    expect(commandOf(checked(60, 'node a.mjs'))).toBe('node a.mjs')
    expect(sourceProblem({ kind: 'http' })).toBeNull()
    expect(endpointMissing({ kind: 'http' })).toBe(true)
    expect(endpointMissing({ kind: 'http', hook: 'ci' })).toBe(true)
    expect(endpointMissing({ kind: 'http', hook: 'ci', noToken: true })).toBe(false)
    expect(endpointMissing({ kind: 'listen', command: 'x' })).toBe(false)
    expect(sourceProblem({ kind: 'http', hook: 'a/b', token: 'x'.repeat(20) })).toContain('地址')
    expect(commandOf({ kind: 'http' })).toBeUndefined()
    expect(commandOf({ kind: 'listen', command: 'node a.mjs' })).toBe('node a.mjs')
    const check = (when: 'every' | 'success' | 'change') =>
      ({
        kind: 'schedule',
        schedule: { kind: 'every', seconds: 300 },
        check: { command: 'x', when },
      }) as const
    expect(sourceText(check('change'))).toBe(
      '定时检查（每 5 分钟跑一次命令，命令的输出变了时触发）',
    )
    expect(sourceText(check('every'))).toBe('定时检查（每 5 分钟跑一次命令，命令成功时触发）')
    expect(sourceText(check('success'))).toBe(
      '定时检查（每 5 分钟跑一次命令，命令由失败变为成功时触发）',
    )
    expect(sourceText({ kind: 'http' })).toBe('收到一个 HTTP 请求')
  })

  it('哪里不对也给出处（界面按语言说）', () => {
    expect(sourceIssue({ kind: 'listen', command: '' })).toEqual({ code: 'noCommand' })
    expect(
      sourceIssue({
        kind: 'schedule',
        schedule: { kind: 'every', seconds: 5 },
        check: { command: 'x', when: 'every' },
      }),
    ).toEqual({ code: 'schedule', issue: { code: 'every', min: 10, max: 7 * 24 * 3600 } })
    expect(sourceIssue({ kind: 'schedule', schedule: { kind: 'every', seconds: 30 } })).toEqual({
      code: 'tooOften',
      min: 60,
    })
    expect(sourceIssue({ kind: 'after', workflow: '' })).toEqual({ code: 'noWorkflow' })
    expect(sourceIssue({ kind: 'schedule', schedule: { kind: 'daily', time: '25:00' } })).toEqual({
      code: 'schedule',
      issue: { code: 'time', time: '25:00' },
    })
    expect(sourceIssue({ kind: 'http' })).toBeNull()
    expect(sourceIssue({ kind: 'http', hook: 'ci', token: 'short' })).toEqual({
      code: 'token',
      issue: 'short',
    })
    expect(sourceIssue({ kind: 'http', hook: 'ci', token: 'x'.repeat(20) })).toBeNull()
  })

  it('打开开关前卡片上还缺哪一样：新建会话缺工作区，固定会话缺会话', () => {
    const listen = readTriggerData({ source: { kind: 'listen', command: 'x' } })
    expect(launchMissing(listen)).toBe('workspace')
    expect(launchMissing({ ...listen, workspace: 'D:/w' })).toBeNull()
    // 跑命令不再要工作区：命令在卡片目录里跑。
    const fixedListen = readTriggerData({
      source: { kind: 'listen', command: 'x' },
      launch: { session: 'fixed' },
    })
    expect(launchMissing(fixedListen)).toBe('session')
    const fixedHttp = readTriggerData({
      source: { kind: 'http' },
      launch: { session: 'fixed', sessionId: 's1' },
    })
    expect(launchMissing(fixedHttp)).toBeNull()
    // 命令、脚本目录里用了 {workspace} 的，发进固定会话也要工作区。
    const fixedWorkspace = readTriggerData({
      source: { kind: 'listen', command: 'node -e "1" "{workspace}/a.log"' },
      launch: { session: 'fixed', sessionId: 's1' },
    })
    expect(usesWorkspace(fixedWorkspace)).toBe(true)
    expect(launchMissing(fixedWorkspace)).toBe('workspace')
    expect(launchMissing({ ...fixedWorkspace, workspace: 'D:/w' })).toBeNull()
    expect(usesWorkspace({ ...fixedHttp, cwd: '{workspace}' })).toBe(true)
  })
})

describe('接续触发', () => {
  it('读入：工作流名去掉两头空白，结果缺省（成功时）不写；没有过滤', () => {
    expect(
      readTriggerData({ source: { kind: 'after', workflow: ' 构建 ', when: 'done' } }).source,
    ).toEqual({ kind: 'after', workflow: '构建' })
    expect(readTriggerData({ source: { kind: 'after', when: 'any' } }).source).toEqual({
      kind: 'after',
      workflow: '',
      when: 'any',
    })
    expect(
      readTriggerData({ source: { kind: 'after', workflow: 'b' }, filter: { merge: 5 } }),
    ).not.toHaveProperty('filter')
    const data = canonicalTrigger({ source: { when: 'failed', workflow: 'b', kind: 'after' } })
    expect(Object.keys(data.source)).toEqual(['kind', 'workflow', 'when'])
  })

  it('没选工作流说出来；一句话说法；等自己跑完是警告', () => {
    expect(sourceProblem({ kind: 'after', workflow: '' })).toContain('还没选')
    expect(sourceProblem({ kind: 'after', workflow: 'b' })).toBeNull()
    expect(sourceText({ kind: 'after', workflow: 'b' })).toBe('工作流「b」的一次执行成功了')
    expect(sourceText({ kind: 'after', workflow: 'b', when: 'any' })).toBe(
      '工作流「b」的一次执行结束了',
    )
    const self: WorkflowDocument = {
      nodes: [
        {
          id: 'tick',
          type: 'wfTrigger',
          position: { x: 0, y: 0 },
          data: { source: { kind: 'after', workflow: 'w' } },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const problems = validateDocument(self, { workflowName: 'w', maxNodes: 100 })
    expect(problems.warning.map((problem) => problem.message)).toEqual([
      expect.stringContaining('不能等自己跑完'),
    ])
  })
})

describe('图里的触发节点', () => {
  const doc = (expression: string): WorkflowDocument => ({
    nodes: [
      {
        id: 'tick',
        type: 'wfTrigger',
        position: { x: 0, y: 0 },
        data: readTriggerData({ source: { schedule: { kind: 'cron', expression } } }),
      },
      { id: 'work', type: 'wfNode', position: { x: 200, y: 0 }, data: { prompt: '干活' } },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  })

  it('不算步骤；定时规则写错只是警告，不挡保存和编译', () => {
    const fine = validateDocument(doc('0 9 * * *'), { workflowName: 'w', maxNodes: 100 })
    expect(fine.warning.filter((problem) => problem.node === 'tick')).toEqual([])
    expect(fine.canCompile).toBe(true)
    const bad = validateDocument(doc('0 25 * * *'), { workflowName: 'w', maxNodes: 100 })
    expect(bad.warning.map((problem) => [problem.node, problem.code])).toEqual([
      ['tick', 'trigger_invalid'],
    ])
    expect(bad.canLoad && bad.canCompile).toBe(true)
  })

  it('不能连线', () => {
    const linked: WorkflowDocument = {
      ...doc('0 9 * * *'),
      edges: [{ id: 'e', source: 'tick', target: 'work', sourceHandle: null, targetHandle: null }],
    }
    const problems = validateDocument(linked, { workflowName: 'w', maxNodes: 100 })
    const all = [...problems.save, ...problems.compile, ...problems.warning]
    expect(all.some((problem) => problem.message.includes('触发卡片不连线'))).toBe(true)
  })
})

describe('定时规则', () => {
  it('每隔多久：从起算的时刻往后数，严格晚于现在', () => {
    const rule = { kind: 'every', seconds: 1800 } as const
    const start = at(2026, 11, 12, 9, 10)
    expect(nextFire(rule, start, start)).toEqual(at(2026, 11, 12, 9, 40))
    expect(nextFire(rule, at(2026, 11, 12, 9, 40), start)).toEqual(at(2026, 11, 12, 10, 10))
    expect(nextFire(rule, at(2026, 11, 12, 11, 5), start)).toEqual(at(2026, 11, 12, 11, 10))
    expect(scheduleProblem({ kind: 'every', seconds: 0 })).not.toBeNull()
    expect(nextFire({ kind: 'every', seconds: 0 }, start)).toBeNull()
  })

  it('每天几点：过了就是明天；限定星期几时跳到下一个允许的日子', () => {
    const daily = { kind: 'daily', time: '09:00' } as const
    expect(nextFire(daily, at(2026, 11, 12, 8, 59))).toEqual(at(2026, 11, 12, 9, 0))
    expect(nextFire(daily, at(2026, 11, 12, 9, 0))).toEqual(at(2026, 11, 13, 9, 0))
    // 2026-11-12 是周四；只在周一、周五。
    const some: TriggerSchedule = { kind: 'daily', time: '09:00', weekdays: [1, 5] }
    expect(nextFire(some, at(2026, 11, 12, 10, 0))).toEqual(at(2026, 11, 13, 9, 0))
    expect(nextFire(some, at(2026, 11, 13, 10, 0))).toEqual(at(2026, 11, 16, 9, 0))
    expect(scheduleProblem({ kind: 'daily', time: '9点' })).not.toBeNull()
  })

  it('cron：步长、范围、列表；周的 0 和 7 都是周日', () => {
    const work = { kind: 'cron', expression: '*/15 9-17 * * 1-5' } as const
    expect(nextFire(work, at(2026, 11, 12, 9, 1))).toEqual(at(2026, 11, 12, 9, 15))
    expect(nextFire(work, at(2026, 11, 13, 17, 45))).toEqual(at(2026, 11, 16, 9, 0))
    for (const expression of ['0 8 * * 0', '0 8 * * 7']) {
      expect(nextFire({ kind: 'cron', expression }, at(2026, 11, 12))).toEqual(
        at(2026, 11, 15, 8, 0),
      )
    }
    expect(nextFire({ kind: 'cron', expression: '30 6 1,15 * *' }, at(2026, 11, 12))).toEqual(
      at(2026, 11, 15, 6, 30),
    )
  })

  it('cron：日和周都限定了，满足其一即可；只限定一个时两个都要满足', () => {
    // 每月 13 号，或者每周一。2026-11-13 是周五，16 号是周一。
    const either = { kind: 'cron', expression: '0 0 13 * 1' } as const
    expect(nextFire(either, at(2026, 11, 12, 1))).toEqual(at(2026, 11, 13))
    expect(nextFire(either, at(2026, 11, 13, 1))).toEqual(at(2026, 11, 16))
    // 日写的是带步长的星号：和周一起限定（奇数日里的周一）。
    const both = { kind: 'cron', expression: '0 0 */2 * 1' } as const
    expect(nextFire(both, at(2026, 11, 12, 1))).toEqual(at(2026, 11, 23))
  })

  it('cron 写得不对：说出是哪一段', () => {
    expect(parseCron('0 9 * *')).toContain('五段')
    expect(parseCron('60 9 * * *')).toContain('「分」')
    expect(parseCron('0 9 * * mon')).toContain('「周」')
    expect(parseCron('0 9 */0 * *')).toContain('步长')
    expect(scheduleProblem({ kind: 'cron', expression: '0 0 31 2 *' })).toContain('永远不会触发')
    expect(scheduleProblem({ kind: 'cron', expression: '5/20 * * * *' })).toBeNull()
    expect(scheduleIssue({ kind: 'cron', expression: '0 9 * * mon' })).toEqual({
      code: 'cronSyntax',
      field: 'weekday',
      part: 'mon',
    })
    expect(scheduleIssue({ kind: 'cron', expression: '0 0 31 2 *' })).toEqual({ code: 'cronNever' })
  })
})
