/**
 * dsh-workflow-lite — 一份产出的各版怎么排给人看：画布卡片上的一排点、查看框里的版本列表都从这里取。
 *
 * 存下的各版（`run/history`，见 `host/runs/history.ts`）按时间排，最后补一点「最新」——现在的文件。
 * 现在的文件就是最后存的那一版（修改时间、大小都对得上）时不另补：那一版就是最新。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/outputHistory
 */

import type { RunHistoryResponse, RunVersion } from '../../shared/wire.ts'
import type { T } from '../i18n.ts'
import { shortTime } from './time.ts'

/** 现在的文件此刻的样子（`run/stat`）。 */
export interface LiveFile {
  exists: boolean
  size: number
  mtime: number
}

export interface HistoryDot {
  /** 读这一点要带的版本号；最新（读现在的文件）是 `null`。 */
  v: number | null
  /** 这一点的身份串（React key、记「钉住时最新的是哪一点」）。 */
  key: string
  /** 存下的那一版；只有「最新」、且和存下的都不一样时是 `null`。 */
  version: RunVersion | null
  /** 有判定时：把流程领回去重做（`again`）还是往下走（`pass`）。 */
  tone: 'pass' | 'again' | null
}

export interface HistoryLine {
  dots: HistoryDot[]
  /** 第一点后面省略了几版（超了上限从中间删掉的）。 */
  dropped: number
}

function toneOf(version: RunVersion | null): HistoryDot['tone'] {
  const verdicts = version?.verdicts ?? []
  if (verdicts.length === 0) return null
  return verdicts.some((verdict) => verdict.again) ? 'again' : 'pass'
}

/** 现在的文件就是这一版。 */
export function isLive(version: RunVersion, live: LiveFile | undefined): boolean {
  return live?.exists === true && live.size === version.size && live.mtime === version.mtime
}

/** 排成一行：存下的各版，加上「最新」。一版都没存过是空的。 */
export function historyLine(
  history: RunHistoryResponse | null,
  live: LiveFile | undefined,
): HistoryLine {
  const versions = history?.versions ?? []
  if (versions.length === 0) return { dots: [], dropped: 0 }
  const dots: HistoryDot[] = versions.map((version) => ({
    v: version.v,
    key: `v${version.v}`,
    version,
    tone: toneOf(version),
  }))
  const last = dots.at(-1) as HistoryDot
  if (last.version !== null && isLive(last.version, live)) {
    last.v = null
  } else {
    dots.push({ v: null, key: `live:${live?.mtime ?? 0}`, version: null, tone: null })
  }
  return { dots, dropped: history?.dropped ?? 0 }
}

/** 第几点是现在显示的那一版（`v` 为 `null` = 最新）。找不到（那一版被删了）当最新。 */
export function dotIndex(line: HistoryLine, v: number | null): number {
  const found = line.dots.findIndex((dot) => dot.v === v || (v !== null && dot.version?.v === v))
  return found >= 0 ? found : line.dots.length - 1
}

/**
 * 这一版叫什么：「改稿 · 第 2 轮」「改稿 · 执行前」；最新的、没存过的是「最新」。
 * @param names - 步骤 id → 名字（不在表里就用 id）。
 */
export function versionName(
  t: T,
  version: RunVersion | null,
  names: Readonly<Record<string, string>>,
): string {
  if (version === null) return t('history.live')
  const step = names[version.step] ?? version.step
  if (version.phase === 'before') {
    return version.round <= 1
      ? t('history.before').replace('{step}', step)
      : t('history.beforeRound').replace('{step}', step).replace('{round}', String(version.round))
  }
  const round = t('history.round').replace('{step}', step).replace('{round}', String(version.round))
  return version.phase === 'failed' ? `${round}${t('history.failedMark')}` : round
}

/** 悬停一点的说明：名字、时间，有判定再加一句「审稿：未通过」。 */
export function versionTip(t: T, dot: HistoryDot, names: Readonly<Record<string, string>>): string {
  const { version } = dot
  const parts = [versionName(t, version, names)]
  if (version !== null) parts.push(shortTime(version.at))
  if (dot.v === null && version !== null) parts.push(t('history.live'))
  for (const verdict of version?.verdicts ?? []) {
    parts.push(`${names[verdict.step] ?? verdict.step}：${verdict.value}`)
  }
  return parts.join(' · ')
}
