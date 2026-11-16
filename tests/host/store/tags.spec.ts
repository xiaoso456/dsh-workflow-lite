import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { tagsFile } from '../../../src/host/store/paths.ts'
import type { Outcome } from '../../../src/host/store/repoResult.ts'
import { createRepository, type Repository } from '../../../src/host/store/repository.ts'
import {
  autoTagColor,
  normalizeTagColors,
  normalizeTags,
  TAG_MAX_LENGTH,
  TAGS_PER_WORKFLOW,
  tagColorOf,
} from '../../../src/shared/tags.ts'

let root = ''
let repo: Repository

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-tags-'))
  repo = createRepository({ dataDir: root })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function expectOk<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
  return outcome.result
}

async function tagsByName(): Promise<Record<string, string[] | undefined>> {
  const list = await repo.list()
  return Object.fromEntries(list.workflows.map((entry) => [entry.name, entry.tags]))
}

describe('标签的规矩', () => {
  it('去空白、去空、不分大小写去重、截长、截个数', () => {
    expect(normalizeTags(['  周报 ', '', 'Daily', 'daily', 3, '多  个   空格'])).toEqual([
      '周报',
      'Daily',
      '多 个 空格',
    ])
    expect(normalizeTags(['x'.repeat(40)])).toEqual(['x'.repeat(TAG_MAX_LENGTH)])
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`)
    expect(normalizeTags(many)).toHaveLength(TAGS_PER_WORKFLOW)
    expect(normalizeTags('not a list')).toEqual([])
  })

  it('没挑过颜色的按名字算：同名（不分大小写）同色，不会是中性灰；挑过的为准', () => {
    expect(autoTagColor('Daily')).toBe(autoTagColor('daily'))
    const names = Array.from({ length: 60 }, (_, i) => `标签${i}`)
    const colors = new Set(names.map(autoTagColor))
    expect(colors.has('slate')).toBe(false)
    // 名字多了各种颜色都用得上。
    expect(colors.size).toBeGreaterThanOrEqual(6)
    expect(tagColorOf({ Daily: 'slate' }, 'daily')).toBe('slate')
    expect(tagColorOf({}, '周报')).toBe(autoTagColor('周报'))
  })

  it('读进来的颜色表：不认识的颜色、空的键丢掉，同名只留先出现的', () => {
    expect(
      normalizeTagColors({ ' 周报 ': 'teal', 周报X: 'nope', '': 'blue', A: 'pink', a: 'green' }),
    ).toEqual({ 周报: 'teal', A: 'pink' })
    expect(normalizeTagColors(['teal'])).toEqual({})
  })
})

describe('标签存在 tags.json', () => {
  it('打上的标签随列表给出，不写进工作流文件；清空了就不给', async () => {
    expectOk(await repo.create('周报'))
    expectOk(await repo.create('巡检'))
    expect(expectOk(await repo.setTags('周报', ['写作', ' 每周 ', '写作']))).toEqual([
      '写作',
      '每周',
    ])
    expect(await tagsByName()).toEqual({ 周报: ['写作', '每周'], 巡检: undefined })
    expect(await readFile(join(root, 'workflows', '周报.json'), 'utf8')).not.toContain('写作')
    expectOk(await repo.setTags('周报', []))
    expect((await tagsByName()).周报).toBeUndefined()
    expect(JSON.parse(await readFile(tagsFile(root), 'utf8'))).toEqual({ workflows: {} })
  })

  it('不存在的工作流打不上标签', async () => {
    const outcome = await repo.setTags('没有', ['x'])
    expect(outcome.ok ? '' : outcome.error.code).toBe('not_found')
  })

  it('改名、删除工作流：标签跟着走、跟着去掉；新名字下的旧标签不留', async () => {
    expectOk(await repo.create('甲'))
    expectOk(await repo.create('乙'))
    expectOk(await repo.setTags('甲', ['a']))
    expectOk(await repo.setTags('乙', ['b']))
    expectOk(await repo.remove('乙'))
    expectOk(await repo.rename('甲', '乙'))
    expect(await tagsByName()).toEqual({ 乙: ['a'] })
    expectOk(await repo.remove('乙'))
    expect(JSON.parse(await readFile(tagsFile(root), 'utf8'))).toEqual({ workflows: {} })
  })

  it('标签改名：用着的都换，撞上已有的合成一个；删标签从每个工作流上去掉', async () => {
    expectOk(await repo.create('甲'))
    expectOk(await repo.create('乙'))
    expectOk(await repo.setTags('甲', ['日报', '写作']))
    expectOk(await repo.setTags('乙', ['日报']))
    expect(expectOk(await repo.renameTag('日报', '写作'))).toEqual({ changed: 2, tag: '写作' })
    expect(await tagsByName()).toEqual({ 甲: ['写作'], 乙: ['写作'] })
    expect(expectOk(await repo.deleteTag('写作'))).toEqual({ changed: 2 })
    expect(await tagsByName()).toEqual({ 甲: undefined, 乙: undefined })
    const blank = await repo.renameTag('x', '  ')
    expect(blank.ok ? '' : blank.error.code).toBe('invalid_args')
  })

  it('文件坏了当成没有标签，下次写整份重写', async () => {
    expectOk(await repo.create('甲'))
    await writeFile(tagsFile(root), '{ broken')
    expect((await tagsByName()).甲).toBeUndefined()
    expectOk(await repo.addTags('甲', ['x']))
    expectOk(await repo.addTags('甲', ['X', 'y']))
    expect((await tagsByName()).甲).toEqual(['x', 'y'])
  })

  it('标签的颜色：挑了存下、回 null 去掉；没人用的标签挑不了，标签没人用了颜色一起去掉', async () => {
    expectOk(await repo.create('周报'))
    expectOk(await repo.setTags('周报', ['写作', '每周']))
    expect(expectOk(await repo.setTagColor('写作', 'teal'))).toEqual({ changed: true })
    expect(expectOk(await repo.setTagColor('写作', 'teal'))).toEqual({ changed: false })
    // 不分大小写，存成工作流上的写法。
    expectOk(await repo.setTags('周报', ['Daily', '写作']))
    expectOk(await repo.setTagColor('daily', 'pink'))
    expect(await repo.tagColors()).toEqual({ Daily: 'pink', 写作: 'teal' })
    expect(await repo.tagColors(['写作'])).toEqual({ 写作: 'teal' })
    const missing = await repo.setTagColor('没人用', 'blue')
    expect(missing.ok).toBe(false)
    expectOk(await repo.setTagColor('Daily', null))
    expect(await repo.tagColors()).toEqual({ 写作: 'teal' })
    // 去掉最后一个用着它的：颜色跟着没了。
    expectOk(await repo.setTags('周报', []))
    expect(await repo.tagColors()).toEqual({})
    expect(JSON.parse(await readFile(tagsFile(root), 'utf8'))).toEqual({ workflows: {} })
  })

  it('标签改名颜色跟过去（并进挑过颜色的以那个为准），删标签颜色一起去掉', async () => {
    expectOk(await repo.create('甲'))
    expectOk(await repo.create('乙'))
    expectOk(await repo.setTags('甲', ['旧', '留']))
    expectOk(await repo.setTags('乙', ['新']))
    expectOk(await repo.setTagColor('旧', 'amber'))
    expectOk(await repo.renameTag('旧', '改'))
    expect(await repo.tagColors()).toEqual({ 改: 'amber' })
    expectOk(await repo.setTagColor('新', 'green'))
    expectOk(await repo.renameTag('改', '新'))
    expect(await repo.tagColors()).toEqual({ 新: 'green' })
    expectOk(await repo.deleteTag('新'))
    expect(await repo.tagColors()).toEqual({})
  })

  it('导入带来的颜色只给本机没挑过的标签', async () => {
    expectOk(await repo.create('甲'))
    expectOk(await repo.setTags('甲', ['a', 'b']))
    expectOk(await repo.setTagColor('a', 'slate'))
    expectOk(await repo.adoptTagColors({ A: 'blue', b: 'coral', 没人用: 'teal' }))
    expect(await repo.tagColors()).toEqual({ a: 'slate', b: 'coral' })
  })
})
