# 接口、数据库里有新记录或记录改了（监视）

工单、审批、订单这类系统只给查询接口时，按游标查：只要「上次之后改过的」，一条一件。命令 `node records.mjs "https://tracker.example.com/api/issues"`，令牌请用户放进密钥目录的 `token.txt`（`read` 卡片的 `local.secretsDir`）。

下面按 `GET <地址>?updated_after=<时间>` 返回 `{ "items": [{ "id", "title", "status", "created_at", "updated_at", "url" }] }` 写，照对方的文档换掉参数名和字段名。

```js
import { emit, getJson, injected, log, poll, remember, secret, seenIds } from '../watch.mjs'

const api = process.argv[2]
const token = secret('token.txt', '访问令牌')
const cursor = remember('cursor.json', { since: null })
const seen = seenIds() // 游标那一刻改的会查到两次，按「编号@更新时间」挡掉

function handle(item) {
  if (!seen.add(`${item.id}@${item.updated_at}`)) return
  const what = item.created_at === item.updated_at ? '新建' : `状态 ${item.status}`
  emit(`工单 #${item.id}「${item.title}」${what}`, { id: item.id, url: item.url })
}

injected(handle)
await poll(
  async () => {
    if (cursor.value.since === null) {
      cursor.save({ since: new Date().toISOString() })
      log('第一次运行，只记下现在')
      return false
    }
    const url = `${api}?updated_after=${encodeURIComponent(cursor.value.since)}`
    const items = (await getJson(url, { headers: { authorization: `Bearer ${token}` } })).data.items
    if (items.length > 30) {
      // 停了很久或一下来了一大批：只打一件汇总，别触发几十次
      for (const item of items) seen.add(`${item.id}@${item.updated_at}`)
      emit(`工单系统一下子有 ${items.length} 条更新`, { ids: items.slice(0, 100).map((item) => item.id) })
    } else {
      for (const item of items) handle(item)
    }
    if (items.length > 0) cursor.save({ since: items.at(-1).updated_at }) // 用对方的时间，不用本机时间
    seen.save()
    return items.length > 0
  },
  { every: 10_000, idle: 60_000 },
)
```

- 查数据库：在卡片目录放 `package.json` 装好驱动（Postgres 用 `pg`），连接串放密钥目录的 `db.txt`，`getJson` 那一行换成 `select … where id > $1 order by id limit 100`，游标记最大的编号。
- 一页拿不完要翻页，整批处理完再挪游标。

试：存卡片目录的 `samples/issue.json`：`{"id": 101, "title": "登录失败", "status": "新建", "created_at": "2026-11-20T08:00:00Z", "updated_at": "2026-11-20T08:00:00Z", "url": "https://tracker.example.com/issues/101"}`（照对方接口真实返回的一条改），`poke` 写 `node ../watch.mjs inject samples/issue.json`，`seconds` 写 15。`events` 里是那一行；`run.stderr` 里没有「返回 401」「返回 403」（有就是令牌或权限不对）。
