/**
 * dsh-workflow-lite — 八种线的颜色：画布上的线、箭头、光带、线上的牌子，面板里的标签和图例都从这里取，
 * 永远是同一个色。色值在 shell.module.css 的 `--wl-flow-*` / `--wl-io-*`。
 * 输入 → 步骤（交回答）用一档中性的墨色：色环上七个色都占满了，再加一个彩色总会和某一个撞；
 * 它另有第二重记号——点线、输入卡。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/lineColors
 */

import type { WhenKind } from '../../model/whenKind.ts'

/** 连着文件或输入的线：整份写出 / 在原文件上更新 / 读取 / 交回答（输入 → 步骤）。 */
export type Access = 'produce' | 'update' | 'read' | 'ask'

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
  ask: 'var(--wl-io-ask)',
}
