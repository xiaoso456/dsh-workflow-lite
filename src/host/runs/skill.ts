/**
 * dsh-workflow-lite — 按需 skill `workflow-run-state`：状态文件的完整格式与维护规矩，
 * 外加随包分发的校验脚本。
 *
 * 计划末尾的「运行状态」段只放执行时离不开的几条；字段全表、样例、恢复步骤、常见错误都在这里，
 * 模型拿不准时才读（目录里只常驻一句摘要）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/skill
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
// 只借类型：`ctx.skills` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-skill'

export const RUN_STATE_SKILL = 'workflow-run-state'

/** 资源目录相对 host 产物（`lib/index.mjs`）的位置；校验脚本由 tsdown 单独打到这里。 */
const SKILL_DIR = join('skills', RUN_STATE_SKILL)
const VALIDATOR = 'validate-state.mjs'

/** 随包分发的资源目录（找不到就 `undefined`——源码直跑、单测时就是这样）。 */
export function skillDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = join(here, SKILL_DIR)
  return existsSync(join(dir, VALIDATOR)) ? dir : undefined
}

/** 校验脚本的绝对路径。 */
export function validatorPath(): string | undefined {
  const dir = skillDir()
  return dir === undefined ? undefined : join(dir, VALIDATOR)
}

const DESCRIPTION =
  'workflow-lite 工作流实例的 YAML 状态文件：字段含义、谁在什么时候改、怎么校验、中断后怎么接着跑。'

const WHEN_TO_USE =
  '执行一个开了「记录运行状态」的工作流（计划末尾有「运行状态」段）、要更新或恢复状态文件、校验报错看不懂、或收到「用户修改了运行状态」的通知时。'

