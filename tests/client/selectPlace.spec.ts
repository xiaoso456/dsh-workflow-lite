import { describe, expect, it } from 'vitest'
import { placeMenu } from '../../src/client/ui/kit/Select.tsx'

describe('下拉往哪边开、开多高', () => {
  it('下面放得下就往下，列表不超过 320', () => {
    expect(placeMenu({ below: 600, above: 100, count: 4, searchable: false })).toEqual({
      up: false,
      list: 320,
    })
  })

  it('下面放不下、上面宽：往上开，列表封顶在上面放得下的高度（不越出滚动区）', () => {
    const place = placeMenu({ below: 80, above: 300, count: 20, searchable: true })
    expect(place.up).toBe(true)
    // 300 减去菜单内边距、搜索框、留边。
    expect(place.list).toBe(300 - 16 - 38 - 8)
  })

  it('上下都窄：往宽的那边，至少给 120（在滚动区里滚，别只露一两项）', () => {
    expect(placeMenu({ below: 90, above: 60, count: 20, searchable: false })).toEqual({
      up: false,
      list: 120,
    })
  })
})
