# 每月最后一个工作日（定时检查）

cron 表达不了。每天 18:00 检查，脚本判断今天是不是本月最后一个周一到周五（节假日要另外查表）：

```js
const now = new Date()
const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
while (last.getDay() === 0 || last.getDay() === 6) last.setDate(last.getDate() - 1)
process.exit(now.getDate() === last.getDate() ? 0 : 1)
```
