import { describe, expect, it } from 'vitest'
import { addFromSource, addOrigin, duplicateEdit } from '../../src/client/app/addStep.ts'
import { en as enText, type LocaleKey, zh } from '../../src/client/i18n.ts'
import { linkAllowed } from '../../src/client/model/connect.ts'
import { type Edit, type EditorState, initialState, reduce } from '../../src/client/model/editor.ts'
import { SNIPPET_LANGS, snippetOf } from '../../src/client/model/httpSnippets.ts'
import { cardSize, TRIGGER_H, TRIGGER_W, tidy, triggerSpot } from '../../src/client/model/layout.ts'
import { decodeStepSource, encodeStepSource } from '../../src/client/model/library.ts'
import { originText } from '../../src/client/model/originText.ts'
import { triggerGlance } from '../../src/client/model/triggerGlance.ts'
import { sourceSay } from '../../src/client/model/triggerSay.ts'
import {
  momentText,
  presentTriggerSource,
  ruleText,
  scheduleIssueText,
  sourceFace,
  sourceIssueText,
  sourceText,
  stateText,
} from '../../src/client/model/triggerText.ts'
import { parseKeywords } from '../../src/client/ui/trigger/FilterField.tsx'
import { switchSource } from '../../src/client/ui/trigger/source/kinds.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { isTrigger } from '../../src/shared/model.ts'
import { scheduleIssue } from '../../src/shared/schedule.ts'
import { DEFAULT_TRIGGER, SOURCE_SEED, sourceIssue, triggerName } from '../../src/shared/trigger.ts'
import type {
  StepNode,
  TriggerData,
  TriggerNode,
  TriggerSchedule,
  WorkflowDocument,
} from '../../src/shared/types.ts'

const t = (key: LocaleKey): string => zh[key]
const en = (key: LocaleKey): string => enText[key]

function step(id: string, x = 100, y = 100): StepNode {
  return { id, type: 'wfNode', position: { x, y }, data: { prompt: `do ${id}` } }
}

function trigger(id: string, data: TriggerData = DEFAULT_TRIGGER, x = 100, y = -60): TriggerNode {
  return { id, type: 'wfTrigger', position: { x, y }, data }
}

function doc(partial: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, ...partial }
}

function loaded(document: WorkflowDocument): EditorState {
  return reduce(initialState, {
    type: 'loaded',
    name: 'g',
    doc: document,
    baseHash: 'h0',
    problems: [],
  })
}

function triggers(state: EditorState): TriggerNode[] {
  return (state.doc?.nodes ?? []).filter(isTrigger)
}

describe('触发卡片：编辑', () => {
  it('加一张：选中它，放在整张图上面，重建获得新 id，撤销删除恢复旧 id', async () => {
    let state = loaded(doc({ nodes: [step('a', 100, 100)] }))
    const add = () =>
      addFromSource(
        {
          t,
          doc: state.doc,
          edit: (edit) => {
            state = reduce(state, edit)
          },
          loadTemplate: async () => null,
        },
        { kind: 'trigger' },
        triggerSpot(state.doc ?? doc()),
      )
    await add()
    const [first] = triggers(state)
    if (first === undefined) throw new Error('缺少触发卡片')
    expect(state.selection).toEqual({ kind: 'node', id: first.id })
    expect(first.position.y).toBeLessThan(100 - TRIGGER_H)
    expect(first.id).toMatch(/^trigger-[0-9a-f]{32}$/u)
    expect(triggerName(first)).toBe(first.id.slice(0, 16))
    state = reduce(state, { type: 'removeNode', id: first.id })
    state = reduce(state, { type: 'undo' })
    expect(triggers(state)[0]?.id).toBe(first.id)
    state = reduce(state, { type: 'redo' })
    await add()
    expect(triggers(state)[0]?.id).not.toBe(first.id)
  })

  it('改规则、清掉一项；没变化不算一步', () => {
    let state = loaded(doc({ nodes: [trigger('tick')] }))
    state = reduce(state, {
      type: 'patchTrigger',
      id: 'tick',
      patch: {
        note: '只看 src',
        source: { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } },
      },
    })
    expect(triggers(state)[0]?.data.note).toBe('只看 src')
    expect(triggers(state)[0]?.data.source).toEqual({
      kind: 'schedule',
      schedule: { kind: 'daily', time: '09:00' },
    })
    const before = state
    state = reduce(state, { type: 'patchTrigger', id: 'tick', patch: { note: '只看 src' } })
    expect(state).toBe(before)
    state = reduce(state, { type: 'patchTrigger', id: 'tick', patch: { note: undefined } })
    expect(triggers(state)[0]?.data).not.toHaveProperty('note')
  })

  it('patchTrigger 只认触发卡片', () => {
    const state = loaded(doc({ nodes: [step('a')] }))
    expect(reduce(state, { type: 'patchTrigger', id: 'a', patch: { label: 'x' } })).toBe(state)
  })

  it('同一个合并键连着打字只留一条撤销', () => {
    let state = loaded(doc({ nodes: [trigger('tick')] }))
    for (const note of ['只', '只看', '只看 src']) {
      state = reduce(state, {
        type: 'patchTrigger',
        id: 'tick',
        patch: { note },
        merge: 'tick:trigger:note',
      })
    }
    state = reduce(state, { type: 'undo' })
    expect(triggers(state)[0]?.data.note).toBeUndefined()
  })

  it('触发卡片不连线：两头都拒绝', () => {
    const document = doc({ nodes: [step('a'), trigger('tick')] })
    expect(linkAllowed(document, { source: 'tick', target: 'a' })).toBe(false)
    expect(linkAllowed(document, { source: 'a', target: 'tick' })).toBe(false)
    const state = loaded(document)
    const next = reduce(state, { type: 'connect', source: 'tick', target: 'a' })
    expect(next.doc?.edges).toEqual([])
  })
})

