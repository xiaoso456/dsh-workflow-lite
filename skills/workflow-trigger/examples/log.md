# 日志里出现关键字（监视）

命令 `node tail-log.mjs "{workspace}/logs/app.log"`，关键字写在 `filter.include`（如 `["ERROR", "FATAL"]`）。一行日志打一件，后面跟着的堆栈（缩进的、`Caused by`、`... N more`）并进同一件的 `stack`；触发说明里写一句「背景信息末尾的 stack 是报错堆栈」。读到哪记着，重启后接着读；第一次从文件末尾开始。

```js
import { closeSync, existsSync, openSync, readSync, statSync, watchFile } from 'node:fs'
import { basename } from 'node:path'
import { emit, remember } from '../watch.mjs'

const file = process.argv[2]
const sizeOf = () => (existsSync(file) ? statSync(file).size : 0)
const state = remember('offset.json', { offset: sizeOf() })
state.save()
let offset = state.value.offset
let rest = '' // 读到的最后半行，等它写完
let event = null // 正在攒的一件：一行日志和它后面的堆栈
let quiet

function flush() {
  if (event !== null) emit(`${basename(file)} 出现：${event.line}`, event.stack.length > 0 ? { stack: event.stack } : undefined)
  event = null
}

function take(line) {
  if (event !== null && /^(\s|Caused by|\.\.\. \d+ more)/.test(line)) {
    if (event.stack.length < 50) event.stack.push(line.trim())
    return
  }
  flush()
  event = { line: line.trim(), stack: [] }
}

function read() {
  const size = sizeOf()
  if (size < offset) [offset, rest] = [0, ''] // 日志被轮转、清空了：从头读
  if (size === offset) return
  const buffer = Buffer.alloc(size - offset)
  const fd = openSync(file, 'r')
  readSync(fd, buffer, 0, buffer.length, offset)
  closeSync(fd)
  offset = size
  const lines = (rest + buffer.toString('utf8')).split(/\r?\n/)
  rest = lines.pop() ?? ''
  state.save({ offset: offset - Buffer.byteLength(rest) }) // 没读完的半行下次重读
  for (const line of lines) if (line.trim() !== '') take(line)
  clearTimeout(quiet)
  quiet = setTimeout(flush, 1000) // 一秒内没有新的续行，这件就完了
}

read()
watchFile(file, { interval: 1000 }, read)
```

- 日志一下刷出很多报错：`filter.merge` 调到 30 到 60，一段时间的报错并成一次处理。
- 盯的是一个一直往外打的命令行程序：照 `examples/push.md` 把它作为子进程跑起来，每一行交给 `take`。

试：`poke` 往日志追加一行不带关键字的、一行带关键字的再跟一行堆栈，如 `node -e "require('fs').appendFileSync(process.argv[1], 'INFO ok\nERROR pay failed\n  at Pay.charge(Pay.java:42)\n')" "{workspace}/logs/app.log"`。`events` 里第一件被关键字挡掉，第二件 `pass`、末尾带着 `{"stack":[…]}`。
