# 消息队列（监视）

命令行客户端（如 `mosquitto_sub`）一条消息打一行，但不带 `::trigger::`，直接当命令用不会触发。写个脚本把它作为子进程跑起来，一条消息打一行事件；客户端自己的输出、连接日志照样是日志。

命令 `node "{workflow}/triggers/mq.mjs"`：

```js
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

// text：一句话说清这件事，动态拿到的文字直接拼进来；data：要原样给出的字段（可选，跟在后面成一段 JSON）。
// 换行一律换掉：一件事只能占一行，不然后面几截没带标记，只算日志。
const emit = (text, data) => {
  const line = data === undefined ? String(text) : `${text} ${JSON.stringify(data)}`
  console.log(`::trigger:: ${line.replace(/\r?\n/g, ' ⏎ ')}`)
}
// -v 在每行前面带上主题，不然执行的模型不知道消息是哪个主题来的。
const client = spawn('mosquitto_sub', ['-v', '-h', '127.0.0.1', '-t', 'alerts/#'])
createInterface({ input: client.stdout }).on('line', (line) => {
  const space = line.indexOf(' ')
  if (space < 0) return console.log(`[mq] 看不懂：${line}`)
  emit(`主题 ${line.slice(0, space)} 来了消息：${line.slice(space + 1)}`)
})
client.stderr.pipe(process.stderr)
client.on('exit', (code) => process.exit(code ?? 1))
process.on('SIGTERM', () => client.kill())
```

- 消息内容本身有换行时，`mosquitto_sub` 会把它打成好几行、拆成好几件，这时改用 Node 的客户端库（如 `mqtt`），收到一条 `emit` 一次（换行由 `emit` 换掉）。
- 客户端退出时脚本跟着退出，插件会按退避重启。

试：`poke` 发一条测试消息，如 `mosquitto_pub -h 127.0.0.1 -t alerts/test -m "disk full"`；看 `events` 里正好一行，主题、内容对得上。
