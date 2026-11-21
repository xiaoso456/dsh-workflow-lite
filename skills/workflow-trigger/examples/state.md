# 一个值、一个状态变了（监视）

服务挂了、恢复了；磁盘、积压超过阈值；某个配置项、某个键的值变了。隔一阵读一次，只在变了时打一件，连着两次一样才认（挡掉偶尔一次超时）。命令 `node health.mjs "https://app.example.com/healthz"`（可以给好几个地址）。

```js
import { edges, emit, injected, poll } from '../watch.mjs'

const targets = process.argv.slice(2)
const state = edges('state.json', { confirm: 2 })

async function read(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    return response.ok ? { status: 'up' } : { status: 'down', reason: `返回 ${response.status}` }
  } catch (error) {
    return { status: 'down', reason: error.name === 'TimeoutError' ? '10 秒没响应' : error.message }
  }
}

const report = ({ url, status, reason }) =>
  emit(status === 'down' ? `${url} 挂了：${reason}` : `${url} 恢复了`, { url, status })

injected(report)
await poll(
  async () => {
    let changed = 0
    for (const url of targets) {
      const now = await read(url)
      if (state.update(url, now.status) === null) continue // 没变；第一次见只记下
      report({ url, ...now })
      changed += 1
    }
    state.save()
    return changed > 0
  },
  { every: 15_000 },
)
```

- 换成别的值只改 `read`：读出来回 `{ status }`。数值配阈值时分开告警线和恢复线，中间保持原样，免得在线上来回跳：`status = used >= 90 ? 'high' : used < 80 ? 'ok' : (state.value(key) ?? 'ok')`。
- 要更快就调小 `every`；认下一次变化要 `every × confirm`。

试：存卡片目录的 `samples/down.json`：`{"url": "https://app.example.com/healthz", "status": "down", "reason": "返回 502"}`，`poke` 写 `node ../watch.mjs inject samples/down.json`。`events` 里正好一行。
