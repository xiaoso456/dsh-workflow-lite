/**
 * dsh-workflow-lite — 按需 skill `workflow-trigger`：怎么给工作流加触发卡片，以及要写脚本时的两个约定和常用样板。
 *
 * 用户在会话里说「日志里出现 ERROR 就跑这个工作流」，其余由模型做：挑触发源、需要时写脚本放进工作流目录、
 * 自己先跑一遍、用 `write_trigger` 加一张关着的卡片，最后请用户在画布上打开。开关只在用户手里——
 * 命令以 DSH 进程的身份运行，打开时插件会把命令给用户确认。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggerSkill
 */

import type { Context } from '@deepseek-ai/cordis'
// 只借类型：`ctx.skills` 的 Context 合并。
import type {} from '@deepseek-ai/dsh-skill'

export const TRIGGER_SKILL = 'workflow-trigger'

const DESCRIPTION =
  'workflow-lite 工作流的触发卡片：让工作流到点、条件满足、收到通知时自动执行；轮询命令与监听程序的约定和样板脚本。'

const WHEN_TO_USE =
  '用户想让一个工作流自动执行（定时、文件夹里有新文件、日志出现关键字、网页内容变了、Git 有新提交、收到消息或 HTTP 请求、另一个工作流跑完之后），或要改已有的触发卡片时。'

