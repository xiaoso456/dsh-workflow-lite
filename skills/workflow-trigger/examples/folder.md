# 文件夹里有新文件（监视）

命令 `node "{workflow}/triggers/watch-folder.mjs" "D:/inbox"`。看过的文件名记在数据目录里，DSH 重启、程序重启时不会漏掉期间进来的文件；第一次运行只记下已有的。

```js
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '.')
const stateFile = join(process.env.TRIGGER_DATA_DIR ?? '.', 'seen.json')
const first = !existsSync(stateFile)
const seen = new Set(first ? [] : JSON.parse(readFileSync(stateFile, 'utf8')))
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
process.on('SIGTERM', () => process.exit(0))

function scan(report) {
  let names
  try {
    names = readdirSync(dir)
  } catch (error) {
    console.error(String(error))
    return
  }
  let changed = false
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    changed = true
    if (report) emit({ event: 'new-file', path: join(dir, name) })
  }
  if (changed) writeFileSync(stateFile, JSON.stringify([...seen]))
}
scan(!first)
setInterval(() => scan(true), 5000)
```

- 新文件一出现就报：大文件复制要一会儿，工作流可能读到一半。要等写完，在脚本里等它的大小几秒不变再打这一行。
- 子文件夹不看；要看的话换成递归列出。

试：`poke` 写 `node -e "require('fs').writeFileSync('D:/inbox/test-' + Date.now() + '.txt', 'x')"`，`seconds` 写 10。
