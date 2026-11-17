# 有待处理的才做（定时检查）

工作日 9 点查一次，`when: "every"`。命令打出待处理的条目、退出 0；没有就退出 1。处理过的要让下一次查不到（工作流里把它标成已处理，或脚本把交出去的记进数据目录）。

```json
{ "kind": "schedule", "schedule": { "kind": "daily", "time": "09:00", "weekdays": [1, 2, 3, 4, 5] }, "check": { "command": "node \"{workflow}/triggers/pending.mjs\"", "when": "every" } }
```
