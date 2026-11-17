# 指定时刻只跑一次（定时检查）

每天 15:00 检查，脚本只在指定那天返回 0，并在数据目录记下「跑过了」。跑完后用 `local.enabled: false` 关掉卡片。

```js
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const day = process.argv[2] // 如 2026-11-20
const done = join(process.env.TRIGGER_DATA_DIR ?? '.', `done-${day}`)
const today = new Date().toLocaleDateString('sv') // YYYY-MM-DD，本机时区
if (today !== day || existsSync(done)) process.exit(1)
writeFileSync(done, '')
console.log(`今天是 ${day}，执行一次`)
```