function content(validator: string | undefined): string {
  const check =
    validator === undefined
      ? '校验脚本没有随插件装好；按下面的字段表自己核对一遍。'
      : `\`\`\`\nnode "${validator}" "<状态文件路径>"\n\`\`\`\n\n合法时打印 \`OK\`、退出码 0；不合法时逐条打印 \`路径: 问题（可选值…）\`、退出码 1。照着改完再跑一次，直到 OK。`
  return `# 工作流运行状态（workflow-lite）

开了「记录运行状态」的工作流，每次编译都会建一个**工作流实例**：插件拍一份图的快照、按初始状态建好一份 YAML 状态文件，计划末尾的「运行状态」段写着它的路径。执行期间由你维护这份文件，用户在画布上看着它实时刷新，也可能在画布上改它。

## 谁来改

| 执行方式 | 谁改状态文件 |
|---|---|
| 自动 / 串行 | 你（主 agent） |
| 主 agent + 子代理 | 你（leader）。子代理不碰它；派发时写明"不要改状态文件"，让他们把结论、判定、产出路径报回来，你来记 |
| Agent 团队 | 你（Team Lead）。队员不碰它，用 send_message 回报，你来记 |

用户可能在画布上改过它：**每次改之前先重新读一遍**，只改你要改的地方，不要拿旧内容整份覆盖。

## 什么时候改

| 时刻 | 改什么 |
|---|---|
| 开始执行 | 顶层 \`status: running\`；\`log\` 记一条 \`start\`（不带 node） |
| 派发一个步骤之前 | 它 \`status: running\`、\`round\` +1、\`startedAt\`；\`log\` 记 \`start\` |
| 步骤做完 | \`done\` 或 \`failed\`、\`finishedAt\`、\`summary\`、\`outputs\`；有条件出边的写 \`verdict\`；失败写 \`error\`；\`log\` 记 \`done\` / \`failed\` |
| 分支没走到的步骤 | \`skipped\`；\`log\` 记 \`skipped\` |
| 循环回到某个步骤 | 它重新 \`running\`，\`round\` +1（上一轮的结论留在 log 里） |
| 要等用户 | 步骤或顶层 \`waiting\` + 顶层 \`note\` 写等什么；用户答复后改回 \`running\` |
| 全部走完 / 走不下去 / 用户叫停 | 顶层 \`done\` / \`failed\` / \`cancelled\`，\`note\` 写一句 |

同一批次并行派出的几个步骤，可以一次都改成 \`running\`。每次改动都更新 \`updatedAt\`，改完都校验。

## 字段

顶层：

| 字段 | 必填 | 含义 |
|---|---|---|
| version / instance / workflow / plan / graph / mode | 是 | 插件写的身份信息，**不要改** |
| goal | 否 | 编译时的目标（插件写） |
| status | 是 | pending / running / waiting / done / failed / cancelled |
| updatedAt | 是 | 最后一次改动的时间，ISO 8601 带时区，如 2026-10-02T14:30:00+08:00 |
| note | 否 | waiting / failed / cancelled 时写原因 |
| nodes | 是 | 每个**步骤**一项（文件节点不在这里），键是步骤 id，大小写与图一致 |
| log | 是 | 事件流水，只追加；没有事件时是 \`[]\` |

每个步骤：

| 字段 | 必填 | 含义 |
|---|---|---|
| status | 是 | pending / running / waiting / done / failed / skipped |
| round | 开始过就必填 | 第几轮，从 1 起 |
| startedAt / finishedAt | running 要 startedAt；done、failed 要 finishedAt | 本轮的开始、结束时间 |
| by | 否 | 谁做的：self / subagent / 队员名 |
| verdict | 有条件出边且 done 时必填 | 这一轮的判定，必须是它出边 when 的值之一（pass / fail 或那句自然语言条件原文） |
| summary | done 时建议填 | 一两句结论，200 字以内，别贴原文 |
| outputs | 否 | 这一轮实际写出的文件路径列表 |
| error | failed 时必填 | 失败原因 |

log 每条：at（时间）、event（start / done / failed / waiting / skipped / resume / transfer / edit / note）、可选 node / round / verdict / detail。\`by: user\` 只出现在插件替用户写的条目上，你写的条目不要带 by。

## 样例

\`\`\`yaml
version: 1
instance: 20261002-143012-a3f9
workflow: code-review
plan: 3f9a1c2e
graph: C:/Users/me/.dsh/workflow-lite/runs/20261002-143012-a3f9/graph.json
mode: subagent
goal: 审一遍认证模块
status: running
updatedAt: 2026-10-02T14:41:07+08:00
nodes:
  scan:
    status: done
    round: 1
    startedAt: 2026-10-02T14:30:40+08:00
    finishedAt: 2026-10-02T14:33:02+08:00
    by: subagent
    summary: 找到 3 处 token 校验分散在中间件和路由里。
    outputs: [docs/scan-notes.md]
  review:
    status: done
    round: 1
    finishedAt: 2026-10-02T14:38:15+08:00
    verdict: fail
    summary: 2 处缺少过期校验。
  fix:
    status: running
    round: 1
    startedAt: 2026-10-02T14:40:51+08:00
  report:
    status: pending
log:
  - at: 2026-10-02T14:30:40+08:00
    node: scan
    event: start
  - at: 2026-10-02T14:38:15+08:00
    node: review
    event: done
    verdict: fail
\`\`\`

## 校验

${check}

常见错误：verdict 不在出边的条件里；时间没带时区；改了身份字段；done 的步骤缺 finishedAt；整体 done 了却还有 running 的步骤；把文件节点写进了 nodes。

## 中断后接着跑

1. 同一会话：重新读状态文件；换了会话：先调用 \`workflow_lite\` 的 \`resume\`（不给 instance 就是本会话当前的实例），它会重建计划、给出状态文件路径和进度摘要。
2. 从第一个没完成（不是 done / skipped）的步骤接着做；停在 running 的步骤视为被打断，重做这一轮。
3. \`log\` 记一条 \`resume\`（resume 动作已经替你记了就不用再记）。

## 用户改了状态

用户在画布上改完点「保存并通知模型」，你会收到一条通知，列出改了哪些字段，可能带用户的说明。先重新读状态文件，再按最新状态调整：改回 pending 的步骤要重新执行；skipped 的不再执行；顶层 waiting 就停下来问用户；cancelled 就结束并汇报。之后照常维护。

## 不要做的事

- 改身份字段，或删改旧的 log 条目；
- 让子代理、队员写状态文件；
- 在 summary 里贴大段原文；
- 跳过校验。
`
}

/**
 * 注册 skill；`skills` 服务不在时什么也不做（计划里的「运行状态」段照写）。
 * @returns 注销器。
 */
export function registerRunStateSkill(ctx: Context): () => void {
  const dir = skillDir()
  return ctx.skills.register({
    name: RUN_STATE_SKILL,
    description: DESCRIPTION,
    whenToUse: WHEN_TO_USE,
    source: 'runtime',
    content: content(validatorPath()),
    ...(dir === undefined ? {} : { resourceBase: { kind: 'directory' as const, path: dir } }),
  })
}
