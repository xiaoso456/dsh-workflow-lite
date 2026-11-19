import { describe, expect, it } from 'vitest'
import { diffText } from '../../src/client/ui/motion/textDiff.ts'

describe('换字时哪些部分原样留着', () => {
  it('只换变了的数字，前后的字留着', () => {
    expect(diffText('明天 02:00', '明天 04:30')).toEqual([
      { text: '明天 0' },
      { text: '4', was: '2' },
      { text: ':' },
      { text: '3', was: '0' },
      { text: '0' },
    ])
  })

  it('等宽的全角字换掉，后面的字照样留着', () => {
    expect(diffText('已启用', '已停用')).toEqual([
      { text: '已' },
      { text: '停', was: '启' },
      { text: '用' },
    ])
  })

  it('末尾换成长短不同的字也行：后面没有要留着的字', () => {
    expect(diffText('每天 09:00', '每天 09:00 和 21:00')).toEqual([
      { text: '每天 09:00' },
      { text: ' 和 21:00', was: '' },
    ])
  })

  it('留着的字前面换了长短：留着的字会挪，整段换', () => {
    expect(diffText('9 分钟后', '12 分钟后')).toBeNull()
    expect(diffText('等待中 · 每天', '已停用 · 每天')).not.toBeNull()
    expect(diffText('a 每天', 'bb 每天')).toBeNull()
  })

  it('两句不相干的话整段换，偶然相同的一个字不留着', () => {
    expect(diffText('工作日夜巡', '每两小时看看')).toBeNull()
    expect(diffText('新文件进来', '主干有新提交')).toBeNull()
  })

  it('没变回 null', () => {
    expect(diffText('一样', '一样')).toBeNull()
  })
})