const CONTENT = `# 工作流的触发卡片（workflow-lite）

触发卡片让一个工作流在某件事发生时自动执行：插件把工作流发进一个会话，由那边的模型照常执行。卡片不是步骤、不连线，触发的是整个工作流。

用 \`workflow_lite\` 的 \`write_trigger\` 建、改卡片。**你建的卡片一律是关着的**：工作区、命令的确认和开关都在用户手里，建好后请用户在画布上打开。

## 选触发源

| 想要 | 用 | 要写的 |
|---|---|---|
| 每天几点、每隔多久、cron | \`schedule\` | 规则 |
| 隔一段查一次某个状态（远端有新提交、网页变了、文件出现了） | \`poll\` 条件轮询 | 一条很快结束的命令 |
| 一直盯着、事情一来就触发（日志、文件夹、消息队列、端口） | \`listen\` 监听程序 | 一条常驻命令 |
| 别的程序（CI、脚本、别的工具的回调）来通知 | \`http\` | 不用写；卡片上给出地址、令牌和 curl |
| 另一个工作流跑完了接着跑这一个（串成流水线、失败后善后） | \`after\` | 不用写；选那个工作流和结果 |

能用轮询就别写监听程序：轮询的命令短、好试、出错好查。

## 两个约定

**条件轮询**（\`poll\`）：插件每隔 \`seconds\` 秒在用户选的工作区里跑一次命令。

- 退出码 0 = 条件满足，非 0 = 不满足（这是正常结果，不算失败）；
- 标准输出就是这次的背景信息，原样交给执行的模型；错误输出只给人排查用；
- \`when: "success"\`（缺省）只在「上一次不满足、这一次满足」时触发一次，条件一直成立不会反复触发；
- \`when: "change"\`：输出和上一次不一样就触发（第一次只记下），适合「网页变了」「有新提交」——命令只要打出当前的状态；
- 命令要很快结束（最长 5 分钟，再长按超时算失败）、不要等输入；找不到命令、超时算一次失败，连续几次会自动停用。

**监听程序**（\`listen\`）：打开时插件启动这个命令，关掉时结束它，意外退出按退避重启。

- 标准输出**每打一行就是一次触发**，这一行就是背景信息；一件事的内容有好几行时，打成一行 JSON；
- 打完一行马上刷新输出（Node 的 \`console.log\` 可以；Python 要 \`print(..., flush=True)\`；管道里的 \`grep\` 要 \`--line-buffered\`）；
- 日志、调试信息写到错误输出，别写到标准输出；
- 一直运行，收到结束信号就退出；**不要自己转后台**（不要 \`&\`、\`nohup\`、守护进程）；
- 启动后一分钟内就退出算一次失败（脚本有错、依赖没装），连续几次会自动停用。

## 脚本写在哪、用什么写

- **优先用 Node 写**：DSH 本身跑在 Node 上，各系统都能跑；\`tail\`、\`grep\`、Python 在 Windows 上不一定有。命令写 \`node "{workflow}/triggers/xxx.mjs" 参数…\`。
- 脚本放进工作流目录：\`read\` 返回的 \`dir\` 就是它（命令里写 \`{workflow}\`，插件运行时换成这个目录；也可以读环境变量 \`WORKFLOW_DIR\`）。放在这里的文件随工作流一起导出。
- 命令在用户打开卡片时选的工作区里运行，由系统的 shell 执行（Windows 是 cmd，其余是 sh）：路径加双引号；Windows 下别用 \`'单引号'\` 和 \`%\`，sh 下别在双引号里用 \`$\`。
- 要用第三方库时，在工作流目录里放 \`package.json\` 并装好依赖。

## 步骤

1. \`read\` 这个工作流，拿到 \`dir\`；看看 \`triggers\` 里是不是已经有卡片了（有就改它，不要重复建）。
2. 要脚本就写进 \`dir/triggers/\`。
3. **自己先跑一遍**（把 \`{workflow}\` 换成 \`dir\`）：轮询的看退出码和输出对不对；监听程序跑十几秒、自己制造一次事件，看是不是打出了一行，再结束它。
4. \`write_trigger\` 建卡片：\`trigger.source\` 写触发源；\`note\` 写每次触发要处理什么、要求是什么；需要时加过滤和触发条件（见下）。
5. 告诉用户：在画布上点开这张卡片，选命令在哪个工作区里运行、新会话建在哪，打开开关（会列出命令请他确认）。HTTP 的地址和令牌打开后卡片上就有。

## 别把会话刷爆

- **合并**（\`filter.merge\`，秒）：这么久里进来的几次并成一次。监听程序、HTTP 缺省 5 秒；日志一下刷出几十行时调大。
- **去重**（\`filter.dedupe\`，分钟）：一样的内容这么久里只触发一次。
- **关键字**（\`filter.include\` / \`filter.exclude\`）：背景信息要含哪些字、不能含哪些字。能用关键字筛就别写进脚本里，用户在卡片上改得到。
- **触发条件**（\`condition\`）：要读一下内容才能判断的（「只有涉及支付模块的报错才处理」）写在这里，每次触发先由模型判断，不需要就不开始工作流。要读文件、查资料才能判断的，做成工作流的第一步，用条件连线直接走到结束。
- \`launch.maxPerHour\` 是每小时上限（缺省 12），超过的丢掉。

## 样板

**远端有新提交**（轮询，输出变了时触发，在仓库所在的工作区里运行）：

\`\`\`json
{ "kind": "poll", "command": "git ls-remote origin -h refs/heads/main", "seconds": 300, "when": "change" }
\`\`\`

**网页内容变了**（轮询，输出变了时触发）：

\`\`\`json
{ "kind": "poll", "command": "node -e \\"fetch(process.argv[1]).then(r=>r.text()).then(t=>process.stdout.write(t),e=>{console.error(e.message);process.exit(2)})\\" https://example.com/status", "seconds": 600, "when": "change" }
\`\`\`

只关心页面里的一部分时，写个脚本取出那一部分再打出来，免得页面上的时间戳一变就触发。

**文件夹里有新文件**（监听程序）—— \`{workflow}/triggers/watch-folder.mjs\`，命令 \`node "{workflow}/triggers/watch-folder.mjs" "D:/inbox"\`：

\`\`\`js
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '.')
const every = Number(process.argv[3] ?? 5) * 1000
const seen = new Set(readdirSync(dir))
setInterval(() => {
  let names
  try {
    names = readdirSync(dir)
  } catch (error) {
    console.error(String(error))
    return
  }
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    console.log(JSON.stringify({ event: 'new-file', path: join(dir, name) }))
  }
}, every)
process.on('SIGTERM', () => process.exit(0))
\`\`\`

**日志里出现关键字**（监听程序）—— \`{workflow}/triggers/tail-log.mjs\`，命令 \`node "{workflow}/triggers/tail-log.mjs" "/var/log/app.log"\`，关键字写在卡片的 \`filter.include\` 里：

\`\`\`js
import { closeSync, openSync, readSync, statSync, watchFile } from 'node:fs'

const file = process.argv[2]
let offset = statSync(file).size
let rest = ''
watchFile(file, { interval: 1000 }, (current) => {
  if (current.size < offset) offset = 0 // 日志被轮转了：从头读
  if (current.size === offset) return
  const buffer = Buffer.alloc(current.size - offset)
  const fd = openSync(file, 'r')
  readSync(fd, buffer, 0, buffer.length, offset)
  closeSync(fd)
  offset = current.size
  const lines = (rest + buffer.toString('utf8')).split(/\\r?\\n/)
  rest = lines.pop() ?? ''
  for (const line of lines) if (line.trim() !== '') console.log(line)
})
process.on('SIGTERM', () => process.exit(0))
\`\`\`

**消息队列**（监听程序）：命令行客户端本来就一条消息打一行的，直接当命令用，如 \`mosquitto_sub -h 127.0.0.1 -t "alerts/#"\`；要用 Node 的客户端库时照上面的写法，收到一条 \`console.log\` 一行。

**HTTP**：\`{ "kind": "http" }\`。用户打开后卡片上有地址（缺省用工作流名）、令牌和可复制的 curl，地址和令牌用户都能自己改；请求体原样作为背景信息，请求一到就回 202。缺省只接受本机的请求，要让别的机器调用由用户在插件设置里换监听地址。

**另一个工作流跑完**：\`{ "kind": "after", "workflow": "夜间巡检" }\`（成功时触发；\`"when": "failed"\` 失败时，\`"any"\` 不论结果）。那个工作流要开着记录运行状态（没开就先用 \`configure\` 的 \`run_state\` 打开），插件靠它的运行状态看出什么时候结束；背景信息里有那个实例的编号、结果和运行状态文件的路径，要用它的产出时去读。不能等自己。

## 不要做的事

- 让用户自己去写脚本、自己去试；
- 没试过就加卡片；
- 在命令里用 \`&\`、\`nohup\`、\`start\` 把程序放到后台；
- 一件事打好几行（会被当成好几次触发）；
- 把关键字、判断写死在脚本里，用户改不了（放进卡片的过滤和触发条件）。
`

/**
 * 注册 skill；`skills` 服务不在时由调用方跳过。
 * @returns 注销器。
 */
export function registerTriggerSkill(ctx: Context): () => void {
  return ctx.skills.register({
    name: TRIGGER_SKILL,
    description: DESCRIPTION,
    whenToUse: WHEN_TO_USE,
    source: 'runtime',
    content: CONTENT,
  })
}
