/**
 * 七种线的颜色：画布上的线、箭头、光带、线上的牌子，面板里的标签和图例都从这里取，
 * 永远是同一个色。色值在 shell.module.css 的 `--wl-flow-*` / `--wl-io-*`。
 */

/** 步骤之间的线按条件分四种：总是 / 通过 / 未通过 / 自定义条件。 */
export type WhenKind = 'always' | 'pass' | 'fail' | 'custom'

/** 读写线的三种：整份写出 / 在原文件上更新 / 读取。 */
export type Access = 'produce' | 'update' | 'read'

export function whenKind(when: string | undefined): WhenKind {
  if (when === undefined) return 'always'
  return when === 'pass' || when === 'fail' ? when : 'custom'
}

export const WHEN_COLOR: Record<WhenKind, string> = {
  always: 'var(--wl-flow-always)',
  pass: 'var(--wl-flow-pass)',
  fail: 'var(--wl-flow-fail)',
  custom: 'var(--wl-flow-custom)',
}

export const ACCESS_COLOR: Record<Access, string> = {
  produce: 'var(--wl-io-produce)',
  update: 'var(--wl-io-update)',
  read: 'var(--wl-io-read)',
}
