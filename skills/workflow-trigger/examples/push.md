# 对方推过来：消息队列、长连接、常驻命令行程序（监视）

本机连出去、一直等对方推：消息队列、WebSocket / SSE、聊天软件（飞书、钉钉、Slack）的长连接或 Stream 模式、`docker events`、`kubectl get -w`。最快（一秒内），也不用公网地址。下面拿 `mosquitto_sub` 写：它一条消息打一行但不带 `::trigger::`，脚本把它作为子进程跑起来，一条打一件。命令 `node mq.mjs`。

```js
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { emit, injected, log, onStop, stream } from '../watch.mjs'

const handle = ({ topic, message }) => emit(`主题 ${topic} 来了消息：${message}`)

let client = null
onStop(() => client?.kill())
injected(handle)
await stream(
  () =>
    new Promise((resolve, reject) => {
      client = spawn('mosquitto_sub', ['-v', '-h', '127.0.0.1', '-t', 'alerts/#']) // -v 带上主题
      createInterface({ input: client.stdout }).on('line', (line) => {
        const space = line.indexOf(' ')
        if (space < 0) return log(`看不懂：${line}`)
        handle({ topic: line.slice(0, space), message: line.slice(space + 1) })
      })
      client.on('error', reject) // 起不来：多半是没装
      client.on('exit', () => resolve()) // 断了：stream 退避后重连
    }),
)
```

- 用对方的 Node SDK（Kafka、RabbitMQ、Redis 订阅、聊天软件）：在卡片目录放 `package.json` 装好，`stream` 里建连接、等它断开，收到一条交给 `handle`；SDK 的接口以对方当前的文档为准。应用的 ID、密钥放密钥目录，用 `secret` 读。对方会重投的按消息编号用 `seenIds` 去重。
- 对方只有回调、没有长连接：要验签名、握手的看 `examples/webhook.md`，直接 POST 的用 `http`（`examples/gitlab.md`）；都没有只能查的看 `examples/records.md`。

试：存卡片目录的 `samples/message.json`：`{"topic": "alerts/test", "message": "disk full"}`，`poke` 写 `node ../watch.mjs inject samples/message.json`。`events` 里正好一行。真连接对不对看 `run.stderr`，或请用户在试的那几十秒里真发一条（`seconds` 写 30 到 60）。
