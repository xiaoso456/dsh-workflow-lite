import { describe, expect, it } from 'vitest'
import { descriptionDraft, existingSkill } from '../../src/client/model/pack.ts'
import {
  checkSkillMeta,
  checkSkillName,
  skillDoc,
  suggestSkillName,
} from '../../src/shared/skillPack.ts'

describe('skill 名', () => {
  it('和 DSH 一样：小写字母、数字，用 - 连接', () => {
    expect(checkSkillName('review-report')).toBeNull()
    expect(checkSkillName('a1')).toBeNull()
    expect(checkSkillName('')).toBe('empty')
    expect(checkSkillName('Review')).toBe('format')
    expect(checkSkillName('a_b')).toBe('format')
    expect(checkSkillName('-a')).toBe('format')
    expect(checkSkillName('a--b')).toBe('format')
    expect(checkSkillName('a'.repeat(65))).toBe('long')
  })

  it('从工作流名猜：英文转成连字符写法，猜不出来就是空串', () => {
    expect(suggestSkillName('Code Review Loop')).toBe('code-review-loop')
    expect(suggestSkillName('  v2_draft!! ')).toBe('v2-draft')
    expect(suggestSkillName('代码审查')).toBe('')
    expect(suggestSkillName('审查 PR')).toBe('pr')
  })

  it('头部：名字、描述必填，长度有上限', () => {
    const ok = { name: 'x', description: '做事' }
    expect(checkSkillMeta(ok)).toBeNull()
    expect(checkSkillMeta({ ...ok, name: 'X' })).toEqual({ field: 'name', problem: 'format' })
    expect(checkSkillMeta({ ...ok, description: '  ' })).toEqual({
      field: 'description',
      problem: 'empty',
    })
    expect(checkSkillMeta({ ...ok, whenToUse: 'a'.repeat(1025) })).toEqual({
      field: 'whenToUse',
      problem: 'long',
    })
  })
})

describe('SKILL.md', () => {
  it('头部的值用双引号写法：引号、换行、冒号都不会弄坏 YAML；空的使用时机不写', () => {
    const doc = skillDoc(
      { name: 'x', description: '写 "报告": 一份\n两行', whenToUse: ' ' },
      '正文\n',
    )
    expect(doc).toBe(
      '---\nname: x\ndescription: "写 \\"报告\\": 一份\\n两行"\n---\n\n# x\n\n正文\n',
    )
    expect(skillDoc({ name: 'x', description: 'd', whenToUse: '要写时' }, 'b')).toContain(
      'whenToUse: "要写时"\n---',
    )
  })
})

describe('导出成 skill 的页面算账', () => {
  const t = ((key: string) =>
    key === 'skillExport.descDraft' ? '按「{name}」的 {n} 步：{steps}。' : key) as never

  it('预填的描述：步骤太多只列前几个', () => {
    expect(descriptionDraft(t, '写作', ['起草', '审查'])).toBe('按「写作」的 2 步：起草 → 审查。')
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(descriptionDraft(t, 'w', many)).toBe('按「w」的 8 步：a → b → c → d → e → f → …。')
  })

  it('同名的已有 skill', () => {
    const preview = { existing: [{ name: 'a', overwritable: true }] }
    expect(existingSkill(preview, 'a')?.overwritable).toBe(true)
    expect(existingSkill(preview, 'b')).toBeUndefined()
    expect(existingSkill(preview, '')).toBeUndefined()
  })
})
