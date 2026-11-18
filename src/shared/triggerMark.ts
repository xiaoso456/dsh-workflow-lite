/**
 * dsh-workflow-lite — 事件行：命令往标准输出打的哪几行是要触发的事。
 *
 * 只有以 {@link TRIGGER_MARK} 开头的行（前面可以有空白）是事件，标记后面的内容（去掉首尾空白）是这件事的背景信息；
 * 别的行，不论标准输出还是错误输出，都是日志：照样记进「最近的输出」给人看，不触发。
 * 这样脚本可以随便打日志，第三方库、子进程打到标准输出的也不会误触发、白白花一次模型调用。
 *
 * - 监视：每一行事件触发一次（再过过滤、合并）。
 * - 定时检查：退出码决定满不满足；标准输出里有事件行时，只有这几行（去掉标记、按行连起来）是背景信息、
 *   拿来和上一次比较，没有时整段标准输出都是（只打一个状态的命令不用改）。
 *
 * 写成 `::trigger::` 是因为它在 sh、cmd、PowerShell 里都能原样 `echo` 出来（`#` 在 sh 里是注释、`@` 在
 * PowerShell 里会展开），普通日志里也碰不到；用过 GitHub Actions 的 `::set-output::` 的人一看就懂。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/triggerMark
 */

/** 事件行的开头。 */
export const TRIGGER_MARK = '::trigger::'

/** 一行是事件时回它带的背景信息（可以是空串），不是事件回 `null`。 */
export function eventOf(line: string): string | null {
  const text = line.trimStart()
  return text.startsWith(TRIGGER_MARK) ? text.slice(TRIGGER_MARK.length).trim() : null
}

/** 一行拆成标记前的空白、标记、后面的内容（给界面把标记单独画出来）；不是事件回 `null`。 */
export function markParts(line: string): { mark: string; rest: string } | null {
  const text = line.trimStart()
  if (!text.startsWith(TRIGGER_MARK)) return null
  return { mark: TRIGGER_MARK, rest: text.slice(TRIGGER_MARK.length) }
}

/** 一段标准输出里的事件行各自带的背景信息，按先后。 */
export function eventsOf(output: string): string[] {
  const events: string[] = []
  for (const line of output.split(/\r?\n/u)) {
    const info = eventOf(line)
    if (info !== null) events.push(info)
  }
  return events
}

/** 看着像上一行的下一截：缩进的、堆栈（`at …`、`Caused by`）、省略号、收尾的括号。 */
const CONTINUED = /^(\s|at\s|Caused by|\.\.\.|[}\])])/u

/** 一行里没配平的开括号数（`{`、`[` 算加，`}`、`]` 算减）。 */
function depthOf(text: string): number {
  let depth = 0
  for (const char of text) {
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
  }
  return depth
}

/**
 * 被换行断开的事件：多行内容拼进事件时没去掉换行，只有第一行带标记，后面几截只算日志、不进背景信息，
 * 而且不报错。按样子猜：事件行后面紧跟着的行看着像它的下一截（见 {@link CONTINUED}），或事件里的括号没配平。
 * 只给试运行提醒用，不改怎么触发。`lines` 是标准输出按先后的各行；回断开的事件有几行、第一处的下一截、
 * 各截在 `lines` 里的位置（界面把它们标出来）。
 */
export function brokenEvents(
  lines: readonly string[],
): { count: number; sample: string; cut: number[] } | null {
  let count = 0
  let sample = ''
  const cut: number[] = []
  // 正跟在一行事件（或它的下一截）后面；那件事算过没有；括号还差几个没配平。
  let open = false
  let counted = false
  let depth = 0
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') continue
    const info = eventOf(line)
    if (info !== null) {
      open = true
      counted = false
      depth = depthOf(info)
      continue
    }
    if (open && (depth > 0 || CONTINUED.test(line))) {
      if (!counted) {
        count += 1
        counted = true
        if (sample === '') sample = line.trim()
      }
      cut.push(index)
      depth += depthOf(line)
      continue
    }
    open = false
  }
  return count === 0 ? null : { count, sample, cut }
}

/**
 * 定时检查这一次交出去的背景信息：有事件行就只用它们（按行连起来），没有就是整段标准输出（去掉首尾空白）。
 * 「输出变了」也拿它比较，日志里的时间戳不会让每次都算「变了」。
 */
export function checkInfo(output: string): string {
  const events = eventsOf(output)
  return events.length > 0 ? events.join('\n').trim() : output.trim()
}
