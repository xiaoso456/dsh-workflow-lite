# GitHub Webhook，要校验签名、看事件类型（监视）

GitHub 的事件类型在 `X-GitHub-Event` 请求头里，签名在 `X-Hub-Signature-256`，`http` 卡片拿不到请求头，所以写个监视程序自己开端口、验签名，验过了打一行。密钥请用户放在数据目录的 `github-secret.txt`。

命令 `node "{workflow}/triggers/github-hook.mjs" 3801`：

```js
import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

const port = Number(process.argv[2] ?? 3801)
const secret = readFileSync(join(process.env.TRIGGER_DATA_DIR ?? '.', 'github-secret.txt'), 'utf8').trim()
// text：一句话说清这件事，动态拿到的文字直接拼进来；data：要原样给出的字段（可选，跟在后面成一段 JSON）。
// 换行一律换掉：一件事只能占一行，不然后面几截没带标记，只算日志。
const emit = (text, data) => {
  const line = data === undefined ? String(text) : `${text} ${JSON.stringify(data)}`
  console.log(`::trigger:: ${line.replace(/\r?\n/g, ' ⏎ ')}`)
}
process.on('SIGTERM', () => process.exit(0))

createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const body = Buffer.concat(chunks)
    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    const given = String(request.headers['x-hub-signature-256'] ?? '')
    const ok = given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    response.writeHead(ok ? 202 : 401).end()
    if (!ok) return console.error('签名不对，丢掉')
    const event = String(request.headers['x-github-event'] ?? '')
    const payload = JSON.parse(body.toString('utf8'))
    if (event === 'ping') return
    const pr = payload.pull_request
    emit(`${payload.repository?.full_name} 来了 ${event}${payload.action ? `（${payload.action}）` : ''}${pr ? `：#${pr.number} ${pr.title}` : ''}`, {
      event,
      ref: payload.ref,
      url: pr?.html_url,
    })
  })
}).listen(port, '0.0.0.0')
```

- 过滤写 `filter.include: ["来了 pull_request"]` 之类（按整行文字找）；GitHub.com 连不到本机时要用户配隧道。
- 连不进来又想看新 PR：改用定时检查，`gh pr list --json number,title,updatedAt` 配 `when: "change"`。
- 试：先用 `test_trigger` 带 `poke`，poke 写一条 `node` 命令按同样的密钥算出签名、往 `http://127.0.0.1:3801/` 发一段样例请求体。