describe('触发卡片：从步骤库加进来、复制', () => {
  it('拖进来 = 一张缺省规则的卡片，落在松手的地方', async () => {
    const edits: Edit[] = []
    await addFromSource(
      { t, doc: doc(), edit: (edit) => edits.push(edit), loadTemplate: async () => null },
      { kind: 'trigger' },
      { x: 40, y: 50 },
    )
    expect(edits).toEqual([
      {
        type: 'addTrigger',
        id: expect.any(String),
        data: DEFAULT_TRIGGER,
        position: { x: 40, y: 50 },
      },
    ])
  })

  it('拖拽内容编得回来', () => {
    expect(decodeStepSource(encodeStepSource({ kind: 'trigger' }))).toEqual({ kind: 'trigger' })
  })

  it('从触发卡片上拉不出「接着加一步」', () => {
    expect(addOrigin(doc({ nodes: [trigger('tick')] }), 'tick')).toBe('none')
  })

  it('复制出来是另一张触发卡片（规则照抄）', () => {
    const data: TriggerData = {
      label: '夜巡',
      source: { kind: 'schedule', schedule: { kind: 'every', seconds: 1800 } },
    }
    const edit = duplicateEdit(doc({ nodes: [trigger('tick', data)] }), 'tick', '副本')
    expect(edit?.type).toBe('addTrigger')
    if (edit?.type !== 'addTrigger') return
    expect(edit.id).not.toBe('tick')
    expect(edit.data.source).toEqual(data.source)
    expect(edit.data.label).toContain('副本')
  })
})

describe('触发卡片：摆放', () => {
  it('卡片尺寸', () => {
    expect(cardSize(trigger('tick'))).toEqual({ w: TRIGGER_W, h: TRIGGER_H })
  })

  it('空图放在起始位置；有图放在最上面一排的上方、最左', () => {
    expect(triggerSpot(doc())).toEqual({ x: 80, y: 80 })
    const document = doc({ nodes: [step('a', 200, 120), step('b', 500, 300)] })
    const spot = triggerSpot(document)
    expect(spot.x).toBe(200)
    expect(spot.y).toBeLessThanOrEqual(120 - TRIGGER_H)
  })

  it('那里已经有一张：接在它右边，不叠', () => {
    const first = triggerSpot(doc({ nodes: [step('a', 200, 120)] }))
    const document = doc({
      nodes: [step('a', 200, 120), trigger('t1', DEFAULT_TRIGGER, first.x, first.y)],
    })
    const second = triggerSpot(document)
    expect(second.y).toBe(first.y)
    expect(second.x).toBeGreaterThanOrEqual(first.x + TRIGGER_W)
  })

  it('整理排版：触发卡片有位置，不和步骤叠在一起', async () => {
    const document = doc({
      nodes: [step('a'), step('b'), trigger('tick')],
      edges: [{ id: 'a->b', source: 'a', target: 'b', sourceHandle: null, targetHandle: null }],
    })
    const placed = await tidy(document, analyzeGraph(document))
    const at = placed.tick
    expect(at).toBeDefined()
    if (at === undefined) return
    for (const id of ['a', 'b']) {
      const other = placed[id]
      expect(other).toBeDefined()
      if (other === undefined) continue
      const size = cardSize(step(id))
      const apart =
        at.x + TRIGGER_W <= other.x ||
        other.x + size.w <= at.x ||
        at.y + TRIGGER_H <= other.y ||
        other.y + size.h <= at.y
      expect(apart).toBe(true)
    }
  })
})

