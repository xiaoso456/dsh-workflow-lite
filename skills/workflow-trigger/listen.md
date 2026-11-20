# 监视 `listen`

打开开关时插件启动这条命令，关掉时结束它；意外退出按 2 秒起翻倍、最长 1 分钟的间隔重启。

先按 SKILL.md 的「找示例」挑最像的一份示例照着改，别从头写。脚本放进 `dir/triggers/`，用底子 `./watch.mjs`（插件放好了，`kit.md`）。

## 从头到尾一个例子

工作区里有一份别的程序会往里加任务的清单 `tasks.json`（`[{"id": 1, "title": "…"}]`），多了新任务就执行一次工作流。下面原样能跑。

1. 脚本写进 `dir/triggers/new-tasks.mjs`：

```js
import { existsSync, readFileSync } from 'node:fs'
import { emit, log, poll, seenIds } from './watch.mjs'

const file = process.argv[2]
const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [])
const seen = seenIds()

if (seen.first) {
  for (const task of read()) seen.add(task.id) // 第一次只记下已有的，不当成新任务
  seen.save()
  log('第一次运行，只记下已有的任务')
}
await poll(
  () => {
    const fresh = read().filter((task) => seen.add(task.id))
    for (const task of fresh) emit(`任务清单里来了新任务 #${task.id}：${task.title}`, { id: task.id })
    seen.save()
    return fresh.length > 0
  },
  { every: 2000, idle: 10_000 },
)
```

2. `write_trigger` 写定义：

```json
{ "source": { "kind": "listen", "command": "node \"{workflow}/triggers/new-tasks.mjs\" tasks.json" }, "note": "处理背景信息里的新任务", "filter": { "merge": 0 } }
```

3. `test_trigger` 带 `poke` 往清单里加一个任务，`seconds` 写 6：

```text
node -e "const fs=require('fs');const t=fs.existsSync('tasks.json')?JSON.parse(fs.readFileSync('tasks.json','utf8')):[];t.push({id:Date.now(),title:'试一下'});fs.writeFileSync('tasks.json',JSON.stringify(t))"
```

4. 看返回：`events` 里正好一行「任务清单里来了新任务 #…：试一下」、`result` 是 `pass`；没有 `run.exited`，`run.stderr` 是空的。

## 只有 `::trigger::` 开头的行会触发

标准输出里以 `::trigger::` 开头的一行就是一件事，标记后面的内容是背景信息。别的输出（不带标记的标准输出、全部错误输出）都是日志，只进「最近的输出」，不触发。

- 用底子的 `emit` 打事件，它会把换行换掉（一件事只能占一行，不然后面几截只算日志）。日志用 `log`，真出错用 `warn`。
- 一行是「一件值得跑一次工作流的事」，不是原始流水的每一行：报错连同堆栈是一件，同一个请求的几行日志是一件。
- 行里写这件事本身（怎么写见 SKILL.md 的「背景信息」）；别带脚本自己打的时刻、随机编号，不然去重永远不算重复。
- 不用底子的（检查命令、别的语言）照这个写，别的语言同理，打完要刷新输出：

```js
const emit = (text, data) => {
  const line = data === undefined ? String(text) : `${text} ${JSON.stringify(data)}`
  console.log(`::trigger:: ${line.replace(/\r?\n/g, ' ⏎ ')}`)
}
```

## 几行事件怎么算成几次

依次过：关键字（`filter.include` / `exclude`，过不了的直接丢掉）→ 去重（`filter.dedupe`，一字不差才算重复）→ 合并（`filter.merge`，监视缺省 5 秒：从第一行通过时起，这段时间里的几行并成一次，背景信息按先后连起来；写 0 是每行马上单独触发）→ 执行设置：上一次还没执行完时 `overlap` 缺省跳过（`queue` 排队、`parallel` 同时跑），一小时到了 `maxPerHour`（缺省 60）丢掉。

事件来得密时先想好要「每件都处理」（排队）、「一阵处理一次」（调大合并）还是「忙时丢掉也行」（跳过）。

## 启动和运行

- 每次启动（打开开关、DSH 重启、退出后重启、改了设置）都从头跑：启动时只记下现状，别把已有的东西当成新事件打出来，否则每次重启都会触发一遍。读到哪记在数据目录，启动时接着读，DSH 没开时漏的就补上了。
- 一直运行，收到结束信号就退出；别自己转后台（`&`、`nohup`、`start`），插件管不到它。
- 启动后 1 分钟内就退出算一次失败（脚本有错、依赖没装、缺密钥）；跑满 1 分钟之后再退出只重启、不算失败。
- 打完一行马上刷新输出（Node 的 `console.log` 就是；Python 要 `flush=True`）；别打终端颜色码。
