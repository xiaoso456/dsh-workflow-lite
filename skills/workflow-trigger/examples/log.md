# 日志里出现关键字（监视）

命令 `node "{workflow}/triggers/tail-log.mjs" "D:/app/logs/app.log"`，关键字写在 `filter.include`（如 `["ERROR", "FATAL"]`）。

脚本每件事打一行 JSON：`file` 是日志文件名，`line` 是那一行，`more` 是跟在它后面的报错堆栈（以空白开头、`Caused by`、`... N more` 的行），堆栈并进同一件事，不会拆成好几次执行。读到哪记在数据目录里：程序重启、DSH 没开时写进日志的，启动后接着读；第一次从文件末尾开始，之前的旧日志不算。

```js
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, watchFile, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const file = process.argv[2]
const stateFile = join(process.env.TRIGGER_DATA_DIR ?? '.', 'offset.txt')
const sizeOf = () => (existsSync(file) ? statSync(file).size : 0)
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
process.on('SIGTERM', () => process.exit(0))

let offset = existsSync(stateFile) ? Number(readFileSync(stateFile, 'utf8')) : sizeOf()
let rest = '' // 读到的最后半行，等它写完
let event = null // 正在攒的一件事：一行日志和它后面的堆栈
let quiet

function flush() {
  clearTimeout(quiet)
  if (event !== null) emit(event.more.length > 0 ? event : { file: event.file, line: event.line })
  event = null
}

function take(line) {
  if (event !== null && /^(\s|Caused by|\.\.\. \d+ more)/.test(line)) {
    if (event.more.length < 50) event.more.push(line.trim())
    return
  }
  flush()
  event = { file: basename(file), line: line.trim(), more: [] }
}

function read() {
  const size = sizeOf()
  if (size < offset) {
    offset = 0 // 日志被轮转、清空了：从头读
    rest = ''
  }
  if (size === offset) return
  const buffer = Buffer.alloc(size - offset)
  const fd = openSync(file, 'r')
  readSync(fd, buffer, 0, buffer.length, offset)
  closeSync(fd)
  offset = size
  const lines = (rest + buffer.toString('utf8')).split(/\r?\n/)
  rest = lines.pop() ?? ''
  writeFileSync(stateFile, String(offset - Buffer.byteLength(rest))) // 没读完的半行下次重读
  for (const line of lines) if (line.trim() !== '') take(line)
  clearTimeout(quiet)
  quiet = setTimeout(flush, 1000) // 一秒内没有新的续行，这件事就完了
}

read()
watchFile(file, { interval: 1000 }, read)
```

- 关键字按整行 JSON 找：日志文件名本身带关键字（如 `error.log`）时每一件都会过，这时把关键字写得更具体（如 `] ERROR`），或去掉 `file` 字段。
- 日志一下刷出很多报错时，把 `filter.merge` 调到 30 到 60，一段时间里的报错并成一次处理。

试：`poke` 往日志追加一行不带关键字的、一行带关键字的再跟一行缩进的堆栈，如 `node -e "require('fs').appendFileSync('D:/app/logs/app.log', 'INFO ok\nERROR pay failed\n  at Pay.charge(Pay.java:42)\n')"`。看 `lines`：第一件被关键字挡掉，第二件是 `pass` 且带着 `more`；`message` 里的背景信息够不够执行的模型找原因。