describe('触发卡片：卡片上的字', () => {
  it('规则的一句话', () => {
    expect(ruleText(t, { kind: 'every', seconds: 1800 })).toBe('每 30 分钟')
    expect(ruleText(t, { kind: 'every', seconds: 7200 })).toBe('每 2 小时')
    expect(ruleText(t, { kind: 'every', seconds: 172800 })).toBe('每 2 天')
    expect(ruleText(t, { kind: 'every', seconds: 5400 })).toBe('每 90 分钟')
    expect(ruleText(t, { kind: 'daily', time: '09:00' })).toBe('每天 09:00')
    expect(ruleText(t, { kind: 'daily', time: '09:00', weekdays: [1, 5] })).toBe('每周一、五 09:00')
    expect(ruleText(t, { kind: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] })).toBe(
      '工作日 09:00',
    )
    expect(ruleText(t, { kind: 'daily', time: '10:00', weekdays: [6, 7] })).toBe('周末 10:00')
    expect(ruleText(en, { kind: 'daily', time: '09:00', weekdays: [1, 3] })).toBe('Mon, Wed 09:00')
    expect(ruleText(t, { kind: 'cron', expression: ' 0 9 * * 1-5 ' })).toBe('cron 0 9 * * 1-5')
  })

  it('时刻：今天、明天只说钟点，再远带月日', () => {
    const now = new Date(2026, 10, 12, 8, 0).getTime()
    expect(momentText(t, new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe('今天 09:05')
    expect(momentText(t, new Date(2026, 10, 13, 0, 0).getTime(), now)).toBe('明天 00:00')
    expect(momentText(t, new Date(2026, 10, 20, 9, 0).getTime(), now)).toBe('11-20 09:00')
  })

  it('状态一行：等待中带下一次；关着、出错不带', () => {
    const now = new Date(2026, 10, 12, 8, 0).getTime()
    const next = new Date(2026, 10, 12, 9, 0).getTime()
    expect(stateText(t, undefined, 'schedule', now)).toBe('已停用')
    expect(
      stateText(t, { node: 'tick', enabled: true, state: 'waiting', next }, 'schedule', now),
    ).toBe('等待中 · 下一次 今天 09:00')
    expect(
      stateText(t, { node: 'tick', enabled: true, state: 'elsewhere', next }, 'schedule', now),
    ).toBe('由另一个 DSH 负责 · 下一次 今天 09:00')
    expect(
      stateText(t, { node: 'tick', enabled: false, state: 'stopped', next }, 'schedule', now),
    ).toBe('已自动停用')
    expect(stateText(t, { node: 'tick', enabled: true, state: 'invalid' }, 'schedule', now)).toBe(
      '设置不对',
    )
  })

  it('定时检查、监听程序、HTTP 的状态与触发源一句话', () => {
    const now = new Date(2026, 10, 12, 8, 0).getTime()
    const at = new Date(2026, 10, 12, 7, 55).getTime()
    const view = { node: 'tick', enabled: true } as const
    expect(stateText(t, { ...view, state: 'waiting', next: at }, 'check', now)).toBe(
      '检查中 · 下一次 今天 07:55',
    )
    expect(
      stateText(t, { ...view, state: 'waiting', checked: { at, met: false } }, 'check', now),
    ).toBe('检查中 · 上次 今天 07:55 未满足')
    expect(stateText(t, { ...view, state: 'listening', since: at }, 'listen', now)).toBe(
      '接收中 · 今天 07:55 启动',
    )
    expect(stateText(t, { ...view, state: 'restarting', next: at }, 'listen', now)).toBe(
      '重启中 · 今天 07:55 重启',
    )
    const checked = (schedule: TriggerSchedule) =>
      ({ kind: 'schedule', schedule, check: { command: 'x', when: 'every' } }) as const
    expect(sourceText(t, checked({ kind: 'every', seconds: 300 }))).toBe('每 5 分钟检查')
    expect(sourceText(t, checked({ kind: 'every', seconds: 7200 }))).toBe('每 2 小时检查')
    expect(sourceText(t, checked({ kind: 'every', seconds: 45 }))).toBe('每 45 秒检查')
    expect(sourceText(t, checked({ kind: 'daily', time: '09:00' }))).toBe('每天 09:00 检查')
    expect(sourceText(en, checked({ kind: 'every', seconds: 300 }))).toBe('Every 5 min · check')
    expect(sourceFace(checked({ kind: 'every', seconds: 300 }))).toBe('check')
    expect(sourceFace({ kind: 'schedule', schedule: { kind: 'every', seconds: 300 } })).toBe(
      'schedule',
    )
    expect(sourceText(t, { kind: 'listen', command: 'x' })).toBe('监视程序')
    expect(sourceText(t, { kind: 'http' })).toBe('HTTP 请求')
  })

  it('接续触发与全部暂停的说法', () => {
    expect(sourceText(t, { kind: 'after', workflow: '构建' })).toBe('「构建」成功后')
    expect(sourceText(t, { kind: 'after', workflow: '构建', when: 'failed' })).toBe(
      '「构建」失败后',
    )
    expect(sourceText(t, { kind: 'after', workflow: '构建', when: 'any' })).toBe('「构建」跑完后')
    expect(sourceText(t, { kind: 'after', workflow: '' })).toBe('还没选工作流')
    expect(stateText(t, { node: 'tick', enabled: true, state: 'paused' }, 'schedule')).toBe(
      '已全部暂停',
    )
    expect(originText(t, { channel: 'after' })).toBe('接续触发')
  })

  it('接续触发的 UUID 显示为上游当前名称，找不到时显示原因', () => {
    const workflow = 'c85cfbdc-db42-490c-bb4a-881c9052a418'
    const source = { kind: 'after', workflow } as const
    const names = [{ workflowId: workflow, name: '改名后的工作流' }]
    expect(triggerGlance(t, presentTriggerSource(source, names))).toMatchObject({
      workflow: '改名后的工作流',
    })
    expect(sourceText(t, presentTriggerSource(source, names))).toBe('「改名后的工作流」成功后')
    expect(sourceSay(t, presentTriggerSource(source, names))).toContain('改名后的工作流')
    expect(sourceSay(en, presentTriggerSource(source, undefined))).toBe(
      'Upstream workflow unavailable',
    )
  })

  it('关键字一格按中英文逗号、顿号、换行拆开；curl 带上令牌', () => {
    expect(parseKeywords('ERROR, 失败，超时、\n timeout ,,')).toEqual([
      'ERROR',
      '失败',
      '超时',
      'timeout',
    ])
    // 四种写法的调用示例都带上地址和令牌。
    for (const lang of SNIPPET_LANGS) {
      const code = snippetOf(lang, { url: 'http://127.0.0.1:3791/trigger/abc', token: 'tok' })
      expect(code).toContain('http://127.0.0.1:3791/trigger/abc')
      expect(code).toContain('Bearer tok')
    }
  })

  it('实例来源的一句话', () => {
    expect(originText(t, { channel: 'manual' })).toBe('在画布上点「执行」')
    expect(originText(t, { channel: 'session' })).toBe('在对话里发起')
    expect(
      originText(t, { channel: 'schedule', trigger: { id: 'tick', name: '夜巡' }, firedAt: 1 }),
    ).toBe('定时触发 · 夜巡')
    expect(originText(t, { channel: 'now', trigger: { id: 'tick', name: 'tick' } })).toBe(
      '立即触发 · tick',
    )
    expect(originText(t, { channel: 'listen', trigger: { id: 'log', name: '报错' } })).toBe(
      '监视程序触发 · 报错',
    )
    expect(originText(t, { channel: 'http', trigger: { id: 'ci', name: 'CI' } })).toBe(
      'HTTP 触发 · CI',
    )
  })
})

describe('触发卡片：写得不对的说法按界面语言', () => {
  it('定时规则与触发源的毛病：中文、英文各说各的，不夹中文', () => {
    const cron = scheduleIssue({ kind: 'cron', expression: '60 9 * * *' })
    if (cron === null) throw new Error('应当报超出范围')
    expect(scheduleIssueText(t, cron)).toBe('「分」这一段超出范围（0–59）：60')
    expect(scheduleIssueText(en, cron)).toBe('The minute field is out of range (0–59): 60')
    const parts = scheduleIssue({ kind: 'cron', expression: '0 9 * *' })
    if (parts === null) throw new Error('应当报段数不对')
    expect(scheduleIssueText(en, parts)).toContain('this one has 4')
    const empty = scheduleIssue({ kind: 'cron', expression: '0 9 , * *' })
    if (empty === null) throw new Error('应当报空的一段')
    expect(scheduleIssueText(t, empty)).toBe('「日」这一段写得不对：空的')
    const command = sourceIssue({ kind: 'listen', command: ' ' })
    if (command === null) throw new Error('应当报没写命令')
    expect(sourceIssueText(en, command)).toBe('Write the command to run')
    const interval = sourceIssue({
      kind: 'schedule',
      schedule: { kind: 'every', seconds: 5 },
      check: { command: 'x', when: 'every' },
    })
    if (interval === null) throw new Error('应当报间隔')
    expect(sourceIssueText(en, interval)).toBe('The interval must be between 10 s and 7 d')
    expect(sourceIssueText(t, interval)).toBe('间隔要在 10 秒 到 7 天 之间')
    const often = sourceIssue({ kind: 'schedule', schedule: { kind: 'every', seconds: 30 } })
    if (often === null) throw new Error('应当报太密')
    expect(sourceIssueText(t, often)).toBe(t('trigger.issue.tooOften'))
    const after = sourceIssue({ kind: 'after', workflow: '' })
    if (after === null) throw new Error('应当报没选工作流')
    expect(sourceIssueText(t, after)).toBe('还没选等哪个工作流跑完')
    // 英文的说法里不留中文。
    for (const key of Object.keys(enText) as LocaleKey[]) {
      if (key.startsWith('trigger.issue.') || key.startsWith('trigger.cronField.')) {
        expect(enText[key]).not.toMatch(/[\u4e00-\u9fff]/u)
      }
    }
  })

  it('面板里定时卡片的状态不再说下一次（规则下面已经写着）', () => {
    const now = new Date(2026, 10, 13, 7, 0).getTime()
    const next = new Date(2026, 10, 13, 9, 0).getTime()
    const view = { node: 'tick', enabled: true, state: 'waiting', next } as const
    expect(stateText(t, view, 'schedule', now)).toBe('等待中 · 下一次 今天 09:00')
    expect(stateText(t, view, 'schedule', now, { next: false })).toBe('等待中')
  })
})

describe('触发卡片：换触发源', () => {
  const check = (command: string) =>
    ({
      kind: 'schedule',
      schedule: { kind: 'every', seconds: 60 },
      check: { command, when: 'every' },
    }) as const

  it('换走再换回来，填过的还在；没填过的给常用值', () => {
    const schedule = check('git status')
    const kept = new Map([['schedule', schedule]] as const)
    expect(switchSource({ kind: 'http' }, 'schedule', kept)).toBe(schedule)
    expect(switchSource({ kind: 'http' }, 'after', kept)).toEqual(SOURCE_SEED.after)
  })

  it('定时检查换到监听：监听还没写命令就带上检查的那条；反过来不带', () => {
    expect(switchSource(check('tail -f log'), 'listen', new Map())).toEqual({
      kind: 'listen',
      command: 'tail -f log',
    })
    const written = { kind: 'listen', command: 'node watch.mjs' } as const
    expect(switchSource(check('x'), 'listen', new Map([['listen', written]]))).toBe(written)
    expect(switchSource(written, 'schedule', new Map())).toEqual(SOURCE_SEED.schedule)
  })
})
