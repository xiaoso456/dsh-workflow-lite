# 文件夹里有新文件（监视）

命令 `node "{workflow}/triggers/watch-folder.mjs" "D:/inbox"`。系统一通知就看，等文件写完再报；每分钟再扫一遍，补上没收到通知的（网络盘常这样）和 DSH 没开时进来的。第一次运行只记下已有的。

```js
import { readdirSync, watch } from 'node:fs'
import { join, resolve } from 'node:path'
import { emit, heartbeat, poll, seenIds, settle } from './watch.mjs'

const dir = resolve(process.argv[2])
const seen = seenIds('seen.json', 20000)
const waiting = new Set()

async function arrive(name) {
  if (seen.has(name) || waiting.has(name)) return
  waiting.add(name)
  const done = await settle(join(dir, name)) // 两秒不再变才算写完；文件没了就不报
  waiting.delete(name)
  if (!done || !seen.add(name)) return
  seen.save()
  emit(`${dir} 进了新文件 ${name}`, { path: join(dir, name) })
}

function scan(report) {
  const fresh = readdirSync(dir).filter((name) => !seen.has(name))
  for (const name of fresh) {
    if (report) void arrive(name)
    else seen.add(name)
  }
  seen.save()
  return fresh.length > 0
}

scan(!seen.first) // 第一次只记下已有的
watch(dir, (_event, name) => {
  if (name) void arrive(String(name))
})
heartbeat()
await poll(() => scan(true), { every: 60_000 })
```

- 一次拷进来一批：`filter.merge` 调到 30 左右，一批并成一次处理。
- 子文件夹也要看：`watch` 加 `{ recursive: true }`，`readdirSync` 加 `{ recursive: true }`。

试：`poke` 写 `node -e "require('fs').writeFileSync('D:/inbox/test-' + Date.now() + '.txt', 'x')"`，`seconds` 写 10。
