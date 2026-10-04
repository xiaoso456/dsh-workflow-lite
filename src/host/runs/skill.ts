/**
 * dsh-workflow-lite — 按需 skill `workflow-run-state`：运行状态的字段、`state` 动作的用法与维护规矩。
 *
 * 计划末尾的「运行状态」段只放执行时离不开的几条；字段全表、例子、恢复步骤、常见错误都在这里，
 * 模型拿不准时才读（目录里只常驻一句摘要）。状态由插件写——模型经 `workflow_lite` 的 `state`
 * 动作改，插件补时间、轮次、流水并当场校验，所以这里不教怎么手写 YAML。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/skill
 */

import type { Context } from '@deepseek-ai/cordis'
// 只借类型：`ctx.skills` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-skill'

export const RUN_STATE_SKILL = 'workflow-run-state'

const DESCRIPTION =
  'workflow-lite 工作流实例的运行状态：用 workflow_lite 的 state 动作记进度，字段含义、什么时候记、中断后怎么接着跑。'

const WHEN_TO_USE =
  '执行一个开了「记录运行状态」的工作流（计划末尾有「运行状态」段）、要记进度或恢复、state 报错看不懂、或收到「用户修改了运行状态 / 图」的通知时。'

const CONTENT = `# 工作流运行状态（workflow-lite）

每次执行一个工作流都是一个**工作流实例**：插件拍一份图的快照，在工作区建好实例目录 \`.workflow-lite/runs/<实例 id>/\`（\`tasks/\` 是各步骤的任务描述，\`out/\` 是默认的产出目录）。开了「记录运行状态」的工作流还带一份运行状态，计划末尾有「运行状态」段。执行期间由你记进度，用户在画布上实时看着，也可能在画布上改。

## 怎么记：\`state\` 动作

**只用 \`workflow_lite\` 的 \`state\` 动作，不要直接编辑状态文件。** 插件替你做三件事：

- 改步骤状态时补上 \`round\`（重新 running 算新的一轮）、\`startedAt\` / \`finishedAt\`；
- 每处状态变化往流水 \`log\` 追加一条，更新 \`updatedAt\`；
- 改完整份校验：不合法就整次拒绝（什么都不写），返回 \`路径: 问题（可选值…）\` 的清单，照着改了再调一次。

不带任何改动调用 \`state\` 就是查看当前状态（各步骤状态、进度、最近几条流水）。

参数：

| 参数 | 含义 |
|---|---|
| instance | 实例 id；缺省 = 本会话当前的实例 |
| status | 整体状态：pending / running / waiting / done / failed / cancelled |
| note | 整体的一句说明：waiting 写等什么，failed / cancelled 写原因；空串 = 清掉 |
| nodes | 要改的步骤列表，每项 \`{ id, status, summary, outputs, verdict, error, by }\`，只写要改的字段 |
| log | 往流水追加一条说明 |

步骤的字段：

| 字段 | 含义 |
|---|---|
| status | pending / running / waiting / done / failed / skipped |
| summary | done 时写一两句结论，200 字以内，别贴原文 |
| outputs | 这一轮实际写出的文件路径列表，照计划里给的路径写 |
| verdict | 有条件出边的步骤 done 时必填：取它出边的条件值之一（pass / fail，或那句自然语言条件原文） |
| error | failed 时必填：失败原因 |
| by | 谁做的：self / subagent / 队员名 |

summary、verdict、error、by 写空串 = 清掉；outputs 给空列表 = 清掉。

## 谁来记

| 执行方式 | 谁调用 state |
|---|---|
| 自动 / 串行 | 你（主 agent） |
| 主 agent + 子代理 | 你（leader）。子代理不调用它；派发时让他们把结论、判定、产出路径报回来，你来记 |
| Agent 团队 | 你（Team Lead）。队员不调用它，用 send_message 回报，你来记 |

## 什么时候记

| 时刻 | 调用 |
|---|---|
| 开始执行 | \`status: running\` |
| 派发一个步骤之前 | 它 \`status: running\` |
| 步骤做完 | \`status: done\` + summary + outputs（+ verdict）；失败 \`status: failed\` + error |
| 分支没走到的步骤 | \`status: skipped\` |
| 循环回到某个步骤 | 它重新 \`status: running\`（插件算新的一轮，上一轮的结论留在流水里） |
| 要等用户 | 步骤或整体 \`status: waiting\` + 整体 note 写等什么；用户答复后改回 running |
| 全部走完 / 走不下去 / 用户叫停 | 整体 \`status: done\` / \`failed\` / \`cancelled\` + note |

同一批次并行派出的几个步骤可以在一次调用里一起改；一个步骤做完、下一个开始也可以一次写完。

## 例子

开始执行，同时派出第一个步骤：

\`\`\`json
{"action": "state", "instance": "20261002-143012-a3f9", "status": "running", "nodes": [{"id": "scan", "status": "running", "by": "subagent"}]}
\`\`\`

审查做完（它有 pass / fail 两条条件出边），接着去修：

\`\`\`json
{"action": "state", "instance": "20261002-143012-a3f9", "nodes": [
  {"id": "review", "status": "done", "verdict": "fail", "summary": "2 处缺少过期校验。", "outputs": [".workflow-lite/runs/20261002-143012-a3f9/out/review.md"]},
  {"id": "fix", "status": "running"}
]}
\`\`\`

要等用户确认：

\`\`\`json
{"action": "state", "instance": "20261002-143012-a3f9", "status": "waiting", "note": "等用户确认要不要改公共接口"}
\`\`\`

## 常见错误

- verdict 不在出边的条件里，或有条件出边的步骤 done 了没写 verdict；
- failed 没写 error；
- 整体 done 了却还有 running / waiting 的步骤；
- 把文件节点写进 nodes（文件不记状态）；步骤 id 大小写和图里不一致。

## 中断后接着跑

1. 调用 \`workflow_lite\` 的 \`resume\`（不给 instance 就是本会话当前的实例）：它重建计划、给出进度摘要 \`progress\`：
   - \`last\`：最后执行的步骤（做完了、下游还没接上的；带轮次、判定）；
   - \`next\`：接下来该做的步骤，每项 \`{ node, round, reason, from, loop }\`——\`reason\` 是 \`interrupted\`（停在 running，被打断）/ \`flow\`（上游交过来；\`loop\` 表示循环回到这一步）/ \`start\`（入口还没开始）/ \`reset\`（被改回 pending）/ \`pinned\`（用户指定）；
   - \`hint\`：上面两项的一句话说明。
2. **照 \`next\` 接着做**，不要按清单顺序找第一个没完成的步骤：循环里每步都做过一轮、都是 done，那样会跳出环。\`next\` 是插件按图、各步骤的判定和流水的先后推出来的。
3. 被打断的步骤重做这一轮（状态已经是 running，不用再改）；循环回到的步骤照常改成 running，插件算新的一轮。

平时每次调用 \`state\` 也会回 \`last\` 和 \`next\`：你打算做的和 \`next\` 对不上时（比如判定是 fail，\`next\` 却不是修复那一步），先停下核对状态再继续。

## 用户改了状态

用户在画布上改完点「保存并通知模型」，你会收到一条通知，列出改了哪些字段和改完后的执行位置，可能带用户的说明。用户可以**指定下一步**（状态里的 \`next\`，\`next\` 返回里 reason 是 \`pinned\`）：先做指定的步骤，你把它改成 running 时插件自动取消指定；指定之前没接上的交接不用再补。其余按最新状态调整：改回 pending 的步骤要重新执行；skipped 的不再执行；整体 waiting 就停下来问用户；cancelled 就结束并汇报。拿不准当前状态时，不带改动调用一次 state 看看。

## 用户改了图

用户也能在画布上改这次执行的图：改提示词、加删步骤、改连线与条件、改资源。保存后你会收到「用户修改了 … 的图」的通知，列出改了什么。收到后先调用 \`workflow_lite\` 的 \`resume\`（instance 同一个）拿最新的计划，按新计划接着做：做完的步骤不用重做（除非状态被改回 pending），新加的步骤（状态是 pending）按计划的顺序补上，删掉的不再做。各步骤的任务描述文件已经换成新的。执行过的步骤用户删不掉，只能改成 skipped。

## 不要做的事

- 直接编辑 \`.workflow-lite/runs/\` 下的状态文件；
- 让子代理、队员调用 state；
- 在 summary 里贴大段原文。
`

/**
 * 注册 skill；`skills` 服务不在时什么也不做（计划里的「运行状态」段照写）。
 * @returns 注销器。
 */
export function registerRunStateSkill(ctx: Context): () => void {
  return ctx.skills.register({
    name: RUN_STATE_SKILL,
    description: DESCRIPTION,
    whenToUse: WHEN_TO_USE,
    source: 'runtime',
    content: CONTENT,
  })
}
