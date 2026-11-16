/**
 * dsh-workflow-lite — 最近的输出里每一条怎么写：结果、退出码、一眼看的那一行、展开后的说明、时长，以及复制出去的文字。
 *
 * 纯函数（界面见 `ui/trigger/output/`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/outputText
 */

import type { OutputEntry, OutputLine } from '../../shared/wire/trigger.ts'
import type { T } from '../i18n.ts'
import { formatBytes } from './fileKind.ts'
import { clockTime, durationText } from './time.ts'

/** 行头的颜色归哪一类：触发、条件不满足、没跑成、在跑、结束了。 */
export type EntryTone = 'met' | 'unmet' | 'fail' | 'run' | 'exit'

export function entryTone(entry: OutputEntry): EntryTone {
  switch (entry.verdict) {
    case 'running':
      return 'run'
    case 'exited':
    case 'stopped':
      return 'exit'
    default:
      return entry.verdict
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `10:33:08`。 */
export function secondsTime(at: number): string {
  return `${clockTime(at)}:${pad(new Date(at).getSeconds())}`
}

/** 行头的结果：「触发」「条件不满足」「没跑成」「运行中」「退出 1」「已停下」。 */
export function verdictText(t: T, entry: OutputEntry): string {
  switch (entry.verdict) {
    case 'met':
      return t('out.v.met')
    case 'unmet':
      return t('out.v.unmet')
    case 'fail':
      return t('out.v.fail')
    case 'running':
      return t('out.v.running')
    case 'stopped':
      return t('out.v.stopped')
    case 'exited':
      return entry.code === null
        ? t('out.v.exitedBare')
        : t('out.v.exited').replace('{code}', String(entry.code))
  }
}

/** 检查的退出码小标：`退出码 0`；非零要醒目；没退出（超时、没跑起来）另写。 */
export function codeChip(t: T, code: number | null): { text: string; tone: 'ok' | 'bad' | 'none' } {
  if (code === null) return { text: t('out.noExit'), tone: 'none' }
  return { text: t('out.code').replace('{code}', String(code)), tone: code === 0 ? 'ok' : 'bad' }
}

/** 一眼看的那一行：没跑成的写原因；没有输出另写。 */
export function previewText(t: T, entry: OutputEntry): string {
  if (entry.verdict === 'fail' && entry.note !== undefined) return entry.note
  return entry.preview === '' ? t('out.noOutput') : entry.preview
}

/** 一次运行的时长（行尾）：在跑的是「已运行 …」，结束了的是「运行 …」。检查没有。 */
export function runSpan(t: T, entry: OutputEntry, now: number): string {
  if (entry.kind !== 'run') return ''
  if (entry.end === undefined) {
    return t('out.runningFor').replace('{d}', durationText(t, now - entry.at))
  }
  return t('out.ran').replace('{d}', durationText(t, entry.end - entry.at))
}

/** 「1.2 秒」「45 秒」。 */
function secondsText(t: T, ms: number): string {
  const seconds = ms / 1000
  return t('out.seconds').replace(
    '{s}',
    seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds)),
  )
}

/**
 * 展开后左边那一句。
 * - 检查：`10:33:08 · 用时 1.2 秒`；合成的：`12 次的输出都一样，下面是 10:18 那一次`；
 * - 运行：`10:02:13 启动 · 只显示最近 50 行`、`09:41:30 启动 · 10:02:07 退出（退出码 1）`。
 * @param tail 只显示了最后这么多行（不是全部时给）。
 */
export function entryMeta(t: T, entry: OutputEntry, tail?: number): string {
  if (entry.kind === 'check') {
    if (entry.count !== undefined && entry.last !== undefined) {
      return t('out.same')
        .replace('{n}', String(entry.count))
        .replace('{time}', secondsTime(entry.last))
    }
    const parts = [secondsTime(entry.at)]
    if (entry.ms !== undefined) parts.push(t('out.took').replace('{s}', secondsText(t, entry.ms)))
    // 退出码 0 时的说明才是新东西（「第一次检查，只记下输出」）；非零的已经写在退出码上了。
    if (entry.note !== undefined && entry.verdict !== 'fail' && entry.code === 0) {
      parts.push(entry.note)
    }
    return parts.join(' · ')
  }
  const parts = [t('out.started').replace('{time}', secondsTime(entry.at))]
  if (entry.end !== undefined) {
    const end = secondsTime(entry.end)
    if (entry.verdict === 'stopped') parts.push(t('out.stoppedAt').replace('{time}', end))
    else if (entry.verdict === 'fail') parts.push(entry.note ?? t('out.v.fail'))
    else if (entry.code === null) parts.push(t('out.exitedAt').replace('{time}', end))
    else {
      parts.push(t('out.exitedCode').replace('{time}', end).replace('{code}', String(entry.code)))
    }
  }
  if (tail !== undefined && entry.lines > tail) {
    parts.push(t('out.tailOnly').replace('{n}', String(tail)))
  }
  return parts.join(' · ')
}

/** 截断的那一行后面的说明：`截断（这一行 18.4 KB）`。 */
export function cutText(t: T, size: number): string {
  return t('out.cut').replace('{size}', formatBytes(size))
}

/** 一条的行写成文字（复制用）：运行的每行带时刻；连着重复的写 `×n`；`err` 关着时不带错误输出。 */
export function linesText(
  entry: Pick<OutputEntry, 'kind'>,
  lines: readonly OutputLine[],
  err: boolean,
): string {
  return lines
    .filter((line) => err || line.stream === 'out')
    .map((line) => {
      const repeat = line.repeat === undefined ? '' : `  ×${String(line.repeat)}`
      return entry.kind === 'run'
        ? `[${secondsTime(line.at)}] ${line.text}${repeat}`
        : `${line.text}${repeat}`
    })
    .join('\n')
}

/** 「复制全部」：每条一个标题行（时刻、结果、退出码），下面是它的行；条与条之间空一行。 */
export function entriesText(
  t: T,
  entries: readonly OutputEntry[],
  lines: ReadonlyMap<number, readonly OutputLine[]>,
  err: boolean,
): string {
  return entries
    .map((entry) => {
      const head = [`[${secondsTime(entry.at)}]`, verdictText(t, entry)]
      if (entry.count !== undefined && entry.last !== undefined) {
        head.push(
          t('out.merged')
            .replace('{n}', String(entry.count))
            .replace('{time}', clockTime(entry.last)),
        )
      }
      if (entry.kind === 'check') head.push(codeChip(t, entry.code).text)
      const body = linesText(entry, lines.get(entry.id) ?? [], err)
      return body === '' ? head.join(' ') : `${head.join(' ')}\n${body}`
    })
    .join('\n\n')
}
